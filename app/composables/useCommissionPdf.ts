/**
 * Payout statement PDF for one pay day (built in the browser with jsPDF, loaded only when used).
 * Page 1: the payee's statement (dealer lines, deductions, payments, balance). Summary of the
 * company result at the end for the owner's copy.
 */
export async function downloadCommissionPdf(week: any, opts: { payeeId?: string, includeCompany?: boolean } = {}) {
  const [{ jsPDF }, { default: autoTable }] = await Promise.all([import('jspdf'), import('jspdf-autotable')])
  const doc = new jsPDF({ unit: 'pt', format: 'letter' })
  const W = doc.internal.pageSize.getWidth()
  const M = 40
  const payee = (week.payees || []).find((p: any) => p.id === opts.payeeId) || (week.payees || []).find((p: any) => !p.fundedBy)
  const money = (n: number) => usd(n)

  // Header band
  doc.setFillColor(24, 24, 27)
  doc.rect(0, 0, W, 64, 'F')
  doc.setTextColor(255, 255, 255)
  doc.setFont('helvetica', 'bold'); doc.setFontSize(15)
  doc.text('ZRZ Turbo Clean — Payout statement', M, 30)
  doc.setFont('helvetica', 'normal'); doc.setFontSize(9.5)
  doc.text(`Pay day ${dayLong(week.payDate)}  ·  Work ${dayShort(week.workStart)} – ${dayShort(week.workEnd)}  ·  ${STATUS_META[week.status]?.label || week.status}${week.source === 'sheet' ? ' (from spreadsheet)' : ''}`, M, 48)
  doc.setTextColor(20, 20, 20)

  let y = 92
  doc.setFont('helvetica', 'bold'); doc.setFontSize(12)
  doc.text(payee ? payee.name : 'Contractors', M, y)
  doc.setFont('helvetica', 'normal'); doc.setFontSize(9)
  doc.setTextColor(110, 110, 110)
  doc.text(`Generated ${new Date().toLocaleString('en-US')}`, W - M, y, { align: 'right' })
  doc.setTextColor(20, 20, 20)

  const pid = payee?.id
  const lines = (week.lines || []).filter((l: any) => !pid || l.payouts?.[pid])
  autoTable(doc, {
    startY: y + 10,
    margin: { left: M, right: M },
    head: [['Dealer', 'Billed', 'Sales tax', 'Net', 'Rule', 'Payout']],
    body: lines.map((l: any) => {
      const p = pid ? l.payouts[pid] : null
      return [l.dealerName, money(l.billed), money(l.tax), money(l.net), p ? ruleText(p.rule) + (p.overridden || p.manual ? ' *' : '') : '', money(p ? p.amount : l.payout)]
    }),
    foot: [['Total', money(lines.reduce((s: number, l: any) => s + l.billed, 0)), money(lines.reduce((s: number, l: any) => s + l.tax, 0)), money(lines.reduce((s: number, l: any) => s + l.net, 0)), '', money(payee ? payee.commission : week.totals.commission)]],
    styles: { fontSize: 8.5, cellPadding: 4 },
    headStyles: { fillColor: [24, 24, 27], textColor: 230, fontStyle: 'bold' },
    footStyles: { fillColor: [244, 244, 245], textColor: 20, fontStyle: 'bold' },
    columnStyles: { 1: { halign: 'right' }, 2: { halign: 'right' }, 3: { halign: 'right' }, 5: { halign: 'right', fontStyle: 'bold' } },
    didParseCell: (d: any) => { if (d.section !== 'body' && d.column.index > 0 && d.column.index !== 4) d.cell.styles.halign = 'right' },
  })
  y = (doc as any).lastAutoTable.finalY + 16

  if (payee) {
    const rows: any[] = [['Commission earned', money(payee.commission)]]
    for (const a of payee.adjustments.filter((x: any) => !x.skipped)) rows.push([`${a.label}${a.note && a.kind !== 'recurring' ? ` (${a.note})` : ''}`, signedUsd(a.amount)])
    rows.push([{ content: 'Net payable', styles: { fontStyle: 'bold' } }, { content: money(payee.netPayable), styles: { fontStyle: 'bold' } }])
    for (const p of payee.payments) rows.push([`Paid ${dayShort(p.date)}${p.method ? ` · ${p.method}` : ''}${p.note ? ` · ${p.note}` : ''}`, `−${money(p.amount)}`])
    rows.push([{ content: 'Balance to pay', styles: { fontStyle: 'bold', fontSize: 11 } }, { content: money(Math.max(0, payee.balance)), styles: { fontStyle: 'bold', fontSize: 11 } }])
    autoTable(doc, {
      startY: y,
      margin: { left: W / 2, right: M },
      body: rows,
      theme: 'plain',
      styles: { fontSize: 9, cellPadding: 3 },
      columnStyles: { 1: { halign: 'right' } },
      didDrawCell: (d: any) => { if (d.row.index === rows.length - 1 && d.column.index === 0) { doc.setDrawColor(24, 24, 27); doc.line(d.cell.x, d.cell.y, W - M, d.cell.y) } },
    })
    y = (doc as any).lastAutoTable.finalY + 10
    doc.setFontSize(7.5); doc.setTextColor(120, 120, 120)
    doc.text('* changed for this week only', M, y)
    doc.setTextColor(20, 20, 20)
    y += 20
  }

  if (opts.includeCompany) {
    const t = week.totals
    autoTable(doc, {
      startY: y,
      margin: { left: M, right: M },
      head: [['Company result', '']],
      body: [
        ['Net revenue', money(t.net)],
        ['Paid to contractors', `−${money(t.paidToContractors)}`],
        ...t.overheadItems.map((o: any) => [`Overhead · ${o.label}`, `−${money(o.amount)}`]),
        ...t.setAsides.map((s: any) => [`${s.label} set-aside (${s.pct}% of ${s.base})`, `−${money(s.amount)}`]),
        [{ content: `Net profit (${pctText(t.marginPct)} margin)`, styles: { fontStyle: 'bold' } }, { content: money(t.netProfit), styles: { fontStyle: 'bold' } }],
        ...t.reserves.map((r: any) => [`${r.label} (${r.pct}% of profit)`, money(r.amount)]),
        ['Sales tax collected (owed to the state)', money(t.tax)],
      ],
      styles: { fontSize: 9, cellPadding: 3.5 },
      headStyles: { fillColor: [24, 24, 27], textColor: 230 },
      columnStyles: { 1: { halign: 'right' } },
    })
  }

  const pages = doc.getNumberOfPages()
  for (let i = 1; i <= pages; i++) {
    doc.setPage(i); doc.setFontSize(7.5); doc.setTextColor(140, 140, 140)
    doc.text(`Page ${i} of ${pages}`, W - M, doc.internal.pageSize.getHeight() - 20, { align: 'right' })
  }
  doc.save(`payout-${payee?.name?.toLowerCase().replace(/\s+/g, '-') || 'statement'}-${week.payDate}.pdf`)
}
