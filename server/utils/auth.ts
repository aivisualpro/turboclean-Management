import { Buffer } from 'node:buffer'
import { createHash, createHmac, timingSafeEqual } from 'node:crypto'
import process from 'node:process'
import { connectToDatabase } from './mongodb'
import { ObjectId } from 'mongodb'
import { getCookie } from 'h3'

/**
 * Login sessions — the `turbo_session` cookie is `<payload>.<signature>`: base64url JSON
 * { userId, email, name, role, iat } plus an HMAC-SHA256 made with NUXT_SESSION_PASSWORD.
 * A cookie that was edited or made up (or an old unsigned one) is rejected → sign in again.
 */
export const SESSION_COOKIE = 'turbo_session'
export const SESSION_MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000

let warned = false
function sessionSecret() {
  const s = process.env.NUXT_SESSION_PASSWORD || ''
  if (s.length >= 32) return s
  if (!warned) { warned = true; console.warn('[auth] NUXT_SESSION_PASSWORD is missing or shorter than 32 characters — using a key derived from MONGODB_URI. Set NUXT_SESSION_PASSWORD.') }
  // Still server-only and stable, so logins keep working until the variable is set.
  return createHash('sha256').update(`zrz-session:${s}:${process.env.MONGODB_URI || ''}`).digest('hex')
}
const sign = (body: string) => createHmac('sha256', sessionSecret()).update(body).digest('base64url')

export function createSessionToken(user: { _id: any, email?: string, name?: string, role?: string }) {
  const body = Buffer.from(JSON.stringify({ userId: String(user._id), email: user.email || '', name: user.name || '', role: user.role || 'User', iat: Date.now() })).toString('base64url')
  return `${body}.${sign(body)}`
}

/** The signed payload, or null when the cookie is missing, tampered with, unsigned or expired. */
export function readSessionToken(token: string | undefined | null): { userId: string, email: string, name: string, role: string, iat: number } | null {
  if (!token) return null
  const dot = token.lastIndexOf('.')
  if (dot <= 0) return null
  const body = token.slice(0, dot)
  const got = Buffer.from(token.slice(dot + 1))
  const want = Buffer.from(sign(body))
  if (got.length !== want.length || !timingSafeEqual(got, want)) return null
  try {
    const p = JSON.parse(Buffer.from(body, 'base64url').toString('utf-8'))
    if (!p?.userId || !ObjectId.isValid(String(p.userId))) return null
    if (!Number.isFinite(p.iat) || Date.now() - p.iat > SESSION_MAX_AGE_MS) return null
    return p
  } catch { return null }
}

export async function getUserSession(event: any) {
  // One lookup per request (the API guard and the route both ask).
  if (event?.context && '__session' in event.context) return event.context.__session
  const session = await loadSession(event)
  if (event?.context) event.context.__session = session
  return session
}

async function loadSession(event: any) {
  const payload = readSessionToken(getCookie(event, SESSION_COOKIE))
  if (!payload) return null
  try {
    const { db } = await connectToDatabase()
    const dbUser = await db.collection('turboCleanAppUsers').findOne({ _id: new ObjectId(payload.userId) })
    if (!dbUser) return null
    if (dbUser.status && String(dbUser.status).toLowerCase() !== 'active') return null
    return {
      id: dbUser._id.toString(),
      name: dbUser.name || payload.name,
      email: dbUser.email || payload.email,
      role: dbUser.role || payload.role,
      registerDealers: dbUser.registerDealers || [],
    }
  } catch { return null }
}
