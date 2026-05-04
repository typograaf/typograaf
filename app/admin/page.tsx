'use client'

import { useEffect, useMemo, useRef, useState } from 'react'

type Tab = 'work' | 'about' | 'images'

interface AdminImage {
  id: string
  name: string
  url: string
  project: string
  hidden: boolean
}

export default function Admin() {
  const [authed, setAuthed] = useState<boolean | null>(null)
  const [password, setPassword] = useState('')
  const [pwError, setPwError] = useState(false)
  const [tab, setTab] = useState<Tab>('work')
  const [order, setOrder] = useState<string[]>([])
  const [about, setAbout] = useState('')
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
      body: JSON.stringify({ order, about }),
    })
    setSaving(false)
    setSavedAt(Date.now())
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
                    <img src={img.url} alt={img.name} loading="lazy" />
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
          {tab === 'images' && 'Click ◎ to hide an image from the public site (file stays in Dropbox). Click × to delete it from Dropbox — your Mac will sync the deletion within seconds. Deletion cannot be undone.'}
        </p>
      </main>
    </>
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
@media (max-width: 700px) {
  .admin-page { padding: 88px 24px 64px; }
  .admin-grid { grid-template-columns: repeat(auto-fill, minmax(120px, 1fr)); }
  .admin-tile-meta, .admin-tile-btn { opacity: 1; }
}
    `.trim() }} />
  )
}
