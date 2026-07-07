'use client'

import { useEffect, useState } from 'react'
import {
  type EstimateSpec,
  type Slant,
  type CompanySize,
  type Medium,
  type LicenseModel,
  type CharacterSet,
  type Exclusivity,
  WEIGHTS_MIN,
  WEIGHTS_MAX,
  WIDTHS_MIN,
  WIDTHS_MAX,
  SIZE_ORDER,
  SIZE_LABELS,
  MEDIA_ORDER,
  MEDIA_LABELS,
  CHARSET_ORDER,
  CHARSET_LABELS,
  EXCLUSIVITY_ORDER,
  EXCLUSIVITY_LABELS,
  defaultSpec,
  computeMasters,
  computeInstances,
  annualYearly,
  creditMax,
  grandTotal,
  coveredMedia,
  mediaBundleActive,
  estimateRange,
  estimateWeeks,
  isRush,
  formatEur,
  CONFIG,
} from '@/lib/estimate'

const SLANTS: { value: Slant; label: string }[] = [
  { value: 'none', label: 'Upright only' },
  { value: 'oblique', label: 'Oblique' },
  { value: 'italic', label: 'Italic' },
]

// ---- URL <-> spec ---------------------------------------------------------
// The whole spec lives in the query string so a client can share the exact
// configuration. Values are clamped on the way in so a hand-edited URL can't
// produce an out-of-range spec.

function clampInt(raw: string | null, lo: number, hi: number, fallback: number): number {
  if (raw === null) return fallback
  const n = Number(raw)
  if (!Number.isFinite(n)) return fallback
  return Math.min(hi, Math.max(lo, Math.round(n)))
}

function specFromParams(qs: string): EstimateSpec {
  const p = new URLSearchParams(qs)
  const base = defaultSpec()
  if (!qs) return base

  const slant = (['none', 'oblique', 'italic'] as Slant[]).includes(p.get('slant') as Slant)
    ? (p.get('slant') as Slant)
    : base.slant
  const charset = CHARSET_ORDER.includes(p.get('cs') as CharacterSet)
    ? (p.get('cs') as CharacterSet)
    : base.charset
  const exclusivity = EXCLUSIVITY_ORDER.includes(p.get('excl') as Exclusivity)
    ? (p.get('excl') as Exclusivity)
    : base.exclusivity
  const size = SIZE_ORDER.includes(p.get('size') as CompanySize)
    ? (p.get('size') as CompanySize)
    : base.size
  const license: LicenseModel = p.get('license') === 'annual' ? 'annual' : 'perpetual'
  const mediaRaw = (p.get('media') || '').split(',').map((m) => m.trim()) as Medium[]
  const media = MEDIA_ORDER.filter((m) => mediaRaw.includes(m))
  const deadline = /^\d{4}-\d{2}-\d{2}$/.test(p.get('deadline') || '') ? p.get('deadline')! : undefined

  return {
    weights: clampInt(p.get('w'), WEIGHTS_MIN, WEIGHTS_MAX, base.weights),
    widths: clampInt(p.get('d'), WIDTHS_MIN, WIDTHS_MAX, base.widths),
    slant,
    charset,
    exclusivity,
    size,
    media: media.includes('desktop') ? media : (['desktop', ...media] as Medium[]),
    license,
    ...(deadline ? { deadline } : {}),
  }
}

function paramsFromSpec(spec: EstimateSpec): string {
  const p = new URLSearchParams()
  p.set('w', String(spec.weights))
  p.set('d', String(spec.widths))
  p.set('slant', spec.slant)
  p.set('cs', spec.charset)
  p.set('excl', spec.exclusivity)
  p.set('size', spec.size)
  p.set('media', spec.media.join(','))
  p.set('license', spec.license)
  if (spec.deadline) p.set('deadline', spec.deadline)
  return p.toString()
}

// ---- small UI atoms -------------------------------------------------------

function Stepper({
  label, hint, value, min, max, onChange,
}: { label: string; hint: string; value: number; min: number; max: number; onChange: (n: number) => void }) {
  return (
    <div className="est-stepper">
      <div className="est-stepper-label">
        <p className="quote-colhead">{label}</p>
        <p className="est-hint">{hint}</p>
      </div>
      <div className="est-stepper-controls">
        <button
          type="button"
          className="pill est-step-btn"
          onClick={() => onChange(Math.max(min, value - 1))}
          disabled={value <= min}
          aria-label={`Fewer ${label.toLowerCase()}`}
        >−</button>
        <span className="quote-cell est-step-value">{value}</span>
        <button
          type="button"
          className="pill est-step-btn"
          onClick={() => onChange(Math.min(max, value + 1))}
          disabled={value >= max}
          aria-label={`More ${label.toLowerCase()}`}
        >+</button>
      </div>
    </div>
  )
}

