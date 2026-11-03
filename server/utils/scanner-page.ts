/**
 * Inventory Scanner — scripts that run inside the dealership's web page (plain JS strings, so the
 * build tooling never rewrites them). Built to work across the common dealer-website platforms
 * (Dealer.com, Dealer Inspire, DealerOn, Dealer eProcess, Sincro, Team Velocity, Fox, Overfuel…)
 * without per-site code: known card selectors first, then a structural "repeated card" detector.
 */

/** Injected before every document: keep pop-ups / new tabs in the same tab, hide automation flags. */
export const SCANNER_BOOTSTRAP_JS = `(() => {
  try { Object.defineProperty(navigator, 'webdriver', { get: () => undefined }) } catch (e) {}
  try { window.open = function (u) { if (u) location.href = u; return window } } catch (e) {}
  document.addEventListener('click', function (e) {
    var a = e.target && e.target.closest ? e.target.closest('a[target]') : null
    if (a && a.target && a.target !== '_self') a.target = '_self'
  }, true)
})()`

/** Scroll one step; returns where we are so Node can decide when the page is fully loaded. */
export const SCROLL_STEP_JS = `(() => {
  var h = Math.max(document.body ? document.body.scrollHeight : 0, document.documentElement.scrollHeight)
  window.scrollBy({ top: Math.round(innerHeight * 0.8), behavior: 'instant' })
  return { y: Math.round(scrollY), h: h, vh: innerHeight, atBottom: scrollY + innerHeight >= h - 8 }
})()`

/** Links that look like inventory pages — offered as one-click shortcuts in the scanner toolbar. */
export const NAV_LINKS_JS = `(() => {
  // Shortcut chips: the site's own inventory pages, judged by the link's wording (the menu text),
  // preferring real menu / header links. In-page anchors, specials, finance etc. are skipped.
  var out = [], seen = {}
  var host = location.hostname.replace(/^www\\./, '')
  var here = location.href.split('#')[0]
  var as = Array.prototype.slice.call(document.querySelectorAll('a[href]'))
  var BAD = /special|skip|finance|financ|service|parts|lease|offer|deal|why|about|contact|research|compare|saved|favou?rite|detail|vdp|blog|review|trade|appraisal|credit|tire|sell|value|wishlist|cart|login|sign|career|hour|direction|map|privacy|schedule|accessor|order|payment|calculator|quote|brochure|protection|warranty|recall|rebate|incentive|shop-by|body-style|model/
  for (var i = 0; i < as.length; i++) {
    var a = as[i]
    var raw = a.getAttribute('href') || ''
    var href = a.href || ''
    if (!/^https?:/.test(href) || /^(#|javascript:|tel:|mailto:)/i.test(raw)) continue
    var key = href.split('#')[0]
    if (key === here) continue
    var h = ''
    try { h = new URL(href).hostname.replace(/^www\\./, '') } catch (e) { continue }
    if (h !== host && !h.endsWith('.' + host) && !host.endsWith('.' + h)) continue
    var t = (a.innerText || a.textContent || a.getAttribute('aria-label') || a.getAttribute('title') || '').replace(/\\s+/g, ' ').trim()
    if (!t || t.length > 40) continue
    var tl = t.toLowerCase(), hl = key.toLowerCase()
    if (BAD.test(tl) || /special|skip|finance|service|parts|lease|offer|blog|review|trade|appraisal|credit|tire|saved|favorite|compare|research|detail|vdp|why-|about|contact|value|sell|quote/.test(hl)) continue
    var kind = null
    if (/certified|cpo/.test(tl)) kind = 'certified'
    else if (/pre-?owned|\\bused\\b|second-?hand/.test(tl)) kind = 'used'
    else if (/\\bnew\\b/.test(tl)) kind = 'new'
    else if (/inventory|vehicles|showroom|all cars|view all|search/.test(tl)) kind = 'all'
    if (!kind) continue
    // "New" / "Used" alone must still point at an inventory-looking page.
    var inv = /inventory|vehicles|cars|trucks|suv|showroom|search|for-sale|pre-?owned|used|certified|cpo|new/.test(tl + ' ' + hl)
    if (!inv) continue
    var inNav = !!a.closest('nav, header, [role="navigation"], [class*="nav"], [class*="menu"], [class*="header"], [id*="nav"], [id*="menu"], [id*="header"]')
    var score = (inNav ? 4 : 0) + (/inventory|vehicles/.test(tl) ? 3 : 0) + (/^(view|see|shop|browse|search)\\b/.test(tl) ? 1 : 0) - (/\\b(trucks?|vans?|suvs?|sedans?|coupes?|hybrid|electric|ev)\\b/.test(tl) && !/inventory/.test(tl) ? 2 : 0)
    if (seen[key]) { if (score > seen[key].score) { seen[key].score = score; seen[key].label = t; seen[key].kind = kind } continue }
    seen[key] = { label: t, href: key, kind: kind, score: score }
    out.push(seen[key])
  }
  var rank = { used: 0, certified: 1, new: 2, all: 3 }
  out.sort(function (a, b) { return b.score - a.score || rank[a.kind] - rank[b.kind] || a.label.length - b.label.length })
  var byKind = {}, res = []
  for (var j = 0; j < out.length; j++) { var k = out[j].kind; byKind[k] = (byKind[k] || 0) + 1; if (byKind[k] <= 2 && res.length < 6) res.push({ label: out[j].label, href: out[j].href, kind: out[j].kind }) }
  res.sort(function (a, b) { return rank[a.kind] - rank[b.kind] })
  return res
})()`

