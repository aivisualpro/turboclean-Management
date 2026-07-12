<script setup lang="ts">
import { CalendarClock, CheckCircle, ChevronDown, ChevronRight, Clock, Download, Eye, FileSpreadsheet, Globe, Loader2, Mail, Pencil, Play, Plus, Save, Search, Send, Sparkles, ThumbsUp, Trash2, X, Zap, ChevronsUpDown, Check } from 'lucide-vue-next'
import { toast } from 'vue-sonner'
import { downloadPDF, generatePDF } from '~/composables/useSalesDocument'

const { setHeader } = usePageHeader()
setHeader({ title: 'Monthly Invoices', icon: 'i-lucide-calendar-range' })

// ─── Constants & Helpers ─────────────────────────────────────────────────
const TAX_RATE = 0.0635
const MONTH_NAMES = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December']
const WEEKDAY_OPTIONS = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday']
const NTH_OPTIONS = ['First', 'Second', 'Third', 'Fourth', 'Last']
const DAY_OF_MONTH_OPTIONS = [...Array.from({ length: 28 }, (_, i) => String(i + 1)), 'last']
const US_TIMEZONES = [
  { value: 'America/New_York', label: 'Eastern (America/New_York)' },
  { value: 'America/Chicago', label: 'Central (America/Chicago)' },
  { value: 'America/Denver', label: 'Mountain (America/Denver)' },
  { value: 'America/Phoenix', label: 'Arizona (America/Phoenix)' },
  { value: 'America/Los_Angeles', label: 'Pacific (America/Los_Angeles)' },
  { value: 'America/Anchorage', label: 'Alaska (America/Anchorage)' },
  { value: 'Pacific/Honolulu', label: 'Hawaii (Pacific/Honolulu)' },
  { value: 'America/Puerto_Rico', label: 'Atlantic (America/Puerto_Rico)' },
]

