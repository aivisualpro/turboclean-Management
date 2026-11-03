import { getCrmDb } from '../../../../utils/crm'
import { unsubscribeByEmail, unsubscribeToken } from '../../../../utils/crm-email'

/**
 * /api/crm/email/unsubscribe/:id?t=token — public, no sign-in.
 *  POST: one-click unsubscribe from the mail client (List-Unsubscribe-Post, RFC 8058).
 *  GET:  a small confirmation page with one button (link scanners never unsubscribe anyone by GET).
 */
const page = (title: string, body: string) => `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="robots" content="noindex"><title>${title}</title></head>
<body style="margin:0;background:#eef1ef;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Helvetica,Arial,sans-serif;color:#101828">
<div style="max-width:440px;margin:12vh auto;background:#fff;border-radius:16px;overflow:hidden;box-shadow:0 20px 50px -25px rgba(0,0,0,.35)">
<div style="background:#0e1714;padding:18px 24px;font-weight:800;letter-spacing:4px;color:#fff">ZRZ<span style="color:#4ade80">&nbsp;OPS</span></div>
<div style="padding:28px 24px 30px">${body}</div></div></body></html>`

export default defineEventHandler(async (event) => {
  const id = getRouterParam(event, 'id') || ''
  const t = String(getQuery(event).t || '')
  const method = event.method
  setHeader(event, 'Cache-Control', 'no-store')
  if (method === 'POST') {
    const r = await unsubscribeByEmail(await getCrmDb(), id, t)
    const form = await readBody(event).catch(() => null)
    // Browser form → show a page; mail client one-click → plain 200.
    if (form && typeof form === 'object' && 'confirm' in form) {
      setHeader(event, 'Content-Type', 'text/html; charset=utf-8')
      return page('Unsubscribed', `<h1 style="margin:0 0 8px;font-size:22px">You’re unsubscribed</h1><p style="margin:0;font-size:15px;line-height:23px;color:#475467">${r.email.replace(/</g, '&lt;')} won’t receive any more emails from us. Sorry for the noise.</p>`)
    }
    return { ok: true }
  }
  setHeader(event, 'Content-Type', 'text/html; charset=utf-8')
  if (t !== unsubscribeToken(id)) return page('Link not valid', '<h1 style="margin:0 0 8px;font-size:22px">This link is not valid</h1><p style="margin:0;font-size:15px;line-height:23px;color:#475467">Just reply “unsubscribe” to any of our emails and we’ll stop.</p>')
  return page('Unsubscribe', `<h1 style="margin:0 0 8px;font-size:22px">Stop these emails?</h1><p style="margin:0 0 22px;font-size:15px;line-height:23px;color:#475467">One click and we won’t email you again.</p>
<form method="post" action="?t=${encodeURIComponent(t)}"><input type="hidden" name="confirm" value="1"><button type="submit" style="border:0;border-radius:10px;background:#16a34a;color:#fff;font-weight:700;font-size:15px;padding:14px 22px;cursor:pointer">Unsubscribe me</button></form>`)
})
