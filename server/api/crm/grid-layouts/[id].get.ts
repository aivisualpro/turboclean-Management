import { actorFromSession, getCrmDb } from '../../../utils/crm'
import { gridLayoutId, readGridLayout } from '../../../utils/crm-grid-layouts'
import { getUserSession } from '../../../utils/auth'

/** GET /api/crm/grid-layouts/:id — the signed-in person's column layout for one table ({ layout: null } when never customised). */
export default defineEventHandler(async event => ({
  layout: await readGridLayout(await getCrmDb(), actorFromSession(await getUserSession(event)), gridLayoutId(getRouterParam(event, 'id'))),
}))
