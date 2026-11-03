<script setup lang="ts">
/**
 * Leaflet map for prospecting: base location, range circle, a radar sweep while scanning, and one canvas
 * marker per discovered dealership (fast with thousands of points). Tiles: CARTO light/dark (no key needed).
 */
import type * as Leaflet from 'leaflet'
import { Crosshair } from 'lucide-vue-next'

export interface MapPoint { id: string, lat: number, lng: number, name: string, status: 'new' | 'in_crm' | 'dismissed', sub?: string }

const props = withDefaults(defineProps<{
  origin: { lat: number, lng: number }
  radiusMiles: number
  points?: MapPoint[]
  selected?: Set<string>
  focusedId?: string | null
  draggableOrigin?: boolean
  scanning?: boolean
  showLegend?: boolean
  counts?: { new: number, in_crm: number, dismissed: number } | null
  /** false = the mouse wheel scrolls the page instead of zooming (use +/− or double-click). */
  wheelZoom?: boolean
}>(), { points: () => [], selected: () => new Set<string>(), focusedId: null, draggableOrigin: false, scanning: false, showLegend: true, counts: null, wheelZoom: true })

const emit = defineEmits<{
  (e: 'select', id: string, additive: boolean): void
  (e: 'focus', id: string | null): void
  (e: 'update:origin', v: { lat: number, lng: number }): void
}>()

const el = ref<HTMLElement | null>(null)
const ready = ref(false)
const colorMode = useColorMode()
const METERS_PER_MILE = 1609.344

let L: typeof Leaflet | null = null
let map: Leaflet.Map | null = null
let tiles: Leaflet.TileLayer | null = null
let circle: Leaflet.Circle | null = null
let orbit: Leaflet.Circle | null = null
let ripples: Leaflet.Marker | null = null
let rangeLabel: Leaflet.Marker | null = null
let animTimer: ReturnType<typeof setTimeout> | undefined
let originMarker: Leaflet.Marker | null = null
let radar: Leaflet.Marker | null = null
let layer: Leaflet.LayerGroup | null = null
let renderer: Leaflet.Canvas | null = null
const markers = new Map<string, Leaflet.CircleMarker>()
let ro: ResizeObserver | null = null

const STATUS_COLOR: Record<MapPoint['status'], string> = { new: '', in_crm: '#10b981', dismissed: '#a1a1aa' }
/** Theme colour as resolved on the map itself (the theme class sits below <html>, so read it here, not on :root). */
function primaryColor() {
  if (typeof window === 'undefined') return '#0d9488'
  const v = getComputedStyle(el.value || document.documentElement).getPropertyValue('--primary').trim()
  return v || '#0d9488'
}
const colorFor = (s: MapPoint['status']) => (s === 'new' ? primaryColor() : STATUS_COLOR[s])

function setTiles() {
  if (!L || !map) return
  const dark = colorMode.value === 'dark'
  tiles?.remove()
  // OpenStreetMap tiles (no key). Toned down in light mode, inverted for dark mode via CSS (.zrz-map-dark).
  tiles = L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', {
    maxZoom: 19,
    attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors',
  }).addTo(map)
  el.value?.classList.toggle('zrz-map-dark', dark)
}

