import { getCrmDb } from '../../../../utils/crm'
import { teachLesson } from '../../../../utils/brain'
import { requireActor } from '../../../../utils/automation-http'

/** POST /api/automations/brain/lessons { text, area, pinned? } — teach the brain a rule. */
export default defineEventHandler(async (event) => {
  const actor = await requireActor(event)
  return { lesson: await teachLesson(await getCrmDb(), (await readBody(event)) || {}, actor) }
})
