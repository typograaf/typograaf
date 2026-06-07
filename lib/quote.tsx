import type { ReactNode } from 'react'

// Quote feature — shared types and pricing logic.
// Used by the admin editor, the public /quote/[name] page, and the API.
//
// Pricing model (per option):
//   design cost  D  = sum of all asset prices entered in the CMS
//   PERPETUAL    = one-time D + 50% = D * 1.5
//   ANNUAL       = first year of use included (D upfront),
//                  then 1/3 of D per year after the first year

export type LicenseModel = 'annual' | 'perpetual'

export interface QuotePicture {
  src: string
  alt?: string
}

export interface QuoteAsset {
  name: string // "Display Typeface"
  variable: string // "1 Axis"
  price: number // design-cost component, EUR
  offersItalic: boolean // if true, client can pick Italic (+70% of this asset's price); Oblique is the free default
  styles: string[] // ["400 Regular (+Oblique)", …, "Variable"]
  pictures: QuotePicture[]
}

// Italic upgrade adds 35% of the asset's own price. Oblique is free.
export const ITALIC_SURCHARGE = 0.35

export function assetEffectivePrice(a: QuoteAsset, italic: boolean): number {
  const base = Number(a.price) || 0
  return italic ? base + base * ITALIC_SURCHARGE : base
}

// Generic line item — for non-typeface deliverables (motionlogo,
// guidelines, brand identity, …). Flat fee, not subject to the
// annual/perpetual license multipliers. Line total = quantity * unitPrice.
export interface QuoteItem {
  name: string // "Motionlogo"
  description: string // optional, multi-line
  unit: string // free-text label, e.g. "per video", "30s loop", "1×"
  quantity: number // default 1
  unitPrice: number // EUR
  pictures: QuotePicture[]
  startDate?: string // optional planning override (yyyy-mm-dd); empty = auto-chain
}

// Each PlanBlock occupies exactly one calendar day. Multi-day items become
// multiple blocks. Source of truth for the visual gantt when present;
// otherwise the chain auto-derives from `startDate`.
export type PlanBlockKind = 'item' | 'presentation' | 'feedback'
export interface PlanBlock {
  id: string                     // stable identifier (random-ish, locally unique)
  kind: PlanBlockKind
  date: string                   // yyyy-mm-dd
  itemIndex?: number             // 0-based ref into option.items, only for kind: 'item'
}

export interface QuoteOption {
  title: string // "Option 1"
  description: string
  assets: QuoteAsset[]
  items: QuoteItem[]
  pictures: QuotePicture[]
  startDate?: string // kickoff for auto-chain fallback (yyyy-mm-dd)
  presentationDays?: number      // pool of "presentation" days, draggable in admin
  feedbackDays?: number          // pool of "feedback waiting" days, draggable in admin
  planBlocks?: PlanBlock[]       // explicit placed blocks (overrides auto-chain)
}

export interface Quote {
  slug: string // URL: /quote/<slug>
  project: string // "MirrorMirror Sports Pitch"
  date: string // ISO yyyy-mm-dd
  validThrough: string // ISO yyyy-mm-dd
  options: QuoteOption[]
  pictures: QuotePicture[]
}

export function slugify(input: string): string {
  return input
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
}

// Base design cost — every asset as Oblique (no Italic surcharge).
export function designCost(opt: QuoteOption): number {
  return opt.assets.reduce((sum, a) => sum + (Number(a.price) || 0), 0)
}

// Design cost with the client's per-asset Italic selection applied.
// The license formulas (annual / perpetual) run on top of this.
export function effectiveDesignCost(opt: QuoteOption, italic: boolean[]): number {
  return opt.assets.reduce(
    (sum, a, i) => sum + assetEffectivePrice(a, !!italic[i]),
    0,
  )
}

// One-time buyout: design + 50%.
export function perpetualTotal(d: number): number {
  return Math.round(d * 1.5)
}

// Annual: the first year of use is included for this amount (= D).
export function annualFirstYear(d: number): number {
  return Math.round(d)
}

// Annual: recurring license cost per year after the first year.
export function annualYearly(d: number): number {
  return Math.round(d / 6)
}

// On converting annual → perpetual, previously paid annual fees are
// credited up to this cap: 2/3 of the design cost (so the client
// always pays ~1/3 of design net to convert), independent of the
// yearly rate.
export function creditMax(d: number): number {
  return Math.round((d * 2) / 3)
}

