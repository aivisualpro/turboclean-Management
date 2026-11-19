import { actorFromSession, getCrmDb } from '../../../utils/crm'
import { gridLayoutId, writeGridLayout } from '../../../utils/crm-grid-layouts'
import { getUserSession } from '../../../utils/auth'

/** PUT /api/crm/grid-layouts/:id — { layout: { order, hidden, pinned, widths, updatedAt } }; the newest copy wins. */
export default defineEventHandler(async (event) => {
  const body = await readBody(event)
  return { layout: await writeGridLayout(await getCrmDb(), actorFromSession(await getUserSession(event)), gridLayoutId(getRouterParam(event, 'id')), body?.layout) }
})
