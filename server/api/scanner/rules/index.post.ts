import { getCrmDb } from '../../../utils/crm'
import { saveRule } from '../../../utils/scanner-images'
import { requireActor } from '../../../utils/automation-http'

/** POST /api/scanner/rules { hash? , urlContains?, verdict, label?, thumb? } */
export default defineEventHandler(async (event) => {
  const actor = await requireActor(event)
  return { rule: await saveRule(await getCrmDb(), (await readBody(event)) || {}, actor) }
})