// Weight ladder. A typed style is matched by its name (any leading
// weight number and spacing/casing ignored) and rendered canonically
// with the number prefixed.
const WEIGHT_LADDER: { num: number; name: string }[] = [
  { num: 400, name: 'Regular' },
  { num: 500, name: 'Medium' },
  { num: 600, name: 'SemiBold' },
  { num: 700, name: 'Bold' },
  { num: 400, name: 'Regular Extended' },
  { num: 500, name: 'Medium Extended' },
  { num: 600, name: 'SemiBold Extended' },
  { num: 700, name: 'Bold Extended' },
]
const LADDER_BY_KEY = new Map(
  WEIGHT_LADDER.map((w) => [w.name.toLowerCase().replace(/\s+/g, ''), w]),
)

// "bold" → "700 Bold", "700 Bold" → "700 Bold", "Regular Extended" →
// "400 Regular Extended". Unknown styles pass through trimmed.
export function canonicalStyle(style: string): string {
  const key = style
    .trim()
    .replace(/^\d+\s*/, '') // drop a leading weight number if typed
    .toLowerCase()
    .replace(/\s+/g, '')
  const match = LADDER_BY_KEY.get(key)
  return match ? `${match.num} ${match.name}` : style.trim()
}

// Canonicalise the weight, then append the selected slanted-variant
// ("bold" → "700 Bold (+Oblique)"). "TBC" means styles aren't defined
// yet — left untouched.
export function styleLabel(style: string, variant: 'Oblique' | 'Italic'): string {
  if (style.trim().toUpperCase() === 'TBC') return style
  return `${canonicalStyle(style)} (+${variant})`
}

// A non-variable font has 0 axes — show that as "No" rather than "0".
// "0" → "No", "0 Axis" → "No Axis", "0 Axes" → "No Axes". Other
// values ("1 Axis", "Variable", …) pass through unchanged.
export function formatVariable(v: string): string {
  const t = v.trim()
  if (t === '0') return 'No'
  return t.replace(/^0(\s+Ax[ie]s)\b/i, 'No$1')
}

export function formatEur(n: number): string {
  return `€ ${Math.round(n).toLocaleString('de-DE')} EUR`
}

// Display dates as dd.mm.yy to match the design ("26.05.18").
export function formatQuoteDate(iso: string): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso.trim())
  if (!m) return iso
  return `${m[3]}.${m[2]}.${m[1].slice(2)}`
}

// Footnote / description token substitution. Authors can write
// {design} {perpetual} {firstYear} {annual} and get the live,
// formatted amounts for the option.
//   {design}    = base design cost D
//   {perpetual} = one-time buyout (D * 1.5)
//   {firstYear} = annual, first year (D)
//   {annual}    = annual recurring price per year (D / 6) — reads
//                 naturally in "renewed annually at {annual} per year"
//   {creditMax} = max annual-fee credit toward conversion (2/3 of design)
//   {annualYearly} = legacy alias for {annual}
export function fillTokens(text: string, d: number): string {
  return text
    .replace(/\{design\}/g, formatEur(d))
    .replace(/\{perpetual\}/g, formatEur(perpetualTotal(d)))
    .replace(/\{firstYear\}/g, formatEur(annualFirstYear(d)))
    .replace(/\{creditMax\}/g, formatEur(creditMax(d)))
    .replace(/\{annualYearly\}/g, formatEur(annualYearly(d)))
    .replace(/\{annual\}/g, formatEur(annualYearly(d)))
    // Safety net: never leak an unrecognised {token} to the client.
    .replace(/\{[a-zA-Z][\w-]*\}/g, '')
}

export function emptyAsset(): QuoteAsset {
  return { name: '', variable: '', price: 0, offersItalic: true, styles: [], pictures: [] }
}

export function emptyItem(): QuoteItem {
  return { name: '', description: '', unit: '', quantity: 1, unitPrice: 0, pictures: [] }
}

