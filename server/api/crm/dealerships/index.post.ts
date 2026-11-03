import {
  CRM_COLLECTIONS, DEALERSHIP_STAGES, DEFAULT_STAGE, LEAD_SOURCES, WON_STAGE, actorFromSession, getCrmDb,
  logActivity, nextDealershipId, normalizeStage, normalizeUrl, serializeDealership, str,
} from '../../../utils/crm'
import { recordStageChange } from '../../../utils/crm-stage'
import { getUserSession } from '../../../utils/auth'
import { duplicateDealershipError, findDealershipDuplicates } from '../../../utils/crm-duplicates'
import { normalizeBrands, normalizeCity, normalizePhone, normalizeRoute, normalizeState } from '../../../utils/crm-normalize'

export default defineEventHandler(async (event) => {
  const session = await getUserSession(event)
  const body = await readBody(event)
  if (!body?.name || !String(body.name).trim())
    throw createError({ statusCode: 400, statusMessage: 'Dealership name is required' })
  if (body.leadSource && !LEAD_SOURCES.includes(body.leadSource))
    throw createError({ statusCode: 400, statusMessage: 'Unknown lead source' })
  if (!normalizeState(body.state))
    throw createError({ statusCode: 400, statusMessage: 'State is required' })

  const db = await getCrmDb()
  const now = new Date().toISOString()
  // New records can start anywhere in the funnel except Won (that goes through conversion).
  const requestedStage = normalizeStage(body.stage)
  const stage = DEALERSHIP_STAGES.includes(requestedStage as any) && requestedStage !== WON_STAGE ? requestedStage : DEFAULT_STAGE
  const actor = actorFromSession(session)

  const doc = {
    dealershipId: await nextDealershipId(db),
    name: str(body.name, 200),
    dealerGroup: str(body.dealerGroup, 200),
    brands: normalizeBrands(body.brands),
    website: normalizeUrl(body.website),
    address: str(body.address, 300),
    city: normalizeCity(body.city),
    state: normalizeState(body.state).slice(0, 60),
    zip: str(body.zip, 20),
    phone: normalizePhone(body.phone),
    territory: str(body.territory, 120),
    route: normalizeRoute(body.route),
    assignedUserId: str(body.assignedUserId, 64),
    assignedUserName: str(body.assignedUserName, 120),
    leadSource: body.leadSource || 'Manual research',
    leadSourceDetail: str(body.leadSourceDetail, 300),
    stage,
    stageChangedAt: now,
    stageChangedBy: actor,
    notes: str(body.notes, 5000),
    estMonthlyValue: Number(body.estMonthlyValue) > 0 ? Math.round(Number(body.estMonthlyValue) * 100) / 100 : null,
    tags: Array.isArray(body.tags) ? body.tags.map((t: any) => str(t, 40)).filter(Boolean) : [],
    createdAt: now,
    createdBy: actor,
    updatedAt: now,
    archivedAt: null as string | null,
  }

  // Duplicate guard: same website, phone, or name (+ state) → ask first.
  if (!body.allowDuplicate) {
    const dups = await findDealershipDuplicates(db, doc)
    if (dups.length) throw duplicateDealershipError(dups)
  }

  const res = await db.collection(CRM_COLLECTIONS.dealerships).insertOne(doc)
  const id = res.insertedId.toString()
  await logActivity(db, { dealershipId: id, type: 'dealership.created', message: `Dealership record ${doc.dealershipId} created`, actor })
  await recordStageChange(db, { dealership: { _id: res.insertedId, ...doc }, fromStage: null, toStage: stage, actor, source: 'create', at: new Date(now) })

  return { dealership: serializeDealership({ _id: res.insertedId, ...doc }) }
})
