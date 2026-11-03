import {
  CONTACT_METHODS, CONTACT_ROLES, CRM_COLLECTIONS, actorFromSession, diffFields, getCrmDb,
  logActivity, normalizeEmail, serializeContact, str, toObjectId,
} from '../../../../../../utils/crm'
import { getUserSession } from '../../../../../../utils/auth'
import { duplicateContactError, findContactDuplicates } from '../../../../../../utils/crm-duplicates'
import { normalizePhone } from '../../../../../../utils/crm-normalize'

/**
 * PATCH /api/crm/dealerships/:id/contacts/:contactId
 * Edits a contact in place. Deactivation is a state change that keeps the
 * record (and its history) intact — there is intentionally no DELETE route.
 */
export default defineEventHandler(async (event) => {
  const dealershipId = getRouterParam(event, 'id')!
  const contactId = getRouterParam(event, 'contactId')!
  const session = await getUserSession(event)
  const body = await readBody(event) || {}
  const db = await getCrmDb()
  const contacts = db.collection(CRM_COLLECTIONS.contacts)
  const before = await contacts.findOne({ _id: toObjectId(contactId), dealershipId })
  if (!before) throw createError({ statusCode: 404, statusMessage: 'Contact not found' })

  const $set: Record<string, any> = {}
  if ('firstName' in body) $set.firstName = str(body.firstName, 80)
  if ('lastName' in body) $set.lastName = str(body.lastName, 80)
  if (('firstName' in body || 'lastName' in body) && !($set.firstName ?? before.firstName) && !($set.lastName ?? before.lastName))
    throw createError({ statusCode: 400, statusMessage: 'Contact name is required' })
  if ('role' in body) $set.role = CONTACT_ROLES.includes(body.role) ? body.role : 'Other'
  if ('jobTitle' in body) $set.jobTitle = str(body.jobTitle, 120)
  if ('email' in body) $set.email = normalizeEmail(body.email)
  if ('phone' in body) $set.phone = normalizePhone(body.phone)
  if ('mobile' in body) $set.mobile = normalizePhone(body.mobile)
  if ($set.email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test($set.email)) throw createError({ statusCode: 400, statusMessage: 'That email address does not look valid' })
  if ('preferredContactMethod' in body) $set.preferredContactMethod = CONTACT_METHODS.includes(body.preferredContactMethod) ? body.preferredContactMethod : before.preferredContactMethod
  if ('notes' in body) $set.notes = str(body.notes, 4000)
  if ('isPrimary' in body) $set.isPrimary = !!body.isPrimary
  if (body.verified === true) $set.lastVerifiedAt = new Date().toISOString()

  let statusEvent: 'contact.deactivated' | 'contact.reactivated' | null = null
  if (typeof body.isActive === 'boolean' && body.isActive !== before.isActive) {
    $set.isActive = body.isActive
    if (!body.isActive) {
      $set.inactiveAt = new Date().toISOString()
      $set.inactiveReason = str(body.inactiveReason, 300)
      $set.isPrimary = false
      statusEvent = 'contact.deactivated'
    } else {
      $set.inactiveAt = null
      $set.inactiveReason = ''
      $set.succeededById = null
      statusEvent = 'contact.reactivated'
    }
  }
  if (before.isActive === false && $set.isActive !== true && $set.isPrimary) $set.isPrimary = false

  if (!body.allowDuplicate && ['email', 'phone', 'mobile', 'firstName', 'lastName'].some(k => k in $set && $set[k] && $set[k] !== before[k])) {
    const dups = await findContactDuplicates(db, dealershipId, { ...before, ...$set }, contactId)
    if (dups.length) throw duplicateContactError(dups)
  }
  $set.updatedAt = new Date().toISOString()
  if ($set.isPrimary) await contacts.updateMany({ dealershipId, isPrimary: true, _id: { $ne: before._id } }, { $set: { isPrimary: false } })
  await contacts.updateOne({ _id: before._id }, { $set })
  const after = await contacts.findOne({ _id: before._id })

  const actor = actorFromSession(session)
  const who = `${after!.firstName} ${after!.lastName}`.trim()
  if (statusEvent) {
    await logActivity(db, { dealershipId, contactId, type: statusEvent, actor,
      message: statusEvent === 'contact.deactivated' ? `${who} marked inactive${$set.inactiveReason ? ` — ${$set.inactiveReason}` : ''}` : `${who} reactivated` })
  } else if (body.verified === true && Object.keys($set).length === 2) {
    await logActivity(db, { dealershipId, contactId, type: 'contact.verified', message: `${who}'s details verified`, actor })
  } else {
    const changes = diffFields(before, after, ['firstName', 'lastName', 'role', 'jobTitle', 'email', 'phone', 'mobile', 'preferredContactMethod', 'isPrimary', 'notes'])
    if (Object.keys(changes).length)
      await logActivity(db, { dealershipId, contactId, type: 'contact.updated', message: `Updated ${who}: ${Object.keys(changes).join(', ')}`, changes, actor })
  }
  await db.collection(CRM_COLLECTIONS.dealerships).updateOne({ _id: toObjectId(dealershipId) }, { $set: { updatedAt: new Date().toISOString() } })
  return { contact: serializeContact(after) }
})
