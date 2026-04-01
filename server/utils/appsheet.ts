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

/**
 * Make an API call to AppSheet
 */
async function callAppSheet(tableName: string, payload: AppSheetRequest): Promise<any> {
  const url = `${APPSHEET_BASE_URL}/${encodeURIComponent(tableName)}/Action`

  try {
    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'ApplicationAccessKey': APPSHEET_ACCESS_KEY,
      },
      body: JSON.stringify(payload),
      signal: AbortSignal.timeout(30_000),
    })

    if (!response.ok) {
      const errorText = await response.text()
      if (response.status === 404) {
        console.warn(`[AppSheet] Row not found in ${tableName} for ${payload.Action} (normal if unsynced).`)
      } else {
        console.error(`[AppSheet] Error ${response.status} for ${tableName}/${payload.Action}:`, errorText)
      }
      return null
    }

    // Some actions (Delete) may not return JSON
    const contentType = response.headers.get('content-type') || ''
    if (contentType.includes('application/json')) {
      return await response.json()
    }
    return await response.text()
  }
  catch (err: any) {
    console.error(`[AppSheet] Network error for ${tableName}/${payload.Action}:`, err.message)
    return null
  }
}

/**
 * Add rows to an AppSheet table
 */
export async function appSheetAdd(tableName: string, rows: Record<string, any>[]) {
  if (!rows.length) return null
  return callAppSheet(tableName, {
    Action: 'Add',
    Properties: { Locale: 'en-US', Timezone: 'UTC' },
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
    Properties: { Locale: 'en-US', Timezone: 'UTC' },
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
    Properties: { Locale: 'en-US', Timezone: 'UTC' },
    Rows: rows,
  })
}

/**
 * Find/Read rows from an AppSheet table
 */
export async function appSheetFind(tableName: string, selector?: string) {
  const payload: AppSheetRequest = {
    Action: 'Find',
    Properties: { Locale: 'en-US', Timezone: 'UTC' },
    Rows: [],
  }
  if (selector) {
    payload.Selector = selector
  }
  return callAppSheet(tableName, payload)
}
