// Universal typeface estimate — pure pricing logic for the self-service
// calculator at /estimate. Separate from the hand-authored quote system
// (lib/quote.tsx): this produces an *indicative* figure from a handful of
// spec choices, nothing is stored, and it never mints a binding quote.
//
// All rates live in CONFIG below and are meant to be tuned. The model is a
// creation fee (design labour, in real days at the day rate — a hard floor)
// times a rights factor (licence/ownership premium, the only part company size
// and covered media touch). See CONFIG for the full note.

// Two-part model (mirrors how the market actually prices custom type):
//   1. CREATION FEE  — the design labour, priced in real days at the day rate.
//      Never discounted by who's licensing it, so a quote can't fall below the
//      work it costs to make.
//   2. RIGHTS FACTOR — a multiple of the creation fee for the licence/ownership
//      (buyout ≈ 2× the non-exclusive rate — "double to own"), scaled by
//      company size and covered media. This is the only part size/media touch.
//   total = creationFee × rightsFactor      (annual total = first year)
export const CONFIG = {
  DAY_RATE: 600, // €/day, excl. VAT — the creation fee is grounded in this
  STUDIO_BASE: 1500, // fixed per-project overhead (kickoff, proofs, spacing/test setup)
  DAYS_PER_MASTER: 8, // drawn corner master
  DAYS_PER_INSTANCE: 1.5, // each extra interpolated style
  WORKDAYS_PER_WEEK: 5,
  // Time multipliers. Oblique is free (mechanical); a true italic ~doubles the
  // work. Uppercase-only is far fewer glyphs, so less time (and less cost).
  SLANT_TIME: { none: 1, oblique: 1, italic: 1.8 } as Record<Slant, number>,
  CHARSET_MULT: { uppercase: 0.65, full: 1 } as Record<CharacterSet, number>,
  // Rights premium as a multiple of the creation fee, at the reference (mid
  // company, desktop). Non-exclusive annual barely above cost; buyout ≈ 2× the
  // non-exclusive rate (ownership premium, per Bruno Maag / Elder ladder).
  LICENSE_PREMIUM: { annual: 1.1, term2y: 1.6, buyout: 2.2 } as Record<Licensing, number>,
  // Company size scales the RIGHTS premium only (never the creation fee), so
  // smaller clients pay a smaller premium but the design labour is always met.
  SIZE_TIER: { solo: 0.5, small: 0.8, mid: 1.0, large: 1.3, enterprise: 2.5 } as Record<CompanySize, number>,
  // Desktop is the included base (scope starts at 1); each extra medium is a
  // small surcharge on the premium, capped by SCOPE_CAP.
  MEDIA_INCREMENT: { desktop: 0, web: 0.05, app: 0.07, broadcast: 0.12, logo: 0.08 } as Record<Medium, number>,
  // Bulk media deal: select this many blocks (the always-on desktop counts as
  // one) and ALL media are included, charged only for the priciest optional
  // blocks among the three (desktop is free) — so the rest come free.
  MEDIA_BUNDLE_THRESHOLD: 3,
  SCOPE_CAP: 1.35, // media scope ceiling (1 + Σ increments, capped)
  RIGHTS_FACTOR_CAP: 4.0, // ceiling on the total creation multiple (bounds enterprise buyouts)
  // Yearly renewal (annual option, and the 2-year term after it expires) as a
  // fraction of the creation fee — a gentle ongoing rate that scales with size.
  RENEWAL_RATE: { solo: 0.06, small: 0.08, mid: 0.10, large: 0.12, enterprise: 0.15 } as Record<CompanySize, number>,
  RUSH_SURCHARGE: 0.25, // added to the total when the deadline beats estimated production
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

// Estimated production effort, in workdays: drawn corner masters + each extra
// interpolated instance, then slant (italic ~doubles) and charset (uppercase =
// fewer glyphs) factors. Families come out cheaper per weight because the
// middles interpolate — matching how the market prices per master.
export function estimateWorkdays(spec: EstimateSpec): number {
  const masters = computeMasters(spec.weights, spec.widths)
  const extra = Math.max(0, computeInstances(spec.weights, spec.widths) - masters)
  const slant = CONFIG.SLANT_TIME[spec.slant] ?? 1
  const charset = CONFIG.CHARSET_MULT[spec.charset] ?? 1
  return Math.ceil((masters * CONFIG.DAYS_PER_MASTER + extra * CONFIG.DAYS_PER_INSTANCE) * slant * charset)
}

export function estimateWeeks(spec: EstimateSpec): number {
  return Math.ceil(estimateWorkdays(spec) / CONFIG.WORKDAYS_PER_WEEK)
}

// Creation fee — the design labour, in euros. Grounded in real days at the day
// rate (plus fixed project overhead), so it is a hard floor: no licensing
// choice can price the work below what it costs to make.
export function creationFee(spec: EstimateSpec): number {
  return CONFIG.STUDIO_BASE + estimateWorkdays(spec) * CONFIG.DAY_RATE
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

// The rights premium as a multiple of the creation fee. At the reference (mid
// company, desktop) it equals LICENSE_PREMIUM for the chosen option. Company
// size and covered media scale ONLY the premium above 1× — so the factor never
// drops below 1 and the creation fee is always fully met. Capped so an
// enterprise buyout can't run away.
export function rightsFactor(spec: EstimateSpec): number {
  const premium = CONFIG.LICENSE_PREMIUM[spec.licensing] ?? 1
  const size = CONFIG.SIZE_TIER[spec.size] ?? 1
  const scope = Math.min(CONFIG.SCOPE_CAP, 1 + mediaScopeIncrement(spec.media))
  const factor = 1 + (premium - 1) * size * scope
  return Math.min(CONFIG.RIGHTS_FACTOR_CAP, factor)
}

// Headline figure for the chosen licensing option, before any rush surcharge:
// the creation fee times the rights factor. Buyout and 2-year term are
// one-time; annual is the first-year figure (renewal is separate).
export function licensingTotal(spec: EstimateSpec): number {
  return creationFee(spec) * rightsFactor(spec)
}

// Yearly renewal (annual option, and the 2-year term after it expires): a
// gentle fraction of the creation fee, scaled by company size.
export function annualRenewal(spec: EstimateSpec): number {
  return creationFee(spec) * (CONFIG.RENEWAL_RATE[spec.size] ?? 0.1)
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
