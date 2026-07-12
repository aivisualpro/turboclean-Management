import { ObjectId } from 'mongodb'
import { connectToDatabase } from '../../utils/mongodb'

export default defineEventHandler(async (event) => {
  const id = event.context.params?.id
  if (!id)
    throw createError({ statusCode: 400, statusMessage: 'Missing automation id' })

  const { db } = await connectToDatabase()

  let objectId: any = id
  try { objectId = new ObjectId(id) }
  catch { }

  const automation = await db.collection('turboCleanMonthlyAutomations').findOne({ _id: objectId })
  if (!automation)
    throw createError({ statusCode: 404, statusMessage: 'Automation not found' })

  await db.collection('turboCleanMonthlyAutomations').deleteOne({ _id: objectId })
  return { success: true, message: `Automation "${automation.name || id}" deleted. Previously generated invoices are kept.` }
})
