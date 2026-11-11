/**
 * Small binary files for the CRM, stored in MongoDB:
 *  - audit evidence screenshots (uploaded by a person), and
 *  - listing pictures: a small copy of the photo a flagged vehicle showed on the dealer's site
 *    when it was audited (purpose "audit-listing"), shown as evidence in emails.
 * Kept deliberately small (≤ 2 MB images) because they are embedded inline in emails.
 */
import { Binary, ObjectId } from 'mongodb'
import type { Db } from 'mongodb'
import type { SessionActor } from './crm'

export const FILES_COLLECTION = 'turboCleanCrmFiles'
const MAX_BYTES = 2 * 1024 * 1024
const TYPES = ['image/png', 'image/jpeg', 'image/webp', 'image/gif']

export async function saveDataUrl(db: Db, input: { dataUrl: string, filename?: string, dealershipId?: string, purpose?: string }, actor: SessionActor | null) {
  const m = String(input.dataUrl || '').match(/^data:([\w/+.-]+);base64,(.+)$/)
  if (!m) throw createError({ statusCode: 400, statusMessage: 'Expected an image (data URL)' })
  const contentType = m[1]!.toLowerCase()
  if (!TYPES.includes(contentType)) throw createError({ statusCode: 400, statusMessage: 'Only PNG, JPEG, WebP or GIF images are allowed' })
  const buf = Buffer.from(m[2]!, 'base64')
  if (buf.length > MAX_BYTES) throw createError({ statusCode: 413, statusMessage: 'Image is larger than 2 MB — crop or compress it first' })
  const ext = contentType.split('/')[1]!.replace('jpeg', 'jpg')
  const doc = {
    filename: String(input.filename || `image.${ext}`).replace(/[^\w.\- ]+/g, '_').slice(0, 120),
    contentType, size: buf.length, data: new Binary(buf),
    dealershipId: input.dealershipId || null, purpose: input.purpose || 'audit-screenshot',
    createdBy: actor ? { id: actor.id, name: actor.name } : null, createdAt: new Date().toISOString(),
  }
  const res = await db.collection(FILES_COLLECTION).insertOne(doc)
  return { id: res.insertedId.toString(), filename: doc.filename, contentType, size: doc.size }
}

export async function getFile(db: Db, id: string) {
  if (!ObjectId.isValid(id)) return null
  const f = await db.collection(FILES_COLLECTION).findOne({ _id: new ObjectId(id) })
  if (!f) return null
  const data: Buffer = f.data?.buffer ? Buffer.from(f.data.buffer) : Buffer.from(f.data)
  return { filename: f.filename as string, contentType: f.contentType as string, data }
}

/** Store a small JPEG that is already in memory (base64, no data-URL prefix). Returns the file id, or null when it is not usable. */
export async function saveListingPicture(db: Db, input: { b64: string, dealershipId: string, sourceUrl?: string, w?: number, h?: number }) {
  const buf = Buffer.from(String(input.b64 || ''), 'base64')
  // JPEG magic bytes — never store something that is not the picture we made.
  if (buf.length < 200 || buf.length > 400_000 || buf[0] !== 0xFF || buf[1] !== 0xD8) return null
  const res = await db.collection(FILES_COLLECTION).insertOne({
    filename: 'listing.jpg', contentType: 'image/jpeg', size: buf.length, data: new Binary(buf),
    dealershipId: input.dealershipId, purpose: 'audit-listing', sourceUrl: String(input.sourceUrl || '').slice(0, 1000), w: input.w || null, h: input.h || null,
    createdBy: null, createdAt: new Date().toISOString(),
  })
  return res.insertedId.toString()
}

/**
 * Listing pictures are only worth keeping while something shows them: the dealership's current
 * audit (`keep`) or an email that was sent with them. Everything else for this dealership is removed,
 * so the store holds roughly one small set of pictures per dealership.
 */
export async function pruneListingPictures(db: Db, dealershipId: string, keep: string[]) {
  const files = await db.collection(FILES_COLLECTION).find({ dealershipId, purpose: 'audit-listing' }, { projection: { _id: 1 } }).toArray()
  const keepSet = new Set(keep.map(String))
  const candidates = files.map(f => f._id.toString()).filter(id => !keepSet.has(id))
  if (!candidates.length) return 0
  const used = await db.collection('turboCleanCrmEmails').find({ 'inlineFiles.fileId': { $in: candidates } }, { projection: { inlineFiles: 1 } }).toArray()
  const sent = new Set(used.flatMap((e: any) => (e.inlineFiles || []).map((f: any) => String(f.fileId))))
  const drop = candidates.filter(id => !sent.has(id))
  if (drop.length) await db.collection(FILES_COLLECTION).deleteMany({ _id: { $in: drop.map(id => new ObjectId(id)) }, purpose: 'audit-listing' })
  return drop.length
}
