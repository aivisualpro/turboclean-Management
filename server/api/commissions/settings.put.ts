import { connectToDatabase } from '../../utils/mongodb'
import { requireCommissionAdmin } from '../../utils/commission-access'
import { COMMISSION_SETTINGS_COLLECTION, cleanCommissionSettings, commissionDealerResolver } from '../../utils/commissions'

/** PUT /api/commissions/settings — save the whole plan. Rules whose spreadsheet name now matches a dealer get linked to it. */
export default defineEventHandler(async (event) => {
  const session = await requireCommissionAdmin(event)
  const body = await readBody(event) || {}
  const settings = cleanCommissionSettings(body)
  const { db } = await connectToDatabase()
  const dealerDocs = await db.collection('turboCleanDealers').find({}).project({ _id: 1, dealer: 1 }).toArray()
  const resolve = commissionDealerResolver(dealerDocs.map((d: any) => ({ id: d._id.toString(), name: d.dealer || '', taxPercentage: 0 })), settings.nameMap)
  for (const r of settings.rules) if (!r.dealerId && r.dealerName) r.dealerId = resolve(r.dealerName)
  settings.updatedAt = new Date().toISOString()
  settings.updatedBy = session.name || session.email || ''
  await db.collection<any>(COMMISSION_SETTINGS_COLLECTION).replaceOne({ _id: 'settings' }, settings as any, { upsert: true })
  return { settings }
})
