import { connectToDatabase } from '../utils/mongodb'

export default defineEventHandler(async (event) => {
  try {
    const { client } = await connectToDatabase()
    const dbs = await client.db().admin().listDatabases()
    
    // Check counts in both Pascal and Lowercase if they exist
    const results: any = {}
    
    for (const name of ['turboClean', 'turboclean']) {
      try {
        const db = client.db(name)
        const collections = await db.listCollections().toArray()
        const colNames = collections.map((c: any) => c.name)
        
        results[name] = {
          exists: true,
          collections: colNames,
          counts: {}
        }
        
        if (colNames.includes('turboCleanDealers')) {
          results[name].counts.dealers = await db.collection('turboCleanDealers').countDocuments()
          results[name].counts.litchfield = await db.collection('turboCleanDealers').countDocuments({ dealer: /Litchfield/i })
        }
        if (colNames.includes('turboCleanAppUsers')) {
          results[name].counts.users = await db.collection('turboCleanAppUsers').countDocuments()
        }
      } catch (e: any) {
        results[name] = { exists: false, error: e.message }
      }
    }
    
    return {
      allDbs: dbs.databases.map((d: any) => d.name),
      inspection: results
    }
  } catch (err: any) {
    return { error: err.message }
  }
})
