import { getCrmDb } from '../../../../../utils/crm'
import { removeWin } from '../../../../../utils/crm-won'

/** DELETE /api/crm/dealerships/:id/won — remove deal details entered by mistake (kept as reverted). */
export default defineEventHandler(async (event) => removeWin(await getCrmDb(), getRouterParam(event, 'id')!))
