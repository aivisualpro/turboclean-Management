import { CRM_COLLECTIONS, WON_STAGE, actorFromSession, getCrmDb, normalizeStage, serializeDealership, str, toObjectId } from '../../../../../utils/crm'
import { createInteraction, interactionLabel } from '../../../../../utils/crm-interactions'
import { moveStage } from '../../../../../utils/crm-stage'
import { parseLostInput } from '../../../../../utils/crm-lost'
import { getUserSession } from '../../../../../utils/auth'
import { INTERACTION_TIME_CATEGORY, addEntry } from '../../../../../utils/crm-time'

/**
 * POST /api/crm/dealerships/:id/interactions — log an interaction.
 * Body: type, occurredAt, contactId, userId, notes, outcome, nextAction, nextActionDate,
 *       completePrevious (bool) — close earlier open next actions,
 *       moveStage (string) — also move the dealership to this stage (not Won; the client
 *       opens the conversion dialog for that),
 *       minutesSpent / timeCategory / timeDate — also record the time this took (time tracking).
 */
export default defineEventHandler(async (event) => {
  const id = getRouterParam(event, 'id')!
  const session = await getUserSession(event)
  const body = await readBody(event) || {}
  const db = await getCrmDb()
  const dealership = await db.collection(CRM_COLLECTIONS.dealerships).findOne({ _id: toObjectId(id) })
  if (!dealership) throw createError({ statusCode: 404, statusMessage: 'Dealership not found' })
  const actor = actorFromSession(session)

  // Validate a Lost move up-front so the activity isn't saved when the reason is missing.
  if (body.moveStage && normalizeStage(str(body.moveStage, 60)) === 'Lost') parseLostInput(body, { required: true })
  const minutes = Math.round(Number(body.minutesSpent) || 0)
  if (minutes > 720) throw createError({ statusCode: 400, statusMessage: 'Time spent can be at most 12 hours' })
  const interaction = await createInteraction(db, dealership, body, actor, 'manual')

  // Time tracking: minutes entered with the activity become a time entry for whoever did it.
  let timeEntry = null
  if (minutes > 0) {
    const who = interaction.user?.id ? { id: interaction.user.id, name: interaction.user.name, email: '' } : actor
    if (who) {
      timeEntry = await addEntry(db, who, {
        category: str(body.timeCategory, 40) || INTERACTION_TIME_CATEGORY[interaction.type] || 'admin', minutes,
        date: str(body.timeDate, 10) || String(interaction.occurredAt).slice(0, 10), dealershipId: id, interactionId: interaction.id,
        note: interactionLabel(interaction.type),
      }, 'activity')
    }
  }

  let stageMoved: string | null = null
  const target = body.moveStage ? normalizeStage(str(body.moveStage, 60)) : ''
  if (target && target !== WON_STAGE && !dealership.dealerId && !dealership.archivedAt && target !== dealership.stage) {
    await moveStage(db, dealership, target, actor, 'interaction', `Logged ${interactionLabel(interaction.type).toLowerCase()}`,
      { lostReason: body.lostReason, lostNotes: body.lostNotes, lostCompetitor: body.lostCompetitor, revisitDate: body.revisitDate })
    stageMoved = target
  }
  const after = await db.collection(CRM_COLLECTIONS.dealerships).findOne({ _id: dealership._id })
  return { interaction, stageMoved, timeEntry, dealership: serializeDealership(after) }
})
