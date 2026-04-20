export default defineEventHandler(() => {
  function toDateStr(d: any) {
    if (!d) return ''
    if (typeof d === 'string') return d.split('T')[0]
    if (d instanceof Date) {
      return d.toISOString().split('T')[0]
    }
    return String(d).split('T')[0]
  }
  let err = ''
  try { toDateStr(new Date('abc')) } catch (e: any) { err = e.message }
  return { error_on_invalid_date: err }
})
