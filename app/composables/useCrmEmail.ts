import type { CrmActor, CrmContact, CrmDealership } from '~/composables/useCrmDealerships'

export type EmailOutcomeKey = 'conversation' | 'meeting' | 'opportunity' | 'proposal' | 'won'
export interface CrmEmailEvent { type: string, at: string, detail?: string }
export interface CrmEmail {
  id: string
  direction: 'outbound' | 'inbound'
  dealershipId: string | null
  dealershipCode: string
  dealershipName: string
  contactId: string | null
  contactName: string
  toEmail: string
  fromEmail: string
  fromName?: string
  subject: string
  bodyText: string
  bodyHtml?: string
  snippet?: string
  templateId: string | null
  templateName?: string
  templateVersion: number | null
  templateVersionLabel?: string
  templateEdited?: boolean
  subjectVariant?: string | null
  bodyFormat?: 'text' | 'html'
  campaignId: string | null
  campaignName?: string
  threadId: string | null
  isFollowUp?: boolean
  followUpNumber?: number
  status?: 'queued' | 'sent' | 'delivered' | 'bounced' | 'complained' | 'failed'
  failedReason?: string
  sentAt: string
  sentBy?: CrmActor
  deliveredAt?: string | null
  bouncedAt?: string | null
  bounceReason?: string
  openedAt?: string | null
  openCount?: number
  clickedAt?: string | null
  clickCount?: number
  clickedLinks?: string[]
  repliedAt?: string | null
  replyCount?: number
  replySentiment?: 'positive' | 'neutral' | 'negative' | null
  outcomes?: Partial<Record<EmailOutcomeKey, { at: string, source?: string, implied?: boolean } | null>>
  // inbound
  inReplyToEmailId?: string | null
  receivedAt?: string
  sentiment?: 'positive' | 'neutral' | 'negative' | null
  sentimentSetBy?: CrmActor | null
  matchedBy?: string
  events?: CrmEmailEvent[]
}
export interface EmailTemplateVersion { version: number, label: string, format: 'text' | 'html', subject?: string, body: string, html: string, note: string, status: 'active' | 'retired', createdAt: string, createdBy: CrmActor }
export interface EmailSubjectLine { key: string, text: string, status: 'active' | 'retired', createdAt: string, createdBy?: CrmActor }
export interface EmailTemplate {
  id: string, name: string, category: string, description: string, currentVersion: number
  versions: EmailTemplateVersion[], subjects: EmailSubjectLine[]
  /** Sends so far, per version number and per subject key — drives balanced rotation */
  usage: { versions: Record<string, number>, subjects: Record<string, number> }
  archivedAt: string | null, createdAt: string, updatedAt: string
}
export interface SenderProfile { displayName: string, title: string, company: string, phone: string, email: string, tagline: string, region: string }
export interface ExperimentRow {
  templateId: string | null, templateName: string, category: string
  version: number | null, versionLabel: string, versionStatus: string | null, versionFormat: string | null
  subjectVariant: string | null, subjectText: string, subjectStatus: string | null
  units: number, emails: number, dealerships: number
  delivered: number, deliveryRate: number | null
  replied: number, replyRate: number | null, replyCI: { low: number, high: number } | null
  positive: number, positiveRate: number | null, positiveShareOfReplies: number | null, negative: number
  meetings: number, meetingRate: number | null, opportunities: number, proposals: number
  won: number, winRate: number | null, winCI: { low: number, high: number } | null
  revenueInvoiced: number, contractValue: number, revenuePerUnit: number, enoughData: boolean
}
export interface ExperimentReport { level: string, model: 'email' | 'sequence', minSample: number, unit: string, rows: ExperimentRow[], totals: { units: number, won: number } }
export interface EmailPreview { subject: string, html: string, format: 'text' | 'html', missing: string[], auditDate: string | null }
export interface EmailCampaign { id: string, name: string, description: string, status: 'planned' | 'active' | 'paused' | 'completed', startDate: string | null, endDate: string | null, archivedAt: string | null, createdAt: string }
export interface EmailStatsRow {
  key: any
  sent: number, firstEmails: number, followUps: number, delivered: number, bounced: number, complained: number
  opened: number, clicked: number, replied: number, positive: number, negative: number
  conversation: number, meeting: number, opportunity: number, proposal: number, won: number, dealershipsReached: number
}
export interface EmailStats { rows: EmailStatsRow[], unclassifiedReplies: number, unmatchedReplies: number, attributionDays: number }
export interface EmailConfig { fromEmail: string, fromBrand: string, replyTracking: 'reply-address' | 'sender-match', webhookSigned: boolean, canSend: boolean, minSample: number, aiConfigured?: boolean, aiModel?: string, aiProvider?: 'gemini' | 'anthropic' | null, aiLabel?: string }

export interface SendEmailInput {
  contactId?: string | null
  to?: string
  subject?: string
  body?: string
  templateId?: string | null
  templateVersion?: number | null
  subjectVariant?: string | null
  campaignId?: string | null
  followUpOf?: string | null
}

