// Quote feature — shared types and pricing logic.
// Used by the admin editor, the public /quote/[name] page, and the API.
//
// Pricing model (per option):
//   design cost  D  = sum of all asset prices entered in the CMS
//   ANNUAL       = D + 50% license surplus = D * 1.5, recurring per year
//   PERPETUAL    = D upfront (first year of use included),
//                  then 1/3 of D per year after the first year

export type LicenseModel = 'annual' | 'perpetual'

export interface QuoteAsset {
  name: string // "Display Typeface"
  variable: string // "1 Axis"
  price: number // design-cost component, EUR
  offersItalic: boolean // if true, client can pick Italic (+70% of this asset's price); Oblique is the free default
  styles: string[] // ["400 Regular (+Oblique)", …, "Variable"]
}

// Italic upgrade adds 70% of the asset's own price. Oblique is free.
export const ITALIC_SURCHARGE = 0.7

export function assetEffectivePrice(a: QuoteAsset, italic: boolean): number {
  const base = Number(a.price) || 0
  return italic ? base + base * ITALIC_SURCHARGE : base
}

export interface QuoteOption {
  title: string // "Option 1"
  description: string
  assets: QuoteAsset[]
  footnoteAnnual: string
  footnotePerpetual: string
}

export interface Quote {
  slug: string // URL: /quote/<slug>
  project: string // "MirrorMirror Sports Pitch"
  date: string // ISO yyyy-mm-dd
  validThrough: string // ISO yyyy-mm-dd
  options: QuoteOption[]
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

export function annualTotal(d: number): number {
  return Math.round(d * 1.5)
}

export function perpetualUpfront(d: number): number {
  return Math.round(d)
}

export function perpetualYearly(d: number): number {
  return Math.round(d / 3)
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
// {design} {annual} {perpetual} {perpetualYearly} and get the live,
// formatted amounts for the option.
export function fillTokens(text: string, d: number): string {
  return text
    .replace(/\{design\}/g, formatEur(d))
    .replace(/\{annual\}/g, formatEur(annualTotal(d)))
    .replace(/\{perpetualYearly\}/g, formatEur(perpetualYearly(d)))
    .replace(/\{perpetual\}/g, formatEur(perpetualUpfront(d)))
}

export function emptyAsset(): QuoteAsset {
  return { name: '', variable: '', price: 0, offersItalic: true, styles: [] }
}

export function emptyOption(n: number): QuoteOption {
  return {
    title: `Option ${n}`,
    description: '',
    assets: [emptyAsset()],
    footnoteAnnual:
      '*The annual license grants the client full usage rights across print, digital, and environmental applications for one year.\n*The license can be renewed annually at {annual} per year. The annual license may be converted into a perpetual, all-inclusive usage license at any time. All prices exclude VAT.',
    footnotePerpetual:
      '*The perpetual license grants the client full usage rights across print, digital, and environmental applications. The first year is included; thereafter {perpetualYearly} per year. All prices exclude VAT.',
  }
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
        styles: Array.isArray(aa.styles) ? aa.styles.map(String) : [],
      }
    })
    return {
      title: String(oo.title || ''),
      description: String(oo.description || ''),
      assets,
      footnoteAnnual: String(oo.footnoteAnnual || ''),
      footnotePerpetual: String(oo.footnotePerpetual || ''),
    }
  })
  return {
    slug,
    project: String(q.project || ''),
    date: String(q.date || ''),
    validThrough: String(q.validThrough || ''),
    options,
  }
}
