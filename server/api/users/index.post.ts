import { connectToDatabase } from '../../utils/mongodb'
import { AppUsersMapper } from '../../utils/sync-mapper'
import { syncToAppSheet } from '../../utils/appsheet-sync'

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

export default defineEventHandler(async (event) => {
  try {
    const body = await readBody(event)
    const { db } = await connectToDatabase()
    const users = db.collection('turboCleanAppUsers')

    const name = typeof body.name === 'string' ? body.name.trim() : ''
    const email = typeof body.email === 'string' ? body.email.trim() : ''

    if (!name) {
      throw createError({ statusCode: 400, statusMessage: 'Name is required' })
    }
    if (email && !EMAIL_RE.test(email)) {
      throw createError({ statusCode: 400, statusMessage: 'Please enter a valid email address' })
    }

    // ── Enforce unique emails (case-insensitive) ──
    if (email) {
      const escaped = email.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
      const existing = await users.findOne(
        { email: { $regex: new RegExp(`^${escaped}$`, 'i') } },
        { projection: { _id: 1, name: 1 } },
      )
      if (existing) {
        throw createError({ statusCode: 409, statusMessage: 'A user with this email already exists' })
      }
    }

    const doc = {
      name,
      email,
      phone: body.phone || '',
      address: body.address || '',
      registerDealers: Array.isArray(body.registerDealers) ? body.registerDealers : [],
      role: body.role || 'User',
      status: body.status || 'Active',
      password: body.password || '',
      workspaceId: body.workspaceId || '',
      createdAt: new Date(),
      updatedAt: new Date()
    }

    let result
    try {
      result = await users.insertOne(doc)
    } catch (e: any) {
      // Unique index backstop (covers races between the check and the insert)
      if (e?.code === 11000) {
        throw createError({ statusCode: 409, statusMessage: 'A user with this email already exists' })
      }
      throw e
    }

    // ── Sync to AppSheet (outbox-backed: auto-retried in the background on failure) ──
    const insertedDoc = { ...doc, _id: result.insertedId }
    const appSheet = await syncToAppSheet(db, 'AppUsers', 'Add', [AppUsersMapper.toAppSheet(insertedDoc)])

    return { success: true, id: result.insertedId.toString(), appSheet }
  } catch (error: any) {
    if (error?.statusCode) throw error
    throw createError({ statusCode: 500, statusMessage: error.message })
  }
})
