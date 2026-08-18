import { connectToDatabase } from '../../utils/mongodb'
import { ObjectId } from 'mongodb'
import { AppUsersMapper } from '../../utils/sync-mapper'
import { syncToAppSheet } from '../../utils/appsheet-sync'

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

export default defineEventHandler(async (event) => {
  try {
    const id = getRouterParam(event, 'id')
    if (!id || id.length !== 24) {
      throw createError({ statusCode: 400, statusMessage: 'Invalid user ID' })
    }
    const body = await readBody(event)
    const { db } = await connectToDatabase()
    const users = db.collection('turboCleanAppUsers')

    const email = typeof body.email === 'string' ? body.email.trim() : undefined
    if (email && !EMAIL_RE.test(email)) {
      throw createError({ statusCode: 400, statusMessage: 'Please enter a valid email address' })
    }

    // ── Enforce unique emails (case-insensitive), excluding this user ──
    if (email) {
      const escaped = email.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
      const existing = await users.findOne(
        { _id: { $ne: new ObjectId(id) }, email: { $regex: new RegExp(`^${escaped}$`, 'i') } },
        { projection: { _id: 1, name: 1 } },
      )
      if (existing) {
        throw createError({ statusCode: 409, statusMessage: 'Another user with this email already exists' })
      }
    }

    const updateDoc: Record<string, any> = {
      name: typeof body.name === 'string' ? body.name.trim() : undefined,
      email,
      phone: body.phone,
      address: body.address,
      registerDealers: Array.isArray(body.registerDealers) ? body.registerDealers : undefined,
      role: body.role,
      status: body.status,
      // An empty password means "keep the current one" (matches the form hint)
      password: body.password ? body.password : undefined,
      workspaceId: body.workspaceId,
      updatedAt: new Date(),
      lastUpdatedBy: 'web-ui',
    }

    // Remove undefined fields
    Object.keys(updateDoc).forEach(key => updateDoc[key] === undefined && delete updateDoc[key])

    let updateResult
    try {
      updateResult = await users.updateOne(
        { _id: new ObjectId(id) },
        { $set: updateDoc }
      )
    } catch (e: any) {
      // Unique index backstop (covers races between the check and the write)
      if (e?.code === 11000) {
        throw createError({ statusCode: 409, statusMessage: 'Another user with this email already exists' })
      }
      throw e
    }

    if (updateResult.matchedCount === 0) {
      throw createError({ statusCode: 404, statusMessage: 'User not found' })
    }

    // ── Sync to AppSheet: Edit only the changed columns; the full row is used
    //    only if the row is missing in AppSheet and must be re-created.
    //    Outbox-backed: auto-retried in the background if AppSheet is unreachable. ──
    const appSheetRow: Record<string, any> = { _id: id }
    if (updateDoc.name !== undefined) appSheetRow.name = updateDoc.name
    if (updateDoc.email !== undefined) appSheetRow.email = updateDoc.email
    if (updateDoc.phone !== undefined) appSheetRow.phone = updateDoc.phone
    if (updateDoc.address !== undefined) appSheetRow.address = updateDoc.address
    if (updateDoc.role !== undefined) appSheetRow.role = updateDoc.role
    if (updateDoc.status !== undefined) appSheetRow.status = updateDoc.status
    if (updateDoc.password !== undefined) appSheetRow.password = updateDoc.password
    if (updateDoc.registerDealers !== undefined) {
      appSheetRow.registerDealers = updateDoc.registerDealers.length
        ? updateDoc.registerDealers.join(' , ')
        : ''
    }

    const updated = await users.findOne({ _id: new ObjectId(id) })
    const appSheet = (updated && Object.keys(appSheetRow).length > 1)
      ? await syncToAppSheet(db, 'AppUsers', 'Upsert', [appSheetRow], {
          addRows: [AppUsersMapper.toAppSheet(updated)],
        })
      : { ok: true, queued: false }

    return { success: true, appSheet }
  } catch (error: any) {
    if (error?.statusCode) throw error
    throw createError({ statusCode: 500, statusMessage: error.message })
  }
})
