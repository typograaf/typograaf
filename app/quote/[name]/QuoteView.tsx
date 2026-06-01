'use client'

import { useEffect, useState } from 'react'
import {
  type Quote,
  type QuoteOption,
  type QuotePicture,
  type LicenseModel,
  effectiveDesignCost,
  assetEffectivePrice,
  perpetualTotal,
  annualFirstYear,
  itemLineTotal,
  formatEur,
  formatVariable,
  styleLabel,
  formatQuoteDate,
  fillTokens,
  renderMarkdown,
  DEFAULT_FOOTNOTE_ANNUAL,
  DEFAULT_FOOTNOTE_PERPETUAL,
} from '@/lib/quote'
import Lightbox from '@/app/Lightbox'

const STACK_ROTATIONS = [-4, 3, -2, 5, -1, 4, -3, 2, -5, 1]
const STACK_OFFSETS = [
  { x: 0, y: 0 },
  { x: 6, y: -4 },
  { x: -5, y: 5 },
  { x: 4, y: 6 },
  { x: -7, y: -3 },
  { x: 3, y: -6 },
]
function stackStyle(i: number, mounted: boolean): React.CSSProperties {
  const r = STACK_ROTATIONS[i % STACK_ROTATIONS.length]
  const o = STACK_OFFSETS[i % STACK_OFFSETS.length]
  return {
    transform: mounted
      ? `translate(calc(-50% + ${o.x}px), calc(-50% + ${o.y}px)) rotate(${r}deg)`
      : 'translate(-50%, -50%) rotate(0deg)',
    opacity: mounted ? 1 : 0,
    transition: 'transform 850ms cubic-bezier(0.22, 1, 0.36, 1), opacity 500ms ease-out',
    transitionDelay: `${i * 70}ms`,
    zIndex: i + 1,
  }
}

