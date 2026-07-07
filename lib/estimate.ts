// Universal typeface estimate — pure pricing logic for the self-service
// calculator at /estimate. Separate from the hand-authored quote system
// (lib/quote.tsx): this produces an *indicative* figure from a handful of
// spec choices, nothing is stored, and it never mints a binding quote.
//
// All rates live in CONFIG below. These are first-pass defaults derived from
// the €600/day rate and the €2,400 annual / €7,200 perpetual per-style
// figures — calibrate them against real past quotes; that's the point of
// keeping them in one place.

// Calibrated so a baseline spec (small company, desktop) lands near the real
// package prices on an actual quote (mirrormirror: €5,400 single style →
// €15,000 full 2-axis family). Base design cost D drives the license math
// exactly as lib/quote.tsx does: perpetual = 1.5·D, annual first year = D,
// renews at D/6, convert for D crediting up to 2/3·D.
export const CONFIG = {
  BASE_DESIGN: 3700, // studio baseline / first style (EUR)
  MASTER_RATE: 1800, // per effective (tapered) style-unit of the design space
  // Weights/widths taper: each added axis value costs less than the last
  // (interpolation is cheap), so a big family plateaus instead of running away.
  WEIGHT_DECAY: 0.72, // each extra weight adds ~72% of the previous one
  WIDTH_DECAY: 0.85, // widths taper slower (each ~ a fresh master set)
  // Oblique is a mechanical slant, standard-included at no cost. Only a true
  // (separately drawn) italic set adds to the design cost.
  SLANT_MULT: { none: 1, oblique: 1, italic: 1.8 } as Record<Slant, number>,
  // Character set. Full Western European is the reference (×1); an uppercase-
  // only set is far fewer glyphs, so it's cheaper.
  CHARSET_MULT: { uppercase: 0.65, full: 1 } as Record<CharacterSet, number>,
  // Company-size license tiers. Solo/small/mid sit below the reference rate so
  // smaller clients pay noticeably less; large is a modest premium and
  // enterprise (1000+ staff, real corporates) a real one — foundries scale the
  // license hard for big companies, so enterprise steps up well above large.
  SIZE_TIER: { solo: 0.5, small: 0.8, mid: 1.0, large: 1.3, enterprise: 2.5 } as Record<CompanySize, number>,
  // Desktop is the included base (scope starts at 1); each extra medium is just
  // a small surcharge (a few % each), capped by SCOPE_CAP so covered media
  // never ramps the price up hard.
  MEDIA_INCREMENT: { desktop: 0, web: 0.05, app: 0.07, broadcast: 0.12, logo: 0.08 } as Record<Medium, number>,
  // Bulk media deal: select this many blocks (the always-on desktop counts as
  // one) and ALL media are included, charged only for the priciest optional
  // blocks among the three (desktop is free) — so the rest come free.
  MEDIA_BUNDLE_THRESHOLD: 3,
  SCOPE_CAP: 1.35, // media scope ceiling (1 + Σ increments, capped)
  MULT_CAP: 3.25, // overall license-multiplier ceiling (size × scope) — high enough that enterprise + media isn't clipped early
  // Licensing options (exclusivity + duration merged into one coherent set):
  LICENSE_BUYOUT_MULT: 1.5, // exclusive buyout, one-time = D × 1.5
  LICENSE_TERM2Y_MULT: 1.0, // 2-year exclusive term, one-time (~2/3 of the buyout)
  LICENSE_ANNUAL_FIRST: 0.8, // non-exclusive annual, first year = D × 0.8
  // Yearly renewal = D / divisor (for the annual option and the 2-year term
  // after it expires). Smaller clients get a gentler rate (D/12 ≈ 8%/yr);
  // large/enterprise D/10 (~10%/yr).
  ANNUAL_YEARLY_DIVISOR: { solo: 12, small: 12, mid: 12, large: 10, enterprise: 10 } as Record<CompanySize, number>,
  DAYS_PER_MASTER: 8,
  DAYS_PER_INSTANCE: 1.5,
  WORKDAYS_PER_WEEK: 5,
  RUSH_SURCHARGE: 0.25, // added to the grand total when the deadline beats estimated production
  RANGE_SPREAD: 0.15, // ± band shown around the indicative figure
}

export type Slant = 'none' | 'oblique' | 'italic'
export type CompanySize = 'solo' | 'small' | 'mid' | 'large' | 'enterprise'
export type Medium = 'desktop' | 'web' | 'app' | 'broadcast' | 'logo'
export type CharacterSet = 'uppercase' | 'full'
// Exclusivity and duration merged into one coherent licensing choice.
export type Licensing = 'buyout' | 'term2y' | 'annual'

export interface EstimateSpec {
  weights: number
  widths: number
  slant: Slant
  charset: CharacterSet
  size: CompanySize
  media: Medium[]
  licensing: Licensing
  deadline?: string // yyyy-mm-dd, optional
}

// Bounds the UI enforces; also used to clamp values parsed from the URL.
export const WEIGHTS_MIN = 1
export const WEIGHTS_MAX = 9
export const WIDTHS_MIN = 1
export const WIDTHS_MAX = 3

