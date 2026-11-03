<script setup lang="ts">
import type { CrmDealership } from '~/composables/useCrmDealerships'
import { Globe, Plus, Trash2, Loader2, Wand2, Car, Sparkles, Link2, ExternalLink, Check, ListChecks } from 'lucide-vue-next'
import { toast } from 'vue-sonner'

/**
 * Scan pages for one dealership — the inventory URLs the scanner covers (each one is paginated on
 * its own). "Detect pages" opens the website in the cloud browser and suggests its inventory pages.
 * Saves to the dealership (`scanPages`), so Scrape and batch scans use the same list.
 */
const props = defineProps<{ dealership: CrmDealership | null }>()
const open = defineModel<boolean>('open', { default: false })
const emit = defineEmits<{ saved: [pages: { url: string, label: string }[]] }>()
const { updateDealership } = useCrmDealerships()

const pages = ref<{ url: string, label: string }[]>([])
const draft = ref('')
const saving = ref(false)
const detecting = ref(false)
interface Found { url: string, label: string, kind: string, cards: number, total: number | null, verified: boolean }
const found = ref<Found[]>([])
const suggestions = ref<Found[]>([])
const detectLog = ref<string[]>([])
const detectNote = ref('')
watch([open, () => props.dealership?.id], () => {
  if (!open.value) return
  pages.value = (props.dealership?.scanPages || []).map(p => ({ ...p }))
  draft.value = ''
  found.value = []
  suggestions.value = []
  detectLog.value = []
  detectNote.value = ''
}, { immediate: true })

