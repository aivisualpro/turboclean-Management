<script setup lang="ts">
import { ref, onMounted, computed, watch } from 'vue'
import { useRoute } from 'vue-router'
import type { Dealer } from '~/composables/useDealers'
import { Mail, Clock, Inbox as InboxIcon, Loader2, Send, Archive, FileText, CornerUpLeft, Search, Paperclip, MoreHorizontal, UserCircle2 } from 'lucide-vue-next'

const props = defineProps<{ dealer: Dealer }>()
const route = useRoute()

const emails = ref<any[]>([])
const loading = ref(true)
const activeFolder = ref<'inbox' | 'sent'>((route.params.folder as any) || 'sent')
const selectedEmail = ref<any>(null)
const searchQuery = ref('')

watch(() => route.params.folder, (newFolder) => {
  activeFolder.value = (newFolder as any) || 'sent'
  // Auto-select the first newest email in the newly active folder
  const available = emails.value
    .filter(e => e.folder === activeFolder.value)
    .sort((a,b) => new Date(b.receivedAt).getTime() - new Date(a.receivedAt).getTime())
  
  selectedEmail.value = available.length > 0 ? available[0] : null
})

onMounted(async () => {
  try {
    // Eventually this will fetch both incoming and outgoing, identified by 'folder'
    const res = await $fetch<any[]>(`/api/emails?dealerId=${props.dealer.id}`)
    
    // Normalize existing data to match a full mailbox schema
    emails.value = (res || []).map(e => ({
      ...e,
      folder: e.folder || 'sent', // Legacy data defaults to 'sent'
      from: e.from || 'system@zarzops.com',
      to: e.email || (props.dealer as any).email || e.to,
      bodyHtml: e.bodyHtml || e.body || `<p class="text-muted-foreground p-4 bg-muted/20 border border-dashed rounded-lg italic">System Dispatch: No HTML body persisted for this legacy outgoing email. Linked to ${e.type || 'Invoice'}.</p>`,
      attachments: e.attachments || [],
      receivedAt: e.sentAt || e.receivedAt || new Date().toISOString()
    }))
    
    // Auto-select newest within active folder
    if (emails.value.length > 0) {
      const available = emails.value
        .filter(e => e.folder === activeFolder.value)
        .sort((a,b) => new Date(b.receivedAt).getTime() - new Date(a.receivedAt).getTime())
      
      selectedEmail.value = available.length > 0 ? available[0] : null
    }
  } catch (e) {
    console.error(e)
  } finally {
    loading.value = false
  }
})

const filteredEmails = computed(() => {
  return emails.value
    .filter(e => e.folder === activeFolder.value)
    .filter(e => !searchQuery.value || e.subject?.toLowerCase().includes(searchQuery.value.toLowerCase()) || e.to?.toLowerCase().includes(searchQuery.value.toLowerCase()))
    .sort((a,b) => new Date(b.receivedAt).getTime() - new Date(a.receivedAt).getTime())
})

const folderCounts = computed(() => {
  return {
    inbox: emails.value.filter(e => e.folder === 'inbox').length,
    sent: emails.value.filter(e => e.folder === 'sent').length
  }
})

function selectEmail(email: any) {
  selectedEmail.value = email
}

const formatDate = (d: string) => {
  const date = new Date(d)
  const isToday = new Date().toDateString() === date.toDateString()
  return isToday ? date.toLocaleTimeString([], {hour: '2-digit', minute:'2-digit'}) : date.toLocaleDateString([], { month: 'short', day: 'numeric'})
}

// ── Attachment helpers ────────────────────────────────────────────────────
const imageExts = ['jpg', 'jpeg', 'png', 'gif', 'webp', 'bmp', 'svg']

function isImageAttachment(att: any): boolean {
  // Check filename extension
  const ext = (att.filename || '').split('.').pop()?.toLowerCase() || ''
  if (imageExts.includes(ext)) return true
  // Check data URI content type
  if (att.content?.startsWith('data:image/')) return true
  return false
}

function getAttachmentType(att: any): string {
  if (isImageAttachment(att)) return 'Image'
  const ext = (att.filename || '').split('.').pop()?.toLowerCase() || ''
  if (ext === 'pdf' || att.content?.startsWith('data:application/pdf')) return 'PDF Document'
  if (ext === 'html' || att.content?.startsWith('data:text/html')) return 'HTML Document'
  return 'File'
}

// ── Lightbox state ───────────────────────────────────────────────────────
const lightboxOpen = ref(false)
const lightboxSrc = ref('')
const lightboxFilename = ref('')

function openLightbox(att: any) {
  lightboxSrc.value = att.content || ''
  lightboxFilename.value = att.filename || 'Image'
  lightboxOpen.value = true
}

function closeLightbox() {
  lightboxOpen.value = false
  lightboxSrc.value = ''
}
</script>

