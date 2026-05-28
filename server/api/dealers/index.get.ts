import { connectToDatabase } from '../../utils/mongodb'
import { nanoid } from 'nanoid'
import { getUserSession } from '../../utils/auth'
import { ObjectId } from 'mongodb'

export default defineEventHandler(async (event) => {
  try {
    const session = await getUserSession(event)
    const { db } = await connectToDatabase()
    const collection = db.collection('turboCleanDealers')

    // DEBUG: Log the database name actually being used
    // @ts-ignore
    const dbName = db.databaseName || db.s?.namespace?.db || 'unknown'
    console.log(`[DEALERS GET] Connecting to DB: ${dbName}`)

    let query: any = {}
    const isAdmin = session?.role === 'Admin'

    // If restricted user, filter to only those in registerDealers
    if (!isAdmin && session && session.registerDealers && session.registerDealers.length > 0) {
      const allowedIds = session.registerDealers.reduce((acc: any[], id: string) => {
        try { acc.push(new ObjectId(id)); return acc } catch { return acc }
      }, [])
      
      if (allowedIds.length === 0) return { dealers: [], meta: { totalCount: 0, totalDbCount: 0, isFiltered: true } }
      query = { _id: { $in: allowedIds } }
    } 
    // If not admin and no registerDealers, they see nothing
    else if (!isAdmin && (!session || !session.registerDealers || session.registerDealers.length === 0)) {
      return { dealers: [], meta: { totalCount: 0, totalDbCount: 0, isFiltered: true } }
    }

    const docs = await collection.find(query).sort({ dealer: 1 }).toArray()
    const totalCount = await collection.countDocuments(query)
    const totalDbCount = await collection.countDocuments({})

    const firstThree = docs.slice(0, 3).map(d => d.dealer).join(', ')
    console.log(`[DEALERS GET] Found ${docs.length} dealers for user ${session?.email || 'unknown'} (Role: ${session?.role || 'None'}). First 3: [${firstThree}]. Filter query: ${JSON.stringify(query)}. Total count: ${totalCount}. Total DB records: ${totalDbCount}`)

    // ── Build a global id → name map for turboCleanServices so we can
    // denormalize service names across every dealer's services subdoc. ──
    const allServiceIds = new Set<string>()
    for (const doc of docs) {
      if (Array.isArray(doc.services)) {
        for (const s of doc.services) {
          if (typeof s?.service === 'string' && s.service) allServiceIds.add(s.service)
        }
      }
    }

    const serviceNameMap = new Map<string, string>()
    if (allServiceIds.size > 0) {
      const objectIds = Array.from(allServiceIds)
        .filter(sid => ObjectId.isValid(sid))
        .map(sid => new ObjectId(sid))

      if (objectIds.length > 0) {
        const svcDocs = await db
          .collection('turboCleanServices')
          .find({ _id: { $in: objectIds } }, { projection: { service: 1 } })
          .toArray()
        for (const sd of svcDocs) {
          serviceNameMap.set(sd._id.toString(), sd.service || '')
        }
      }
    }

    return {
      dealers: docs.map(doc => {
        const enrichedServices = Array.isArray(doc.services)
          ? doc.services.map((s: any) => ({
              ...s,
              serviceName: serviceNameMap.get(s.service) || s.serviceName || ''
            }))
          : []

        return {
          id: doc._id.toString(),
          dealerName: doc.dealer || '',
          address: doc.address || '',
          contacts: Array.isArray(doc.contacts) && doc.contacts.length > 0 ? doc.contacts : [{
            id: nanoid(8),
            name: 'Primary Contact',
            designation: '',
            phones: doc.phone ? [{ id: nanoid(6), number: doc.phone, type: 'mobile' }] : [],
            emails: doc.email ? [doc.email] : [],
            preferredContactMethod: 'any'
          }],
          status: doc.status || 'Pending',
          isTaxApplied: doc.isTaxApplied === true || doc.isTaxApplied === 'Y' || doc.isTaxApplied === 'true',
          taxPercentage: Number(doc.taxPercentage) || 0,
          services: [...enrichedServices].sort((a, b) =>
            (a.serviceName || a.service || '').localeCompare(b.serviceName || b.service || '')
          ),
          createdAt: doc.createdAt?.toISOString() || doc._id.getTimestamp().toISOString(),
          updatedAt: doc.updatedAt?.toISOString() || doc._id.getTimestamp().toISOString(),
          notes: doc.notes || ''
        }
      }),
      meta: {
        totalCount,
        totalDbCount,
        isFiltered: Object.keys(query).length > 0
      }
    }
  } catch (error: any) {
    console.error('Error fetching dealers:', error)
    throw createError({
      statusCode: 500,
      statusMessage: 'Failed to fetch dealers'
    })
  }
})