/**
 * Find every vehicle card on the page and describe it (title, VIN, stock, price, condition, link,
 * main photo with its natural size, photo count, any "photos coming soon" wording).
 */
export const EXTRACT_JS = `(() => {
  var VIN_RE = /\\b(?=[A-HJ-NPR-Z0-9]*\\d)(?=[A-HJ-NPR-Z0-9]*[A-HJ-NPR-Z])[A-HJ-NPR-Z0-9]{17}\\b/
  var YEAR_RE = /(?:^|[^\\d])(19[89]\\d|20[0-3]\\d)(?!\\d)/
  var PRICE_RE = /\\$\\s?\\d{1,3}(?:,\\d{3})+(?:\\.\\d{2})?|\\$\\s?\\d{4,6}(?!\\d)/
  var NO_PHOTO_TEXT = /(photos?|images?|pictures?|pics)\\s+(are\\s+)?(coming soon|unavailable|not available|to follow|pending|on the way)|no (photos?|images?|pictures?)( available)?|photo(s)? coming|image coming soon|check back soon/i
  var KNOWN = ['[data-vehicle-id]', '[data-vin]', '[data-vehicle]', '[data-vehicleid]', '.vehicle-card', '.vehicle-card-wrap', '.inventory-listing', '.srp-vehicle', '.vehicle-item', '.vehicle-listing', '.result-wrap', '.hproduct', '.si-vehicle-box', '.vehicle_item', '.inventory-item', '.car-card', '.listing-item', '.v7list-results__item', '.vehicle-result', '.vehicle-tile', '.srp-list-item', '.inventory-vehicle', '[itemtype*="schema.org/Car"]', '[itemtype*="schema.org/Vehicle"]', '[itemtype*="schema.org/Product"]']
  function textOf(el) { return (el.innerText || el.textContent || '').replace(/\\s+/g, ' ').trim() }
  function rect(el) { var r = el.getBoundingClientRect(); return { w: r.width, h: r.height, x: r.left, y: r.top } }
  function shown(el) { var s = getComputedStyle(el); var r = rect(el); return s.display !== 'none' && s.visibility !== 'hidden' && r.w > 60 && r.h > 60 }
  function cardLike(el) {
    var t = textOf(el)
    if (t.length < 12 || t.length > 4000) return false
    var year = YEAR_RE.test(t) || el.hasAttribute('data-year') || !!el.querySelector('[data-year]')
    var price = PRICE_RE.test(t) || /call for (price|pricing)|contact (us|dealer) for price|e-?price|get (e-?)?price|unlock price|confirm availability/i.test(t)
    var vin = VIN_RE.test(t) || !!el.querySelector('[data-vin]') || el.hasAttribute('data-vin')
    var media = !!el.querySelector('img, picture, [style*="background-image"], [data-src], [data-bg]')
    var link = !!el.querySelector('a[href]') || el.tagName === 'A'
    return year && (price || vin) && (media || link)
  }
  function sig(el) {
    var cls = (typeof el.className === 'string' ? el.className : '').split(/\\s+/).filter(function (c) { return c && !/\\d{2,}|active|selected|odd|even|first|last|hover|visible|loaded|lazy/i.test(c) }).sort().slice(0, 3).join('.')
    return el.tagName + '.' + cls
  }
  function dropAncestors(list) {
    return list.filter(function (el) { return !list.some(function (o) { return o !== el && el.contains(o) }) })
  }
  // 1) Known selectors
  var best = []
  for (var i = 0; i < KNOWN.length; i++) {
    var found = []
    try { found = Array.prototype.slice.call(document.querySelectorAll(KNOWN[i])) } catch (e) {}
    found = dropAncestors(found.filter(cardLike))
    if (found.length > best.length) best = found
  }
  // 2) Structural detector: the parent with the most similar, card-like children
  var parents = Array.prototype.slice.call(document.querySelectorAll('body *')).filter(function (p) { return p.children && p.children.length >= 3 }).slice(0, 6000)
  var gen = []
  for (var j = 0; j < parents.length; j++) {
    var groups = {}
    var kids = parents[j].children
    for (var k = 0; k < kids.length; k++) { var s = sig(kids[k]); (groups[s] = groups[s] || []).push(kids[k]) }
    for (var key in groups) {
      var g = groups[key]
      if (g.length < 3 || g.length <= gen.length) continue
      var ok = g.filter(cardLike)
      if (ok.length >= 3 && ok.length / g.length >= 0.5 && ok.length > gen.length) gen = ok
    }
  }
  var useGen = gen.length > best.length * 1.15 || !best.length
  var cards = useGen ? gen : best
  cards = cards.filter(function (c) { return getComputedStyle(c).display !== 'none' })

  function bestFromSrcset(ss) {
    if (!ss) return ''
    var parts = ss.split(',').map(function (p) { var b = p.trim().split(/\\s+/); return { u: b[0], w: parseFloat(b[1]) || 0 } }).filter(function (p) { return p.u })
    parts.sort(function (a, b) { return b.w - a.w })
    return parts.length ? parts[Math.min(parts.length - 1, parts.length > 2 ? 1 : 0)].u : ''
  }
  function abs(u) { try { return u ? new URL(u, location.href).href : '' } catch (e) { return '' } }
  function isTinyData(u) { return /^data:image\\/(gif|svg|png);base64,.{0,400}$/i.test(u) || /^data:image\\/svg/i.test(u) }
  function imgSrc(img) {
    var cand = [img.currentSrc, img.getAttribute('src'), img.getAttribute('data-src'), img.getAttribute('data-lazy-src'), img.getAttribute('data-lazy'), img.getAttribute('data-original'), img.getAttribute('data-srcset') && bestFromSrcset(img.getAttribute('data-srcset')), bestFromSrcset(img.getAttribute('srcset'))]
    for (var i = 0; i < cand.length; i++) { var c = cand[i]; if (c && !isTinyData(c)) return abs(c) }
    var pic = img.closest('picture')
    if (pic) { var so = pic.querySelector('source[srcset], source[data-srcset]'); if (so) { var u = bestFromSrcset(so.getAttribute('srcset') || so.getAttribute('data-srcset')); if (u) return abs(u) } }
    return (img.currentSrc || img.src || '').slice(0, 200).indexOf('data:') === 0 ? 'data:' : ''
  }
  function bgUrl(el) { var b = getComputedStyle(el).backgroundImage || ''; var m = b.match(/url\\(["']?([^"')]+)["']?\\)/); return m ? abs(m[1]) : (el.getAttribute('data-bg') ? abs(el.getAttribute('data-bg')) : '') }
  function condition(card, t, href) {
    var attrs = ['data-condition', 'data-type', 'data-vehicle-type', 'data-inventory-type', 'data-new-used', 'data-vehicle-condition']
    for (var i = 0; i < attrs.length; i++) {
      var el = card.hasAttribute(attrs[i]) ? card : card.querySelector('[' + attrs[i] + ']')
      if (el) { var v = (el.getAttribute(attrs[i]) || '').toLowerCase(); if (/cert|cpo/.test(v)) return 'certified'; if (/used|pre/.test(v)) return 'used'; if (/new/.test(v)) return 'new' }
    }
    var head = t.slice(0, 160)
    if (/\\bcertified\\b|\\bcpo\\b/i.test(head)) return 'certified'
    if (/\\bpre-?owned\\b|\\bused(?![a-z])/i.test(head)) return 'used'
    if (/\\bnew(?![a-z])\\s*(19|20)\\d{2}|^new\\b/i.test(head)) return 'new'
    if (/\\/(certified|cpo)[-\\/]/i.test(href)) return 'certified'
    if (/\\/(used|pre-?owned)[-\\/]/i.test(href)) return 'used'
    if (/\\/new[-\\/]/i.test(href)) return 'new'
    return ''
  }
  var pageCond = /certified|cpo/i.test(location.href) ? 'certified' : /used|pre-?owned/i.test(location.href) ? 'used' : /\\bnew|searchnew|new-/i.test(location.href) ? 'new' : ''

  var out = cards.slice(0, 600).map(function (card) {
    var t = textOf(card)
    var links = Array.prototype.slice.call(card.querySelectorAll('a[href]'))
    if (card.tagName === 'A') links.unshift(card)
    var detail = links.find(function (a) { return YEAR_RE.test(textOf(a)) && !/^(tel|mailto|javascript):/i.test(a.getAttribute('href') || '') }) || links.find(function (a) { return /vehicle|inventory|detail|vdp|\\/(new|used|certified)\\//i.test(a.href) }) || links[0]
    var href = detail ? detail.href : ''
    var heading = card.querySelector('h1,h2,h3,h4,[class*="title"],[class*="Title"],[class*="name"]')
    var title = heading && YEAR_RE.test(textOf(heading)) ? textOf(heading) : ''
    if (!title) { var m = t.match(/(?:new|used|certified|pre-owned)?\\s*(?<!\\d)(19[89]\\d|20[0-3]\\d)\\s*[A-Za-z][\\w\\-]+(?:\\s+[\\w\\-\\.\\/+]+){0,4}/i); title = m ? m[0].trim() : t.slice(0, 80) }
    title = title.replace(/^(new|used|certified|pre-owned)(?=\\d)/i, '$1 ')
    title = title.slice(0, 140)
    var ymm = title.match(/(19[89]\\d|20[0-3]\\d)\\s*([A-Za-z][\\w\\-]+)\\s+([\\w\\-]+)/)
    var dEl = card.hasAttribute('data-make') ? card : card.querySelector('[data-make]')
    var dYear = dEl ? parseInt(dEl.getAttribute('data-year') || '', 10) : NaN
    var dMake = dEl ? (dEl.getAttribute('data-make') || '') : ''
    var dModel = dEl ? (dEl.getAttribute('data-model') || '') : ''
    var vinEl = card.hasAttribute('data-vin') ? card : card.querySelector('[data-vin]')
    var vin = vinEl ? (vinEl.getAttribute('data-vin') || '') : ''
    if (!/^[A-HJ-NPR-Z0-9]{17}$/i.test(vin)) { var vm = (t + ' ' + href).toUpperCase().match(VIN_RE); vin = vm ? vm[0] : '' }
    var sm = t.match(/stock\\s*(?:#|no\\.?|number)?\\s*:?\\s*([A-Z0-9\\-]{3,15})/i)
    var pm = t.match(PRICE_RE)
    // Main photo: the largest rendered image in the card; fall back to any image / background image.
    var imgs = Array.prototype.slice.call(card.querySelectorAll('img')).filter(function (im) { return !/logo|icon|badge|carfax|autocheck|sprite|spinner|loader|dealer-rater|rating|award/i.test((im.getAttribute('src') || '') + ' ' + (im.alt || '') + ' ' + (im.className || '')) })
    var main = null, area = -1
    imgs.forEach(function (im) { var r = rect(im); var a = r.w * r.h; if (a > area) { area = a; main = im } })
    var image = null
    if (main) {
      var src = imgSrc(main)
      image = { url: src === 'data:' ? '' : src, alt: (main.alt || '').slice(0, 160), nw: main.naturalWidth || 0, nh: main.naturalHeight || 0, complete: !!main.complete, rw: Math.round(rect(main).w), rh: Math.round(rect(main).h), kind: 'img' }
    } else {
      var bgEl = [card].concat(Array.prototype.slice.call(card.querySelectorAll('[style*="background-image"], [data-bg], [class*="photo"], [class*="image"], [class*="img"]'))).find(function (e) { return !!bgUrl(e) })
      if (bgEl) { var r2 = rect(bgEl); image = { url: bgUrl(bgEl), alt: '', nw: 0, nh: 0, complete: true, rw: Math.round(r2.w), rh: Math.round(r2.h), kind: 'background' } }
    }
    var srcs = {}
    imgs.forEach(function (im) { var s = imgSrc(im); if (s && s !== 'data:') srcs[s] = 1 })
    var pc = t.match(/(\\d{1,3})\\s*(photos|images|pics|pictures)\\b/i)
    var r = rect(card)
    return {
      title: title, year: dYear > 1980 ? dYear : (ymm ? +ymm[1] : null), make: dMake || (ymm ? ymm[2] : ''), model: dModel || (ymm ? ymm[3] : ''),
      vin: vin.toUpperCase(), stock: sm ? sm[1] : '', price: pm ? pm[0].replace(/\\s/g, '') : '',
      condition: condition(card, t, href) || pageCond, url: href,
      image: image, imageCount: Object.keys(srcs).length, photoCountText: pc ? pc[0] : '',
      noPhotoText: NO_PHOTO_TEXT.test(t) ? (t.match(NO_PHOTO_TEXT) || [''])[0] : '',
      box: { x: Math.round(r.left + scrollX), y: Math.round(r.top + scrollY), w: Math.round(r.width), h: Math.round(r.height) },
    }
  })

  // Advertised total ("Showing 1–24 of 312 vehicles", "312 Vehicles Found")
  var body = (document.body ? document.body.innerText : '').slice(0, 30000)
  var total = null
  var pats = [/showing\\s+all\\s+(\\d[\\d,]{0,6})/i, /\\d[\\d,]*\\s*(?:-|–|to)\\s*\\d[\\d,]*\\s+of\\s+(\\d[\\d,]{0,6})/i, /(\\d[\\d,]{0,6})\\s+(?:vehicles|results|matches|cars|listings|units)\\s+(?:found|available|match|in stock)/i, /(\\d[\\d,]{0,6})\\s+(?:vehicles|results|matches|listings)\\b/i]
  for (var p = 0; p < pats.length && total === null; p++) { var mm = body.match(pats[p]); if (mm) { var n = parseInt(mm[1].replace(/,/g, ''), 10); if (n > 0 && n < 20000) total = n } }
  return { url: location.href, title: document.title, cards: out, total: total, strategy: useGen ? 'structure' : 'known', scrollHeight: document.documentElement.scrollHeight }
})()`

