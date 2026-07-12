import { ObjectId } from 'mongodb'
import { connectToDatabase } from '../../utils/mongodb'

// Partial update — used for quick toggles like enable/disable
export default defineEventHandler(async (event) => {
  const id = event.context.params?.id
  if (!id)
    throw createError({ statusCode: 400, statusMessage: 'Missing automation id' })

  const body = await readBody(event) || {}
  const { db } = await connectToDatabase()

  const allowed: any = {}
  if (typeof body.enabled === 'boolean')
    allowed.enabled = body.enabled
  if (typeof body.endDate === 'string')
    allowed.endDate = body.endDate
  if (Object.keys(allowed).length === 0)
    return { success: false, message: 'Nothing to update' }
  allowed.updatedAt = new Date().toISOString()

  let objectId: any = id
  try { objectId = new ObjectId(id) }
  catch { }

  const result = await db.collection('turboCleanMonthlyAutomations')
    .updateOne({ _id: objectId }, { $set: allowed })

  if (result.matchedCount === 0)
    throw createError({ statusCode: 404, statusMessage: 'Automation not found' })

  return { success: true }
})
