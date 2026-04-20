const { MongoClient } = require('mongodb');
async function run() {
  const uri = process.env.MONGODB_URI || 'mongodb+srv://admin_db_user:w3wD0fC2k0T9XjuU@cluster0.xjohmmi.mongodb.net/';
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