/** Bounds of the range circle — computed from the centre, so it works before the circle is drawn. */
function rangeBounds() {
  return L!.latLng(props.origin.lat, props.origin.lng).toBounds(props.radiusMiles * METERS_PER_MILE * 2)
}
function radarSizePx() {
  if (!map || !L) return 0
  const b = rangeBounds()
  const a = map.latLngToLayerPoint(b.getNorthWest()), c = map.latLngToLayerPoint(b.getSouthEast())
  return Math.max(40, Math.round(Math.abs(c.x - a.x)))
}
/** Ripples that travel from base out to the edge of the range — always on, very subtle. */
function drawRipples() {
  if (!L || !map) return
  ripples?.remove(); ripples = null
  const d = radarSizePx()
  if (d < 60) return
  ripples = L.marker([props.origin.lat, props.origin.lng], {
    icon: L.divIcon({ className: 'zrz-ripple-icon', html: '<div class="zrz-ripples"><span></span><span></span><span></span></div>', iconSize: [d, d], iconAnchor: [d / 2, d / 2] }),
    interactive: false,
    keyboard: false,
    zIndexOffset: -2000,
  }).addTo(map)
}
/** "75 mi" pill sitting on the east edge of the circle. */
function drawRangeLabel() {
  if (!L || !map) return
  const lngOffset = props.radiusMiles / (69.172 * Math.cos(props.origin.lat * Math.PI / 180))
  const at: Leaflet.LatLngExpression = [props.origin.lat, props.origin.lng + lngOffset]
  const html = `<span class="zrz-range-label">${Math.round(props.radiusMiles)} mi</span>`
  if (!rangeLabel) {
    rangeLabel = L.marker(at, { icon: L.divIcon({ className: 'zrz-range-label-icon', html, iconSize: [0, 0] }), interactive: false, keyboard: false, zIndexOffset: 900 }).addTo(map)
  }
  else {
    rangeLabel.setLatLng(at)
    rangeLabel.setIcon(L.divIcon({ className: 'zrz-range-label-icon', html, iconSize: [0, 0] }))
  }
}
/** Replays the "draw the circle" animation (on first paint and whenever the range or base changes). */
function animateRange() {
  for (const c of [circle, orbit]) {
    const path = c?.getElement() as SVGPathElement | undefined
    if (!path) continue
    path.setAttribute('pathLength', '1')
    path.classList.remove('zrz-play')
    void path.getBoundingClientRect() // restart the CSS animation
    path.classList.add('zrz-play')
  }
}
function drawRangeDecor() { drawRipples(); drawRadar(); drawRangeLabel() }

function drawRadar() {
  if (!L || !map) return
  radar?.remove(); radar = null
  if (!props.scanning) return
  const d = radarSizePx()
  radar = L.marker([props.origin.lat, props.origin.lng], {
    icon: L.divIcon({ className: 'zrz-radar-icon', html: '<div class="zrz-radar"><div class="zrz-radar-sweep"></div></div>', iconSize: [d, d], iconAnchor: [d / 2, d / 2] }),
    interactive: false,
    keyboard: false,
    zIndexOffset: -1000,
  }).addTo(map)
}

function drawOrigin() {
  if (!L || !map) return
  const ll: Leaflet.LatLngExpression = [props.origin.lat, props.origin.lng]
  const color = primaryColor()
  const radius = props.radiusMiles * METERS_PER_MILE
  if (!circle) {
    // Colours come from CSS (var(--primary)) so they follow the theme live; these are fallbacks.
    circle = L.circle(ll, { radius, color, weight: 2, opacity: 1, fillColor: color, fillOpacity: 0.06, interactive: false, className: 'zrz-range' }).addTo(map)
    orbit = L.circle(ll, { radius, color, weight: 4, opacity: 1, fill: false, interactive: false, className: 'zrz-range-orbit', lineCap: 'round' }).addTo(map)
  }
  else {
    circle.setLatLng(ll); circle.setRadius(radius)
    orbit?.setLatLng(ll); orbit?.setRadius(radius)
  }
  // Debounced so dragging the range slider replays the animation once, when it settles.
  clearTimeout(animTimer)
  animTimer = setTimeout(animateRange, 180)
  if (!originMarker) {
    originMarker = L.marker(ll, {
      icon: L.divIcon({ className: 'zrz-base-icon', html: '<div class="zrz-base"><span class="zrz-base-ring"></span><span class="zrz-base-core"></span></div>', iconSize: [28, 28], iconAnchor: [14, 14] }),
      draggable: props.draggableOrigin,
      zIndexOffset: 1000,
      title: 'Base location',
    }).addTo(map)
    originMarker.on('dragend', () => {
      const p = originMarker!.getLatLng()
      emit('update:origin', { lat: Math.round(p.lat * 1e6) / 1e6, lng: Math.round(p.lng * 1e6) / 1e6 })
    })
  }
  else { originMarker.setLatLng(ll) }
  drawRangeDecor()
}

