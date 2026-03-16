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

export async function connectToDatabase() {
  const resolvedClient = await getClientPromise()
  const db = resolvedClient.db('turboClean')
  return { db, client: resolvedClient }
}
