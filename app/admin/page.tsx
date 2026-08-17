'use client'

import { useEffect, useMemo, useRef, useState } from 'react'
import {
  type Quote,
  type QuoteOption,
  type QuoteAsset,
  type QuoteItem,
  type QuotePicture,
  type PlanBlock,
  type PlanBlockKind,
  type OptionKind,
  TYPEFACE_PHASES,
  planKindLabel,
  emptyQuote,
  emptyOption,
  emptyAsset,
  emptyItem,
  itemsTotal,
  slugify,
  designCost,
  perpetualTotal,
  annualFirstYear,
  annualYearly,
  formatEur,
  optionKind,
  optionSpec,
  optionEstimateLink,
  quoteAsOf,
  typefaceTotal,
  typefaceRenewal,
  typefaceTotalLabel,
  typefaceSpecRows,
} from '../../lib/quote'
import { parseEstimateLink } from '../../lib/estimate'
import { DEFAULT_PREVIEW_WEIGHT, DEFAULT_PREVIEW_LEADING, DEFAULT_PREVIEW_SIZE } from '../../lib/tiles'
import { type Axis, parseVariationAxes, parseCharSet, glyphSafeText } from '../../lib/fontmeta'

type Tab = 'work' | 'about' | 'images' | 'quotes' | 'sentences'

const TABS: { key: Tab; label: string }[] = [
  { key: 'work', label: 'Work' },
  { key: 'about', label: 'About' },
  { key: 'images', label: 'Images' },
  { key: 'quotes', label: 'Quotes' },
  { key: 'sentences', label: 'Type' },
]

// Keep the textarea's raw text while editing (preserve spaces / blank
// lines so typing works). Lines are trimmed and emptied out at save
// time by normalizeQuote.
const rawLines = (v: string) => v.split('\n')

// Everything the Save button persists, serialised. Comparing the current
// snapshot against the last-saved one is what drives the unsaved-changes
// state (dirty Save button + a beforeunload guard).
const snapshotOf = (v: unknown) => JSON.stringify(v)

interface AdminImage {
  id: string
  name: string
  url: string
  project: string
  hidden: boolean
  isFont: boolean
}

