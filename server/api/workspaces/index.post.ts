import { connectToDatabase } from '../../utils/mongodb'

export default defineEventHandler(async (event) => {
  try {
    const body = await readBody(event)

    const { db } = await connectToDatabase()
    
    const newWorkspace = {
      name: body.name || 'New Workspace',
      description: body.description || '',
      menus: body.menus || {},
      status: body.status || 'Active',
      createdAt: new Date(),
      updatedAt: new Date()
    }

    const result = await db.collection('turboCleanWorkspaces').insertOne(newWorkspace)
    return { success: true, workspace: { ...newWorkspace, id: result.insertedId.toString() } }
  } catch (error: any) {
    return createError({ statusCode: 500, statusMessage: error.message || 'Failed to create workspace' })
  }
})
