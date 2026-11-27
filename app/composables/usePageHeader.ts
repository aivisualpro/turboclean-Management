interface PageHeaderState {
  title: string
  description?: string
  icon?: string
  /**
   * The back button in front of the title. Detail pages get one by themselves (it leads to their list:
   * /crm/dealership/123 → /crm/dealership). Give a path to send it somewhere else, or `false` for none.
   */
  back?: string | false
}

/**
 * A work screen open over the page area (the crawler, Mission Control, a crawl review). While it is
 * open the main header is its header: its title, and the back button closes it.
 */
export interface WorkHeader {
  title: string
  icon?: string
  /** What the back button says ("Back to Kia of Groton"). */
  backLabel?: string
  back: () => void
}

const headerState = reactive<PageHeaderState>({
  title: '',
  description: '',
  icon: '',
  back: undefined,
})
/** Open work screens, the newest last (a screen opened from another one sits on top of it). */
const workScreens = shallowRef<WorkHeader[]>([])

export function usePageHeader() {
  function setHeader(opts: PageHeaderState) {
    headerState.title = opts.title
    headerState.description = opts.description || ''
    headerState.icon = opts.icon || ''
    headerState.back = opts.back
  }

  function clearHeader() {
    headerState.title = ''
    headerState.description = ''
    headerState.icon = ''
    headerState.back = undefined
  }

  /** Hand the header to a work screen. Returns the function that gives it back. */
  function openWork(entry: WorkHeader) {
    workScreens.value = [...workScreens.value, entry]
    return () => { workScreens.value = workScreens.value.filter(w => w !== entry) }
  }

  return {
    headerState: readonly(headerState),
    /** The work screen on top (null when the page itself is on screen). */
    workHeader: computed(() => workScreens.value.at(-1) || null),
    setHeader,
    clearHeader,
    openWork,
  }
}
