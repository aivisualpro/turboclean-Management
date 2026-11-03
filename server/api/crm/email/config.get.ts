import { MERGE_FIELDS, MIN_SAMPLE, TEMPLATE_CATEGORIES } from '../../../utils/crm-email'

/** GET /api/crm/email/config — what the composer needs to know about the sending setup. */
export default defineEventHandler(() => ({
  fromEmail: process.env.CRM_FROM_EMAIL || 'sales@zrzops.com',
  fromBrand: process.env.CRM_FROM_BRAND || 'ZRZ Turbo Clean',
  replyTracking: process.env.CRM_REPLY_DOMAIN ? 'reply-address' : 'sender-match',
  webhookSigned: !!process.env.RESEND_WEBHOOK_SECRET,
  canSend: !!process.env.RESEND_API_KEY,
  mergeFields: MERGE_FIELDS,
  templateCategories: TEMPLATE_CATEGORIES,
  minSample: MIN_SAMPLE,
}))
