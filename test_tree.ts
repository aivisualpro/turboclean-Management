import { connectToDatabase } from './server/utils/mongodb'
import { ObjectId } from 'mongodb'

async function main() {
    console.log("connecting...");
    const { db } = await connectToDatabase();
    console.log("connected.");
    
    // Test logic for yesterday (April 1st, given today is April 2nd in the prompt)
    const matchQuery = { date: { $gte: new Date('2026-04-01T00:00:00.000Z'), $lte: new Date('2026-04-01T23:59:59.999Z') } };
    
    console.log("Finding raw work orders with:", matchQuery);
    const raw = await db.collection('turboCleanWorkOrders').find(matchQuery).limit(5).toArray();
    console.log("Raw items:", raw.length);
    if(raw.length > 0) {
        console.log("Sample date:", raw[0].date, raw[0].date instanceof Date ? 'Date Object' : typeof raw[0].date);
    }
    
    console.log("Running aggregation pipeline...");
    const pipeline = [
      { $match: matchQuery },
      {
        $group: {
          _id: {
            dealer: "$dealer",
            date: { $dateToString: { format: "%Y-%m-%d", date: "$date", timezone: "UTC" } }
          },
          totalAmount: { $sum: { $toDouble: "$total" } }
        }
      }
    ];
    
    try {
        const aggregated = await db.collection('turboCleanWorkOrders').aggregate(pipeline).toArray();
        console.log("Aggregated result length:", aggregated.length);
        if (aggregated.length > 0) {
             console.log("Aggregated[0]:", aggregated[0]);
        }
    } catch(e) {
        console.error("Aggregation failed:", e);
    }
    
    process.exit(0);
}
main();