export default function Admin() {
  const [authed, setAuthed] = useState<boolean | null>(null)
  const [password, setPassword] = useState('')
  const [pwError, setPwError] = useState(false)
  const [tab, setTab] = useState<Tab>('work')
  const [order, setOrder] = useState<string[]>([])
  const [about, setAbout] = useState('')
  const [quotes, setQuotes] = useState<Quote[]>([])
  const [sentences, setSentences] = useState<string[]>([])
  const [blockedDays, setBlockedDays] = useState<string[]>([])
  const [fonts, setFonts] = useState<{ id: string; name: string; url: string }[]>([])
  const [previewAxes, setPreviewAxes] = useState<Record<string, Record<string, number>>>({})
  const [images, setImages] = useState<AdminImage[]>([])
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [justSaved, setJustSaved] = useState(false)
  const [savedSnapshot, setSavedSnapshot] = useState('')
  const [stuck, setStuck] = useState(false)
  const [deletingIds, setDeletingIds] = useState<Set<string>>(new Set())
  const [togglingIds, setTogglingIds] = useState<Set<string>>(new Set())
  const [projectFilter, setProjectFilter] = useState<string>('')
  const [showHidden, setShowHidden] = useState(true)
  const dragIndexRef = useRef<number | null>(null)
  const [dragOverIndex, setDragOverIndex] = useState<number | null>(null)
  const [activeQuoteIdx, setActiveQuoteIdx] = useState(0)
  const blockedDaysSet = useMemo(() => new Set(blockedDays), [blockedDays])
  const itemDragRef = useRef<{ oi: number; from: number } | null>(null)
  const [itemDragOver, setItemDragOver] = useState<{ oi: number; over: number } | null>(null)

  const load = async () => {
    setLoading(true)
    const res = await fetch('/api/admin', { cache: 'no-store' })
    if (res.status === 401) {
      setAuthed(false)
      setLoading(false)
      return
    }
    const data = await res.json()
    const nextOrder = data.order || []
    const nextAbout = data.about || ''
    const nextQuotes = Array.isArray(data.quotes) ? data.quotes : []
    const nextSentences = Array.isArray(data.sentences) ? data.sentences : []
    const nextAxes = data.previewAxes && typeof data.previewAxes === 'object' ? data.previewAxes : {}
    setOrder(nextOrder)
    setAbout(nextAbout)
    setQuotes(nextQuotes)
    setSentences(nextSentences)
    setBlockedDays(Array.isArray(data.blockedDays) ? data.blockedDays : [])
    setFonts(Array.isArray(data.fonts) ? data.fonts : [])
    setPreviewAxes(nextAxes)
    setImages(data.images || [])
    setSavedSnapshot(snapshotOf({
      order: nextOrder, about: nextAbout, quotes: nextQuotes,
      sentences: nextSentences, previewAxes: nextAxes,
    }))
    setAuthed(true)
    setLoading(false)
  }

  useEffect(() => {
    load()
  }, [])

  // Unsaved-changes state: the Save button goes solid, and leaving the page
  // asks for confirmation.
  const snapshot = useMemo(
    () => snapshotOf({ order, about, quotes, sentences, previewAxes }),
    [order, about, quotes, sentences, previewAxes],
  )
  const dirty = authed === true && !loading && snapshot !== savedSnapshot

  useEffect(() => {
    if (!dirty) return
    const warn = (e: BeforeUnloadEvent) => { e.preventDefault(); e.returnValue = '' }
    window.addEventListener('beforeunload', warn)
    return () => window.removeEventListener('beforeunload', warn)
  }, [dirty])

  // "Saved" confirmation is time-boxed by a timer rather than a timestamp
  // comparison, so it actually disappears without a further render.
  useEffect(() => {
    if (!justSaved) return
    const t = window.setTimeout(() => setJustSaved(false), 2400)
    return () => window.clearTimeout(t)
  }, [justSaved])

  // Drop a hairline under the sticky header once the page scrolls.
  useEffect(() => {
    const onScroll = () => setStuck(window.scrollY > 4)
    onScroll()
    window.addEventListener('scroll', onScroll, { passive: true })
    return () => window.removeEventListener('scroll', onScroll)
  }, [])

  const submitLogin = async (e: React.FormEvent) => {
    e.preventDefault()
    setPwError(false)
    const res = await fetch('/api/auth', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ password }),
    })
    const data = await res.json()
    if (data.success) {
      setPassword('')
      load()
    } else {
      setPwError(true)
    }
  }

  const move = (from: number, to: number) => {
    if (to < 0 || to >= order.length || from === to) return
    const next = [...order]
    const [item] = next.splice(from, 1)
    next.splice(to, 0, item)
    setOrder(next)
  }

  const save = async () => {
    setSaving(true)
    await fetch('/api/admin', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ order, about, quotes, sentences, previewAxes }),
    })
    // Re-read what actually persisted so dropped/invalid quotes surface
    // instead of looking saved only in local state.
    let persistedQuotes = quotes
    try {
      const res = await fetch('/api/admin', { cache: 'no-store' })
      if (res.ok) {
        const data = await res.json()
        persistedQuotes = Array.isArray(data.quotes) ? data.quotes : []
        setQuotes(persistedQuotes)
      }
    } catch {}
    // Baseline against what came back, so a quote the API dropped still
    // reads as an unsaved change rather than silently looking saved.
    setSavedSnapshot(snapshotOf({ order, about, quotes: persistedQuotes, sentences, previewAxes }))
    setSaving(false)
    setJustSaved(true)
  }

  const updateQuote = (qi: number, patch: Partial<Quote>) => {
    setQuotes(prev => prev.map((q, i) => i === qi ? { ...q, ...patch } : q))
  }
  const updateOption = (qi: number, oi: number, patch: Partial<QuoteOption>) => {
    setQuotes(prev => prev.map((q, i) => i !== qi ? q : {
      ...q,
      options: q.options.map((o, j) => j === oi ? { ...o, ...patch } : o),
    }))
  }
  const updateAsset = (qi: number, oi: number, ai: number, patch: Partial<QuoteAsset>) => {
    setQuotes(prev => prev.map((q, i) => i !== qi ? q : {
      ...q,
      options: q.options.map((o, j) => j !== oi ? o : {
        ...o,
        assets: o.assets.map((a, k) => k === ai ? { ...a, ...patch } : a),
      }),
    }))
  }
  const addQuote = () => {
    setQuotes(prev => {
      const next = [...prev, emptyQuote()]
      setActiveQuoteIdx(next.length - 1)
      return next
    })
  }
  const removeQuote = (qi: number) => {
    if (!confirm(`Delete quote "${quotes[qi]?.project || quotes[qi]?.slug || 'untitled'}"? This cannot be undone after saving.`)) return
    setQuotes(prev => {
      const next = prev.filter((_, i) => i !== qi)
      setActiveQuoteIdx(i => Math.max(0, Math.min(i, next.length - 1)))
      return next
    })
  }
  const addOption = (qi: number, kind: OptionKind) => setQuotes(prev => prev.map((q, i) => i !== qi ? q : {
    ...q, options: [...q.options, emptyOption(q.options.length + 1, kind)],
  }))
  const removeOption = (qi: number, oi: number) => setQuotes(prev => prev.map((q, i) => i !== qi ? q : {
    ...q, options: q.options.filter((_, j) => j !== oi),
  }))
  const addAsset = (qi: number, oi: number) => setQuotes(prev => prev.map((q, i) => i !== qi ? q : {
    ...q,
    options: q.options.map((o, j) => j !== oi ? o : { ...o, assets: [...o.assets, emptyAsset()] }),
  }))
  const removeAsset = (qi: number, oi: number, ai: number) => setQuotes(prev => prev.map((q, i) => i !== qi ? q : {
    ...q,
    options: q.options.map((o, j) => j !== oi ? o : { ...o, assets: o.assets.filter((_, k) => k !== ai) }),
  }))
  const updateItem = (qi: number, oi: number, ii: number, patch: Partial<QuoteItem>) => {
    setQuotes(prev => prev.map((q, i) => i !== qi ? q : {
      ...q,
      options: q.options.map((o, j) => j !== oi ? o : {
        ...o,
        items: (o.items || []).map((it, k) => k === ii ? { ...it, ...patch } : it),
      }),
    }))
  }
  const addItem = (qi: number, oi: number) => setQuotes(prev => prev.map((q, i) => i !== qi ? q : {
    ...q,
    options: q.options.map((o, j) => j !== oi ? o : { ...o, items: [...(o.items || []), emptyItem()] }),
  }))
  const removeItem = (qi: number, oi: number, ii: number) => setQuotes(prev => prev.map((q, i) => i !== qi ? q : {
    ...q,
    options: q.options.map((o, j) => j !== oi ? o : { ...o, items: (o.items || []).filter((_, k) => k !== ii) }),
  }))
  const reorderItem = (qi: number, oi: number, from: number, to: number) => {
    if (from === to) return
    setQuotes(prev => prev.map((q, i) => i !== qi ? q : {
      ...q,
      options: q.options.map((o, j) => {
        if (j !== oi) return o
        const items = [...(o.items || [])]
        if (from < 0 || from >= items.length || to < 0 || to >= items.length) return o
        const [moved] = items.splice(from, 1)
        items.splice(to, 0, moved)
        const remap = (old: number): number => {
          if (old === from) return to
          if (from < to && old > from && old <= to) return old - 1
          if (from > to && old >= to && old < from) return old + 1
          return old
        }
        const planBlocks = o.planBlocks?.map((b) =>
          b.kind === 'item' && typeof b.itemIndex === 'number'
            ? { ...b, itemIndex: remap(b.itemIndex) }
            : b,
        )
        return { ...o, items, ...(planBlocks ? { planBlocks } : {}) }
      }),
    }))
  }

  const toggleHide = async (img: AdminImage) => {
    setTogglingIds(prev => new Set(prev).add(img.id))
    const nextHidden = !img.hidden
    setImages(prev => prev.map(i => i.id === img.id ? { ...i, hidden: nextHidden } : i))
    try {
      const res = await fetch('/api/admin', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id: img.id, hidden: nextHidden }),
      })
      if (!res.ok) {
        setImages(prev => prev.map(i => i.id === img.id ? { ...i, hidden: img.hidden } : i))
        const err = await res.json().catch(() => ({}))
        alert(`Toggle failed: ${err.error || res.statusText}`)
      }
    } finally {
      setTogglingIds(prev => {
        const next = new Set(prev)
        next.delete(img.id)
        return next
      })
    }
  }

  const deleteImg = async (img: AdminImage) => {
    const label = img.project ? `${img.project} / ${img.name}` : img.name
    if (!confirm(`Delete "${label}"?\n\nThis removes it from Dropbox (and your Mac via sync) and from the site. This cannot be undone.`)) return
    setDeletingIds(prev => new Set(prev).add(img.id))
    try {
      const res = await fetch('/api/admin', {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id: img.id }),
      })
      if (!res.ok) {
        const err = await res.json().catch(() => ({}))
        alert(`Delete failed: ${err.error || res.statusText}`)
        return
      }
      setImages(prev => prev.filter(i => i.id !== img.id))
    } finally {
      setDeletingIds(prev => {
        const next = new Set(prev)
        next.delete(img.id)
        return next
      })
    }
  }

  const projects = useMemo(() => {
    const set = new Set<string>()
    for (const img of images) if (img.project) set.add(img.project)
    return ['', ...Array.from(set).sort((a, b) => a.localeCompare(b))]
  }, [images])

  const filteredImages = useMemo(() => {
    return images.filter(i => {
      if (!showHidden && i.hidden) return false
      if (projectFilter && i.project !== projectFilter) return false
      return true
    })
  }, [images, projectFilter, showHidden])

  const hiddenCount = useMemo(() => images.filter(i => i.hidden).length, [images])

  if (authed === false) {
    return (
      <>
        <AdminStyles />
        <main className="admin-login">
          <form onSubmit={submitLogin}>
            <input
              type="password"
              autoFocus
              placeholder={pwError ? 'wrong password' : 'password'}
              className={`password-input${pwError ? ' password-error' : ''}`}
              value={password}
              onChange={(e) => { setPassword(e.target.value); setPwError(false) }}
            />
          </form>
        </main>
      </>
    )
  }

  if (loading || authed === null) {
    return (
      <>
        <AdminStyles />
        <main className="admin-page"><p className="admin-muted">Loading…</p></main>
      </>
    )
  }

  return (
    <>
      <AdminStyles />
      <main className="admin-page">
        <header className={`admin-header${stuck ? ' is-stuck' : ''}`}>
          <div className="admin-tabs" role="tablist" aria-label="Sections">
            {TABS.map((t) => (
              <button
                key={t.key}
                role="tab"
                aria-selected={tab === t.key}
                className={`admin-tab${tab === t.key ? ' is-active' : ''}`}
                onClick={() => setTab(t.key)}
                type="button"
              >{t.label}</button>
            ))}
          </div>
          <div className="admin-save-row">
            {tab === 'images' ? (
              <span className="admin-muted admin-autosave">Saves instantly</span>
            ) : (
              <>
                {justSaved && !dirty && <span className="admin-muted admin-saved">Saved</span>}
                <button
                  className={`admin-tab is-primary${dirty ? ' is-dirty' : ''}`}
                  onClick={save}
                  disabled={saving}
                  type="button"
                >{saving ? 'Saving…' : 'Save'}</button>
              </>
            )}
          </div>
        </header>

        {tab === 'work' && (
          <div className="admin-list">
            {order.map((name, i) => (
              <div
                key={`${name}-${i}`}
                className={`admin-row${dragOverIndex === i ? ' is-drag-over' : ''}`}
                draggable
                onDragStart={(e) => {
                  dragIndexRef.current = i
                  e.dataTransfer.effectAllowed = 'move'
                }}
                onDragOver={(e) => {
                  e.preventDefault()
                  e.dataTransfer.dropEffect = 'move'
                  if (dragOverIndex !== i) setDragOverIndex(i)
                }}
                onDragLeave={() => {
                  if (dragOverIndex === i) setDragOverIndex(null)
                }}
                onDrop={(e) => {
                  e.preventDefault()
                  const from = dragIndexRef.current
                  dragIndexRef.current = null
                  setDragOverIndex(null)
                  if (from === null || from === i) return
                  move(from, i)
                }}
                onDragEnd={() => {
                  dragIndexRef.current = null
                  setDragOverIndex(null)
                }}
              >
                <span className="admin-handle" aria-hidden>≡</span>
                <span className="admin-name">{name}</span>
                <button className="admin-arrow" type="button" onClick={() => move(i, i - 1)} disabled={i === 0} aria-label="Move up">↑</button>
                <button className="admin-arrow" type="button" onClick={() => move(i, i + 1)} disabled={i === order.length - 1} aria-label="Move down">↓</button>
              </div>
            ))}
          </div>
        )}

        {tab === 'about' && (
          <textarea
            className="admin-textarea"
            value={about}
            onChange={(e) => setAbout(e.target.value)}
            spellCheck={false}
            rows={20}
          />
        )}

        {tab === 'sentences' && (
          <div className="admin-type">
            <section className="admin-type-section">
              <h2 className="admin-type-h">Typefaces</h2>
              {fonts.length === 0 ? (
                <p className="admin-muted">No typefaces synced yet.</p>
              ) : (
                <div className="admin-typefaces">
                  {fonts.map((f) => (
                    <FontAxisRow
                      key={f.id}
                      font={f}
                      axes={previewAxes[f.id] || {}}
                      sentences={sentences}
                      onChange={(next) =>
                        setPreviewAxes((m) => ({ ...m, [f.id]: next }))
                      }
                    />
                  ))}
                </div>
              )}
            </section>
            <section className="admin-type-section">
              <h2 className="admin-type-h">Sentences</h2>
              <textarea
                className="admin-textarea"
                value={sentences.join('\n')}
                onChange={(e) => setSentences(e.target.value.split('\n'))}
                spellCheck={false}
                rows={20}
              />
            </section>
          </div>
        )}

        {tab === 'quotes' && (
          <div className="admin-quotes">
            <div className="admin-subtabs">
              {quotes.map((q, qi) => {
                const label = q.project || q.slug || 'Untitled'
                return (
                  <button
                    key={qi}
                    type="button"
                    className={`admin-subtab${qi === activeQuoteIdx ? ' is-active' : ''}`}
                    onClick={() => setActiveQuoteIdx(qi)}
                    title={label}
                  >{label.length > 32 ? label.slice(0, 32) + '…' : label}</button>
                )
              })}
              <button
                type="button"
                className="admin-subtab is-primary"
                onClick={addQuote}
              >+ Add quote</button>
            </div>
            {quotes.length === 0 && (
              <p className="admin-muted">No quotes yet.</p>
            )}
            {quotes.length > 0 && activeQuoteIdx < quotes.length && [quotes[activeQuoteIdx]].map((q) => {
              const qi = activeQuoteIdx
              const slug = q.slug || slugify(q.project)
              return (
                <div key={qi} className="admin-quote">
                  <PicturesField
                    pictures={q.pictures || []}
                    onChange={(pictures) => updateQuote(qi, { pictures })}
                    library={images}
                    size="md"
                    label="Cover pictures"
                  />
                  <div className="admin-quote-top">
                    <div className="admin-qfield">
                      <label>Project</label>
                      <input
                        className="admin-input"
                        value={q.project}
                        placeholder="MirrorMirror Sports Pitch"
                        onChange={(e) => {
                          const project = e.target.value
                          updateQuote(qi, q.slug ? { project } : { project, slug: slugify(project) })
                        }}
                      />
                    </div>
                    <div className="admin-qfield">
                      <label>URL slug</label>
                      <input
                        className="admin-input"
                        value={q.slug}
                        placeholder="mirrormirror"
                        onChange={(e) => updateQuote(qi, { slug: slugify(e.target.value) })}
                      />
                    </div>
                    <div className="admin-qfield admin-qfield-sm">
                      <label>Date</label>
                      <input
                        className="admin-input"
                        type="date"
                        value={q.date}
                        onChange={(e) => updateQuote(qi, { date: e.target.value })}
                      />
                    </div>
                    <div className="admin-qfield admin-qfield-sm">
                      <label>Valid through</label>
                      <input
                        className="admin-input"
                        type="date"
                        value={q.validThrough}
                        onChange={(e) => updateQuote(qi, { validThrough: e.target.value })}
                      />
                    </div>
                  </div>
                  <div className="admin-quote-meta">
                    {slug
                      ? <a className="admin-link" href={`/quote/${slug}`} target="_blank" rel="noreferrer">typografie.be/quote/{slug} ↗</a>
                      : <span className="admin-muted">set a project name or slug for a URL</span>}
                    <button className="admin-arrow admin-danger" type="button" onClick={() => removeQuote(qi)}>Delete quote</button>
                  </div>

                  {q.options.map((o, oi) => {
                    const d = designCost(o)
                    const kind = optionKind(o)
                    const spec = optionSpec(o)
                    return (
                      <div key={oi} className="admin-option">
                        <div className="admin-asset-row admin-asset-row-two">
                          <div className="admin-qfield">
                            <label>Option title</label>
                            <input
                              className="admin-input"
                              value={o.title}
                              placeholder={`Option ${oi + 1}`}
                              onChange={(e) => updateOption(qi, oi, { title: e.target.value })}
                            />
                          </div>
                          <div className="admin-qfield">
                            <label>Type</label>
                            <div className="admin-kind">
                              {(['branding', 'typeface'] as OptionKind[]).map((k) => (
                                <button
                                  key={k}
                                  type="button"
                                  className={`admin-subtab${kind === k ? ' is-active' : ''}`}
                                  onClick={() => updateOption(qi, oi, { kind: k })}
                                >{k === 'branding' ? 'Branding' : 'Typeface'}</button>
                              ))}
                            </div>
                          </div>
                        </div>
                        <div className="admin-qfield">
                          <label>Description</label>
                          <textarea
                            className="admin-input admin-input-area"
                            value={o.description}
                            rows={3}
                            onChange={(e) => updateOption(qi, oi, { description: e.target.value })}
                          />
                          <span className="admin-hint">Supports <code>**bold**</code>, <code>*italic*</code>, <code>[link](url)</code>, <code>- bullets</code>, <code>1. numbered</code></span>
                        </div>

                        {kind === 'typeface' && (
                          <EstimateField
                            option={o}
                            quoteDate={q.date}
                            onChange={(patch) => updateOption(qi, oi, patch)}
                          />
                        )}

                        <PlanEditor
                          option={o}
                          onChange={(patch) => updateOption(qi, oi, patch)}
                          blockedDays={blockedDaysSet}
                        />

                        <PicturesField
                          pictures={o.pictures || []}
                          onChange={(pictures) => updateOption(qi, oi, { pictures })}
                          library={images}
                          size="md"
                          label="Option pictures"
                        />

                        {/* Hand-priced typeface assets predate the estimate link.
                            Only options that already carry them show this — new
                            typeface options price themselves from the link above. */}
                        {o.assets.length > 0 && (
                        <div className="admin-assets">
                          <label className="admin-hint admin-muted">Hand-priced assets (legacy)</label>
                          {o.assets.map((a, ai) => (
                            <div key={ai} className="admin-asset">
                              <div className="admin-asset-grid">
                                <label className="admin-field af-name">
                                  <span>Asset</span>
                                  <input
                                    className="admin-input"
                                    value={a.name}
                                    placeholder="Display Typeface"
                                    onChange={(e) => updateAsset(qi, oi, ai, { name: e.target.value })}
                                  />
                                </label>
                                <label className="admin-field af-variable">
                                  <span>Variable</span>
                                  <input
                                    className="admin-input"
                                    value={a.variable}
                                    placeholder="1 Axis"
                                    onChange={(e) => updateAsset(qi, oi, ai, { variable: e.target.value })}
                                  />
                                </label>
                                <label className="admin-field af-price">
                                  <span>Price</span>
                                  <input
                                    className="admin-input admin-input-num"
                                    type="number"
                                    inputMode="numeric"
                                    value={a.price || ''}
                                    placeholder="3600"
                                    onChange={(e) => updateAsset(qi, oi, ai, { price: Number(e.target.value) || 0 })}
                                  />
                                </label>
                                <button
                                  className="admin-arrow admin-danger af-del"
                                  type="button"
                                  onClick={() => removeAsset(qi, oi, ai)}
                                  disabled={o.assets.length === 1 && (o.items || []).length === 0}
                                  aria-label="Remove asset"
                                  title="Remove asset"
                                >×</button>
                              </div>
                              <div className="admin-asset-row admin-asset-row-two">
                                <div className="admin-qfield">
                                  <label>Italic option</label>
                                  <label className="admin-checkbox">
                                    <input
                                      type="checkbox"
                                      checked={a.offersItalic}
                                      onChange={(e) => updateAsset(qi, oi, ai, { offersItalic: e.target.checked })}
                                    />
                                    <span>Offer Italic (+70% of this asset&rsquo;s price). Oblique is the free default.</span>
                                  </label>
                                </div>
                                <div className="admin-qfield">
                                  <label>Styles (one per line)</label>
                                  <textarea
                                    className="admin-input admin-input-area"
                                    value={a.styles.join('\n')}
                                    rows={3}
                                    placeholder={'400 Regular (+Oblique)\n500 Medium (+Oblique)\nVariable'}
                                    onChange={(e) => updateAsset(qi, oi, ai, { styles: rawLines(e.target.value) })}
                                  />
                                </div>
                              </div>
                              <PicturesField
                                pictures={a.pictures || []}
                                onChange={(pictures) => updateAsset(qi, oi, ai, { pictures })}
                                library={images}
                                size="sm"
                                label="Pictures"
                              />
                            </div>
                          ))}
                          <button className="admin-arrow" type="button" onClick={() => addAsset(qi, oi)}>+ Add asset</button>
                        </div>
                        )}

                        <div className="admin-assets">
                          {(o.items || []).map((it, ii) => {
                            const isDragOver = itemDragOver?.oi === oi && itemDragOver.over === ii && itemDragRef.current?.from !== ii
                            return (
                            <div
                              key={ii}
                              className={`admin-asset${isDragOver ? ' is-drag-over' : ''}`}
                              onDragOver={(e) => {
                                if (itemDragRef.current?.oi !== oi) return
                                e.preventDefault()
                                e.dataTransfer.dropEffect = 'move'
                                if (itemDragOver?.over !== ii) setItemDragOver({ oi, over: ii })
                              }}
                              onDrop={(e) => {
                                if (itemDragRef.current?.oi !== oi) return
                                e.preventDefault()
                                reorderItem(qi, oi, itemDragRef.current.from, ii)
                                itemDragRef.current = null
                                setItemDragOver(null)
                              }}
                            >
                              <div className="admin-item-grid">
                                <div className="admin-item-tools">
                                  <button
                                    className="admin-item-handle"
                                    type="button"
                                    draggable
                                    onDragStart={(e) => {
                                      itemDragRef.current = { oi, from: ii }
                                      setItemDragOver({ oi, over: ii })
                                      e.dataTransfer.effectAllowed = 'move'
                                      e.dataTransfer.setData('text/plain', String(ii))
                                    }}
                                    onDragEnd={() => {
                                      itemDragRef.current = null
                                      setItemDragOver(null)
                                    }}
                                    aria-label="Drag to reorder"
                                    title="Drag to reorder"
                                  >⋮⋮</button>
                                  {/* Arrow fallback — HTML5 drag never fires on touch,
                                      so reordering has to work without it on phones. */}
                                  <button
                                    className="admin-arrow"
                                    type="button"
                                    onClick={() => reorderItem(qi, oi, ii, ii - 1)}
                                    disabled={ii === 0}
                                    aria-label="Move item up"
                                  >↑</button>
                                  <button
                                    className="admin-arrow"
                                    type="button"
                                    onClick={() => reorderItem(qi, oi, ii, ii + 1)}
                                    disabled={ii === (o.items || []).length - 1}
                                    aria-label="Move item down"
                                  >↓</button>
                                </div>
                                <label className="admin-field ai-name">
                                  <span>Item</span>
                                  <input
                                    className="admin-input"
                                    value={it.name}
                                    placeholder="Motionlogo"
                                    onChange={(e) => updateItem(qi, oi, ii, { name: e.target.value })}
                                  />
                                </label>
                                <label className="admin-field ai-unit">
                                  <span>Unit</span>
                                  <input
                                    className="admin-input"
                                    value={it.unit}
                                    placeholder="per video"
                                    onChange={(e) => updateItem(qi, oi, ii, { unit: e.target.value })}
                                  />
                                </label>
                                <label className="admin-field ai-qty">
                                  <span>Qty / days</span>
                                  <input
                                    className="admin-input admin-input-num"
                                    type="number"
                                    inputMode="numeric"
                                    min={1}
                                    value={it.quantity || ''}
                                    placeholder="1"
                                    onChange={(e) => updateItem(qi, oi, ii, { quantity: Number(e.target.value) || 0 })}
                                  />
                                </label>
                                <label className="admin-field ai-price">
                                  <span>Unit price</span>
                                  <input
                                    className="admin-input admin-input-num"
                                    type="number"
                                    inputMode="numeric"
                                    value={it.unitPrice || ''}
                                    placeholder="2500"
                                    onChange={(e) => updateItem(qi, oi, ii, { unitPrice: Number(e.target.value) || 0 })}
                                  />
                                </label>
                                <button
                                  className="admin-arrow admin-danger ai-del"
                                  type="button"
                                  onClick={() => removeItem(qi, oi, ii)}
                                  aria-label="Remove item"
                                  title="Remove item"
                                >×</button>
                              </div>
                              <div className="admin-qfield">
                                <label>Description (optional)</label>
                                <textarea
                                  className="admin-input admin-input-area"
                                  value={it.description}
                                  rows={2}
                                  placeholder="What's included, deliverables, scope notes…"
                                  onChange={(e) => updateItem(qi, oi, ii, { description: e.target.value })}
                                />
                                <span className="admin-hint">Supports <code>**bold**</code>, <code>*italic*</code>, <code>[link](url)</code>, <code>- bullets</code>, <code>1. numbered</code></span>
                              </div>
                              <PicturesField
                                pictures={it.pictures || []}
                                onChange={(pictures) => updateItem(qi, oi, ii, { pictures })}
                                library={images}
                                size="sm"
                                label="Pictures"
                              />
                            </div>
                            )
                          })}
                          <button className="admin-arrow" type="button" onClick={() => addItem(qi, oi)}>+ Add item (flat fee)</button>
                        </div>

                        <div className="admin-price-preview">
                          {spec && (
                            <>
                              <span>Typeface {formatEur(typefaceTotal(spec, quoteAsOf(q.date)))}</span>
                              {spec.licensing !== 'buyout' && (
                                <span>then {formatEur(typefaceRenewal(spec))} / yr</span>
                              )}
                            </>
                          )}
                          {o.assets.length > 0 && (
                            <>
                              {spec && <span>·</span>}
                              <span>Design cost {formatEur(d)}</span>
                              <span>·</span>
                              <span>Perpetual {formatEur(perpetualTotal(d))} one-time</span>
                              <span>·</span>
                              <span>Annual {formatEur(annualFirstYear(d))} first year, then {formatEur(annualYearly(d))} / yr</span>
                            </>
                          )}
                          {(o.items || []).length > 0 && (
                            <>
                              {(o.assets.length > 0 || spec) && <span>·</span>}
                              <span>Items {formatEur(itemsTotal(o))} flat</span>
                            </>
                          )}
                        </div>

                        <button
                          className="admin-arrow admin-danger"
                          type="button"
                          onClick={() => removeOption(qi, oi)}
                          disabled={q.options.length === 1}
                        >Remove option</button>
                      </div>
                    )
                  })}
                  <div className="admin-add-options">
                    <button className="admin-arrow" type="button" onClick={() => addOption(qi, 'branding')}>+ Branding option</button>
                    <button className="admin-arrow" type="button" onClick={() => addOption(qi, 'typeface')}>+ Typeface option</button>
                  </div>
                </div>
              )
            })}
          </div>
        )}

        {tab === 'images' && (
          <>
            <div className="admin-filter-row">
              <select
                className="admin-select"
                value={projectFilter}
                onChange={(e) => setProjectFilter(e.target.value)}
              >
                {projects.map(p => (
                  <option key={p} value={p}>{p ? p : `All projects (${images.length})`}</option>
                ))}
              </select>
              <label className="admin-checkbox">
                <input
                  type="checkbox"
                  checked={showHidden}
                  onChange={(e) => setShowHidden(e.target.checked)}
                />
                <span>Show hidden ({hiddenCount})</span>
              </label>
              <span className="admin-muted">{filteredImages.length} {filteredImages.length === 1 ? 'image' : 'images'}</span>
            </div>
            <div className="admin-grid">
              {filteredImages.map(img => {
                const deleting = deletingIds.has(img.id)
                const toggling = togglingIds.has(img.id)
                return (
                  <div key={img.id} className={`admin-tile${deleting ? ' is-deleting' : ''}${img.hidden ? ' is-hidden' : ''}`}>
                    {img.isFont
                      ? <div className="admin-tile-font">Aa</div>
                      : <img src={img.url} alt={img.name} loading="lazy" />}
                    <button
                      type="button"
                      className="admin-tile-btn admin-hide"
                      onClick={() => toggleHide(img)}
                      disabled={toggling || deleting}
                      aria-label={img.hidden ? `Unhide ${img.name}` : `Hide ${img.name}`}
                      title={img.hidden ? 'Unhide' : 'Hide'}
                    >{img.hidden ? '◉' : '◎'}</button>
                    <button
                      type="button"
                      className="admin-tile-btn admin-delete"
                      onClick={() => deleteImg(img)}
                      disabled={deleting || toggling}
                      aria-label={`Delete ${img.name}`}
                      title="Delete"
                    >{deleting ? '…' : '×'}</button>
                    <div className="admin-tile-meta">
                      {img.hidden && <span className="admin-tile-tag">Hidden</span>}
                      {img.project && <span className="admin-tile-project">{img.project}</span>}
                      <span className="admin-tile-name">{img.name}</span>
                    </div>
                  </div>
                )
              })}
            </div>
          </>
        )}

        <p className="admin-muted admin-hint">
          {tab === 'work' && 'Drag rows to reorder, or use the arrows. New projects from Dropbox auto-prepend until you save a new order.'}
          {tab === 'about' && 'One paragraph per line. Empty lines are ignored.'}
          {tab === 'sentences' && 'Size sets the type size on each typeface tile; weight, width and leading set how it renders. Weight and width show only for fonts that have those axes. The preview updates live — click it for another sample string. Sentences are the sample texts, one per line. Changes go live on Save.'}
          {tab === 'images' && 'Click ◎ to hide an image from the public site (file stays in Dropbox). Click × to delete it from Dropbox — your Mac will sync the deletion within seconds. Deletion cannot be undone.'}
          {tab === 'quotes' && 'Branding options are flat-fee items you price yourself. Typeface options are priced from a link pasted out of /estimate — build the family there, paste the URL, and the quote shows that spec and figure, locked (the client cannot change it). Both take planning and pictures. Footnotes are written automatically from the licensing you chose. Changes go live on Save.'}
        </p>
      </main>
    </>
  )
}

