import { ObjectId } from 'mongodb'
import { CRM_COLLECTIONS, actorFromSession, buildContactDoc, getCrmDb, logActivity, serializeContact, str, toObjectId } from '../../../../../../utils/crm'
import { getUserSession } from '../../../../../../utils/auth'

/**
 * POST /api/crm/dealerships/:id/contacts/:contactId/handover
 * The "manager left" flow in one atomic intent: the outgoing contact is marked
 * inactive (history preserved, linked forward) and the successor is created
 * in the same role, linked back. Nothing is deleted or overwritten.
 */
export default defineEventHandler(async (event) => {
  const dealershipId = getRouterParam(event, 'id')!
  const contactId = getRouterParam(event, 'contactId')!
  const session = await getUserSession(event)
  const body = await readBody(event) || {}
  const db = await getCrmDb()
  const contacts = db.collection(CRM_COLLECTIONS.contacts)
  const outgoing = await contacts.findOne({ _id: toObjectId(contactId), dealershipId })
  if (!outgoing) throw createError({ statusCode: 404, statusMessage: 'Contact not found' })

  const actor = actorFromSession(session)
  const successorInput = { role: outgoing.role, jobTitle: outgoing.jobTitle, isPrimary: outgoing.isPrimary, ...(body.successor || {}), precededById: contactId }
  const successor = buildContactDoc(successorInput, dealershipId, actor)
  const successorId = new ObjectId()
  const now = new Date().toISOString()

  if (successor.isPrimary) await contacts.updateMany({ dealershipId, isPrimary: true }, { $set: { isPrimary: false } })
  await contacts.insertOne({ _id: successorId, ...successor })
  await contacts.updateOne({ _id: outgoing._id }, { $set: {
    isActive: false, isPrimary: false, inactiveAt: now, updatedAt: now,
    inactiveReason: str(body.reason, 300) || 'Left the dealership',
    succeededById: successorId.toString(),
  } })

  const outName = `${outgoing.firstName} ${outgoing.lastName}`.trim()
  const inName = `${successor.firstName} ${successor.lastName}`.trim()
  await logActivity(db, { dealershipId, contactId, type: 'contact.handover', actor,
    message: `${outName} handed over ${outgoing.jobTitle || outgoing.role} to ${inName}`,
    changes: { successor: { from: outName, to: inName }, reason: { from: null, to: str(body.reason, 300) || 'Left the dealership' } } })
  await db.collection(CRM_COLLECTIONS.dealerships).updateOne({ _id: toObjectId(dealershipId) }, { $set: { updatedAt: now } })

  const [o, s] = await Promise.all([contacts.findOne({ _id: outgoing._id }), contacts.findOne({ _id: successorId })])
  return { outgoing: serializeContact(o), successor: serializeContact(s) }
})
