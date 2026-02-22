<script setup lang="ts">
import NumberFlow from '@number-flow/vue'

const { setHeader } = usePageHeader()
setHeader({ title: 'Documentation', icon: 'i-lucide-book-open', description: 'Turbo Clean Management platform overview' })

const stats = ref({
  modules: 0,
  components: 0,
  pages: 0,
  features: 0,
})

onMounted(() => {
  stats.value = {
    modules: 12,
    components: 63,
    pages: 45,
    features: 200,
  }
})

const modules = [
  {
    title: 'CRM',
    description: 'Customer Relationship Management with contacts, leads, deals pipeline, companies, and activity tracking.',
    icon: 'i-lucide-contact',
    color: 'text-blue-500',
    bgColor: 'bg-blue-500/10',
    features: ['Contacts', 'Leads', 'Deals Pipeline', 'Companies', 'Activities'],
    link: '/crm/contacts',
  },
  {
    title: 'Sales & Commerce',
    description: 'End-to-end sales operations with quotes, invoices, orders, products catalog, and customer management.',
    icon: 'i-lucide-shopping-cart',
    color: 'text-emerald-500',
    bgColor: 'bg-emerald-500/10',
    features: ['Quotes', 'Invoices', 'Orders', 'Products', 'Customers'],
    link: '/sales/quotes',
  },
  {
    title: 'Inventory & Warehouse',
    description: 'Real-time inventory control with multi-warehouse support, transfers, purchase orders, and vendor management.',
    icon: 'i-lucide-warehouse',
    color: 'text-amber-500',
    bgColor: 'bg-amber-500/10',
    features: ['Stock Overview', 'Transfers', 'Purchase Orders', 'Vendors'],
    link: '/inventory/stock',
  },
  {
    title: 'HR & Workforce',
    description: 'Complete human resource management with employees, attendance, payroll, recruitment, and leave management.',
    icon: 'i-lucide-users',
    color: 'text-violet-500',
    bgColor: 'bg-violet-500/10',
    features: ['Employees', 'Attendance', 'Payroll', 'Recruitment', 'Leave Mgmt'],
    link: '/hr/employees',
  },
  {
    title: 'Finance & Accounting',
    description: 'Double-entry accounting with chart of accounts, transactions, expense management, and tax compliance.',
    icon: 'i-lucide-wallet',
    color: 'text-rose-500',
    bgColor: 'bg-rose-500/10',
    features: ['Accounts', 'Transactions', 'Expenses', 'Tax Management'],
    link: '/finance/accounts',
  },
  {
    title: 'Project Management',
    description: 'Enterprise project tracking with Gantt charts, timesheets, milestones, and resource allocation.',
    icon: 'i-lucide-folder-kanban',
    color: 'text-cyan-500',
    bgColor: 'bg-cyan-500/10',
    features: ['Projects', 'Timesheets', 'Milestones'],
    link: '/projects/list',
  },
  {
    title: 'Support Center',
    description: 'Full-featured helpdesk with ticket management, knowledge base, live chat, and SLA tracking.',
    icon: 'i-lucide-headphones',
    color: 'text-orange-500',
    bgColor: 'bg-orange-500/10',
    features: ['Tickets', 'Knowledge Base', 'Live Chat'],
    link: '/support/tickets',
  },
  {
    title: 'Marketing',
    description: 'Multi-channel marketing with campaign management, email blasts, audience segmentation, and analytics.',
    icon: 'i-lucide-megaphone',
    color: 'text-pink-500',
    bgColor: 'bg-pink-500/10',
    features: ['Campaigns', 'Email Blasts', 'Analytics'],
    link: '/marketing/campaigns',
  },
  {
    title: 'Reports & Analytics',
    description: 'Comprehensive reporting suite with sales analytics, financial statements, and HR workforce insights.',
    icon: 'i-lucide-bar-chart-3',
    color: 'text-teal-500',
    bgColor: 'bg-teal-500/10',
    features: ['Sales Reports', 'Financial Reports', 'HR Reports'],
    link: '/reports/sales',
  },
  {
    title: 'Email',
    description: 'Built-in email client with multi-account support, threaded conversations, and smart inbox management.',
    icon: 'i-lucide-mail',
    color: 'text-indigo-500',
    bgColor: 'bg-indigo-500/10',
    features: ['Inbox', 'Compose', 'Account Switching', 'Search'],
    link: '/email',
  },
  {
    title: 'Task Management',
    description: 'Advanced task tracking with data tables, filtering, sorting, column management, and bulk actions.',
    icon: 'i-lucide-calendar-check-2',
    color: 'text-lime-500',
    bgColor: 'bg-lime-500/10',
    features: ['Data Tables', 'Filtering', 'Sorting', 'Bulk Actions'],
    link: '/dealers',
  },
  {
    title: 'Kanban Board',
    description: 'Visual workflow management with drag-and-drop columns, task cards, and real-time status updates.',
    icon: 'i-lucide-kanban',
    color: 'text-fuchsia-500',
    bgColor: 'bg-fuchsia-500/10',
    features: ['Drag & Drop', 'Custom Columns', 'Task Cards', 'Status Management'],
    link: '/kanban',
  },
]

