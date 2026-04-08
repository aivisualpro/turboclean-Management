import process from 'node:process'
import { MongoClient, ServerApiVersion } from 'mongodb'

// Setup global caching for MongoDB client
// Prevents connection exhaustion in both dev (HMR) and production (serverless warm starts)
declare global {
  // eslint-disable-next-line vars-on-top
  var _mongoClientPromise: Promise<MongoClient> | undefined
}

const uri = process.env.MONGODB_URI || 'mongodb+srv://admin_db_user:w3wD0fC2k0T9XjuU@cluster0.xjohmmi.mongodb.net/'

const options = {
  serverApi: {
    version: ServerApiVersion.v1,
    strict: true,
    deprecationErrors: true,
  },
  // Serverless-friendly timeouts
  serverSelectionTimeoutMS: 10000,
  connectTimeoutMS: 10000,
}

function getClientPromise(): Promise<MongoClient> {
  // Use global cache in ALL environments to reuse connections
  // across Vercel warm invocations and dev HMR reloads
  if (!globalThis._mongoClientPromise) {
    const client = new MongoClient(uri, options)
    globalThis._mongoClientPromise = client.connect().catch((err) => {
      // Reset the cache so the next request retries
      globalThis._mongoClientPromise = undefined
      throw err
    })
  }
  return globalThis._mongoClientPromise
}

let _indexesEnsured = false

export async function connectToDatabase() {
  const resolvedClient = await getClientPromise()
  const db = resolvedClient.db('turboClean')

  // Ensure indexes once per process startup (idempotent, no-ops if already exist)
  if (!_indexesEnsured) {
    _indexesEnsured = true
    try {
      const invoices = db.collection('turboCleanInvoices')
      await Promise.all([
        invoices.createIndex({ dealerId: 1, date: -1 }),
        invoices.createIndex({ status: 1, type: 1 }),
        invoices.createIndex({ date: -1 }),
        invoices.createIndex({ dealerName: 1 }),
        invoices.createIndex({ number: 1 }),
      ])
    } catch (e) {
      console.warn('[MongoDB] Index creation skipped:', e)
    }
  }

  return { db, client: resolvedClient }
}
