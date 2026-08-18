/**
 * AppSheet API v2 Utility
 * Handles all communication with AppSheet for 2-way sync
 */

import process from 'node:process'

const APPSHEET_APP_ID = process.env.APPSHEET_APP_ID || '7dc0e030-a298-4b45-a6ca-7ca25702b8d3'
const APPSHEET_ACCESS_KEY = process.env.APPSHEET_ACCESS_KEY || 'V2-3GjXB-nG0wL-LYNdJ-3GxXd-DEd8z-z8ubw-RaJTf-EKSQn'
const APPSHEET_BASE_URL = `https://www.appsheet.com/api/v2/apps/${APPSHEET_APP_ID}/tables`

// Table name mapping: MongoDB collection → AppSheet table
export const TABLE_MAP = {
  turboCleanAppUsers: 'AppUsers',
  turboCleanDealers: 'Dealers',
  turboCleanDealerServices: 'DealerServices',
  turboCleanServices: 'Services',
  turboCleanWorkOrders: 'WorkOrders',
} as const

// Reverse mapping: AppSheet table → MongoDB collection
export const REVERSE_TABLE_MAP: Record<string, string> = Object.fromEntries(
  Object.entries(TABLE_MAP).map(([k, v]) => [v, k])
)

type AppSheetAction = 'Add' | 'Edit' | 'Delete' | 'Find'

interface AppSheetRequest {
  Action: AppSheetAction
  Properties?: Record<string, any>
  Rows?: Record<string, any>[]
  Selector?: string
}

const DEFAULT_PROPERTIES = { Locale: 'en-US', Timezone: 'UTC' }

export interface AppSheetCallOptions {
  maxRetries?: number
  timeoutMs?: number
}

export interface AppSheetCallResult {
  ok: boolean
  /** HTTP status of the last response (0 for network-level failures) */
  status: number
  data: any
  error?: string
  /** true when the failure is transient (network, timeout, 429, 5xx) and worth retrying later */
  retriable: boolean
}

/**
 * Make an API call to AppSheet and report exactly what happened.
 * This is the low-level primitive — it never throws.
 */
export async function callAppSheetDetailed(
  tableName: string,
  payload: AppSheetRequest,
  opts: AppSheetCallOptions = {},
): Promise<AppSheetCallResult> {
  const { maxRetries = 3, timeoutMs = 30_000 } = opts
  const url = `${APPSHEET_BASE_URL}/${encodeURIComponent(tableName)}/Action`

  let lastError = ''
  let lastStatus = 0

  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      const response = await fetch(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'ApplicationAccessKey': APPSHEET_ACCESS_KEY,
        },
        body: JSON.stringify(payload),
        signal: AbortSignal.timeout(timeoutMs),
      })

      if (!response.ok) {
        const errorText = await response.text().catch(() => '')
        lastStatus = response.status
        lastError = `HTTP ${response.status}: ${errorText.slice(0, 500)}`

        if (response.status === 404) {
          console.warn(`[AppSheet] 404 from ${tableName} for ${payload.Action} (row/table not found).`)
          return { ok: false, status: 404, data: null, error: lastError, retriable: false }
        }

        console.error(`[AppSheet] Error ${response.status} for ${tableName}/${payload.Action} on attempt ${attempt}:`, errorText.slice(0, 500))

        // 4xx (except 429) are permanent — retrying won't help
        if (response.status >= 400 && response.status < 500 && response.status !== 429) {
          return { ok: false, status: response.status, data: null, error: lastError, retriable: false }
        }
        // 429 / 5xx → fall through to retry
      }
      else {
        // Some actions (Delete) may not return JSON
        const contentType = response.headers.get('content-type') || ''
        const data = contentType.includes('application/json')
          ? await response.json().catch(() => null)
          : await response.text().catch(() => '')
        return { ok: true, status: response.status, data, retriable: false }
      }
    }
    catch (err: any) {
      lastStatus = 0
      lastError = err?.message || String(err)
      console.error(`[AppSheet] Network/API error for ${tableName}/${payload.Action} on attempt ${attempt}:`, lastError)
    }

    if (attempt < maxRetries) {
      const backoffMs = attempt * 2000 // 2s, 4s, ...
      await new Promise(resolve => setTimeout(resolve, backoffMs))
    }
  }

  console.error(`[AppSheet] Exhausted all ${maxRetries} attempts for ${tableName}/${payload.Action}. Final error:`, lastError)
  return { ok: false, status: lastStatus, data: null, error: lastError, retriable: true }
}

/**
 * Legacy wrapper kept for existing callers:
 * returns the response data on success, null on any failure.
 */
async function callAppSheet(tableName: string, payload: AppSheetRequest, maxRetries = 3): Promise<any> {
  const res = await callAppSheetDetailed(tableName, payload, { maxRetries })
  return res.ok ? res.data : null
}