/** Same variables the server uses when merging. */
export function emailMergeVars(dealership: CrmDealership | null, contact: CrmContact | null, senderName: string) {
  return {
    firstName: contact?.firstName || '', lastName: contact?.lastName || '', fullName: contact?.fullName || '',
    contactTitle: contact?.jobTitle || contact?.role || '', dealership: dealership?.name || '', dealerGroup: dealership?.dealerGroup || '',
    city: dealership?.city || '', state: dealership?.state || '', website: (dealership?.website || '').replace(/^https?:\/\//, '').replace(/\/$/, ''),
    senderName, senderFirstName: senderName.split(/\s+/)[0] || '',
  } as Record<string, string>
}
export const pct = (n: number, d: number) => d ? Math.round((n / d) * 1000) / 10 : null

export function useCrmEmail() {
  const templates = useState<EmailTemplate[]>('crm-email-templates', () => [])
  const campaigns = useState<EmailCampaign[]>('crm-email-campaigns', () => [])
  const config = useState<EmailConfig | null>('crm-email-config', () => null)

  async function loadLibrary(force = false) {
    if (!force && templates.value.length && campaigns.value.length && config.value) return
    const [t, c, cfg] = await Promise.all([
      $fetch<{ templates: EmailTemplate[] }>('/api/crm/email/templates', { query: { archived: '1' } }),
      $fetch<{ campaigns: EmailCampaign[] }>('/api/crm/email/campaigns'),
      $fetch<EmailConfig>('/api/crm/email/config'),
    ])
    templates.value = t.templates; campaigns.value = c.campaigns; config.value = cfg
  }
  const sendEmail = (dealershipId: string, input: SendEmailInput) =>
    $fetch<{ email: CrmEmail }>(`/api/crm/dealerships/${dealershipId}/emails`, { method: 'POST', body: input }).then(r => r.email)
  const listEmails = (query: Record<string, any>) => $fetch<{ emails: CrmEmail[] }>('/api/crm/email/messages', { query }).then(r => r.emails)
  const getEmail = (id: string) => $fetch<{ email: CrmEmail, thread: CrmEmail[] }>(`/api/crm/email/messages/${id}`)
  const updateEmail = (id: string, body: Record<string, any>) => $fetch<{ email: CrmEmail }>(`/api/crm/email/messages/${id}`, { method: 'PATCH', body }).then(r => r.email)
  const getStats = (query: Record<string, any>) => $fetch<EmailStats>('/api/crm/email/stats', { query })
  const getExperiments = (query: Record<string, any>) => $fetch<ExperimentReport>('/api/crm/email/experiments', { query })
  const previewEmail = (dealershipId: string, input: SendEmailInput) => $fetch<EmailPreview>(`/api/crm/dealerships/${dealershipId}/emails/preview`, { method: 'POST', body: input })
  const getSenderProfile = () => $fetch<{ profile: SenderProfile }>('/api/crm/email/sender-profile').then(r => r.profile)
  const saveSenderProfile = (body: Partial<SenderProfile>) => $fetch<{ profile: SenderProfile }>('/api/crm/email/sender-profile', { method: 'PUT', body }).then(r => r.profile)
  const uploadImage = (dataUrl: string, filename: string, dealershipId?: string) => $fetch<{ id: string, filename: string, contentType: string, size: number }>('/api/crm/files', { method: 'POST', body: { dataUrl, filename, dealershipId } })

  async function saveTemplate(id: string | null, body: Record<string, any>) {
    const res = id
      ? await $fetch<{ template: EmailTemplate }>(`/api/crm/email/templates/${id}`, { method: 'PATCH', body })
      : await $fetch<{ template: EmailTemplate }>('/api/crm/email/templates', { method: 'POST', body })
    const i = templates.value.findIndex(t => t.id === res.template.id)
    if (i === -1) templates.value = [...templates.value, res.template]
    else templates.value.splice(i, 1, res.template)
    return res.template
  }
  async function saveCampaign(id: string | null, body: Record<string, any>) {
    const res = id
      ? await $fetch<{ campaign: EmailCampaign }>(`/api/crm/email/campaigns/${id}`, { method: 'PATCH', body })
      : await $fetch<{ campaign: EmailCampaign }>('/api/crm/email/campaigns', { method: 'POST', body })
    const i = campaigns.value.findIndex(c => c.id === res.campaign.id)
    if (i === -1) campaigns.value = [res.campaign, ...campaigns.value]
    else campaigns.value.splice(i, 1, res.campaign)
    return res.campaign
  }

  const getDeliverability = () => $fetch<{ domain: string, from: string, score: number, items: { key: string, label: string, status: 'ok' | 'warn' | 'fail', detail: string, fix?: string }[], checkedAt: string }>('/api/crm/email/deliverability')
  return { getDeliverability, templates, campaigns, config, loadLibrary, sendEmail, listEmails, getEmail, updateEmail, getStats, getExperiments, previewEmail, getSenderProfile, saveSenderProfile, uploadImage, saveTemplate, saveCampaign }
}
