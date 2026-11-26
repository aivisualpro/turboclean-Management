import { requireActor } from '../../utils/automation-http'
import { testPhotoAi } from '../../utils/scanner-vision'

/** POST /api/scanner/ai-test — one small real request to each AI that has a key: is the photo check really working? (No key is ever returned.) */
export default defineEventHandler(async (event) => {
  await requireActor(event)
  return testPhotoAi()
})
