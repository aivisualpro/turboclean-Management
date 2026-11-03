<script setup lang="ts">
import type { AuditInput, CrmAudit, CrmDealership } from '~/composables/useCrmDealerships'
import { ClipboardCheck, Loader2, Link2, Plus, X, Camera, Car, Globe, ImageOff, Store, AlertTriangle, History } from 'lucide-vue-next'
import { toast } from 'vue-sonner'
import { MERCHANDISING_ISSUES, WEBSITE_ISSUES } from '~/constants/crm'

/**
 * Record a dealership website / inventory audit. Every submission is a new,
 * immutable snapshot — the previous audit is shown for reference only.
 */
const isOpen = defineModel<boolean>('open', { default: false })
const props = defineProps<{ dealership: CrmDealership | null, previous?: CrmAudit | null }>()
const emit = defineEmits<{ saved: [a: CrmAudit] }>()
const { recordAudit } = useCrmDealerships()
const { uploadImage } = useCrmEmail()
// Evidence screenshot — shown in the "Missing Photos" email as {{auditScreenshot}}.
const shot = ref<{ id: string, name: string, preview: string } | null>(null)
const uploading = ref(false)
const fileInput = ref<HTMLInputElement | null>(null)
async function onShot(e: Event) {
  const file = (e.target as HTMLInputElement).files?.[0]
  if (!file) return
  if (!/^image\/(png|jpe?g|webp|gif)$/.test(file.type)) return toast.error('Use a PNG, JPG, WebP or GIF image')
  if (file.size > 2 * 1024 * 1024) return toast.error('Image is larger than 2 MB — crop or compress it first')
  uploading.value = true
  try {
    const dataUrl = await new Promise<string>((res, rej) => { const r = new FileReader(); r.onload = () => res(String(r.result)); r.onerror = rej; r.readAsDataURL(file) })
    const f = await uploadImage(dataUrl, file.name, props.dealership?.id)
    shot.value = { id: f.id, name: f.filename, preview: dataUrl }
  } catch (err: any) { toast.error(err?.data?.statusMessage || 'Upload failed') } finally { uploading.value = false; if (fileInput.value) fileInput.value.value = '' }
}

const today = () => new Date().toISOString().slice(0, 10)
type FormState = Omit<AuditInput, 'newTotal' | 'usedTotal' | 'newMissingPhotos' | 'usedMissingPhotos' | 'poorPhotoSets' | 'examples'> & {
  newTotal: string | number, usedTotal: string | number, newMissingPhotos: string | number, usedMissingPhotos: string | number, poorPhotoSets: string | number
  examples: { url: string, label: string }[]
}
const blank = (): FormState => ({
  auditedAt: today(), inventoryUrl: '', newTotal: '', usedTotal: '', newMissingPhotos: '', usedMissingPhotos: '',
  poorPhotoSets: '', poorPhotoSetsNotes: '', merchandisingIssues: [], merchandisingNotes: '', websiteIssues: [], websiteIssuesNotes: '', notes: '', examples: [],
})
const form = ref(blank())
const saving = ref(false)
const errors = ref<Record<string, string>>({})

watch(isOpen, (o) => {
  if (!o) return
  form.value = blank()
  shot.value = null
  errors.value = {}
  const site = props.dealership?.website || ''
  form.value.inventoryUrl = props.previous?.inventoryUrl || (site ? site.replace(/\/$/, '') + '/inventory' : '')
})

const n = (v: any) => (v === '' || v === null || v === undefined) ? null : Number(v)
const totals = computed(() => {
  const nt = n(form.value.newTotal) ?? 0, ut = n(form.value.usedTotal) ?? 0, nm = n(form.value.newMissingPhotos) ?? 0, um = n(form.value.usedMissingPhotos) ?? 0
  const total = nt + ut, missing = nm + um
  const p = (a: number, b: number) => b > 0 ? Math.round(a / b * 1000) / 10 : null
  return { total, missing, pct: p(missing, total), newPct: p(nm, nt), usedPct: p(um, ut) }
})
const delta = computed(() => {
  if (!props.previous || props.previous.missingPhotoPct === null || totals.value.pct === null) return null
  return Math.round((totals.value.pct - props.previous.missingPhotoPct) * 10) / 10
})

function toggle(list: 'merchandisingIssues' | 'websiteIssues', v: string) {
  const arr = form.value[list] || []
  form.value[list] = arr.includes(v) ? arr.filter(x => x !== v) : [...arr, v]
}
function addExample() { form.value.examples.push({ url: '', label: '' }) }
function removeExample(i: number) { form.value.examples.splice(i, 1) }

