import { CalendarCheck, Footprints, MessagesSquare, Phone, RefreshCcw, Send } from 'lucide-vue-next'

/** Activity goals — shared types, labels and look (names start with CrmGoal / crmGoal to avoid auto-import clashes). */

export type CrmGoalMetric = 'emails' | 'calls' | 'walkIns' | 'followUps' | 'conversations' | 'meetingsHeld'
export type CrmGoalDay = 'mon' | 'tue' | 'wed' | 'thu' | 'fri' | 'sat' | 'sun'
export type CrmGoalPlan = Record<CrmGoalDay, Partial<Record<CrmGoalMetric, number>>>
export interface CrmGoalConfig {
  mode: 'team' | 'individual'
  people: string[]
  plan: CrmGoalPlan
  overrides: Record<string, CrmGoalPlan>
  weights: Partial<Record<CrmGoalMetric, number>>
  workdayStart: number
  workdayEnd: number
}
export interface CrmGoalHistory { effectiveFrom: string, savedAt: string, savedBy: { id: string, name: string } | null }
export type CrmGoalStatus = 'ahead' | 'on-track' | 'behind' | 'at-risk' | 'met' | 'missed' | 'upcoming' | 'no-goal'
export interface CrmGoalRow {
  metric: CrmGoalMetric, label: string, actual: number, goal: number, goalToDate: number, status: CrmGoalStatus
  pct: number | null, pacePct: number | null, needed: number, perDay: number | null, today: { goal: number, actual: number } | null
}

export const CRM_GOAL_METRICS: { key: CrmGoalMetric, label: string, icon: any, weight: number, hint: string }[] = [
  { key: 'emails', label: 'Emails sent', icon: Send, weight: 1, hint: 'Every email sent.' },
  { key: 'calls', label: 'Calls', icon: Phone, weight: 1, hint: 'Calls, voicemails and texts.' },
  { key: 'walkIns', label: 'Walk-ins', icon: Footprints, weight: 2, hint: 'In-person visits to a dealership.' },
  { key: 'followUps', label: 'Follow-ups', icon: RefreshCcw, weight: 1, hint: 'Follow-ups logged.' },
  { key: 'conversations', label: 'Conversations', icon: MessagesSquare, weight: 3, hint: 'Real two-way conversations: connected calls plus conversations logged.' },
  { key: 'meetingsHeld', label: 'Meetings held', icon: CalendarCheck, weight: 5, hint: 'Meetings that took place.' },
]
export const CRM_GOAL_DAYS: { key: CrmGoalDay, label: string, long: string }[] = [
  { key: 'mon', label: 'Mon', long: 'Monday' }, { key: 'tue', label: 'Tue', long: 'Tuesday' }, { key: 'wed', label: 'Wed', long: 'Wednesday' },
  { key: 'thu', label: 'Thu', long: 'Thursday' }, { key: 'fri', label: 'Fri', long: 'Friday' }, { key: 'sat', label: 'Sat', long: 'Saturday' }, { key: 'sun', label: 'Sun', long: 'Sunday' },
]

/** How each status looks: chip, bar and text colours. */
export const CRM_GOAL_STATUS: Record<CrmGoalStatus, { label: string, chip: string, bar: string, text: string }> = {
  'met': { label: 'Goal met', chip: 'bg-emerald-500/12 text-emerald-700 dark:text-emerald-300 ring-emerald-500/30', bar: 'bg-emerald-500', text: 'text-emerald-700 dark:text-emerald-400' },
  'ahead': { label: 'Ahead', chip: 'bg-emerald-500/12 text-emerald-700 dark:text-emerald-300 ring-emerald-500/30', bar: 'bg-emerald-500', text: 'text-emerald-700 dark:text-emerald-400' },
  'on-track': { label: 'On track', chip: 'bg-sky-500/12 text-sky-700 dark:text-sky-300 ring-sky-500/30', bar: 'bg-sky-500', text: 'text-sky-700 dark:text-sky-400' },
  'behind': { label: 'Behind', chip: 'bg-amber-500/15 text-amber-800 dark:text-amber-300 ring-amber-500/30', bar: 'bg-amber-500', text: 'text-amber-700 dark:text-amber-400' },
  'at-risk': { label: 'At risk', chip: 'bg-rose-500/12 text-rose-700 dark:text-rose-300 ring-rose-500/30', bar: 'bg-rose-500', text: 'text-rose-700 dark:text-rose-400' },
  'missed': { label: 'Missed', chip: 'bg-rose-500/12 text-rose-700 dark:text-rose-300 ring-rose-500/30', bar: 'bg-rose-500', text: 'text-rose-700 dark:text-rose-400' },
  'upcoming': { label: 'Not started', chip: 'bg-muted text-muted-foreground ring-border', bar: 'bg-muted-foreground/40', text: 'text-muted-foreground' },
  'no-goal': { label: 'No goal', chip: 'bg-muted text-muted-foreground ring-border', bar: 'bg-muted-foreground/40', text: 'text-muted-foreground' },
}
/** Colour for a 0–100 score. */
export const crmGoalScoreTone = (s: number | null | undefined) => s == null ? 'bg-muted-foreground/30' : s >= 100 ? 'bg-emerald-500' : s >= 90 ? 'bg-sky-500' : s >= 60 ? 'bg-amber-500' : 'bg-rose-500'

export const crmGoalEmptyPlan = (): CrmGoalPlan => ({ mon: {}, tue: {}, wed: {}, thu: {}, fri: {}, sat: {}, sun: {} })
export const crmGoalWeekTotal = (p: CrmGoalPlan, m: CrmGoalMetric) => CRM_GOAL_DAYS.reduce((n, d) => n + (p[d.key]?.[m] || 0), 0)

export function useCrmGoals() {
  async function load() {
    return await $fetch<{ config: CrmGoalConfig, seeded: boolean, history: CrmGoalHistory[] }>('/api/crm/goals')
  }
  async function save(config: CrmGoalConfig, today: string) {
    return await $fetch<{ config: CrmGoalConfig, seeded: boolean, history: CrmGoalHistory[] }>('/api/crm/goals', { method: 'PUT', body: { config, today } })
  }
  async function suggest(q: { weekStart: string, weekStartTs: string, userId?: string, weeks?: number }) {
    return await $fetch<{ plan: CrmGoalPlan, from: string, to: string, weeks: number, activeWeeks: number, activeDays: number }>('/api/crm/goals/suggest', { query: q })
  }
  return { load, save, suggest }
}
