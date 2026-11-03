export interface LostBreakdownRow { key: string, count: number, pct: number, reasons: Record<string, number>, top: string }

export interface LostDeal {
  id: string | null
  legacy?: boolean
  dealershipId: string
  dealershipCode: string
  dealershipName: string
  reason: string
  notes: string
  competitor: string
  fromStage: string
  furthestStage: string
  hadMeeting: boolean
  lostAt: string
  lostBy: { id: string, name: string, email?: string } | null
  ownerId: string
  ownerName: string
  leadSource: string
  dealerGroup: string
  brands: string[]
  state: string
  city: string
  territory: string
  daysInPipeline: number | null
  lastEmail: { templateName: string, version: string, campaignName: string } | null
  revisitDate: string | null
  reopenedAt: string | null
}

export interface LostReport {
  total: number
  reasons: string[]
  unrecorded: number
  afterMeeting: number
  reopened: number
  byReason: { reason: string, count: number, pct: number, afterMeeting: number, avgDaysInPipeline: number | null }[]
  byStage: LostBreakdownRow[]
  byOwner: LostBreakdownRow[]
  byLeadSource: LostBreakdownRow[]
  byState: LostBreakdownRow[]
  byGroup: LostBreakdownRow[]
  byMonth: LostBreakdownRow[]
  competitors: { name: string, count: number }[]
  deals: LostDeal[]
}

export interface LostQuery { from?: string, to?: string, ownerId?: string, stage?: string, includeReopened?: boolean }

/** Lost-deal report: why we lose, where in the pipeline, for whom. */
export function useCrmLost() {
  const report = useState<LostReport | null>('crm-lost-report', () => null)
  const loading = ref(false)

  async function load(q: LostQuery = {}) {
    loading.value = true
    try {
      report.value = await $fetch<LostReport>('/api/crm/lost', {
        query: {
          from: q.from || undefined, to: q.to || undefined, ownerId: q.ownerId || undefined,
          stage: q.stage || undefined, includeReopened: q.includeReopened ? '1' : undefined,
        },
      })
    } finally { loading.value = false }
  }

  /** Fix the reason on a deal. Logged losses patch the loss; pre-tracking ones patch the dealership. */
  async function updateReason(deal: LostDeal, input: { lostReason: string, lostNotes: string, lostCompetitor: string }) {
    if (deal.id) await $fetch(`/api/crm/lost/${deal.id}`, { method: 'PATCH', body: input })
    else await $fetch(`/api/crm/dealerships/${deal.dealershipId}`, { method: 'PATCH', body: input })
  }

  return { report, loading, load, updateReason }
}
