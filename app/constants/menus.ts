import type { NavMenu, NavMenuItems } from '~/types/nav'

// `short` is the label used in the bottom navbar on phones and tablets (the cells are narrow).

export const navMenu: NavMenu[] = [
  {
    heading: 'Project Management',
    items: [
      {
        title: 'Dashboard',
        icon: 'i-lucide-layout-dashboard',
        link: '/',
      },
      {
        title: 'App Users',
        short: 'Users',
        icon: 'i-lucide-users',
        link: '/users',
      },
      {
        title: 'Services',
        icon: 'i-lucide-briefcase',
        link: '/services',
      },
      {
        title: 'Dealers',
        icon: 'i-lucide-building-2',
        link: '/dealers',
      },
      {
        title: 'Work Orders',
        short: 'Orders',
        icon: 'i-lucide-file-text',
        link: '/sales/work-orders',
      },
      {
        title: 'Invoices',
        icon: 'i-lucide-receipt',
        link: '/sales/invoices',
      },
      {
        title: 'Monthly Invoices',
        short: 'Monthly',
        icon: 'i-lucide-calendar-range',
        link: '/sales/monthly-invoices',
      },
      {
        title: 'Commissions',
        icon: 'i-lucide-percent',
        link: '/sales/commissions',
      },
    ],
  },
  {
    heading: 'CRM',
    items: [
      {
        title: 'CRM Dashboard',
        short: 'CRM',
        icon: 'i-lucide-layout-dashboard',
        link: '/crm/dashboard',
      },
      {
        title: 'Goals',
        icon: 'i-lucide-target',
        link: '/crm/goals',
      },
      {
        title: 'Today',
        icon: 'i-lucide-calendar-check',
        link: '/crm/today',
      },
      {
        title: 'Dealership',
        icon: 'i-lucide-store',
        link: '/crm/dealership',
      },
      {
        title: 'Pipeline',
        icon: 'i-lucide-git-branch',
        link: '/crm/pipeline',
      },
      {
        title: 'Email',
        icon: 'i-lucide-mail',
        link: '/crm/email',
      },
      {
        title: 'Lost deals',
        short: 'Lost',
        icon: 'i-lucide-circle-x',
        link: '/crm/lost',
      },
      {
        title: 'Won deals',
        short: 'Won',
        icon: 'i-lucide-trophy',
        link: '/crm/won',
      },
      {
        title: 'Time & ROI',
        short: 'Time',
        icon: 'i-lucide-timer',
        link: '/crm/time',
      },
      {
        title: 'Analytics',
        icon: 'i-lucide-chart-column',
        link: '/crm/analytics',
      },
      {
        title: 'Data quality',
        short: 'Quality',
        icon: 'i-lucide-shield-check',
        link: '/crm/data-quality',
      },
    ],
  },
  {
    heading: 'Automations',
    items: [
      {
        title: 'Automation Center',
        short: 'Automations',
        icon: 'i-lucide-bot',
        link: '/automations',
      },
      {
        title: 'Approval Queue',
        short: 'Approvals',
        icon: 'i-lucide-inbox',
        link: '/automations/approvals',
      },
      {
        title: 'Priorities',
        icon: 'i-lucide-flame',
        link: '/automations/priorities',
      },
      {
        title: 'Insights',
        icon: 'i-lucide-lightbulb',
        link: '/automations/insights',
      },
      {
        title: 'Brain',
        icon: 'i-lucide-brain',
        link: '/automations/brain',
      },
    ],
  },
]

export const navMenuBottom: NavMenuItems = [
  {
    title: 'Workspaces',
    icon: 'i-lucide-boxes',
    link: '/settings/workspaces',
  },
  {
    title: 'General Settings',
    short: 'Settings',
    icon: 'i-lucide-settings-2',
    link: '/settings/general',
  }
]
