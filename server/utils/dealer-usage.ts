/**
 * What depends on a dealer. A dealer with any of these cannot be deleted —
 * work orders and invoices are financial records, services are its price list.
 */
import { ObjectId } from 'mongodb'
import type { Db } from 'mongodb'

export interface DealerUsage { services: number, workOrders: number, invoices: number, total: number }

export async function getDealerUsage(db: Db, id: string, dealerDoc?: any): Promise<DealerUsage> {
  const keys: any[] = [id]
  if (ObjectId.isValid(id)) keys.push(new ObjectId(id))
  const doc = dealerDoc ?? await db.collection('turboCleanDealers').findOne({ _id: keys[1] ?? keys[0] }, { projection: { services: 1 } })
  const [workOrders, invoices] = await Promise.all([
    db.collection('turboCleanWorkOrders').countDocuments({ dealer: { $in: keys } }),
    db.collection('turboCleanInvoices').countDocuments({ dealerId: { $in: keys } }),
  ])
  const services = Array.isArray(doc?.services) ? doc.services.length : 0
  return { services, workOrders, invoices, total: services + workOrders + invoices }
}
