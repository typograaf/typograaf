'use client'

import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import {
  type Quote,
  type QuoteOption,
  type QuotePicture,
  type PlanBlock,
  type PlanBlockKind,
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
  // Build the effective block list. Explicit placements take priority; if
  // none are set but there's a kickoff date, synthesize virtual blocks from
  // the auto-chain so we render the same calendar in either case.
  let blocks: PlanBlock[] = option.planBlocks || []
  if (blocks.length === 0 && option.startDate) {
    const plan = computeOptionPlan(option, blockedDays)
    if (plan) {
      const synthetic: PlanBlock[] = []
      plan.ranges.forEach((range, itemIndex) => {
        if (!range) return
        const start = parseISOLocal(range.start)
        const end = parseISOLocal(range.end)
        if (!start || !end) return
        const cur = new Date(start)
        while (cur.getTime() <= end.getTime()) {
          const iso = fmtISOLocal(cur)
          const dow = cur.getDay()
          if (dow !== 0 && dow !== 6 && !blockedDays.has(iso)) {
            synthetic.push({
              id: `auto-${itemIndex}-${iso}`,
              kind: 'item',
              itemIndex,
              date: iso,
            })
          }
          cur.setDate(cur.getDate() + 1)
        }
      })
      blocks = synthetic
    }
  }
  if (blocks.length === 0) return null

  {
    const sortedBlocks = [...blocks].sort((a, b) => a.date.localeCompare(b.date))
    const rangeStartIso = sortedBlocks[0].date
    const rangeEndIso = sortedBlocks[sortedBlocks.length - 1].date
    const startDate = parseISOLocal(rangeStartIso)!
    const endDate = parseISOLocal(rangeEndIso)!

    const blocksByDate = new Map<string, PlanBlock[]>()
    for (const b of blocks) {
      const arr = blocksByDate.get(b.date)
      if (arr) arr.push(b)
      else blocksByDate.set(b.date, [b])
    }

    type CalDay = { iso: string; dayNum: number; inMonth: boolean; inRange: boolean; isWeekend: boolean; isBlocked: boolean; blocks: PlanBlock[] }
    type CalMonth = { label: string; days: CalDay[] }

    const firstMonth = new Date(startDate.getFullYear(), startDate.getMonth(), 1)
    const lastMonth = new Date(endDate.getFullYear(), endDate.getMonth(), 1)
    const months: CalMonth[] = []
    let m = new Date(firstMonth)
    while (m <= lastMonth) {
      const first = new Date(m.getFullYear(), m.getMonth(), 1)
      const startDow = (first.getDay() + 6) % 7 // Mon=0
      const grid: CalDay[] = []
      for (let i = 0; i < 42; i++) {
        const d = new Date(first)
        d.setDate(first.getDate() - startDow + i)
        const iso = fmtISOLocal(d)
        const dow = d.getDay()
        grid.push({
          iso,
          dayNum: d.getDate(),
          inMonth: d.getMonth() === m.getMonth(),
          inRange: d >= startDate && d <= endDate,
          isWeekend: dow === 0 || dow === 6,
          isBlocked: blockedDays.has(iso),
          blocks: blocksByDate.get(iso) || [],
        })
      }
      months.push({
        label: m.toLocaleString('en-GB', { month: 'long', year: 'numeric' }),
        days: grid,
      })
      m = new Date(m.getFullYear(), m.getMonth() + 1, 1)
    }

    const blockFullLabel = (b: PlanBlock): string => {
      if (b.kind === 'item') return option.items[b.itemIndex ?? -1]?.name || 'Item'
      if (b.kind === 'presentation') return 'Presentation'
      return 'Feedback'
    }
    const blockShortLabel = (b: PlanBlock): string => {
      if (b.kind === 'item') return option.items[b.itemIndex ?? -1]?.name || 'Item'
      if (b.kind === 'presentation') return 'PRES'
      return 'FB'
    }

    // Detect runs: consecutive same-(kind, itemIndex) blocks within the same
    // row. A weekend or empty day in between breaks the run; new row starts
    // a new run too — connection is calendar-adjacency only.
    type Run = { id: string; startCol: number; endCol: number; lane: number; kind: PlanBlockKind; label: string; title: string }
    const detectRuns = (rowDays: CalDay[]): Run[] => {
      const open = new Map<string, Run>() // key: kind|itemIndex
      const runs: Run[] = []
      for (let ci = 0; ci < rowDays.length; ci++) {
        const day = rowDays[ci]
        const seenThisCol = new Set<string>()
        for (const b of day.blocks) {
          const key = `${b.kind}|${b.itemIndex ?? ''}`
          seenThisCol.add(key)
          const carry = open.get(key)
          if (carry && carry.endCol === ci - 1) carry.endCol = ci
          else {
            const r: Run = {
              id: b.id,
              startCol: ci,
              endCol: ci,
              lane: 0,
              kind: b.kind,
              label: blockShortLabel(b),
              title: blockFullLabel(b),
            }
            runs.push(r)
            open.set(key, r)
          }
        }
        for (const key of Array.from(open.keys())) {
          if (!seenThisCol.has(key)) open.delete(key)
        }
      }
      // Greedy lane assignment by start column.
      runs.sort((a, b) => a.startCol - b.startCol)
      const laneEnds: number[] = []
      for (const r of runs) {
        let placed = false
        for (let li = 0; li < laneEnds.length; li++) {
          if (laneEnds[li] < r.startCol) {
            r.lane = li
            laneEnds[li] = r.endCol
            placed = true
            break
          }
        }
        if (!placed) {
          r.lane = laneEnds.length
          laneEnds.push(r.endCol)
        }
      }
      return runs
    }

    return (
      <div className="quote-block">
        <p className="quote-label">Planning</p>
        <div className="cal cal-plan">
          {months.map((mo, mi) => {
            const rows: CalDay[][] = []
            // Weekdays only — slice each Mon-Sun week to Mon-Fri.
            for (let i = 0; i < 6; i++) rows.push(mo.days.slice(i * 7, i * 7 + 5))
            const rowsInfo = rows.map((row) => {
              const runs = detectRuns(row)
              const laneCount = runs.reduce((m, r) => Math.max(m, r.lane + 1), 0)
              return { row, runs, laneCount }
            })
            const monthLanes = rowsInfo.reduce((m, r) => Math.max(m, r.laneCount), 0)
            // Lane rows are bar-height exact (20px) — no internal align-centering
            // padding. The 4px row-gap supplies the consistent inter-bar
            // spacing, and a trailing 0-height row turns that same row-gap
            // into a 4px bottom inset below the last bar. Result: 4px
            // everywhere — matches the bars' horizontal 4px margin.
            const gridTemplateRows = monthLanes > 0
              ? `24px repeat(${monthLanes}, 20px) 0`
              : '24px'
            return (
              <div key={mi} className="cal-top">
                <div className="cal-header"><span className="cal-month">{mo.label}</span></div>
                <div className="cal-weekdays" aria-hidden="true">
                  {['Mon', 'Tue', 'Wed', 'Thu', 'Fri'].map((d) => (
                    <span key={d} className="cal-weekday">{d}</span>
                  ))}
                </div>
                <div className="cal-grid">
                  {rowsInfo.map(({ row, runs }, ri) => {
                    return (
                      <div
                        key={ri}
                        className="cal-row"
                        style={{ gridTemplateRows }}
                      >
                        {row.map((day, ci) => {
                          const classes = ['cal-day']
                          if (!day.inMonth) classes.push('is-out')
                          if (day.isWeekend) classes.push('is-weekend')
                          return (
                            <div
                              key={day.iso}
                              className={classes.join(' ')}
                              style={{ gridColumn: ci + 1, gridRow: '1 / -1' }}
                              aria-hidden="true"
                            />
                          )
                        })}
                        {row.map((day, ci) => (
                          <span
                            key={`${day.iso}-num`}
                            className={`cal-daynum${day.inMonth ? '' : ' is-out'}`}
                            style={{ gridColumn: ci + 1, gridRow: 1 }}
                          >{day.dayNum}</span>
                        ))}
                        {runs.map((r) => (
                          <span
                            key={r.id}
                            className={`cal-bar cal-bar-${r.kind}`}
                            style={{
                              gridColumn: `${r.startCol + 1} / span ${r.endCol - r.startCol + 1}`,
                              gridRow: 2 + r.lane,
                            }}
                            title={r.title}
                          >{r.label}</span>
                        ))}
                      </div>
                    )
                  })}
                </div>
              </div>
            )
          })}
        </div>
      </div>
    )
  }
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

      <section className="quote-terms">
        <p>
          This quote is subject to the <a href="/calendar/terms" target="_blank" rel="noopener noreferrer">Terms &amp; Conditions</a>.
        </p>
      </section>
    </main>
  )
}
