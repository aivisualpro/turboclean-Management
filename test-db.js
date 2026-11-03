const { MongoClient } = require('mongodb');
async function run() {
  const uri = process.env.MONGODB_URI || 'mongodb+srv://shamsturboclean_db_user:hbgsYPMDLe8p@cluster0.xoavnc.mongodb.net/';
  const client = new MongoClient(uri);
  try {
    await client.connect();
    const db = client.db('turboClean');
    const invoiceCollection = db.collection('turboCleanInvoices');
    const existingInvoice = await invoiceCollection.findOne({ type: 'Weekly' });
    console.log("Weekly invoice:", existingInvoice);
    const dealerColl = db.collection('turboCleanDealers');
    const dealer = await dealerColl.findOne({});
    console.log("Dealer:", dealer);
  } finally {
    await client.close();
  }
}
run().catch(console.dir);