function validate() {
  const e: Record<string, string> = {}
  const nt = n(form.value.newTotal), ut = n(form.value.usedTotal), nm = n(form.value.newMissingPhotos), um = n(form.value.usedMissingPhotos)
  if (nt === null && ut === null) e.totals = 'Enter at least one inventory count'
  for (const [k, v] of Object.entries({ newTotal: nt, usedTotal: ut, newMissingPhotos: nm, usedMissingPhotos: um }))
    if (v !== null && (!Number.isFinite(v) || v < 0)) e[k] = 'Must be 0 or more'
  if (nm !== null && nt !== null && nm > nt) e.newMissingPhotos = 'Cannot exceed total new'
  if (um !== null && ut !== null && um > ut) e.usedMissingPhotos = 'Cannot exceed total used'
  if (!form.value.auditedAt) e.auditedAt = 'Audit date is required'
  if (form.value.auditedAt && new Date(form.value.auditedAt) > new Date(Date.now() + 86_400_000)) e.auditedAt = 'Cannot be in the future'
  errors.value = e
  return !Object.keys(e).length
}

async function submit() {
  if (!props.dealership || !validate()) return
  saving.value = true
  try {
    const a = await recordAudit(props.dealership.id, {
      ...form.value,
      newTotal: n(form.value.newTotal) ?? 0, usedTotal: n(form.value.usedTotal) ?? 0,
      newMissingPhotos: n(form.value.newMissingPhotos) ?? 0, usedMissingPhotos: n(form.value.usedMissingPhotos) ?? 0,
      poorPhotoSets: n(form.value.poorPhotoSets),
      examples: form.value.examples.filter(x => x.url.trim()),
      screenshotFileId: shot.value?.id || null,
    })
    toast.success('Audit recorded', { description: `${a.totalVehicles} vehicles · ${a.missingPhotoPct ?? '—'}% missing photos` })
    emit('saved', a); isOpen.value = false
  } catch (err: any) {
    toast.error(err?.data?.statusMessage || err?.message || 'Could not save audit')
  } finally { saving.value = false }
}
</script>

