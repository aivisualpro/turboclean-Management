import { MERGE_FIELDS, MIN_SAMPLE, TEMPLATE_CATEGORIES, sendingAddress } from '../../../utils/crm-email'
import { aiConfigured, aiLabel, aiModel, aiProvider } from '../../../utils/automation-ai'

/** GET /api/crm/email/config — what the composer needs to know about the sending setup. */
export default defineEventHandler(() => ({
  // The address emails really go out from (a Gmail / Yahoo / Outlook address on the server can never be one).
  fromEmail: sendingAddress().from,
  configuredFrom: sendingAddress().configured,
  fromReplaced: sendingAddress().replaced,
  fromReplacedReason: sendingAddress().reason,
  fromBrand: process.env.CRM_FROM_BRAND || 'ZRZ Turbo Clean',
  replyTracking: process.env.CRM_REPLY_DOMAIN ? 'reply-address' : 'sender-match',
  webhookSigned: !!process.env.RESEND_WEBHOOK_SECRET,
  canSend: !!process.env.RESEND_API_KEY,
  aiConfigured: aiConfigured(),
  aiModel: aiModel(),
  aiProvider: aiProvider(),
  aiLabel: aiLabel(),
  mergeFields: MERGE_FIELDS,
  templateCategories: TEMPLATE_CATEGORIES,
  minSample: MIN_SAMPLE,
}))
