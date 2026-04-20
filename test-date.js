function toDateStr(d) {
  if (!d) return ''
  if (typeof d === 'string') return d.split('T')[0]
  if (d instanceof Date) return d.toISOString().split('T')[0]
  return String(d).split('T')[0]
}
try { console.log(toDateStr(new Date('abc'))); } catch(e) { console.log("INVALID DATE: " + e.message); }