export default function EstimateCalc() {
  const [spec, setSpec] = useState<EstimateSpec>(() => defaultSpec())

  // Seed from the URL once on mount (deterministic first render = SSR default).
  useEffect(() => {
    const fromUrl = specFromParams(window.location.search.replace(/^\?/, ''))
    setSpec(fromUrl)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // Reflect every change back into the URL so the spec is shareable.
  useEffect(() => {
    const qs = paramsFromSpec(spec)
    const next = `${window.location.pathname}?${qs}`
    window.history.replaceState(null, '', next)
  }, [spec])

  const set = <K extends keyof EstimateSpec>(key: K, val: EstimateSpec[K]) =>
    setSpec((s) => ({ ...s, [key]: val }))

  const toggleMedium = (m: Medium) => {
    if (m === 'desktop') return // desktop is always included
    setSpec((s) => ({
      ...s,
      media: s.media.includes(m) ? s.media.filter((x) => x !== m) : [...s.media, m],
    }))
  }

  const masters = computeMasters(spec.weights, spec.widths)
  const instances = computeInstances(spec.weights, spec.widths)
  const bundleOn = mediaBundleActive(spec.media)
  const covered = coveredMedia(spec.media)
  const slantLabel = spec.slant === 'italic' ? ' + italics' : spec.slant === 'oblique' ? ' + obliques' : ''
  const rush = isRush(spec)
  const weeks = estimateWeeks(spec)
  const total = grandTotal(spec)
  const range = estimateRange(total)
  const yearly = annualYearly(spec)

  const headline = formatEur(total)
  const shareUrl = typeof window !== 'undefined'
    ? `${window.location.origin}${window.location.pathname}?${paramsFromSpec(spec)}`
    : ''

  const mailtoHref = () => {
    const lines = [
      'Hi Martijn,',
      '',
      'I built this typeface estimate and would like a formal quote:',
      '',
      `• Weights: ${spec.weights}`,
      `• Widths: ${spec.widths}`,
      `• Masters drawn: ${masters} (${instances} styles${slantLabel})`,
      `• Slant: ${SLANTS.find((s) => s.value === spec.slant)?.label}`,
      `• Character set: ${CHARSET_LABELS[spec.charset]}`,
      `• Exclusivity: ${EXCLUSIVITY_LABELS[spec.exclusivity]}`,
      `• Company size: ${SIZE_LABELS[spec.size].label} (${SIZE_LABELS[spec.size].hint})`,
      `• Covered media: ${['desktop' as const, ...covered].map((m) => MEDIA_LABELS[m]).join(', ')}${bundleOn ? ' (bundle — all included)' : ''}`,
      `• License: ${spec.license === 'perpetual' ? 'Perpetual' : 'Annual'}`,
      `• Deadline: ${spec.deadline || 'flexible'}${rush ? ' (rush)' : ''}`,
      `• Indicative estimate: ${headline}${spec.license === 'annual' ? ` first year, then ${formatEur(yearly)}/year` : ''}`,
      '',
      `Full spec: ${shareUrl}`,
    ]
    return `mailto:hello@typografie.be?subject=${encodeURIComponent('Typeface quote request')}&body=${encodeURIComponent(lines.join('\n'))}`
  }

  return (
    <main className="page">
      <section className="quote-head">
        <p>Typeface Estimate</p>
        <div className="quote-meta">
          <p>Indicative pricing</p>
          <p>·</p>
          <p>Excl. VAT</p>
        </div>
      </section>

      {/* Family shape */}
      <div className="quote-block">
        <p className="quote-label">Family</p>
        <div className="est-steppers">
          <Stepper label="Weights" hint="Thin → Black" value={spec.weights} min={WEIGHTS_MIN} max={WEIGHTS_MAX} onChange={(n) => set('weights', n)} />
          <Stepper label="Widths" hint="Condensed → Extended" value={spec.widths} min={WIDTHS_MIN} max={WIDTHS_MAX} onChange={(n) => set('widths', n)} />
        </div>
        <p className="est-derived">{masters} master{masters === 1 ? '' : 's'} drawn · {instances} style{instances === 1 ? '' : 's'}{slantLabel}</p>
      </div>

      {/* Slant */}
      <div className="quote-block">
        <p className="quote-label">Slanted styles</p>
        <div className="quote-toggle">
          {SLANTS.map((s) => (
            <button
              key={s.value}
              type="button"
              className={`pill${spec.slant === s.value ? ' is-selected' : ''}`}
              onClick={() => set('slant', s.value)}
            >{s.label}</button>
          ))}
        </div>
        <p className="est-hint">Oblique is a mechanical slant, standard-included at no extra cost; italic is a separately drawn cursive set.</p>
      </div>

      {/* Character set */}
      <div className="quote-block">
        <p className="quote-label">Character set</p>
        <div className="quote-toggle">
          {CHARSET_ORDER.map((c) => (
            <button
              key={c}
              type="button"
              className={`pill${spec.charset === c ? ' is-selected' : ''}`}
              onClick={() => set('charset', c)}
            >{CHARSET_LABELS[c]}</button>
          ))}
        </div>
        <p className="est-hint">Full covers accented lowercase and uppercase; uppercase-only is far fewer glyphs.</p>
      </div>

      {/* Company size */}
      <div className="quote-block">
        <p className="quote-label">Company size</p>
        <div className="est-pillwrap">
          {SIZE_ORDER.map((s) => (
            <button
              key={s}
              type="button"
              className={`pill${spec.size === s ? ' is-selected' : ''}`}
              onClick={() => set('size', s)}
            >{SIZE_LABELS[s].label}<span className="est-pill-hint">{SIZE_LABELS[s].hint}</span></button>
          ))}
        </div>
      </div>

      {/* Media */}
      <div className="quote-block">
        <p className="quote-label">Covered media</p>
        <div className="est-pillwrap">
          {MEDIA_ORDER.map((m) => {
            const locked = m === 'desktop'
            // Once the bulk deal kicks in, every medium lights up as included.
            const on = locked || bundleOn || spec.media.includes(m)
            return (
              <button
                key={m}
                type="button"
                className={`pill${on ? ' is-selected' : ''}`}
                onClick={() => toggleMedium(m)}
                disabled={locked}
                aria-pressed={on}
              >{MEDIA_LABELS[m]}{locked ? <span className="est-pill-hint">always</span> : null}</button>
            )
          })}
        </div>
        {bundleOn && (
          <p className="est-hint">Bundle deal — all media included for the price of three blocks.</p>
        )}
      </div>

      {/* Exclusivity */}
      <div className="quote-block">
        <p className="quote-label">Exclusivity</p>
        <div className="quote-toggle">
          {EXCLUSIVITY_ORDER.map((e) => (
            <button
              key={e}
              type="button"
              className={`pill${spec.exclusivity === e ? ' is-selected' : ''}`}
              onClick={() => set('exclusivity', e)}
            >{EXCLUSIVITY_LABELS[e]}</button>
          ))}
        </div>
        <p className="est-hint">Full exclusive means the typeface is yours alone; non-exclusive lets it be licensed elsewhere, for less.</p>
      </div>

      {/* License model */}
      <div className="quote-block">
        <p className="quote-label">License model</p>
        <div className="quote-toggle">
          <button type="button" className={`pill${spec.license === 'perpetual' ? ' is-selected' : ''}`} onClick={() => set('license', 'perpetual')}>Perpetual</button>
          <button type="button" className={`pill${spec.license === 'annual' ? ' is-selected' : ''}`} onClick={() => set('license', 'annual')}>Annual</button>
        </div>
      </div>

      {/* Deadline */}
      <div className="quote-block">
        <p className="quote-label">Deadline</p>
        <div className="field">
          <input
            type="date"
            value={spec.deadline || ''}
            onChange={(e) => set('deadline', e.target.value || undefined)}
          />
        </div>
        <p className="est-hint">
          Estimated production: ~{weeks} week{weeks === 1 ? '' : 's'}.
          {rush ? ` Your deadline needs a rush — +${Math.round(CONFIG.RUSH_SURCHARGE * 100)}% applied.` : ''}
        </p>
      </div>

      {/* Total */}
      <div className="quote-block">
        <div className="quote-total-row">
          <div className="quote-cell">{spec.license === 'annual' ? 'Indicative first year, excl. VAT' : 'Indicative total, excl. VAT'}</div>
          <div className="quote-cell quote-total-amount">{headline}</div>
        </div>
        <p className="quote-foot">
          Indicative only — roughly {formatEur(range.low)}–{formatEur(range.high)}.
          {spec.license === 'annual'
            ? ` The first year of full usage rights (print, digital, environmental) is included. Thereafter it renews at ${formatEur(yearly)} per year, and can be converted to a perpetual, all-inclusive license at any time — previously paid annual fees are credited up to ${formatEur(creditMax(spec))}.`
            : ' A perpetual, all-inclusive license (design cost plus a one-time 50% license fee) grants full, unlimited usage rights across print, digital, and environmental applications.'}
          {rush ? ' Includes a rush surcharge for the requested deadline.' : ''}
          {' '}All prices exclude VAT. This is not a binding quote.
        </p>
      </div>

      {/* CTA */}
      <div className="quote-block">
        <a className="pill est-cta" href={mailtoHref()}>Request a formal quote →</a>
      </div>

      <section className="quote-terms">
        <p>
          Pricing is subject to the <a href="/calendar/terms" target="_blank" rel="noopener noreferrer">Terms &amp; Conditions</a>.
        </p>
      </section>
    </main>
  )
}
