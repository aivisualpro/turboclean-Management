import { actorFromSession, getCrmDb } from '../../../utils/crm'
import { saveDataUrl } from '../../../utils/crm-files'
import { getUserSession } from '../../../utils/auth'

/** POST /api/crm/files — { dataUrl, filename, dealershipId?, purpose? } → { id, filename, contentType, size } */
export default defineEventHandler(async (event) => {
  const session = await getUserSession(event)
  const body = await readBody(event)
  return saveDataUrl(await getCrmDb(), body || {}, actorFromSession(session))
})
