import { str } from '../../../utils/crm'
import { PlacesError, geocodeAddress } from '../../../utils/crm-prospecting'
import { getUserSession } from '../../../utils/auth'

/** POST /api/crm/prospecting/geocode — { query } → { result: { lat, lng, formattedAddress, … } | null } */
export default defineEventHandler(async (event) => {
  if (!(await getUserSession(event))) throw createError({ statusCode: 401, statusMessage: 'Sign in first' })
  const query = str((await readBody(event))?.query, 300)
  if (!query) throw createError({ statusCode: 400, statusMessage: 'Enter an address first' })
  try {
    return { result: await geocodeAddress(query) }
  } catch (e) {
    if (e instanceof PlacesError) throw createError({ statusCode: e.status === 412 ? 412 : 502, statusMessage: e.message })
    throw e
  }
})
