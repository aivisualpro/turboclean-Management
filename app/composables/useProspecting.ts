/**
 * Prospecting (Google Places discovery) — types + API calls shared by the Discover dialog on /crm/dealership
 * and the "Prospecting search area" card on /settings/general. Server: server/utils/crm-prospecting.ts.
 */

export interface ProspectingOrigin { address: string, city: string, state: string, postalCode: string, country: string, lat: number, lng: number }
export interface ProspectingConfig {
  origin: ProspectingOrigin
  radiusMiles: number
  queries: string[]
  includedType: string
  strictType: boolean
  excludeKeywords: string[]
  minReviews: number
  maxApiCalls: number
  defaultStage: string
}
export interface ProspectingConfigResponse { config: ProspectingConfig, apiKeyConfigured: boolean, pricing: { pricePer1000: number, freeMonthlyCalls: number } }

export type ScanStatus = 'running' | 'completed' | 'cancelled' | 'failed' | 'budget'
export interface ScanSummary {
  id: string
  status: ScanStatus
  params: Omit<ProspectingConfig, 'defaultStage'>
  cellsDone: number
  cellsQueued: number
  progress: number
  apiCalls: number
  estCostUsd: number
  found: number
  excluded: number
  splits: number
  log: { at: string, msg: string }[]
  error: string
  startedAt: string
  finishedAt: string | null
  startedBy: string
}
export interface CrmMatch { id: string, dealershipId: string, name: string, stage: string, archived: boolean, assignedUserName: string, reason: string }
export interface Prospect {
  placeId: string
  name: string
  formattedAddress: string
  address: string
  city: string
  state: string
  zip: string
  country: string
  lat: number
  lng: number
  phone: string
  website: string
  mapsUrl: string
  rating: number | null
  reviews: number
  primaryType: string
  primaryTypeLabel: string
  businessStatus: string
  brands: string[]
  distanceMiles: number
  status: 'new' | 'in_crm' | 'dismissed'
  match: CrmMatch | null
  dismissed: { reason: string, at: string, by: string } | null
}
export interface ScansResponse { scans: ScanSummary[], usage: { monthCalls: number, freeCalls: number, pricePer1000: number, estMonthCostUsd: number } }
export interface ImportResult { created: { placeId: string, id: string, dealershipId: string, name: string }[], skipped: { placeId: string, name: string, reason: string, match?: CrmMatch | null }[] }

/** Readable message from an $fetch error. */
export function apiError(e: any, fallback = 'Something went wrong') {
  return e?.data?.statusMessage || e?.data?.message || e?.statusMessage || e?.message || fallback
}

export function useProspecting() {
  const base = '/api/crm/prospecting'
  return {
    getConfig: () => $fetch<ProspectingConfigResponse>(`${base}/config`),
    saveConfig: (config: Partial<ProspectingConfig>) => $fetch<{ config: ProspectingConfig }>(`${base}/config`, { method: 'PUT', body: config }),
    geocode: (query: string) => $fetch<{ result: (Partial<ProspectingOrigin> & { lat: number, lng: number, formattedAddress: string }) | null }>(`${base}/geocode`, { method: 'POST', body: { query } }),
    listScans: () => $fetch<ScansResponse>(`${base}/scans`),
    startScan: (overrides: { radiusMiles?: number, queries?: string[] } = {}) => $fetch<{ scan: ScanSummary }>(`${base}/scans`, { method: 'POST', body: overrides }),
    stepScan: (id: string) => $fetch<{ scan: ScanSummary, places: Prospect[], busy: boolean }>(`${base}/scans/${id}/step`, { method: 'POST' }),
    cancelScan: (id: string) => $fetch<{ scan: ScanSummary }>(`${base}/scans/${id}/cancel`, { method: 'POST' }),
    getScan: (id: string) => $fetch<{ scan: ScanSummary, places: Prospect[], expired: number }>(`${base}/scans/${id}`),
    importPlaces: (body: { placeIds: string[], stage?: string, assignedUserId?: string, assignedUserName?: string, tags?: string[], scanId?: string }) =>
      $fetch<ImportResult>(`${base}/import`, { method: 'POST', body }),
    dismissPlaces: (placeIds: string[], reason = '', undo = false) => $fetch<{ count: number }>(`${base}/dismiss`, { method: 'POST', body: { placeIds, reason, undo } }),
  }
}

export const PLACE_TYPES = [
  { value: 'car_dealer', label: 'Car dealers' },
  { value: '', label: 'Any business (search terms only)' },
]

export function formatMiles(n: number | null | undefined) {
  if (n == null || !Number.isFinite(n)) return '—'
  return n < 10 ? `${n.toFixed(1)} mi` : `${Math.round(n)} mi`
}
export function formatUsd(n: number) {
  return n.toLocaleString('en-US', { style: 'currency', currency: 'USD', minimumFractionDigits: 2 })
}