export const SIZE_ORDER: CompanySize[] = ['solo', 'small', 'mid', 'large', 'enterprise']
export const SIZE_LABELS: Record<CompanySize, { label: string; hint: string }> = {
  solo: { label: 'Solo', hint: '1 person' },
  small: { label: 'Small', hint: '2–10' },
  mid: { label: 'Mid', hint: '11–50' },
  large: { label: 'Large', hint: '51–1000' },
  enterprise: { label: 'Enterprise', hint: '1000+' },
}

export const MEDIA_ORDER: Medium[] = ['desktop', 'web', 'app', 'broadcast', 'logo']
export const MEDIA_LABELS: Record<Medium, string> = {
  desktop: 'Desktop',
  web: 'Web',
  app: 'App / embedded',
  broadcast: 'Broadcast / video',
  logo: 'Logo / wordmark',
}

export const CHARSET_ORDER: CharacterSet[] = ['full', 'uppercase']
export const CHARSET_LABELS: Record<CharacterSet, string> = {
  full: 'Full Western European',
  uppercase: 'Uppercase Western European',
}

export const LICENSING_ORDER: Licensing[] = ['buyout', 'term2y', 'annual']
export const LICENSING_LABELS: Record<Licensing, { label: string; hint: string }> = {
  buyout: { label: 'Exclusive buyout', hint: 'one-time, yours alone' },
  term2y: { label: '2-year exclusive', hint: 'term, exclusive 2 yrs' },
  annual: { label: 'Non-exclusive', hint: 'annual, others may license' },
}

export function defaultSpec(): EstimateSpec {
  return {
    weights: 3, widths: 1, slant: 'none', charset: 'full',
    size: 'small', media: ['desktop'], licensing: 'buyout',
  }
}

function clamp(n: number, lo: number, hi: number): number {
  if (!Number.isFinite(n)) return lo
  return Math.min(hi, Math.max(lo, Math.round(n)))
}

// Corner-master model: a variable design space is drawn at its extremes and
// interpolated between them. One value on an axis contributes no extra corner,
// two-or-more contributes a factor of 2. So 1×1 → 1, N×1 → 2, N×M → 4.
export function computeMasters(weights: number, widths: number): number {
  const w = clamp(weights, WEIGHTS_MIN, WEIGHTS_MAX)
  const d = clamp(widths, WIDTHS_MIN, WIDTHS_MAX)
  return (w > 1 ? 2 : 1) * (d > 1 ? 2 : 1)
}

// Total named styles the client ends up with (before any slant duplication).
export function computeInstances(weights: number, widths: number): number {
  const w = clamp(weights, WEIGHTS_MIN, WEIGHTS_MAX)
  const d = clamp(widths, WIDTHS_MIN, WIDTHS_MAX)
  return w * d
}

// Diminishing geometric sum: 1 + decay + decay² + … + decay^(n-1). n=1 → 1,
// and it asymptotes to 1/(1-decay), so adding more axis values can never make
// the price run away — it plateaus.
export function taperedUnits(n: number, decay: number): number {
  const count = Math.max(0, Math.floor(n))
  if (count <= 0) return 0
  if (decay >= 1) return count
  return (1 - Math.pow(decay, count)) / (1 - decay)
}

// Pure production/design work before any license scaling: a studio baseline
// plus a tapered 2-D design space (weights × widths, each axis with its own
// diminishing marginal cost), scaled by the slant multiplier (a true italic is
// a second set of drawings; oblique is free).
export function designWork(spec: EstimateSpec): number {
  const units = taperedUnits(spec.weights, CONFIG.WEIGHT_DECAY) * taperedUnits(spec.widths, CONFIG.WIDTH_DECAY)
  const base = CONFIG.BASE_DESIGN + CONFIG.MASTER_RATE * units
  return base
    * (CONFIG.SLANT_MULT[spec.slant] ?? 1)
    * (CONFIG.CHARSET_MULT[spec.charset] ?? 1)
}

// The optional (chargeable) media — everything except the always-included
// desktop base.
const OPTIONAL_MEDIA: Medium[] = MEDIA_ORDER.filter((m) => m !== 'desktop')

// True once enough blocks are picked to trigger the bulk deal. Desktop is
// always on and counts as one of the blocks, so the threshold is reached with
// (threshold − 1) optional media selected.
export function mediaBundleActive(media: Medium[]): boolean {
  const optional = media.filter((m) => m !== 'desktop').length
  return optional + 1 >= CONFIG.MEDIA_BUNDLE_THRESHOLD
}

// The media actually covered by the license: the picks, or ALL media once the
// bulk threshold is hit (that's the "everything lights up" behaviour).
export function coveredMedia(media: Medium[]): Medium[] {
  return mediaBundleActive(media) ? [...OPTIONAL_MEDIA] : OPTIONAL_MEDIA.filter((m) => media.includes(m))
}

