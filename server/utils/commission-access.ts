import { getUserSession } from './auth'

/** Commissions show contractor pay and company profit — admins only. */
export async function requireCommissionAdmin(event: any) {
  const session = await getUserSession(event)
  if (!session) throw createError({ statusCode: 401, statusMessage: 'Sign in first' })
  if (session.role !== 'Admin') throw createError({ statusCode: 403, statusMessage: 'Only admins can see commissions' })
  return session
}
