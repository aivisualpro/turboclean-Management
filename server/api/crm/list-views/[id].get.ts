import { actorFromSession, getCrmDb } from '../../../utils/crm'
import { listViewId, readListView } from '../../../utils/crm-list-views'
import { getUserSession } from '../../../utils/auth'

/** GET /api/crm/list-views/:id — the filters the signed-in person last had on one list ({ view: null } when never set). */
export default defineEventHandler(async event => ({
  view: await readListView(await getCrmDb(), actorFromSession(await getUserSession(event)), listViewId(getRouterParam(event, 'id'))),
}))
