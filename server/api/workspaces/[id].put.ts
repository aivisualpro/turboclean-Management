import { connectToDatabase } from '../../utils/mongodb'
import { ObjectId } from 'mongodb'

export default defineEventHandler(async (event) => {
  try {
    const id = getRouterParam(event, 'id')
    if (!id || !ObjectId.isValid(id)) throw createError({ statusCode: 400, statusMessage: 'Invalid ID' })

    const body = await readBody(event)

    const { db } = await connectToDatabase()
    
    const updateData: any = { updatedAt: new Date() }
    if (body.name !== undefined) updateData.name = body.name
    if (body.description !== undefined) updateData.description = body.description
    if (body.menus !== undefined) updateData.menus = body.menus
    if (body.status !== undefined) updateData.status = body.status

    const result = await db.collection('turboCleanWorkspaces').updateOne(
      { _id: new ObjectId(id) },
      { $set: updateData }
    )

    if (result.matchedCount === 0) throw createError({ statusCode: 404, statusMessage: 'Workspace not found' })

    return { success: true, message: 'Workspace updated correctly' }
  } catch (error: any) {
    return createError({ statusCode: 500, statusMessage: error.message || 'Failed to update workspace' })
  }
})