const norm = (u: string) => { const t = u.trim(); return t ? (/^https?:\/\//i.test(t) ? t : `https://${t}`) : '' }
const has = (u: string) => pages.value.some(p => p.url.replace(/\/$/, '') === u.replace(/\/$/, ''))
function add(raw: string, label = '') {
  const url = norm(raw)
  if (!url || !/^https?:\/\/[^\s/]+\.[^\s/]+/i.test(url)) return toast.error('That is not a web address')
  if (has(url)) return
  pages.value = [...pages.value, { url, label }]
}
function addDraft() {
  // Accept several lines / commas at once.
  for (const part of draft.value.split(/[\n,]+/)) if (part.trim()) add(part)
  draft.value = ''
}
const remove = (i: number) => { pages.value = pages.value.filter((_, j) => j !== i) }
const KIND_LABEL: Record<string, string> = { used: 'Pre-owned', certified: 'Certified', new: 'New', all: 'Inventory' }
const kindIcon = (k: string) => k === 'new' ? Sparkles : k === 'used' || k === 'certified' ? Car : Globe

/** Server-side discovery: menu links + known platform paths + AI shortlist, each candidate opened and its vehicle cards counted. */
async function detect() {
  if (!props.dealership?.website) return toast.error('This dealership has no website')
  detecting.value = true
  detectNote.value = 'Opening the website, reading its menus and checking each inventory page — 20 to 60 seconds…'
  try {
    const r = await $fetch<any>('/api/scanner/discover', { method: 'POST', body: { dealershipId: props.dealership.id } })
    found.value = r.pages || []
    suggestions.value = r.candidates || []
    detectLog.value = r.log || []
    // Verified pages go straight onto the list (still only saved when you press Save).
    let added = 0
    for (const f of found.value) if (!has(f.url)) { pages.value = [...pages.value, { url: f.url, label: f.label }]; added++ }
    detectNote.value = found.value.length
      ? `${found.value.length} page${found.value.length === 1 ? '' : 's'} verified — ${found.value.reduce((n: number, f: Found) => n + (f.total || f.cards), 0)} vehicles${r.aiUsed ? ' · AI helped read the menus' : ''}${added ? ` · ${added} added below` : ''}`
      : 'No page with vehicle listings was found — try a suggestion or paste the address of the inventory page.'
    if (!found.value.length && !suggestions.value.length) toast('No inventory pages found automatically', { description: 'Paste the inventory page addresses below.' })
  }
  catch (e: any) { detectNote.value = ''; toast.error(e?.data?.message || e?.data?.statusMessage || 'Could not open the website') }
  finally { detecting.value = false }
}
async function save() {
  if (!props.dealership) return
  saving.value = true
  try {
    const d = await updateDealership(props.dealership.id, { scanPages: pages.value } as any)
    emit('saved', d.scanPages || [])
    toast.success(pages.value.length ? `${pages.value.length} scan page${pages.value.length === 1 ? '' : 's'} saved` : 'Scan pages cleared — this dealership will be skipped by scans until pages are picked')
    open.value = false
  }
  catch (e: any) { toast.error(e?.data?.statusMessage || 'Could not save') }
  finally { saving.value = false }
}
const short = (u: string) => u.replace(/^https?:\/\/(www\.)?/, '').replace(/\/$/, '')
</script>

<template>
  <Dialog v-model:open="open">
    <DialogContent class="sm:max-w-2xl">
      <DialogHeader>
        <DialogTitle class="flex items-center gap-2"><ListChecks class="size-4 text-red-600" /> Scan pages — {{ dealership?.name }}</DialogTitle>
        <DialogDescription class="text-xs">The inventory pages the scanner reads for this dealership (used, new, certified…). Each page is followed through all of its result pages. A dealership without pages is never scanned.</DialogDescription>
      </DialogHeader>

      <div class="space-y-4">
        <!-- Current pages -->
        <ul v-if="pages.length" class="rounded-xl border divide-y">
          <li v-for="(p, i) in pages" :key="p.url" class="flex items-center gap-2 px-3 py-2 text-sm">
            <span class="size-6 shrink-0 rounded-md bg-red-600/10 text-red-600 text-[11px] font-semibold flex items-center justify-center tabular-nums">{{ i + 1 }}</span>
            <div class="min-w-0 flex-1">
              <p class="truncate font-medium">{{ p.label || short(p.url) }}</p>
              <p v-if="p.label" class="truncate text-[11px] text-muted-foreground">{{ short(p.url) }}</p>
            </div>
            <a :href="p.url" target="_blank" rel="noopener" class="text-muted-foreground hover:text-foreground" title="Open in my browser"><ExternalLink class="size-3.5" /></a>
            <Button variant="ghost" size="icon" class="size-7 text-muted-foreground hover:text-rose-600" aria-label="Remove" @click="remove(i)"><Trash2 class="size-3.5" /></Button>
          </li>
        </ul>
        <div v-else class="rounded-xl border-2 border-dashed border-amber-500/40 bg-amber-500/5 px-4 py-6 text-center text-sm text-muted-foreground">
          No scan pages yet — this dealership is <b class="text-foreground">skipped</b> by scans until you detect or add its inventory pages.
        </div>

        <!-- Add -->
        <div class="space-y-2">
          <Label class="text-xs">Add page addresses <span class="text-muted-foreground font-normal">(one per line, or paste several)</span></Label>
          <div class="flex gap-2">
            <Textarea v-model="draft" rows="2" class="text-sm min-h-0 font-mono" placeholder="https://www.dealer.com/used-inventory/index.htm" @keydown.enter.exact.prevent="addDraft" />
            <Button variant="outline" class="shrink-0 h-auto gap-1.5" :disabled="!draft.trim()" @click="addDraft"><Plus class="size-4" /> Add</Button>
          </div>
        </div>

        <!-- Detect -->
        <div class="rounded-xl border bg-muted/20 p-3 space-y-2">
          <div class="flex items-center gap-2">
            <Button size="sm" class="h-8 gap-1.5 bg-emerald-600 hover:bg-emerald-700 text-white" :disabled="detecting || !dealership?.website" @click="detect"><Loader2 v-if="detecting" class="size-4 animate-spin" /><Wand2 v-else class="size-4" /> Detect inventory pages</Button>
            <span class="text-[11px] text-muted-foreground">{{ detectNote || `Opens ${dealership?.website ? short(dealership.website) : 'the website'}, reads its menus (AI helps), opens each candidate and keeps only pages that really list vehicles.` }}</span>
          </div>
          <ul v-if="found.length" class="space-y-1">
            <li v-for="f in found" :key="f.url" class="flex items-center gap-2 rounded-lg border border-emerald-500/30 bg-emerald-500/5 px-2.5 py-1.5 text-xs">
              <Check class="size-3.5 text-emerald-600 shrink-0" />
              <span class="font-medium">{{ f.label }}</span>
              <span v-if="KIND_LABEL[f.kind]" class="text-muted-foreground">· {{ KIND_LABEL[f.kind] }}</span>
              <span class="ml-auto tabular-nums text-emerald-700 dark:text-emerald-300">{{ f.total ? `${f.total} vehicles` : `${f.cards}+ on screen` }}</span>
              <Button v-if="!has(f.url)" variant="ghost" size="sm" class="h-6 px-2 text-[11px]" @click="add(f.url, f.label)"><Plus class="size-3" /> Add</Button>
            </li>
          </ul>
          <div v-if="suggestions.length" class="space-y-1">
            <p class="text-[11px] text-muted-foreground">Other menu links that might be inventory (not verified):</p>
            <div class="flex flex-wrap gap-1.5">
              <button v-for="s in suggestions" :key="s.url" type="button" class="inline-flex items-center gap-1.5 rounded-full border bg-background px-2.5 h-7 text-[11px] font-medium hover:border-primary/40 disabled:opacity-50" :title="s.url" :disabled="has(s.url)" @click="add(s.url, s.label)">
                <Check v-if="has(s.url)" class="size-3 text-emerald-600" /><component :is="kindIcon(s.kind)" v-else class="size-3 text-muted-foreground" />
                {{ s.label }}<span v-if="KIND_LABEL[s.kind]" class="text-muted-foreground">· {{ KIND_LABEL[s.kind] }}</span>
              </button>
            </div>
          </div>
          <details v-if="detectLog.length" class="text-[11px] text-muted-foreground"><summary class="cursor-pointer">What was checked</summary><pre class="mt-1 whitespace-pre-wrap font-mono text-[10px] leading-4">{{ detectLog.join('\n') }}</pre></details>
        </div>
      </div>

      <DialogFooter>
        <Button variant="ghost" @click="open = false">Cancel</Button>
        <Button :disabled="saving" class="min-w-28 gap-1.5" @click="save"><Loader2 v-if="saving" class="size-4 animate-spin" /><Link2 v-else class="size-4" /> Save pages</Button>
      </DialogFooter>
    </DialogContent>
  </Dialog>
</template>
