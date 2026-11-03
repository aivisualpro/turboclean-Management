import process from 'node:process'
import { getCrmDb } from '../../utils/crm'
import { getUserSession } from '../../utils/auth'
import { ingestInventorySnapshot } from '../../utils/automation-research'

/**
 * POST /api/automations/inventory — an inventory snapshot from a website collector (automation 2).
 * The CRM counts the vehicles (3), calculates missing-photo % (4) and records an automated audit.
 *
 * Auth: a signed-in session, or `Authorization: Bearer <AUTOMATION_API_TOKEN>` for collectors.
 * Body: { dealershipId (id or DLR-00001) | website, inventoryUrl?,
 *         vehicles: [{ condition: 'new'|'used'|'certified', photoCount, isPlaceholder?, url?, vin?, stockNumber?, year?, make?, model? }]
 *         | counts: { newTotal, usedTotal, newMissingPhotos, usedMissingPhotos },
 *         screenshotFileId?, notes?, collector: { name, version, runId } }
 */
export default defineEventHandler(async (event) => {
  const token = process.env.AUTOMATION_API_TOKEN
  const header = getHeader(event, 'authorization') || ''
  const byToken = !!token && header === `Bearer ${token}`
  if (!byToken && !(await getUserSession(event))) throw createError({ statusCode: 401, statusMessage: 'Sign in or send the collector token' })
  return ingestInventorySnapshot(await getCrmDb(), (await readBody(event)) || {})
})