/**
 * Find "Next page" / "Load more". Order: rel=next → the site's pagination control (next arrow, or the
 * page number after the current one) → a labelled Next / Load more button. Image carousels, sliders and
 * anything inside a vehicle card are ignored. Links come back as an href (Node navigates); buttons are
 * tagged for a click.
 */
export const FIND_NEXT_JS = `(() => {
  function shown(el) { var s = getComputedStyle(el); var r = el.getBoundingClientRect(); return s.display !== 'none' && s.visibility !== 'hidden' && r.width > 4 && r.height > 4 }
  function cls(x) { return typeof x.className === 'string' ? x.className : (x.getAttribute && x.getAttribute('class')) || '' }
  function disabled(el) {
    var x = el
    for (var i = 0; i < 3 && x; i++, x = x.parentElement) {
      if (x.disabled || x.getAttribute('aria-disabled') === 'true' || /(^|\\s)(disabled|is-disabled|inactive)(\\s|$)/i.test(cls(x))) return true
    }
    return false
  }
  function inCarousel(el) { return !!el.closest('[class*="carousel"], [class*="slider"], [class*="swiper"], [class*="slick"], [class*="gallery"], [class*="hero"], [class*="owl-"], [class*="glide"], [class*="splide"], [data-vin], [class*="vehicle-card"]') }
  function label(el) { return ((el.getAttribute('aria-label') || '') + ' ' + (el.getAttribute('title') || '') + ' ' + (el.innerText || el.textContent || '')).replace(/\\s+/g, ' ').trim().toLowerCase() }
  function usable(href) { return href && !/^(javascript:|#)/i.test(href) && href.split('#')[0] !== location.href.split('#')[0] }
  function result(pick, kind) {
    var a = pick.tagName === 'A' ? pick : pick.closest('a') || pick.querySelector('a')
    var href = a ? a.getAttribute('href') : ''
    if (a && usable(href ? a.href : '')) return { kind: 'href', href: a.href, label: kind }
    var target = a || pick
    Array.prototype.slice.call(document.querySelectorAll('[data-zrz-next]')).forEach(function (e) { e.removeAttribute('data-zrz-next') })
    target.setAttribute('data-zrz-next', '1')
    target.scrollIntoView({ block: 'center' })
    var r = target.getBoundingClientRect()
    return { kind: 'click', x: Math.round(r.left + r.width / 2), y: Math.round(r.top + r.height / 2), label: kind }
  }
  var NEXT = /^(next|next page|go to next page|›|»|>|→|next ›|next »|next >|>>)$|\\bnext page\\b|^next\\b(?!.*(image|photo|slide|picture|item))/
  var rel = document.querySelector('a[rel~="next"]')
  if (rel && shown(rel) && !disabled(rel) && usable(rel.href)) return { kind: 'href', href: rel.href, label: 'Next page' }
  // The site's own pagination control
  var pagers = Array.prototype.slice.call(document.querySelectorAll('[class*="paginat" i], [class*="pager" i], nav[aria-label*="pag" i], [aria-label*="pagination" i], [role="navigation"]')).filter(function (p) { return shown(p) && !inCarousel(p) })
  for (var i = 0; i < pagers.length; i++) {
    var p = pagers[i]
    var ctrls = Array.prototype.slice.call(p.querySelectorAll('a, button, [role="button"]')).filter(shown)
    var nx = ctrls.find(function (el) { var l = label(el); return !disabled(el) && (NEXT.test(l) || /next/.test(cls(el)) || /next/.test(cls(el.parentElement || el))) && !/prev/.test(l) })
    if (nx) return result(nx, 'Next page')
    var cur = p.querySelector('[aria-current="page"], .active, .current, .selected, .is-active, [class*="active"]')
    var n = cur ? parseInt((cur.innerText || cur.textContent || '').trim(), 10) : NaN
    if (n > 0) {
      var want = String(n + 1)
      var nextNum = ctrls.find(function (el) { var t = (el.innerText || el.textContent || '').trim(); var a = (el.getAttribute('aria-label') || '').toLowerCase(); return t === want || a === 'page ' + want || a === 'go to page ' + want })
      if (nextNum) return result(nextNum, 'Page ' + want)
    }
  }
  // Labelled buttons anywhere (not carousels)
  var els = Array.prototype.slice.call(document.querySelectorAll('a, button, [role="button"]')).filter(function (el) { return shown(el) && !inCarousel(el) && !disabled(el) })
  var more = null, next = null
  for (var j = 0; j < els.length; j++) {
    var l = label(els[j])
    if (!l || l.length > 40 || /image|photo|slide|picture/.test(l)) continue
    if (!next && NEXT.test(l)) next = els[j]
    if (!more && /^(load|show|view|see) more( vehicles| results| cars| inventory| listings)?\\b/.test(l)) more = els[j]
  }
  if (next) return result(next, 'Next page')
  if (more) return result(more, 'Load more')
  return null
})()`

