// Bumps the app version (version.json) once per push.
// Runs from the git pre-commit hook (.githooks/pre-commit).
//
// Rule: 2.1.1 → 2.1.2 → … → 2.1.9 → 2.2.0 → … → 2.9.9 → 3.0.0
// The first commit after a push bumps the version; further commits before
// the next push keep it, so every push carries exactly one new version.
import { execSync } from 'node:child_process'
import { existsSync, readFileSync, writeFileSync } from 'node:fs'

const FILE = 'version.json'

function sh(cmd) {
  try { return execSync(cmd, { stdio: ['ignore', 'pipe', 'ignore'] }).toString().trim() }
  catch { return null }
}
function parse(json) {
  try { return JSON.parse(json).version || null }
  catch { return null }
}
export function nextVersion(v) {
  let [major, minor, patch] = String(v).split('.').map(n => Number.parseInt(n, 10) || 0)
  patch += 1
  if (patch > 9) { patch = 0; minor += 1 }
  if (minor > 9) { minor = 0; major += 1 }
  return `${major}.${minor}.${patch}`
}

if (!existsSync(FILE)) process.exit(0)
const current = parse(readFileSync(FILE, 'utf8'))
if (!current) process.exit(0)

// Version that is already on the remote (what was pushed last time)
const upstream = sh('git rev-parse --abbrev-ref --symbolic-full-name @{u}')
const pushed = upstream ? parse(sh(`git show ${upstream}:${FILE}`) || '') : null

if (pushed && current === pushed) {
  const next = nextVersion(current)
  writeFileSync(FILE, `${JSON.stringify({ version: next }, null, 2)}\n`)
  console.log(`[version] ${current} → ${next}`)
}
// Not pushed yet, or already bumped since the last push: keep it as is.
sh(`git add ${FILE}`)
