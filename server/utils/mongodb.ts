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

    // Unique emails for app users (case-insensitive, ignores blank/missing emails).
    // This is the DB-level backstop; the API handlers also check and return a 409.
    try {
      await db.collection('turboCleanAppUsers').createIndex(
        { email: 1 },
        {
          name: 'uniq_email_ci',
          unique: true,
          collation: { locale: 'en', strength: 2 },
          partialFilterExpression: { email: { $gt: '' } },
        },
      )
    } catch (e: any) {
      console.warn('[MongoDB] Could not create unique email index — most likely the App Users collection already contains duplicate emails. Clean them up and restart. Details:', e?.message)
    }

    // Indexes for the AppSheet sync outbox (see server/utils/appsheet-sync.ts).
    // Done entries auto-expire after 7 days; superseded/dead after 30 days.
    try {
      const outbox = db.collection('turboCleanSyncOutbox')
      await Promise.all([
        outbox.createIndex({ status: 1, nextAttemptAt: 1 }),
        outbox.createIndex({ table: 1, rowKey: 1, createdAt: -1 }),
        outbox.createIndex({ doneAt: 1 }, { expireAfterSeconds: 7 * 24 * 3600 }),
        outbox.createIndex(
          { createdAt: 1 },
          {
            name: 'ttl_finished_entries',
            expireAfterSeconds: 30 * 24 * 3600,
            partialFilterExpression: { status: { $eq: 'dead' } },
          },
        ),
        outbox.createIndex(
          { supersededAt: 1 },
          { expireAfterSeconds: 24 * 3600 },
        ),
      ])
    } catch (e: any) {
      console.warn('[MongoDB] Sync outbox index creation skipped:', e?.message)
    }
  }

  return { db, client: resolvedClient }
}
