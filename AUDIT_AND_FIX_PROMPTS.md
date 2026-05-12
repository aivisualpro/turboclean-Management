# Turbo Clean Management — Full Audit & Antigravity Fix Prompts

> **Project:** Nuxt 4 + Vue 3 + MongoDB + Shadcn-vue + Resend + AppSheet sync
> **Scope:** Security, code quality, performance, architecture — file-by-file
> **Deliverable:** One file. Top half is the audit. Bottom half is a numbered sequence of prompts you paste into Antigravity to fix everything in order.

---

## 0. EXECUTIVE SUMMARY (read this first)

The app is functional but **NOT production-safe today**. The single most urgent issue is that anyone on the internet can:

1. `GET /api/users` — receive every user record including the **password** field.
2. `POST /api/users` with `{ "role": "Admin", "email": "x", "password": "x" }` — create an admin.
3. `POST /api/auth/login` with `{ "email": {"$ne": ""}, "password": "x" }` — log in as a passwordless legacy user (operator injection + "no password = any password" branch).
4. Forge a session by base64-encoding their own JSON payload (tokens are unsigned base64).

Stacked on top of that, ~30 server endpoints have no auth check at all, several of them destructive (drop email logs, wipe all dealer services, replace every collection from AppSheet, force-send invoice emails via your Resend account). Production secrets — MongoDB Atlas password, AppSheet access key, Resend API key — are also **hardcoded in source files** in addition to `.env`, so rotating `.env` alone won't help.

The frontend ships several demo/template components that look real to users but do nothing (Register, Forgot Password, settings forms with `m@example.com` static data), a couple of Vue 3 rendering bugs (`v-for` + `v-if` on the same `<tr>`), and ~1,500 lines of duplicated date-range / CRUD logic across mega-pages.

This document gives you (a) every finding by severity with exact file paths, and (b) a 24-step Antigravity prompt sequence that walks an agent through fixing them in a safe order. Each prompt is self-contained — copy, paste, run, review the diff, move to the next.

**Rough effort to ship-safe:** Phase 1 (secrets + auth) is ~2-4 hours of agent time. Phase 2 (endpoint lockdown + validation) is ~4-8 hours. Phase 3+ (frontend bugs, dedup, hygiene) can be done incrementally.

---

## 1. PROJECT INVENTORY

**Stack**
- Nuxt `^4.1.3`, Vue `^3.5.22`, Node 22.x, pnpm 10.10
- MongoDB driver `^7.1.0` (bleeding edge — Oct 2025 release, pin to `~7.1.0`)
- TailwindCSS 4 + shadcn-nuxt + reka-ui
- Resend for email, AppSheet bidirectional sync, jsPDF for invoices
- Pinia (declared, lightly used), VueUse, Vee-validate + zod (declared, **not used on the server**)

**Counts**
- 56 server API endpoints under `server/api/**`
- 6 server utils (mongodb, auth, appsheet, sync-events, sync-mapper, invoice-pdf)
- ~40 Vue pages + ~80 non-`ui/` components + 13 composables
- 11 root-level `.js`/`.ts` scripts (debug, fix, seed, test) — most should be deleted or moved to `/scripts/`
- 2 `.DS_Store` files (one inside `public/`)

**Feature areas:** Auth & users, workspaces (permissions), dealers (with contacts + services + invoices + emails), services catalog, work orders, invoices (generate, send, PDF), tasks (kanban), HR employees, AppSheet sync (push/pull/webhook), Resend inbound webhook, daily/weekly automation crons, sales documents (PDFs), settings.

---

## 2. FINDINGS — CRITICAL (fix before any deploy)

> Each item lists the **file**, the **issue**, and the **fix in one line**. Detailed fixes are in the prompt sequence below.

### C-1. Hardcoded production secrets in source code
- `server/utils/mongodb.ts:11` — full MongoDB Atlas URI with admin password is the fallback if env is missing.
- `server/utils/appsheet.ts:8-9` — AppSheet `appId` and `accessKey` hardcoded as fallbacks.
- `fix_user.js:4`, `seed-tasks.js:117`, `test-db.js:3` — same MongoDB URI inline in helper scripts.
- **Fix:** Rotate all three secrets in their respective providers. Delete every fallback. Make missing env vars throw at boot. Then `git filter-repo` (or BFG) to scrub history.

### C-2. Unsigned session tokens
- `server/utils/auth.ts:11` — sessions are pure `base64url(JSON({userId,email,name,role,iat}))`. No HMAC, no signature.
- **Anyone who reads one cookie can forge any user.** Trivial admin impersonation.
- **Fix:** Switch to signed JWTs (HS256) using a `SESSION_SECRET` env var, or use `nuxt-auth-utils` / `h3`'s `setEncryptedCookie`. Reject sessions with bad signatures.

### C-3. Plaintext passwords + login auth bypass
- `server/api/auth/login.post.ts:26` — `if (user.password && user.password !== password)` — comparison is plaintext, and the `&&` short-circuit means **any user record with no `password` field accepts arbitrary input**.
- `server/api/users/index.get.ts:24` — endpoint returns the `password` field to the client. `app/pages/users/[id].vue:45` consumes it.
- `server/utils/sync-mapper.ts` (AppUsersMapper.toMongo:36) — AppSheet round-trips `password` back into Mongo.
- **Fix:** Hash with bcrypt/argon2 on user creation and password change. Strip `password` from every response with a `$project`. Remove the "no password = any password" branch. Strip `password` from AppSheet mappers in both directions.

### C-4. NoSQL operator injection on login
- `server/api/auth/login.post.ts:16-17` — `email` and `password` are read from `readBody` and passed straight to `findOne({ email: {$regex: ...} })`. A request body of `{"email":{"$ne":""}, "password":"x"}` matches the first passwordless user.
- **Fix:** Coerce `email`/`password` to `String(...)` and validate with Zod before any query.

### C-5. ~30 endpoints with no auth check at all
**Mass-takeover surface:**
- `server/api/users/index.{get,post}.ts`, `users/[id].{put,delete}.ts` — anyone can list, create, modify (incl. role + password), or delete users.
- `server/api/workspaces/index.{get,post}.ts`, `workspaces/[id].{put,delete}.ts` — anyone can rewrite the permission set that gates every menu.
- `server/api/invoices/[id].put.ts` — `$set: {...body}` mass-assignment by anonymous users; rewrite any invoice.
- `server/api/invoices/send.post.ts` — open Resend relay. Attacker chooses `to`, `subject`, `html`.
- `server/api/invoices/generate.post.ts` — anyone triggers invoice creation + marks WOs invoiced.
- `server/api/invoices/sync-work-order.post.ts`
- `server/api/services/{index.post.ts,[id].put.ts,[id].delete.ts,import.post.ts}`
- `server/api/dealers/{index.post.ts,[id].patch.ts,[id].get.ts,import.post.ts,services/import.post.ts,services/delete-all.delete.ts}` — last one wipes every dealer's services array + AppSheet rows.
- `server/api/tasks/{index.post.ts,[id].put.ts,[id].delete.ts,board.put.ts}`
- `server/api/settings/index.{get,put}.ts`
- `server/api/emails/index.get.ts` — full read-all-mailboxes for every dealer.
- **Fix:** Add a server-side route middleware that requires `getUserSession(event)` to return a valid signed session for everything under `/api/**` except an allowlist (`/api/auth/login`, `/api/auth/logout`, `/api/auth/me`, public `/api/cron/*` gated by a secret header, public webhook endpoints gated by signature).

