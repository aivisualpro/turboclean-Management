/**
 * Small binary files for the CRM (audit evidence screenshots), stored in MongoDB.
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
