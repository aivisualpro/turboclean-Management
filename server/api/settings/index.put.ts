

export default defineEventHandler(async (event) => {
  try {
    const body = await readBody(event)
    const { db } = await connectToDatabase()
    const settingsCol = db.collection('settings')

    await settingsCol.updateOne(
      { type: 'general' },
      { 
        $set: { 
          ...body,
          updatedAt: new Date()
        } 
      },
      { upsert: true }
    )

    const newSettings = await settingsCol.findOne({ type: 'general' })
    return { success: true, settings: newSettings }
  } catch (error: any) {
    console.error('Update Settings Error:', error)
    return { success: false, error: error.message }
  }
})
