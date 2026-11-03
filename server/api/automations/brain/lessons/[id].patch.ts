import { getCrmDb } from '../../../../utils/crm'
import { updateLesson } from '../../../../utils/brain'
import { requireActor } from '../../../../utils/automation-http'

/** PATCH /api/automations/brain/lessons/:id { text?, pinned?, status?, area? } */
export default defineEventHandler(async (event) => {
  const actor = await requireActor(event)
  return { lesson: await updateLesson(await getCrmDb(), getRouterParam(event, 'id')!, (await readBody(event)) || {}, actor) }
})
