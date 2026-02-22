import { MongoClient } from 'mongodb'
import process from 'node:process'

let client: MongoClient | null = null

export async function connectToDatabase() {
  const uri = process.env.MONGODB_URI || 'mongodb+srv://admin_db_user:w3wD0fC2k0T9XjuU@cluster0.xjohmmi.mongodb.net/'
  
  if (!client) {
    client = new MongoClient(uri)
    await client.connect()
  }
  
  const db = client.db('turboClean')
  return { db, client }
}