// One typeface in the Type tab: a live tile preview (click for another
// sample string) plus size, weight, width and leading controls. Weight and
// width only appear when the font actually has that axis. All per font.
function FontAxisRow({
  font,
  axes,
  sentences,
  onChange,
}: {
  font: { id: string; name: string; url: string }
  axes: Record<string, number>
  sentences: string[]
  onChange: (next: Record<string, number>) => void
}) {
  const family = useMemo(() => 'adm-' + font.id.replace(/[^a-zA-Z0-9]/g, '-'), [font.id])
  const [parsed, setParsed] = useState<Axis[]>([])
  const [charset, setCharset] = useState<Set<number> | null>(null)
  const [sentenceIdx, setSentenceIdx] = useState(() =>
    Math.floor(Math.random() * Math.max(1, sentences.length)),
  )

  useEffect(() => {
    let cancelled = false
    if (!font.url) return
    fetch(font.url)
      .then((r) => r.arrayBuffer())
      .then((buf) => {
        if (cancelled) return
        const ff = new FontFace(family, buf)
        return ff.load().then((loaded) => {
          if (cancelled) return
          document.fonts.add(loaded)
          setParsed(parseVariationAxes(buf))
          setCharset(parseCharSet(buf))
        })
      })
      .catch(() => {})
    return () => { cancelled = true }
  }, [font.url, family])

  const wght = parsed.find((a) => a.tag === 'wght')
  const wdth = parsed.find((a) => a.tag === 'wdth')
  const weight = axes.wght ?? DEFAULT_PREVIEW_WEIGHT
  const width = axes.wdth ?? wdth?.default ?? 100
  const leading = axes.leading ?? DEFAULT_PREVIEW_LEADING
  const size = axes.size ?? DEFAULT_PREVIEW_SIZE
  const settings = `"wght" ${weight}` + (wdth ? `, "wdth" ${width}` : '')

  const pool = sentences.length
    ? sentences.map((s) => glyphSafeText(s, charset))
    : [font.name]
  const sentence = pool[sentenceIdx % pool.length]

  return (
    <div className="admin-typeface">
      <div
        className="admin-typeface-tile"
        onClick={() => setSentenceIdx((i) => i + 1)}
        title="Click for another sample string"
      >
          <div
            className="admin-typeface-text"
            style={{
              fontFamily: `'${family}', sans-serif`,
              fontVariationSettings: settings,
              fontWeight: weight,
              lineHeight: leading,
              fontSize: size,
            }}
          >
            {sentence}
          </div>
      </div>
      <div className="admin-typeface-controls">
        <span className="admin-typeface-name">{font.name}</span>
        <label className="admin-axis">
          <span className="admin-axis-label">Size</span>
          <input
            type="range"
            min={8}
            max={140}
            step={1}
            value={size}
            onChange={(e) => onChange({ ...axes, size: Number(e.target.value) })}
          />
          <span className="admin-axis-value">{Math.round(size)}</span>
        </label>
        {wght && (
          <label className="admin-axis">
            <span className="admin-axis-label">Weight</span>
            <input
              type="range"
              min={Math.round(wght.min)}
              max={Math.round(wght.max)}
              step={1}
              value={weight}
              onChange={(e) => onChange({ ...axes, wght: Number(e.target.value) })}
            />
            <span className="admin-axis-value">{Math.round(weight)}</span>
          </label>
        )}
        {wdth && (
          <label className="admin-axis">
            <span className="admin-axis-label">Width</span>
            <input
              type="range"
              min={wdth.min}
              max={wdth.max}
              step={(wdth.max - wdth.min) / 200 || 1}
              value={width}
              onChange={(e) => onChange({ ...axes, wdth: Number(e.target.value) })}
            />
            <span className="admin-axis-value">{Math.round(width)}</span>
          </label>
        )}
        <label className="admin-axis">
          <span className="admin-axis-label">Leading</span>
          <input
            type="range"
            min={0.8}
            max={2.4}
            step={0.01}
            value={leading}
            onChange={(e) => onChange({ ...axes, leading: Number(e.target.value) })}
          />
          <span className="admin-axis-value">{leading.toFixed(2)}</span>
        </label>
      </div>
    </div>
  )
}

