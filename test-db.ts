import { connectToDatabase } from './server/utils/mongodb';
import { ObjectId } from 'mongodb';

async function main() {
  const { db } = await connectToDatabase();
  const doc = await db.collection('turboCleanDealers').findOne({ _id: new ObjectId("699b1f1de586aba4c8f0db03") });
  console.log("DB EXACT VALUE:", doc?.isTaxApplied, typeof doc?.isTaxApplied);
  process.exit(0);
}
main();
