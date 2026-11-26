import { actorFromSession, getCrmDb } from '../../../utils/crm'
import { listViewId, writeListView } from '../../../utils/crm-list-views'
import { getUserSession } from '../../../utils/auth'

/** PUT /api/crm/list-views/:id — { view: { stage, state, …, conditions: [] }, updatedAt }; kept for the signed-in person, the newest copy wins. */
export default defineEventHandler(async (event) => {
  const body = await readBody(event)
  return { view: await writeListView(await getCrmDb(), actorFromSession(await getUserSession(event)), listViewId(getRouterParam(event, 'id')), body) }
})