/**
 * Clickable areas for the snapshot: every visible link with its position on the page (document
 * pixels), so the popup can turn a screenshot into a "click to open that page" map. Also a fuller
 * list of the site's pages (menu links, including ones hidden in drop-down menus) for a Pages menu.
 */
export const HOTSPOTS_JS = (maxHeight: number) => `(() => {
  var MAXH = ${Math.max(900, Math.round(maxHeight))}
  var sy = window.scrollY || 0, sx = window.scrollX || 0
  var spots = [], pages = [], seenPage = {}
  var host = location.hostname.replace(/^www\\./, '')
  var as = Array.prototype.slice.call(document.querySelectorAll('a[href]'))
  function text(a) { return (a.innerText || a.textContent || a.getAttribute('aria-label') || a.getAttribute('title') || (a.querySelector('img') && a.querySelector('img').alt) || '').replace(/\\s+/g, ' ').trim() }
  for (var i = 0; i < as.length; i++) {
    var a = as[i]
    var href = a.href || ''
    if (!/^https?:/.test(href) || /^javascript:/i.test(a.getAttribute('href') || '')) continue
    var t = text(a)
    var key = href.split('#')[0]
    // Site pages (visible or not): same site only, skip obvious non-page links.
    var h = ''
    try { h = new URL(href).hostname.replace(/^www\\./, '') } catch (e) { h = '' }
    if (h && (h === host || h.endsWith('.' + host) || host.endsWith('.' + h)) && t && t.length <= 48 && !seenPage[key] && pages.length < 120 && !/\\.(jpg|jpeg|png|gif|pdf|webp)(\\?|$)/i.test(key) && !/^(tel|mailto|sms):/i.test(href) && !/(facebook|twitter|instagram|youtube|linkedin|tiktok)\\./i.test(h)) {
      seenPage[key] = 1
      var s = (t + ' ' + key).toLowerCase()
      var kind = /certified|cpo/.test(s) ? 'certified' : /pre-?owned|used/.test(s) ? 'used' : /\\bnew\\b|\\/new-|new-vehicles|new-inventory/.test(s) ? 'new' : /inventory|vehicles|showroom|search/.test(s) ? 'all' : 'other'
      var inNav = !!a.closest('nav, header, [role="navigation"], .navbar, .nav, .menu, #menu, .header, [class*="nav"], [class*="menu"], [class*="header"]')
      pages.push({ label: t, href: key, kind: kind, nav: inNav })
    }
    // Hotspots: visible, inside the captured area.
    var rects = a.getClientRects()
    if (!rects || !rects.length) continue
    var cs = window.getComputedStyle(a)
    if (cs.visibility === 'hidden' || cs.display === 'none' || Number(cs.opacity) === 0) continue
    for (var r = 0; r < rects.length && spots.length < 600; r++) {
      var b = rects[r]
      if (b.width < 6 || b.height < 6) continue
      var y = b.top + sy, x = b.left + sx
      if (y > MAXH || y + b.height < 0 || x + b.width < 0) continue
      spots.push({ x: Math.round(x), y: Math.round(y), w: Math.round(b.width), h: Math.round(b.height), href: key, label: t.slice(0, 80) })
    }
  }
  // Larger boxes first so small inner links sit on top in the overlay.
  spots.sort(function (a, b) { return (b.w * b.h) - (a.w * a.h) })
  var rank = { used: 0, certified: 1, new: 2, all: 3, other: 4 }
  function weak(p) { return /special|why|value|skip|offer|deal|trade|finance|research/i.test(p.label + ' ' + p.href) ? 1 : 0 }
  pages.sort(function (a, b) { return rank[a.kind] - rank[b.kind] || weak(a) - weak(b) || Number(b.nav) - Number(a.nav) || a.label.length - b.label.length })
  return { spots: spots, pages: pages }
})()`

