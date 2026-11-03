import { CRM_COLLECTIONS, getCrmDb, serializeDealership, toObjectId } from '../../../../utils/crm'
import { convertDealershipToDealer } from '../../../../utils/crm-convert'
import { getUserSession } from '../../../../utils/auth'
import { actorFromSession } from '../../../../utils/crm'
import { dealerServicesFromWin, getWin, parseWonInput, saveWin } from '../../../../utils/crm-won'

/**
 * POST /api/crm/dealerships/:id/convert
 * Marks the dealership as won and promotes it to an operational Dealer.
 * Safe to call repeatedly — returns the existing dealer when already converted.
 */
export default defineEventHandler(async (event) => {
  const id = getRouterParam(event, 'id')!
  const session = await getUserSession(event)
  const body = await readBody(event) || {}
  const db = await getCrmDb()
  const dealership = await db.collection(CRM_COLLECTIONS.dealerships).findOne({ _id: toObjectId(id) })
  if (!dealership) throw createError({ statusCode: 404, statusMessage: 'Dealership not found' })
  if (dealership.archivedAt) throw createError({ statusCode: 409, statusMessage: 'Restore the dealership before converting it' })

  // Won-deal details (services sold, contract, revenue, profit). Validated before anything is written.
  const won = body.won ? parseWonInput(body.won) : null
  const wonPricing = won && body.won.useAsPriceList !== false && !body.copyServicesFromDealerId
    ? dealerServicesFromWin(won.services, { isTaxApplied: !!body.isTaxApplied, taxPercentage: Number(body.taxPercentage) || 0 }) : []

  const result = await convertDealershipToDealer(db, dealership, {
    status: ['Authorised', 'Pending', 'In Followup'].includes(body.status) ? body.status : 'Authorised',
    isTaxApplied: !!body.isTaxApplied,
    taxPercentage: Number(body.taxPercentage) || 0,
    copyServicesFromDealerId: body.copyServicesFromDealerId || '',
    duplicateStock: !!body.duplicateStock,
    notes: typeof body.notes === 'string' ? body.notes : undefined,
    services: wonPricing,
  }, session)
  if (won) await saveWin(db, id, body.won, actorFromSession(session))

  // Estimated contract value (annual $) — used for "revenue won" in template experiments until invoices accrue.
  const contractValue = Number(body.contractValue)
  if (Number.isFinite(contractValue) && contractValue >= 0 && body.contractValue !== '' && body.contractValue != null)
    await db.collection(CRM_COLLECTIONS.dealerships).updateOne({ _id: dealership._id }, { $set: { contractValue: Math.round(contractValue * 100) / 100 } })
  const after = await db.collection(CRM_COLLECTIONS.dealerships).findOne({ _id: dealership._id })
  return { ...result, dealership: serializeDealership(after), win: await getWin(db, id) }
})
