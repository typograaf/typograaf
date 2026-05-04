'use client'

import { useEffect, useRef, useState } from 'react'

type Tab = 'work' | 'about'

export default function Admin() {
  const [authed, setAuthed] = useState<boolean | null>(null)
  const [password, setPassword] = useState('')
  const [pwError, setPwError] = useState(false)
  const [tab, setTab] = useState<Tab>('work')
  const [order, setOrder] = useState<string[]>([])
  const [about, setAbout] = useState('')
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [savedAt, setSavedAt] = useState<number | null>(null)
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
          </div>
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

        <p className="admin-muted admin-hint">
          {tab === 'work'
            ? 'Drag rows to reorder, or use the arrows. New projects from Dropbox auto-prepend until you save a new order.'
            : 'One paragraph per line. Empty lines are ignored.'}
        </p>
      </main>
    </>
  )
}

function AdminStyles() {
  return (
    <style dangerouslySetInnerHTML={{ __html: `
.admin-page { max-width: 640px; margin: 0 auto; padding: 96px 32px 96px; display: flex; flex-direction: column; gap: 24px; }
.admin-login { position: fixed; inset: 0; display: flex; align-items: center; justify-content: center; background: #fff; z-index: 50; }
.admin-header { display: flex; justify-content: space-between; align-items: center; gap: 12px; flex-wrap: wrap; }
.admin-tabs { display: flex; gap: 4px; }
.admin-save-row { display: flex; align-items: center; gap: 12px; }
.admin-tab { background: transparent; border: 0; padding: 12px; border-radius: 12px; font: inherit; color: #000; cursor: pointer; transition: background 0.12s, opacity 0.12s; }
.admin-tab:hover:not(:disabled):not(.is-active):not(.is-primary) { background: rgba(0,0,0,0.04); }
.admin-tab.is-active { background: #fff; }
.admin-tab.is-primary { background: #fff; }
.admin-tab:disabled { opacity: 0.3; cursor: not-allowed; }
.admin-list { display: flex; flex-direction: column; gap: 4px; }
.admin-row { background: #fff; border-radius: 12px; padding: 12px; display: flex; align-items: center; gap: 12px; cursor: grab; }
.admin-row.is-drag-over { box-shadow: 0 0 0 1px rgba(0,0,0,0.15); }
.admin-row:active { cursor: grabbing; }
.admin-handle { opacity: 0.3; user-select: none; }
.admin-name { flex: 1; -webkit-user-select: text; user-select: text; }
.admin-arrow { background: transparent; border: 0; padding: 4px 8px; font: inherit; color: #000; cursor: pointer; border-radius: 8px; transition: background 0.12s, opacity 0.12s; }
.admin-arrow:hover:not(:disabled) { background: rgba(0,0,0,0.04); }
.admin-arrow:disabled { opacity: 0.2; cursor: not-allowed; }
.admin-textarea { width: 100%; background: #fff; border: 0; border-radius: 12px; padding: 16px; font-family: -apple-system, BlinkMacSystemFont, 'SF Pro Text', 'SF Pro', system-ui, sans-serif; font-size: 14px; font-weight: 510; color: #000; outline: none; resize: vertical; min-height: 360px; line-height: 1.45; -webkit-user-select: text; user-select: text; }
.admin-textarea:focus { box-shadow: 0 0 0 1px rgba(0,0,0,0.15); }
.admin-muted { opacity: 0.4; margin: 0; }
.admin-hint { font-size: 14px; }
@media (max-width: 700px) { .admin-page { padding: 88px 24px 64px; } }
    `.trim() }} />
  )
}