/**
 * Runs in a blank analysis tab: decodes downloaded images and measures them.
 * dHash (64-bit perceptual hash, for spotting the same picture on many cars), white/grey share,
 * colourfulness, edge density, white border (studio renders) and optional OCR (Shape Detection API).
 * Nothing is kept: the review screen shows the dealer's own image URL.
 */
export const ANALYZE_FN_JS = `async (items) => {
  var hasOcr = typeof TextDetector !== 'undefined'
  var detector = null
  try { if (hasOcr) detector = new TextDetector() } catch (e) { detector = null }
  function b64ToBytes(b64) { var bin = atob(b64); var u = new Uint8Array(bin.length); for (var i = 0; i < bin.length; i++) u[i] = bin.charCodeAt(i); return u }
  var out = []
  for (var n = 0; n < items.length; n++) {
    var it = items[n]
    try {
      var bmp = await createImageBitmap(new Blob([b64ToBytes(it.b64)], { type: it.mime || 'image/jpeg' }))
      var W = 64, H = 64
      var c = new OffscreenCanvas(W, H); var x = c.getContext('2d', { willReadFrequently: true })
      x.drawImage(bmp, 0, 0, W, H)
      var d = x.getImageData(0, 0, W, H).data
      var white = 0, gray = 0, rg = [], yb = [], lum = new Float32Array(W * H), border = 0, borderWhite = 0, q = {}
      for (var i = 0, p = 0; i < d.length; i += 4, p++) {
        var r = d[i], g = d[i + 1], b = d[i + 2]
        var mx = Math.max(r, g, b), mn = Math.min(r, g, b)
        if (mn > 225 && mx - mn < 18) white++
        if (mx - mn < 20) gray++
        rg.push(r - g); yb.push(0.5 * (r + g) - b)
        lum[p] = 0.299 * r + 0.587 * g + 0.114 * b
        q[(r >> 4) + ',' + (g >> 4) + ',' + (b >> 4)] = 1
        var px = p % W, py = (p / W) | 0
        if (px < 6 || px >= W - 6 || py < 6 || py >= H - 6) { border++; if (mn > 220 && mx - mn < 20) borderWhite++ }
      }
      function mean(a) { var s = 0; for (var i = 0; i < a.length; i++) s += a[i]; return s / a.length }
      function sd(a, m) { var s = 0; for (var i = 0; i < a.length; i++) s += (a[i] - m) * (a[i] - m); return Math.sqrt(s / a.length) }
      var mrg = mean(rg), myb = mean(yb)
      var colorfulness = Math.sqrt(Math.pow(sd(rg, mrg), 2) + Math.pow(sd(yb, myb), 2)) + 0.3 * Math.sqrt(mrg * mrg + myb * myb)
      var edges = 0
      for (var yy = 1; yy < H - 1; yy++) for (var xx = 1; xx < W - 1; xx++) {
        var k = yy * W + xx
        var gx = lum[k + 1] - lum[k - 1], gy = lum[k + W] - lum[k - W]
        if (Math.abs(gx) + Math.abs(gy) > 48) edges++
      }
      // dHash 9x8
      var hc = new OffscreenCanvas(9, 8); var hx = hc.getContext('2d', { willReadFrequently: true })
      hx.drawImage(bmp, 0, 0, 9, 8)
      var hd = hx.getImageData(0, 0, 9, 8).data, bits = ''
      for (var row = 0; row < 8; row++) for (var col = 0; col < 8; col++) {
        var a1 = (row * 9 + col) * 4, a2 = (row * 9 + col + 1) * 4
        var l1 = hd[a1] * 0.299 + hd[a1 + 1] * 0.587 + hd[a1 + 2] * 0.114, l2 = hd[a2] * 0.299 + hd[a2 + 1] * 0.587 + hd[a2 + 2] * 0.114
        bits += l1 > l2 ? '1' : '0'
      }
      var hash = ''
      for (var h = 0; h < 64; h += 4) hash += parseInt(bits.slice(h, h + 4), 2).toString(16)
      var text = ''
      if (detector) { try { var found = await detector.detect(bmp); text = found.map(function (f) { return f.rawValue }).join(' ').slice(0, 300) } catch (e) {} }
      out.push({ id: it.id, ok: true, w: bmp.width, h: bmp.height, hash: hash, whiteRatio: white / (W * H), grayRatio: gray / (W * H), colorfulness: Math.round(colorfulness * 10) / 10, edgeDensity: edges / ((W - 2) * (H - 2)), borderWhite: border ? borderWhite / border : 0, uniqueColors: Object.keys(q).length, text: text, ocr: !!detector })
      bmp.close && bmp.close()
    } catch (e) { out.push({ id: it.id, ok: false, error: String(e && e.message || e) }) }
  }
  return out
}`
