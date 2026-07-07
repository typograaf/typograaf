'use client'

import { useEffect, useState } from 'react'
import {
  type EstimateSpec,
  type Slant,
  type CompanySize,
  type Medium,
  type CharacterSet,
  type Licensing,
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
  LICENSING_ORDER,
  LICENSING_LABELS,
  defaultSpec,
  computeMasters,
  computeInstances,
  annualRenewal,
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
  const size = SIZE_ORDER.includes(p.get('size') as CompanySize)
    ? (p.get('size') as CompanySize)
    : base.size
  const licensing = LICENSING_ORDER.includes(p.get('lic') as Licensing)
    ? (p.get('lic') as Licensing)
    : base.licensing
  const mediaRaw = (p.get('media') || '').split(',').map((m) => m.trim()) as Medium[]
  const media = MEDIA_ORDER.filter((m) => mediaRaw.includes(m))
  const deadline = /^\d{4}-\d{2}-\d{2}$/.test(p.get('deadline') || '') ? p.get('deadline')! : undefined

  return {
    weights: clampInt(p.get('w'), WEIGHTS_MIN, WEIGHTS_MAX, base.weights),
    widths: clampInt(p.get('d'), WIDTHS_MIN, WIDTHS_MAX, base.widths),
    slant,
    charset,
    size,
    media: media.includes('desktop') ? media : (['desktop', ...media] as Medium[]),
    licensing,
    ...(deadline ? { deadline } : {}),
  }
}

function paramsFromSpec(spec: EstimateSpec): string {
  const p = new URLSearchParams()
  p.set('w', String(spec.weights))
  p.set('d', String(spec.widths))
  p.set('slant', spec.slant)
  p.set('cs', spec.charset)
  p.set('size', spec.size)
  p.set('media', spec.media.join(','))
  p.set('lic', spec.licensing)
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
  const isAnnual = spec.licensing === 'annual'
  const yearly = annualRenewal(spec)

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
      `• Company size: ${SIZE_LABELS[spec.size].label} (${SIZE_LABELS[spec.size].hint})`,
      `• Covered media: ${['desktop' as const, ...covered].map((m) => MEDIA_LABELS[m]).join(', ')}${bundleOn ? ' (bundle — all included)' : ''}`,
      `• Licensing: ${LICENSING_LABELS[spec.licensing].label} (${LICENSING_LABELS[spec.licensing].hint})`,
      `• Deadline: ${spec.deadline || 'flexible'}${rush ? ' (rush)' : ''}`,
      `• Indicative estimate: ${headline}${isAnnual ? ` first year, then ${formatEur(yearly)}/year` : spec.licensing === 'term2y' ? ` for 2 years exclusive, then ${formatEur(yearly)}/year` : ''}`,
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
            const selected = spec.media.includes(m)
            // Only actually-clicked media highlight. When the bundle is active,
            // the extras it throws in for free are labelled "included" rather
            // than made to look clicked — so you can always tell which picks to
            // click off to go back to desktop-only.
            const on = locked || selected
            const includedFree = bundleOn && !locked && !selected
            const hint = locked ? 'always' : includedFree ? 'included' : ''
            return (
              <button
                key={m}
                type="button"
                className={`pill${on ? ' is-selected' : ''}`}
                onClick={() => toggleMedium(m)}
                disabled={locked}
                aria-pressed={on}
              >{MEDIA_LABELS[m]}{hint ? <span className="est-pill-hint">{hint}</span> : null}</button>
            )
          })}
        </div>
        {bundleOn && (
          <p className="est-hint">Bundle deal — all media included for the price of three blocks.</p>
        )}
      </div>

      {/* Licensing */}
      <div className="quote-block">
        <p className="quote-label">Licensing</p>
        <div className="est-pillwrap">
          {LICENSING_ORDER.map((l) => (
            <button
              key={l}
              type="button"
              className={`pill${spec.licensing === l ? ' is-selected' : ''}`}
              onClick={() => set('licensing', l)}
            >{LICENSING_LABELS[l].label}<span className="est-pill-hint">{LICENSING_LABELS[l].hint}</span></button>
          ))}
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
          <div className="quote-cell">
            {spec.licensing === 'annual'
              ? 'Indicative first year, excl. VAT'
              : spec.licensing === 'term2y'
              ? 'Indicative 2-year fee, excl. VAT'
              : 'Indicative buyout, excl. VAT'}
          </div>
          <div className="quote-cell quote-total-amount">{headline}</div>
        </div>
        <p className="quote-foot">
          Indicative only — roughly {formatEur(range.low)}–{formatEur(range.high)}.
          {spec.licensing === 'buyout'
            ? ' A one-time exclusive buyout — the typeface is yours alone, used in perpetuity across print, digital and environmental applications. Comprises the design cost plus a one-time license fee.'
            : spec.licensing === 'term2y'
            ? ` A term fee for two years of exclusive use (about two-thirds of the buyout). After the two years it continues as a non-exclusive annual license at ${formatEur(yearly)} per year, and the typeface may also be licensed elsewhere.`
            : ` A non-exclusive annual license — the first year as shown, renewing at ${formatEur(yearly)} per year. The same typeface may also be licensed to others.`}
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
