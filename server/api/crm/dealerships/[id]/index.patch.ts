import {
  CRM_COLLECTIONS, DEALERSHIP_STAGES, LEAD_SOURCES, actorFromSession, diffFields, getCrmDb,
  logActivity, normalizeStage, normalizeUrl, serializeDealership, str, toObjectId, WON_STAGE,
} from '../../../../utils/crm'
import { recordStageChange } from '../../../../utils/crm-stage'
import { NURTURE_STAGE, applyParkingFields } from '../../../../utils/crm-followups'
import { convertDealershipToDealer } from '../../../../utils/crm-convert'
import { getUserSession } from '../../../../utils/auth'
import { syncOpenLoss } from '../../../../utils/crm-lost'
import { normalizeBrands, normalizeCity, normalizePhone, normalizeRoute, normalizeState } from '../../../../utils/crm-normalize'
import { duplicateDealershipError, findDealershipDuplicates } from '../../../../utils/crm-duplicates'

const EDITABLE = ['name', 'dealerGroup', 'brands', 'website', 'address', 'city', 'state', 'zip', 'phone',
  'territory', 'route', 'assignedUserId', 'assignedUserName', 'leadSource', 'leadSourceDetail', 'stage', 'notes', 'tags'] as const

export default defineEventHandler(async (event) => {
  const id = getRouterParam(event, 'id')!
  const session = await getUserSession(event)
  const body = await readBody(event) || {}
  const db = await getCrmDb()
  const col = db.collection(CRM_COLLECTIONS.dealerships)
  const before = await col.findOne({ _id: toObjectId(id) })
  if (!before) throw createError({ statusCode: 404, statusMessage: 'Dealership not found' })

  const $set: Record<string, any> = {}
  for (const k of EDITABLE) {
    if (!(k in body)) continue
    const v = body[k]
    switch (k) {
      case 'name': if (!str(v)) throw createError({ statusCode: 400, statusMessage: 'Name cannot be empty' }); $set.name = str(v, 200); break
      case 'brands': $set.brands = normalizeBrands(v); break
      case 'tags': $set[k] = Array.isArray(v) ? v.map((x: any) => str(x, 60)).filter(Boolean) : []; break
      case 'state': $set.state = normalizeState(v).slice(0, 60); break
      case 'city': $set.city = normalizeCity(v); break
      case 'route': $set.route = normalizeRoute(v); break
      case 'phone': $set.phone = normalizePhone(v); break
      case 'website': $set.website = normalizeUrl(v); break
      case 'leadSource': if (!LEAD_SOURCES.includes(v)) throw createError({ statusCode: 400, statusMessage: 'Unknown lead source' }); $set.leadSource = v; break
      case 'stage': {
        const stage = normalizeStage(v)
        if (!DEALERSHIP_STAGES.includes(stage as any)) throw createError({ statusCode: 400, statusMessage: 'Unknown stage' })
        $set.stage = stage
        break
      }
      case 'notes': $set.notes = str(v, 5000); break
      default: $set[k] = str(v, 300)
    }
  }

  // Inventory pages the scanner should cover for this dealership (used by Scrape and batch scans).
  if ('scanPages' in body) {
    const list = Array.isArray(body.scanPages) ? body.scanPages : []
    const seen = new Set<string>()
    $set.scanPages = list.map((p: any) => ({ url: normalizeUrl(typeof p === 'string' ? p : p?.url), label: str(typeof p === 'string' ? '' : p?.label, 80) }))
      .filter((p: any) => { if (!p.url || seen.has(p.url) || !/^https?:\/\/[^\s/]+\.[^\s/]+/i.test(p.url)) return false; seen.add(p.url); return true })
      .slice(0, 40)
  }

  if ('estMonthlyValue' in body) {
    const v = body.estMonthlyValue === '' || body.estMonthlyValue === null ? null : Number(body.estMonthlyValue)
    if (v !== null && (!Number.isFinite(v) || v < 0)) throw createError({ statusCode: 400, statusMessage: 'Estimated value must be a positive number' })
    $set.estMonthlyValue = v === null || v === 0 ? null : Math.round(v * 100) / 100
  }
  // Editing name / website / phone into another record's identity → ask first.
  if (!body.allowDuplicate && ['name', 'website', 'phone'].some(k => k in $set && $set[k] !== before[k])) {
    const dups = await findDealershipDuplicates(db, { ...before, ...$set }, id)
    if (dups.length) throw duplicateDealershipError(dups)
  }

  if ('contractValue' in body) {
    const v = body.contractValue === '' || body.contractValue === null ? null : Number(body.contractValue)
    if (v !== null && (!Number.isFinite(v) || v < 0)) throw createError({ statusCode: 400, statusMessage: 'Contract value must be a positive number' })
    $set.contractValue = v === null ? null : Math.round(v * 100) / 100
  }

  // Nurture needs a revisit date and Lost may carry a reason / revisit date — nobody silently disappears.
  applyParkingFields($set, body, before)

  // Archive / restore are explicit intents, never incidental.
  if (typeof body.archived === 'boolean') $set.archivedAt = body.archived ? new Date().toISOString() : null

  const actor = actorFromSession(session)
  const archived = typeof body.archived === 'boolean' ? body.archived : !!before.archivedAt
  const stageChanged = $set.stage !== undefined && $set.stage !== before.stage
  // Winning a live, not-yet-converted account promotes it to an operational Dealer;
  // the conversion itself moves the stage (and records the history entry).
  const promote = stageChanged && $set.stage === WON_STAGE && !archived && !before.dealerId
  if (promote) delete $set.stage
  // A converted dealership stays Won while its Dealer exists (delete the Dealer to revert).
  if (stageChanged && before.dealerId && $set.stage !== WON_STAGE)
    throw createError({ statusCode: 409, statusMessage: 'This dealership is won and lives in Dealers — delete the Dealer to return it to the pipeline' })

  $set.updatedAt = new Date().toISOString()
  await col.updateOne({ _id: before._id }, { $set })
  let after = await col.findOne({ _id: before._id })

  const source = body.source === 'bulk' ? 'bulk' : 'manual'
  if (promote) {
    await convertDealershipToDealer(db, after, {}, session, { source })
    after = await col.findOne({ _id: before._id })
  } else if (stageChanged) {
    await recordStageChange(db, { dealership: before, fromStage: before.stage, toStage: $set.stage, actor, source, note: str(body.stageNote, 500) })
    after = await col.findOne({ _id: before._id })
  } else if (before.stage === 'Lost' && 'lostReason' in body) {
    await syncOpenLoss(db, id, after, actor)
  }
  const changes = diffFields(before, after, [...EDITABLE])
  if (typeof body.archived === 'boolean' && body.archived !== !!before.archivedAt) {
    await logActivity(db, { dealershipId: id, type: body.archived ? 'dealership.archived' : 'dealership.restored', message: body.archived ? 'Dealership archived' : 'Dealership restored', actor })
  } else if (Object.keys(changes).length) {
    const labels = Object.keys(changes).join(', ')
    await logActivity(db, { dealershipId: id, type: 'dealership.updated', message: `Updated ${labels}`, changes, actor })
  }

  return { dealership: serializeDealership(after) }
})