function styleFor(p: MapPoint): Leaflet.CircleMarkerOptions {
  const sel = props.selected.has(p.id), focus = props.focusedId === p.id
  return {
    radius: focus ? 9 : sel ? 7 : p.status === 'new' ? 5 : 4,
    color: focus || sel ? '#ffffff' : colorFor(p.status),
    weight: focus || sel ? 3 : 1,
    fillColor: colorFor(p.status),
    fillOpacity: p.status === 'dismissed' ? 0.45 : 0.9,
    opacity: 1,
  }
}

function drawPoints() {
  if (!L || !map || !layer) return
  const keep = new Set<string>()
  for (const p of props.points) {
    keep.add(p.id)
    let m = markers.get(p.id)
    if (!m) {
      m = L.circleMarker([p.lat, p.lng], { ...styleFor(p), renderer: renderer! })
      m.bindTooltip(`<div class="zrz-tip"><b>${escapeHtml(p.name)}</b>${p.sub ? `<span>${escapeHtml(p.sub)}</span>` : ''}</div>`, { direction: 'top', offset: [0, -6], opacity: 1 })
      m.on('click', (e: any) => emit('select', p.id, !!(e.originalEvent?.shiftKey || e.originalEvent?.metaKey || e.originalEvent?.ctrlKey)))
      m.on('mouseover', () => emit('focus', p.id))
      m.on('mouseout', () => emit('focus', null))
      m.addTo(layer)
      markers.set(p.id, m)
    }
    else { m.setStyle(styleFor(p)) }
    if (p.status === 'new' || props.selected.has(p.id)) m.bringToFront()
  }
  for (const [id, m] of markers) if (!keep.has(id)) { m.remove(); markers.delete(id) }
}
function escapeHtml(s: string) { return s.replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', '\'': '&#39;' }[c]!)) }

function fitRadius(animate = false) {
  if (!map || !L) return
  map.fitBounds(rangeBounds(), { padding: [16, 16], animate })
}

onMounted(async () => {
  const mod: any = await import('leaflet')
  L = (mod.default ?? mod) as typeof Leaflet
  await import('leaflet/dist/leaflet.css')
  if (!el.value) return
  // Set a view first: Leaflet only attaches layers once the map has a centre and zoom.
  map = L.map(el.value, { zoomControl: false, attributionControl: true, worldCopyJump: true, scrollWheelZoom: props.wheelZoom })
    .setView([props.origin.lat, props.origin.lng], 8)
  L.control.zoom({ position: 'bottomright' }).addTo(map)
  renderer = L.canvas({ padding: 0.5 })
  layer = L.layerGroup().addTo(map)
  setTiles()
  drawOrigin()
  fitRadius()
  drawPoints()
  map.on('zoomstart', () => el.value?.classList.add('zrz-zooming'))
  map.on('zoomend', () => { el.value?.classList.remove('zrz-zooming'); drawRangeDecor() })
  // A map created while hidden (List view) has no size — refit once it becomes visible.
  let wasHidden = el.value.clientWidth === 0
  ro = new ResizeObserver(() => {
    if (!map || !el.value) return
    map.invalidateSize()
    const hidden = el.value.clientWidth === 0
    if (wasHidden && !hidden) { fitRadius(); drawRangeDecor(); animateRange() }
    wasHidden = hidden
  })
  ro.observe(el.value)
  ready.value = true
})
onBeforeUnmount(() => { clearTimeout(animTimer); ro?.disconnect(); map?.remove(); map = null; markers.clear() })

watch(() => colorMode.value, setTiles)
watch(() => [props.origin.lat, props.origin.lng, props.radiusMiles], () => { drawOrigin(); fitRadius(true) })
watch(() => props.scanning, drawRadar)
watch(() => props.points, drawPoints)
watch(() => props.selected, drawPoints)
watch(() => props.focusedId, (id, prev) => {
  for (const k of [prev, id]) {
    if (!k) continue
    const m = markers.get(k), p = props.points.find(x => x.id === k)
    if (m && p) m.setStyle(styleFor(p))
  }
  const m = id ? markers.get(id) : null
  if (m && map) {
    m.bringToFront()
    if (!map.getBounds().pad(-0.1).contains(m.getLatLng())) map.panTo(m.getLatLng(), { animate: true })
  }
})

