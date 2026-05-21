'use client'

import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import {
  type Quote,
  type QuoteOption,
  type QuoteAsset,
  emptyQuote,
  emptyOption,
  emptyAsset,
  slugify,
  designCost,
  perpetualTotal,
  annualFirstYear,
  annualYearly,
  formatEur,
} from '../../lib/quote'
import { DEFAULT_PREVIEW_WEIGHT, DEFAULT_PREVIEW_LEADING, DEFAULT_PREVIEW_SIZE } from '../../lib/tiles'
import { type Axis, parseVariationAxes, fitFontSize } from '../../lib/fontmeta'

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
  const addQuote = () => setQuotes(prev => [...prev, emptyQuote()])
  const removeQuote = (qi: number) => {
    if (!confirm(`Delete quote "${quotes[qi]?.project || quotes[qi]?.slug || 'untitled'}"? This cannot be undone after saving.`)) return
    setQuotes(prev => prev.filter((_, i) => i !== qi))
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
            {quotes.length === 0 && (
              <p className="admin-muted">No quotes yet.</p>
            )}
            {quotes.map((q, qi) => {
              const slug = q.slug || slugify(q.project)
              return (
                <div key={qi} className="admin-quote">
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
                        </div>

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
                                  disabled={o.assets.length === 1}
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
                            </div>
                          ))}
                          <button className="admin-arrow" type="button" onClick={() => addAsset(qi, oi)}>+ Add asset</button>
                        </div>

                        <div className="admin-price-preview">
                          <span>Design cost {formatEur(d)}</span>
                          <span>·</span>
                          <span>Perpetual {formatEur(perpetualTotal(d))} one-time</span>
                          <span>·</span>
                          <span>Annual {formatEur(annualFirstYear(d))} first year, then {formatEur(annualYearly(d))} / yr</span>
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
            <button className="admin-tab is-primary" type="button" onClick={addQuote}>+ Add quote</button>
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
          {tab === 'sentences' && 'Size dials each typeface within its tile; weight, width and leading set how it renders on the tile and in the type-tester. Weight and width show only for fonts that have those axes. The preview updates live — click it for another sample string. Sentences are the sample texts, one per line. Changes go live on Save.'}
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
  const [sentenceIdx, setSentenceIdx] = useState(() =>
    Math.floor(Math.random() * Math.max(1, sentences.length)),
  )
  const boxRef = useRef<HTMLDivElement>(null)
  const textRef = useRef<HTMLDivElement>(null)

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
  const sizeMul = axes.size ?? DEFAULT_PREVIEW_SIZE
  const settings = `"wght" ${weight}` + (wdth ? `, "wdth" ${width}` : '')

  const pool = sentences.length ? sentences : [font.name]
  const sentence = pool[sentenceIdx % pool.length]

  // Fit the sample to the tile, then scale by the size multiplier — the
  // same maths the live tile uses.
  useLayoutEffect(() => {
    const box = boxRef.current
    const textEl = textRef.current
    if (!box || !textEl) return
    const fit = () => {
      const bw = box.clientWidth
      const bh = box.clientHeight
      if (bw <= 0 || bh <= 0) return
      const max = fitFontSize(textEl, bw, bh)
      textEl.style.fontSize = Math.floor(max * sizeMul) + 'px'
    }
    fit()
    let cancelled = false
    document.fonts.ready.then(() => { if (!cancelled) fit() })
    return () => { cancelled = true }
  }, [sentence, family, sizeMul, weight, width, leading, parsed])

  return (
    <div className="admin-typeface">
      <div
        className="admin-typeface-tile"
        onClick={() => setSentenceIdx((i) => i + 1)}
        title="Click for another sample string"
      >
        <div ref={boxRef} className="admin-typeface-box">
          <div
            ref={textRef}
            className="admin-typeface-text"
            style={{
              fontFamily: `'${family}', sans-serif`,
              fontVariationSettings: settings,
              fontWeight: weight,
              lineHeight: leading,
            }}
          >
            {sentence}
          </div>
        </div>
      </div>
      <div className="admin-typeface-controls">
        <span className="admin-typeface-name">{font.name}</span>
        <label className="admin-axis">
          <span className="admin-axis-label">Size</span>
          <input
            type="range"
            min={10}
            max={100}
            step={1}
            value={Math.round(sizeMul * 100)}
            onChange={(e) => onChange({ ...axes, size: Number(e.target.value) / 100 })}
          />
          <span className="admin-axis-value">{Math.round(sizeMul * 100)}%</span>
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
.admin-textarea { width: 100%; max-width: 640px; background: #fff; border: 0; border-radius: 12px; padding: 16px; font-family: -apple-system, BlinkMacSystemFont, 'SF Pro Text', 'SF Pro', system-ui, sans-serif; font-size: 14px; font-weight: 510; color: #000; outline: none; resize: vertical; min-height: 360px; line-height: 1.45; -webkit-user-select: text; user-select: text; }
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
.admin-type-h { font-size: 14px; font-weight: 510; margin: 0; }
.admin-typefaces { display: flex; flex-direction: column; gap: 20px; }
.admin-typeface { display: flex; gap: 20px; align-items: center; }
.admin-typeface-tile { flex: 0 0 auto; width: 160px; height: 160px; border-radius: 12px; background: #f0f0f0; position: relative; overflow: hidden; cursor: pointer; }
.admin-typeface-box { position: absolute; inset: 16px; display: flex; align-items: center; justify-content: center; }
.admin-typeface-text { max-width: 100%; text-align: center; color: #000; font-synthesis: none; }
.admin-typeface-controls { flex: 1 1 auto; display: flex; flex-direction: column; gap: 8px; max-width: 460px; }
.admin-typeface-name { font-size: 14px; font-weight: 510; }
.admin-axis { display: flex; align-items: center; gap: 12px; }
.admin-axis-label { width: 52px; font-size: 13px; opacity: 0.6; }
.admin-axis input[type='range'] { flex: 1 1 auto; accent-color: #000; cursor: pointer; }
.admin-axis-value { width: 40px; text-align: right; font-size: 13px; font-variant-numeric: tabular-nums; opacity: 0.6; }
.admin-tile-meta { position: absolute; left: 0; right: 0; bottom: 0; padding: 8px 10px; display: flex; flex-direction: column; gap: 2px; background: linear-gradient(to top, rgba(0,0,0,0.55), transparent); color: #fff; font-size: 11px; line-height: 1.3; opacity: 0; transition: opacity 0.15s; pointer-events: none; }
.admin-tile:hover .admin-tile-meta, .admin-tile.is-hidden .admin-tile-meta { opacity: 1; }
.admin-tile-tag { display: inline-block; align-self: flex-start; background: rgba(255,255,255,0.18); padding: 1px 6px; border-radius: 4px; font-weight: 510; font-size: 10px; text-transform: uppercase; letter-spacing: 0.04em; }
.admin-tile-project { font-weight: 510; }
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
.admin-asset { background: #fff; border-radius: 12px; padding: 12px; display: flex; flex-direction: column; gap: 10px; }
.admin-asset-row { display: flex; gap: 12px; align-items: flex-start; }
.admin-asset-row-two { gap: 12px; }
.admin-asset-row-two .admin-qfield { flex: 1 0 0; }
.admin-price-preview { display: flex; flex-wrap: wrap; gap: 8px; font-size: 13px; opacity: 0.55; }
@media (max-width: 700px) {
  .admin-page { padding: 88px 24px 64px; }
  .admin-grid { grid-template-columns: repeat(auto-fill, minmax(120px, 1fr)); }
  .admin-tile-meta, .admin-tile-btn { opacity: 1; }
  .admin-quote-top { flex-direction: column; }
  .admin-asset-row, .admin-asset-row-two { flex-direction: column; }
  .admin-input-num { max-width: none; }
}
    `.trim() }} />
  )
}
