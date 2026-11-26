import { connectToDatabase } from '../../utils/mongodb'
import { requireCommissionAdmin } from '../../utils/commission-access'
import { commissionDealerResolver, commissionSheetWeeks, loadCommissionSettings } from '../../utils/commissions'

/** GET /api/commissions/settings — the commission plan, dealers, and how spreadsheet names link to dealers. */
export default defineEventHandler(async (event) => {
  await requireCommissionAdmin(event)
  const { db } = await connectToDatabase()
  const [settings, dealerDocs, imported] = await Promise.all([
    loadCommissionSettings(db),
    db.collection('turboCleanDealers').find({}).project({ _id: 1, dealer: 1 }).toArray(),
    db.collection('turboCleanCommissionStatements').countDocuments({ source: 'sheet' }),
  ])
  const dealers = dealerDocs.map((d: any) => ({ id: d._id.toString(), name: d.dealer || 'Dealer', taxPercentage: 0 })).sort((a: any, b: any) => a.name.localeCompare(b.name))
  const resolve = commissionDealerResolver(dealers, settings.nameMap)
  const names = new Set<string>()
  for (const w of commissionSheetWeeks().values()) for (const l of w.lines || []) if (l.billed || l.net || l.payout) names.add(l.name)
  for (const r of settings.rules) if (!r.dealerId && r.dealerName) names.add(r.dealerName)
  const sheetNames = [...names].sort().map(name => ({ name, dealerId: resolve(name), mapped: settings.nameMap[name] || null }))
  return {
    settings,
    dealers: dealers.map((d: any) => ({ id: d.id, name: d.name })),
    sheetNames,
    sheetWeeks: commissionSheetWeeks().size,
    importedWeeks: imported,
  }
})