### C-6. Public destructive "debug" endpoints (GET = no CSRF protection)
- `server/api/drop-logs.get.ts` — `curl https://app/api/drop-logs` drops the `turboCleanEmailLogs` collection.
- `server/api/clear-emails.get.ts` — `deleteMany({})` on email logs.
- `server/api/fix-invoices-dates.post.ts` — rewrites every invoice's dates.
- `server/api/sync-fixed-to-appsheet.post.ts` — bulk-pushes all WorkOrders to AppSheet, can blow your quota.
- `server/api/tasks/seed.post.ts` — `deleteMany({})` on tasks + reseeds.
- `server/api/debug-db.get.ts` — lists databases and collection counts.
- `server/api/debug-dates.get.ts` — leaks counts.
- **Fix:** Delete every one of these, or move under `/api/admin/*` behind `session.role === 'Admin'`.

### C-7. Public cron endpoints with no secret
- `server/api/cron/process-daily.ts`, `server/api/cron/process-weekly.ts` — anyone hitting these triggers mass invoice generation and **real emails to dealers via Resend**. Resend can also rate-limit your account, so this is also a DoS lever.
- **Fix:** Require `event.node.req.headers.authorization === `Bearer ${process.env.CRON_SECRET}`` or check Vercel's `x-vercel-cron` header.

