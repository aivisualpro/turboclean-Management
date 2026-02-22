import type { NavMenu, NavMenuItems } from '~/types/nav'

export const navMenu: NavMenu[] = [
  {
    heading: '',
    items: [
      {
        title: 'Dashboard',
        icon: 'i-lucide-layout-dashboard',
        link: '/',
      },
      {
        title: 'App Users',
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
        icon: 'i-lucide-file-text',
        link: '/sales/work-orders',
      },
      {
        title: 'Invoices',
        icon: 'i-lucide-receipt',
        link: '/sales/invoices',
      },
      {
        title: 'Tasks',
        icon: 'i-lucide-kanban',
        link: '/tasks',
      },
      {
        title: 'Sales Reports',
        icon: 'i-lucide-trending-up',
        link: '/reports/sales',
      },
    ],
  },
]

export const navMenuBottom: NavMenuItems = []
