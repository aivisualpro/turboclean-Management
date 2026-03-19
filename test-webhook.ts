import { connectToDatabase } from './server/utils/mongodb';
import { ObjectId } from 'mongodb';

async function main() {
  const { db } = await connectToDatabase();
  console.log("Setting to true...");
  
  const res = await fetch("http://localhost:3000/api/dealers/699b1f1de586aba4c8f0db03", {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ isTaxApplied: true, taxPercentage: 7.7 })
  });
  console.log("Patch status:", res.status);
  
  let count = 0;
  setInterval(async () => {
    const doc = await db.collection('turboCleanDealers').findOne({ _id: new ObjectId("699b1f1de586aba4c8f0db03") });
    console.log(`[${count}s] isTaxApplied:`, doc?.isTaxApplied, 'taxPercentage:', doc?.taxPercentage);
    count++;
    if(count > 15) process.exit(0);
  }, 1000);
}
main();
