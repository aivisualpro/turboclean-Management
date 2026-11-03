import { getCrmDb } from '../../../../../utils/crm'
import { stepScan } from '../../../../../utils/crm-prospecting'
import { getUserSession } from '../../../../../utils/auth'

/** POST /api/crm/prospecting/scans/:id/step — runs a few seconds of the scan; returns progress + newly found places. */
export default defineEventHandler(async (event) => {
  if (!(await getUserSession(event))) throw createError({ statusCode: 401, statusMessage: 'Sign in first' })
  return stepScan(await getCrmDb(), getRouterParam(event, 'id') || '')
})