/**
 * Normalize an AppSheet response body into an array of rows.
 * Returns null when the shape is unknown (treat as "ambiguous", NOT as empty).
 */
export function extractAppSheetRows(data: any): any[] | null {
  if (data === null || data === undefined) return null
  if (Array.isArray(data)) return data
  if (Array.isArray(data?.Rows)) return data.Rows
  if (Array.isArray(data?.rows)) return data.rows
  return null
}

export interface AppSheetUpsertResult {
  ok: boolean
  edited: number
  added: number
  error?: string
  retriable: boolean
}

/**
 * Edit rows, then Add any rows AppSheet didn't match.
 *
 * AppSheet's Edit action silently ignores rows whose key doesn't exist, which
 * used to make "sometimes it just doesn't sync" bugs: a row created while
 * AppSheet was unreachable could never be edited again. Upsert self-heals that.
 *
 * `addRowsById` (optional): complete rows keyed by `_id`, used instead of the
 * (possibly partial) edit row when a missing row has to be Added.
 */
export async function appSheetUpsert(
  tableName: string,
  rows: Record<string, any>[],
  opts: AppSheetCallOptions = {},
  addRowsById?: Record<string, Record<string, any>>,
): Promise<AppSheetUpsertResult> {
  if (!rows.length) return { ok: true, edited: 0, added: 0, retriable: false }

  const editRes = await callAppSheetDetailed(tableName, {
    Action: 'Edit',
    Properties: DEFAULT_PROPERTIES,
    Rows: rows,
  }, opts)

  let missing: Record<string, any>[] = []

  if (!editRes.ok && editRes.status === 404) {
    // Nothing matched at all — try adding everything
    missing = rows
  }
  else if (!editRes.ok) {
    return { ok: false, edited: 0, added: 0, error: editRes.error, retriable: editRes.retriable }
  }
  else {
    const editedRows = extractAppSheetRows(editRes.data)
    if (editedRows === null) {
      // Ambiguous response body — assume the edit landed to avoid duplicate adds
      return { ok: true, edited: rows.length, added: 0, retriable: false }
    }
    const editedIds = new Set(editedRows.map(r => String(r?._id ?? '')).filter(Boolean))
    missing = rows.filter(r => r._id !== undefined && r._id !== '' && !editedIds.has(String(r._id)))
  }

  if (!missing.length) {
    return { ok: true, edited: rows.length, added: 0, retriable: false }
  }

  // Prefer the complete row (if supplied) when creating rows AppSheet lacks
  const rowsToAdd = missing.map(r => addRowsById?.[String(r._id)] ?? r)

  const addRes = await callAppSheetDetailed(tableName, {
    Action: 'Add',
    Properties: DEFAULT_PROPERTIES,
    Rows: rowsToAdd,
  }, opts)

  if (!addRes.ok) {
    // "already exists" means the row IS there — the edit response was just incomplete
    if (!addRes.retriable && /already\s*exists|duplicate/i.test(addRes.error || '')) {
      return { ok: true, edited: rows.length - missing.length, added: 0, retriable: false }
    }
    return {
      ok: false,
      edited: rows.length - missing.length,
      added: 0,
      error: addRes.error,
      retriable: addRes.retriable,
    }
  }

  return { ok: true, edited: rows.length - missing.length, added: missing.length, retriable: false }
}

/**
 * Add rows to an AppSheet table
 */
export async function appSheetAdd(tableName: string, rows: Record<string, any>[]) {
  if (!rows.length) return null
  return callAppSheet(tableName, {
    Action: 'Add',
    Properties: DEFAULT_PROPERTIES,
    Rows: rows,
  })
}

/**
 * Edit/Update rows in an AppSheet table
 */
export async function appSheetEdit(tableName: string, rows: Record<string, any>[]) {
  if (!rows.length) return null
  return callAppSheet(tableName, {
    Action: 'Edit',
    Properties: DEFAULT_PROPERTIES,
    Rows: rows,
  })
}

/**
 * Delete rows from an AppSheet table (by key)
 */
export async function appSheetDelete(tableName: string, rows: Record<string, any>[]) {
  if (!rows.length) return null
  return callAppSheet(tableName, {
    Action: 'Delete',
    Properties: DEFAULT_PROPERTIES,
    Rows: rows,
  })
}

/**
 * Find/Read rows from an AppSheet table
 */
export async function appSheetFind(tableName: string, selector?: string) {
  const payload: AppSheetRequest = {
    Action: 'Find',
    Properties: DEFAULT_PROPERTIES,
    Rows: [],
  }
  if (selector) {
    payload.Selector = selector
  }
  return callAppSheet(tableName, payload)
}