<template>
  <Sheet v-model:open="isOpen">
    <SheetContent side="right" class="w-full sm:max-w-2xl p-0 flex flex-col gap-0">
      <SheetHeader class="px-6 pt-6 pb-4 border-b">
        <div class="flex items-start gap-3">
          <div class="size-10 rounded-xl bg-violet-500/10 flex items-center justify-center shrink-0"><ClipboardCheck class="size-5 text-violet-600 dark:text-violet-400" /></div>
          <div class="min-w-0">
            <SheetTitle class="text-base">Record inventory audit</SheetTitle>
            <SheetDescription class="text-xs">{{ dealership?.name }} · saved as a new snapshot — earlier audits are never overwritten.</SheetDescription>
          </div>
        </div>
      </SheetHeader>

      <form id="audit-form" class="flex-1 overflow-y-auto px-6 py-5 space-y-7" @submit.prevent="submit">
        <!-- Previous audit reference -->
        <div v-if="previous" class="rounded-lg border border-dashed bg-muted/30 px-3 py-2 text-xs text-muted-foreground flex flex-wrap items-center gap-x-4 gap-y-1">
          <span class="inline-flex items-center gap-1.5 font-medium text-foreground"><History class="size-3.5" /> Last audit {{ new Date(previous.auditedAt).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }) }}</span>
          <span>{{ previous.totalVehicles }} vehicles</span>
          <span>{{ previous.missingPhotoPct ?? '—' }}% missing photos</span>
          <span v-if="previous.poorPhotoSets !== null">{{ previous.poorPhotoSets }} poor sets</span>
        </div>

        <!-- When & where -->
        <section class="grid grid-cols-1 sm:grid-cols-[160px_1fr] gap-4">
          <div class="space-y-1.5">
            <Label for="au-date">Audit date <span class="text-destructive">*</span></Label>
            <Input id="au-date" v-model="form.auditedAt" type="date" :max="today()" :aria-invalid="!!errors.auditedAt" />
            <p v-if="errors.auditedAt" class="text-xs text-destructive">{{ errors.auditedAt }}</p>
          </div>
          <div class="space-y-1.5">
            <Label for="au-url">Inventory URL audited</Label>
            <div class="relative"><Globe class="absolute left-3 top-1/2 -translate-y-1/2 size-4 text-muted-foreground" /><Input id="au-url" v-model="form.inventoryUrl" placeholder="https://dealer.com/inventory" class="pl-9" /></div>
          </div>
        </section>

        <!-- Counts -->
        <section class="space-y-3">
          <h4 class="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground flex items-center gap-2"><Car class="size-3.5" /> Inventory counts</h4>
          <div class="rounded-xl border overflow-hidden">
            <div class="grid grid-cols-[1fr_120px_140px] text-[11px] uppercase tracking-wider text-muted-foreground bg-muted/40 border-b">
              <div class="px-3 py-2"></div><div class="px-3 py-2">Total</div><div class="px-3 py-2">Missing photos</div>
            </div>
            <div class="grid grid-cols-[1fr_120px_140px] items-center border-b">
              <div class="px-3 py-2.5 text-sm font-medium">New vehicles</div>
              <div class="px-2 py-1.5"><Input v-model="form.newTotal" type="number" min="0" inputmode="numeric" placeholder="0" class="h-8 tabular-nums" :aria-invalid="!!errors.newTotal" /></div>
              <div class="px-2 py-1.5"><Input v-model="form.newMissingPhotos" type="number" min="0" inputmode="numeric" placeholder="0" class="h-8 tabular-nums" :aria-invalid="!!errors.newMissingPhotos" /></div>
            </div>
            <div class="grid grid-cols-[1fr_120px_140px] items-center border-b">
              <div class="px-3 py-2.5 text-sm font-medium">Used vehicles</div>
              <div class="px-2 py-1.5"><Input v-model="form.usedTotal" type="number" min="0" inputmode="numeric" placeholder="0" class="h-8 tabular-nums" :aria-invalid="!!errors.usedTotal" /></div>
              <div class="px-2 py-1.5"><Input v-model="form.usedMissingPhotos" type="number" min="0" inputmode="numeric" placeholder="0" class="h-8 tabular-nums" :aria-invalid="!!errors.usedMissingPhotos" /></div>
            </div>
            <div class="grid grid-cols-[1fr_120px_140px] items-center bg-muted/20 text-sm">
              <div class="px-3 py-2.5 font-semibold">Total</div>
              <div class="px-3 py-2.5 tabular-nums font-semibold">{{ totals.total }}</div>
              <div class="px-3 py-2.5 tabular-nums font-semibold">{{ totals.missing }}</div>
            </div>
          </div>
          <p v-for="k in ['totals','newMissingPhotos','usedMissingPhotos','newTotal','usedTotal']" v-show="errors[k]" :key="k" class="text-xs text-destructive">{{ errors[k] }}</p>

          <!-- Live computed result -->
          <div class="rounded-xl border bg-card p-4 flex flex-wrap items-center gap-6">
            <div>
              <p class="text-[11px] uppercase tracking-wider text-muted-foreground">Missing-photo rate</p>
              <p class="text-3xl font-bold tabular-nums tracking-tight" :class="totals.pct === null ? 'text-muted-foreground' : totals.pct >= 25 ? 'text-rose-600 dark:text-rose-400' : totals.pct >= 10 ? 'text-amber-600 dark:text-amber-400' : 'text-emerald-600 dark:text-emerald-400'">
                {{ totals.pct === null ? '—' : `${totals.pct}%` }}
              </p>
              <p v-if="delta !== null" class="text-xs" :class="delta > 0 ? 'text-rose-600' : delta < 0 ? 'text-emerald-600' : 'text-muted-foreground'">{{ delta > 0 ? '▲' : delta < 0 ? '▼' : '•' }} {{ Math.abs(delta) }} pts vs last audit</p>
            </div>
            <div class="h-10 w-px bg-border hidden sm:block" />
            <dl class="grid grid-cols-2 gap-x-6 gap-y-1 text-sm">
              <dt class="text-muted-foreground">New</dt><dd class="tabular-nums font-medium">{{ totals.newPct === null ? '—' : `${totals.newPct}%` }}</dd>
              <dt class="text-muted-foreground">Used</dt><dd class="tabular-nums font-medium">{{ totals.usedPct === null ? '—' : `${totals.usedPct}%` }}</dd>
            </dl>
            <p class="text-[11px] text-muted-foreground ml-auto max-w-[200px]">Computed automatically — the same formula is used for automated audits.</p>
          </div>
        </section>

        <!-- Photo quality -->
        <section class="space-y-3">
          <h4 class="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground flex items-center gap-2"><Camera class="size-3.5" /> Photo quality</h4>
          <div class="grid grid-cols-1 sm:grid-cols-[180px_1fr] gap-4">
            <div class="space-y-1.5">
              <Label for="au-poor">Incomplete / poor photo sets</Label>
              <Input id="au-poor" v-model="form.poorPhotoSets" type="number" min="0" inputmode="numeric" placeholder="If known" class="tabular-nums" />
            </div>
            <div class="space-y-1.5">
              <Label for="au-poor-notes">What's wrong with them</Label>
              <Input id="au-poor-notes" v-model="form.poorPhotoSetsNotes" placeholder="e.g. 3–5 photos per car, no interior shots, lot photos only" />
            </div>
          </div>
        </section>

        <!-- Merchandising -->
        <section class="space-y-3">
          <h4 class="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground flex items-center gap-2"><Store class="size-3.5" /> Missing merchandising</h4>
          <div class="flex flex-wrap gap-1.5">
            <button v-for="m in MERCHANDISING_ISSUES" :key="m" type="button" class="rounded-full border px-2.5 py-1 text-xs transition-colors" :class="form.merchandisingIssues?.includes(m) ? 'bg-violet-500/10 border-violet-500/40 text-violet-700 dark:text-violet-300 font-medium' : 'hover:bg-accent text-muted-foreground'" :aria-pressed="form.merchandisingIssues?.includes(m)" @click="toggle('merchandisingIssues', m)">{{ m }}</button>
          </div>
          <Input v-model="form.merchandisingNotes" placeholder="Anything else about merchandising…" />
        </section>

        <!-- Website / inventory problems -->
        <section class="space-y-3">
          <h4 class="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground flex items-center gap-2"><AlertTriangle class="size-3.5" /> Other website / inventory problems</h4>
          <div class="flex flex-wrap gap-1.5">
            <button v-for="w in WEBSITE_ISSUES" :key="w" type="button" class="rounded-full border px-2.5 py-1 text-xs transition-colors" :class="form.websiteIssues?.includes(w) ? 'bg-amber-500/10 border-amber-500/40 text-amber-700 dark:text-amber-300 font-medium' : 'hover:bg-accent text-muted-foreground'" :aria-pressed="form.websiteIssues?.includes(w)" @click="toggle('websiteIssues', w)">{{ w }}</button>
          </div>
          <Input v-model="form.websiteIssuesNotes" placeholder="Describe other problems…" />
        </section>

        <!-- Notes & examples -->
        <section class="space-y-3">
          <h4 class="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground flex items-center gap-2"><ImageOff class="size-3.5" /> Notes & examples</h4>
          <Textarea v-model="form.notes" rows="3" class="resize-none" placeholder="Talking points for the sales conversation — what you saw, what we'd fix, who to show it to." />
          <div class="space-y-2">
            <div v-for="(ex, i) in form.examples" :key="i" class="grid grid-cols-[1fr_180px_32px] gap-2">
              <div class="relative"><Link2 class="absolute left-3 top-1/2 -translate-y-1/2 size-4 text-muted-foreground" /><Input v-model="ex.url" placeholder="https://… vehicle page with the problem" class="pl-9 h-8" /></div>
              <Input v-model="ex.label" placeholder="Label (e.g. 2021 F-150, no photos)" class="h-8" />
              <Button type="button" variant="ghost" size="icon" class="size-8" aria-label="Remove example" @click="removeExample(i)"><X class="size-4" /></Button>
            </div>
            <Button type="button" variant="outline" size="sm" class="h-8 gap-1.5 text-xs" @click="addExample"><Plus class="size-3.5" /> Add example URL</Button>
          </div>
        </section>

        <!-- Evidence screenshot -->
        <section class="space-y-2">
          <h4 class="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground flex items-center gap-2"><Camera class="size-3.5" /> Evidence screenshot</h4>
          <p class="text-[11px] text-muted-foreground">A screenshot of their inventory page. It appears in the “Missing Photos” email as evidence. PNG/JPG, max 2 MB.</p>
          <div v-if="shot" class="rounded-lg border overflow-hidden">
            <img :src="shot.preview" alt="Evidence screenshot" class="w-full max-h-64 object-cover object-top">
            <div class="px-3 py-1.5 flex items-center justify-between text-xs border-t"><span class="truncate text-muted-foreground">{{ shot.name }}</span><Button type="button" variant="ghost" size="sm" class="h-7 text-xs" @click="shot = null">Remove</Button></div>
          </div>
          <label v-else class="flex items-center justify-center gap-2 rounded-lg border-2 border-dashed px-4 py-6 text-sm text-muted-foreground cursor-pointer hover:bg-muted/40">
            <Loader2 v-if="uploading" class="size-4 animate-spin" /><Camera v-else class="size-4" /> {{ uploading ? 'Uploading…' : 'Choose a screenshot' }}
            <input ref="fileInput" type="file" accept="image/png,image/jpeg,image/webp,image/gif" class="sr-only" @change="onShot">
          </label>
        </section>
      </form>

      <SheetFooter class="px-6 py-4 border-t flex-row items-center justify-end gap-2">
        <Button type="button" variant="ghost" :disabled="saving" @click="isOpen = false">Cancel</Button>
        <Button type="submit" form="audit-form" :disabled="saving" class="min-w-36 gap-2"><Loader2 v-if="saving" class="size-4 animate-spin" /><ClipboardCheck v-else class="size-4" /> Save audit</Button>
      </SheetFooter>
    </SheetContent>
  </Sheet>
</template>
