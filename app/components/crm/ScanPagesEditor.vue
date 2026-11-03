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
const suggestions = ref<{ label: string, href: string, kind: string }[]>([])
watch([open, () => props.dealership?.id], () => {
  if (!open.value) return
  pages.value = (props.dealership?.scanPages || []).map(p => ({ ...p }))
  draft.value = ''
  suggestions.value = []
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

async function detect() {
  if (!props.dealership?.website) return toast.error('This dealership has no website')
  detecting.value = true
  try {
    const p = await $fetch<any>('/api/scanner/preview', { method: 'POST', body: { dealershipId: props.dealership.id } })
    const seen = new Set<string>()
    const list = [...(p.navLinks || []), ...(p.pages || []).filter((x: any) => ['used', 'certified', 'new', 'all'].includes(x.kind))]
      .filter((x: any) => { if (seen.has(x.href)) return false; seen.add(x.href); return true })
      .slice(0, 24)
    suggestions.value = list
    if (!list.length) toast('No inventory pages found automatically', { description: 'Paste the inventory page addresses below.' })
  }
  catch (e: any) { toast.error(e?.data?.message || e?.data?.statusMessage || 'Could not open the website') }
  finally { detecting.value = false }
}
async function save() {
  if (!props.dealership) return
  saving.value = true
  try {
    const d = await updateDealership(props.dealership.id, { scanPages: pages.value } as any)
    emit('saved', d.scanPages || [])
    toast.success(pages.value.length ? `${pages.value.length} scan page${pages.value.length === 1 ? '' : 's'} saved` : 'Scan pages cleared — the website home page will be used')
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
        <DialogDescription class="text-xs">The inventory pages the scanner reads for this dealership (used, new, certified…). Each page is followed through all of its result pages. Leave empty to start from the website home page.</DialogDescription>
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
        <div v-else class="rounded-xl border-2 border-dashed px-4 py-6 text-center text-sm text-muted-foreground">
          No scan pages yet — the scanner will start from <b class="text-foreground">{{ dealership?.website ? short(dealership.website) : 'the website' }}</b>.
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
            <Button size="sm" variant="outline" class="h-8 gap-1.5" :disabled="detecting || !dealership?.website" @click="detect"><Loader2 v-if="detecting" class="size-4 animate-spin" /><Wand2 v-else class="size-4" /> Detect inventory pages</Button>
            <span class="text-[11px] text-muted-foreground">Opens {{ dealership?.website ? short(dealership.website) : 'the website' }} in the cloud browser and lists its inventory menus.</span>
          </div>
          <div v-if="suggestions.length" class="flex flex-wrap gap-1.5">
            <button v-for="s in suggestions" :key="s.href" type="button" class="inline-flex items-center gap-1.5 rounded-full border bg-background px-2.5 h-7 text-[11px] font-medium hover:border-primary/40 disabled:opacity-50" :title="s.href" :disabled="has(s.href)" @click="add(s.href, s.label)">
              <Check v-if="has(s.href)" class="size-3 text-emerald-600" /><component :is="kindIcon(s.kind)" v-else class="size-3 text-muted-foreground" />
              {{ s.label }}<span v-if="KIND_LABEL[s.kind]" class="text-muted-foreground">· {{ KIND_LABEL[s.kind] }}</span>
            </button>
          </div>
        </div>
      </div>

      <DialogFooter>
        <Button variant="ghost" @click="open = false">Cancel</Button>
        <Button :disabled="saving" class="min-w-28 gap-1.5" @click="save"><Loader2 v-if="saving" class="size-4 animate-spin" /><Link2 v-else class="size-4" /> Save pages</Button>
      </DialogFooter>
    </DialogContent>
  </Dialog>
</template>