const techStack = [
  { name: 'Nuxt 4', icon: 'i-lucide-globe', description: 'Full-stack Vue framework' },
  { name: 'Vue 3', icon: 'i-lucide-code', description: 'Composition API' },
  { name: 'TypeScript', icon: 'i-lucide-file-code', description: 'Type-safe development' },
  { name: 'Tailwind CSS 4', icon: 'i-lucide-palette', description: 'Utility-first styling' },
  { name: 'shadcn-vue', icon: 'i-lucide-component', description: '63+ UI components' },
  { name: 'Pinia', icon: 'i-lucide-database', description: 'State management' },
  { name: 'TanStack Table', icon: 'i-lucide-table', description: 'Headless data grids' },
  { name: 'Unovis Charts', icon: 'i-lucide-bar-chart', description: 'Data visualization' },
]

const industries = [
  { name: 'Enterprise', icon: 'i-lucide-building-2', description: 'Large-scale CRM & ERP' },
  { name: 'Retail & E-commerce', icon: 'i-lucide-shopping-bag', description: 'Orders & inventory' },
  { name: 'Construction', icon: 'i-lucide-hard-hat', description: 'Job tickets & crews' },
  { name: 'Healthcare', icon: 'i-lucide-heart-pulse', description: 'Patient management' },
  { name: 'Education', icon: 'i-lucide-graduation-cap', description: 'Student & course mgmt' },
  { name: 'Professional Services', icon: 'i-lucide-briefcase', description: 'Projects & billing' },
  { name: 'Manufacturing', icon: 'i-lucide-factory', description: 'Production & BOM' },
  { name: 'Logistics', icon: 'i-lucide-truck', description: 'Fleet & dispatch' },
]
</script>