// Typeface options are priced from a link pasted out of /estimate: configure
// the family there, paste the URL here, and the quote reads its price from the
// same engine the public calculator uses. Parses as you type so a bad paste
// shows up before saving, and the figure is previewed against the quote's date
// (which is what the public page prices against).
function EstimateField({
  option,
  quoteDate,
  onChange,
}: {
  option: QuoteOption
  quoteDate: string
  onChange: (patch: Partial<QuoteOption>) => void
}) {
  const raw = option.estimateUrl || ''
  const spec = raw.trim() ? parseEstimateLink(raw) : null
  const asOf = quoteAsOf(quoteDate)
  return (
    <div className="admin-qfield">
      <label>Estimate link</label>
      <input
        className="admin-input"
        value={raw}
        placeholder="https://www.typografie.be/estimate?w=3&d=2&slant=none&cs=full&size=mid&media=desktop,web&lic=buyout"
        onChange={(e) => onChange({ estimateUrl: e.target.value })}
        spellCheck={false}
      />
      {!raw.trim() && (
        <span className="admin-hint admin-muted">
          Build the typeface on <a className="admin-link" href="/estimate" target="_blank" rel="noreferrer">/estimate</a>, then paste the URL here. The quote prices itself from it.
        </span>
      )}
      {raw.trim() && !spec && (
        <span className="admin-hint admin-danger">Not an estimate link — copy the whole URL from the address bar on /estimate.</span>
      )}
      {spec && (
        <>
          <div className="admin-estimate">
            {typefaceSpecRows(spec).map((r) => (
              <div key={r.label} className="admin-estimate-row">
                <span className="admin-estimate-label">{r.label}</span>
                <span>{r.value}</span>
              </div>
            ))}
          </div>
          <div className="admin-price-preview">
            <span>{typefaceTotalLabel(spec.licensing)} {formatEur(typefaceTotal(spec, asOf))}</span>
            {spec.licensing !== 'buyout' && (
              <>
                <span>·</span>
                <span>renews at {formatEur(typefaceRenewal(spec))} / yr</span>
              </>
            )}
            <span>·</span>
            <a className="admin-link" href={optionEstimateLink(spec)} target="_blank" rel="noreferrer">Open in estimate ↗</a>
          </div>
        </>
      )}
    </div>
  )
}