/** Parent can fly to a dealership (e.g. clicking the pin icon in the table). */
function flyTo(id: string) {
  const m = markers.get(id)
  if (m && map) { map.flyTo(m.getLatLng(), Math.max(map.getZoom(), 12), { duration: 0.6 }); m.openTooltip() }
}
defineExpose({ flyTo, fitRadius })
</script>

<template>
  <div class="relative h-full w-full overflow-hidden bg-muted/30">
    <div ref="el" class="zrz-map absolute inset-0 z-0" />
    <div v-if="!ready" class="pointer-events-none absolute inset-0 grid place-items-center">
      <div class="size-10 rounded-full border-2 border-primary/30 border-t-primary animate-spin" />
    </div>
    <div v-if="showLegend && ready" class="pointer-events-none absolute left-2 top-2 z-[500] rounded-lg border bg-background/90 px-2 py-1.5 text-[11px] shadow-sm backdrop-blur">
      <div class="flex items-center gap-3">
        <span class="flex items-center gap-1.5"><span class="size-2.5 rounded-full bg-primary" />New<b v-if="counts" class="tabular-nums">{{ counts.new }}</b></span>
        <span class="flex items-center gap-1.5"><span class="size-2.5 rounded-full bg-emerald-500" />In CRM<b v-if="counts" class="tabular-nums">{{ counts.in_crm }}</b></span>
        <span class="flex items-center gap-1.5"><span class="size-2.5 rounded-full bg-zinc-400" />Dismissed<b v-if="counts" class="tabular-nums">{{ counts.dismissed }}</b></span>
      </div>
    </div>
    <button
      v-if="ready" type="button" title="Re-center on the search area"
      class="absolute right-2 top-2 z-[500] grid size-8 place-items-center rounded-md border bg-background/90 text-muted-foreground shadow-sm backdrop-blur transition-colors hover:text-foreground"
      @click="fitRadius(true)"
    >
      <Crosshair class="size-4" />
    </button>
  </div>
</template>