<template>
  <div class="w-full flex flex-col gap-8">
    <!-- Hero Section -->
    <div class="relative overflow-hidden rounded-2xl bg-gradient-to-br from-primary/15 via-primary/5 to-transparent border border-primary/10 p-8 md:p-12">
      <div class="absolute inset-0 bg-grid-pattern opacity-5" />
      <div class="relative flex flex-col gap-6 max-w-4xl">
        <div class="flex items-center gap-3">
          <Badge variant="outline" class="bg-primary/10 text-primary border-primary/20 px-3 py-1">
            <Icon name="i-lucide-sparkles" class="size-3.5 mr-1" />
            Turbo Clean Management
          </Badge>
          <Badge variant="outline" class="bg-emerald-500/10 text-emerald-600 border-emerald-500/20 px-3 py-1">
            v1.0
          </Badge>
        </div>
        <h1 class="text-3xl md:text-5xl font-bold tracking-tight leading-tight">
          Turbo Clean
          <span class="text-primary">Management</span>
        </h1>
        <p class="text-lg text-muted-foreground max-w-2xl leading-relaxed">
          A comprehensive, production-ready operations and workforce management platform with <strong>12 modules</strong>,
          <strong>63+ UI components</strong>, and <strong>45+ pages</strong> — built to scale for any industry.
        </p>
        <div class="flex flex-wrap gap-3">
          <Button size="lg" as-child>
            <NuxtLink to="/">
              <Icon name="i-lucide-layout-dashboard" class="mr-2 size-4" />
              Explore Dashboard
            </NuxtLink>
          </Button>
        </div>
      </div>
    </div>

    <!-- Stats -->
    <div class="grid grid-cols-2 gap-4 md:grid-cols-4">
      <Card class="text-center border-primary/10 bg-gradient-to-t from-primary/5 to-transparent">
        <CardContent class="pt-6">
          <div class="text-3xl font-bold tabular-nums text-primary">
            <NumberFlow :value="stats.modules" />
          </div>
          <p class="text-sm text-muted-foreground mt-1">
            Enterprise Modules
          </p>
        </CardContent>
      </Card>
      <Card class="text-center border-primary/10 bg-gradient-to-t from-primary/5 to-transparent">
        <CardContent class="pt-6">
          <div class="text-3xl font-bold tabular-nums text-primary">
            <NumberFlow :value="stats.components" suffix="+" />
          </div>
          <p class="text-sm text-muted-foreground mt-1">
            UI Components
          </p>
        </CardContent>
      </Card>
      <Card class="text-center border-primary/10 bg-gradient-to-t from-primary/5 to-transparent">
        <CardContent class="pt-6">
          <div class="text-3xl font-bold tabular-nums text-primary">
            <NumberFlow :value="stats.pages" suffix="+" />
          </div>
          <p class="text-sm text-muted-foreground mt-1">
            Ready Pages
          </p>
        </CardContent>
      </Card>
      <Card class="text-center border-primary/10 bg-gradient-to-t from-primary/5 to-transparent">
        <CardContent class="pt-6">
          <div class="text-3xl font-bold tabular-nums text-primary">
            <NumberFlow :value="stats.features" suffix="+" />
          </div>
          <p class="text-sm text-muted-foreground mt-1">
            Features
          </p>
        </CardContent>
      </Card>
    </div>

    <!-- Modules Section -->
    <div>
      <div class="flex items-center gap-3 mb-6">
        <div class="flex items-center justify-center rounded-lg bg-primary/10 p-2">
          <Icon name="i-lucide-boxes" class="size-5 text-primary" />
        </div>
        <div>
          <h2 class="text-2xl font-bold tracking-tight">
            Enterprise Modules
          </h2>
          <p class="text-sm text-muted-foreground">
            Every module you need to run a modern business
          </p>
        </div>
      </div>
      <div class="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3">
        <NuxtLink
          v-for="(mod, i) in modules"
          :key="i"
          :to="mod.link"
          class="group block"
        >
          <Card class="h-full transition-all duration-300 hover:shadow-lg hover:border-primary/30 hover:-translate-y-0.5">
            <CardHeader>
              <div class="flex items-center gap-3">
                <div class="flex items-center justify-center rounded-xl p-2.5 transition-colors" :class="mod.bgColor">
                  <Icon :name="mod.icon" class="size-5" :class="mod.color" />
                </div>
                <div>
                  <CardTitle class="text-base font-semibold group-hover:text-primary transition-colors">
                    {{ mod.title }}
                  </CardTitle>
                </div>
              </div>
            </CardHeader>
            <CardContent class="space-y-3">
              <p class="text-sm text-muted-foreground leading-relaxed">
                {{ mod.description }}
              </p>
              <div class="flex flex-wrap gap-1.5">
                <Badge v-for="feature in mod.features" :key="feature" variant="secondary" class="text-xs font-normal">
                  {{ feature }}
                </Badge>
              </div>
            </CardContent>
          </Card>
        </NuxtLink>
      </div>
    </div>

    <!-- Tech Stack -->
    <div>
      <div class="flex items-center gap-3 mb-6">
        <div class="flex items-center justify-center rounded-lg bg-primary/10 p-2">
          <Icon name="i-lucide-cpu" class="size-5 text-primary" />
        </div>
        <div>
          <h2 class="text-2xl font-bold tracking-tight">
            Technology Stack
          </h2>
          <p class="text-sm text-muted-foreground">
            Built with modern, battle-tested technologies
          </p>
        </div>
      </div>
      <div class="grid grid-cols-2 gap-3 md:grid-cols-4">
        <Card v-for="(tech, i) in techStack" :key="i" class="group transition-all duration-200 hover:border-primary/30">
          <CardContent class="flex items-center gap-3 pt-6">
            <div class="flex items-center justify-center rounded-lg bg-primary/10 p-2 group-hover:bg-primary/20 transition-colors">
              <Icon :name="tech.icon" class="size-4 text-primary" />
            </div>
            <div>
              <p class="text-sm font-semibold">
                {{ tech.name }}
              </p>
              <p class="text-xs text-muted-foreground">
                {{ tech.description }}
              </p>
            </div>
          </CardContent>
        </Card>
      </div>
    </div>

    <!-- Industry Support -->
    <div>
      <div class="flex items-center gap-3 mb-6">
        <div class="flex items-center justify-center rounded-lg bg-primary/10 p-2">
          <Icon name="i-lucide-globe" class="size-5 text-primary" />
        </div>
        <div>
          <h2 class="text-2xl font-bold tracking-tight">
            Industry Ready
          </h2>
          <p class="text-sm text-muted-foreground">
            Designed to adapt to any vertical market
          </p>
        </div>
      </div>
      <div class="grid grid-cols-2 gap-3 md:grid-cols-4">
        <Card v-for="(industry, i) in industries" :key="i" class="group transition-all duration-200 hover:border-primary/30">
          <CardContent class="flex flex-col items-center text-center gap-2 pt-6">
            <div class="flex items-center justify-center rounded-xl bg-muted p-3 group-hover:bg-primary/10 transition-colors">
              <Icon :name="industry.icon" class="size-6 text-muted-foreground group-hover:text-primary transition-colors" />
            </div>
            <p class="text-sm font-semibold">
              {{ industry.name }}
            </p>
            <p class="text-xs text-muted-foreground">
              {{ industry.description }}
            </p>
          </CardContent>
        </Card>
      </div>
    </div>

    <!-- Features Highlights -->
    <div>
      <div class="flex items-center gap-3 mb-6">
        <div class="flex items-center justify-center rounded-lg bg-primary/10 p-2">
          <Icon name="i-lucide-sparkles" class="size-5 text-primary" />
        </div>
        <div>
          <h2 class="text-2xl font-bold tracking-tight">
            Platform Highlights
          </h2>
          <p class="text-sm text-muted-foreground">
            What sets this platform apart
          </p>
        </div>
      </div>
      <div class="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3">
        <Card class="border-dashed">
          <CardHeader>
            <div class="flex items-center gap-3">
              <div class="flex items-center justify-center rounded-lg bg-emerald-500/10 p-2">
                <Icon name="i-lucide-palette" class="size-5 text-emerald-500" />
              </div>
              <CardTitle class="text-base">
                9 Theme Colors + Dark Mode
              </CardTitle>
            </div>
          </CardHeader>
          <CardContent>
            <p class="text-sm text-muted-foreground">
              Choose from 9 curated color themes with full dark/light mode support. Customizable via the built-in settings panel.
            </p>
          </CardContent>
        </Card>
        <Card class="border-dashed">
          <CardHeader>
            <div class="flex items-center gap-3">
              <div class="flex items-center justify-center rounded-lg bg-blue-500/10 p-2">
                <Icon name="i-lucide-smartphone" class="size-5 text-blue-500" />
              </div>
              <CardTitle class="text-base">
                Fully Responsive
              </CardTitle>
            </div>
          </CardHeader>
          <CardContent>
            <p class="text-sm text-muted-foreground">
              Every page and component is optimized for desktop, tablet, and mobile with adaptive layouts and touch-friendly interactions.
            </p>
          </CardContent>
        </Card>
        <Card class="border-dashed">
          <CardHeader>
            <div class="flex items-center gap-3">
              <div class="flex items-center justify-center rounded-lg bg-violet-500/10 p-2">
                <Icon name="i-lucide-zap" class="size-5 text-violet-500" />
              </div>
              <CardTitle class="text-base">
                Type-Safe & Performant
              </CardTitle>
            </div>
          </CardHeader>
          <CardContent>
            <p class="text-sm text-muted-foreground">
              Full TypeScript coverage with Zod validation, Vue 3 Composition API, and Vite 7 for blazing-fast development and builds.
            </p>
          </CardContent>
        </Card>
        <Card class="border-dashed">
          <CardHeader>
            <div class="flex items-center gap-3">
              <div class="flex items-center justify-center rounded-lg bg-amber-500/10 p-2">
                <Icon name="i-lucide-accessibility" class="size-5 text-amber-500" />
              </div>
              <CardTitle class="text-base">
                WCAG Accessible
              </CardTitle>
            </div>
          </CardHeader>
          <CardContent>
            <p class="text-sm text-muted-foreground">
              Built with Reka UI headless primitives ensuring keyboard navigation, screen reader support, and ARIA compliance throughout.
            </p>
          </CardContent>
        </Card>
        <Card class="border-dashed">
          <CardHeader>
            <div class="flex items-center gap-3">
              <div class="flex items-center justify-center rounded-lg bg-rose-500/10 p-2">
                <Icon name="i-lucide-lock" class="size-5 text-rose-500" />
              </div>
              <CardTitle class="text-base">
                Auth-Ready
              </CardTitle>
            </div>
          </CardHeader>
          <CardContent>
            <p class="text-sm text-muted-foreground">
              7 pre-built authentication pages including login, register, forgot password, and multiple OTP verification layouts.
            </p>
          </CardContent>
        </Card>
        <Card class="border-dashed">
          <CardHeader>
            <div class="flex items-center gap-3">
              <div class="flex items-center justify-center rounded-lg bg-teal-500/10 p-2">
                <Icon name="i-lucide-plug" class="size-5 text-teal-500" />
              </div>
              <CardTitle class="text-base">
                API-First Architecture
              </CardTitle>
            </div>
          </CardHeader>
          <CardContent>
            <p class="text-sm text-muted-foreground">
              Nitro server engine with file-based API routing. Connect to any database — MongoDB, PostgreSQL, MySQL, or Supabase.
            </p>
          </CardContent>
        </Card>
      </div>
    </div>


  </div>
</template>

<style scoped>
.bg-grid-pattern {
  background-image: radial-gradient(circle, currentColor 1px, transparent 1px);
  background-size: 20px 20px;
}
</style>
