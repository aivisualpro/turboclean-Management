// One-off MongoDB cluster copy: OLD_URI -> NEW_URI
// Usage (from the project folder):
//   env OLD_URI='...' NEW_URI='...' node db-migration/migrate-cluster.mjs inspect
//   env OLD_URI='...' NEW_URI='...' node db-migration/migrate-cluster.mjs copy     (refuses if target DB not empty)
//   env OLD_URI='...' NEW_URI='...' node db-migration/migrate-cluster.mjs copy --replace   (drops target DBs first; for the final re-sync)
//   env OLD_URI='...' NEW_URI='...' node db-migration/migrate-cluster.mjs verify
// Copies every database (except admin/local/config): collections with their options
// (validators, collation, TTL, capped...), all documents with exact BSON types, all
// indexes, views and Atlas Search indexes. Never writes to OLD_URI.
import { MongoClient } from 'mongodb'
import crypto from 'node:crypto'

const OLD = process.env.OLD_URI, NEW = process.env.NEW_URI
const mode = process.argv[2] || 'inspect'
const replace = process.argv.includes('--replace')
if (!OLD || !NEW) { console.error('Set OLD_URI and NEW_URI'); process.exit(1) }
if (OLD === NEW) { console.error('OLD_URI and NEW_URI are the same'); process.exit(1) }

const SKIP_DBS = new Set(['admin', 'local', 'config'])
const KEEP_TYPES = { promoteValues: false, promoteLongs: false, promoteBuffers: false, bsonRegExp: true }
const src = new MongoClient(OLD, { readPreference: 'primary', serverSelectionTimeoutMS: 20000 })
const dst = new MongoClient(NEW, { serverSelectionTimeoutMS: 20000, retryWrites: true, w: 'majority' })
const log = (...a) => console.log(...a)
const mb = b => (b / 1048576).toFixed(2) + ' MB'

async function dbList(client) {
  const r = await client.db('admin').command({ listDatabases: 1, nameOnly: false })
  return r.databases.filter(d => !SKIP_DBS.has(d.name))
}
async function colls(db) {
  return (await db.listCollections({}, { nameOnly: false }).toArray()).filter(c => !c.name.startsWith('system.'))
}
async function searchIdx(coll) { try { return await coll.listSearchIndexes().toArray() } catch { return null } }
async function clusterInfo(client, label) {
  const h = await client.db('admin').command({ hello: 1 })
  let v = '?'; try { v = (await client.db('admin').command({ buildInfo: 1 })).version } catch {}
  log(`${label}: MongoDB ${v}  setName=${h.setName}  tags=${JSON.stringify(h.tags || {})}`)
}

async function inspect() {
  for (const [label, client] of [['OLD', src], ['NEW', dst]]) {
    await clusterInfo(client, label)
    const dbs = await dbList(client)
    if (!dbs.length) log('  (no user databases)')
    for (const d of dbs) {
      const db = client.db(d.name)
      const cs = await colls(db)
      log(`  db ${d.name}  sizeOnDisk=${mb(d.sizeOnDisk || 0)}  collections=${cs.length}`)
      for (const c of cs) {
        if (c.type === 'view') { log(`    [view] ${c.name} on ${c.options.viewOn}`); continue }
        const coll = db.collection(c.name)
        const n = await coll.estimatedDocumentCount()
        const ix = await coll.listIndexes().toArray()
        const si = await searchIdx(coll)
        log(`    ${c.name.padEnd(40)} docs=${String(n).padStart(7)}  indexes=${ix.length}${si && si.length ? '  searchIndexes=' + si.length : ''}${Object.keys(c.options || {}).length ? '  options=' + Object.keys(c.options).join(',') : ''}`)
      }
    }
  }
}

