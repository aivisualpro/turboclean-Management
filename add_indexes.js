require('dotenv').config();
const { MongoClient } = require('mongodb');

async function run() {
  const client = new MongoClient(process.env.MONGODB_URI);
  await client.connect();
  const db = client.db();
  
  console.log("Creating indexes for turboCleanInvoices...");
  await db.collection('turboCleanInvoices').createIndex({ date: -1 });
  await db.collection('turboCleanInvoices').createIndex({ dealerId: 1, date: -1 });
  await db.collection('turboCleanInvoices').createIndex({ _id: 1, date: -1 });
  await db.collection('turboCleanInvoices').createIndex({ "dealerName": "text", "number": "text" }); 
  
  console.log("Creating indexes for turboCleanWorkOrders...");
  await db.collection('turboCleanWorkOrders').createIndex({ date: -1 });
  await db.collection('turboCleanWorkOrders').createIndex({ dealerId: 1, date: -1 });

  console.log("Done");
  process.exit(0);
}
run().catch(console.error);
