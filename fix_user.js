const { MongoClient } = require('mongodb');

async function fix() {
  const uri = 'mongodb+srv://shamsturboclean_db_user:hbgsYPMDLe8p@cluster0.xoavnc.mongodb.net/';
  const client = new MongoClient(uri);
  try {
    await client.connect();
    const db = client.db('turboClean');
    // Find Litchfield Ford
    const dealer = await db.collection('turboCleanDealers').findOne({ dealer: /Litchfield/i });
    if (!dealer) {
      console.log('Dealer not found');
      return;
    }
    const dealerId = dealer._id.toString();
    console.log('Litchfield Ford ID:', dealerId);

    // Update Adeel (he is the admin, his email is likely adeeljabbar@...)
    // Let's just append to all users who have a registerDealers array just to be safe
    const result = await db.collection('turboCleanAppUsers').updateMany(
      { registerDealers: { $exists: true } },
      { $addToSet: { registerDealers: dealerId } }
    );
    console.log('Updated users:', result.modifiedCount);
  } finally {
    await client.close();
  }
}
fix().catch(console.error);