// Scope increment from covered media. Under the threshold it's the sum of the
// picked increments; at/over it, all media are included but only the priciest
// N (= threshold) blocks are charged, so the rest are free.
export function mediaScopeIncrement(media: Medium[]): number {
  if (mediaBundleActive(media)) {
    // Desktop fills one of the three slots for free; charge the priciest
    // optional blocks that fill the rest.
    const paid = Math.max(0, CONFIG.MEDIA_BUNDLE_THRESHOLD - 1)
    const top = OPTIONAL_MEDIA.map((m) => CONFIG.MEDIA_INCREMENT[m])
      .sort((a, b) => b - a)
      .slice(0, paid)
    return top.reduce((s, x) => s + x, 0)
  }
  return OPTIONAL_MEDIA.filter((m) => media.includes(m)).reduce((s, m) => s + CONFIG.MEDIA_INCREMENT[m], 0)
}

// License scaling from who's using it and where. Company size sets the tier;
// covered media adds scope on top of the desktop-included base (×1). Both the
// media scope and the size×scope product are capped so the license can't
// compound out of control.
export function licenseMultiplier(spec: EstimateSpec): number {
  const tier = CONFIG.SIZE_TIER[spec.size] ?? 1
  const scope = Math.min(CONFIG.SCOPE_CAP, 1 + mediaScopeIncrement(spec.media))
  return Math.min(CONFIG.MULT_CAP, tier * scope)
}

// The effective design cost D that the license formulas run on: the raw
// design work scaled by company + media. Mirrors the role of design cost in
// lib/quote.tsx, extended with the two new pricing axes.
export function effectiveDesignCost(spec: EstimateSpec): number {
  return designWork(spec) * licenseMultiplier(spec)
}

// Headline figure for the chosen licensing option, before any rush surcharge.
// Buyout and 2-year term are one-time; annual is the first-year figure (with a
// separate yearly renewal, see annualRenewal).
export function licensingTotal(spec: EstimateSpec): number {
  const d = effectiveDesignCost(spec)
  switch (spec.licensing) {
    case 'buyout': return d * CONFIG.LICENSE_BUYOUT_MULT
    case 'term2y': return d * CONFIG.LICENSE_TERM2Y_MULT
    case 'annual': return d * CONFIG.LICENSE_ANNUAL_FIRST
  }
}

// Non-exclusive annual: cost of each year after the first (D / 6). Only
// meaningful when licensing === 'annual'.
export function annualRenewal(spec: EstimateSpec): number {
  return effectiveDesignCost(spec) / (CONFIG.ANNUAL_YEARLY_DIVISOR[spec.size] ?? 10)
}

// Estimated production effort, in workdays, from masters + extra instances.
export function estimateWorkdays(spec: EstimateSpec): number {
  const masters = computeMasters(spec.weights, spec.widths)
  const extra = Math.max(0, computeInstances(spec.weights, spec.widths) - masters)
  // Oblique adds no time (auto-generated); a true italic ~doubles the work.
  const slantFactor = spec.slant === 'italic' ? 1.8 : 1
  // Uppercase-only is far fewer glyphs → less production time.
  const charsetFactor = CONFIG.CHARSET_MULT[spec.charset] ?? 1
  return Math.ceil((masters * CONFIG.DAYS_PER_MASTER + extra * CONFIG.DAYS_PER_INSTANCE) * slantFactor * charsetFactor)
}

export function estimateWeeks(spec: EstimateSpec): number {
  return Math.ceil(estimateWorkdays(spec) / CONFIG.WORKDAYS_PER_WEEK)
}

function parseISO(iso: string): Date | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso.trim())
  if (!m) return null
  const d = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]))
  return Number.isNaN(d.getTime()) ? null : d
}

// Rush when a deadline is set and lands before we could realistically finish
// (estimated calendar weeks from `now`). `now` is injectable for testing;
// defaults to the current date in the browser.
export function isRush(spec: EstimateSpec, now: Date = new Date()): boolean {
  if (!spec.deadline) return false
  const target = parseISO(spec.deadline)
  if (!target) return false
  const earliest = new Date(now)
  earliest.setDate(earliest.getDate() + estimateWeeks(spec) * 7)
  return target.getTime() < earliest.getTime()
}

// Headline total for the chosen licensing option, with the rush surcharge
// folded in when applicable. For annual this is the first-year figure.
export function grandTotal(spec: EstimateSpec, now: Date = new Date()): number {
  const base = licensingTotal(spec)
  return isRush(spec, now) ? base * (1 + CONFIG.RUSH_SURCHARGE) : base
}

export function estimateRange(total: number): { low: number; high: number } {
  return { low: total * (1 - CONFIG.RANGE_SPREAD), high: total * (1 + CONFIG.RANGE_SPREAD) }
}

// Round to a sensible presentation figure (nearest €100) so an indicative
// number doesn't read as precise. Copy of lib/quote.tsx's formatter, kept
// local so this module carries no React dependency.
export function roundEur(n: number): number {
  return Math.round(n / 100) * 100
}

export function formatEur(n: number): string {
  return `€ ${roundEur(n).toLocaleString('de-DE')} EUR`
}