// Minimal markdown renderer for option/item descriptions. Supports:
//   **bold**, *italic* / _italic_, [text](url)
//   - bullets / * bullets, 1. numbered
//   blank line = new block, single newline inside a paragraph = <br/>
// Emits React nodes (no dangerouslySetInnerHTML), so authoring is XSS-safe.
function inlineMarkdown(text: string, keyBase: string): ReactNode[] {
  const out: ReactNode[] = []
  let i = 0
  let k = 0
  while (i < text.length) {
    const linkM = /\[([^\]]+)\]\((https?:\/\/[^\s)]+|mailto:[^\s)]+)\)/.exec(text.slice(i))
    const boldM = /\*\*([^*\n]+)\*\*/.exec(text.slice(i))
    const italicM = /(^|[\s(])(\*|_)([^*_\n]+)\2(?=[\s).,;:!?]|$)/.exec(text.slice(i))
    const brM = /\n/.exec(text.slice(i))
    const candidates = [
      linkM ? { kind: 'link' as const, m: linkM } : null,
      boldM ? { kind: 'bold' as const, m: boldM } : null,
      italicM ? { kind: 'italic' as const, m: italicM } : null,
      brM ? { kind: 'br' as const, m: brM } : null,
    ].filter(Boolean) as { kind: 'link' | 'bold' | 'italic' | 'br'; m: RegExpExecArray }[]
    if (candidates.length === 0) {
      out.push(text.slice(i))
      break
    }
    candidates.sort((a, b) => a.m.index - b.m.index)
    const pick = candidates[0]
    if (pick.m.index > 0) out.push(text.slice(i, i + pick.m.index))
    const key = `${keyBase}-${k++}`
    if (pick.kind === 'link') {
      out.push(<a key={key} href={pick.m[2]} target="_blank" rel="noopener noreferrer">{pick.m[1]}</a>)
      i += pick.m.index + pick.m[0].length
    } else if (pick.kind === 'bold') {
      out.push(<strong key={key}>{pick.m[1]}</strong>)
      i += pick.m.index + pick.m[0].length
    } else if (pick.kind === 'italic') {
      const lead = pick.m[1]
      if (lead) out.push(lead)
      out.push(<em key={key}>{pick.m[3]}</em>)
      i += pick.m.index + pick.m[0].length
    } else {
      out.push(<br key={key} />)
      i += pick.m.index + 1
    }
  }
  return out
}

export function renderMarkdown(text: string, keyBase = 'md'): ReactNode {
  if (!text) return null
  const blocks = text.split(/\n{2,}/)
  return blocks.map((block, bi) => {
    const lines = block.split('\n')
    const isBullet = lines.every((l) => /^\s*[-*]\s+\S/.test(l))
    const isNumbered = lines.every((l) => /^\s*\d+\.\s+\S/.test(l))
    if (isBullet && lines.length > 0) {
      return (
        <ul key={`${keyBase}-b${bi}`} className="quote-md-list">
          {lines.map((l, li) => {
            const item = l.replace(/^\s*[-*]\s+/, '')
            return <li key={li}>{inlineMarkdown(item, `${keyBase}-b${bi}-${li}`)}</li>
          })}
        </ul>
      )
    }
    if (isNumbered && lines.length > 0) {
      return (
        <ol key={`${keyBase}-n${bi}`} className="quote-md-list">
          {lines.map((l, li) => {
            const item = l.replace(/^\s*\d+\.\s+/, '')
            return <li key={li}>{inlineMarkdown(item, `${keyBase}-n${bi}-${li}`)}</li>
          })}
        </ol>
      )
    }
    return <p key={`${keyBase}-p${bi}`}>{inlineMarkdown(block, `${keyBase}-p${bi}`)}</p>
  })
}

export function normalizePictures(raw: unknown): QuotePicture[] {
  if (!Array.isArray(raw)) return []
  const out: QuotePicture[] = []
  for (const p of raw) {
    if (typeof p === 'string') {
      const src = p.trim()
      if (src) out.push({ src })
    } else if (p && typeof p === 'object') {
      const pp = p as Record<string, unknown>
      const src = String(pp.src || '').trim()
      if (!src) continue
      const alt = typeof pp.alt === 'string' && pp.alt.trim() ? pp.alt : undefined
      out.push(alt ? { src, alt } : { src })
    }
  }
  return out
}

export function itemLineTotal(it: QuoteItem): number {
  return (Number(it.quantity) || 0) * (Number(it.unitPrice) || 0)
}

export function itemsTotal(opt: QuoteOption): number {
  return (opt.items || []).reduce((s, it) => s + itemLineTotal(it), 0)
}

