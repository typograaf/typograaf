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
} from '../../lib/quote'
import { DEFAULT_PREVIEW_WEIGHT, DEFAULT_PREVIEW_LEADING, DEFAULT_PREVIEW_SIZE } from '../../lib/tiles'
import { type Axis, parseVariationAxes, parseCharSet, glyphSafeText } from '../../lib/fontmeta'

type Tab = 'work' | 'about' | 'images' | 'quotes' | 'sentences'

// Keep the textarea's raw text while editing (preserve spaces / blank
// lines so typing works). Lines are trimmed and emptied out at save
// time by normalizeQuote.
const rawLines = (v: string) => v.split('\n')

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
  const [savedAt, setSavedAt] = useState<number | null>(null)
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
    setOrder(data.order || [])
    setAbout(data.about || '')
    setQuotes(Array.isArray(data.quotes) ? data.quotes : [])
    setSentences(Array.isArray(data.sentences) ? data.sentences : [])
    setBlockedDays(Array.isArray(data.blockedDays) ? data.blockedDays : [])
    setFonts(Array.isArray(data.fonts) ? data.fonts : [])
    setPreviewAxes(data.previewAxes && typeof data.previewAxes === 'object' ? data.previewAxes : {})
    setImages(data.images || [])
    setAuthed(true)
    setLoading(false)
  }

  useEffect(() => {
    load()
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
    try {
      const res = await fetch('/api/admin', { cache: 'no-store' })
      if (res.ok) {
        const data = await res.json()
        setQuotes(Array.isArray(data.quotes) ? data.quotes : [])
      }
    } catch {}
    setSaving(false)
    setSavedAt(Date.now())
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
  const addOption = (qi: number) => setQuotes(prev => prev.map((q, i) => i !== qi ? q : {
    ...q, options: [...q.options, emptyOption(q.options.length + 1)],
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
        <div className="admin-header">
          <div className="admin-tabs">
            <button
              className={`admin-tab${tab === 'work' ? ' is-active' : ''}`}
              onClick={() => setTab('work')}
              type="button"
            >Work</button>
            <button
              className={`admin-tab${tab === 'about' ? ' is-active' : ''}`}
              onClick={() => setTab('about')}
              type="button"
            >About</button>
            <button
              className={`admin-tab${tab === 'images' ? ' is-active' : ''}`}
              onClick={() => setTab('images')}
              type="button"
            >Images</button>
            <button
              className={`admin-tab${tab === 'quotes' ? ' is-active' : ''}`}
              onClick={() => setTab('quotes')}
              type="button"
            >Quotes</button>
            <button
              className={`admin-tab${tab === 'sentences' ? ' is-active' : ''}`}
              onClick={() => setTab('sentences')}
              type="button"
            >Type</button>
          </div>
          {tab !== 'images' && (
            <div className="admin-save-row">
              {savedAt && Date.now() - savedAt < 3000 && (
                <span className="admin-muted">Saved</span>
              )}
              <button
                className="admin-tab is-primary"
                onClick={save}
                disabled={saving}
                type="button"
              >{saving ? 'Saving…' : 'Save'}</button>
            </div>
          )}
        </div>

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
                    return (
                      <div key={oi} className="admin-option">
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
                          <label>Description</label>
                          <textarea
                            className="admin-input admin-input-area"
                            value={o.description}
                            rows={3}
                            onChange={(e) => updateOption(qi, oi, { description: e.target.value })}
                          />
                          <span className="admin-hint">Supports <code>**bold**</code>, <code>*italic*</code>, <code>[link](url)</code>, <code>- bullets</code>, <code>1. numbered</code></span>
                        </div>

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

                        <div className="admin-assets">
                          {o.assets.map((a, ai) => (
                            <div key={ai} className="admin-asset">
                              <div className="admin-asset-row">
                                <input
                                  className="admin-input"
                                  value={a.name}
                                  placeholder="Display Typeface"
                                  onChange={(e) => updateAsset(qi, oi, ai, { name: e.target.value })}
                                />
                                <input
                                  className="admin-input"
                                  value={a.variable}
                                  placeholder="1 Axis"
                                  onChange={(e) => updateAsset(qi, oi, ai, { variable: e.target.value })}
                                />
                                <input
                                  className="admin-input admin-input-num"
                                  type="number"
                                  value={a.price || ''}
                                  placeholder="3600"
                                  onChange={(e) => updateAsset(qi, oi, ai, { price: Number(e.target.value) || 0 })}
                                />
                                <button
                                  className="admin-arrow admin-danger"
                                  type="button"
                                  onClick={() => removeAsset(qi, oi, ai)}
                                  disabled={o.assets.length === 1 && (o.items || []).length === 0}
                                  aria-label="Remove asset"
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
                          <button className="admin-arrow" type="button" onClick={() => addAsset(qi, oi)}>+ Add asset (typeface)</button>
                        </div>

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
                              <div className="admin-asset-row">
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
                                <input
                                  className="admin-input"
                                  value={it.name}
                                  placeholder="Motionlogo"
                                  onChange={(e) => updateItem(qi, oi, ii, { name: e.target.value })}
                                />
                                <input
                                  className="admin-input"
                                  value={it.unit}
                                  placeholder="per video"
                                  onChange={(e) => updateItem(qi, oi, ii, { unit: e.target.value })}
                                />
                                <input
                                  className="admin-input admin-input-num"
                                  type="number"
                                  min={1}
                                  value={it.quantity || ''}
                                  placeholder="1"
                                  onChange={(e) => updateItem(qi, oi, ii, { quantity: Number(e.target.value) || 0 })}
                                />
                                <input
                                  className="admin-input admin-input-num"
                                  type="number"
                                  value={it.unitPrice || ''}
                                  placeholder="2500"
                                  onChange={(e) => updateItem(qi, oi, ii, { unitPrice: Number(e.target.value) || 0 })}
                                />
                                <button
                                  className="admin-arrow admin-danger"
                                  type="button"
                                  onClick={() => removeItem(qi, oi, ii)}
                                  aria-label="Remove item"
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
                          {o.assets.length > 0 && (
                            <>
                              <span>Design cost {formatEur(d)}</span>
                              <span>·</span>
                              <span>Perpetual {formatEur(perpetualTotal(d))} one-time</span>
                              <span>·</span>
                              <span>Annual {formatEur(annualFirstYear(d))} first year, then {formatEur(annualYearly(d))} / yr</span>
                            </>
                          )}
                          {(o.items || []).length > 0 && (
                            <>
                              {o.assets.length > 0 && <span>·</span>}
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
                  <button className="admin-arrow" type="button" onClick={() => addOption(qi)}>+ Add option</button>
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
          {tab === 'quotes' && 'You enter the design price per asset. Perpetual = one-time design + 50%. Annual = first year at the design price, then 1/6 of design per year. Footnotes are fixed and shown automatically on the quote. Changes go live on Save.'}
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
  const isUnavailable = (iso: string): boolean => isWeekend(iso) || blockedDays.has(iso)

  const handleSourceDragStart = (e: React.DragEvent<HTMLButtonElement>, src: PlanSource) => {
    if (src.total > 0 && src.placed >= src.total) { e.preventDefault(); return }
    const payload = { mode: 'new', kind: src.kind, itemIndex: src.itemIndex }
    e.dataTransfer.setData('application/x-planblock', JSON.stringify(payload))
    e.dataTransfer.effectAllowed = 'copy'
  }

  const handleBlockDragStart = (e: React.DragEvent<HTMLDivElement>, block: PlanBlock) => {
    e.stopPropagation()
    const payload = { mode: 'move', id: block.id }
    e.dataTransfer.setData('application/x-planblock', JSON.stringify(payload))
    e.dataTransfer.effectAllowed = 'move'
  }

  const handleDayDragOver = (e: React.DragEvent<HTMLDivElement>, iso: string) => {
    if (isUnavailable(iso)) return
    e.preventDefault()
    e.dataTransfer.dropEffect = 'move'
  }

  const handleDayDrop = (e: React.DragEvent<HTMLDivElement>, iso: string) => {
    e.preventDefault()
    if (isUnavailable(iso)) return
    const raw = e.dataTransfer.getData('application/x-planblock')
    if (!raw) return
    let payload: { mode: 'new' | 'move'; kind?: PlanBlockKind; itemIndex?: number; id?: string }
    try { payload = JSON.parse(raw) } catch { return }
    if (payload.mode === 'new' && payload.kind) {
      const block: PlanBlock = {
        id: `pb-${Math.random().toString(36).slice(2, 10)}`,
        kind: payload.kind,
        date: iso,
        ...(payload.kind === 'item' && typeof payload.itemIndex === 'number' ? { itemIndex: payload.itemIndex } : {}),
      }
      onChange({ planBlocks: [...placed, block] })
    } else if (payload.mode === 'move' && payload.id) {
      onChange({ planBlocks: placed.map((b) => b.id === payload.id ? { ...b, date: iso } : b) })
    }
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
      <span className="admin-hint">Drag blocks below onto days. Weekends, Belgian holidays, and busy days from your calendar are greyed out. Presentation and feedback are unlimited — drag as many as you need.</span>

      {sources.length > 0 && (
        <>
          <div className="plan-sources">
            {sources.map((src) => {
              const unlimited = src.total === 0
              const remaining = unlimited ? Infinity : src.total - src.placed
              const done = !unlimited && remaining === 0
              return (
                <button
                  key={src.key}
                  type="button"
                  className={`plan-source plan-source-${src.kind}${done ? ' is-done' : ''}`}
                  draggable={!done}
                  onDragStart={(e) => handleSourceDragStart(e, src)}
                  title={done ? `${src.label} fully placed` : unlimited ? `Drag onto a day (${src.placed} placed)` : `Drag onto a day (${remaining} left)`}
                >
                  <span className="plan-source-label">{src.label}</span>
                  <span className="plan-source-count">{unlimited ? src.placed : `${src.placed}/${src.total}`}</span>
                </button>
              )
            })}
          </div>

          <div className="plan-cal">
            <div className="plan-cal-head">
              <button type="button" className="admin-arrow" onClick={() => goMonth(-1)} aria-label="Previous month">‹</button>
              <span className="plan-cal-month">{monthLabel}</span>
              <button type="button" className="admin-arrow" onClick={() => goMonth(1)} aria-label="Next month">›</button>
            </div>
            <div className="plan-cal-dows">
              {['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'].map((d) => <span key={d}>{d}</span>)}
            </div>
            <div className="plan-cal-grid">
              {gridDays.map((cell) => {
                const blocks = placedByDate.get(cell.date) || []
                const weekend = isWeekend(cell.date)
                const blocked = blockedDays.has(cell.date)
                const classes = ['plan-cal-day']
                if (!cell.inMonth) classes.push('is-out')
                if (weekend) classes.push('is-weekend')
                if (blocked) classes.push('is-blocked')
                if (cell.isToday) classes.push('is-today')
                return (
                  <div
                    key={cell.date}
                    className={classes.join(' ')}
                    onDragOver={(e) => handleDayDragOver(e, cell.date)}
                    onDrop={(e) => handleDayDrop(e, cell.date)}
                  >
                    <span className="plan-cal-daynum">{cell.date.slice(8, 10).replace(/^0/, '')}</span>
                    <div className="plan-cal-blocks">
                      {blocks.map((b) => {
                        const label = b.kind === 'item'
                          ? (option.items[b.itemIndex ?? -1]?.name || 'Item')
                          : b.kind === 'presentation' ? 'Pres' : 'FB'
                        return (
                          <div
                            key={b.id}
                            className={`plan-cal-block plan-cal-block-${b.kind}`}
                            draggable
                            onDragStart={(e) => handleBlockDragStart(e, b)}
                            onClick={() => removeBlock(b.id)}
                            title={`${label} — click to remove`}
                          >{label}</div>
                        )
                      })}
                    </div>
                  </div>
                )
              })}
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
.admin-page { max-width: 960px; margin: 0 auto; padding: 96px 32px 96px; display: flex; flex-direction: column; gap: 24px; }
.admin-login { position: fixed; inset: 0; display: flex; align-items: center; justify-content: center; background: #fff; z-index: 50; }
.admin-header { display: flex; justify-content: space-between; align-items: center; gap: 12px; flex-wrap: wrap; }
.admin-tabs { display: flex; gap: 4px; }
.admin-save-row { display: flex; align-items: center; gap: 12px; }
.admin-tab { background: transparent; border: 0; padding: 12px; border-radius: 12px; font: inherit; color: #000; cursor: pointer; transition: background 0.12s, opacity 0.12s; }
.admin-tab:hover:not(:disabled):not(.is-active):not(.is-primary) { background: rgba(0,0,0,0.04); }
.admin-tab.is-active { background: #fff; }
.admin-tab.is-primary { background: #fff; }
.admin-tab:disabled { opacity: 0.3; cursor: not-allowed; }
.admin-list { display: flex; flex-direction: column; gap: 4px; max-width: 640px; }
.admin-row { background: #fff; border-radius: 12px; padding: 12px; display: flex; align-items: center; gap: 12px; cursor: grab; }
.admin-row.is-drag-over { box-shadow: 0 0 0 1px rgba(0,0,0,0.15); }
.admin-row:active { cursor: grabbing; }
.admin-handle { opacity: 0.3; user-select: none; }
.admin-name { flex: 1; -webkit-user-select: text; user-select: text; }
.admin-arrow { background: transparent; border: 0; padding: 4px 8px; font: inherit; color: #000; cursor: pointer; border-radius: 8px; transition: background 0.12s, opacity 0.12s; }
.admin-arrow:hover:not(:disabled) { background: rgba(0,0,0,0.04); }
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
.admin-item-handle { flex: 0 0 auto; align-self: stretch; display: inline-flex; align-items: center; justify-content: center; width: 22px; background: transparent; border: 0; padding: 0; color: rgba(0,0,0,0.25); cursor: grab; font-size: 14px; letter-spacing: -2px; border-radius: 6px; transition: background 0.12s, color 0.12s; -webkit-user-select: none; user-select: none; }
.admin-item-handle:hover { background: rgba(0,0,0,0.04); color: rgba(0,0,0,0.7); }
.admin-item-handle:active { cursor: grabbing; }
.admin-asset-row { display: flex; gap: 12px; align-items: flex-start; }
.admin-asset-row-two { gap: 12px; }
.admin-asset-row-two .admin-qfield { flex: 1 0 0; }
.admin-price-preview { display: flex; flex-wrap: wrap; gap: 8px; font-size: 13px; opacity: 0.55; }
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
.plan-source { background: #fff; border: 1px solid rgba(0,0,0,0.12); border-radius: 8px; padding: 6px 10px; display: inline-flex; gap: 8px; align-items: center; cursor: grab; font: inherit; font-size: 13px; color: #000; transition: opacity 0.12s, transform 0.12s; }
.plan-source:active { cursor: grabbing; transform: scale(0.98); }
.plan-source.is-done { opacity: 0.35; cursor: not-allowed; }
.plan-source-label { font-weight: 500; }
.plan-source-count { font-variant-numeric: tabular-nums; font-size: 12px; opacity: 0.55; }
.plan-source-item { border-left: 4px solid #000; }
.plan-source-presentation { border-left: 4px solid #2b8c3a; }
.plan-source-feedback { border-left: 4px solid #b39530; }
.plan-cal { background: #fff; border-radius: 12px; padding: 12px; display: flex; flex-direction: column; gap: 8px; }
.plan-cal-head { display: flex; align-items: center; justify-content: space-between; gap: 8px; }
.plan-cal-month { font-weight: 500; font-size: 14px; }
.plan-cal-dows { display: grid; grid-template-columns: repeat(7, 1fr); gap: 4px; font-size: 11px; opacity: 0.5; text-transform: uppercase; letter-spacing: 0.04em; }
.plan-cal-dows span { padding: 0 4px; }
.plan-cal-grid { display: grid; grid-template-columns: repeat(7, minmax(0, 1fr)); gap: 4px; }
.plan-cal-day { aspect-ratio: 1.1; min-height: 56px; min-width: 0; background: #f8f8f8; border-radius: 8px; padding: 4px 6px; display: flex; flex-direction: column; gap: 2px; position: relative; overflow: hidden; }
.plan-cal-day.is-out { opacity: 0.3; }
.plan-cal-day.is-weekend { background: rgba(0,0,0,0.06); }
.plan-cal-day.is-weekend .plan-cal-daynum { opacity: 0.4; }
.plan-cal-day.is-blocked { background-color: rgba(0,0,0,0.07); background-image: repeating-linear-gradient(135deg, rgba(0,0,0,0.05) 0 6px, transparent 6px 12px); }
.plan-cal-day.is-blocked .plan-cal-daynum { text-decoration: line-through; opacity: 0.5; }
.plan-cal-day.is-today { box-shadow: inset 0 0 0 2px #000; }
.plan-cal-daynum { font-size: 11px; opacity: 0.65; font-variant-numeric: tabular-nums; }
.plan-cal-blocks { display: flex; flex-direction: column; gap: 2px; flex: 1 0 auto; min-height: 0; min-width: 0; }
.plan-cal-block { font-size: 11px; padding: 2px 5px; border-radius: 4px; color: #fff; cursor: grab; line-height: 1.2; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; max-width: 100%; min-width: 0; }
.plan-cal-block:active { cursor: grabbing; }
.plan-cal-block-item { background: #000; }
.plan-cal-block-presentation { background: #2b8c3a; }
.plan-cal-block-feedback { background: #b39530; }
@media (max-width: 700px) {
  .admin-page { padding: 88px 24px 64px; }
  .admin-grid { grid-template-columns: repeat(auto-fill, minmax(120px, 1fr)); }
  .admin-tile-meta, .admin-tile-btn { opacity: 1; }
  .admin-quote-top { flex-direction: column; }
  .admin-asset-row, .admin-asset-row-two { flex-direction: column; }
  .admin-input-num { max-width: none; }
  .admin-picker { padding: 12px; }
  .plan-cal-day { min-height: 40px; }
  .plan-cal-block { font-size: 10px; padding: 1px 4px; }
}
    `.trim() }} />
  )
}
