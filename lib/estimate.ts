// Universal typeface estimate — pure pricing logic for the self-service
// calculator at /estimate. Separate from the hand-authored quote system
// (lib/quote.tsx): this produces an *indicative* figure from a handful of
// spec choices, nothing is stored, and it never mints a binding quote.
//
// All rates live in CONFIG below. These are first-pass defaults derived from
// the €600/day rate and the €2,400 annual / €7,200 perpetual per-style
// figures — calibrate them against real past quotes; that's the point of
// keeping them in one place.

export const CONFIG = {
  MASTER_RATE: 3000, // per drawn corner master (EUR, design work)
  INSTANCE_RATE: 400, // per extra interpolated weight×width instance
  SLANT_MULT: { none: 1, oblique: 1.15, italic: 1.8 } as Record<Slant, number>,
  SIZE_TIER: { solo: 1, small: 1.4, mid: 2, large: 3, enterprise: 4.5 } as Record<CompanySize, number>,
  // Desktop is always included; scope multiplier is floored at 1 (see licenseMultiplier).
  MEDIA: { desktop: 1, web: 0.5, app: 0.75, broadcast: 1, logo: 0.6 } as Record<Medium, number>,
  PERP_LICENSE_RATE: 0.5, // perpetual license fee = designWork × 0.5 × licenseMultiplier
  ANNUAL_LICENSE_RATE: 0.2, // annual recurring = designWork × 0.2 × licenseMultiplier
  DAYS_PER_MASTER: 8,
  DAYS_PER_INSTANCE: 1.5,
  WORKDAYS_PER_WEEK: 5,
  RUSH_SURCHARGE: 0.25, // added to the grand total when the deadline beats estimated production
  RANGE_SPREAD: 0.15, // ± band shown around the indicative figure
}

export type Slant = 'none' | 'oblique' | 'italic'
export type CompanySize = 'solo' | 'small' | 'mid' | 'large' | 'enterprise'
export type Medium = 'desktop' | 'web' | 'app' | 'broadcast' | 'logo'
export type LicenseModel = 'perpetual' | 'annual'

export interface EstimateSpec {
  weights: number
  widths: number
  slant: Slant
  size: CompanySize
  media: Medium[]
  license: LicenseModel
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
  large: { label: 'Large', hint: '51–250' },
  enterprise: { label: 'Enterprise', hint: '250+' },
}

export const MEDIA_ORDER: Medium[] = ['desktop', 'web', 'app', 'broadcast', 'logo']
export const MEDIA_LABELS: Record<Medium, string> = {
  desktop: 'Desktop',
  web: 'Web',
  app: 'App / embedded',
  broadcast: 'Broadcast / video',
  logo: 'Logo / wordmark',
}

export function defaultSpec(): EstimateSpec {
  return { weights: 3, widths: 1, slant: 'none', size: 'small', media: ['desktop'], license: 'perpetual' }
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

// Production/design work: drawn corner masters at the full rate, every extra
// interpolated instance at the cheaper per-instance rate, then scaled by the
// slant multiplier (a true italic is a second set of drawings; oblique is a
// mechanical slant with light cleanup).
export function designWork(spec: EstimateSpec): number {
  const masters = computeMasters(spec.weights, spec.widths)
  const instances = computeInstances(spec.weights, spec.widths)
  const extra = Math.max(0, instances - masters)
  const base = CONFIG.MASTER_RATE * masters + CONFIG.INSTANCE_RATE * extra
  return base * (CONFIG.SLANT_MULT[spec.slant] ?? 1)
}

// License scaling from who's using it and where. Media scope is floored at 1
// (desktop-only baseline) so a narrow selection never discounts below base.
export function licenseMultiplier(spec: EstimateSpec): number {
  const tier = CONFIG.SIZE_TIER[spec.size] ?? 1
  const scope = spec.media.reduce((s, m) => s + (CONFIG.MEDIA[m] ?? 0), 0)
  return tier * Math.max(1, scope)
}

// One-time buyout: design work plus a license fee scaled by company + media.
export function perpetualTotal(spec: EstimateSpec): number {
  const d = designWork(spec)
  return d * (1 + CONFIG.PERP_LICENSE_RATE * licenseMultiplier(spec))
}

// Annual, first year: design work (paid once) plus the first year's license.
export function annualFirstYear(spec: EstimateSpec): number {
  const d = designWork(spec)
  return d + d * CONFIG.ANNUAL_LICENSE_RATE * licenseMultiplier(spec)
}

// Annual, each following year: the recurring license only.
export function annualYearly(spec: EstimateSpec): number {
  return designWork(spec) * CONFIG.ANNUAL_LICENSE_RATE * licenseMultiplier(spec)
}

// Estimated production effort, in workdays, from masters + extra instances.
export function estimateWorkdays(spec: EstimateSpec): number {
  const masters = computeMasters(spec.weights, spec.widths)
  const extra = Math.max(0, computeInstances(spec.weights, spec.widths) - masters)
  const slantFactor = spec.slant === 'italic' ? 1.8 : spec.slant === 'oblique' ? 1.1 : 1
  return Math.ceil((masters * CONFIG.DAYS_PER_MASTER + extra * CONFIG.DAYS_PER_INSTANCE) * slantFactor)
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

// Selected-license total, with the rush surcharge folded in when applicable.
// For annual, "total" is the first-year figure (what the headline shows).
export function grandTotal(spec: EstimateSpec, now: Date = new Date()): number {
  const base = spec.license === 'perpetual' ? perpetualTotal(spec) : annualFirstYear(spec)
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
