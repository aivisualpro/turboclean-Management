import { ObjectId } from 'mongodb'
import {
  CRM_COLLECTIONS, actorFromSession, buildContactDoc, getCrmDb,
  logActivity, serializeContact, toObjectId,
} from '../../../../../utils/crm'
import { getUserSession } from '../../../../../utils/auth'
import { duplicateContactError, findContactDuplicates } from '../../../../../utils/crm-duplicates'

/** POST /api/crm/dealerships/:id/contacts — add a person to the roster */
export default defineEventHandler(async (event) => {
  const dealershipId = getRouterParam(event, 'id')!
  const session = await getUserSession(event)
  const body = await readBody(event) || {}
  const db = await getCrmDb()
  const dealership = await db.collection(CRM_COLLECTIONS.dealerships).findOne({ _id: toObjectId(dealershipId) })
  if (!dealership) throw createError({ statusCode: 404, statusMessage: 'Dealership not found' })

  const actor = actorFromSession(session)
  const doc = buildContactDoc(body, dealershipId, actor)
  const contacts = db.collection(CRM_COLLECTIONS.contacts)
  if (!body.allowDuplicate) {
    const dups = await findContactDuplicates(db, dealershipId, doc)
    if (dups.length) throw duplicateContactError(dups)
  }

  if (doc.isPrimary) await contacts.updateMany({ dealershipId, isPrimary: true }, { $set: { isPrimary: false } })
  const res = await contacts.insertOne({ _id: new ObjectId(), ...doc })

  await logActivity(db, {
    dealershipId, contactId: res.insertedId.toString(), type: 'contact.added',
    message: `Added ${doc.firstName} ${doc.lastName} (${doc.jobTitle || doc.role})`, actor,
  })
  await db.collection(CRM_COLLECTIONS.dealerships).updateOne({ _id: dealership._id }, { $set: { updatedAt: new Date().toISOString() } })
  return { contact: serializeContact({ _id: res.insertedId, ...doc }) }
})