// Planning — auto-chain items as sequential workday blocks. Weekends and any
// dates in `blocked` are skipped (Belgian holidays + Mac calendar busy days
// flow in via R2). Item.startDate is an optional override; otherwise the next
// available workday after the previous item lands.
export interface PlanRange {
  start: string // yyyy-mm-dd
  end: string   // yyyy-mm-dd, inclusive
  days: number  // workdays the bar covers
}
export interface OptionPlan {
  ranges: (PlanRange | null)[] // aligned 1:1 with option.items
  rangeStart: string // earliest start across all bars
  rangeEnd: string   // latest end across all bars
}

const MONTHS_SHORT = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']

function parseISODate(iso: string): Date | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso.trim())
  if (!m) return null
  const d = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]))
  return Number.isNaN(d.getTime()) ? null : d
}

function formatISODate(d: Date): string {
  const y = d.getFullYear()
  const m = String(d.getMonth() + 1).padStart(2, '0')
  const day = String(d.getDate()).padStart(2, '0')
  return `${y}-${m}-${day}`
}

export function formatPlanDate(iso: string): string {
  const d = parseISODate(iso)
  return d ? `${MONTHS_SHORT[d.getMonth()]} ${d.getDate()}` : iso
}

function isOff(d: Date, blocked: Set<string>): boolean {
  const dow = d.getDay()
  if (dow === 0 || dow === 6) return true
  return blocked.has(formatISODate(d))
}

function ensureWorking(d: Date, blocked: Set<string>): Date {
  const r = new Date(d)
  while (isOff(r, blocked)) r.setDate(r.getDate() + 1)
  return r
}

function addWorkdays(start: Date, days: number, blocked: Set<string>): Date {
  const n = Math.max(1, Math.round(days))
  const r = new Date(start)
  let counted = 1
  while (counted < n) {
    r.setDate(r.getDate() + 1)
    if (!isOff(r, blocked)) counted++
  }
  return r
}

function nextWorking(d: Date, blocked: Set<string>): Date {
  const r = new Date(d)
  do { r.setDate(r.getDate() + 1) } while (isOff(r, blocked))
  return r
}

export function computeOptionPlan(opt: QuoteOption, blockedDays: Set<string> = new Set()): OptionPlan | null {
  if (!opt.startDate) return null
  const base = parseISODate(opt.startDate)
  if (!base) return null
  const items = opt.items || []
  if (items.length === 0) return null

  let cursor = ensureWorking(base, blockedDays)
  const ranges: (PlanRange | null)[] = []
  for (const it of items) {
    const days = Math.max(1, Math.round(Number(it.quantity) || 1))
    if (!it.name.trim()) { ranges.push(null); continue }
    let start: Date
    const override = it.startDate ? parseISODate(it.startDate) : null
    if (override) start = ensureWorking(override, blockedDays)
    else start = cursor
    const end = addWorkdays(start, days, blockedDays)
    ranges.push({ start: formatISODate(start), end: formatISODate(end), days })
    cursor = nextWorking(end, blockedDays)
  }

  const valid = ranges.filter((r): r is PlanRange => r !== null)
  if (valid.length === 0) return null
  let minStart = parseISODate(valid[0].start)!.getTime()
  let maxEnd = parseISODate(valid[0].end)!.getTime()
  for (const r of valid) {
    minStart = Math.min(minStart, parseISODate(r.start)!.getTime())
    maxEnd = Math.max(maxEnd, parseISODate(r.end)!.getTime())
  }
  return {
    ranges,
    rangeStart: formatISODate(new Date(minStart)),
    rangeEnd: formatISODate(new Date(maxEnd)),
  }
}

// Inclusive day count between two yyyy-mm-dd strings.
export function daysBetween(startIso: string, endIso: string): number {
  const s = parseISODate(startIso)
  const e = parseISODate(endIso)
  if (!s || !e) return 0
  return Math.round((e.getTime() - s.getTime()) / (24 * 3600 * 1000)) + 1
}

// One contiguous segment for the gantt: a row of consecutive same-kind blocks
// shown as a single bar. PlanBlocks are coalesced into segments per render.
export interface PlanSegment {
  kind: PlanBlockKind
  itemIndex?: number
  start: string
  end: string
  days: number
  label: string
}