async function copy() {
  await clusterInfo(src, 'OLD'); await clusterInfo(dst, 'NEW')
  const dbs = await dbList(src)
  const existing = await dbList(dst)
  const clash = existing.filter(e => dbs.some(d => d.name === e.name))
  if (clash.length && !replace) {
    console.error(`Target already has database(s): ${clash.map(c => c.name).join(', ')}. Re-run with --replace to drop & recopy them.`)
    process.exit(2)
  }
  for (const d of dbs) {
    const sdb = src.db(d.name), tdb = dst.db(d.name)
    if (replace && clash.some(c => c.name === d.name)) { log(`Dropping target db ${d.name}`); await tdb.dropDatabase() }
    const cs = await colls(sdb)
    const views = cs.filter(c => c.type === 'view'), real = cs.filter(c => c.type !== 'view')
    for (const c of real) {
      const t0 = Date.now()
      const opts = { ...(c.options || {}) }
      delete opts.uuid
      await tdb.createCollection(c.name, opts)
      const scoll = sdb.collection(c.name), tcoll = tdb.collection(c.name)
      // documents
      let batch = [], bytes = 0, n = 0
      const flush = async () => { if (!batch.length) return; await tcoll.insertMany(batch, { ordered: true, bypassDocumentValidation: true }); n += batch.length; batch = []; bytes = 0 }
      for await (const doc of scoll.find({}, { ...KEEP_TYPES, sort: { _id: 1 }, batchSize: 1000 })) {
        batch.push(doc); bytes += 1
        if (batch.length >= 1000) await flush()
      }
      await flush()
      // indexes
      const ix = (await scoll.listIndexes().toArray()).filter(i => i.name !== '_id_' && !i.clustered)
      if (ix.length) {
        const specs = ix.map(({ v, ns, ...rest }) => rest)
        await tdb.command({ createIndexes: c.name, indexes: specs })
      }
      // Atlas Search indexes
      const si = await searchIdx(scoll)
      let siNote = ''
      if (si && si.length) {
        try {
          await tcoll.createSearchIndexes(si.map(s => ({ name: s.name, type: s.type, definition: s.latestDefinition || s.definition })))
          siNote = `  searchIndexes=${si.length}`
        } catch (e) { siNote = `  searchIndexes FAILED: ${e.message}` }
      }
      log(`  ${d.name}.${c.name.padEnd(40)} ${String(n).padStart(7)} docs  ${ix.length + 1} indexes${siNote}  (${((Date.now() - t0) / 1000).toFixed(1)}s)`)
    }
    for (const v of views) {
      const { viewOn, pipeline, collation } = v.options
      await tdb.createCollection(v.name, { viewOn, pipeline, ...(collation ? { collation } : {}) })
      log(`  ${d.name}.${v.name} [view] created`)
    }
  }
  log('COPY DONE — now run: verify')
}

async function collHash(coll) {
  const h = crypto.createHash('sha256'); let n = 0
  for await (const raw of coll.find({}, { raw: true, sort: { _id: 1 }, batchSize: 1000 })) { h.update(raw); n++ }
  return { n, hash: h.digest('hex') }
}
const ixSig = ix => JSON.stringify(ix.map(({ v, ns, ...r }) => r).sort((a, b) => a.name.localeCompare(b.name)))

async function verify() {
  let bad = 0, total = 0
  for (const d of await dbList(src)) {
    const sdb = src.db(d.name), tdb = dst.db(d.name)
    const tnames = new Map((await colls(tdb)).map(c => [c.name, c]))
    for (const c of await colls(sdb)) {
      total++
      const t = tnames.get(c.name)
      if (!t) { log(`  MISSING  ${d.name}.${c.name}`); bad++; continue }
      if (c.type === 'view') { const ok = JSON.stringify(c.options) === JSON.stringify(t.options); log(`  ${ok ? 'OK      ' : 'DIFF    '} ${d.name}.${c.name} [view]`); if (!ok) bad++; continue }
      const [a, b] = await Promise.all([collHash(sdb.collection(c.name)), collHash(tdb.collection(c.name))])
      const [ia, ib] = await Promise.all([sdb.collection(c.name).listIndexes().toArray(), tdb.collection(c.name).listIndexes().toArray()])
      const optA = { ...c.options }; delete optA.uuid; const optB = { ...t.options }; delete optB.uuid
      const docsOk = a.hash === b.hash, ixOk = ixSig(ia) === ixSig(ib), optOk = JSON.stringify(optA) === JSON.stringify(optB)
      const ok = docsOk && ixOk && optOk
      if (!ok) bad++
      log(`  ${ok ? 'OK      ' : 'DIFF    '} ${(d.name + '.' + c.name).padEnd(52)} docs ${a.n}/${b.n}${docsOk ? '' : ' CONTENT-DIFF'}  idx ${ia.length}/${ib.length}${ixOk ? '' : ' INDEX-DIFF'}${optOk ? '' : ' OPTIONS-DIFF'}`)
    }
  }
  log(bad ? `VERIFY FAILED: ${bad} of ${total} collections differ` : `VERIFY PASSED: all ${total} collections identical (byte-for-byte documents, indexes, options)`)
  if (bad) process.exitCode = 3
}

try {
  await src.connect(); await dst.connect()
  if (mode === 'inspect') await inspect()
  else if (mode === 'copy') await copy()
  else if (mode === 'verify') await verify()
  else console.error('mode must be inspect | copy | verify')
} catch (e) { console.error('ERROR:', e.message); process.exitCode = 1 }
finally { await src.close(); await dst.close() }
