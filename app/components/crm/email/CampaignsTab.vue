<script setup lang="ts">
import type { EmailCampaign, EmailStatsRow } from '~/composables/useCrmEmail'
import { pct } from '~/composables/useCrmEmail'
import { Plus, Pencil, Loader2, Megaphone, Archive, ArchiveRestore } from 'lucide-vue-next'
import { toast } from 'vue-sonner'
import { format } from 'date-fns'

/** Campaigns group sends (e.g. "Q4 Texas Honda stores") so their results can be compared. */
const { campaigns, loadLibrary, saveCampaign, getStats } = useCrmEmail()
const stats = ref<EmailStatsRow[]>([])
const showArchived = ref(false)
onMounted(async () => {
  await loadLibrary(true).catch(() => toast.error('Could not load campaigns'))
  try { stats.value = (await getStats({ groupBy: 'campaign' })).rows } catch {}
})
const list = computed(() => campaigns.value.filter(c => showArchived.value || !c.archivedAt))
const statFor = (id: string) => stats.value.find(r => r.key?.id === id)
const STATUS_CLS: Record<string, string> = {
  planned: 'bg-zinc-500/10 text-zinc-700 dark:text-zinc-300 border-zinc-500/20',
  active: 'bg-emerald-500/10 text-emerald-700 dark:text-emerald-300 border-emerald-500/20',
  paused: 'bg-amber-500/10 text-amber-700 dark:text-amber-300 border-amber-500/20',
  completed: 'bg-sky-500/10 text-sky-700 dark:text-sky-300 border-sky-500/20',
}

const showEditor = ref(false)
const editing = ref<EmailCampaign | null>(null)
const form = ref({ name: '', description: '', status: 'active', startDate: '', endDate: '' })
const saving = ref(false)
function openNew() { editing.value = null; form.value = { name: '', description: '', status: 'active', startDate: format(new Date(), 'yyyy-MM-dd'), endDate: '' }; showEditor.value = true }
function openEdit(c: EmailCampaign) { editing.value = c; form.value = { name: c.name, description: c.description || '', status: c.status, startDate: c.startDate || '', endDate: c.endDate || '' }; showEditor.value = true }
async function save() {
  if (!form.value.name.trim()) return toast.error('Name is required')
  saving.value = true
  try { await saveCampaign(editing.value?.id || null, form.value); toast.success(editing.value ? 'Campaign updated' : 'Campaign created'); showEditor.value = false } catch (e: any) { toast.error(e?.data?.statusMessage || 'Could not save') } finally { saving.value = false }
}
async function toggleArchive(c: EmailCampaign) { try { await saveCampaign(c.id, { archived: !c.archivedAt }) } catch { toast.error('Could not update') } }
</script>

