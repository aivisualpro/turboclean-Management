import { connectToDatabase } from '../../../utils/mongodb'
import { getDealerUsage } from '../../../utils/dealer-usage'

/** GET /api/dealers/:id/usage — counts of records that block deletion */
export default defineEventHandler(async (event) => {
  const id = getRouterParam(event, 'id')!
  const { db } = await connectToDatabase()
  const usage = await getDealerUsage(db, id)
  return { ...usage, deletable: usage.total === 0 }
})
