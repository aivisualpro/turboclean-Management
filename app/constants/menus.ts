import type { NavMenu, NavMenuItems } from '~/types/nav'

export const navMenu: NavMenu[] = [
  {
    heading: 'General',
    items: [
      {
        title: 'Dashboard',
        icon: 'i-lucide-layout-dashboard',
        link: '/',
      },
      {
        title: 'Email',
        icon: 'i-lucide-mail',
        link: '/email',
      },
      {
        title: 'Dealers',
        icon: 'i-lucide-building-2',
        link: '/dealers',
      },
      {
        title: 'Services',
        icon: 'i-lucide-briefcase',
        link: '/services',
      },
    ],
  },
  {
    heading: 'Apps',
    items: [
      {
        title: 'Tasks',
        icon: 'i-lucide-kanban',
        link: '/tasks',
        new: true,
      },

    ],
  },
  {
    heading: 'Sales & Commerce',
    items: [
      {
        title: 'Work Orders',
        icon: 'i-lucide-file-text',
        link: '/sales/work-orders',
      },
      {
        title: 'Invoices',
        icon: 'i-lucide-receipt',
        link: '/sales/invoices',
      },

    ],
  },


  {
    heading: 'Finance & Accounting',
    items: [
      {
        title: 'Accounts',
        icon: 'i-lucide-wallet',
        link: '/finance/accounts',
      },
      {
        title: 'Transactions',
        icon: 'i-lucide-arrow-right-left',
        link: '/finance/transactions',
      },
      {
        title: 'Expenses',
        icon: 'i-lucide-credit-card',
        link: '/finance/expenses',
      },
      {
        title: 'Tax Management',
        icon: 'i-lucide-percent',
        link: '/finance/taxes',
      },
      {
        title: 'Balance Sheet',
        icon: 'i-lucide-landmark',
        link: '/finance/balance-sheet',
        new: true,
      },
      {
        title: 'Income Statement',
        icon: 'i-lucide-receipt',
        link: '/finance/income-statement',
        new: true,
      },
      {
        title: 'Financial Ratios',
        icon: 'i-lucide-chart-no-axes-combined',
        link: '/finance/ratios',
        new: true,
      },
      {
        title: 'Business Health',
        icon: 'i-lucide-heart-pulse',
        link: '/finance/business-health',
        new: true,
      },
    ],
  },

  {
    heading: 'Support',
    items: [
      {
        title: 'Tickets',
        icon: 'i-lucide-ticket',
        link: '/support/tickets',
      },
      {
        title: 'Knowledge Base',
        icon: 'i-lucide-book-open',
        link: '/support/knowledge-base',
      },
      {
        title: 'Live Chat',
        icon: 'i-lucide-message-circle',
        link: '/support/chat',
        new: true,
      },
    ],
  },
  {
    heading: 'Marketing',
    items: [
      {
        title: 'Campaigns',
        icon: 'i-lucide-megaphone',
        link: '/marketing/campaigns',
      },
      {
        title: 'Email Blasts',
        icon: 'i-lucide-mails',
        link: '/marketing/email-blasts',
      },
      {
        title: 'Analytics',
        icon: 'i-lucide-bar-chart-3',
        link: '/marketing/analytics',
      },
    ],
  },
  {
    heading: 'Reports',
    items: [
      {
        title: 'Sales Reports',
        icon: 'i-lucide-trending-up',
        link: '/reports/sales',
      },
      {
        title: 'Financial Reports',
        icon: 'i-lucide-pie-chart',
        link: '/reports/financial',
      },
      {
        title: 'HR Reports',
        icon: 'i-lucide-file-bar-chart',
        link: '/reports/hr',
      },
    ],
  },
]

export const navMenuBottom: NavMenuItems = []
