export interface WonService { serviceId: string, name: string, price: number, monthlyVolume: number, monthlyRevenue: number }
export interface WonAttribution {
  firstTouch: { type: string, label: string, channel: string, at: string } | null
  firstContactAt: string | null
  touches: { total: number, emails: number, calls: number, visits: number, meetings: number, other: number }
  template: { id: string, name: string, version: string, subject: string } | null
  campaign: { id: string, name: string } | null
  model: 'credited' | 'replied' | 'first_email' | 'manual' | 'none'
}
export interface WonDeal {
  id: string
  dealershipId: string
  dealershipCode: string
  dealershipName: string
  dealerId: string | null
  wonAt: string
  services: WonService[]
  calculatedMonthlyRevenue: number
  revenueOverridden: boolean
  monthlyRevenue: number
  annualRevenue: number
  costMode: 'pct' | 'amount' | 'none'
  costPct: number | null
  monthlyCost: number | null
  monthlyProfit: number | null
  annualProfit: number | null
  marginPct: number | null
  contractStructure: string
  contractTerm: string
  monthlyMinimum: number | null
  contractNotes: string
  acquisitionSource: string
  firstTouch: WonAttribution['firstTouch']
  firstContactAt: string | null
  touches: WonAttribution['touches']
  daysToClose: number | null
  attribution: { template: WonAttribution['template'], campaign: WonAttribution['campaign'], model: WonAttribution['model'], auto: Omit<WonAttribution, 'firstTouch' | 'firstContactAt' | 'touches'> | null }
  ownerId: string
  ownerName: string
  revertedAt: string | null
  invoicedToDate?: number
  updatedAt: string
  updatedBy: { id: string, name: string }
}
/** What the "Mark as won" / "Won deal" form sends. */
export interface WonInput {
  wonAt: string
  services: { serviceId: string, name: string, price: number | string, monthlyVolume: number | string }[]
  monthlyRevenueOverride: number | string | null
  costMode: 'pct' | 'amount' | 'none'
  costPct: number | string | null
  monthlyCost: number | string | null
  contractStructure: string
  contractTerm: string
  monthlyMinimum: number | string | null
  contractNotes: string
  acquisitionSource: string
  attributionTemplateId: string
  attributionCampaignId: string
  useAsPriceList?: boolean
}
export interface WonGroupRow { key: string, count: number, monthlyRevenue: number, annualRevenue: number, annualProfit: number | null, avgAnnualRevenue: number, avgDaysToClose: number | null, avgTouches: number | null }
export interface WonReport {
  total: number
  monthlyRevenue: number
  annualRevenue: number
  annualProfit: number | null
  profitKnown: number
  invoicedToDate: number
  avgDaysToClose: number | null
  avgTouches: number | null
  avgEmails: number | null
  bySource: WonGroupRow[]
  byFirstTouch: WonGroupRow[]
  byTemplate: WonGroupRow[]
  byCampaign: WonGroupRow[]
  byOwner: WonGroupRow[]
  byStructure: WonGroupRow[]
  byMonth: WonGroupRow[]
  byService: { key: string, count: number, monthlyRevenue: number, volume: number }[]
  wins: WonDeal[]
  missing: { dealershipId: string, dealershipCode: string, dealershipName: string, convertedAt: string | null, ownerName: string, leadSource: string, dealerId: string | null }[]
}

export const money = (n: number | null | undefined, digits = 0) => n == null ? '—' : n.toLocaleString('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: digits, minimumFractionDigits: digits })

/** Won-deal capture + report. */
export function useCrmWon() {
  const report = useState<WonReport | null>('crm-won-report', () => null)
  const loading = ref(false)
  const serviceCatalog = useState<{ id: string, service: string }[]>('crm-service-catalog', () => [])

  async function loadReport(q: { from?: string, to?: string, ownerId?: string, includeReverted?: boolean } = {}) {
    loading.value = true
    try {
      report.value = await $fetch<WonReport>('/api/crm/won', { query: { from: q.from || undefined, to: q.to || undefined, ownerId: q.ownerId || undefined, includeReverted: q.includeReverted ? '1' : undefined } })
    } finally { loading.value = false }
  }
  async function getWin(dealershipId: string) {
    return $fetch<{ win: WonDeal | null, preview: WonAttribution }>(`/api/crm/dealerships/${dealershipId}/won`)
  }
  async function saveWin(dealershipId: string, input: WonInput) {
    return (await $fetch<{ win: WonDeal }>(`/api/crm/dealerships/${dealershipId}/won`, { method: 'PUT', body: input })).win
  }
  async function loadServices(force = false) {
    if (serviceCatalog.value.length && !force) return serviceCatalog.value
    try { serviceCatalog.value = (await $fetch<any[]>('/api/services')).map(s => ({ id: s.id, service: s.service })) } catch {}
    return serviceCatalog.value
  }
  return { report, loading, loadReport, getWin, saveWin, serviceCatalog, loadServices }
}

export function blankWonInput(leadSource = ''): WonInput {
  const d = new Date()
  const day = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
  return {
    wonAt: day, services: [{ serviceId: '', name: '', price: '', monthlyVolume: '' }], monthlyRevenueOverride: null,
    costMode: 'none', costPct: null, monthlyCost: null, contractStructure: 'Per vehicle', contractTerm: 'Month-to-month', monthlyMinimum: null,
    contractNotes: '', acquisitionSource: leadSource, attributionTemplateId: '', attributionCampaignId: '', useAsPriceList: true,
  }
}

export function wonInputFrom(w: WonDeal): WonInput {
  return {
    wonAt: w.wonAt,
    services: w.services.map(s => ({ serviceId: s.serviceId, name: s.name, price: s.price, monthlyVolume: s.monthlyVolume })),
    monthlyRevenueOverride: w.revenueOverridden ? w.monthlyRevenue : null,
    costMode: w.costMode, costPct: w.costPct, monthlyCost: w.costMode === 'amount' ? w.monthlyCost : null,
    contractStructure: w.contractStructure, contractTerm: w.contractTerm, monthlyMinimum: w.monthlyMinimum, contractNotes: w.contractNotes,
    acquisitionSource: w.acquisitionSource,
    attributionTemplateId: w.attribution?.model === 'manual' ? (w.attribution.template?.id || '') : '',
    attributionCampaignId: w.attribution?.model === 'manual' ? (w.attribution.campaign?.id || '') : '',
  }
}

/** Same rules as the server: at least one named service; prices/volumes are numbers. */
export function validateWonInput(i: WonInput) {
  const e: Record<string, string> = {}
  const named = i.services.filter(s => s.serviceId || String(s.name || '').trim())
  if (!named.length) e.services = 'Add at least one service sold'
  else if (named.some(s => !(Number(s.price) > 0))) e.services = 'Enter a price for each service'
  return e
}
