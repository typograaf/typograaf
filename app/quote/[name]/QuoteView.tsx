'use client'

import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import {
  type Quote,
  type QuoteOption,
  type QuotePicture,
  type PlanBlock,
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
  formatPlanDate,
  daysBetween,
  computeOptionPlan,
  buildPlanSegments,
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
const FLIP_DURATION = 800
const FLIP_STAGGER = 60
const FLIP_EASING = 'cubic-bezier(0.22, 1, 0.36, 1)'

function stackStyle(i: number, mounted: boolean, hidden: boolean): React.CSSProperties {
  const r = STACK_ROTATIONS[i % STACK_ROTATIONS.length]
  const o = STACK_OFFSETS[i % STACK_OFFSETS.length]
  const transform = mounted
    ? `translate(calc(-50% + ${o.x}px), calc(-50% + ${o.y}px)) rotate(${r}deg)`
    : 'translate(-50%, -50%) rotate(0deg)'
  return {
    transform,
    opacity: hidden || !mounted ? 0 : 1,
    transition: mounted && !hidden
      ? `transform 850ms cubic-bezier(0.22, 1, 0.36, 1) ${i * 70}ms`
      : 'none',
    zIndex: i + 1,
  }
}

function PictureStrip({ pictures, variant }: { pictures: QuotePicture[] | undefined; variant: 'hero' | 'option' | 'row' }) {
  const list = (pictures || []).filter((p) => p.src?.trim())
  const [open, setOpen] = useState(false)
  const [closing, setClosing] = useState(false)
  const [lightboxIdx, setLightboxIdx] = useState<number | null>(null)
  const [loaded, setLoaded] = useState<Set<number>>(() => new Set())
  const stackImgRefs = useRef<(HTMLImageElement | null)[]>([])
  const gridImgRefs = useRef<(HTMLImageElement | null)[]>([])
  const mounted = list.length > 0 && loaded.size >= list.length
  const markLoaded = (i: number) =>
    setLoaded((prev) => prev.has(i) ? prev : new Set(prev).add(i))

  // FLIP open: position each grid img at its stack img's spot, then animate to identity.
  useLayoutEffect(() => {
    if (!open || closing) return
    for (let i = 0; i < list.length; i++) {
      const sEl = stackImgRefs.current[i]
      const gEl = gridImgRefs.current[i]
      if (!sEl || !gEl) continue
      const s = sEl.getBoundingClientRect()
      const g = gEl.getBoundingClientRect()
      if (s.width === 0 || g.width === 0) continue
      const dx = (s.left + s.width / 2) - (g.left + g.width / 2)
      const dy = (s.top + s.height / 2) - (g.top + g.height / 2)
      const scale = s.width / g.width
      const r = STACK_ROTATIONS[i % STACK_ROTATIONS.length]
      gEl.style.transition = 'none'
      gEl.style.transform = `translate(${dx}px, ${dy}px) scale(${scale}) rotate(${r}deg)`
    }
    void document.body.offsetHeight
    for (let i = 0; i < list.length; i++) {
      const gEl = gridImgRefs.current[i]
      if (!gEl) continue
      gEl.style.transition = `transform ${FLIP_DURATION}ms ${FLIP_EASING} ${i * FLIP_STAGGER}ms`
      gEl.style.transform = ''
    }
  }, [open, closing, list.length])

  // FLIP close: animate from identity back to stack positions, then unmount.
  useLayoutEffect(() => {
    if (!closing) return
    for (let i = 0; i < list.length; i++) {
      const sEl = stackImgRefs.current[i]
      const gEl = gridImgRefs.current[i]
      if (!sEl || !gEl) continue
      const s = sEl.getBoundingClientRect()
      const g = gEl.getBoundingClientRect()
      if (s.width === 0 || g.width === 0) continue
      const dx = (s.left + s.width / 2) - (g.left + g.width / 2)
      const dy = (s.top + s.height / 2) - (g.top + g.height / 2)
      const scale = s.width / g.width
      const r = STACK_ROTATIONS[i % STACK_ROTATIONS.length]
      const reverseDelay = (list.length - 1 - i) * FLIP_STAGGER
      gEl.style.transition = `transform ${FLIP_DURATION}ms ${FLIP_EASING} ${reverseDelay}ms`
      gEl.style.transform = `translate(${dx}px, ${dy}px) scale(${scale}) rotate(${r}deg)`
    }
  }, [closing, list.length])

  useEffect(() => {
    if (!closing) return
    const totalMs = FLIP_DURATION + (list.length - 1) * FLIP_STAGGER + 60
    const t = window.setTimeout(() => {
      setOpen(false)
      setClosing(false)
    }, totalMs)
    return () => window.clearTimeout(t)
  }, [closing, list.length])

  useEffect(() => {
    if (!open && lightboxIdx === null) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return
      if (lightboxIdx !== null) setLightboxIdx(null)
      else if (open && !closing) setClosing(true)
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [open, closing, lightboxIdx])

  if (list.length === 0) return null
  const stacked = list.length > 1
  const gridShown = open || closing

  const requestClose = () => {
    if (!closing) setClosing(true)
  }

  return (
    <>
      <div className={`quote-pictures quote-pictures-${variant}`}>
        {stacked ? (
          <button
            type="button"
            className="quote-stack"
            onClick={() => !open && setOpen(true)}
            aria-label={`View ${list.length} pictures`}
          >
            {list.map((p, i) => (
              <img
                key={i}
                ref={(el) => {
                  stackImgRefs.current[i] = el
                  if (el && el.complete && el.naturalWidth > 0) markLoaded(i)
                }}
                src={p.src}
                alt={p.alt || ''}
                loading="lazy"
                decoding="async"
                onLoad={() => markLoaded(i)}
                style={stackStyle(i, mounted, gridShown)}
              />
            ))}
          </button>
        ) : (
          <img src={list[0].src} alt={list[0].alt || ''} loading="lazy" decoding="async" />
        )}
      </div>
      {gridShown && (
        <div
          className={`quote-pictures-overlay${closing ? ' is-closing' : ''}`}
          onClick={requestClose}
          role="dialog"
          aria-label="Pictures"
        >
          <div className="quote-pictures-grid" onClick={(e) => e.stopPropagation()}>
            {list.map((p, i) => (
              <img
                key={i}
                ref={(el) => { gridImgRefs.current[i] = el }}
                src={p.src}
                alt={p.alt || ''}
                onClick={() => !closing && setLightboxIdx(i)}
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

const MONTHS_SHORT_VIEW = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']

function parseISOLocal(iso: string): Date | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso.trim())
  if (!m) return null
  return new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]))
}

function fmtISOLocal(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

function PlanningBlock({ option, blockedDays }: { option: QuoteOption; blockedDays: Set<string> }) {
  // Explicit blocks win; otherwise auto-chain from the kickoff date.
  const explicit = buildPlanSegments(option)

  if (explicit) {
    const total = daysBetween(explicit.rangeStart, explicit.rangeEnd)
    const startDate = parseISOLocal(explicit.rangeStart)!
    const endDate = parseISOLocal(explicit.rangeEnd)!
    // Anchor the strip to the Monday of rangeStart's week and the Sunday of
    // rangeEnd's week, so every row is a full 7-day strip (no orphan cells).
    const firstMonday = new Date(startDate)
    firstMonday.setDate(firstMonday.getDate() - ((firstMonday.getDay() + 6) % 7))
    const lastSunday = new Date(endDate)
    lastSunday.setDate(lastSunday.getDate() + ((7 - lastSunday.getDay()) % 7))

    const blocksByDate = new Map<string, PlanBlock[]>()
    for (const b of option.planBlocks || []) {
      const arr = blocksByDate.get(b.date)
      if (arr) arr.push(b)
      else blocksByDate.set(b.date, [b])
    }

    type Week = { label: string; days: { date: Date; iso: string; inRange: boolean; isWeekend: boolean; blocks: PlanBlock[] }[] }
    const weeks: Week[] = []
    let cursor = new Date(firstMonday)
    while (cursor <= lastSunday) {
      const days: Week['days'] = []
      for (let i = 0; i < 7; i++) {
        const d = new Date(cursor)
        d.setDate(cursor.getDate() + i)
        const iso = fmtISOLocal(d)
        const inRange = d >= startDate && d <= endDate
        const dow = d.getDay()
        days.push({
          date: d,
          iso,
          inRange,
          isWeekend: dow === 0 || dow === 6,
          blocks: blocksByDate.get(iso) || [],
        })
      }
      const monStart = days[0].date
      const monEnd = days[6].date
      const sameMonth = monStart.getMonth() === monEnd.getMonth()
      const label = sameMonth
        ? `${MONTHS_SHORT_VIEW[monStart.getMonth()]} ${monStart.getDate()} – ${monEnd.getDate()}`
        : `${MONTHS_SHORT_VIEW[monStart.getMonth()]} ${monStart.getDate()} – ${MONTHS_SHORT_VIEW[monEnd.getMonth()]} ${monEnd.getDate()}`
      weeks.push({ label, days })
      cursor = new Date(cursor)
      cursor.setDate(cursor.getDate() + 7)
    }

    const blockLabel = (b: PlanBlock): string => {
      if (b.kind === 'item') return option.items[b.itemIndex ?? -1]?.name || 'Item'
      if (b.kind === 'presentation') return 'Presentation'
      return 'Feedback'
    }

    return (
      <div className="quote-block">
        <p className="quote-label">Planning</p>
        <div className="quote-cal">
          <div className="quote-cal-dows">
            {['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'].map((d) => <span key={d}>{d}</span>)}
          </div>
          {weeks.map((week, wi) => (
            <div key={wi} className="quote-cal-week">
              <span className="quote-cal-weeklabel">{week.label}</span>
              <div className="quote-cal-row">
                {week.days.map((day) => (
                  <div
                    key={day.iso}
                    className={`quote-cal-cell${day.inRange ? '' : ' is-out'}${day.isWeekend ? ' is-weekend' : ''}`}
                  >
                    <span className="quote-cal-daynum">{day.date.getDate()}</span>
                    {day.blocks.length > 0 && (
                      <div className="quote-cal-blocks">
                        {day.blocks.map((b) => (
                          <div
                            key={b.id}
                            className={`quote-cal-block quote-cal-block-${b.kind}`}
                            title={blockLabel(b)}
                          >{blockLabel(b)}</div>
                        ))}
                      </div>
                    )}
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>
        <p className="quote-plan-summary">{`${formatPlanDate(explicit.rangeStart)} – ${formatPlanDate(explicit.rangeEnd)} · ${total} day${total === 1 ? '' : 's'} including weekends`}</p>
      </div>
    )
  }

  const plan = computeOptionPlan(option, blockedDays)
  if (!plan) return null
  const total = daysBetween(plan.rangeStart, plan.rangeEnd)
  return (
    <div className="quote-block">
      <p className="quote-label">Planning</p>
      <div className="quote-plan">
        {option.items.map((it, i) => {
          const range = plan.ranges[i]
          if (!range) return null
          const offset = daysBetween(plan.rangeStart, range.start) - 1
          const span = daysBetween(range.start, range.end)
          const left = (offset / total) * 100
          const width = (span / total) * 100
          return (
            <div key={i} className="quote-plan-row">
              <span className="quote-plan-label">{it.name}</span>
              <div className="quote-plan-track">
                <div
                  className="quote-plan-bar"
                  style={{ left: `${left}%`, width: `${width}%` }}
                  title={`${formatPlanDate(range.start)} – ${formatPlanDate(range.end)} · ${range.days} day${range.days === 1 ? '' : 's'}`}
                />
              </div>
              <span className="quote-plan-dates">
                {range.start === range.end
                  ? formatPlanDate(range.start)
                  : `${formatPlanDate(range.start)} – ${formatPlanDate(range.end)}`}
              </span>
            </div>
          )
        })}
      </div>
      <p className="quote-plan-summary">{`${formatPlanDate(plan.rangeStart)} – ${formatPlanDate(plan.rangeEnd)} · ${total} day${total === 1 ? '' : 's'} including weekends and busy days`}</p>
    </div>
  )
}

function OptionBlock({ option, blockedDays }: { option: QuoteOption; blockedDays: Set<string> }) {
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

      <PlanningBlock option={option} blockedDays={blockedDays} />

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

export default function QuoteView({ quote, blockedDays = [] }: { quote: Quote; blockedDays?: string[] }) {
  const blockedSet = new Set(blockedDays)
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
        <OptionBlock key={i} option={o} blockedDays={blockedSet} />
      ))}
    </main>
  )
}