const fmt = (n: number) => new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(n || 0)
const fmtDate = (d: string) => d ? new Date(d).toLocaleDateString('en-US', { timeZone: 'UTC', month: 'short', day: 'numeric', year: 'numeric' }) : '—'
const fmtDateTime = (d: string) => d ? new Date(d).toLocaleDateString('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }) : '—'
const cleanEmail = (e: string) => e?.trim().replace(/,+$/, '') || ''

const badgeClasses: Record<string, string> = {
  Draft: 'bg-gray-500/10 text-gray-600 border-gray-500/20',
  Approved: 'bg-amber-500/10 text-amber-600 border-amber-500/20',
  Emailed: 'bg-blue-500/10 text-blue-600 border-blue-500/20',
  Sent: 'bg-blue-500/10 text-blue-600 border-blue-500/20',
  Paid: 'bg-emerald-500/10 text-emerald-600 border-emerald-500/20',
  Overdue: 'bg-red-500/10 text-red-600 border-red-500/20',
  Cancelled: 'bg-gray-500/10 text-gray-500 border-gray-500/20',
}

// ─── View Tabs ───────────────────────────────────────────────────────────
const activeView = ref<'invoices' | 'automations'>('invoices')

// ─── Invoices State ──────────────────────────────────────────────────────
const search = ref('')
const invoices = ref<any[]>([])
const loading = ref(false)
const hasMore = ref(true)
const skip = ref(0)
const limit = 20
const expandedInvoices = ref(new Set<string>())
function toggleSet(set: Set<string>, val: string) {
  if (set.has(val))
    set.delete(val)
  else set.add(val)
}

async function fetchInvoices(reset = false) {
  if (loading.value)
    return
  if (reset) {
    skip.value = 0
    invoices.value = []
    hasMore.value = true
  }
  if (!hasMore.value)
    return

  loading.value = true
  try {
    const res = await $fetch<{ invoices: any[], hasMore: boolean }>('/api/invoices', {
      query: { skip: skip.value, limit, search: search.value, type: 'monthly', sortBy: 'date', sortDir: -1 },
    })
    invoices.value = [...invoices.value, ...(res.invoices || [])]
    hasMore.value = res.hasMore
    skip.value += limit
  }
  catch (err) {
    console.error('Failed to fetch monthly invoices:', err)
    toast.error('Failed to fetch monthly invoices')
  }
  finally {
    loading.value = false
  }
}

// ─── Dealers ─────────────────────────────────────────────────────────────
const dealers = ref<any[]>([])
const dealersLoaded = ref(false)
const autoDealerPopoverOpen = ref(false)
const invoiceDealerPopoverOpen = ref(false)
async function loadDealers() {
  if (dealersLoaded.value)
    return
  try {
    const res: any = await $fetch('/api/dealers')
    dealers.value = res.dealers || []
    dealersLoaded.value = true
  }
  catch {
    toast.error('Failed to load dealers')
  }
}

// ─── Manual Invoice Create / Edit ────────────────────────────────────────
const showFormDialog = ref(false)
const isSavingForm = ref(false)
const editingId = ref<string>('')

function defaultMonthKey() {
  const d = new Date()
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`
}

function emptyLine() {
  return { serviceName: '', amount: 0 as number | string, tax: 0 as number | string }
}

const form = ref({
  dealerId: '',
  monthKey: defaultMonthKey(),
  lineItems: [emptyLine()],
})

function openCreateDialog() {
  editingId.value = ''
  form.value = { dealerId: '', monthKey: defaultMonthKey(), lineItems: [emptyLine()] }
  showFormDialog.value = true
  loadDealers()
}

function openEditDialog(inv: any) {
  editingId.value = inv.id
  form.value = {
    dealerId: inv.dealerId,
    monthKey: inv.monthKey || defaultMonthKey(),
    lineItems: (inv.lineItems || []).map((li: any) => ({
      serviceName: li.serviceName || li.description || '',
      amount: li.amount ?? li.unitPrice ?? 0,
      tax: li.tax ?? 0,
    })),
  }
  if (form.value.lineItems.length === 0)
    form.value.lineItems = [emptyLine()]
  showFormDialog.value = true
  loadDealers()
}

function calcTotals(lineItems: any[]) {
  const subtotal = lineItems.reduce((s, li) => s + (Number(li.amount) || 0), 0)
  const taxTotal = lineItems.reduce((s, li) => s + (Number(li.tax) || 0), 0)
  return {
    subtotal: Math.round(subtotal * 100) / 100,
    taxTotal: Math.round(taxTotal * 100) / 100,
    total: Math.round((subtotal + taxTotal) * 100) / 100,
  }
}

function removeFormLine(i: number) {
  form.value.lineItems.splice(i, 1)
  if (form.value.lineItems.length === 0)
    form.value.lineItems = [emptyLine()]
}

// Auto-calc tax at 6.35% when amount changes (still editable per line)
function onAmountChange(li: any) {
  const amt = Number(li.amount) || 0
  li.tax = Math.round(amt * TAX_RATE * 100) / 100
}

const formTotals = computed(() => calcTotals(form.value.lineItems))

const monthLabelPreview = computed(() => {
  if (!/^\d{4}-\d{2}$/.test(form.value.monthKey))
    return ''
  const [y, m] = form.value.monthKey.split('-')
  return `${MONTH_NAMES[Number(m) - 1]} ${y}`
})

async function saveInvoice() {
  if (!form.value.dealerId)
    return toast.error('Please select a dealer')
  if (!/^\d{4}-\d{2}$/.test(form.value.monthKey))
    return toast.error('Please select a billing month')
  const validLines = form.value.lineItems.filter(li => (Number(li.amount) || 0) > 0 || (li.serviceName || '').trim())
  if (validLines.length === 0)
    return toast.error('Add at least one line item with a service description or amount')

  isSavingForm.value = true
  try {
    const res: any = await $fetch('/api/invoices/monthly', {
      method: 'POST',
      body: {
        id: editingId.value || undefined,
        dealerId: form.value.dealerId,
        monthKey: form.value.monthKey,
        lineItems: validLines,
      },
    })
    if (res.success) {
      toast.success(res.message)
      showFormDialog.value = false
      fetchInvoices(true)
    }
    else {
      toast.error(res.message || 'Failed to save invoice')
    }
  }
  catch (err: any) {
    toast.error(`Failed to save invoice: ${err.message || 'Unknown error'}`)
  }
  finally {
    isSavingForm.value = false
  }
}

// ─── Invoice Status / Payment / Delete ───────────────────────────────────
async function updateInvoiceStatus(inv: any, newStatus: string) {
  toast(`Mark invoice as ${newStatus}?`, {
    description: `Are you sure you want to mark ${inv.number} as ${newStatus}?`,
    action: {
      label: 'Confirm',
      onClick: () => {
        toast.promise(
          ($fetch as any)(`/api/invoices/${inv.id}`, { method: 'PUT', body: { status: newStatus } }),
          {
            loading: 'Updating status...',
            success: () => {
              inv.status = newStatus
              return `Invoice marked as ${newStatus}`
            },
            error: 'Failed to update status',
          },
        )
      },
    },
    cancel: { label: 'Cancel', onClick: () => {} },
  })
}

function deleteInvoice(inv: any) {
  toast(`Delete invoice ${inv.number}?`, {
    description: 'This cannot be undone.',
    action: {
      label: 'Delete',
      onClick: () => {
        toast.promise(
          ($fetch as any)(`/api/invoices/${inv.id}`, { method: 'DELETE' }),
          {
            loading: 'Deleting...',
            success: () => {
              invoices.value = invoices.value.filter(i => i.id !== inv.id)
              return 'Invoice deleted'
            },
            error: 'Failed to delete invoice',
          },
        )
      },
    },
    cancel: { label: 'Cancel', onClick: () => {} },
  })
}

const showPaymentDialog = ref(false)
const selectedPaymentInvoice = ref<any>(null)
const paymentAmount = ref<number | ''>('')
const isPaying = ref(false)

function openPaymentDialog(inv: any) {
  selectedPaymentInvoice.value = inv
  paymentAmount.value = inv.paidAmount || inv.total || ''
  showPaymentDialog.value = true
}

async function handlePaymentSubmit() {
  if (!selectedPaymentInvoice.value || !paymentAmount.value)
    return
  isPaying.value = true
  try {
    await $fetch(`/api/invoices/${selectedPaymentInvoice.value.id}`, {
      method: 'PUT',
      body: { status: 'Paid', paidAmount: Number(paymentAmount.value) },
    })
    selectedPaymentInvoice.value.status = 'Paid'
    selectedPaymentInvoice.value.paidAmount = Number(paymentAmount.value)
    showPaymentDialog.value = false
    toast.success('Invoice marked as paid')
  }
  catch (err: any) {
    toast.error(`Failed to update invoice: ${err.message}`)
  }
  finally {
    isPaying.value = false
  }
}

// ─── Invoice Preview / Download ──────────────────────────────────────────
const selectedInvoice = ref<any>(null)
const showPreview = ref(false)

function toSalesDoc(inv: any) {
  return {
    id: inv.id,
    number: inv.number,
    client: inv.dealerName,
    clientEmail: inv.dealerEmail,
    clientAddress: inv.dealerAddress,
    status: inv.status,
    date: inv.date,
    dueDate: inv.dueDate,
    monthKey: inv.monthKey,
    monthLabel: inv.monthLabel,
    type: 'Monthly',
    paidAmount: inv.paidAmount || 0,
    paymentMethod: inv.paymentMethod || '',
    notes: inv.notes || '',
    lineItems: (inv.lineItems || []).map((li: any) => ({
      id: li.workOrderId || li.invoiceId || '',
      description: li.description || li.serviceName || '',
      quantity: 1,
      unitPrice: li.amount ?? li.unitPrice ?? 0,
      discount: 0,
      tax: li.tax || 0,
      serviceName: li.serviceName || li.description || '',
    })),
    subtotal: inv.subtotal,
    taxTotal: inv.taxTotal,
    discountTotal: 0,
    total: inv.total,
    createdAt: inv.createdAt,
  }
}

function openPreviewFor(inv: any) {
  selectedInvoice.value = inv
  showPreview.value = true
}

const previewHtml = computed(() => {
  if (!selectedInvoice.value)
    return ''
  return generatePDF(toSalesDoc(selectedInvoice.value), 'Invoice')
})

function handleDownload(inv: any) {
  downloadPDF(toSalesDoc(inv), 'Invoice')
}

// ─── Invoice Email Dialog ────────────────────────────────────────────────
const showEmailDialog = ref(false)
const selectedEmailInvoice = ref<any>(null)
const recipientEmails = ref<string[]>([])
const newEmailInput = ref('')
const dealerContacts = ref<{ email: string, name: string }[]>([])
const isFetchingContacts = ref(false)

async function fetchDealerContacts(dealerId: string): Promise<{ email: string, name: string }[]> {
  try {
    const res = await $fetch<{ dealer: any }>(`/api/dealers/${dealerId}`)
    const items = new Map<string, string>()
    res.dealer?.contacts?.forEach((c: any) => {
      c.emails?.forEach((e: string) => {
        const cleaned = cleanEmail(e)
        if (cleaned && !items.has(cleaned))
          items.set(cleaned, c.name || 'Contact')
      })
    })
    return Array.from(items.entries()).map(([email, name]) => ({ email, name }))
  }
  catch {
    return []
  }
}

async function openEmailDialog(inv: any) {
  selectedEmailInvoice.value = inv
  recipientEmails.value = []
  newEmailInput.value = ''
  dealerContacts.value = []
  showEmailDialog.value = true

  if (inv.dealerId) {
    isFetchingContacts.value = true
    dealerContacts.value = await fetchDealerContacts(inv.dealerId)
    isFetchingContacts.value = false
  }
}

function toggleContact(email: string) {
  if (recipientEmails.value.includes(email))
    recipientEmails.value = recipientEmails.value.filter(e => e !== email)
  else recipientEmails.value = [...recipientEmails.value, email]
}

function addCustomEmail() {
  const emails = newEmailInput.value.split(/[,;\s]+/).map(s => cleanEmail(s)).filter(Boolean)
  const fresh = emails.filter(e => !recipientEmails.value.includes(e))
  if (fresh.length > 0)
    recipientEmails.value = [...recipientEmails.value, ...fresh]
  newEmailInput.value = ''
}

function handleEmailInputKeydown(e: KeyboardEvent) {
  if (e.key === 'Enter' || e.key === ',') {
    e.preventDefault()
    addCustomEmail()
  }
  if (e.key === 'Backspace' && !newEmailInput.value && recipientEmails.value.length > 0)
    recipientEmails.value = recipientEmails.value.slice(0, -1)
}

function removeRecipient(email: string) {
  recipientEmails.value = recipientEmails.value.filter(e => e !== email)
}

function handleEmailDialogSubmit() {
  addCustomEmail()
  const finalEmails = [...recipientEmails.value]
  if (finalEmails.length === 0)
    return toast.error('At least one email is required')

  const inv = selectedEmailInvoice.value
  const doc = toSalesDoc(inv)
  const htmlPayload = generatePDF(doc, 'Invoice')

  showEmailDialog.value = false
  toast.success(`Invoice sending to ${finalEmails.length} recipient${finalEmails.length > 1 ? 's' : ''}`)

  if (inv.status === 'Approved' || inv.status === 'Draft' || inv.status === 'Sent')
    inv.status = 'Emailed'

  $fetch('/api/invoices/send', {
    method: 'POST' as any,
    body: {
      html: htmlPayload,
      email: finalEmails,
      subject: `Monthly Invoice ${doc.number} from ZRZ OPS – ${inv.monthLabel || ''}`,
      dealerId: inv.dealerId,
      invoiceId: inv.id,
      invoiceType: 'Monthly',
      invoiceNumber: doc.number,
      invoiceData: doc,
    },
  }).then(() => {
    ($fetch as any)(`/api/invoices/${inv.id}`, { method: 'PUT', body: { status: 'Emailed' } }).catch(() => {})
  }).catch((err: any) => {
    toast.error(`Email delivery failed: ${err.message || 'Unknown error'}`)
    inv.status = 'Approved'
  })
}

// ═══════════════════════════════════════════════════════════════════════════
// AUTOMATIONS
// ═══════════════════════════════════════════════════════════════════════════
const automations = ref<any[]>([])
const automationsLoading = ref(false)
const runningAutomationId = ref('')

async function fetchAutomations() {
  automationsLoading.value = true
  try {
    const res: any = await $fetch('/api/monthly-automations')
    automations.value = res.automations || []
  }
  catch {
    toast.error('Failed to load automations')
  }
  finally {
    automationsLoading.value = false
  }
}

function scheduleSummary(a: any): string {
  const when = a.scheduleType === 'nth_weekday'
    ? `${(a.nth || 'First').toLowerCase()} ${a.weekday || 'Monday'}`
    : String(a.dayOfMonth) === 'last' ? 'last day' : `day ${a.dayOfMonth}`
  const tzShort = (a.timezone || 'America/New_York').split('/')[1]?.replace(/_/g, ' ') || a.timezone
  return `Every month · ${when} · ${a.time} (${tzShort})`
}

function automationTotal(a: any): number {
  return (a.lineItems || []).reduce((s: number, li: any) => s + (Number(li.amount) || 0) + (Number(li.tax) || 0), 0)
}

async function toggleAutomation(a: any) {
  const newVal = !a.enabled
  a.enabled = newVal // optimistic
  try {
    await $fetch(`/api/monthly-automations/${a.id}`, { method: 'PUT', body: { enabled: newVal } })
    toast.success(`Automation ${newVal ? 'enabled' : 'disabled'}`)
  }
  catch {
    a.enabled = !newVal
    toast.error('Failed to update automation')
  }
}

function deleteAutomation(a: any) {
  toast(`Delete automation "${a.name}"?`, {
    description: 'Previously generated invoices are kept.',
    action: {
      label: 'Delete',
      onClick: () => {
        toast.promise(
          ($fetch as any)(`/api/monthly-automations/${a.id}`, { method: 'DELETE' }),
          {
            loading: 'Deleting...',
            success: () => {
              automations.value = automations.value.filter(x => x.id !== a.id)
              return 'Automation deleted'
            },
            error: 'Failed to delete automation',
          },
        )
      },
    },
    cancel: { label: 'Cancel', onClick: () => {} },
  })
}

async function runAutomationNow(a: any) {
  if (runningAutomationId.value)
    return
  runningAutomationId.value = a.id
  try {
    const res: any = await $fetch('/api/monthly-automations/run', {
      method: 'POST',
      body: { automationId: a.id },
    })
    if (res.success) {
      toast.success(res.message)
      fetchAutomations()
      fetchInvoices(true)
    }
    else {
      toast.error(res.message || 'Run failed')
    }
  }
  catch (err: any) {
    toast.error(`Run failed: ${err.message || 'Unknown error'}`)
  }
  finally {
    runningAutomationId.value = ''
  }
}

// ─── Automation Editor Dialog ────────────────────────────────────────────
const showAutomationDialog = ref(false)
const isSavingAutomation = ref(false)
const editingAutomationId = ref('')
const autoDealerContacts = ref<{ email: string, name: string }[]>([])
const autoEmailInput = ref('')

function emptyAutomationForm() {
  return {
    name: '',
    dealerId: '',
    billingMonth: 'current' as 'current' | 'previous',
    scheduleType: 'day_of_month' as 'day_of_month' | 'nth_weekday',
    dayOfMonth: '1' as string,
    nth: 'First',
    weekday: 'Monday',
    time: '09:00',
    timezone: 'America/New_York',
    endDate: '',
    emails: [] as string[],
    emailSubject: '',
    emailBody: '',
    lineItems: [emptyLine()],
    enabled: true,
  }
}

const autoForm = ref(emptyAutomationForm())

function openAutomationCreate() {
  editingAutomationId.value = ''
  autoForm.value = emptyAutomationForm()
  autoDealerContacts.value = []
  autoEmailInput.value = ''
  showAutomationDialog.value = true
  loadDealers()
}

function openAutomationEdit(a: any) {
  editingAutomationId.value = a.id
  autoForm.value = {
    name: a.name || '',
    dealerId: a.dealerId,
    billingMonth: a.billingMonth === 'previous' ? 'previous' : 'current',
    scheduleType: a.scheduleType === 'nth_weekday' ? 'nth_weekday' : 'day_of_month',
    dayOfMonth: String(a.dayOfMonth ?? '1'),
    nth: a.nth || 'First',
    weekday: a.weekday || 'Monday',
    time: a.time || '09:00',
    timezone: a.timezone || 'America/New_York',
    endDate: a.endDate || '',
    emails: [...(a.emails || [])],
    emailSubject: a.emailSubject || '',
    emailBody: a.emailBody || '',
    lineItems: (a.lineItems || []).map((li: any) => ({
      serviceName: li.serviceName || '',
      amount: li.amount ?? 0,
      tax: li.tax ?? 0,
    })),
    enabled: !!a.enabled,
  }
  if (autoForm.value.lineItems.length === 0)
    autoForm.value.lineItems = [emptyLine()]
  autoDealerContacts.value = []
  autoEmailInput.value = ''
  showAutomationDialog.value = true
  loadDealers()
  if (a.dealerId)
    fetchDealerContacts(a.dealerId).then((c) => { autoDealerContacts.value = c })
}

// Refresh contact chips when the dealer changes in the automation form
watch(() => autoForm.value.dealerId, async (dealerId) => {
  autoDealerContacts.value = dealerId ? await fetchDealerContacts(dealerId) : []
})

function autoToggleContact(email: string) {
  if (autoForm.value.emails.includes(email))
    autoForm.value.emails = autoForm.value.emails.filter(e => e !== email)
  else autoForm.value.emails = [...autoForm.value.emails, email]
}

function autoAddCustomEmail() {
  const emails = autoEmailInput.value.split(/[,;\s]+/).map(s => cleanEmail(s)).filter(Boolean)
  const fresh = emails.filter(e => !autoForm.value.emails.includes(e))
  if (fresh.length > 0)
    autoForm.value.emails = [...autoForm.value.emails, ...fresh]
  autoEmailInput.value = ''
}

function autoEmailKeydown(e: KeyboardEvent) {
  if (e.key === 'Enter' || e.key === ',') {
    e.preventDefault()
    autoAddCustomEmail()
  }
  if (e.key === 'Backspace' && !autoEmailInput.value && autoForm.value.emails.length > 0)
    autoForm.value.emails = autoForm.value.emails.slice(0, -1)
}

function autoRemoveEmail(email: string) {
  autoForm.value.emails = autoForm.value.emails.filter(e => e !== email)
}

function addAutoLine() {
  autoForm.value.lineItems.push(emptyLine())
}
function removeAutoLine(i: number) {
  autoForm.value.lineItems.splice(i, 1)
  if (autoForm.value.lineItems.length === 0)
    autoForm.value.lineItems = [emptyLine()]
}

const autoTotals = computed(() => calcTotals(autoForm.value.lineItems))

const autoScheduleSummary = computed(() => scheduleSummary({
  scheduleType: autoForm.value.scheduleType,
  dayOfMonth: autoForm.value.dayOfMonth,
  nth: autoForm.value.nth,
  weekday: autoForm.value.weekday,
  time: autoForm.value.time,
  timezone: autoForm.value.timezone,
}))

// ─── LIVE Invoice Preview (updates as you type) ──────────────────────────
const autoBillingMonthLabel = computed(() => {
  const d = new Date()
  let y = d.getFullYear()
  let m = d.getMonth() + 1
  if (autoForm.value.billingMonth === 'previous') {
    m -= 1
    if (m === 0) {
      m = 12
      y -= 1
    }
  }
  return `${MONTH_NAMES[m - 1]} ${y}`
})

const autoPreviewHtml = computed(() => {
  const dealerName = dealers.value.find(d => d.id === autoForm.value.dealerId)?.dealerName || 'Select a dealer...'
  const totals = autoTotals.value
  const doc = {
    number: `M-INV-${new Date().getFullYear()}-XXXX-0000`,
    client: dealerName,
    type: 'Monthly',
    monthLabel: autoBillingMonthLabel.value,
    lineItems: autoForm.value.lineItems
      .filter(li => (li.serviceName || '').trim() || (Number(li.amount) || 0) > 0)
      .map(li => ({
        serviceName: li.serviceName || '',
        description: li.serviceName || '',
        unitPrice: Number(li.amount) || 0,
        tax: Number(li.tax) || 0,
      })),
    subtotal: totals.subtotal,
    taxTotal: totals.taxTotal,
    total: totals.total,
  }
  const invoiceHtml = generatePDF(doc, 'Invoice')

  // Mirror the server-side email wrapper: custom message block above the invoice
  const body = autoForm.value.emailBody?.trim()
  if (!body)
    return invoiceHtml
  const safeBody = body.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/\n/g, '<br>')
  const messageBlock = `
    <div style="max-width:820px;margin:20px auto 0;padding:20px 28px;background:#ffffff;border:1px solid #e2e8f0;border-radius:12px;font-family:'Inter',Arial,sans-serif;color:#334155;font-size:14px;line-height:1.65">
      ${safeBody}
    </div>`
  return invoiceHtml.replace(/(<body[^>]*>)/i, `$1${messageBlock}`)
})

async function saveAutomation() {
  autoAddCustomEmail() // flush pending input
  if (!autoForm.value.dealerId)
    return toast.error('Please select a dealer')
  const validLines = autoForm.value.lineItems.filter(li => (Number(li.amount) || 0) > 0 || (li.serviceName || '').trim())
  if (validLines.length === 0)
    return toast.error('Add at least one line item')

  isSavingAutomation.value = true
  try {
    const res: any = await $fetch('/api/monthly-automations', {
      method: 'POST',
      body: {
        id: editingAutomationId.value || undefined,
        ...autoForm.value,
        lineItems: validLines,
      },
    })
    if (res.success) {
      toast.success(res.message)
      showAutomationDialog.value = false
      fetchAutomations()
    }
    else {
      toast.error(res.message || 'Failed to save automation')
    }
  }
  catch (err: any) {
    toast.error(`Save failed: ${err.message || 'Unknown error'}`)
  }
  finally {
    isSavingAutomation.value = false
  }
}

// ─── Lifecycle ───────────────────────────────────────────────────────────
const vIntersect = {
  mounted: (el: HTMLElement, binding: any) => {
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries[0]?.isIntersecting)
          binding.value()
      },
      { rootMargin: '100px', threshold: 0.1 },
    )
    observer.observe(el);
    (el as any)._observer = observer
  },
  unmounted: (el: HTMLElement) => {
    if ((el as any)._observer)
      (el as any)._observer.disconnect()
  },
}

fetchInvoices()
fetchAutomations()

useLiveSync('Invoices', () => fetchInvoices(true))

let searchTimeout: any
watch(search, () => {
  clearTimeout(searchTimeout)
  searchTimeout = setTimeout(() => fetchInvoices(true), 300)
})
</script>

<template>
  <div class="absolute inset-0 flex flex-col overflow-hidden bg-background">
    <!-- Top Nav Action Bar -->
    <ClientOnly>
      <Teleport to="#page-header-actions">
        <div class="flex items-center gap-2">
          <div v-if="activeView === 'invoices'" class="relative hidden sm:block">
            <Search class="absolute left-2.5 top-1/2 -translate-y-1/2 size-4 text-muted-foreground" />
            <Input v-model="search" placeholder="Search invoices..." class="pl-8 w-44 h-8 text-sm bg-background shadow-sm" />
          </div>
          <Button v-if="activeView === 'automations'" size="sm" class="h-8 gap-1.5 bg-blue-600 hover:bg-blue-700 text-white shadow-sm" @click="openAutomationCreate">
            <Plus class="size-3.5" /> New Automation
          </Button>
          <Button v-else size="sm" class="h-8 gap-1.5 bg-blue-600 hover:bg-blue-700 text-white shadow-sm" @click="openCreateDialog">
            <Plus class="size-3.5" /> New Monthly Invoice
          </Button>
        </div>
      </Teleport>
    </ClientOnly>

    <!-- Main Content -->
    <div class="flex-1 min-h-0 flex flex-col p-4 w-full">
      <main class="flex-1 min-w-0 flex flex-col overflow-hidden rounded-xl border bg-card text-card-foreground shadow-[rgba(0,0,0,0.05)_0px_2px_10px]">
        <!-- Header: View Tabs -->
        <div class="flex items-center justify-between px-4 py-3 gap-3 border-b bg-muted/10">
          <div class="flex items-center gap-3">
            <div class="flex bg-muted/60 p-1 rounded-lg border border-border/50">
              <button class="px-3 py-1.5 text-xs font-medium rounded-md transition-all flex items-center gap-1.5" :class="activeView === 'invoices' ? 'bg-background text-blue-600 shadow-sm ring-1 ring-border/50' : 'text-muted-foreground hover:text-foreground'" @click="activeView = 'invoices'">
                <FileSpreadsheet class="size-3.5" /> Invoices
              </button>
              <button class="px-3 py-1.5 text-xs font-medium rounded-md transition-all flex items-center gap-1.5" :class="activeView === 'automations' ? 'bg-background text-blue-600 shadow-sm ring-1 ring-border/50' : 'text-muted-foreground hover:text-foreground'" @click="activeView = 'automations'">
                <Zap class="size-3.5" /> Automations
                <Badge variant="secondary" class="text-[9px] px-1.5 tabular-nums">
                  {{ automations.length }}
                </Badge>
              </button>
            </div>
          </div>
          <Badge v-if="activeView === 'invoices'" variant="secondary" class="font-mono text-[10px]">
            {{ hasMore ? `${invoices.length}+` : invoices.length }} invoices
          </Badge>
          <Badge v-else variant="secondary" class="font-mono text-[10px]">
            {{ automations.filter(a => a.enabled).length }} active / {{ automations.length }}
          </Badge>
        </div>

        <!-- ═══════════════ INVOICES VIEW ═══════════════ -->
        <div v-if="activeView === 'invoices'" class="flex-1 overflow-auto">
          <table class="w-full text-sm caption-bottom border-collapse">
            <TableHeader class="sticky top-0 z-10 bg-card backdrop-blur shadow-[0_1px_2px_rgba(0,0,0,0.05)]">
              <TableRow>
                <TableHead class="w-[100px]">
                  #
                </TableHead>
                <TableHead>Dealer</TableHead>
                <TableHead>Month</TableHead>
                <TableHead>Source</TableHead>
                <TableHead class="text-right">
                  Subtotal
                </TableHead>
                <TableHead class="text-right">
                  Tax
                </TableHead>
                <TableHead class="text-right">
                  Total
                </TableHead>
                <TableHead class="text-right">
                  Paid $
                </TableHead>
                <TableHead>Status</TableHead>
                <TableHead class="text-center">
                  Actions
                </TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              <template v-for="inv in invoices" :key="inv.id">
                <TableRow
                  class="cursor-pointer hover:bg-muted/50 transition-colors"
                  :class="expandedInvoices.has(inv.id) ? 'bg-muted/30' : ''"
                  @click="toggleSet(expandedInvoices, inv.id)"
                >
                  <TableCell class="font-bold text-xs">
                    <div class="flex items-center gap-1.5 text-blue-600">
                      <ChevronRight v-if="!expandedInvoices.has(inv.id)" class="size-3 text-muted-foreground/50" />
                      <ChevronDown v-else class="size-3 text-blue-600" />
                      <FileSpreadsheet class="size-3.5 opacity-70" />
                      {{ inv.number }}
                    </div>
                  </TableCell>
                  <TableCell class="text-xs">
                    <p class="font-semibold max-w-[160px] truncate">
                      {{ inv.dealerName }}
                    </p>
                  </TableCell>
                  <TableCell class="text-xs whitespace-nowrap">
                    <Badge variant="outline" class="bg-blue-500/10 text-blue-600 border-blue-500/20 text-[10px]">
                      {{ inv.monthLabel || fmtDate(inv.date) }}
                    </Badge>
                  </TableCell>
                  <TableCell class="text-xs">
                    <Badge v-if="inv.automationId || inv.generatedByAutomation" variant="outline" class="bg-violet-500/10 text-violet-600 border-violet-500/20 text-[9px] gap-1">
                      <Zap class="size-2.5" /> Auto
                    </Badge>
                    <span v-else class="text-[10px] text-muted-foreground">Manual</span>
                  </TableCell>
                  <TableCell class="text-right text-xs tabular-nums text-muted-foreground">
                    {{ fmt(inv.subtotal) }}
                  </TableCell>
                  <TableCell class="text-right text-xs tabular-nums text-muted-foreground">
                    {{ fmt(inv.taxTotal) }}
                  </TableCell>
                  <TableCell class="text-right text-xs tabular-nums font-bold">
                    {{ fmt(inv.total) }}
                  </TableCell>
                  <TableCell class="text-right text-xs tabular-nums text-emerald-600 font-semibold">
                    <button class="hover:underline hover:text-emerald-700 cursor-pointer transition-colors" @click.stop="openPaymentDialog(inv)">
                      {{ inv.paidAmount ? fmt(inv.paidAmount) : '—' }}
                    </button>
                  </TableCell>
                  <TableCell>
                    <Badge variant="outline" :class="badgeClasses[inv.status] || ''" class="text-[10px]">
                      {{ inv.status }}
                    </Badge>
                  </TableCell>
                  <TableCell>
                    <div class="flex items-center justify-center gap-0.5">
                      <Button variant="ghost" size="icon" class="h-7 w-7 text-muted-foreground hover:text-blue-600 hover:bg-blue-50" title="Edit" @click.stop="openEditDialog(inv)">
                        <Pencil class="size-4" />
                      </Button>
                      <Button v-if="inv.status === 'Draft'" variant="ghost" size="icon" class="h-7 w-7 text-amber-600 hover:bg-amber-50" title="Approve" @click.stop="updateInvoiceStatus(inv, 'Approved')">
                        <ThumbsUp class="size-4" />
                      </Button>
                      <Button v-if="inv.status === 'Approved' || inv.status === 'Emailed'" variant="ghost" size="icon" class="h-7 w-7 text-emerald-600 hover:bg-emerald-50" title="Mark Paid" @click.stop="openPaymentDialog(inv)">
                        <CheckCircle class="size-4" />
                      </Button>
                      <Button variant="ghost" size="icon" class="h-7 w-7 text-blue-600 hover:bg-blue-50" title="Email Dealer" @click.stop="openEmailDialog(inv)">
                        <Send class="size-4" />
                      </Button>
                      <Button variant="ghost" size="icon" class="h-7 w-7 hover:text-primary hover:bg-primary/10" title="Preview" @click.stop="openPreviewFor(inv)">
                        <Eye class="size-4" />
                      </Button>
                      <Button variant="ghost" size="icon" class="h-7 w-7 text-muted-foreground hover:bg-muted" title="Download" @click.stop="handleDownload(inv)">
                        <Download class="size-4" />
                      </Button>
                      <Button variant="ghost" size="icon" class="h-7 w-7 text-red-500 hover:bg-red-50" title="Delete" @click.stop="deleteInvoice(inv)">
                        <Trash2 class="size-4" />
                      </Button>
                    </div>
                  </TableCell>
                </TableRow>

                <!-- Line Items Accordion (simplified: Service | Amount | Tax | Total) -->
                <TableRow v-if="expandedInvoices.has(inv.id)" class="bg-muted/20 border-t-0 hover:bg-muted/20">
                  <TableCell :colspan="10" class="p-0">
                    <div class="px-10 py-4 animate-in slide-in-from-top-2 duration-200">
                      <div class="border rounded-lg bg-card shadow-sm overflow-hidden max-w-3xl">
                        <table class="w-full text-[11px]">
                          <thead class="bg-muted/50 border-b">
                            <tr>
                              <th class="px-3 py-2 text-left font-semibold text-muted-foreground">
                                Service Description
                              </th>
                              <th class="px-3 py-2 text-right font-semibold text-muted-foreground w-[110px]">
                                Amount
                              </th>
                              <th class="px-3 py-2 text-right font-semibold text-muted-foreground w-[100px]">
                                Tax
                              </th>
                              <th class="px-3 py-2 text-right font-semibold text-muted-foreground w-[110px]">
                                Total
                              </th>
                            </tr>
                          </thead>
                          <tbody class="divide-y">
                            <tr v-for="(li, idx) in inv.lineItems" :key="idx" class="hover:bg-muted/30 transition-colors">
                              <td class="px-3 py-2 font-medium text-foreground uppercase">
                                {{ li.serviceName || li.description || '—' }}
                              </td>
                              <td class="px-3 py-2 text-right tabular-nums">
                                {{ fmt(li.amount ?? li.unitPrice) }}
                              </td>
                              <td class="px-3 py-2 text-right tabular-nums text-muted-foreground">
                                {{ fmt(li.tax) }}
                              </td>
                              <td class="px-3 py-2 text-right font-semibold tabular-nums">
                                {{ fmt((li.amount ?? li.unitPrice ?? 0) + (li.tax || 0)) }}
                              </td>
                            </tr>
                          </tbody>
                        </table>
                      </div>
                    </div>
                  </TableCell>
                </TableRow>
              </template>

              <template v-if="loading && invoices.length === 0">
                <TableRow v-for="i in 8" :key="i">
                  <TableCell v-for="j in 10" :key="j">
                    <Skeleton class="h-4 w-full rounded" />
                  </TableCell>
                </TableRow>
              </template>
              <TableRow v-if="!loading && invoices.length === 0">
                <TableCell :colspan="10" class="text-center py-14">
                  <FileSpreadsheet class="size-10 text-muted-foreground/20 mx-auto mb-3" />
                  <p class="text-sm font-medium text-foreground">
                    No monthly invoices yet
                  </p>
                  <p class="text-xs text-muted-foreground mt-1">
                    Create one manually, or set up an automation to generate them every month.
                  </p>
                  <div class="flex justify-center gap-2 mt-4">
                    <Button size="sm" variant="outline" class="gap-1.5" @click="activeView = 'automations'">
                      <Zap class="size-3.5" /> Set Up Automation
                    </Button>
                    <Button size="sm" class="gap-1.5 bg-blue-600 hover:bg-blue-700 text-white" @click="openCreateDialog">
                      <Plus class="size-3.5" /> New Monthly Invoice
                    </Button>
                  </div>
                </TableCell>
              </TableRow>

              <tr v-if="hasMore && invoices.length > 0" v-intersect="fetchInvoices" class="h-10">
                <td :colspan="10" class="text-center">
                  <div v-if="loading" class="flex justify-center py-4">
                    <Loader2 class="size-4 animate-spin text-muted-foreground/50" />
                  </div>
                </td>
              </tr>
            </TableBody>
          </table>
        </div>

        <!-- ═══════════════ AUTOMATIONS VIEW ═══════════════ -->
        <div v-else class="flex-1 overflow-auto p-4">
          <div v-if="automationsLoading && automations.length === 0" class="space-y-3">
            <Skeleton v-for="i in 4" :key="i" class="h-24 w-full rounded-xl" />
          </div>

          <div v-else-if="automations.length === 0" class="text-center py-16">
            <Sparkles class="size-10 text-muted-foreground/20 mx-auto mb-3" />
            <p class="text-sm font-medium text-foreground">
              No automations yet
            </p>
            <p class="text-xs text-muted-foreground mt-1 max-w-md mx-auto">
              An automation creates a monthly invoice for a dealer with your custom line items and emails it automatically on your schedule — until you disable it or its end date passes.
            </p>
            <Button size="sm" class="mt-4 gap-1.5 bg-blue-600 hover:bg-blue-700 text-white" @click="openAutomationCreate">
              <Plus class="size-3.5" /> New Automation
            </Button>
          </div>

          <div v-else class="grid gap-3">
            <div
              v-for="a in automations" :key="a.id"
              class="rounded-xl border bg-card shadow-sm p-4 transition-all hover:shadow-md"
              :class="!a.enabled ? 'opacity-70' : ''"
            >
              <div class="flex flex-col lg:flex-row lg:items-center gap-4">
                <!-- Left: identity -->
                <div class="flex-1 min-w-0">
                  <div class="flex items-center gap-2 flex-wrap">
                    <div class="p-1.5 rounded-lg" :class="a.enabled ? 'bg-blue-500/10 text-blue-600' : 'bg-muted text-muted-foreground'">
                      <Zap class="size-4" />
                    </div>
                    <span class="font-semibold text-sm truncate">{{ a.name }}</span>
                    <Badge variant="outline" :class="a.enabled ? 'bg-blue-500/10 text-blue-600 border-blue-500/20' : 'bg-gray-500/10 text-gray-500 border-gray-500/20'" class="text-[9px] uppercase">
                      {{ a.enabled ? 'Active' : 'Disabled' }}
                    </Badge>
                    <Badge v-if="a.endDate" variant="outline" class="bg-amber-500/10 text-amber-600 border-amber-500/20 text-[9px]">
                      Until {{ fmtDate(a.endDate) }}
                    </Badge>
                    <Badge v-else variant="outline" class="text-[9px] text-muted-foreground">
                      Ongoing
                    </Badge>
                  </div>
                  <div class="mt-1.5 flex items-center gap-3 text-xs text-muted-foreground flex-wrap">
                    <span class="font-medium text-foreground/80">{{ a.dealerName }}</span>
                    <span class="flex items-center gap-1"><CalendarClock class="size-3" /> {{ scheduleSummary(a) }}</span>
                    <span class="tabular-nums font-semibold text-foreground/80">{{ fmt(automationTotal(a)) }}/mo</span>
                    <span>{{ a.lineItems?.length || 0 }} item{{ (a.lineItems?.length || 0) === 1 ? '' : 's' }}</span>
                    <span>{{ a.emails?.length || 0 }} recipient{{ (a.emails?.length || 0) === 1 ? '' : 's' }}</span>
                  </div>
                  <div v-if="a.lastRunAt" class="mt-1 text-[11px] text-muted-foreground">
                    Last run {{ fmtDateTime(a.lastRunAt) }}
                    <template v-if="a.lastInvoiceNumber">
                      · <span class="font-mono text-blue-600">{{ a.lastInvoiceNumber }}</span>
                    </template>
                    <Badge variant="outline" class="ml-1 text-[9px]" :class="a.lastRunStatus === 'Sent' ? 'bg-emerald-500/10 text-emerald-600 border-emerald-500/20' : 'bg-red-500/10 text-red-600 border-red-500/20'">
                      {{ a.lastRunStatus || '—' }}
                    </Badge>
                    · {{ a.runsCount }} run{{ a.runsCount === 1 ? '' : 's' }}
                  </div>
                  <div v-else class="mt-1 text-[11px] text-muted-foreground italic">
                    Never run yet
                  </div>
                </div>

                <!-- Right: actions -->
                <div class="flex items-center gap-2 shrink-0">
                  <!-- Enable / Disable toggle -->
                  <button
                    type="button" role="switch" :aria-checked="a.enabled" title="Enable / Disable"
                    class="relative inline-flex h-6 w-11 shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors duration-200 ease-in-out"
                    :class="a.enabled ? 'bg-blue-600' : 'bg-input'"
                    @click="toggleAutomation(a)"
                  >
                    <span class="pointer-events-none block h-5 w-5 rounded-full bg-background shadow-lg transition-transform duration-200" :class="a.enabled ? 'translate-x-5' : 'translate-x-0'" />
                  </button>
                  <Button variant="outline" size="sm" class="h-8 gap-1.5 text-xs" :disabled="runningAutomationId === a.id" title="Generate & send this month's invoice now" @click="runAutomationNow(a)">
                    <Loader2 v-if="runningAutomationId === a.id" class="size-3.5 animate-spin" />
                    <Play v-else class="size-3.5 text-emerald-600" />
                    Run Now
                  </Button>
                  <Button variant="ghost" size="icon" class="h-8 w-8 text-muted-foreground hover:text-blue-600 hover:bg-blue-50" title="Edit & Preview" @click="openAutomationEdit(a)">
                    <Pencil class="size-4" />
                  </Button>
                  <Button variant="ghost" size="icon" class="h-8 w-8 text-red-500 hover:bg-red-50" title="Delete" @click="deleteAutomation(a)">
                    <Trash2 class="size-4" />
                  </Button>
                </div>
              </div>
            </div>
          </div>
        </div>
      </main>
    </div>

    <!-- ═══════════════ AUTOMATION EDITOR (form + LIVE preview) ═══════════════ -->
    <Dialog v-model:open="showAutomationDialog">
      <DialogContent class="sm:max-w-[96vw] w-[96vw] lg:max-w-[1400px] max-h-[95vh] overflow-hidden p-0 gap-0 flex flex-col">
        <div class="px-6 pt-5 pb-4 border-b bg-gradient-to-b from-blue-500/5 to-transparent shrink-0">
          <DialogTitle class="flex items-center gap-2.5 text-lg">
            <div class="p-2 bg-blue-500/10 text-blue-600 rounded-lg">
              <Zap class="size-4" />
            </div>
            {{ editingAutomationId ? 'Edit Automation' : 'New Monthly Automation' }}
          </DialogTitle>
          <DialogDescription class="mt-1.5 text-muted-foreground text-sm">
            Generates a monthly invoice with your line items and emails it automatically on schedule. The preview updates live.
          </DialogDescription>
        </div>

        <div class="flex-1 min-h-0 grid lg:grid-cols-[1fr_minmax(420px,44%)] overflow-hidden">
          <!-- ── LEFT: Form ── -->
          <div class="overflow-y-auto px-6 py-5 space-y-5 border-r">
            <!-- Name + Dealer -->
            <div class="grid sm:grid-cols-2 gap-4">
              <div class="grid gap-2">
                <Label class="text-xs font-semibold text-muted-foreground uppercase tracking-wider">Automation Name</Label>
                <Input v-model="autoForm.name" placeholder="e.g. ABC Motors – Monthly Detail" class="h-9 text-sm bg-background shadow-sm" />
              </div>
              <div class="grid gap-2">
                <Label class="text-xs font-semibold text-muted-foreground uppercase tracking-wider">Dealer</Label>
                <Popover v-model:open="autoDealerPopoverOpen">
                  <PopoverTrigger as-child>
                    <Button
                      variant="outline"
                      role="combobox"
                      :aria-expanded="autoDealerPopoverOpen"
                      class="h-9 text-sm bg-background shadow-sm justify-between w-full font-normal px-3"
                    >
                      <span class="truncate">
                        {{ dealers.find(d => d.id === autoForm.dealerId)?.dealerName || 'Select dealer...' }}
                      </span>
                      <ChevronsUpDown class="ml-2 size-4 shrink-0 opacity-50" />
                    </Button>
                  </PopoverTrigger>
                  <PopoverContent class="w-[--reka-popover-trigger-width] p-0" align="start">
                    <Command>
                      <CommandInput placeholder="Search dealer..." />
                      <CommandEmpty>No dealers found.</CommandEmpty>
                      <CommandList class="max-h-48">
                        <CommandGroup>
                          <CommandItem
                            v-for="d in dealers"
                            :key="d.id"
                            :value="d.dealerName"
                            @select="() => {
                              autoForm.dealerId = d.id
                              autoDealerPopoverOpen = false
                            }"
                            class="cursor-pointer flex items-center justify-between"
                          >
                            <span class="truncate">{{ d.dealerName }}</span>
                            <Check
                              v-if="autoForm.dealerId === d.id"
                              class="size-4 text-primary shrink-0"
                            />
                          </CommandItem>
                        </CommandGroup>
                      </CommandList>
                    </Command>
                  </PopoverContent>
                </Popover>
              </div>
            </div>

            <!-- Line Items -->
            <div class="border rounded-xl overflow-hidden shadow-sm">
              <div class="bg-muted/40 px-4 py-2.5 border-b flex items-center justify-between">
                <span class="text-xs font-bold text-muted-foreground uppercase tracking-widest">Invoice Line Items</span>
                <Button variant="outline" size="sm" class="h-7 gap-1 text-xs" @click="addAutoLine">
                  <Plus class="size-3" /> Add Line
                </Button>
              </div>
              <table class="w-full text-xs">
                <thead class="bg-muted/20 border-b">
                  <tr class="text-muted-foreground">
                    <th class="px-2 py-2 text-left font-semibold">
                      Service Description
                    </th>
                    <th class="px-2 py-2 text-right font-semibold w-[110px]">
                      Amount
                    </th>
                    <th class="px-2 py-2 text-right font-semibold w-[100px]">
                      Tax 6.35%
                    </th>
                    <th class="px-2 py-2 text-right font-semibold w-[95px]">
                      Total
                    </th>
                    <th class="px-1 py-2 w-[36px]" />
                  </tr>
                </thead>
                <tbody class="divide-y">
                  <tr v-for="(li, i) in autoForm.lineItems" :key="i" class="hover:bg-muted/20">
                    <td class="px-1.5 py-1.5">
                      <Input v-model="li.serviceName" placeholder="e.g. MONTHLY LOT WASH SERVICE" class="h-8 text-xs bg-background" />
                    </td>
                    <td class="px-1.5 py-1.5">
                      <Input v-model="li.amount" type="number" step="0.01" min="0" class="h-8 text-xs bg-background text-right" @input="onAmountChange(li)" />
                    </td>
                    <td class="px-1.5 py-1.5">
                      <Input v-model="li.tax" type="number" step="0.01" min="0" class="h-8 text-xs bg-background text-right" />
                    </td>
                    <td class="px-2 py-1.5 text-right font-semibold tabular-nums whitespace-nowrap">
                      {{ fmt((Number(li.amount) || 0) + (Number(li.tax) || 0)) }}
                    </td>
                    <td class="px-1 py-1.5 text-center">
                      <Button variant="ghost" size="icon" class="h-7 w-7 text-red-400 hover:text-red-600 hover:bg-red-50" @click="removeAutoLine(i)">
                        <X class="size-3.5" />
                      </Button>
                    </td>
                  </tr>
                </tbody>
              </table>
              <div class="border-t bg-muted/30 px-4 py-2 flex justify-end gap-6 text-xs">
                <span class="text-muted-foreground">Subtotal <b class="text-foreground tabular-nums ml-1">{{ fmt(autoTotals.subtotal) }}</b></span>
                <span class="text-muted-foreground">Tax <b class="text-foreground tabular-nums ml-1">{{ fmt(autoTotals.taxTotal) }}</b></span>
                <span class="font-bold text-blue-600 tabular-nums">{{ fmt(autoTotals.total) }}</span>
              </div>
            </div>

            <!-- Schedule -->
            <div class="border rounded-xl shadow-sm p-4 space-y-4">
              <span class="text-xs font-bold text-muted-foreground uppercase tracking-widest flex items-center gap-1.5">
                <CalendarClock class="size-3.5" /> Schedule
              </span>
              <div class="grid sm:grid-cols-2 gap-3">
                <div class="grid gap-2">
                  <Label class="text-xs font-medium text-muted-foreground">Rule</Label>
                  <Select v-model="autoForm.scheduleType">
                    <SelectTrigger class="h-9 text-xs bg-background shadow-sm">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="day_of_month">
                        Specific day of month
                      </SelectItem>
                      <SelectItem value="nth_weekday">
                        Nth weekday (e.g. first Monday)
                      </SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <div v-if="autoForm.scheduleType === 'day_of_month'" class="grid gap-2">
                  <Label class="text-xs font-medium text-muted-foreground">Day of Month</Label>
                  <Select v-model="autoForm.dayOfMonth">
                    <SelectTrigger class="h-9 text-xs bg-background shadow-sm">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent class="max-h-[240px]">
                      <SelectItem v-for="d in DAY_OF_MONTH_OPTIONS" :key="d" :value="d">
                        {{ d === 'last' ? 'Last day of month' : `Day ${d}` }}
                      </SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <div v-else class="grid grid-cols-2 gap-2">
                  <div class="grid gap-2">
                    <Label class="text-xs font-medium text-muted-foreground">Occurrence</Label>
                    <Select v-model="autoForm.nth">
                      <SelectTrigger class="h-9 text-xs bg-background shadow-sm">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem v-for="n in NTH_OPTIONS" :key="n" :value="n">
                          {{ n }}
                        </SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                  <div class="grid gap-2">
                    <Label class="text-xs font-medium text-muted-foreground">Weekday</Label>
                    <Select v-model="autoForm.weekday">
                      <SelectTrigger class="h-9 text-xs bg-background shadow-sm">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem v-for="w in WEEKDAY_OPTIONS" :key="w" :value="w">
                          {{ w }}
                        </SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                </div>
              </div>
              <div class="grid sm:grid-cols-3 gap-3">
                <div class="grid gap-2">
                  <Label class="text-xs flex items-center gap-1.5 font-medium text-muted-foreground"><Clock class="size-3.5" /> Time</Label>
                  <Input v-model="autoForm.time" type="time" class="h-9 text-sm bg-background shadow-sm" />
                </div>
                <div class="grid gap-2">
                  <Label class="text-xs flex items-center gap-1.5 font-medium text-muted-foreground"><Globe class="size-3.5" /> Timezone (US)</Label>
                  <Select v-model="autoForm.timezone">
                    <SelectTrigger class="h-9 text-xs bg-background shadow-sm">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem v-for="tz in US_TIMEZONES" :key="tz.value" :value="tz.value">
                        {{ tz.label }}
                      </SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <div class="grid gap-2">
                  <Label class="text-xs font-medium text-muted-foreground">Bill For</Label>
                  <Select v-model="autoForm.billingMonth">
                    <SelectTrigger class="h-9 text-xs bg-background shadow-sm">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="current">
                        Month it runs in
                      </SelectItem>
                      <SelectItem value="previous">
                        Previous month
                      </SelectItem>
                    </SelectContent>
                  </Select>
                </div>
              </div>
              <div class="grid sm:grid-cols-2 gap-3 items-end">
                <div class="grid gap-2">
                  <Label class="text-xs font-medium text-muted-foreground">Continue Until <span class="normal-case font-normal">(optional — blank = runs forever)</span></Label>
                  <Input v-model="autoForm.endDate" type="date" class="h-9 text-sm bg-background shadow-sm" />
                </div>
                <p class="text-[11px] text-blue-600/80 bg-blue-500/5 border border-blue-500/10 rounded-lg px-3 py-2 font-medium">
                  {{ autoScheduleSummary }}{{ autoForm.endDate ? ` · until ${fmtDate(autoForm.endDate)}` : ' · ongoing' }}
                </p>
              </div>
            </div>

            <!-- Email -->
            <div class="border rounded-xl shadow-sm p-4 space-y-4">
              <span class="text-xs font-bold text-muted-foreground uppercase tracking-widest flex items-center gap-1.5">
                <Mail class="size-3.5" /> Email
              </span>

              <!-- Recipients -->
              <div>
                <div v-if="autoDealerContacts.length > 0" class="mb-2">
                  <span class="text-[10px] font-bold text-muted-foreground uppercase tracking-widest mb-1.5 block">Quick Add from Dealer Contacts</span>
                  <div class="flex flex-wrap gap-1.5">
                    <button
                      v-for="c in autoDealerContacts" :key="c.email"
                      type="button"
                      class="inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-xs font-medium transition-all duration-150 border"
                      :class="autoForm.emails.includes(c.email)
                        ? 'bg-blue-600 text-white border-blue-600 shadow-sm scale-[1.02]'
                        : 'bg-card text-muted-foreground border-border hover:border-foreground/30 hover:text-foreground hover:bg-muted'"
                      @click="autoToggleContact(c.email)"
                    >
                      <Icon :name="autoForm.emails.includes(c.email) ? 'lucide:check' : 'lucide:plus'" class="size-3" />
                      <span class="font-semibold">{{ c.name }}</span>
                    </button>
                  </div>
                </div>
                <span class="text-[10px] font-bold text-muted-foreground uppercase tracking-widest mb-1.5 block">Recipients</span>
                <div class="min-h-[42px] flex flex-wrap items-center gap-1.5 p-2 rounded-lg border border-border bg-background transition-colors focus-within:ring-2 focus-within:ring-ring cursor-text">
                  <span
                    v-for="email in autoForm.emails" :key="email"
                    class="inline-flex items-center gap-1 pl-2.5 pr-1 py-1 rounded-md text-xs font-medium bg-muted text-foreground border border-border"
                  >
                    {{ email }}
                    <button type="button" class="ml-0.5 p-0.5 rounded hover:bg-foreground/10 transition-colors" @click.stop="autoRemoveEmail(email)">
                      <Icon name="lucide:x" class="size-3" />
                    </button>
                  </span>
                  <input
                    v-model="autoEmailInput"
                    type="email"
                    class="flex-1 min-w-[140px] bg-transparent text-sm outline-none placeholder:text-muted-foreground/50 h-7"
                    placeholder="Type email & press Enter"
                    @keydown="autoEmailKeydown"
                    @blur="autoAddCustomEmail"
                  >
                </div>
                <p class="text-[10px] text-muted-foreground mt-1">
                  If left empty, the dealer's "receive invoices" contacts are used automatically.
                </p>
              </div>

              <!-- Subject + Body -->
              <div class="grid gap-2">
                <Label class="text-xs font-medium text-muted-foreground">Email Subject <span class="font-normal">(blank = auto: "Monthly Invoice #### – Dealer (Month)")</span></Label>
                <Input v-model="autoForm.emailSubject" placeholder="Auto-generated if left blank" class="h-9 text-sm bg-background shadow-sm" />
              </div>
              <div class="grid gap-2">
                <Label class="text-xs font-medium text-muted-foreground">Email Body Message <span class="font-normal">(shown above the invoice in the email — appears in preview)</span></Label>
                <textarea
                  v-model="autoForm.emailBody"
                  rows="4"
                  placeholder="Hi team,&#10;&#10;Please find attached this month's invoice. Payment is due within 30 days.&#10;&#10;Thank you!"
                  class="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm shadow-sm outline-none focus:ring-2 focus:ring-ring placeholder:text-muted-foreground/50 resize-y"
                />
              </div>
            </div>
          </div>

          <!-- ── RIGHT: LIVE Preview ── -->
          <div class="hidden lg:flex flex-col bg-gray-100/60 dark:bg-muted/20 min-h-0">
            <div class="px-4 py-2.5 border-b bg-muted/30 flex items-center justify-between shrink-0">
              <span class="text-xs font-bold text-muted-foreground uppercase tracking-widest flex items-center gap-1.5">
                <Eye class="size-3.5" /> Live Preview — {{ autoBillingMonthLabel }}
              </span>
              <Badge variant="outline" class="bg-blue-500/10 text-blue-600 border-blue-500/20 text-[9px]">
                Monthly · Blue
              </Badge>
            </div>
            <div class="flex-1 overflow-auto p-4">
              <div class="border rounded-lg overflow-hidden bg-white shadow-lg mx-auto" style="max-width: 720px;">
                <iframe :srcdoc="autoPreviewHtml" class="w-full border-0 min-h-[900px]" />
              </div>
            </div>
          </div>
        </div>

        <!-- Footer -->
        <div class="px-6 py-4 border-t bg-muted/30 flex items-center justify-between gap-3 shrink-0">
          <div class="flex items-center gap-2.5">
            <button
              type="button" role="switch" :aria-checked="autoForm.enabled"
              class="relative inline-flex h-6 w-11 shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors duration-200 ease-in-out"
              :class="autoForm.enabled ? 'bg-blue-600' : 'bg-input'"
              @click.stop.prevent="autoForm.enabled = !autoForm.enabled"
            >
              <span class="pointer-events-none block h-5 w-5 rounded-full bg-background shadow-lg transition-transform duration-200" :class="autoForm.enabled ? 'translate-x-5' : 'translate-x-0'" />
            </button>
            <Label class="text-xs font-medium cursor-pointer" @click="autoForm.enabled = !autoForm.enabled">
              {{ autoForm.enabled ? 'Automation Active' : 'Automation Disabled' }}
            </Label>
          </div>
          <div class="flex gap-2">
            <Button
              v-if="editingAutomationId"
              variant="outline" size="sm" class="gap-1.5 text-xs"
              :disabled="runningAutomationId === editingAutomationId"
              title="Generate & send this month's invoice now"
              @click="runAutomationNow({ id: editingAutomationId })"
            >
              <Loader2 v-if="runningAutomationId === editingAutomationId" class="size-3.5 animate-spin" />
              <Play v-else class="size-3.5 text-emerald-600" />
              Run Now
            </Button>
            <Button variant="outline" size="sm" @click="showAutomationDialog = false">
              Cancel
            </Button>
            <Button size="sm" class="bg-blue-600 hover:bg-blue-700 text-white min-w-[140px]" :disabled="isSavingAutomation" @click="saveAutomation">
              <Loader2 v-if="isSavingAutomation" class="mr-1.5 size-3.5 animate-spin" />
              <Save v-else class="mr-1.5 size-3.5" />
              {{ editingAutomationId ? 'Update Automation' : 'Create Automation' }}
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>

    <!-- ═══════════════ MANUAL INVOICE CREATE / EDIT ═══════════════ -->
    <Dialog v-model:open="showFormDialog">
      <DialogContent class="sm:max-w-[720px] w-[95vw] max-h-[92vh] overflow-auto p-0 gap-0">
        <div class="px-6 pt-5 pb-4 border-b bg-gradient-to-b from-blue-500/5 to-transparent">
          <DialogTitle class="flex items-center gap-2.5 text-lg">
            <div class="p-2 bg-blue-500/10 text-blue-600 rounded-lg">
              <FileSpreadsheet class="size-4" />
            </div>
            {{ editingId ? 'Edit Monthly Invoice' : 'New Monthly Invoice' }}
          </DialogTitle>
          <DialogDescription class="mt-1.5 text-muted-foreground text-sm">
            Custom line items billed as a single monthly invoice{{ monthLabelPreview ? ` — Month of ${monthLabelPreview}` : '' }}.
          </DialogDescription>
        </div>

        <div class="px-6 py-5 space-y-5">
          <div class="grid sm:grid-cols-2 gap-4">
            <div class="grid gap-2">
              <Label class="text-xs font-semibold text-muted-foreground uppercase tracking-wider">Dealer</Label>
              <Popover v-model:open="invoiceDealerPopoverOpen">
                <PopoverTrigger as-child>
                  <Button
                    variant="outline"
                    role="combobox"
                    :aria-expanded="invoiceDealerPopoverOpen"
                    class="h-9 text-sm bg-background shadow-sm justify-between w-full font-normal px-3"
                  >
                    <span class="truncate">
                      {{ dealers.find(d => d.id === form.dealerId)?.dealerName || 'Select dealer...' }}
                    </span>
                    <ChevronsUpDown class="ml-2 size-4 shrink-0 opacity-50" />
                  </Button>
                </PopoverTrigger>
                <PopoverContent class="w-[--reka-popover-trigger-width] p-0" align="start">
                  <Command>
                    <CommandInput placeholder="Search dealer..." />
                    <CommandEmpty>No dealers found.</CommandEmpty>
                    <CommandList class="max-h-48">
                      <CommandGroup>
                        <CommandItem
                          v-for="d in dealers"
                          :key="d.id"
                          :value="d.dealerName"
                          @select="() => {
                            form.dealerId = d.id
                            invoiceDealerPopoverOpen = false
                          }"
                          class="cursor-pointer flex items-center justify-between"
                        >
                          <span class="truncate">{{ d.dealerName }}</span>
                          <Check
                            v-if="form.dealerId === d.id"
                            class="size-4 text-primary shrink-0"
                          />
                        </CommandItem>
                      </CommandGroup>
                    </CommandList>
                  </Command>
                </PopoverContent>
              </Popover>
            </div>
            <div class="grid gap-2">
              <Label class="text-xs font-semibold text-muted-foreground uppercase tracking-wider">Billing Month</Label>
              <Input v-model="form.monthKey" type="month" class="h-9 text-sm bg-background shadow-sm" />
            </div>
          </div>

          <!-- Simplified Line Items: Service Description | Amount | Tax | Total -->
          <div class="border rounded-xl overflow-hidden shadow-sm">
            <div class="bg-muted/40 px-4 py-2.5 border-b flex items-center justify-between">
              <span class="text-xs font-bold text-muted-foreground uppercase tracking-widest">Line Items</span>
              <Button variant="outline" size="sm" class="h-7 gap-1 text-xs" @click="form.lineItems.push(emptyLine())">
                <Plus class="size-3" /> Add Line
              </Button>
            </div>
            <table class="w-full text-xs">
              <thead class="bg-muted/20 border-b">
                <tr class="text-muted-foreground">
                  <th class="px-2 py-2 text-left font-semibold">
                    Service Description
                  </th>
                  <th class="px-2 py-2 text-right font-semibold w-[120px]">
                    Amount
                  </th>
                  <th class="px-2 py-2 text-right font-semibold w-[110px]">
                    Tax 6.35%
                  </th>
                  <th class="px-2 py-2 text-right font-semibold w-[100px]">
                    Total
                  </th>
                  <th class="px-1 py-2 w-[36px]" />
                </tr>
              </thead>
              <tbody class="divide-y">
                <tr v-for="(li, i) in form.lineItems" :key="i" class="hover:bg-muted/20">
                  <td class="px-1.5 py-1.5">
                    <Input v-model="li.serviceName" placeholder="e.g. FULL DETAIL PACKAGE" class="h-8 text-xs bg-background" />
                  </td>
                  <td class="px-1.5 py-1.5">
                    <Input v-model="li.amount" type="number" step="0.01" min="0" class="h-8 text-xs bg-background text-right" @input="onAmountChange(li)" />
                  </td>
                  <td class="px-1.5 py-1.5">
                    <Input v-model="li.tax" type="number" step="0.01" min="0" class="h-8 text-xs bg-background text-right" />
                  </td>
                  <td class="px-2 py-1.5 text-right font-semibold tabular-nums whitespace-nowrap">
                    {{ fmt((Number(li.amount) || 0) + (Number(li.tax) || 0)) }}
                  </td>
                  <td class="px-1 py-1.5 text-center">
                    <Button variant="ghost" size="icon" class="h-7 w-7 text-red-400 hover:text-red-600 hover:bg-red-50" @click="removeFormLine(i)">
                      <X class="size-3.5" />
                    </Button>
                  </td>
                </tr>
              </tbody>
            </table>
            <div class="border-t bg-muted/30 px-4 py-3 flex justify-end">
              <div class="w-[260px] space-y-1.5 text-sm">
                <div class="flex justify-between text-muted-foreground text-xs">
                  <span>Subtotal</span><span class="tabular-nums font-medium text-foreground">{{ fmt(formTotals.subtotal) }}</span>
                </div>
                <div class="flex justify-between text-muted-foreground text-xs">
                  <span>Tax</span><span class="tabular-nums font-medium text-foreground">{{ fmt(formTotals.taxTotal) }}</span>
                </div>
                <div class="flex justify-between font-bold border-t border-dashed pt-1.5">
                  <span>Total</span><span class="tabular-nums text-blue-600">{{ fmt(formTotals.total) }}</span>
                </div>
              </div>
            </div>
          </div>
        </div>

        <div class="px-6 py-4 border-t bg-muted/30 flex justify-end gap-2">
          <Button variant="outline" @click="showFormDialog = false">
            Cancel
          </Button>
          <Button class="bg-blue-600 hover:bg-blue-700 text-white min-w-[140px]" :disabled="isSavingForm" @click="saveInvoice">
            <Loader2 v-if="isSavingForm" class="mr-2 size-4 animate-spin" />
            <Save v-else class="mr-2 size-4" />
            {{ editingId ? 'Update Invoice' : 'Create Invoice' }}
          </Button>
        </div>
      </DialogContent>
    </Dialog>

    <!-- Preview Dialog -->
    <Dialog v-model:open="showPreview">
      <DialogContent class="sm:max-w-[70vw] w-[95vw] lg:max-w-[1000px] max-h-[95vh] overflow-auto p-0 gap-0 [&>button:last-child]:hidden">
        <div class="p-4 border-b flex items-center justify-between bg-muted/20">
          <DialogTitle class="flex items-center gap-2">
            <div class="p-1.5 bg-blue-500/10 text-blue-600 rounded-md">
              <FileSpreadsheet class="size-4" />
            </div>
            Invoice Preview – {{ selectedInvoice?.number }}
          </DialogTitle>
          <div class="flex gap-2">
            <Button variant="outline" size="sm" @click="showPreview = false">
              Close
            </Button>
            <Button variant="secondary" size="sm" @click="openEmailDialog(selectedInvoice)">
              <Mail class="mr-1 size-4" /> Email Dealer
            </Button>
            <Button size="sm" class="bg-blue-600 hover:bg-blue-700 text-white" @click="handleDownload(selectedInvoice)">
              <Download class="mr-1 size-4" /> Download PDF
            </Button>
          </div>
        </div>
        <div class="bg-gray-50/50 p-6 flex justify-center">
          <div class="border rounded-lg overflow-hidden bg-white shadow-lg w-full max-w-[850px]">
            <iframe :srcdoc="previewHtml" class="w-full border-0 min-h-[750px]" />
          </div>
        </div>
      </DialogContent>
    </Dialog>

    <!-- Email Dialog -->
    <Dialog v-model:open="showEmailDialog">
      <DialogContent class="sm:max-w-[480px] p-0 gap-0 overflow-hidden">
        <div class="px-5 pt-5 pb-4 border-b bg-gradient-to-b from-muted/50 to-transparent">
          <DialogTitle class="flex items-center gap-2.5 text-lg">
            <div class="p-2 bg-muted text-foreground rounded-lg">
              <Send class="size-4" />
            </div>
            Email Monthly Invoice
          </DialogTitle>
          <DialogDescription class="mt-1.5 text-muted-foreground text-sm">
            Send <span class="font-semibold text-foreground">{{ selectedEmailInvoice?.number }}</span> to <span class="font-semibold text-foreground">{{ selectedEmailInvoice?.dealerName }}</span>
          </DialogDescription>
        </div>

        <div class="px-5 py-4 space-y-4">
          <div v-if="isFetchingContacts" class="flex items-center text-sm text-muted-foreground gap-2 py-3">
            <Loader2 class="size-3.5 animate-spin" /> Loading contacts...
          </div>
          <div v-else-if="dealerContacts.length > 0">
            <span class="text-[10px] font-bold text-muted-foreground uppercase tracking-widest mb-2 block">Quick Add from Contacts</span>
            <div class="flex flex-wrap gap-1.5">
              <button
                v-for="c in dealerContacts" :key="c.email"
                type="button"
                class="inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-xs font-medium transition-all duration-150 border"
                :class="recipientEmails.includes(c.email)
                  ? 'bg-blue-600 text-white border-blue-600 shadow-sm scale-[1.02]'
                  : 'bg-card text-muted-foreground border-border hover:border-foreground/30 hover:text-foreground hover:bg-muted'"
                @click="toggleContact(c.email)"
              >
                <Icon :name="recipientEmails.includes(c.email) ? 'lucide:check' : 'lucide:plus'" class="size-3" />
                <span class="font-semibold">{{ c.name }}</span>
              </button>
            </div>
          </div>

          <div>
            <span class="text-[10px] font-bold text-muted-foreground uppercase tracking-widest mb-1.5 block">Recipients</span>
            <div class="min-h-[44px] flex flex-wrap items-center gap-1.5 p-2 rounded-lg border border-border bg-background transition-colors focus-within:ring-2 focus-within:ring-ring cursor-text">
              <span
                v-for="email in recipientEmails" :key="email"
                class="inline-flex items-center gap-1 pl-2.5 pr-1 py-1 rounded-md text-xs font-medium bg-muted text-foreground border border-border"
              >
                {{ email }}
                <button type="button" class="ml-0.5 p-0.5 rounded hover:bg-foreground/10 transition-colors" @click.stop="removeRecipient(email)">
                  <Icon name="lucide:x" class="size-3" />
                </button>
              </span>
              <input
                v-model="newEmailInput"
                type="email"
                class="flex-1 min-w-[140px] bg-transparent text-sm outline-none placeholder:text-muted-foreground/50 h-7"
                placeholder="Type email & press Enter"
                @keydown="handleEmailInputKeydown"
                @blur="addCustomEmail"
              >
            </div>
          </div>
        </div>

        <div class="px-5 py-3.5 border-t bg-muted/30 flex items-center justify-end gap-2">
          <Button variant="outline" size="sm" @click="showEmailDialog = false">
            Cancel
          </Button>
          <Button size="sm" class="bg-blue-600 hover:bg-blue-700 text-white min-w-[120px]" :disabled="recipientEmails.length === 0 && !newEmailInput" @click="handleEmailDialogSubmit">
            <Send class="mr-2 size-3.5" />
            Send{{ recipientEmails.length > 0 ? ` to ${recipientEmails.length}` : '' }}
          </Button>
        </div>
      </DialogContent>
    </Dialog>

    <!-- Payment Dialog -->
    <Dialog v-model:open="showPaymentDialog">
      <DialogContent class="sm:max-w-[400px]">
        <div class="px-2 pt-2">
          <DialogTitle class="flex items-center gap-2 text-lg">
            <div class="p-1.5 bg-emerald-500/10 text-emerald-600 rounded-md">
              <CheckCircle class="size-5" />
            </div>
            Mark as Paid
          </DialogTitle>
          <DialogDescription class="mt-2 text-muted-foreground">
            Enter the amount paid for <span class="font-semibold text-foreground">{{ selectedPaymentInvoice?.number }}</span>.
          </DialogDescription>

          <div class="mt-6 space-y-4">
            <div class="space-y-2">
              <label class="text-sm font-medium">Payment Amount</label>
              <div class="relative">
                <span class="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground">$</span>
                <Input v-model="paymentAmount" type="number" step="0.01" class="pl-7" placeholder="0.00" @keydown.enter="handlePaymentSubmit" />
              </div>
            </div>
          </div>
        </div>
        <div class="mt-6 flex justify-end gap-2 px-2 pb-2">
          <Button variant="outline" @click="showPaymentDialog = false">
            Cancel
          </Button>
          <Button class="bg-emerald-600 hover:bg-emerald-700 text-white" :disabled="isPaying || !paymentAmount" @click="handlePaymentSubmit">
            <Loader2 v-if="isPaying" class="mr-2 size-4 animate-spin" />
            Confirm Payment
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  </div>
</template>