<template>
  <div class="h-full flex overflow-hidden rounded-xl border bg-card shadow-sm text-sm">
    
    <!-- 1. Mailbox Sidebar (Folders) -->
    <div class="w-48 shrink-0 border-r bg-muted/10 flex flex-col items-stretch p-3 hidden sm:flex">
      <div class="mb-4 px-2">
        <h3 class="font-bold text-base flex items-center gap-2 tracking-tight text-foreground">
          <Mail class="size-4 text-primary" /> Mailbox
        </h3>
      </div>
      
      <div class="space-y-1">
        <NuxtLink 
          :to="`/dealers/${props.dealer.id}/emails/inbox`"
          class="w-full flex items-center justify-between px-3 py-2 rounded-md transition-colors text-left no-underline"
          :class="activeFolder === 'inbox' ? 'bg-primary/10 text-primary font-medium' : 'text-muted-foreground hover:bg-muted'"
        >
          <div class="flex items-center gap-2"><InboxIcon class="size-4 opacity-80" /> Inbox</div>
          <span class="text-[10px] font-mono opacity-60">{{ folderCounts.inbox }}</span>
        </NuxtLink>
        <NuxtLink 
          :to="`/dealers/${props.dealer.id}/emails/sent`"
          class="w-full flex items-center justify-between px-3 py-2 rounded-md transition-colors text-left no-underline"
          :class="activeFolder === 'sent' ? 'bg-primary/10 text-primary font-medium' : 'text-muted-foreground hover:bg-muted'"
        >
          <div class="flex items-center gap-2"><Send class="size-4 opacity-80" /> Sent</div>
          <span class="text-[10px] font-mono opacity-60">{{ folderCounts.sent }}</span>
        </NuxtLink>
      </div>
    </div>

    <!-- 2. Email List Column -->
    <div class="w-full sm:w-[320px] shrink-0 border-r flex flex-col bg-background relative z-10 shadow-[1px_0_10px_rgba(0,0,0,0.02)]">
      <div class="p-3 border-b shrink-0 bg-muted/5">
        <div class="relative">
          <Search class="absolute left-2.5 top-1/2 -translate-y-1/2 size-3.5 text-muted-foreground" />
          <Input v-model="searchQuery" :placeholder="`Search ${activeFolder}...`" class="pl-8 h-8 text-xs bg-background shadow-none border-border/80" />
        </div>
      </div>
      
      <div class="flex-1 overflow-y-auto">
        <div v-if="loading" class="flex justify-center py-10">
          <Loader2 class="size-5 animate-spin text-muted-foreground/40" />
        </div>
        
        <div v-else-if="filteredEmails.length === 0" class="flex flex-col items-center justify-center h-full p-6 text-center opacity-50">
          <Archive class="size-8 mb-2 opacity-50" />
          <p class="font-medium text-sm">Empty {{ activeFolder }}</p>
          <p class="text-xs mt-1 leading-relaxed">No messages found here.</p>
        </div>

        <div v-else class="divide-y divide-border/50">
          <button 
            v-for="email in filteredEmails" :key="email.id || email.receivedAt"
            class="w-full text-left p-3 hover:bg-muted/40 transition-colors flex flex-col gap-1 relative"
            :class="selectedEmail && selectedEmail.id === email.id ? 'bg-primary/5 before:absolute before:inset-y-0 before:left-0 before:w-0.5 before:bg-primary' : ''"
            @click="selectEmail(email)"
          >
            <div class="flex items-center justify-between gap-2">
              <span class="font-semibold text-xs truncate" :class="selectedEmail?.id === email.id ? 'text-primary' : 'text-foreground'">
                {{ activeFolder === 'inbox' ? email.from : email.to }}
              </span>
              <span class="text-[10px] text-muted-foreground shrink-0 whitespace-nowrap tabular-nums">{{ formatDate(email.receivedAt) }}</span>
            </div>
            
            <div class="font-medium text-xs text-foreground/90 truncate pr-4">{{ email.subject || '(No Subject)' }}</div>
            
            <div class="flex items-center gap-2 mt-0.5">
              <span class="text-xs text-muted-foreground truncate leading-relaxed line-clamp-1 opacity-80">{{ email.bodyHtml?.replace(/<[^>]*>?/gm, ' ') || 'Open to view message...' }}</span>
              <Paperclip v-if="email.attachments?.length > 0" class="size-3 shrink-0 text-muted-foreground/60" />
            </div>
            
            <Badge v-if="email.type === 'Invoice'" variant="outline" class="mt-1.5 self-start text-[9px] h-4 px-1.5 font-normal tracking-wide bg-blue-500/5 text-blue-600 border-blue-200">System Invoice</Badge>
          </button>
        </div>
      </div>
    </div>

    <!-- 3. Reading Pane -->
    <div class="flex-1 flex flex-col min-w-0 bg-white relative">
      <div v-if="!selectedEmail && !loading" class="absolute inset-0 flex flex-col items-center justify-center opacity-40 select-none">
        <Mail class="size-16 mb-4 text-muted-foreground stroke-1" />
        <h3 class="text-lg font-medium">No Email Selected</h3>
        <p class="text-sm">Select an email to view its details.</p>
      </div>

      <template v-else-if="selectedEmail">
        <!-- Reading Pane Header -->
        <div class="p-5 border-b shrink-0 flex flex-col gap-4">
          <div class="flex items-start justify-between gap-4">
            <h2 class="text-lg font-bold text-foreground leading-tight">{{ selectedEmail.subject }}</h2>
            <div class="flex items-center gap-1 shrink-0">
              <Button size="icon" variant="ghost" class="h-8 w-8 text-muted-foreground"><CornerUpLeft class="size-4" /></Button>
              <Button size="icon" variant="ghost" class="h-8 w-8 text-muted-foreground"><MoreHorizontal class="size-4" /></Button>
            </div>
          </div>
          
          <div class="flex items-center gap-3">
            <div class="flex items-center justify-center size-10 rounded-full bg-gradient-to-br from-primary/20 to-primary/10 border shadow-sm">
              <UserCircle2 class="size-5 text-primary opacity-70" />
            </div>
            <div class="flex flex-col min-w-0 flex-1">
              <div class="flex items-center justify-between gap-2">
                <span class="font-semibold text-sm truncate">{{ selectedEmail.from }}</span>
                <span class="text-xs text-muted-foreground whitespace-nowrap font-medium">{{ new Date(selectedEmail.receivedAt).toLocaleString() }}</span>
              </div>
              <span class="text-xs text-muted-foreground truncate">To: {{ selectedEmail.to }}</span>
            </div>
          </div>
        </div>

        <!-- Render HTML Body -->
        <div class="flex-1 overflow-y-auto p-6 md:p-8 relative">
          <div class="prose prose-sm prose-slate max-w-none w-full break-words [&_a]:text-blue-600 [&_img]:max-w-full" v-html="selectedEmail.bodyHtml"></div>
        </div>
        
        <!-- Attachments Strip -->
        <div v-if="selectedEmail.attachments?.length > 0" class="p-4 border-t bg-muted/5 shrink-0 flex flex-nowrap overflow-x-auto gap-3">
          <template v-for="(att, i) in selectedEmail.attachments" :key="i">
            
            <!-- Image Attachment — clickable thumbnail -->
            <div v-if="isImageAttachment(att)" 
              class="flex flex-col shrink-0 w-32 border rounded-lg bg-card shadow-sm group hover:border-primary/50 transition-all cursor-pointer overflow-hidden hover:shadow-md"
              @click="openLightbox(att)"
            >
              <div class="h-24 w-full bg-muted/20 overflow-hidden">
                <img :src="att.content" :alt="att.filename" class="w-full h-full object-cover transition-transform group-hover:scale-105" />
              </div>
              <div class="p-2 border-t">
                <span class="text-[10px] font-semibold truncate block">{{ att.filename || 'Photo' }}</span>
                <span class="text-[9px] text-emerald-600 font-medium">Image</span>
              </div>
            </div>

            <!-- PDF / Other Attachment — file card -->
            <div v-else class="flex flex-col shrink-0 w-48 border rounded-lg bg-card p-3 shadow-sm group hover:border-primary/50 transition-colors">
              <div class="flex items-center gap-2 mb-2">
                <div class="p-1.5 rounded-md bg-blue-50 text-blue-600"><FileText class="size-4" /></div>
                <span class="text-xs font-semibold truncate flex-1">{{ att.filename || 'Attachment' }}</span>
              </div>
              <div class="flex items-center gap-2 text-[10px] text-muted-foreground w-full justify-between">
                <span>{{ getAttachmentType(att) }}</span>
                <a :href="att.content || '#'" :download="att.filename" class="text-primary hover:underline font-medium opacity-0 group-hover:opacity-100 transition-opacity">Download</a>
              </div>
            </div>

          </template>
        </div>
      </template>

    </div>

    <!-- Image Lightbox Overlay -->
    <Teleport to="body">
      <Transition name="lightbox">
        <div v-if="lightboxOpen" class="fixed inset-0 z-[9999] flex items-center justify-center bg-black/80 backdrop-blur-sm" @click.self="closeLightbox">
          <div class="relative max-w-[90vw] max-h-[90vh] flex flex-col items-center">
            <!-- Close button -->
            <button @click="closeLightbox" class="absolute -top-10 right-0 text-white/80 hover:text-white text-sm font-medium flex items-center gap-1 transition-colors">
              <span>Close</span>
              <span class="text-lg leading-none">×</span>
            </button>
            <!-- Image -->
            <img :src="lightboxSrc" :alt="lightboxFilename" class="max-w-full max-h-[85vh] rounded-lg shadow-2xl object-contain" />
            <!-- Filename -->
            <p class="mt-3 text-white/70 text-xs font-medium">{{ lightboxFilename }}</p>
          </div>
        </div>
      </Transition>
    </Teleport>

  </div>
</template>

<style scoped>
.lightbox-enter-active,
.lightbox-leave-active {
  transition: opacity 0.2s ease;
}
.lightbox-enter-from,
.lightbox-leave-to {
  opacity: 0;
}
</style>
