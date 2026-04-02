import { connectToDatabase } from '../utils/mongodb'
import { WorkOrdersMapper } from '../utils/sync-mapper'
import { appSheetEdit } from '../utils/appsheet'

export default defineEventHandler(async () => {
  const { db } = await connectToDatabase()
  const woCollection = db.collection('turboCleanWorkOrders')

  // Let's find all Work Orders that are at UTC midnight
  // (Assuming those are the ones I just fixed or that are correct)
  const allWOs = await woCollection.find({ date: { $type: 'date' } }).toArray()
  const validWOs = allWOs.filter(wo => {
    const d = wo.date
    return d.getUTCHours() === 0 && d.getUTCMinutes() === 0
  })

  // To save on API calls, maybe only sync the recent ones?
  // Or just chunk them all.
  const appSheetRows = validWOs.map(wo => WorkOrdersMapper.toAppSheet(wo))

  let synced = 0
  for (let i = 0; i < appSheetRows.length; i += 100) {
    const chunk = appSheetRows.slice(i, i + 100)
    await appSheetEdit('WorkOrders', chunk)
    synced += chunk.length
  }

  return {
    success: true,
    syncedToAppSheet: synced,
    message: `Synced ${synced} corrected work orders to AppSheet.`
  }
})