// Build coalesced segments per row from explicitly placed PlanBlocks. Rows
// are: one per item (kind='item' grouped by itemIndex), plus an aggregated
// "Presentation" row and "Feedback" row if blocks of those kinds exist.
// Consecutive calendar days (no gap) within the same row collapse into one
// bar; a one-day gap starts a new bar.
export function buildPlanSegments(option: QuoteOption): {
  rangeStart: string
  rangeEnd: string
  rows: { label: string; segments: PlanSegment[] }[]
} | null {
  const blocks = (option.planBlocks || []).slice().sort((a, b) => a.date.localeCompare(b.date))
  if (blocks.length === 0) return null

  const items = option.items || []
  // Group blocks by row key (item index or kind).
  const groups = new Map<string, { label: string; sortKey: number; blocks: PlanBlock[] }>()
  for (const b of blocks) {
    let key: string
    let label: string
    let sortKey: number
    if (b.kind === 'item' && typeof b.itemIndex === 'number') {
      key = `i${b.itemIndex}`
      const name = items[b.itemIndex]?.name || `Item ${b.itemIndex + 1}`
      label = name
      sortKey = b.itemIndex
    } else if (b.kind === 'presentation') {
      key = 'pres'; label = 'Presentation'; sortKey = 9000
    } else {
      key = 'fb'; label = 'Feedback'; sortKey = 9100
    }
    const existing = groups.get(key)
    if (existing) existing.blocks.push(b)
    else groups.set(key, { label, sortKey, blocks: [b] })
  }

  // Coalesce consecutive-day blocks per row.
  const rows: { label: string; sortKey: number; segments: PlanSegment[] }[] = []
  for (const [, g] of groups) {
    g.blocks.sort((a, b) => a.date.localeCompare(b.date))
    const segments: PlanSegment[] = []
    let cur: { start: string; end: string; days: number; kind: PlanBlockKind; itemIndex?: number } | null = null
    for (const b of g.blocks) {
      if (!cur) {
        cur = { start: b.date, end: b.date, days: 1, kind: b.kind, itemIndex: b.itemIndex }
        continue
      }
      const prev = parseISODate(cur.end)!
      const next = parseISODate(b.date)!
      const gap = Math.round((next.getTime() - prev.getTime()) / (24 * 3600 * 1000))
      if (gap === 1 && b.kind === cur.kind && b.itemIndex === cur.itemIndex) {
        cur.end = b.date
        cur.days++
      } else {
        segments.push({ ...cur, label: g.label })
        cur = { start: b.date, end: b.date, days: 1, kind: b.kind, itemIndex: b.itemIndex }
      }
    }
    if (cur) segments.push({ ...cur, label: g.label })
    rows.push({ label: g.label, sortKey: g.sortKey, segments })
  }
  rows.sort((a, b) => a.sortKey - b.sortKey)

  const allStarts = blocks.map((b) => b.date).sort()
  return {
    rangeStart: allStarts[0],
    rangeEnd: allStarts[allStarts.length - 1],
    rows: rows.map((r) => ({ label: r.label, segments: r.segments })),
  }
}

// Footnotes are fixed (not editable in the CMS). The public page
// renders these per the selected license model, with tokens filled in.
export const DEFAULT_FOOTNOTE_ANNUAL =
  '*The annual license grants the client full usage rights across print, digital, and environmental applications. The first year is included at {firstYear}.\n*Thereafter the license renews at {annual} per year. The annual license may be converted into a perpetual, all-inclusive usage license at any time for {design}. Previously paid annual license fees will be credited against this, up to a maximum of {creditMax}. All prices exclude VAT.'

export const DEFAULT_FOOTNOTE_PERPETUAL =
  '*The perpetual license grants the client full, unlimited usage rights across print, digital, and environmental applications. It comprises the design cost plus a one-time license fee of 50% of the design cost, totalling {perpetual}. All prices exclude VAT.'

export function emptyOption(n: number): QuoteOption {
  return {
    title: `Option ${n}`,
    description: '',
    assets: [],
    items: [],
    pictures: [],
  }
}

function assetIsEmpty(a: QuoteAsset): boolean {
  return !a.name.trim() && !a.variable.trim() && (Number(a.price) || 0) === 0 && a.styles.length === 0
}

function itemIsEmpty(it: QuoteItem): boolean {
  return !it.name.trim() && !it.description.trim() && !it.unit.trim() && (Number(it.unitPrice) || 0) === 0
}