function PicturesField({
  pictures,
  onChange,
  library,
  size = 'sm',
  label,
}: {
  pictures: QuotePicture[]
  onChange: (next: QuotePicture[]) => void
  library: AdminImage[]
  size?: 'sm' | 'md'
  label?: string
}) {
  const [open, setOpen] = useState(false)
  const remove = (i: number) => {
    if (!confirm('Remove this picture?')) return
    onChange(pictures.filter((_, j) => j !== i))
  }
  const pick = (p: QuotePicture) => {
    onChange([...pictures, p])
    setOpen(false)
  }
  return (
    <div className="admin-qfield">
      {label && <label>{label}</label>}
      <div className="admin-pictures">
        {pictures.map((p, i) => (
          <img
            key={i}
            src={p.src}
            alt={p.alt || ''}
            className={`admin-picture${size === 'md' ? ' is-md' : ''}`}
            onClick={() => remove(i)}
            title="Click to remove"
          />
        ))}
        <button
          className={`admin-picture-add${size === 'md' ? ' is-md' : ''}`}
          type="button"
          onClick={() => setOpen(true)}
          aria-label="Add picture"
        >+</button>
      </div>
      {open && (
        <PicturePicker
          onClose={() => setOpen(false)}
          onPick={pick}
          library={library}
        />
      )}
    </div>
  )
}

function PicturePicker({
  onClose,
  onPick,
  library,
}: {
  onClose: () => void
  onPick: (p: QuotePicture) => void
  library: AdminImage[]
}) {
  const [mode, setMode] = useState<'library' | 'upload'>('library')
  const [uploading, setUploading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const nonFonts = library.filter((i) => !i.isFont && !i.hidden)

  const handleFile = async (file: File) => {
    setError(null)
    if (!file.type.startsWith('image/')) { setError('Not an image'); return }
    if (file.size > 4 * 1024 * 1024) { setError('Max 4 MB'); return }
    setUploading(true)
    try {
      const fd = new FormData()
      fd.append('file', file)
      const res = await fetch('/api/admin/upload', { method: 'POST', body: fd })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(data?.error || 'upload failed')
      onPick({ src: String(data.url) })
    } catch (e) {
      setError(e instanceof Error ? e.message : 'upload failed')
    } finally {
      setUploading(false)
    }
  }

  return (
    <div className="admin-picker-backdrop" onClick={onClose}>
      <div className="admin-picker" onClick={(e) => e.stopPropagation()}>
        <div className="admin-picker-head">
          <div className="admin-picker-tabs">
            <button
              type="button"
              className={`admin-subtab${mode === 'library' ? ' is-active' : ''}`}
              onClick={() => setMode('library')}
            >Library</button>
            <button
              type="button"
              className={`admin-subtab${mode === 'upload' ? ' is-active' : ''}`}
              onClick={() => setMode('upload')}
            >Upload</button>
          </div>
          <button
            type="button"
            className="admin-arrow"
            onClick={onClose}
            aria-label="Close picker"
          >×</button>
        </div>
        {mode === 'library' ? (
          nonFonts.length === 0 ? (
            <p className="admin-muted">No images in the library.</p>
          ) : (
            <div className="admin-picker-grid">
              {nonFonts.map((img) => (
                <img
                  key={img.id}
                  src={img.url}
                  alt={img.name}
                  className="admin-picker-thumb"
                  onClick={() => onPick({ src: img.url, alt: img.name })}
                  title={img.name}
                />
              ))}
            </div>
          )
        ) : (
          <div className="admin-picker-upload">
            <input
              type="file"
              accept="image/*"
              disabled={uploading}
              onChange={(e) => {
                const f = e.target.files?.[0]
                if (f) handleFile(f)
                e.target.value = ''
              }}
            />
            <p className="admin-muted">Max 4 MB. Image files only.</p>
            {uploading && <p className="admin-muted">Uploading…</p>}
            {error && <p className="admin-danger">{error}</p>}
          </div>
        )}
      </div>
    </div>
  )
}

type PlanSource = {
  key: string
  kind: PlanBlockKind
  itemIndex?: number
  label: string
  total: number
  placed: number
}

function planSources(option: QuoteOption): PlanSource[] {
  const placed = option.planBlocks || []
  const items = option.items || []
  const out: PlanSource[] = []
  items.forEach((it, i) => {
    const total = Math.max(0, Math.round(Number(it.quantity) || 0))
    if (total === 0) return
    const used = placed.filter((b) => b.kind === 'item' && b.itemIndex === i).length
    out.push({ key: `i-${i}`, kind: 'item', itemIndex: i, label: it.name || `Item ${i + 1}`, total, placed: used })
  })
  // Typeface phases — unlimited pools, only on typeface options (priced from an
  // estimate link, or carrying legacy hand-priced assets). They let a typeface
  // project be planned day-by-day the way items already are.
  if (optionKind(option) === 'typeface' || (option.assets || []).length > 0) {
    TYPEFACE_PHASES.forEach((p) => {
      out.push({
        key: `ph-${p.kind}`, kind: p.kind, label: p.label, total: 0,
        placed: placed.filter((b) => b.kind === p.kind).length,
      })
    })
  }
  // Presentation + feedback are unlimited pools (total: 0 by convention).
  // The user drags as many as they need without preconfiguring a count.
  out.push({
    key: 'pres', kind: 'presentation', label: 'Presentation', total: 0,
    placed: placed.filter((b) => b.kind === 'presentation').length,
  })
  out.push({
    key: 'fb', kind: 'feedback', label: 'Feedback', total: 0,
    placed: placed.filter((b) => b.kind === 'feedback').length,
  })
  return out
}

function fmtDateLocal(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

function PlanEditor({
  option,
  onChange,
  blockedDays,
}: {
  option: QuoteOption
  onChange: (patch: Partial<QuoteOption>) => void
  blockedDays: Set<string>
}) {
  const placed = option.planBlocks || []
  const sources = planSources(option)
  const totalPool = sources.reduce((s, x) => s + x.total, 0)

  const initialMonth = (() => {
    if (option.startDate) {
      const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(option.startDate)
      if (m) return new Date(Number(m[1]), Number(m[2]) - 1, 1)
    }
    const t = new Date()
    return new Date(t.getFullYear(), t.getMonth(), 1)
  })()
  const [month, setMonth] = useState<Date>(initialMonth)
  const [armedKey, setArmedKey] = useState<string | null>(null)

  const placedByDate = useMemo(() => {
    const map = new Map<string, PlanBlock[]>()
    for (const b of placed) {
      const arr = map.get(b.date)
      if (arr) arr.push(b)
      else map.set(b.date, [b])
    }
    return map
  }, [placed])

  const monthLabel = month.toLocaleString('en-GB', { month: 'long', year: 'numeric' })

  const gridDays: { date: string; inMonth: boolean; isToday: boolean }[] = useMemo(() => {
    const first = new Date(month.getFullYear(), month.getMonth(), 1)
    const startDow = (first.getDay() + 6) % 7 // Mon=0
    const start = new Date(first)
    start.setDate(first.getDate() - startDow)
    const today = new Date()
    const todayIso = fmtDateLocal(today)
    const cells: { date: string; inMonth: boolean; isToday: boolean }[] = []
    for (let i = 0; i < 42; i++) {
      const d = new Date(start)
      d.setDate(start.getDate() + i)
      cells.push({
        date: fmtDateLocal(d),
        inMonth: d.getMonth() === month.getMonth(),
        isToday: fmtDateLocal(d) === todayIso,
      })
    }
    return cells
  }, [month])

  const isWeekend = (iso: string): boolean => {
    const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso)
    if (!m) return false
    const d = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]))
    const dow = d.getDay()
    return dow === 0 || dow === 6
  }
  // Feedback is waiting time, not active work — Martijn can mark days he's
  // busy on his calendar as feedback time too. Items + presentation still
  // reject on blocked days. Weekends still reject everything.
  const dragKindRef = useRef<PlanBlockKind | null>(null)
  const canPlace = (iso: string, kind: PlanBlockKind | null): boolean => {
    if (isWeekend(iso)) return false
    if (!blockedDays.has(iso)) return true
    return kind === 'feedback'
  }
  const canDropOn = (iso: string): boolean => canPlace(iso, dragKindRef.current)

  const addBlock = (kind: PlanBlockKind, itemIndex: number | undefined, iso: string) => {
    const block: PlanBlock = {
      id: `pb-${Math.random().toString(36).slice(2, 10)}`,
      kind,
      date: iso,
      ...(kind === 'item' && typeof itemIndex === 'number' ? { itemIndex } : {}),
    }
    onChange({ planBlocks: [...placed, block] })
  }

  // Tap-to-place. HTML5 drag events never fire on touch, so on a phone this
  // is the only way to plan — and with a mouse it's still quicker for laying
  // down a run of days. Tap a source to arm it, then tap days.
  const armed = armedKey ? sources.find((s) => s.key === armedKey) || null : null
  const handleDayTap = (iso: string) => {
    if (!armed) return
    if (armed.total > 0 && armed.placed >= armed.total) { setArmedKey(null); return }
    if (!canPlace(iso, armed.kind)) return
    addBlock(armed.kind, armed.itemIndex, iso)
    if (armed.total > 0 && armed.placed + 1 >= armed.total) setArmedKey(null)
  }

  const handleSourceDragStart = (e: React.DragEvent<HTMLButtonElement>, src: PlanSource) => {
    if (src.total > 0 && src.placed >= src.total) { e.preventDefault(); return }
    dragKindRef.current = src.kind
    const payload = { mode: 'new', kind: src.kind, itemIndex: src.itemIndex }
    e.dataTransfer.setData('application/x-planblock', JSON.stringify(payload))
    e.dataTransfer.effectAllowed = 'copy'
  }

  const handleBlockDragStart = (e: React.DragEvent<HTMLDivElement>, block: PlanBlock) => {
    e.stopPropagation()
    dragKindRef.current = block.kind
    const payload = { mode: 'move', id: block.id }
    e.dataTransfer.setData('application/x-planblock', JSON.stringify(payload))
    e.dataTransfer.effectAllowed = 'move'
  }

  const clearDragKind = () => { dragKindRef.current = null }

  const handleDayDragOver = (e: React.DragEvent<HTMLDivElement>, iso: string) => {
    if (!canDropOn(iso)) return
    e.preventDefault()
    e.dataTransfer.dropEffect = 'move'
  }

  const handleDayDrop = (e: React.DragEvent<HTMLDivElement>, iso: string) => {
    e.preventDefault()
    if (!canDropOn(iso)) { clearDragKind(); return }
    const raw = e.dataTransfer.getData('application/x-planblock')
    if (!raw) { clearDragKind(); return }
    let payload: { mode: 'new' | 'move'; kind?: PlanBlockKind; itemIndex?: number; id?: string }
    try { payload = JSON.parse(raw) } catch { clearDragKind(); return }
    if (payload.mode === 'new' && payload.kind) {
      addBlock(payload.kind, payload.itemIndex, iso)
    } else if (payload.mode === 'move' && payload.id) {
      onChange({ planBlocks: placed.map((b) => b.id === payload.id ? { ...b, date: iso } : b) })
    }
    clearDragKind()
  }

  const removeBlock = (id: string) => {
    onChange({ planBlocks: placed.filter((b) => b.id !== id) })
  }

  const goMonth = (delta: number) => {
    setMonth(new Date(month.getFullYear(), month.getMonth() + delta, 1))
  }

  return (
    <div className="admin-qfield">
      <div className="admin-asset-row admin-asset-row-two">
        <div className="admin-qfield admin-qfield-sm">
          <label>Planning kickoff (auto-chain fallback)</label>
          <input
            className="admin-input"
            type="date"
            value={option.startDate || ''}
            onChange={(e) => onChange({ startDate: e.target.value || undefined })}
          />
        </div>
      </div>
      <span className="admin-hint">Tap a block to pick it up, then tap the days it should land on — or drag it across on a desktop. Tap a placed block to remove it. Weekends, Belgian holidays, and busy days from your calendar are greyed out. Typeface phases, presentation, and feedback are unlimited.</span>

      {sources.length > 0 && (
        <>
          <div className="plan-sources">
            {sources.map((src) => {
              const unlimited = src.total === 0
              const remaining = unlimited ? Infinity : src.total - src.placed
              const done = !unlimited && remaining === 0
              const isArmed = armedKey === src.key
              return (
                <button
                  key={src.key}
                  type="button"
                  className={`plan-source plan-source-${src.kind}${done ? ' is-done' : ''}${isArmed ? ' is-armed' : ''}`}
                  draggable={!done}
                  disabled={done}
                  aria-pressed={isArmed}
                  onClick={() => setArmedKey(isArmed ? null : src.key)}
                  onDragStart={(e) => handleSourceDragStart(e, src)}
                  onDragEnd={clearDragKind}
                  title={done ? `${src.label} fully placed` : unlimited ? `Tap, then tap days (${src.placed} placed)` : `Tap, then tap days (${remaining} left)`}
                >
                  <span className="plan-source-label">{src.label}</span>
                  <span className="plan-source-count">{unlimited ? src.placed : `${src.placed}/${src.total}`}</span>
                </button>
              )
            })}
          </div>

          {armed && (
            <p className="plan-armed-hint">
              <span><strong>{armed.label}</strong> picked up — tap the days it should land on.</span>
              <button type="button" className="admin-arrow" onClick={() => setArmedKey(null)}>Cancel</button>
            </p>
          )}

          <div className={`plan-cal${armed ? ' is-placing' : ''}`}>
            <div className="plan-cal-head">
              <button type="button" className="admin-arrow" onClick={() => goMonth(-1)} aria-label="Previous month">‹</button>
              <span className="plan-cal-month">{monthLabel}</span>
              <button type="button" className="admin-arrow" onClick={() => goMonth(1)} aria-label="Next month">›</button>
            </div>
            <div className="plan-cal-scroll">
              <div className="plan-cal-body">
                <div className="plan-cal-dows">
                  {['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'].map((d) => <span key={d}>{d}</span>)}
                </div>
                <div className="plan-cal-grid">
                  {gridDays.map((cell) => {
                    const blocks = placedByDate.get(cell.date) || []
                    const weekend = isWeekend(cell.date)
                    const blocked = blockedDays.has(cell.date)
                    const targetable = !!armed && canPlace(cell.date, armed.kind)
                    const classes = ['plan-cal-day']
                    if (!cell.inMonth) classes.push('is-out')
                    if (weekend) classes.push('is-weekend')
                    if (blocked) classes.push('is-blocked')
                    if (cell.isToday) classes.push('is-today')
                    if (targetable) classes.push('is-target')
                    return (
                      <div
                        key={cell.date}
                        className={classes.join(' ')}
                        onDragOver={(e) => handleDayDragOver(e, cell.date)}
                        onDrop={(e) => handleDayDrop(e, cell.date)}
                        onClick={() => handleDayTap(cell.date)}
                      >
                        <span className="plan-cal-daynum">{cell.date.slice(8, 10).replace(/^0/, '')}</span>
                        <div className="plan-cal-blocks">
                          {blocks.map((b) => {
                            const label = b.kind === 'item'
                              ? (option.items[b.itemIndex ?? -1]?.name || 'Item')
                              : planKindLabel(b.kind, true)
                            return (
                              <div
                                key={b.id}
                                className={`plan-cal-block plan-cal-block-${b.kind}`}
                                draggable
                                onDragStart={(e) => handleBlockDragStart(e, b)}
                                onDragEnd={clearDragKind}
                                onClick={(e) => { e.stopPropagation(); removeBlock(b.id) }}
                                title={`${label} — tap to remove`}
                              >{label}</div>
                            )
                          })}
                        </div>
                      </div>
                    )
                  })}
                </div>
              </div>
            </div>
          </div>
        </>
      )}
    </div>
  )
}