<style>
/* Leaflet builds these nodes itself, so the styles can't be scoped. */
.zrz-base-icon, .zrz-radar-icon { background: transparent; border: 0; }
.zrz-base { position: relative; width: 28px; height: 28px; }
.zrz-base-core { position: absolute; inset: 7px; border-radius: 9999px; background: var(--primary); border: 3px solid #fff; box-shadow: 0 2px 8px rgb(0 0 0 / .35); }
.zrz-base-ring { position: absolute; inset: 0; border-radius: 9999px; background: var(--primary); opacity: .35; animation: zrz-pulse 2s ease-out infinite; }
@keyframes zrz-pulse { 0% { transform: scale(.5); opacity: .55 } 100% { transform: scale(2.2); opacity: 0 } }
.zrz-radar { position: relative; width: 100%; height: 100%; border-radius: 9999px; overflow: hidden; pointer-events: none; }
.zrz-radar-sweep {
  position: absolute; inset: 0; border-radius: 9999px;
  background: conic-gradient(from 0deg, transparent 0deg, transparent 300deg, color-mix(in oklab, var(--primary) 45%, transparent) 360deg);
  animation: zrz-sweep 2.4s linear infinite;
}
@keyframes zrz-sweep { to { transform: rotate(360deg) } }
.zrz-tip { display: flex; flex-direction: column; gap: 1px; font-size: 12px; line-height: 1.3; }
.zrz-tip span { color: #71717a; font-size: 11px; }
.leaflet-container { font-family: inherit; background: transparent; }
/* Another stylesheet in the app (chart lib) sets .leaflet-overlay-pane to z-index 1, which hid every vector under the tiles. */
.zrz-map .leaflet-tile-pane { z-index: 200; }
.zrz-map .leaflet-overlay-pane { z-index: 400; }
.zrz-map .leaflet-marker-pane { z-index: 600; }
.zrz-map .leaflet-tooltip-pane { z-index: 650; }

/* ── Search-area circle ── */
.zrz-map path.zrz-range {
  stroke: var(--primary); fill: var(--primary); stroke-width: 2px; fill-opacity: .06;
  filter: drop-shadow(0 0 6px color-mix(in oklab, var(--primary) 45%, transparent));
}
.zrz-map path.zrz-range.zrz-play {
  stroke-dasharray: 1; stroke-dashoffset: 1;
  animation: zrz-draw 1.4s cubic-bezier(.65, 0, .35, 1) forwards, zrz-fill-in 1.4s ease-out both;
}
@keyframes zrz-draw { to { stroke-dashoffset: 0; } }
@keyframes zrz-fill-in { from { fill-opacity: 0; } to { fill-opacity: .06; } }
/* A bright comet that orbits the edge of the range. */
.zrz-map path.zrz-range-orbit {
  stroke: var(--primary); fill: none; stroke-width: 4px; stroke-linecap: round; opacity: 0;
  stroke-dasharray: .07 .93;
  filter: drop-shadow(0 0 5px var(--primary));
}
.zrz-map path.zrz-range-orbit.zrz-play { animation: zrz-orbit-in .6s ease 1.2s forwards, zrz-orbit 9s linear 1.2s infinite; }
@keyframes zrz-orbit-in { to { opacity: .95; } }
@keyframes zrz-orbit { from { stroke-dashoffset: 0; } to { stroke-dashoffset: -1; } }
/* Ripples travelling from base to the edge. */
.zrz-ripple-icon { background: transparent; border: 0; pointer-events: none; }
.zrz-ripples { position: relative; width: 100%; height: 100%; }
.zrz-ripples span {
  position: absolute; inset: 0; border-radius: 9999px; border: 2px solid var(--primary);
  opacity: 0; transform: scale(.02); animation: zrz-ripple 6s cubic-bezier(.2, .6, .35, 1) infinite;
}
.zrz-ripples span:nth-child(2) { animation-delay: 2s; }
.zrz-ripples span:nth-child(3) { animation-delay: 4s; }
@keyframes zrz-ripple { 0% { transform: scale(.02); opacity: .55; } 80% { opacity: .12; } 100% { transform: scale(1); opacity: 0; } }
/* Radius pill on the east edge. */
.zrz-range-label-icon { background: transparent; border: 0; }
.zrz-range-label {
  position: absolute; transform: translate(-50%, -50%); white-space: nowrap;
  padding: 2px 8px; border-radius: 9999px; font-size: 11px; font-weight: 600; line-height: 16px;
  color: var(--primary-foreground); background: var(--primary);
  box-shadow: 0 0 0 2px var(--background), 0 4px 12px rgb(0 0 0 / .18);
  animation: zrz-pop .5s cubic-bezier(.34, 1.56, .64, 1) 1.1s both;
}
@keyframes zrz-pop { from { transform: translate(-50%, -50%) scale(.4); opacity: 0; } to { transform: translate(-50%, -50%) scale(1); opacity: 1; } }
/* Decorations are sized for the current zoom — hide them while Leaflet animates a zoom. */
.zrz-zooming .zrz-ripples, .zrz-zooming .zrz-radar { visibility: hidden; }
.leaflet-tile-pane { filter: saturate(.55) contrast(.95) brightness(1.03); }
.zrz-map-dark .leaflet-tile-pane { filter: invert(1) hue-rotate(180deg) saturate(.35) brightness(.85) contrast(.9); }
.leaflet-control-attribution { font-size: 10px; }
@media (prefers-reduced-motion: reduce) {
  .zrz-radar-sweep, .zrz-base-ring, .zrz-ripples span, .zrz-range-label { animation: none; }
  .zrz-map path.zrz-range.zrz-play { animation: none; stroke-dasharray: none; stroke-dashoffset: 0; }
  .zrz-map path.zrz-range-orbit { display: none; }
}
</style>
