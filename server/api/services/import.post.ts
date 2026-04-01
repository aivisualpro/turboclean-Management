import { connectToDatabase } from '../../utils/mongodb'
import { appSheetAdd } from '../../utils/appsheet'
import { ServicesMapper } from '../../utils/sync-mapper'

export default defineEventHandler(async (event) => {
  try {
    let parsedBody;
    if ((event.node.req as any).body) {
      parsedBody = typeof (event.node.req as any).body === 'string' 
        ? JSON.parse((event.node.req as any).body) 
        : (event.node.req as any).body;
    } else {
      const rawBody = await new Promise<string>((resolve, reject) => {
        let data = ''
        event.node.req.on('data', chunk => { data += chunk })
        event.node.req.on('end', () => resolve(data))
        event.node.req.on('error', reject)
      })
      parsedBody = JSON.parse(rawBody)
    }
    const { services } = parsedBody;
    
    if (!services || !Array.isArray(services)) {
      throw createError({ statusCode: 400, statusMessage: 'Invalid or missing services array' })
    }

    const { db } = await connectToDatabase()
    const collection = db.collection('turboCleanServices')

    // Map frontend Service payload to turboCleanServices schema
    const servicesToInsert = services.map((s: any) => ({
      service: s.service || 'Unknown Service',
      description: s.description || '',
      createdAt: new Date(),
      updatedAt: new Date(),
    }))

    if (servicesToInsert.length > 0) {
      const result = await collection.insertMany(servicesToInsert)
      
      // ── Sync to AppSheet ──
      const insertedIds = Object.values(result.insertedIds)
      const appSheetRows = servicesToInsert.map((doc: any, i: number) =>
        ServicesMapper.toAppSheet({ ...doc, _id: insertedIds[i] })
      )
      appSheetAdd('Services', appSheetRows).catch(err =>
        console.error('[Sync] Failed to add services to AppSheet:', err)
      )
    }

    return {
      success: true,
      count: servicesToInsert.length
    }
  } catch (error: any) {
    console.error('Error importing services:', error)
    throw createError({
      statusCode: 500,
      statusMessage: error.message || 'Failed to import services'
    })
  }
})
