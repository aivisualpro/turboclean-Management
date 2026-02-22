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
        title: 'Kanban Board',
        icon: 'i-lucide-kanban',
        link: '/kanban',
        new: true,
      },
      {
        title: 'Gantt Chart',
        icon: 'i-lucide-gantt-chart',
        link: '/gantt',
        new: true,
      },
    ],
  },
  {
    heading: 'CRM',
    items: [
      {
        title: 'Contacts',
        icon: 'i-lucide-contact',
        link: '/crm/contacts',
      },
      {
        title: 'Leads',
        icon: 'i-lucide-magnet',
        link: '/crm/leads',
      },
      {
        title: 'Deals Pipeline',
        icon: 'i-lucide-handshake',
        link: '/crm/deals',
        new: true,
      },
      {
        title: 'Companies',
        icon: 'i-lucide-building-2',
        link: '/crm/companies',
      },
      {
        title: 'Activities',
        icon: 'i-lucide-activity',
        link: '/crm/activities',
      },
    ],
  },
  {
    heading: 'Sales & Commerce',
    items: [
      {
        title: 'Quotes',
        icon: 'i-lucide-file-text',
        link: '/sales/quotes',
      },
      {
        title: 'Invoices',
        icon: 'i-lucide-receipt',
        link: '/sales/invoices',
      },
      {
        title: 'Orders',
        icon: 'i-lucide-shopping-cart',
        link: '/sales/orders',
      },
      {
        title: 'Products',
        icon: 'i-lucide-package',
        link: '/sales/products',
      },
      {
        title: 'Customers',
        icon: 'i-lucide-users',
        link: '/sales/customers',
      },
    ],
  },
  {
    heading: 'Inventory & Warehouse',
    items: [
      {
        title: 'Stock Overview',
        icon: 'i-lucide-warehouse',
        link: '/inventory/stock',
      },
      {
        title: 'Transfers',
        icon: 'i-lucide-arrow-left-right',
        link: '/inventory/transfers',
      },
      {
        title: 'Purchase Orders',
        icon: 'i-lucide-clipboard-list',
        link: '/inventory/purchase-orders',
      },
      {
        title: 'Vendors',
        icon: 'i-lucide-truck',
        link: '/inventory/vendors',
      },
    ],
  },
  {
    heading: 'HR & Workforce',
    items: [
      {
        title: 'Employees',
        icon: 'i-lucide-user-round-check',
        link: '/hr/employees',
      },
      {
        title: 'Attendance',
        icon: 'i-lucide-clock',
        link: '/hr/attendance',
      },
      {
        title: 'Payroll',
        icon: 'i-lucide-banknote',
        link: '/hr/payroll',
      },
      {
        title: 'Recruitment',
        icon: 'i-lucide-briefcase',
        link: '/hr/recruitment',
      },
      {
        title: 'Leave Mgmt',
        icon: 'i-lucide-calendar-off',
        link: '/hr/leaves',
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
    heading: 'Project Management',
    items: [
      {
        title: 'Projects',
        icon: 'i-lucide-folder-kanban',
        link: '/projects/list',
      },
      {
        title: 'Timesheets',
        icon: 'i-lucide-timer',
        link: '/projects/timesheets',
      },
      {
        title: 'Milestones',
        icon: 'i-lucide-flag',
        link: '/projects/milestones',
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
  {
    heading: 'Pages',
    items: [
      {
        title: 'Authentication',
        icon: 'i-lucide-lock-keyhole-open',
        children: [
          {
            title: 'Login',
            icon: 'i-lucide-circle',
            link: '/login',
          },
          {
            title: 'Login Basic',
            icon: 'i-lucide-circle',
            link: '/login-basic',
          },
          {
            title: 'Register',
            icon: 'i-lucide-circle',
            link: '/register',
          },
          {
            title: 'Forgot Password',
            icon: 'i-lucide-circle',
            link: '/forgot-password',
          },
          {
            title: 'OTP',
            icon: 'i-lucide-circle',
            link: '/otp',
          },
          {
            title: 'OTP 1',
            icon: 'i-lucide-circle',
            link: '/otp-1',
          },
          {
            title: 'OTP 2',
            icon: 'i-lucide-circle',
            link: '/otp-2',
          },
        ],
      },
      {
        title: 'Errors',
        icon: 'i-lucide-triangle-alert',
        children: [
          {
            title: '401 - Unauthorized',
            icon: 'i-lucide-circle',
            link: '/401',
          },
          {
            title: '403 - Forbidden',
            icon: 'i-lucide-circle',
            link: '/403',
          },
          {
            title: '404 - Not Found',
            icon: 'i-lucide-circle',
            link: '/404',
          },
          {
            title: '500 - Internal Server Error',
            icon: 'i-lucide-circle',
            link: '/500',
          },
          {
            title: '503 - Service Unavailable',
            icon: 'i-lucide-circle',
            link: '/503',
          },
        ],
      },
      {
        title: 'Settings',
        icon: 'i-lucide-settings',
        new: true,
        children: [
          {
            title: 'Profile',
            icon: 'i-lucide-circle',
            link: '/settings/profile',
          },
          {
            title: 'Account',
            icon: 'i-lucide-circle',
            link: '/settings/account',
          },
          {
            title: 'Appearance',
            icon: 'i-lucide-circle',
            link: '/settings/appearance',
          },
          {
            title: 'Notifications',
            icon: 'i-lucide-circle',
            link: '/settings/notifications',
          },
          {
            title: 'Display',
            icon: 'i-lucide-circle',
            link: '/settings/display',
          },
        ],
      },
    ],
  },
  {
    heading: 'Components',
    items: [
      {
        title: 'Components',
        icon: 'i-lucide-component',
        children: [
          {
            title: 'Accordion',
            icon: 'i-lucide-circle',
            link: '/components/accordion',
          },
          {
            title: 'Alert',
            icon: 'i-lucide-circle',
            link: '/components/alert',
          },
          {
            title: 'Alert Dialog',
            icon: 'i-lucide-circle',
            link: '/components/alert-dialog',
          },
          {
            title: 'Aspect Ratio',
            icon: 'i-lucide-circle',
            link: '/components/aspect-ratio',
          },
          {
            title: 'Avatar',
            icon: 'i-lucide-circle',
            link: '/components/avatar',
          },
          {
            title: 'Badge',
            icon: 'i-lucide-circle',
            link: '/components/badge',
          },
          {
            title: 'Breadcrumb',
            icon: 'i-lucide-circle',
            link: '/components/breadcrumb',
          },
          {
            title: 'Button',
            icon: 'i-lucide-circle',
            link: '/components/button',
          },
          {
            title: 'Calendar',
            icon: 'i-lucide-circle',
            link: '/components/calendar',
          },
          {
            title: 'Card',
            icon: 'i-lucide-circle',
            link: '/components/card',
          },
          {
            title: 'Carousel',
            icon: 'i-lucide-circle',
            link: '/components/carousel',
          },
          {
            title: 'Checkbox',
            icon: 'i-lucide-circle',
            link: '/components/checkbox',
          },
          {
            title: 'Collapsible',
            icon: 'i-lucide-circle',
            link: '/components/collapsible',
          },
          {
            title: 'Combobox',
            icon: 'i-lucide-circle',
            link: '/components/combobox',
          },
          {
            title: 'Command',
            icon: 'i-lucide-circle',
            link: '/components/command',
          },
          {
            title: 'Context Menu',
            icon: 'i-lucide-circle',
            link: '/components/context-menu',
          },
          {
            title: 'Dialog',
            icon: 'i-lucide-circle',
            link: '/components/dialog',
          },
          {
            title: 'Drawer',
            icon: 'i-lucide-circle',
            link: '/components/drawer',
          },
          {
            title: 'Dropdown Menu',
            icon: 'i-lucide-circle',
            link: '/components/dropdown-menu',
          },
          {
            title: 'Form',
            icon: 'i-lucide-circle',
            link: '/components/form',
          },
          {
            title: 'Hover Card',
            icon: 'i-lucide-circle',
            link: '/components/hover-card',
          },
          {
            title: 'Input',
            icon: 'i-lucide-circle',
            link: '/components/input',
          },
          {
            title: 'Item',
            icon: 'i-lucide-circle',
            link: '/components/item',
            new: true,
          },
          {
            title: 'kbd',
            icon: 'i-lucide-circle',
            link: '/components/kbd',
            new: true,
          },
          {
            title: 'Label',
            icon: 'i-lucide-circle',
            link: '/components/label',
          },
          {
            title: 'Menubar',
            icon: 'i-lucide-circle',
            link: '/components/menubar',
          },
          {
            title: 'Navigation Menu',
            icon: 'i-lucide-circle',
            link: '/components/navigation-menu',
          },
          {
            title: 'Number Field',
            icon: 'i-lucide-circle',
            link: '/components/number-field',
          },
          {
            title: 'Pagination',
            icon: 'i-lucide-circle',
            link: '/components/pagination',
          },
          {
            title: 'PIN Input',
            icon: 'i-lucide-circle',
            link: '/components/pin-input',
          },
          {
            title: 'Popover',
            icon: 'i-lucide-circle',
            link: '/components/popover',
          },
          {
            title: 'Progress',
            icon: 'i-lucide-circle',
            link: '/components/progress',
          },
          {
            title: 'Radio Group',
            icon: 'i-lucide-circle',
            link: '/components/radio-group',
          },
          {
            title: 'Range Calendar',
            icon: 'i-lucide-circle',
            link: '/components/range-calendar',
          },
          {
            title: 'Resizable',
            icon: 'i-lucide-circle',
            link: '/components/resizable',
          },
          {
            title: 'Scroll Area',
            icon: 'i-lucide-circle',
            link: '/components/scroll-area',
          },
          {
            title: 'Select',
            icon: 'i-lucide-circle',
            link: '/components/select',
          },
          {
            title: 'Separator',
            icon: 'i-lucide-circle',
            link: '/components/separator',
          },
          {
            title: 'Sheet',
            icon: 'i-lucide-circle',
            link: '/components/sheet',
          },
          {
            title: 'Skeleton',
            icon: 'i-lucide-circle',
            link: '/components/skeleton',
          },
          {
            title: 'Slider',
            icon: 'i-lucide-circle',
            link: '/components/slider',
          },
          {
            title: 'Sonner',
            icon: 'i-lucide-circle',
            link: '/components/sonner',
          },
          {
            title: 'Stepper',
            icon: 'i-lucide-circle',
            link: '/components/stepper',
          },
          {
            title: 'Switch',
            icon: 'i-lucide-circle',
            link: '/components/switch',
          },
          {
            title: 'Table',
            icon: 'i-lucide-circle',
            link: '/components/table',
          },
          {
            title: 'Tabs',
            icon: 'i-lucide-circle',
            link: '/components/tabs',
          },
          {
            title: 'Tags Input',
            icon: 'i-lucide-circle',
            link: '/components/tags-input',
          },
          {
            title: 'Textarea',
            icon: 'i-lucide-circle',
            link: '/components/textarea',
          },
          {
            title: 'Toast',
            icon: 'i-lucide-circle',
            link: '/components/toast',
          },
          {
            title: 'Toggle',
            icon: 'i-lucide-circle',
            link: '/components/toggle',
          },
          {
            title: 'Toggle Group',
            icon: 'i-lucide-circle',
            link: '/components/toggle-group',
          },
          {
            title: 'Tooltip',
            icon: 'i-lucide-circle',
            link: '/components/tooltip',
          },
        ],
      },
    ],
  },
  {
    heading: 'Documentation',
    items: [
      {
        title: 'Documentation',
        icon: 'i-lucide-file-code',
        link: '/docs',
        new: true,
      },
    ],
  },
]

export const navMenuBottom: NavMenuItems = [
  {
    title: 'Help & Support',
    icon: 'i-lucide-circle-help',
    link: '/docs',
  },
  {
    title: 'Feedback',
    icon: 'i-lucide-send',
    link: '/docs',
  },
]
