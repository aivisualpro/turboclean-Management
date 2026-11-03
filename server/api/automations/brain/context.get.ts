import { previewContext } from '../../../utils/brain'
import type { BrainArea } from '../../../utils/brain'
import { requireActor } from '../../../utils/automation-http'

/** GET /api/automations/brain/context?area=writing — exactly what AI calls in that area are told. */
export default defineEventHandler(async (event) => {
  await requireActor(event)
  const area = String(getQuery(event).area || 'writing') as BrainArea
  return { area, text: await previewContext(area) }
})
