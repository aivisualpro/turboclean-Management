<script setup lang="ts">
import type { Condition } from '~/composables/useCrmFilters'
import { FIELD_MAP, FILTER_FIELDS, FUNNEL_LABELS, OPS, SMART_VIEWS, describe } from '~/composables/useCrmFilters'
import { Plus, X, Sparkles, Save, Trash2, SlidersHorizontal, Loader2 } from 'lucide-vue-next'
import { toast } from 'vue-sonner'

/** Condition builder for the dealership list (all conditions must match) + smart / saved views. */
const model = defineModel<Condition[]>({ default: () => [] })
defineProps<{ loading?: boolean, matching?: number }>()

const open = ref(false)
const draft = ref<Condition>({ field: 'brand', op: 'is', value: '' })
const def = computed(() => FIELD_MAP[draft.value.field]!)
watch(() => draft.value.field, () => { draft.value.op = OPS[def.value.type][0]!.key; draft.value.value = def.value.type === 'step' ? 'contacted' : def.value.options?.[0] && def.value.type === 'enum' ? String(def.value.options[0]) : '' })
const groups = computed(() => [...new Set(FILTER_FIELDS.map(f => f.group))].map(g => ({ g, fields: FILTER_FIELDS.filter(f => f.group === g) })))

function add() {
  const d = def.value
  if ((d.type === 'number' || d.type === 'text') && !String(draft.value.value).trim()) { toast.error('Enter a value'); return }
  model.value = [...model.value, { ...draft.value, value: d.type === 'bool' ? '' : String(draft.value.value).trim() }]
  open.value = false
}
function remove(i: number) { model.value = model.value.filter((_, j) => j !== i) }

// Saved views (per browser).
const saved = useLocalStorage<{ name: string, conditions: Condition[] }[]>('crm-saved-filter-views', [])
const saveName = ref('')
function saveView() {
  const name = saveName.value.trim()
  if (!name || !model.value.length) return
  saved.value = [...saved.value.filter(v => v.name !== name), { name, conditions: model.value }]
  saveName.value = ''
  toast.success(`Saved view “${name}”`)
}
</script>

<template>
  <div class="flex flex-wrap items-center gap-1.5">
    <DropdownMenu>
      <DropdownMenuTrigger as-child>
        <Button variant="outline" size="sm" class="h-7 gap-1.5 text-xs"><Sparkles class="size-3.5" /> Smart views</Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" class="w-80">
        <DropdownMenuLabel class="text-[11px] text-muted-foreground">Ready-made</DropdownMenuLabel>
        <DropdownMenuItem v-for="v in SMART_VIEWS" :key="v.key" class="text-xs" @click="model = v.conditions.map(c => ({ ...c }))">{{ v.label }}</DropdownMenuItem>
        <template v-if="saved.length">
          <DropdownMenuSeparator />
          <DropdownMenuLabel class="text-[11px] text-muted-foreground">My views</DropdownMenuLabel>
          <DropdownMenuItem v-for="v in saved" :key="v.name" class="text-xs justify-between" @click="model = v.conditions.map(c => ({ ...c }))">
            {{ v.name }}
            <button type="button" class="text-muted-foreground hover:text-destructive" :aria-label="`Delete ${v.name}`" @click.stop="saved = saved.filter(x => x.name !== v.name)"><Trash2 class="size-3.5" /></button>
          </DropdownMenuItem>
        </template>
      </DropdownMenuContent>
    </DropdownMenu>

    <span v-for="(c, i) in model" :key="i" class="inline-flex items-center gap-1 rounded-full border border-primary/30 bg-primary/5 pl-2.5 pr-1 py-0.5 text-xs">
      {{ describe(c) }}
      <button type="button" class="rounded-full p-0.5 hover:bg-primary/10" :aria-label="`Remove ${describe(c)}`" @click="remove(i)"><X class="size-3" /></button>
    </span>

    <Popover v-model:open="open">
      <PopoverTrigger as-child>
        <Button variant="ghost" size="sm" class="h-7 gap-1 text-xs"><Plus class="size-3.5" /> {{ model.length ? 'And…' : 'Add filter' }}</Button>
      </PopoverTrigger>
      <PopoverContent align="start" class="w-80 space-y-2.5">
        <p class="text-xs font-medium flex items-center gap-1.5"><SlidersHorizontal class="size-3.5" /> Add a condition</p>
        <Select v-model="draft.field">
          <SelectTrigger class="h-8 w-full text-xs"><SelectValue /></SelectTrigger>
          <SelectContent class="max-h-80">
            <SelectGroup v-for="g in groups" :key="g.g">
              <SelectLabel class="text-[10px]">{{ g.g }}</SelectLabel>
              <SelectItem v-for="f in g.fields" :key="f.key" :value="f.key" class="text-xs">{{ f.label }}</SelectItem>
            </SelectGroup>
          </SelectContent>
        </Select>
        <div class="flex gap-2">
          <Select v-model="draft.op">
            <SelectTrigger class="h-8 w-32 text-xs"><SelectValue /></SelectTrigger>
            <SelectContent><SelectItem v-for="o in OPS[def.type]" :key="o.key" :value="o.key" class="text-xs">{{ o.label }}</SelectItem></SelectContent>
          </Select>
          <Select v-if="def.type === 'enum' || def.type === 'step'" v-model="draft.value">
            <SelectTrigger class="h-8 flex-1 text-xs"><SelectValue /></SelectTrigger>
            <SelectContent class="max-h-72"><SelectItem v-for="o in def.options" :key="o" :value="String(o)" class="text-xs">{{ def.type === 'step' ? FUNNEL_LABELS[o as keyof typeof FUNNEL_LABELS] : o }}</SelectItem></SelectContent>
          </Select>
          <Input v-else-if="def.type !== 'bool'" v-model="draft.value" :type="def.type === 'number' ? 'number' : 'text'" :placeholder="def.type === 'number' ? (def.unit || 'Number') : 'Value'" class="h-8 flex-1 text-xs" @keydown.enter.prevent="add" />
        </div>
        <Button size="sm" class="w-full h-8" @click="add">Add condition</Button>
      </PopoverContent>
    </Popover>

    <template v-if="model.length">
      <Popover>
        <PopoverTrigger as-child><Button variant="ghost" size="sm" class="h-7 gap-1 text-xs text-muted-foreground"><Save class="size-3.5" /> Save view</Button></PopoverTrigger>
        <PopoverContent align="start" class="w-64 space-y-2">
          <Input v-model="saveName" placeholder="View name" class="h-8 text-xs" @keydown.enter.prevent="saveView" />
          <Button size="sm" class="w-full h-8" :disabled="!saveName.trim()" @click="saveView">Save</Button>
        </PopoverContent>
      </Popover>
      <Button variant="ghost" size="sm" class="h-7 text-xs text-muted-foreground" @click="model = []">Clear conditions</Button>
      <span class="text-xs text-muted-foreground inline-flex items-center gap-1"><Loader2 v-if="loading" class="size-3 animate-spin" /><template v-else-if="matching != null">{{ matching }} match</template></span>
    </template>
  </div>
</template>
