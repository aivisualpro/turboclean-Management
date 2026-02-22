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
      {
        title: 'Tasks',
        icon: 'i-lucide-kanban',
        link: '/tasks',
        new: true,
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
