

export default defineEventHandler(async (event) => {
  try {
    const { db } = await connectToDatabase()
    const settingsCol = db.collection('settings')
    
    let settings: any = await settingsCol.findOne({ type: 'general' })
    if (!settings) {
      const newSettings = {
        type: 'general',
        automations: {
          dailyInvoiceEmail: {
            enabled: false,
            time: '17:00',
            timezone: 'America/New_York'
          },
          weeklyInvoiceEmail: {
            enabled: false,
            day: 'Friday',
            time: '17:00',
            timezone: 'America/New_York'
          }
        },
        createdAt: new Date(),
        updatedAt: new Date()
      }
      const result = await settingsCol.insertOne(newSettings)
      settings = { ...newSettings, _id: result.insertedId }
    }

    return { success: true, settings }
  } catch (error: any) {
    console.error('Fetch Settings Error:', error)
    return { success: false, error: error.message }
  }
})