export function emptyQuote(): Quote {
  const today = new Date().toISOString().slice(0, 10)
  const next = new Date()
  next.setDate(next.getDate() + 30)
  return {
    slug: '',
    project: '',
    date: today,
    validThrough: next.toISOString().slice(0, 10),
    options: [emptyOption(1)],
    pictures: [],
  }
}

export function normalizeQuote(raw: unknown): Quote | null {
  if (!raw || typeof raw !== 'object') return null
  const q = raw as Record<string, unknown>
  // Fall back to a project-derived slug so a quote with only a project
  // name still persists and gets a working URL.
  const slug = slugify(String(q.slug || '')) || slugify(String(q.project || ''))
  if (!slug) return null
  const optionsRaw = Array.isArray(q.options) ? q.options : []
  const options: QuoteOption[] = optionsRaw.map((o) => {
    const oo = (o || {}) as Record<string, unknown>
    const assetsRaw = Array.isArray(oo.assets) ? oo.assets : []
    const assets: QuoteAsset[] = assetsRaw.map((a) => {
      const aa = (a || {}) as Record<string, unknown>
      return {
        name: String(aa.name || ''),
        variable: String(aa.variable || ''),
        price: Number(aa.price) || 0,
        offersItalic: aa.offersItalic === undefined ? true : Boolean(aa.offersItalic),
        styles: Array.isArray(aa.styles)
          ? aa.styles.map(String).map((s) => s.trim()).filter(Boolean)
          : [],
        pictures: normalizePictures(aa.pictures),
      }
    })
    const itemsRaw = Array.isArray(oo.items) ? oo.items : []
    const items: QuoteItem[] = itemsRaw.map((it) => {
      const ii = (it || {}) as Record<string, unknown>
      const qRaw = ii.quantity
      const quantity = qRaw === undefined || qRaw === null || qRaw === ''
        ? 1
        : Number(qRaw) || 0
      const startDate = typeof ii.startDate === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(ii.startDate.trim())
        ? ii.startDate.trim()
        : undefined
      return {
        name: String(ii.name || ''),
        description: String(ii.description || ''),
        unit: String(ii.unit || ''),
        quantity,
        unitPrice: Number(ii.unitPrice) || 0,
        pictures: normalizePictures(ii.pictures),
        ...(startDate ? { startDate } : {}),
      }
    })
    const optStartDate = typeof oo.startDate === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(oo.startDate.trim())
      ? oo.startDate.trim()
      : undefined
    const presentationDays = Number(oo.presentationDays)
    const feedbackDays = Number(oo.feedbackDays)
    const planBlocksRaw = Array.isArray(oo.planBlocks) ? oo.planBlocks : []
    const planBlocks: PlanBlock[] = planBlocksRaw.flatMap((b) => {
      const bb = (b || {}) as Record<string, unknown>
      const date = typeof bb.date === 'string' ? bb.date.trim() : ''
      if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return []
      const kind = bb.kind === 'presentation' || bb.kind === 'feedback' ? bb.kind : 'item'
      const id = typeof bb.id === 'string' && bb.id.trim() ? bb.id.trim() : `pb-${Math.random().toString(36).slice(2, 10)}`
      const itemIndex = typeof bb.itemIndex === 'number' && bb.itemIndex >= 0 ? bb.itemIndex : undefined
      return [{ id, kind, date, ...(itemIndex !== undefined ? { itemIndex } : {}) }]
    })
    return {
      title: String(oo.title || ''),
      description: String(oo.description || ''),
      assets: assets.filter((a) => !assetIsEmpty(a)),
      items: items.filter((it) => !itemIsEmpty(it)),
      pictures: normalizePictures(oo.pictures),
      ...(optStartDate ? { startDate: optStartDate } : {}),
      ...(presentationDays > 0 ? { presentationDays: Math.round(presentationDays) } : {}),
      ...(feedbackDays > 0 ? { feedbackDays: Math.round(feedbackDays) } : {}),
      ...(planBlocks.length > 0 ? { planBlocks } : {}),
    }
  })
  return {
    slug,
    project: String(q.project || ''),
    date: String(q.date || ''),
    validThrough: String(q.validThrough || ''),
    options,
    pictures: normalizePictures(q.pictures),
  }
}