<template>
  <div class="space-y-4">
    <div class="flex flex-wrap items-center gap-3">
      <p class="text-xs text-muted-foreground">Pick a campaign when composing an email; results roll up here.</p>
      <label class="ml-auto inline-flex items-center gap-2 text-xs text-muted-foreground cursor-pointer"><Switch v-model="showArchived" /> Show archived</label>
      <Button size="sm" class="gap-2" @click="openNew"><Plus class="size-4" /> New campaign</Button>
    </div>

    <div v-if="!list.length" class="rounded-xl border-2 border-dashed py-12 flex flex-col items-center text-center">
      <Megaphone class="size-8 text-muted-foreground/50" />
      <p class="mt-2 font-semibold text-sm">No campaigns yet</p>
      <Button size="sm" class="mt-4 gap-2" @click="openNew"><Plus class="size-4" /> New campaign</Button>
    </div>

    <div v-else class="rounded-xl border bg-card overflow-x-auto">
      <table class="w-full text-sm">
        <thead class="bg-muted/40 text-[11px] uppercase tracking-wider text-muted-foreground">
          <tr>
            <th class="text-left font-medium px-4 py-2">Campaign</th>
            <th class="text-left font-medium px-3 py-2">Status</th>
            <th class="text-right font-medium px-3 py-2">Dealerships</th>
            <th class="text-right font-medium px-3 py-2">Sent</th>
            <th class="text-right font-medium px-3 py-2">Reply rate</th>
            <th class="text-right font-medium px-3 py-2">Positive</th>
            <th class="text-right font-medium px-3 py-2">Meetings</th>
            <th class="text-right font-medium px-3 py-2">Proposals</th>
            <th class="text-right font-medium px-3 py-2">Won</th>
            <th class="px-3 py-2" />
          </tr>
        </thead>
        <tbody class="divide-y">
          <tr v-for="c in list" :key="c.id" class="hover:bg-muted/30" :class="c.archivedAt && 'opacity-60'">
            <td class="px-4 py-2.5"><p class="font-medium">{{ c.name }}</p><p class="text-[11px] text-muted-foreground">{{ c.startDate ? format(new Date(`${c.startDate}T00:00:00`), 'MMM d, yyyy') : '' }}{{ c.endDate ? ` – ${format(new Date(`${c.endDate}T00:00:00`), 'MMM d, yyyy')}` : '' }}<span v-if="c.description"> · {{ c.description }}</span></p></td>
            <td class="px-3 py-2.5"><Badge variant="outline" class="text-[10px] capitalize" :class="STATUS_CLS[c.status]">{{ c.status }}</Badge></td>
            <td class="px-3 py-2.5 text-right tabular-nums">{{ statFor(c.id)?.dealershipsReached ?? 0 }}</td>
            <td class="px-3 py-2.5 text-right tabular-nums">{{ statFor(c.id)?.sent ?? 0 }}</td>
            <td class="px-3 py-2.5 text-right tabular-nums font-semibold">{{ statFor(c.id) ? `${pct(statFor(c.id)!.replied, statFor(c.id)!.sent) ?? 0}%` : '—' }}</td>
            <td class="px-3 py-2.5 text-right tabular-nums">{{ statFor(c.id)?.positive || '—' }}</td>
            <td class="px-3 py-2.5 text-right tabular-nums">{{ statFor(c.id)?.meeting || '—' }}</td>
            <td class="px-3 py-2.5 text-right tabular-nums">{{ statFor(c.id)?.proposal || '—' }}</td>
            <td class="px-3 py-2.5 text-right tabular-nums font-semibold">{{ statFor(c.id)?.won || '—' }}</td>
            <td class="px-3 py-2.5 text-right whitespace-nowrap">
              <Button variant="ghost" size="icon" class="size-7" title="Edit" @click="openEdit(c)"><Pencil class="size-3.5" /></Button>
              <Button variant="ghost" size="icon" class="size-7" :title="c.archivedAt ? 'Restore' : 'Archive'" @click="toggleArchive(c)"><component :is="c.archivedAt ? ArchiveRestore : Archive" class="size-3.5" /></Button>
            </td>
          </tr>
        </tbody>
      </table>
    </div>

    <Dialog v-model:open="showEditor">
      <DialogContent class="sm:max-w-lg">
        <DialogHeader><DialogTitle>{{ editing ? 'Edit campaign' : 'New campaign' }}</DialogTitle><DialogDescription class="text-xs">Group emails you want to measure together.</DialogDescription></DialogHeader>
        <div class="space-y-4">
          <div class="space-y-1.5"><Label>Name</Label><Input v-model="form.name" placeholder="Q4 — Texas franchise stores" /></div>
          <div class="grid grid-cols-3 gap-3">
            <div class="space-y-1.5"><Label>Status</Label>
              <Select v-model="form.status"><SelectTrigger class="w-full"><SelectValue /></SelectTrigger><SelectContent><SelectItem v-for="s in ['planned', 'active', 'paused', 'completed']" :key="s" :value="s" class="capitalize">{{ s }}</SelectItem></SelectContent></Select>
            </div>
            <div class="space-y-1.5"><Label>Start</Label><Input v-model="form.startDate" type="date" /></div>
            <div class="space-y-1.5"><Label>End</Label><Input v-model="form.endDate" type="date" /></div>
          </div>
          <div class="space-y-1.5"><Label>Description</Label><Textarea v-model="form.description" rows="3" /></div>
        </div>
        <DialogFooter><Button variant="ghost" @click="showEditor = false">Cancel</Button><Button :disabled="saving" class="min-w-24" @click="save"><Loader2 v-if="saving" class="size-4 animate-spin" /><span v-else>Save</span></Button></DialogFooter>
      </DialogContent>
    </Dialog>
  </div>
</template>