function AdminStyles() {
  return (
    <style dangerouslySetInnerHTML={{ __html: `
.admin-page { max-width: 960px; margin: 0 auto; padding: 0 32px 96px; display: flex; flex-direction: column; gap: 24px; }
.admin-login { position: fixed; inset: 0; display: flex; align-items: center; justify-content: center; background: #fff; z-index: 50; }
/* Sticky toolbar. Full-bleed inside the page's own horizontal padding, with
   the left inset reserved for the fixed site logo so the tabs never slide
   underneath it. The hairline only appears once the page has scrolled. */
.admin-header {
  position: sticky; top: 0; z-index: 40;
  margin: 0 -32px;
  padding: 24px 32px 16px 80px;
  display: flex; justify-content: space-between; align-items: center; gap: 12px;
  background: rgba(248,248,248,0.86);
  -webkit-backdrop-filter: saturate(180%) blur(20px);
  backdrop-filter: saturate(180%) blur(20px);
  box-shadow: 0 1px 0 rgba(0,0,0,0);
  transition: box-shadow 0.2s;
}
.admin-header.is-stuck { box-shadow: 0 1px 0 rgba(0,0,0,0.08); }
.admin-tabs { display: flex; gap: 4px; flex: 1 1 auto; min-width: 0; overflow-x: auto; scrollbar-width: none; -ms-overflow-style: none; -webkit-overflow-scrolling: touch; }
.admin-tabs::-webkit-scrollbar { display: none; }
/* min-height matches the Save button, so the tabs sit at the same height
   whether the right side holds the button or the Images tab's plain text —
   on mobile that row height is what keeps the tabs clear of the logo. */
.admin-save-row { display: flex; align-items: center; gap: 10px; flex: 0 0 auto; min-height: 38px; }
.admin-saved, .admin-autosave { font-size: 13px; white-space: nowrap; }
.admin-tab { flex: 0 0 auto; white-space: nowrap; background: transparent; border: 0; padding: 10px 14px; border-radius: 12px; font: inherit; color: #000; cursor: pointer; transition: background 0.12s, opacity 0.12s, color 0.12s; }
.admin-tab:hover:not(:disabled):not(.is-active):not(.is-primary) { background: rgba(0,0,0,0.05); }
.admin-tab.is-active { background: #fff; }
.admin-tab.is-primary { background: #fff; }
.admin-tab.is-primary.is-dirty { background: #000; color: #fff; }
.admin-tab:disabled { opacity: 0.3; cursor: not-allowed; }
.admin-list { display: flex; flex-direction: column; gap: 4px; max-width: 640px; }
.admin-row { background: #fff; border-radius: 12px; padding: 10px 12px; min-height: 48px; display: flex; align-items: center; gap: 12px; cursor: grab; }
.admin-row.is-drag-over { box-shadow: 0 0 0 1px rgba(0,0,0,0.15); }
.admin-row:active { cursor: grabbing; }
.admin-handle { opacity: 0.3; user-select: none; }
.admin-name { flex: 1; -webkit-user-select: text; user-select: text; }
.admin-arrow { display: inline-flex; align-items: center; justify-content: center; min-width: 34px; min-height: 34px; background: transparent; border: 0; padding: 6px 10px; font: inherit; color: #000; cursor: pointer; border-radius: 8px; transition: background 0.12s, opacity 0.12s; }
.admin-arrow:hover:not(:disabled) { background: rgba(0,0,0,0.05); }
.admin-arrow:disabled { opacity: 0.2; cursor: not-allowed; }
.admin-textarea { width: 100%; max-width: 640px; background: #fff; border: 0; border-radius: 12px; padding: 16px; font-family: -apple-system, BlinkMacSystemFont, 'SF Pro Text', 'SF Pro', system-ui, sans-serif; font-size: 14px; font-weight: 500; color: #000; outline: none; resize: vertical; min-height: 360px; line-height: 1.45; -webkit-user-select: text; user-select: text; }
.admin-textarea:focus { box-shadow: 0 0 0 1px rgba(0,0,0,0.15); }
.admin-filter-row { display: flex; align-items: center; gap: 12px; flex-wrap: wrap; }
.admin-select { background: #fff; border: 0; border-radius: 12px; padding: 12px; font: inherit; color: #000; outline: none; cursor: pointer; -webkit-appearance: none; appearance: none; padding-right: 32px; background-image: url("data:image/svg+xml;utf8,<svg xmlns='http://www.w3.org/2000/svg' width='10' height='6' viewBox='0 0 10 6'><path fill='black' d='M0 0l5 6 5-6z'/></svg>"); background-repeat: no-repeat; background-position: right 12px center; }
.admin-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(160px, 1fr)); gap: 12px; }
.admin-tile { position: relative; background: #fff; border-radius: 12px; overflow: hidden; aspect-ratio: 1; display: flex; flex-direction: column; }
.admin-tile.is-deleting { opacity: 0.4; pointer-events: none; }
.admin-tile.is-hidden img { opacity: 0.25; filter: grayscale(0.6); }
.admin-tile img { width: 100%; height: 100%; object-fit: cover; display: block; transition: opacity 0.12s, filter 0.12s; }
.admin-tile-font { width: 100%; height: 100%; display: flex; align-items: center; justify-content: center; background: #f0f0f0; font-size: 40px; font-weight: 600; color: #999; }
.admin-type { display: flex; flex-direction: column; gap: 32px; }
.admin-type-section { display: flex; flex-direction: column; gap: 12px; }
.admin-type-h { font-size: 14px; font-weight: 500; margin: 0; }
.admin-typefaces { display: flex; flex-direction: column; gap: 20px; }
.admin-typeface { display: flex; gap: 20px; align-items: center; }
.admin-typeface-tile { flex: 0 0 auto; width: 160px; height: 160px; border-radius: 12px; background: #f0f0f0; padding: 16px; display: flex; align-items: center; justify-content: center; overflow: hidden; cursor: pointer; }
.admin-typeface-text { width: 100%; min-width: 0; text-align: center; overflow-wrap: anywhere; color: #000; font-synthesis: none; }
.admin-typeface-controls { flex: 1 1 auto; display: flex; flex-direction: column; gap: 8px; max-width: 460px; }
.admin-typeface-name { font-size: 14px; font-weight: 500; }
.admin-axis { display: flex; align-items: center; gap: 12px; }
.admin-axis-label { width: 52px; font-size: 13px; opacity: 0.6; }
.admin-axis input[type='range'] { flex: 1 1 auto; accent-color: #000; cursor: pointer; }
.admin-axis-value { width: 40px; text-align: right; font-size: 13px; font-variant-numeric: tabular-nums; opacity: 0.6; }
.admin-tile-meta { position: absolute; left: 0; right: 0; bottom: 0; padding: 8px 10px; display: flex; flex-direction: column; gap: 2px; background: linear-gradient(to top, rgba(0,0,0,0.55), transparent); color: #fff; font-size: 11px; line-height: 1.3; opacity: 0; transition: opacity 0.15s; pointer-events: none; }
.admin-tile:hover .admin-tile-meta, .admin-tile.is-hidden .admin-tile-meta { opacity: 1; }
.admin-tile-tag { display: inline-block; align-self: flex-start; background: rgba(255,255,255,0.18); padding: 1px 6px; border-radius: 4px; font-weight: 500; font-size: 10px; text-transform: uppercase; letter-spacing: 0.04em; }
.admin-tile-project { font-weight: 500; }
.admin-tile-name { opacity: 0.8; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.admin-tile-btn { position: absolute; top: 6px; width: 24px; height: 24px; border-radius: 12px; border: 0; background: rgba(0,0,0,0.55); color: #fff; cursor: pointer; font-size: 14px; line-height: 1; display: flex; align-items: center; justify-content: center; padding: 0; opacity: 0; transition: opacity 0.15s, background 0.12s; }
.admin-hide { right: 36px; }
.admin-delete { right: 6px; font-size: 16px; }
.admin-tile:hover .admin-tile-btn, .admin-tile.is-deleting .admin-tile-btn, .admin-tile.is-hidden .admin-tile-btn { opacity: 1; }
.admin-hide:hover { background: rgba(0,0,0,0.85); }
.admin-delete:hover { background: rgba(220,38,38,0.9); }
.admin-tile-btn:disabled { cursor: not-allowed; }
.admin-checkbox { display: inline-flex; align-items: center; gap: 8px; cursor: pointer; -webkit-user-select: none; user-select: none; }
.admin-checkbox input { margin: 0; cursor: pointer; }
.admin-muted { opacity: 0.4; margin: 0; }
.admin-hint { font-size: 14px; }
.admin-quotes { display: flex; flex-direction: column; gap: 24px; max-width: 760px; }
.admin-quote { background: #fff; border-radius: 12px; padding: 16px; display: flex; flex-direction: column; gap: 16px; }
.admin-quote-top { display: flex; gap: 12px; flex-wrap: wrap; }
.admin-quote-meta { display: flex; align-items: center; justify-content: space-between; gap: 12px; }
.admin-qfield { display: flex; flex-direction: column; gap: 6px; flex: 1 0 0; min-width: 140px; }
.admin-qfield-sm { flex: 0 0 150px; }
.admin-qfield label { font-size: 12px; opacity: 0.5; }
.admin-input { background: #f8f8f8; border: 0; border-radius: 12px; padding: 10px 12px; font: inherit; font-size: 14px; color: #000; outline: none; width: 100%; -webkit-appearance: none; appearance: none; -webkit-user-select: text; user-select: text; }
.admin-input:focus { box-shadow: 0 0 0 1px rgba(0,0,0,0.15); }
.admin-input-area { resize: vertical; line-height: 1.45; font-family: inherit; }
.admin-input-num { max-width: 120px; }
.admin-link { text-decoration: underline; text-underline-offset: 2px; -webkit-user-select: text; user-select: text; }
.admin-danger { color: #ff3b30; }
.admin-option { background: #f8f8f8; border-radius: 12px; padding: 16px; display: flex; flex-direction: column; gap: 14px; }
.admin-assets { display: flex; flex-direction: column; gap: 12px; }
.admin-asset { background: #fff; border-radius: 12px; padding: 12px; display: flex; flex-direction: column; gap: 10px; transition: box-shadow 0.12s, transform 0.12s; }
.admin-asset.is-drag-over { box-shadow: 0 0 0 2px rgba(0,0,0,0.25); transform: translateY(-1px); }
.admin-item-handle { display: inline-flex; align-items: center; justify-content: center; width: 26px; height: 34px; background: transparent; border: 0; padding: 0; color: rgba(0,0,0,0.25); cursor: grab; font-size: 14px; letter-spacing: -2px; border-radius: 6px; transition: background 0.12s, color 0.12s; -webkit-user-select: none; user-select: none; }
.admin-item-handle:hover { background: rgba(0,0,0,0.05); color: rgba(0,0,0,0.7); }
.admin-item-handle:active { cursor: grabbing; }
.admin-asset-row { display: flex; gap: 12px; align-items: flex-start; }
.admin-asset-row-two { gap: 12px; }
.admin-asset-row-two .admin-qfield { flex: 1 0 0; }
/* Asset and item rows are grids so the same markup can reflow from one
   desktop row into a stacked mobile card without duplicating the fields. */
.admin-field { display: flex; flex-direction: column; gap: 6px; min-width: 0; }
.admin-field > span { font-size: 12px; opacity: 0.5; }
.admin-asset-grid, .admin-item-grid { display: grid; gap: 10px 12px; align-items: end; }
.admin-asset-grid { grid-template-columns: minmax(0,2fr) minmax(0,1fr) 116px auto; grid-template-areas: "name variable price del"; }
.admin-item-grid { grid-template-columns: auto minmax(0,2fr) minmax(0,1fr) 96px 116px auto; grid-template-areas: "tools name unit qty price del"; }
.af-name { grid-area: name; } .af-variable { grid-area: variable; } .af-price { grid-area: price; }
.ai-name { grid-area: name; } .ai-unit { grid-area: unit; } .ai-qty { grid-area: qty; } .ai-price { grid-area: price; }
.af-del, .ai-del { grid-area: del; height: 40px; }
.admin-item-tools { grid-area: tools; display: flex; align-items: center; gap: 2px; height: 40px; }
.admin-item-tools .admin-arrow { min-width: 28px; min-height: 30px; padding: 4px 6px; }
.admin-asset-grid .admin-input-num, .admin-item-grid .admin-input-num { max-width: none; }
.admin-price-preview { display: flex; flex-wrap: wrap; gap: 8px; font-size: 13px; opacity: 0.55; }
.admin-kind { display: flex; gap: 4px; padding: 3px 0; }
.admin-kind .admin-subtab { background: rgba(0,0,0,0.04); }
.admin-kind .admin-subtab.is-active { background: #fff; box-shadow: 0 0 0 1px rgba(0,0,0,0.12); }
.admin-estimate { background: #fff; border-radius: 12px; padding: 12px; display: flex; flex-direction: column; gap: 6px; font-size: 13px; }
.admin-estimate-row { display: flex; gap: 12px; align-items: baseline; }
.admin-estimate-label { flex: 0 0 130px; opacity: 0.45; }
.admin-estimate-row > span:last-child { flex: 1 1 auto; min-width: 0; }
.admin-add-options { display: flex; flex-wrap: wrap; gap: 4px; }
.admin-hint code { background: rgba(0,0,0,0.06); padding: 1px 5px; border-radius: 4px; font-size: 12px; }
.admin-subtabs { display: flex; flex-wrap: wrap; gap: 4px; margin-bottom: 16px; }
.admin-subtab { background: transparent; border: 0; padding: 6px 10px; border-radius: 8px; font: inherit; font-size: 13px; color: #000; opacity: 0.5; cursor: pointer; transition: background 0.12s, opacity 0.12s; max-width: 240px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.admin-subtab:hover:not(.is-active) { background: rgba(0,0,0,0.04); opacity: 0.8; }
.admin-subtab.is-active { background: #fff; opacity: 1; }
.admin-subtab.is-primary { opacity: 1; }
.admin-pictures { display: flex; flex-wrap: wrap; gap: 8px; align-items: center; }
.admin-picture { width: 56px; height: 56px; border-radius: 8px; object-fit: cover; cursor: pointer; background: #f0f0f0; transition: opacity 0.12s; }
.admin-picture:hover { opacity: 0.7; }
.admin-picture.is-md { width: 96px; height: 96px; border-radius: 12px; }
.admin-picture-add { width: 56px; height: 56px; border-radius: 8px; background: rgba(0,0,0,0.04); border: 1px dashed rgba(0,0,0,0.15); color: rgba(0,0,0,0.4); font: inherit; font-size: 20px; cursor: pointer; transition: background 0.12s, color 0.12s; }
.admin-picture-add:hover { background: rgba(0,0,0,0.08); color: rgba(0,0,0,0.6); }
.admin-picture-add.is-md { width: 96px; height: 96px; border-radius: 12px; font-size: 28px; }
.admin-picker-backdrop { position: fixed; inset: 0; background: rgba(0,0,0,0.35); z-index: 100; display: flex; align-items: center; justify-content: center; padding: 32px; }
.admin-picker { background: #fff; border-radius: 16px; padding: 16px; width: 100%; max-width: 720px; max-height: 80vh; display: flex; flex-direction: column; gap: 12px; overflow: hidden; }
.admin-picker-head { display: flex; align-items: center; justify-content: space-between; gap: 12px; }
.admin-picker-tabs { display: flex; gap: 4px; }
.admin-picker-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(100px, 1fr)); gap: 8px; overflow: auto; padding: 4px; }
.admin-picker-thumb { width: 100%; aspect-ratio: 1; object-fit: cover; border-radius: 8px; background: #f0f0f0; cursor: pointer; transition: opacity 0.12s; }
.admin-picker-thumb:hover { opacity: 0.7; }
.admin-picker-upload { display: flex; flex-direction: column; gap: 12px; padding: 16px 4px; }
.admin-picker-upload input[type='file'] { font: inherit; }
.plan-sources { display: flex; flex-wrap: wrap; gap: 8px; margin: 8px 0 12px; }
.plan-source { background: #fff; border: 1px solid rgba(0,0,0,0.12); border-radius: 8px; padding: 8px 10px; min-height: 36px; display: inline-flex; gap: 8px; align-items: center; cursor: pointer; font: inherit; font-size: 13px; color: #000; transition: opacity 0.12s, transform 0.12s, box-shadow 0.12s; }
.plan-source:active { transform: scale(0.98); }
.plan-source.is-done { opacity: 0.35; cursor: not-allowed; }
.plan-source.is-armed { box-shadow: 0 0 0 2px #000; }
.plan-armed-hint { display: flex; align-items: center; gap: 8px; margin: 0 0 10px; padding: 6px 6px 6px 12px; border-radius: 10px; background: rgba(0,0,0,0.05); font-size: 13px; line-height: 1.35; }
.plan-armed-hint > span { flex: 1 1 auto; min-width: 0; }
.plan-armed-hint strong { font-weight: 600; }
.plan-armed-hint .admin-arrow { flex: 0 0 auto; background: #fff; }
.plan-source-label { font-weight: 500; }
.plan-source-count { font-variant-numeric: tabular-nums; font-size: 12px; opacity: 0.55; }
.plan-source-item { border-left: 4px solid #000; }
.plan-source-presentation { border-left: 4px solid #2b8c3a; }
.plan-source-feedback { border-left: 4px solid #b39530; }
.plan-source-glyph-design { border-left: 4px solid #2b6cb0; }
.plan-source-refinement { border-left: 4px solid #6b46c1; }
.plan-source-spacing-kerning { border-left: 4px solid #2c7a7b; }
.plan-source-testing-output { border-left: 4px solid #c05621; }
.plan-cal { background: #fff; border-radius: 12px; padding: 12px; display: flex; flex-direction: column; gap: 8px; }
.plan-cal-head { display: flex; align-items: center; justify-content: space-between; gap: 8px; }
.plan-cal-month { font-weight: 500; font-size: 14px; }
/* The 7-column grid stops being usable below ~380px, so it keeps its width
   and scrolls sideways inside the card rather than crushing the day cells. */
.plan-cal-scroll { overflow-x: auto; scrollbar-width: none; -ms-overflow-style: none; -webkit-overflow-scrolling: touch; }
.plan-cal-scroll::-webkit-scrollbar { display: none; }
.plan-cal-body { display: flex; flex-direction: column; gap: 8px; min-width: 100%; }
.plan-cal-dows { display: grid; grid-template-columns: repeat(7, 1fr); gap: 4px; font-size: 11px; opacity: 0.5; text-transform: uppercase; letter-spacing: 0.04em; }
.plan-cal-dows span { padding: 0 4px; }
.plan-cal-grid { display: grid; grid-template-columns: repeat(7, minmax(0, 1fr)); gap: 4px; }
.plan-cal-day { aspect-ratio: 1.1; min-height: 56px; min-width: 0; background: #f8f8f8; border-radius: 8px; padding: 4px 6px; display: flex; flex-direction: column; gap: 2px; position: relative; overflow: hidden; }
.plan-cal-day.is-out { opacity: 0.3; }
.plan-cal-day.is-weekend { background: rgba(0,0,0,0.06); }
.plan-cal-day.is-weekend .plan-cal-daynum { opacity: 0.4; }
.plan-cal-day.is-blocked { background-color: rgba(0,0,0,0.07); background-image: repeating-linear-gradient(135deg, rgba(0,0,0,0.05) 0 6px, transparent 6px 12px); }
.plan-cal-day.is-blocked .plan-cal-daynum { text-decoration: line-through; opacity: 0.5; }
.plan-cal-day.is-target { cursor: pointer; box-shadow: inset 0 0 0 1px rgba(0,0,0,0.2); }
.plan-cal-day.is-target:hover { background-color: rgba(0,0,0,0.08); }
.plan-cal-day.is-today { box-shadow: inset 0 0 0 2px #000; }
.plan-cal-daynum { font-size: 11px; opacity: 0.65; font-variant-numeric: tabular-nums; }
.plan-cal-blocks { display: flex; flex-direction: column; gap: 2px; flex: 1 0 auto; min-height: 0; min-width: 0; }
.plan-cal-block { font-size: 11px; padding: 2px 5px; border-radius: 4px; color: #fff; cursor: grab; line-height: 1.2; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; max-width: 100%; min-width: 0; }
.plan-cal-block:active { cursor: grabbing; }
.plan-cal-block-item { background: #000; }
.plan-cal-block-presentation { background: #2b8c3a; }
.plan-cal-block-feedback { background: #b39530; }
.plan-cal-block-glyph-design { background: #2b6cb0; }
.plan-cal-block-refinement { background: #6b46c1; }
.plan-cal-block-spacing-kerning { background: #2c7a7b; }
.plan-cal-block-testing-output { background: #c05621; }
@keyframes admin-sheet-up { from { transform: translateY(20px); } to { transform: none; } }

/* Touch devices: HTML5 drag never fires, so drop the grab affordances and
   lean on the arrow buttons and tap-to-place instead. */
@media (hover: none) and (pointer: coarse) {
  .admin-item-handle { display: none; }
  .admin-row, .admin-row:active { cursor: default; }
  .admin-tile-meta, .admin-tile-btn { opacity: 1; }
}

@media (max-width: 900px) {
  .admin-page { padding: 0 24px 80px; }
  .admin-header { margin: 0 -24px; padding: 20px 24px 14px 68px; }
}

@media (max-width: 700px) {
  .admin-page { padding: 0 20px 72px; gap: 20px; }
  /* Two rows on a phone: the logo shares the first line with Save, and the
     tabs take the full width underneath rather than a ~220px scroll sliver.
     The negative left margin reclaims the logo inset on the second row,
     which sits clear of the logo vertically. Tabs wrap rather than scroll —
     a sideways-swipeable strip reads as the page itself moving. */
  .admin-header { margin: 0 -20px; padding: 20px 20px 12px 64px; flex-wrap: wrap; row-gap: 10px; }
  .admin-save-row { order: 1; margin-left: auto; }
  .admin-tabs { order: 2; flex: 1 0 100%; margin-left: -44px; flex-wrap: wrap; row-gap: 4px; }
  .admin-tab { padding: 8px 12px; font-size: 13px; }
  /* 16px keeps iOS Safari from zooming the viewport on focus. */
  .admin-input, .admin-textarea, .admin-select { font-size: 16px; }
  .admin-textarea { min-height: 240px; padding: 14px; }
  .admin-arrow { min-height: 40px; padding: 8px 12px; }
  .admin-checkbox input { width: 18px; height: 18px; }
  .admin-grid { grid-template-columns: repeat(auto-fill, minmax(120px, 1fr)); }
  .admin-tile-meta, .admin-tile-btn { opacity: 1; }
  .admin-tile-btn { width: 32px; height: 32px; border-radius: 16px; }
  .admin-hide { right: 44px; }
  .admin-quote { padding: 12px; gap: 14px; }
  .admin-quote-top { flex-direction: column; }
  .admin-quote-meta { flex-wrap: wrap; }
  .admin-qfield-sm { flex: 1 0 0; }
  .admin-option { padding: 12px; }
  .admin-asset { padding: 10px; }
  .admin-asset-row, .admin-asset-row-two { flex-direction: column; }
  .admin-estimate-row { flex-direction: column; gap: 2px; }
  .admin-estimate-label { flex: none; }
  .admin-input-num { max-width: none; }
  .admin-subtabs { flex-wrap: wrap; margin-bottom: 10px; }
  .admin-subtab { max-width: 100%; padding: 9px 12px; }
  /* One row per field instead of six columns squeezed into 300px. */
  .admin-asset-grid { grid-template-columns: minmax(0,1fr) auto; grid-template-areas: "name del" "variable variable" "price price"; }
  .admin-item-grid { grid-template-columns: minmax(0,1fr) minmax(0,1fr); grid-template-areas: "tools del" "name name" "unit unit" "qty price"; }
  .admin-item-tools { justify-self: start; height: auto; }
  .ai-del { justify-self: end; }
  .admin-typeface { flex-direction: column; align-items: stretch; gap: 12px; }
  .admin-typeface-tile { width: 100%; height: 140px; }
  .admin-typeface-controls { max-width: none; }
  .admin-picture, .admin-picture-add { width: 64px; height: 64px; }
  .admin-picture.is-md, .admin-picture-add.is-md { width: 88px; height: 88px; }
  /* Picker becomes a bottom sheet — thumb-reachable and full-width. */
  .admin-picker-backdrop { padding: 0; align-items: flex-end; }
  .admin-picker { max-width: none; border-radius: 18px 18px 0 0; max-height: 88vh; padding: 12px 12px 20px; animation: admin-sheet-up 0.22s cubic-bezier(0.22, 1, 0.36, 1); }
  .admin-picker-grid { grid-template-columns: repeat(auto-fill, minmax(84px, 1fr)); }
  .plan-cal { padding: 10px; }
  /* Weekdays only on a phone. Weekends never accept a block anyway, so
     dropping those two columns removes the sideways scroll entirely and
     gives the five real columns room — same Mon-Fri grid the public quote
     calendar already uses. */
  .plan-cal-dows, .plan-cal-grid { grid-template-columns: repeat(5, minmax(0, 1fr)); }
  .plan-cal-dows > :nth-child(n+6),
  .plan-cal-grid > :nth-child(7n+6),
  .plan-cal-grid > :nth-child(7n+7) { display: none; }
  /* aspect-ratio must go: once min-height wins, the ratio back-computes a
     width wider than the grid column and pushes the calendar out of its box. */
  .plan-cal-day { aspect-ratio: auto; min-height: 56px; }
  .plan-cal-block { font-size: 11px; padding: 2px 4px; }
  .plan-source { font-size: 12px; }
}
    `.trim() }} />
  )
}
