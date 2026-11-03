import { localDay } from '~/composables/useCrmDealerships'

export interface FollowupBoardItem {
  dealershipId: string
  dealershipCode: string
  name: string
  stage: string
  city: string
  state: string
  ownerId: string
  ownerName: string
  daysInStage: number | null
  lastTouchAt: string | null
  lastTouchType: string | null
  daysSinceTouch: number | null
  contact: { name: string, title: string, phone: string, email: string } | null
  nextAction: { interactionId: string, text: string, type: string, date: string | null, time: string | null, userId: string, userName: string, daysOverdue: number } | null
  revisitDate: string | null
  reason: string
}

export interface FollowupBoard {
  today: string
  rules: { NO_ACTIVITY_DAYS: number, STALE_OPP_TOUCH_DAYS: number, STALE_OPP_STAGE_DAYS: number, DEFAULT_NURTURE_DAYS: number }
  followUpsToday: FollowupBoardItem[]
  meetingsToday: FollowupBoardItem[]
  callsDue: FollowupBoardItem[]
  revisitsDue: FollowupBoardItem[]
  toResearch: FollowupBoardItem[]
  toContact: FollowupBoardItem[]
  overdueFollowUps: FollowupBoardItem[]
  noRecentActivity: FollowupBoardItem[]
  staleOpportunities: FollowupBoardItem[]
  noNextStep: FollowupBoardItem[]
  upcoming: FollowupBoardItem[]
  coverage: { active: number, covered: number, queued: number, parked: number, uncovered: number }
}

/** The follow-up board ("Today"), computed for the viewer's local date. */
export function useCrmFollowups() {
  const board = useState<FollowupBoard | null>('crm-followups', () => null)
  const loading = ref(false)
  async function load(scope = 'all') {
    loading.value = true
    try { board.value = await $fetch<FollowupBoard>('/api/crm/followups', { query: { today: localDay(), scope } }) }
    finally { loading.value = false }
    return board.value
  }
  return { board, loading, load }
}