### C-8. Unsigned webhooks (full takeover chain)
- `server/api/sync/webhook.post.ts` — AppSheet webhook with no signature/shared secret. Caller posts `{table:"AppUsers", action:"edit", row:{_id, role:"Admin"}}` and escalates anyone to admin. Combined with C-3 (passwordless login) and C-2 (forgeable cookies) this is total compromise.
- `server/api/webhooks/resend.post.ts` — Resend webhook with no `svix-signature` verification. Anyone can plant inbound emails on any dealer.
- **Fix:** Add a `SYNC_WEBHOOK_SECRET` header for AppSheet; verify Svix headers on the Resend webhook (Resend's docs).

### C-9. Unauthenticated bulk-import endpoints with raw-stream body parsing
- `server/api/dealers/import.post.ts`, `dealers/services/import.post.ts`, `services/import.post.ts`, `work-orders/import.post.ts` — read body via `event.node.req.on('data')` so Nuxt's body-size limits don't apply. No size limit, no MIME check, no auth.
- **Fix:** Require auth, enforce a max size (e.g., 5 MB), validate file headers, and parse via `readMultipartFormData` if multipart.

### C-10. `sync/pull-from-appsheet.post.ts?mode=replace`
- Anonymous request can `deleteMany({})` every synced collection and reload from AppSheet.
- **Fix:** Auth + admin role + confirm parameter.

### C-11. Client gets passwords back
- `app/pages/users/[id].vue:45` reads `user.password` into a form field; `app/pages/users/index.vue` reads the same field. Server is the leak source (C-3) but the client cooperates.
- **Fix:** Form starts blank for password; "leave blank to keep current" UX; never bind to a response value.

### C-12. Permissions enforced only on the client
- `app/composables/usePermissions.ts` checks `user.permissions` (the menus they can see). The server doesn't check this on any endpoint — anyone who guesses the URL can call it regardless of permission.
- `usePermissions.ts:99` also has `isAdmin === user.email === 'admin@aivisualpro.com'` — a hardcoded magic-email admin check.
- **Fix:** Mirror every permission check on the server. Replace magic-email with `user.role === 'Admin'`.

### C-13. `/settings/workspaces` reachable unauthenticated
- `app/middleware/auth.global.ts:25` includes `/settings/workspaces` in `skipPaths`. The workspaces page edits permission menus.
- **Fix:** Remove from skipPaths.

---

## 3. FINDINGS — HIGH (fix soon)

### H-1. Null-session fall-through on "read" endpoints
Several endpoints check `session && !isAdmin && ...` but if `session` is **null**, both branches fall through and the unfiltered query runs:
- `server/api/work-orders/index.get.ts`
- `server/api/work-orders/tree.get.ts`
- `server/api/invoices/index.get.ts`
- `server/api/invoices/tree.get.ts`
- `server/api/reports/sales-stats.get.ts`
**Fix:** Require a non-null session first; then branch on `isAdmin`.

### H-2. `work-orders/[id].put.ts` writes without requiring auth
- `server/api/work-orders/[id].put.ts:46` — `lastUpdatedBy = session?.name ?? 'Admin'`. Anonymous writes are allowed and stamped "Admin".

### H-3. Mass-assignment via `$set: {...body}` on writes
- `server/api/invoices/[id].put.ts` (entire invoice rewritable, including `total`, `dealerId`)
- `server/api/settings/index.put.ts` (entire settings doc)
- `server/api/tasks/index.post.ts`, `tasks/[id].put.ts`
- `server/api/dealers/[id].patch.ts` (raw `contacts`, `services`)
**Fix:** Whitelist allowed fields per endpoint with Zod schemas; use `$set` only for whitelisted keys.

### H-4. ReDoS via unsanitized user-controlled regex
- `server/api/work-orders/index.get.ts:92` — `{$regex: queryInfo.lastUpdatedBy, $options:'i'}`
- `server/api/invoices/index.get.ts:73-78` — `search`
- `server/api/invoices/tree.get.ts:65-68` — `searchText`
- `server/api/webhooks/resend.post.ts:53` — body subject regex
**Fix:** Escape regex characters (`escape-string-regexp` or a 5-line helper) before passing to Mongo.

### H-5. Invoice number race
- `server/api/invoices/generate.post.ts:71-79` — `invoiceCounter = await countDocuments(); invoiceCounter++` per iteration. Concurrent runs produce duplicate invoice numbers.
**Fix:** Use a counter doc with `{$inc:{seq:1}}` (Mongo's classic pattern) or add `unique: true` index on `number` and retry on dup-key.

### H-6. Settings endpoints likely broken
- `server/api/settings/index.get.ts` and `index.put.ts` start with blank lines and **don't import `connectToDatabase`**. May rely on Nuxt auto-imports; if not, they crash at runtime.
**Fix:** Add explicit imports.

### H-7. Vue 3 `v-for` + `v-if` on the same `<tr>`
- `app/pages/users/index.vue:101-107` and `:147`. Vue 3 gives `v-if` precedence over `v-for`, breaking the list render for non-pending users.
**Fix:** Move the `v-if` to a `<template v-if>` wrapper or change to `v-show`.

### H-8. Non-functional auth pages
- `app/components/auth/SignUp.vue` — submit handler is `setTimeout(3000)`. Same for `ForgotPassword.vue`. No API calls.
- `app/pages/(auth)/otp.vue` has `width="{1920}"` (string `"{1920}"`, not number) — broken image.
**Fix:** Either wire up real APIs (`/api/auth/register`, `/api/auth/reset-password`) or hide the routes.

### H-9. `deleteDealer` is client-only
- `app/composables/useDealers.ts:191-194` — splices local state, no DELETE request. Refresh and the dealer is back. Comment in file says "TODO: add DELETE".
**Fix:** Implement `server/api/dealers/[id].delete.ts`, call from composable.

### H-10. `emails/index.get.ts` leaks every dealer's inbox
- No auth; query by `dealerId` returns subject + HTML + attachments.
**Fix:** Require auth + dealer-scoped permission check.

### H-11. `pages/index.vue` calls `fetchStats()` at setup without await
- `app/pages/index.vue:168` — `if (import.meta.client) fetchStats()` runs synchronously at setup time; races with watch handlers.

### H-12. `DemoItem.vue` uses `cn()` without importing it
- `app/components/navigation-menu/DemoItem.vue` — `cn` lives in `app/lib/utils.ts`. Nuxt only auto-imports from `composables/` and `utils/`, not `lib/`. Runtime error if the component is ever rendered.

### H-13. `BreadcrumbCustom` aside — `DateRangePicker.vue:13` uses `new CalendarDate(2026, 0, 20)`
- `@internationalized/date` is 1-indexed; month `0` throws or normalizes.

### H-14. Crons read the wrong collections
- `server/api/cron/process-daily.ts:8-9` reads `db.collection('settings')` and `db.collection('dealers')`. The rest of the app uses `turboClean*` prefixed collections. Either the crons have been broken since they were written, or there's a parallel set of data being silently maintained.

### H-15. AppSheet sync echoes
- `sync/webhook.post.ts:160-173` uses a 30s time window to avoid echoing local writes back. Any delay >30s causes ghost updates. Idempotency keys would be better.

### H-16. `work-orders/import.post.ts` cascades $fetch calls
- After import, fires N internal `$fetch('/api/invoices/sync-work-order')` calls without await. Can saturate Vercel concurrency.

### H-17. Module-singleton cache leaks across requests
- `server/api/invoices/tree.get.ts:12` and `work-orders/tree.get.ts` — unbounded `Map` cache keyed by `{queryInfo, role, email}`. Survives between users. Memory pressure on long-lived servers + cross-user info leak when sessions are null.

### H-18. SSE listener leak
- `server/api/sync/events.get.ts` — `syncEventBus.setMaxListeners(100)` is a smell. No cleanup on socket error, only on `close`.

---

## 4. FINDINGS — MEDIUM (quality & maintainability)

### M-1. No runtime validation anywhere
Server endpoints read `body` then trust it. The project already has `zod` declared in `devDependencies` — promote it to `dependencies` and add Zod schemas in `server/schemas/*.ts`, parsing with `safeParse` in every endpoint.

### M-2. ObjectId validation inconsistent
Most endpoints do `if (id.length === 24)` checks; some don't. `tasks/[id].delete.ts` throws unhandled 500 on a non-24-hex id. Use `ObjectId.isValid()` everywhere.

### M-3. Inconsistent error response shapes
- Some endpoints `throw createError(...)`, some `return createError(...)` (workspaces files), some return `{success:false, error}`, some swallow.
- Clients can't reliably detect failures.
**Fix:** Pick `throw createError({...})` + a `useApi()` composable on the client that surfaces `status` + `data.message`.

### M-4. No transactions across multi-collection writes
`dealers/import`, `invoices/generate` (touches invoices + workOrders + dealers), `sync/pull-from-appsheet` — all mutate multiple collections without `session.withTransaction`. Risk: partial state on failure.

### M-5. Date-handling bugs (root cause of `fix-invoices-dates.post.ts`)
- `invoices/generate.post.ts` snaps to UTC midnight, while line items are built from `toDateStr(wo.date)`, and notes text-format the wrong date.
- Multiple `test-date.js` / `toDateStr` helpers float around. Unify on one ISO `YYYY-MM-DD` string from one source of truth (the user's TZ, computed once on the server).

### M-6. `add_indexes.js` exists but is never run automatically
- Only invoice-related indexes are created at boot in `mongodb.ts`. Work orders, dealers, services, email logs, tasks have no indexes — queries like `work-orders/index.get.ts` regex-search across the entire collection.
**Fix:** Move index creation into a startup hook or migration runner.

### M-7. Cache leak in `useDealers` and friends
- 7 `console.log` calls in `composables/useDealers.ts` (patchDealer). Plus heavy logs in `sync-mapper.ts`, `dealers/index.get.ts`, `[id].patch.ts`.
**Fix:** Use a `useLogger()` composable that no-ops in production, or just remove.

### M-8. ~1,500 lines of duplicated logic
- Date-range presets duplicated in 5 files (`pages/sales/work-orders.vue`, `sales/invoices.vue`, `dealers/[id]/work-orders.vue`, `dealers/[id]/invoices.vue`, `pages/index.vue`).
- Optimistic CRUD duplicated in `pages/services.vue`, `pages/users/index.vue`, dealers patches.
- 5 near-duplicate error pages (`(error)/401.vue` through `503.vue`).
**Fix:** Composables: `useDateRange`, `useOptimisticList`; one parametric error page.

### M-9. Mega pages (>500 lines) hurting maintainability
- `pages/index.vue` ~742 lines
- `pages/dealers/index.vue` ~763 lines
- `pages/sales/work-orders.vue` >1000 lines
- `pages/sales/invoices.vue`, `pages/dealers/[id]/work-orders.vue` similar
- `pages/(auth)/login.vue` has ~540 lines of Three.js inside a page.
**Fix:** Split into child components + composables.

### M-10. `useKanban` half-stubbed
- `addColumn`, `removeColumn`, `updateColumn`, `persist` are empty no-ops. `addComment` hardcodes `'Alex Morgan'` + `/avatars/adeel.png` instead of the auth user.

### M-11. `useCrud` and `useSalesDocument` are localStorage-only
- Never sync to server. Refresh = data loss. `useSalesDocument.generatePDF` is a 200-line HTML template string in a composable; extract.

### M-12. Dead / demo components shipped to production
- `components/AppSettings.vue` — never imported.
- `components/dashboard/TotalVisitors.vue` — static demo data with hardcoded 2026-04-01 dates.
- `components/mail/*` — Shadcn demo, not wired to real data.
- Most of `components/settings/*Form.vue` — Shadcn templates with `m@example.com` static state.
- `components/auth/OTPForm1.vue`, `OTPForm2.vue` — duplicate variants.
- `components/layout/Auth.vue` — Acme Inc. branding + Sofia Davis testimonial.
**Fix:** Delete what's unused. Wire the rest to real APIs or hide the routes.

### M-13. ~200 `any` types across ~30 files
Especially in `pages/sales/*`, `pages/dealers/*`, `composables/useDealers.ts`, `server/utils/sync-mapper.ts`.

### M-14. Inconsistent ID generation
- `nanoid(8)`, `nanoid(6)`, `Math.random().toString(36).slice(2,10)`, `temp-${Date.now()}`, a custom 24-hex `generateObjectId()` reimplemented in three pages.
**Fix:** One `lib/ids.ts`. Use nanoid for client temp IDs; let Mongo generate `_id` server-side.

### M-15. `mongodb ^7.1.0` is bleeding-edge
- Released Oct 2025. Many tutorials/libraries target v5/v6. Pin to `~7.1.0` and add a CI check.

### M-16. Mis-classified deps in `package.json`
- Runtime-used libs in `devDependencies`: `clsx`, `class-variance-authority`, `tailwind-merge`, `lucide-vue-next`, `zod`, `vee-validate`, `@vee-validate/zod`, `date-fns`, `@vueuse/core`, `@vueuse/math`.
- Types in `dependencies`: `@types/three` (move to dev).
- `@types/node ^25` vs Node 22 runtime — match to `^22`.
- `engines.pnpm: ">=9"` vs `packageManager: pnpm@10.10.0` — tighten to `>=10`.
- Missing `"private": true`.

### M-17. No `.env.example`
- `.gitignore` already keeps `.env.example` un-ignored, but the file doesn't exist. New contributors have no template.

### M-18. `.DS_Store` files committed
- Root and `public/.DS_Store` — the latter is served as a static asset.

### M-19. Service worker
- `public/sw.js` is a no-op (`skipWaiting`, `clients.claim`) but it registers and claims clients. If you don't want a PWA, delete it; if you do, make it actually do something useful and cache version-aware.

### M-20. `nuxt.config.ts` has no `runtimeConfig`
- Server reads `process.env.X` directly. Works but is non-idiomatic and skips Nuxt's startup validation. Move all four secrets into `runtimeConfig`.

### M-21. `add_indexes.js` requires `dotenv` which isn't installed
- Script would crash today.

---

## 5. FINDINGS — LOW (style / polish)

- `require('mongodb')` mixed with ESM imports in `server/api/webhooks/resend.post.ts:69`.
- `admin/notifications.get.ts` returns `[]` — dead stub.
- Inconsistent collection naming: `db.collection('settings')` and `db.collection('dealers')` in crons vs `turboClean*` prefix everywhere else.
- `invoice-pdf.ts:14,32` fetches the logo from a public `raw.githubusercontent.com` URL with `?v=Date.now()` cache-buster — defeats CDN caching.
- `error.vue` hardcodes "404" regardless of error status code.
- `<script setup>` without `lang="ts"` in a few files (`error.vue`, `pages/(error)/*.vue`).
- `DarkToggle.vue` uses UnoCSS attributify (`flex="~ gap-2"`) but project is Tailwind — those attributes are inert.
- `Search.vue` palette searches for a `"Components"` menu group that doesn't exist in `constants/menus.ts`.
- `SidebarNavHeader` accepts a `teams` prop but only uses `teams[0]`.
- `console.log` left in: `server/utils/sync-mapper.ts` (lines 74, 79), `dealers/index.get.ts:39`, `dealers/[id].patch.ts` (14, 59, 66), `composables/useDealers.ts` (7 calls).
- `window.confirm` used in `useDealers.deleteAllDealerServices` instead of the existing AlertDialog.
- All UI strings hardcoded (no i18n) — flag for later if you ever ship outside English.

---

## 6. SEVERITY SUMMARY

| Severity | Count | First action |
|---|---|---|
| Critical | 13 issue groups (~30 endpoints + secrets + auth) | Rotate secrets, sign sessions, hash passwords, add auth middleware, delete debug routes |
| High | 18 | Fix null-session fall-throughs, add input validation, fix the Vue v-for/v-if bug, kill demo auth forms |
| Medium | 21 | Dedup composables, split mega-pages, type cleanup, runtimeConfig, indexes |
| Low | ~10 | Style/cleanup |

---

## 7. ANTIGRAVITY PROMPT SEQUENCE

Each block below is a self-contained prompt. Paste them into Antigravity **in order**. After each, review the diff before accepting and running the next. Promote / commit between phases.

### Phase 0 — Stop the bleeding (do these before touching code)

These are NOT prompts — they're manual actions. Do them in your provider consoles, then move to Prompt 1.

1. **MongoDB Atlas:** rotate the password for the `admin_db_user` user. Update the new URI somewhere safe (you'll paste it in Prompt 1).
2. **AppSheet:** regenerate the application access key from the AppSheet admin → Manage → Integrations → IN tab.
3. **Resend:** revoke the existing API key, create a new one.
4. **Git history scrub (optional but recommended):** if this repo is shared, run `git filter-repo --replace-text expressions.txt` to remove the leaked secrets from history. Force-push only after coordinating with anyone who has the repo.

---

### Prompt 1 — Establish env contract and kill secret fallbacks

```
You are working in a Nuxt 4 project at the repo root. Goal: make every secret come ONLY from env vars; remove all hardcoded fallbacks.

1. Read these files and list every place a secret is hardcoded:
   - server/utils/mongodb.ts
   - server/utils/appsheet.ts
   - fix_user.js
   - seed-tasks.js
   - test-db.js
   - any other root .js/.ts script

2. In server/utils/mongodb.ts:
   - Remove the fallback MongoDB URI on line ~11.
   - Replace with:  const uri = process.env.MONGODB_URI; if (!uri) throw new Error('MONGODB_URI is required');
   - Keep everything else.

3. In server/utils/appsheet.ts:
   - Remove hardcoded APPSHEET_APP_ID and APPSHEET_ACCESS_KEY fallbacks.
   - Read both from process.env and throw if missing at module load time.

4. Update nuxt.config.ts to add a runtimeConfig block that mirrors the four secrets (do NOT set them in runtimeConfig.public):
   runtimeConfig: {
     mongodbUri: '',
     appsheetAppId: '',
     appsheetAccessKey: '',
     resendApiKey: '',
     sessionSecret: '',
     cronSecret: '',
     syncWebhookSecret: '',
     resendWebhookSecret: '',
   }
   (Nuxt will hydrate each from NUXT_MONGODB_URI etc. or you can keep using process.env.MONGODB_URI — pick one and document.)

5. Create a new file at repo root: .env.example
   List every env var name with a one-line comment. NO real values. Include:
   MONGODB_URI=
   APPSHEET_APP_ID=
   APPSHEET_ACCESS_KEY=
   RESEND_API_KEY=
   SESSION_SECRET=          # 32+ random bytes, base64
   CRON_SECRET=             # any 32+ char random string
   SYNC_WEBHOOK_SECRET=     # shared with AppSheet bot
   RESEND_WEBHOOK_SECRET=   # Svix signing secret from Resend dashboard

Do not delete the root scripts yet (we'll handle them later). Do not change any business logic. Show me a diff of every change.
```

---

### Prompt 2 — Sign session cookies (kill the forgery vector)

```
Goal: replace the unsigned base64 session token in server/utils/auth.ts with a signed JWT (HS256), reading the secret from process.env.SESSION_SECRET. Backwards-compat: invalidate any existing cookie (users re-login).

1. Read server/utils/auth.ts.
2. Install jose:  pnpm add jose
3. Rewrite the file:
   - createSessionToken(user): returns await new SignJWT({sub, email, name, role}).setProtectedHeader({alg:'HS256'}).setIssuedAt().setExpirationTime('7d').sign(new TextEncoder().encode(process.env.SESSION_SECRET))
   - verifySessionToken(token): jwtVerify with the same key; return payload or null on any error.
   - setSessionCookie(event, token): same as before but httpOnly, sameSite:'lax', secure in prod, path:'/', maxAge: 7*24*3600.
   - clearSessionCookie(event)
   - getUserSession(event): read cookie, verify, return {userId,email,name,role} or null.
4. If process.env.SESSION_SECRET is missing, throw at module load.
5. Update server/api/auth/login.post.ts and server/api/auth/logout.post.ts and server/api/auth/me.get.ts to use the new helpers.

After this prompt all existing sessions are invalid. Show me the diff.
```

---

### Prompt 3 — Hash passwords and remove the "no password" bypass

```
Goal: store passwords as bcrypt hashes; remove the auth bypass; stop returning passwords to clients.

1. Install bcryptjs:  pnpm add bcryptjs && pnpm add -D @types/bcryptjs
2. In server/api/auth/login.post.ts:
   - Replace email regex lookup with: const email = String((await readBody(event)).email ?? '').trim().toLowerCase(); const password = String((await readBody(event)).password ?? '');
   - findOne({ email }) — no regex, no $regex; the email field should be lower-cased on write.
   - If user.password is missing OR if (await bcrypt.compare(password, user.password)) === false: return 401 'Invalid credentials' (no leak of which one was wrong).
   - On success, issue a JWT (use createSessionToken from utils/auth.ts).
3. Add server/api/auth/change-password.post.ts (requires auth + currentPassword + newPassword).
4. In server/api/users/index.post.ts and users/[id].put.ts: if body.password is present, hash with await bcrypt.hash(password, 12) before write.
5. In server/api/users/index.get.ts and any other endpoint that does .find on the users collection: add { projection: { password: 0 } }.
6. Write a one-time migration script at scripts/migrate-hash-passwords.ts that loops every appUsers/turboCleanAppUsers document, if password looks plaintext (no $2 prefix), bcrypt-hash it in place. Do NOT auto-run it; print instructions.

Show me the diff of every changed file and the new migration script.
```

---

### Prompt 4 — Add a global server auth middleware

```
Goal: every /api/** request requires a valid session, with explicit allowlist for public endpoints. Permission to access a route is still per-endpoint, but unauthenticated callers are 401'd at the gate.

1. Create server/middleware/auth.ts (Nitro auto-loads this — note: not "auth.global"; that's a Nuxt client middleware location).
2. Inside, build an array of allowlisted paths:
   const PUBLIC = [
     '/api/auth/login',
     '/api/auth/logout',
     '/api/auth/me',
     '/api/sync/events',          // SSE; we'll add token-in-query check separately
     '/api/cron/process-daily',   // gated by cron secret header
     '/api/cron/process-weekly',  // gated by cron secret header
     '/api/sync/webhook',         // gated by webhook secret header
     '/api/webhooks/resend',      // gated by Svix signature
   ]
3. For everything that doesn't match PUBLIC and starts with /api/, call getUserSession(event); if null, throw createError({statusCode:401, statusMessage:'Unauthorized'}).
4. For each public endpoint, ALSO add an inline guard at the top of its handler file (defense in depth):
   - cron/process-daily.ts and cron/process-weekly.ts: require header `x-cron-secret` to equal process.env.CRON_SECRET.
   - sync/webhook.post.ts: require header `x-sync-secret` to equal process.env.SYNC_WEBHOOK_SECRET.
   - webhooks/resend.post.ts: verify Svix signature using svix npm package and process.env.RESEND_WEBHOOK_SECRET. Install svix:  pnpm add svix
   - sync/events.get.ts: read session from cookie too (SSE will send the cookie); throw 401 if missing.

5. After this prompt, every other endpoint should be reachable only by authenticated users. Test by running pnpm dev and curling /api/users without a cookie — expect 401.

Show me all new/modified files.
```

---

### Prompt 5 — Delete or quarantine debug & maintenance endpoints

```
Goal: delete the publicly destructive endpoints and admin-gate the ones we want to keep.

DELETE these files entirely:
- server/api/debug-db.get.ts
- server/api/debug-dates.get.ts
- server/api/drop-logs.get.ts
- server/api/clear-emails.get.ts
- server/api/fix-invoices-dates.post.ts
- server/api/sync-fixed-to-appsheet.post.ts
- server/api/tasks/seed.post.ts        # we'll re-add as an admin-only seed under /api/admin/

KEEP and HARDEN (move to /api/admin/ subtree and require session.role === 'Admin'):
- (none for now — re-add if you actually need them later)

After deletion, grep the entire repo for the deleted endpoint paths and remove any client code that calls them. Show me what you removed.
```

---

### Prompt 6 — Lock down user/workspace/settings/services/dealers/invoices/tasks endpoints

```
Goal: every write endpoint requires Admin or owner; every read endpoint requires auth.

For each file below, add at the very top of the handler:
  const session = await getUserSession(event)
  if (!session) throw createError({statusCode:401})
  // for admin-only writes:
  if (session.role !== 'Admin') throw createError({statusCode:403})

ADMIN-ONLY (writes that change permissions, money, mass-data):
- server/api/users/index.post.ts
- server/api/users/[id].put.ts
- server/api/users/[id].delete.ts
- server/api/workspaces/index.post.ts
- server/api/workspaces/[id].put.ts
- server/api/workspaces/[id].delete.ts
- server/api/settings/index.put.ts
- server/api/dealers/services/delete-all.delete.ts
- server/api/dealers/import.post.ts
- server/api/dealers/services/import.post.ts
- server/api/services/import.post.ts
- server/api/work-orders/import.post.ts
- server/api/sync/push-to-appsheet.post.ts
- server/api/sync/pull-from-appsheet.post.ts
- server/api/invoices/send.post.ts
- server/api/invoices/generate.post.ts

AUTH-ONLY (any signed-in user):
- everything else under server/api/ (already covered by the global middleware in Prompt 4, but add an explicit `if (!session)` line at the top of every endpoint for clarity).

Also fix these specific null-session fall-through bugs (currently if session is null both filter branches are skipped and the unfiltered query runs):
- server/api/work-orders/index.get.ts
- server/api/work-orders/tree.get.ts
- server/api/invoices/index.get.ts
- server/api/invoices/tree.get.ts
- server/api/reports/sales-stats.get.ts
- server/api/work-orders/[id].put.ts        # don't accept writes from null session

Rewrite each handler's auth/filter logic as:
  const session = await getUserSession(event)
  if (!session) throw createError({statusCode:401})
  const isAdmin = session.role === 'Admin'
  const matchQuery = isAdmin ? {} : { dealer: { $in: session.registerDealers ?? [] } }

Show me a single combined diff.
```

---

### Prompt 7 — Add Zod validation and stop mass-assignment

```
Goal: every endpoint that reads body validates it with Zod and only $set whitelisted fields.

1. Move zod from devDependencies to dependencies in package.json (also keep @vee-validate/zod).
2. Create server/schemas/ folder with one file per resource. Example:

   // server/schemas/user.ts
   import { z } from 'zod'
   export const UserCreate = z.object({
     name: z.string().min(1),
     email: z.string().email().toLowerCase(),
     password: z.string().min(8),
     role: z.enum(['Admin','Manager','User']).default('User'),
     workspaceId: z.string().min(1).optional(),
     registerDealers: z.array(z.string()).default([]),
   })
   export const UserUpdate = UserCreate.partial().omit({ email: true })

3. Make schemas for: user, workspace, dealer, dealerContact, dealerService, service, workOrder, invoice, invoiceLineItem, task, settings.

4. In every POST/PUT/PATCH endpoint:
   - Replace `const body = await readBody(event)` with `const body = SchemaName.parse(await readBody(event))`.
   - Replace `$set: { ...body }` with `$set: body` (now safe, schema-validated).
   - For ObjectId params: `if (!ObjectId.isValid(id)) throw createError({statusCode:400})`.

5. Escape user-controlled regex inputs. Add server/utils/regex.ts:
   export const escapeRegex = (s: string) => String(s).replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
   Use it in: work-orders/index.get.ts (lastUpdatedBy), invoices/index.get.ts (search), invoices/tree.get.ts (searchText), webhooks/resend.post.ts (subject/sender).

Show me one Zod schema file + one fully-validated endpoint as a sample, then apply the same pattern to the rest in one batched diff.
```

---

### Prompt 8 — Fix invoice number race + add transactions where needed

```
Goal: no more duplicate invoice numbers; multi-collection writes use transactions.

1. Add server/utils/counter.ts:
   export async function nextSequence(db, name): Promise<number> {
     const r = await db.collection('turboCleanCounters').findOneAndUpdate(
       { _id: name },
       { $inc: { seq: 1 } },
       { upsert: true, returnDocument: 'after' }
     )
     return r!.seq
   }

2. In server/api/invoices/generate.post.ts:
   - Remove `let invoiceCounter = await db.collection(...).countDocuments(...)`.
   - For each new invoice, call `const seq = await nextSequence(db, 'invoiceNumber'); const number = `INV-${YYYY}-${String(seq).padStart(5,'0')}``.
   - Wrap the whole "create invoices + mark work orders invoiced" block in a `session.withTransaction()` from the Mongo client. Pass the session to every operation. Roll back on any failure.

3. Add a unique index on `{ number: 1 }` for the invoices collection in server/utils/mongodb.ts's startup index creation block. Catch dup-key errors in generate.post.ts and retry up to 3 times.

Show me both files.
```

---

### Prompt 9 — Fix the broken cron collection names and date handling

```
Goal: stop the cron from reading the wrong collections; centralize date formatting.

1. In server/api/cron/process-daily.ts and server/api/cron/process-weekly.ts:
   - Replace `db.collection('settings')` with `db.collection('turboCleanSettings')`.
   - Replace `db.collection('dealers')` with `db.collection('turboCleanDealers')`.
   - Verify all other collection names match the convention used elsewhere (search for `db.collection(` in both files).

2. Create server/utils/dates.ts:
   export function toDateStr(d: Date | string | undefined): string {
     if (!d) return ''
     const dt = typeof d === 'string' ? new Date(d) : d
     if (isNaN(dt.getTime())) return ''
     return dt.toISOString().slice(0, 10)
   }
   export function startOfDayUTC(s: string): Date { return new Date(`${s}T00:00:00.000Z`) }
   export function endOfDayUTC(s: string): Date { return new Date(`${s}T23:59:59.999Z`) }

3. Grep the repo for any duplicate toDateStr implementations and replace them with the import from server/utils/dates.ts.

4. Delete test-date.js at repo root.

Show me the diff.
```

---

### Prompt 10 — Verify webhook signatures

```
Goal: AppSheet sync webhook and Resend webhook reject unsigned requests.

1. In server/api/sync/webhook.post.ts add at the top:
   const provided = getHeader(event, 'x-sync-secret') ?? ''
   if (!process.env.SYNC_WEBHOOK_SECRET || provided !== process.env.SYNC_WEBHOOK_SECRET) {
     throw createError({ statusCode: 401, statusMessage: 'Bad webhook secret' })
   }
   In AppSheet, set the bot's Webhook Headers to: x-sync-secret: <value of SYNC_WEBHOOK_SECRET>

2. In server/api/webhooks/resend.post.ts:
   - Install svix:  pnpm add svix
   - Read raw body (use `await readRawBody(event)` so signature verification works).
   - const wh = new Webhook(process.env.RESEND_WEBHOOK_SECRET!)
   - const payload = wh.verify(raw, { 'svix-id', 'svix-timestamp', 'svix-signature' } as headers)
   - Continue with the verified payload object.

3. Replace `require('mongodb')` with the proper ESM import at the top.

Show me both files.
```

---

### Prompt 11 — Add bulk-import size limits and auth + parse via multipart

```
Goal: the 4 import endpoints don't bypass body limits, require auth (already done in Prompt 6), and reject non-CSV.

For each of:
- server/api/dealers/import.post.ts
- server/api/dealers/services/import.post.ts
- server/api/services/import.post.ts
- server/api/work-orders/import.post.ts

Replace the raw stream parsing with:
  const parts = await readMultipartFormData(event)
  if (!parts) throw createError({statusCode:400, statusMessage:'multipart required'})
  const file = parts.find(p => p.name === 'file')
  if (!file || !file.filename?.endsWith('.csv')) throw createError({statusCode:400,statusMessage:'CSV only'})
  if (file.data.length > 5 * 1024 * 1024) throw createError({statusCode:413})
  const text = file.data.toString('utf8')
  // proceed with existing CSV parsing using `text`

If the existing client uploads raw JSON instead of multipart, fall back to JSON but enforce a 5 MB limit using a Buffer length check on readRawBody.

Also: in server/api/work-orders/import.post.ts, replace the fire-and-forget $fetch loop with a single internal call that processes all created work orders in one batch (avoid the N+1 internal request explosion).

Show me each modified import endpoint.
```

---

### Phase 1 done — checkpoint

> Commit. Deploy to staging. Run a quick smoke test of login, list users, edit a dealer, generate an invoice. Verify `curl -X POST https://staging/api/users -d '{...}'` returns 401.

---

### Prompt 12 — Strip passwords from the user UI and fix the Vue v-for bug

```
Goal: client never holds a password value; user list renders correctly.

1. In app/pages/users/[id].vue:
   - Replace the form's password binding so it starts at '' and is only sent on save if non-empty.
   - Remove any reference to user.password as a default value.
   - Add helper text: "Leave blank to keep current password".

2. In app/pages/users/index.vue:
   - Find every `<tr v-for="..." v-if="...">` (lines ~101 and ~147).
   - Restructure so `v-if` lives on a `<template v-if>` wrapper that contains the `<tr v-for>`, OR change the `v-if` to a computed-filtered list and remove the inline v-if. Whichever you choose, ensure ALL rows render correctly (Vue 3 forbids v-if + v-for on the same element).

3. Add a UserResponse Zod schema in server/schemas/user.ts (or equivalent) and add an explicit `omit({ password: true })` on the response in server/api/users/index.get.ts and server/api/users/[id].get.ts (if the latter exists). Belt-and-braces on top of Prompt 3 step 5.

Show me each modified file.
```

---

### Prompt 13 — Move /settings/workspaces behind auth + drop hardcoded admin

```
Goal: client-side guard mirrors the server-side check.

1. In app/middleware/auth.global.ts:
   - Remove '/settings/workspaces' from the skipPaths array.
   - Ensure unauthenticated users redirect to /login.

2. In app/composables/usePermissions.ts:
   - Replace `isAdmin: computed(() => user.email === 'admin@aivisualpro.com')` with `isAdmin: computed(() => user.value?.role === 'Admin')`.
   - Audit the rest of the composable for any other email-based checks and replace with role checks.

3. Grep the project for the string 'admin@aivisualpro.com' and replace any remaining occurrences with role-based checks.

Show me the diff.
```

---

### Prompt 14 — Implement actual server-side delete for dealers + fix dead auth pages

```
Goal: the Delete dealer button actually deletes; Register and Forgot Password actually do something (or are removed).

1. Create server/api/dealers/[id].delete.ts:
   - Auth required (Admin), validate ObjectId, deleteOne on turboCleanDealers, also remove the dealerId from every user's registerDealers via updateMany, and remove the dealer's row in AppSheet via the existing AppSheet helper.

2. In app/composables/useDealers.ts:
   - Replace the local-only `deleteDealer` (around line 191) with a $fetch DELETE call, then update local state on success.
   - Remove the 7 console.log calls in patchDealer.
   - Replace window.confirm in deleteAllDealerServices with the existing AlertDialog component (look at how DealerForm.vue invokes AlertDialog).

3. In app/components/auth/SignUp.vue and ForgotPassword.vue:
   - Either wire to real /api/auth/register and /api/auth/reset-password endpoints (creating those endpoints with proper hashing + 1-time tokens), OR remove the routes (app/pages/(auth)/register.vue, forgot-password.vue) and the menu links to them.
   - I want you to ASK ME which option I prefer before doing anything destructive.

4. In app/pages/(auth)/otp.vue, fix `width="{1920}"` and `height="{1080}"` to `:width="1920"` and `:height="1080"` (Vue prop binding, not string literal).

Show me each modified file (and the question about Register/Forgot Password in chat first).
```

---

### Prompt 15 — Extract shared composables (kill duplication)

```
Goal: cut ~1,500 lines of duplicated logic.

1. Create app/composables/useDateRange.ts that exposes:
   const { from, to, presets, setPreset, computedDates } = useDateRange()
   Migrate the date-range preset blocks from:
   - app/pages/sales/work-orders.vue
   - app/pages/sales/invoices.vue
   - app/pages/dealers/[id]/work-orders.vue
   - app/pages/dealers/[id]/invoices.vue
   - app/pages/index.vue
   ...to consume this composable.

2. Create app/composables/useOptimisticList.ts that exposes:
   const { items, refresh, create, update, remove } = useOptimisticList<T>({
     listUrl, createUrl, updateUrl, deleteUrl, idKey: '_id'
   })
   Migrate optimistic CRUD blocks from app/pages/services.vue, app/pages/users/index.vue, and the dealers list to consume this.

3. Replace the 5 near-duplicate error pages (app/pages/(error)/401.vue through 503.vue) with a single dynamic app/pages/(error)/[code].vue that maps codes to titles/messages.

Do this in small commits — one composable extraction per commit. Show me the first migration (date range) as a worked example so I can review the API surface before you touch the other pages.
```

---

### Prompt 16 — Split mega-pages into child components

```
Goal: no page file > 400 lines.

For each of:
- app/pages/index.vue (~742 lines)
- app/pages/dealers/index.vue (~763 lines)
- app/pages/sales/work-orders.vue (>1000 lines)
- app/pages/sales/invoices.vue (>800 lines)
- app/pages/dealers/[id]/work-orders.vue (>800 lines)

Extract sub-components into adjacent files:
- KPI cards → DashboardKpiCards.vue
- Toolbar/filters → <Resource>Toolbar.vue
- Table or list body → <Resource>Table.vue
- Dialogs/forms → <Resource>FormDialog.vue
- Charts → already in components/dashboard/

Also: move the 540-line Three.js animation from app/pages/(auth)/login.vue into app/components/auth/AuthLoginBackground.client.vue. Use prefers-reduced-motion to skip the animation when the user prefers reduced motion.

Tackle one page per commit. Start with app/pages/index.vue and show me the new component tree before continuing.
```

---

### Prompt 17 — Wire or delete demo components

```
Goal: nothing fake ships to production.

1. List every component that's never imported anywhere else in the repo (use grep across app/). Suspects:
   - app/components/AppSettings.vue
   - app/components/dashboard/TotalVisitors.vue (static demo data)
   - app/components/mail/* (Shadcn demo)
   - app/components/auth/OTPForm1.vue, OTPForm2.vue (duplicates of OTPForm.vue)
   - app/components/layout/Auth.vue (Acme Inc. branding + Sofia Davis testimonial)
   - app/components/settings/{Account,Appearance,Display,Notifications,Profile}Form.vue (Shadcn demo state with m@example.com)
   - app/components/navigation-menu/DemoItem.vue (uses cn() without importing it)
2. For each unused component: print the file path and ask me if I want it deleted or kept (some may be planned features).
3. For settings/*Form.vue components: ask me whether to delete the pages that render them (app/pages/settings/{account,appearance,display,notifications,profile}.vue) or wire them to real endpoints (which don't exist yet).
4. Fix the cn() import in app/components/navigation-menu/DemoItem.vue regardless: add `import { cn } from '@/lib/utils'` (or delete the file).

Do nothing destructive until I confirm. Just give me the report.
```

---

### Prompt 18 — Add database indexes

```
Goal: stop full-collection scans on hot queries.

1. In server/utils/mongodb.ts, in the post-connect setup block, add createIndex calls for:
   turboCleanWorkOrders:  { dealer:1, date:-1 }, { date:-1 }, { lastUpdatedBy:1 }, { dealer:1, isInvoiced:1 }
   turboCleanInvoices:    { number:1 } (unique), { dealerId:1, date:-1 }, { date:-1 }, { status:1 }
   turboCleanDealers:     { name:1 } (text or regular?), { displayName:1 }
   turboCleanServices:    { name:1 }, { code:1 }
   turboCleanAppUsers:    { email:1 } (unique)
   turboCleanWorkspaces:  { name:1 } (unique)
   turboCleanEmailLogs:   { dealerId:1, sentAt:-1 }, { receivedAt:-1 }
   turboCleanTasks:       { status:1, order:1 }

2. Use { background: true } where supported.
3. Delete the standalone add_indexes.js at repo root (now redundant).

Show me the diff and run the index list once at boot via console.log so we can verify on next deploy.
```

---

### Prompt 19 — Clean up root scripts and package.json

```
Goal: trim the repo, classify deps correctly.

1. Delete these root files (one-off debug/scratch — no longer needed):
   - fix_test.js
   - fix_user.js
   - test-db.js
   - test-db.ts
   - test-webhook.ts
   - test_locale.js
   - test_pdf.js
   - test_tree.ts
   - test-date.js   (already deleted in Prompt 9)

2. Move seed-tasks.js → scripts/seed/tasks.ts. Wrap the deleteMany({}) in a check:
   if (process.env.NODE_ENV === 'production' && !process.argv.includes('--force')) {
     console.error('Refusing to seed in production without --force'); process.exit(1);
   }

3. Update package.json:
   - Move from devDependencies to dependencies: clsx, class-variance-authority, tailwind-merge, lucide-vue-next, zod, vee-validate, @vee-validate/zod, date-fns, @vueuse/core, @vueuse/math, vue-sonner, vaul-vue.
   - Move from dependencies to devDependencies: @types/three.
   - Change @types/node to ^22.
   - Pin mongodb to ~7.1.0.
   - Set engines.pnpm to ">=10".
   - Add "private": true at top level.
   - Remove the "files" allow-list (this is an app, not a library).

4. Update .gitignore to add:
   .vscode/*
   !.vscode/settings.json
   !.vscode/extensions.json
   *.tsbuildinfo
   coverage/
   ._*

5. Delete the two .DS_Store files (root and public/). Verify .gitignore covers them and `git rm --cached` them if tracked.

6. Update .npmrc to:
   shamefully-hoist=false
   auto-install-peers=true

Show me each change.
```

---

### Prompt 20 — Replace console.log with a real logger

```
Goal: no console.log in server or composables paths in production.

1. Install pino:  pnpm add pino
2. Create server/utils/logger.ts that exports a pino instance configured with level: process.env.LOG_LEVEL ?? 'info'.
3. Grep all server/ and app/composables/ for console.log/console.warn/console.error.
4. Replace each with logger.{debug,info,warn,error}(...). For composables, create a tiny app/composables/useLogger.ts that no-ops in production:
   export const useLogger = () => import.meta.dev ? console : { debug(){}, info(){}, warn(){}, error: console.error }

5. Drop the most spammy logs entirely (sync-mapper.ts lines 74/79; dealers/index.get.ts:39; dealers/[id].patch.ts 14/59/66; composables/useDealers.ts).

Show me the diff.
```

---

### Prompt 21 — Standardize error responses + API client

```
Goal: every server error is shaped the same; every client call surfaces { status, message } predictably.

1. In server/utils, add server/utils/errors.ts:
   export const badRequest = (m='Bad Request') => createError({statusCode:400, statusMessage:m})
   export const unauthorized = () => createError({statusCode:401, statusMessage:'Unauthorized'})
   export const forbidden = () => createError({statusCode:403, statusMessage:'Forbidden'})
   export const notFound = (m='Not Found') => createError({statusCode:404, statusMessage:m})
   export const serverError = (m='Internal') => createError({statusCode:500, statusMessage:m})

2. Replace every `return createError(...)` (which silently returns 200) with `throw createError(...)` across the codebase. Specifically check server/api/workspaces/*.

3. In app/composables, add useApi.ts:
   export const useApi = () => ({
     async get<T>(url: string, opts?) { return $fetch<T>(url, opts) },
     async post<T>(url: string, body: any, opts?) { return $fetch<T>(url, { method:'POST', body, ...opts }) },
     async put<T>(url: string, body: any, opts?) { return $fetch<T>(url, { method:'PUT', body, ...opts }) },
     async del<T>(url: string, opts?) { return $fetch<T>(url, { method:'DELETE', ...opts }) },
   })
   With centralized error handling that toasts on 4xx/5xx.

Show me the new utils + one migration example (e.g., useDealers.ts using useApi).
```

---

### Prompt 22 — Tighten types (kill the worst `any` offenders)

```
Goal: zero `any` in server/utils and composables.

1. Run: rg -n ': any' server/ app/composables/ app/lib/ | head -50
2. For each result, replace with a proper type. For Mongo docs, define interfaces in server/types/db.ts (User, Dealer, DealerContact, Service, WorkOrder, Invoice, Task, Workspace, EmailLog, Settings).
3. Update server/utils/sync-mapper.ts so toMongo / fromMongo are generic with proper input/output types.
4. Tighten emits/props in the top 10 mega-components (run `rg ':\s*any' app/components/ | sort | uniq -c | sort -rn`).

Don't try to make the whole codebase strict in one pass. Aim for server/ + composables/ + lib/. Show me a counter: "any uses before: X / after: Y".
```

---

### Prompt 23 — Production hardening checklist

```
Goal: final pass before deploy.

1. nuxt.config.ts — set `ssr: true` explicitly, set `experimental: { payloadExtraction: false }` if you ever see hydration mismatches; otherwise leave.
2. Add a server/middleware/security-headers.ts that sets:
   - X-Content-Type-Options: nosniff
   - X-Frame-Options: DENY
   - Referrer-Policy: strict-origin-when-cross-origin
   - Strict-Transport-Security: max-age=31536000; includeSubDomains  (only when behind HTTPS)
   - Content-Security-Policy (start with a permissive policy and tighten later)
3. Add rate limiting to /api/auth/login. Use a small in-memory map keyed by IP+email; 10 attempts / 5 min before 429.
4. Configure Resend domain authentication (DKIM/SPF) — flag this for me to do manually in the Resend dashboard.
5. Run `pnpm lint` and fix everything. Run `pnpm typecheck`.
6. Check public/sw.js — if you don't use a PWA, delete it. If you do, version-cache it.

Show me what you changed and what's left for me to do manually.
```

---

### Prompt 24 — Verification + smoke tests

```
Goal: prove the fixes work.

1. Create tests/security.spec.ts (Vitest) that asserts:
   - GET /api/users without cookie → 401
   - POST /api/users with non-admin session → 403
   - POST /api/auth/login with {email:{$ne:''}, password:'x'} → 400 (Zod rejects non-string)
   - POST /api/auth/login with valid creds → 200, sets HttpOnly cookie
   - GET /api/users with admin session → returns array, no `password` field on any record
   - POST /api/invoices/send without auth → 401
   - GET /api/drop-logs → 404 (endpoint deleted)
   - POST /api/sync/webhook without x-sync-secret → 401

2. Add a pnpm script: "test:security": "vitest run tests/security.spec.ts"

3. Document in README.md (create if missing):
   - How to run the app locally
   - Required env vars (point at .env.example)
   - How to run the password-hash migration
   - How to run security tests

Show me the test file, the README, and run pnpm test:security to confirm everything passes against a local dev server.
```

---

## 8. SUGGESTED EXECUTION ORDER

If you have limited time, do prompts in this order and stop when you're satisfied with the risk level:

- **Must-do before any production traffic:** Phase 0 manual rotation → Prompts 1, 2, 3, 4, 5, 6, 7, 10
- **Strongly recommended same week:** Prompts 8, 9, 11, 12, 13, 14
- **Quality-of-life, do whenever:** Prompts 15–22
- **Final polish:** Prompts 23, 24

---

## 9. NOTES FOR THE AGENT (paste into Antigravity's project rules / system prompt)

- This is a Nuxt 4 project. Pages live under `app/pages/`, server endpoints under `server/api/`. Auto-imports cover `app/composables/`, `app/components/`, `app/utils/`, `server/utils/`. They do NOT cover `app/lib/` — files there need explicit imports.
- Use `pnpm` for all installs. The project pins Node 22.x.
- Never reintroduce hardcoded secrets. Every secret is `process.env.X` or `useRuntimeConfig()`.
- Never expose the `password` field from the server.
- When adding endpoints, default to `getUserSession(event)` → 401 → role check → Zod-validated body → operation → typed response.
- When changing collection writes, use `$set` with whitelisted fields only — never `$set: {...body}`.
- Prefer `throw createError(...)` over `return createError(...)`.
- Don't introduce new `any` types. If you need to, leave a `// TODO(types):` comment.
- For destructive scripts under `scripts/`, require `--force` or `--yes` and check NODE_ENV.

---

End of audit + prompt sequence.
