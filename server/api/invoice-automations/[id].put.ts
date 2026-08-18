import { ObjectId } from 'mongodb'
import { connectToDatabase } from '../../utils/mongodb'
import { AUTOMATIONS_COLLECTION } from '../../utils/invoice-automation'

/** Partial update — used for quick actions like the enable/disable toggle */
export default defineEventHandler(async (event) => {
  try {
    const id = getRouterParam(event, 'id')
    if (!id) throw createError({ statusCode: 400, statusMessage: 'Missing automation ID' })

    const body = await readBody(event) || {}
    const { db } = await connectToDatabase()

    const updateDoc: Record<string, any> = { updatedAt: new Date().toISOString() }
    if (body.enabled !== undefined) {
      updateDoc.enabled = !!body.enabled
      if (updateDoc.enabled) updateDoc.disabledReason = ''
    }
    if (typeof body.name === 'string' && body.name.trim()) updateDoc.name = body.name.trim()

    let objectId: any = id
    try { objectId = new ObjectId(id) } catch {}

    const result = await db.collection(AUTOMATIONS_COLLECTION).updateOne({ _id: objectId }, { $set: updateDoc })
    if (result.matchedCount === 0) {
      throw createError({ statusCode: 404, statusMessage: 'Automation not found' })
    }

    return { success: true }
  }
  catch (error: any) {
    if (error?.statusCode) throw error
    throw createError({ statusCode: 500, statusMessage: error.message || 'Failed to update automation' })
  }
})
