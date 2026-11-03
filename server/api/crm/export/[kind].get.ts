import { getCrmDb } from '../../../utils/crm'
import { exportCsv } from '../../../utils/crm-dataquality'

/** GET /api/crm/export/dealerships|contacts|activities — CSV download. */
export default defineEventHandler(async (event) => {
  const kind = getRouterParam(event, 'kind')
  if (kind !== 'dealerships' && kind !== 'contacts' && kind !== 'activities') throw createError({ statusCode: 404, statusMessage: 'Unknown export' })
  const csv = await exportCsv(await getCrmDb(), kind)
  setHeader(event, 'Content-Type', 'text/csv; charset=utf-8')
  setHeader(event, 'Content-Disposition', `attachment; filename="crm-${kind}-${new Date().toISOString().slice(0, 10)}.csv"`)
  return `﻿${csv}`
})