function PictureStrip({ pictures, variant }: { pictures: QuotePicture[] | undefined; variant: 'hero' | 'option' | 'row' }) {
  const list = (pictures || []).filter((p) => p.src?.trim())
  const [open, setOpen] = useState(false)
  const [lightboxIdx, setLightboxIdx] = useState<number | null>(null)
  const [mounted, setMounted] = useState(false)

  useEffect(() => {
    const id = requestAnimationFrame(() => setMounted(true))
    return () => cancelAnimationFrame(id)
  }, [])

  useEffect(() => {
    if (!open && lightboxIdx === null) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return
      if (lightboxIdx !== null) setLightboxIdx(null)
      else setOpen(false)
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [open, lightboxIdx])

  if (list.length === 0) return null
  const stacked = list.length > 1

  return (
    <>
      <div className={`quote-pictures quote-pictures-${variant}`}>
        {stacked ? (
          <button
            type="button"
            className="quote-stack"
            onClick={() => setOpen(true)}
            aria-label={`View ${list.length} pictures`}
          >
            {list.map((p, i) => (
              <img
                key={i}
                src={p.src}
                alt={p.alt || ''}
                loading="lazy"
                decoding="async"
                style={stackStyle(i, mounted)}
              />
            ))}
          </button>
        ) : (
          <img src={list[0].src} alt={list[0].alt || ''} loading="lazy" decoding="async" />
        )}
      </div>
      {open && (
        <div
          className="quote-pictures-overlay"
          onClick={() => setOpen(false)}
          role="dialog"
          aria-label="Pictures"
        >
          <div className="quote-pictures-grid" onClick={(e) => e.stopPropagation()}>
            {list.map((p, i) => (
              <img
                key={i}
                src={p.src}
                alt={p.alt || ''}
                onClick={() => setLightboxIdx(i)}
                style={{ animationDelay: `${i * 70}ms` }}
              />
            ))}
          </div>
        </div>
      )}
      {lightboxIdx !== null && (
        <Lightbox url={list[lightboxIdx].src} onClose={() => setLightboxIdx(null)} />
      )}
    </>
  )
}

function licenseAmount(model: LicenseModel, d: number): number {
  return model === 'annual' ? annualFirstYear(d) : perpetualTotal(d)
}

function OptionBlock({ option }: { option: QuoteOption }) {
  const assets = option.assets.filter(
    (a) => a.name.trim() || a.variable.trim() || (Number(a.price) || 0) > 0 || a.styles.length > 0,
  )
  const hasAssets = assets.length > 0
  const items = (option.items || []).filter(
    (it) => it.name.trim() || it.description.trim() || it.unit.trim() || (Number(it.unitPrice) || 0) > 0,
  )
  const hasItems = items.length > 0
  const [model, setModel] = useState<LicenseModel>('annual')
  const [italic, setItalic] = useState<boolean[]>(() => assets.map(() => false))
  const setAssetItalic = (i: number, on: boolean) =>
    setItalic((prev) => prev.map((v, j) => (j === i ? on : v)))
  const d = hasAssets ? effectiveDesignCost({ ...option, assets }, italic) : 0
  const licensePortion = hasAssets ? licenseAmount(model, d) : 0
  const itemsPortion = items.reduce((s, it) => s + itemLineTotal(it), 0)
  const combined = licensePortion + itemsPortion
  const amount = formatEur(combined)
  const headlineLabel = hasAssets && model === 'annual' && !hasItems
    ? `${amount} first year`
    : amount
  const footnote = hasAssets
    ? fillTokens(
        model === 'annual' ? DEFAULT_FOOTNOTE_ANNUAL : DEFAULT_FOOTNOTE_PERPETUAL,
        d,
      )
    : ''

  return (
    <section className="quote-option">
      <div className="quote-option-head">
        <div className="quote-option-title">
          <p>{option.title}</p>
          <p>·</p>
          <p>{headlineLabel}</p>
        </div>
        {option.description && (
          <div className="quote-desc">{renderMarkdown(option.description, `opt-${option.title}`)}</div>
        )}
      </div>

      <PictureStrip pictures={option.pictures} variant="option" />

      {hasAssets && (
        <div className="quote-block">
          <p className="quote-label">License Model</p>
          <div className="quote-toggle">
            <button
              type="button"
              className={`pill${model === 'perpetual' ? ' is-selected' : ''}`}
              onClick={() => setModel('perpetual')}
            >Perpetual</button>
            <button
              type="button"
              className={`pill${model === 'annual' ? ' is-selected' : ''}`}
              onClick={() => setModel('annual')}
            >Annual</button>
          </div>
        </div>
      )}

      {assets.map((a, i) => (
        <div key={i} className="quote-block">
          <div className="quote-row">
            <div className="quote-col col-asset">
              <p className="quote-colhead">Asset</p>
              <div className="quote-cell">{a.name}</div>
            </div>
            <div className="quote-col">
              <p className="quote-colhead">Variable</p>
              <div className="quote-cell">{formatVariable(a.variable)}</div>
            </div>
            <div className="quote-col">
              <p className="quote-colhead">Price</p>
              <div className="quote-cell">{formatEur(assetEffectivePrice(a, !!italic[i]))}</div>
            </div>
          </div>
          {a.offersItalic && (
            <>
              <p className="quote-subhead">Extras</p>
              <div className="quote-toggle">
                <button
                  type="button"
                  className={`pill${!italic[i] ? ' is-selected' : ''}`}
                  onClick={() => setAssetItalic(i, false)}
                >Oblique</button>
                <button
                  type="button"
                  className={`pill${italic[i] ? ' is-selected' : ''}`}
                  onClick={() => setAssetItalic(i, true)}
                >Italic</button>
              </div>
            </>
          )}
          {a.styles.length > 0 && (
            <>
              <p className="quote-subhead">Styles</p>
              <div className="quote-chips">
                {a.styles.map((s, j) => (
                  <div key={j} className="quote-cell quote-chip">
                    {styleLabel(s, a.offersItalic && italic[i] ? 'Italic' : 'Oblique')}
                  </div>
                ))}
              </div>
            </>
          )}
          <PictureStrip pictures={a.pictures} variant="row" />
        </div>
      ))}

      {items.map((it, i) => (
        <div key={`item-${i}`} className="quote-block">
          <div className="quote-row">
            <div className="quote-col col-asset">
              <p className="quote-colhead">Item</p>
              <div className="quote-cell">{it.name}</div>
            </div>
            <div className="quote-col">
              <p className="quote-colhead">Unit</p>
              <div className="quote-cell">
                {it.unit
                  ? `${it.quantity} × ${it.unit}`
                  : `${it.quantity} ×`}
              </div>
            </div>
            <div className="quote-col">
              <p className="quote-colhead">Price</p>
              <div className="quote-cell">{formatEur(itemLineTotal(it))}</div>
            </div>
          </div>
          {it.description && (
            <div className="quote-desc">{renderMarkdown(it.description, `it-${i}`)}</div>
          )}
          <PictureStrip pictures={it.pictures} variant="row" />
        </div>
      ))}

      <div className="quote-block">
        <div className="quote-total-row">
          <div className="quote-cell">Total, Excluding Revisions, Excl. VAT</div>
          <div className="quote-cell quote-total-amount">{amount}</div>
        </div>
        {footnote && <p className="quote-foot">{footnote}</p>}
      </div>
    </section>
  )
}

export default function QuoteView({ quote }: { quote: Quote }) {
  return (
    <main className="page">
      <section className="quote-head">
        <p>{quote.project}</p>
        <div className="quote-meta">
          <p>Project Quote</p>
          <p>·</p>
          <p>{formatQuoteDate(quote.date)}</p>
          <p>·</p>
          <p>Valid through {formatQuoteDate(quote.validThrough)}</p>
        </div>
      </section>

      <PictureStrip pictures={quote.pictures} variant="hero" />

      {quote.options.map((o, i) => (
        <OptionBlock key={i} option={o} />
      ))}
    </main>
  )
}
