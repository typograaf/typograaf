'use client'

import { useEffect, useState, useCallback, useMemo } from 'react'

const MIN_LEAD_DAYS = 2
const MAX_AHEAD_MONTHS = 4
const MONTH_NAMES = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
]
type Slot = 'am' | 'pm' | 'full'
const SLOT_LABEL: Record<Slot, { name: string; range: string; price: number }> = {
  am:   { name: 'Morning',   range: '09:00–13:00', price: 350 },
  pm:   { name: 'Afternoon', range: '14:00–18:00', price: 350 },
  full: { name: 'Full Day',  range: '09:00–18:00', price: 600 },
}
const SLOT_ORDER: Slot[] = ['am', 'pm', 'full']

const ANTWERP_POSTCODES = new Set([
  '2000', '2018', '2020', '2030', '2040', '2050', '2060',
  '2100', '2140', '2170', '2180',
  '2600', '2610', '2660',
])
const ANTWERP_CITY_RE = /\b(antwerp(en)?|anvers|ekeren|merksem|deurne|berchem|borgerhout|wilrijk|hoboken)\b/

function looksAntwerp({ city, postcode }: { city: string; postcode: string }) {
  const p = postcode.trim()
  if (ANTWERP_POSTCODES.has(p)) return true
  return ANTWERP_CITY_RE.test(city.toLowerCase())
}

function startOfDay(d: Date) { const x = new Date(d); x.setHours(0, 0, 0, 0); return x }
function firstOfMonth(d: Date) { const x = new Date(d); x.setDate(1); x.setHours(0, 0, 0, 0); return x }
function addDays(d: Date, n: number) { const x = new Date(d); x.setDate(x.getDate() + n); return x }
function addMonths(d: Date, n: number) { const x = new Date(d); x.setMonth(x.getMonth() + n); return x }
function ymd(d: Date) {
  const y = d.getFullYear()
  const m = String(d.getMonth() + 1).padStart(2, '0')
  const day = String(d.getDate()).padStart(2, '0')
  return `${y}-${m}-${day}`
}
function fromYmd(s: string) {
  const [y, m, d] = s.split('-').map(Number)
  return new Date(y, m - 1, d)
}
function prettyDate(s: string) {
  return fromYmd(s).toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short' })
}

type Busy = { date: string; slots: Slot[] }
type View = 'booking' | 'confirm' | 'error'

export default function CalendarPage() {
  const today = useMemo(() => startOfDay(new Date()), [])
  const earliest = useMemo(() => addDays(today, MIN_LEAD_DAYS), [today])
  const latest = useMemo(() => addMonths(today, MAX_AHEAD_MONTHS), [today])

  const [monthCursor, setMonthCursor] = useState<Date>(() => firstOfMonth(earliest))
  const [busy, setBusy] = useState<Busy[] | null>(null)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [bookings, setBookings] = useState<Map<string, Slot>>(new Map())

  const [name, setName] = useState('')
  const [email, setEmail] = useState('')
  const [street, setStreet] = useState('')
  const [number, setNumber] = useState('')
  const [postcode, setPostcode] = useState('')
  const [city, setCity] = useState('')
  const [country, setCountry] = useState('')
  const [description, setDescription] = useState('')
  const [location, setLocation] = useState<'office' | 'remote'>('remote')
  const [agreed, setAgreed] = useState(false)

  const [view, setView] = useState<View>('booking')
  const [confirmBody, setConfirmBody] = useState('')
  const [errorBody, setErrorBody] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [summaryError, setSummaryError] = useState<string | null>(null)

  // Load availability ------------------------------------------------------
  useEffect(() => {
    let cancelled = false
    const from = ymd(earliest)
    const to = ymd(latest)
    fetch(`/api/calendar/availability?from=${from}&to=${to}`)
      .then((res) => {
        if (!res.ok) throw new Error(`Server returned ${res.status}`)
        return res.json()
      })
      .then((data) => { if (!cancelled) setBusy(data.busy || []) })
      .catch((err) => { if (!cancelled) setLoadError(err.message || String(err)) })
    return () => { cancelled = true }
  }, [earliest, latest])

  // Helpers tied to current state ------------------------------------------
  const busyFor = useCallback((dateStr: string): Busy | null => {
    if (!busy) return null
    return busy.find((b) => b.date === dateStr) || null
  }, [busy])

  const blockedSetFor = useCallback((dateStr: string): Set<Slot> => {
    const b = busyFor(dateStr)
    return b ? new Set(b.slots) : new Set()
  }, [busyFor])

  const isSlotBlocked = useCallback((dateStr: string, slot: Slot): boolean => {
    const blocked = blockedSetFor(dateStr)
    if (slot === 'full') return blocked.has('am') || blocked.has('pm')
    return blocked.has(slot)
  }, [blockedSetFor])

  const defaultSlotFor = useCallback((dateStr: string): Slot | null => {
    for (const s of ['full', 'am', 'pm'] as Slot[]) if (!isSlotBlocked(dateStr, s)) return s
    return null
  }, [isSlotBlocked])

  // Antwerp detection refresh
  useEffect(() => {
    const ok = looksAntwerp({ city, postcode })
    if (!ok && location === 'office') setLocation('remote')
  }, [city, postcode, location])

  // Month navigation -------------------------------------------------------
  const moveMonth = useCallback((delta: number) => {
    const next = addMonths(monthCursor, delta)
    if (next < firstOfMonth(earliest)) return
    if (next > firstOfMonth(latest)) return
    setMonthCursor(next)
  }, [monthCursor, earliest, latest])

  // Booking selection ------------------------------------------------------
  const toggleDate = useCallback((dateStr: string) => {
    setBookings((prev) => {
      const next = new Map(prev)
      if (next.has(dateStr)) next.delete(dateStr)
      else {
        const def = defaultSlotFor(dateStr)
        if (def) next.set(dateStr, def)
      }
      return next
    })
  }, [defaultSlotFor])

  const setSlot = useCallback((dateStr: string, slot: Slot) => {
    if (isSlotBlocked(dateStr, slot)) return
    setBookings((prev) => {
      if (!prev.has(dateStr)) return prev
      const next = new Map(prev)
      next.set(dateStr, slot)
      return next
    })
  }, [isSlotBlocked])

  const removeBooking = useCallback((dateStr: string) => {
    setBookings((prev) => {
      const next = new Map(prev)
      next.delete(dateStr)
      return next
    })
  }, [])

  // Render data ------------------------------------------------------------
  const sortedBookings = useMemo(
    () => Array.from(bookings.entries()).sort(([a], [b]) => a.localeCompare(b)),
    [bookings],
  )

  const total = useMemo(() => sortedBookings.reduce((acc, [, slot]) => acc + SLOT_LABEL[slot].price, 0), [sortedBookings])
  const count = sortedBookings.length

  const calendarRows = useMemo(() => {
    const cursor = monthCursor
    const firstDow = (cursor.getDay() + 6) % 7
    const daysInMonth = new Date(cursor.getFullYear(), cursor.getMonth() + 1, 0).getDate()
    const cells: ({ empty: true } | { empty: false; date: Date; dateStr: string })[] = []
    for (let i = 0; i < firstDow; i++) cells.push({ empty: true })
    for (let d = 1; d <= daysInMonth; d++) {
      const date = new Date(cursor.getFullYear(), cursor.getMonth(), d)
      cells.push({ empty: false, date, dateStr: ymd(date) })
    }
    while (cells.length % 7 !== 0) cells.push({ empty: true })
    const rows: typeof cells[] = []
    for (let r = 0; r < cells.length; r += 7) rows.push(cells.slice(r, r + 7))
    return rows
  }, [monthCursor])

  const officeAvailable = looksAntwerp({ city, postcode })
  const formValid = name.trim() && email.trim() && street.trim() && number.trim() && postcode.trim() && city.trim() && country.trim() && description.trim()
  const submitEnabled = bookings.size > 0 && agreed && !submitting

  // Submit -----------------------------------------------------------------
  async function handleSubmit(ev: React.FormEvent) {
    ev.preventDefault()
    if (bookings.size === 0) return
    setSummaryError(null)

    if (!formValid) { setSummaryError('Please fill every field'); return }
    if (!/^\S+@\S+\.\S+$/.test(email.trim())) { setSummaryError("That email doesn't look right"); return }
    if (location === 'office' && !looksAntwerp({ city, postcode })) {
      setSummaryError('On-site is only available in Antwerp'); return
    }
    if (!agreed) { setSummaryError('Please agree to the terms'); return }

    setSubmitting(true)
    const items = sortedBookings.map(([date, slot]) => ({ date, slot }))
    try {
      const res = await fetch('/api/calendar/book', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          items, name: name.trim(), email: email.trim(),
          street: street.trim(), number: number.trim(), postcode: postcode.trim(),
          city: city.trim(), country: country.trim(),
          location, description: description.trim(),
          tosAccepted: true, tosVersion: '2025-05-22',
        }),
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(data.error || `Server returned ${res.status}`)

      const lines = items.map(({ date, slot }) => {
        const s = SLOT_LABEL[slot as Slot]
        return `${prettyDate(date)} — ${s.name.toLowerCase()} (${s.range})`
      })
      setConfirmBody(`Booked: ${lines.join(' · ')}. Added to my calendar.`)

      // Optimistic local update
      setBusy((prev) => {
        const next = prev ? [...prev] : []
        for (const { date, slot } of items) {
          const slotsToAdd: Slot[] = slot === 'full' ? ['am', 'pm'] : [slot as Slot]
          const existing = next.find((b) => b.date === date)
          if (existing) {
            const merged = new Set([...existing.slots, ...slotsToAdd])
            existing.slots = Array.from(merged).sort() as Slot[]
          } else {
            next.push({ date, slots: slotsToAdd })
          }
        }
        return next
      })
      setBookings(new Map())
      setAgreed(false)
      setView('confirm')
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      setErrorBody(msg)
      setView('error')
    } finally {
      setSubmitting(false)
    }
  }

  // ------------------------------------------------------------------------
  return (
    <main className="page">
      <section className="intro">
        <h1>Book a day</h1>
        <div className="rate">
          <p>€350 1/2 Day</p>
          <p>·</p>
          <p>€600 / Day</p>
          <p>·</p>
          <p>Min. 2 day notice</p>
        </div>
      </section>

      {view === 'booking' && (
        <>
          <section className="cal" aria-label="Availability">
            <div className="cal-top">
              <div className="cal-header">
                <button
                  className="cal-nav" type="button" aria-label="Previous month"
                  onClick={() => moveMonth(-1)}
                  disabled={addMonths(monthCursor, -1) < firstOfMonth(earliest)}
                >‹</button>
                <span className="cal-month">{`${MONTH_NAMES[monthCursor.getMonth()]} ${monthCursor.getFullYear()}`}</span>
                <button
                  className="cal-nav" type="button" aria-label="Next month"
                  onClick={() => moveMonth(1)}
                  disabled={addMonths(monthCursor, 1) > firstOfMonth(latest)}
                >›</button>
              </div>
              <div className="cal-weekdays" aria-hidden="true">
                {['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'].map((d) => (
                  <span key={d} className="cal-weekday">{d}</span>
                ))}
              </div>
            </div>
            <div className="cal-grid">
              {calendarRows.map((row, ri) => (
                <div key={ri} className="cal-row">
                  {row.map((cell, ci) => {
                    if (cell.empty) return <div key={ci} className="cal-day is-empty" />
                    const { date, dateStr } = cell
                    const dow = date.getDay()
                    const isWeekend = dow === 0 || dow === 6
                    const tooEarly = date < earliest
                    const tooLate = date > latest
                    const blocked = blockedSetFor(dateStr)
                    const fullyBlocked = blocked.has('am') && blocked.has('pm')
                    const disabled = isWeekend || tooEarly || tooLate || fullyBlocked
                    const classes = ['cal-day']
                    if (isWeekend) classes.push('is-weekend')
                    if (tooEarly || tooLate) classes.push('is-past')
                    if (fullyBlocked) classes.push('is-blocked')
                    if (bookings.has(dateStr)) classes.push('is-selected')
                    return (
                      <button
                        key={ci} className={classes.join(' ')} type="button"
                        disabled={disabled}
                        onClick={() => toggleDate(dateStr)}
                      >{date.getDate()}</button>
                    )
                  })}
                </div>
              ))}
            </div>
            {!busy && !loadError && <p className="cal-loading">Loading availability…</p>}
            {loadError && <p className="cal-loading">Couldn&rsquo;t load the calendar. Refresh to try again.</p>}
          </section>

          {bookings.size > 0 && (
            <>
              <section className="book-area">
                <section className="bookings">
                  <div className="bookings-summary">
                    <p>{count} {count === 1 ? 'Day' : 'Days'} Selected</p>
                    <p>·</p>
                    <p>€{total}</p>
                  </div>
                  <div className="booking-rows">
                    {sortedBookings.map(([dateStr, slot]) => (
                      <div key={dateStr} className="booking-row">
                        <span className="booking-date">{prettyDate(dateStr)}</span>
                        <div className="booking-slots">
                          {SLOT_ORDER.map((s) => (
                            <button
                              key={s}
                              type="button"
                              className={`pill${slot === s ? ' is-selected' : ''}`}
                              title={`${SLOT_LABEL[s].range} · €${SLOT_LABEL[s].price}`}
                              disabled={isSlotBlocked(dateStr, s)}
                              onClick={() => setSlot(dateStr, s)}
                            >{SLOT_LABEL[s].name}</button>
                          ))}
                          <button
                            type="button"
                            className="pill"
                            title="Remove this day"
                            aria-label={`Remove ${prettyDate(dateStr)}`}
                            onClick={() => removeBooking(dateStr)}
                          >×</button>
                        </div>
                      </div>
                    ))}
                  </div>
                </section>

                <section className="form">
                  <h2>Your Details</h2>
                  <form id="bookingForm" noValidate onSubmit={handleSubmit}>
                    <div className="field-row">
                      <div className="field">
                        <label htmlFor="name">Name</label>
                        <input type="text" id="name" required autoComplete="name" value={name} onChange={(e) => setName(e.target.value)} />
                      </div>
                    </div>
                    <div className="field-row">
                      <div className="field">
                        <label htmlFor="email">Email</label>
                        <input type="email" id="email" required autoComplete="email" value={email} onChange={(e) => setEmail(e.target.value)} />
                      </div>
                    </div>
                    <div className="field-row two">
                      <div className="field">
                        <label htmlFor="street">Street</label>
                        <input type="text" id="street" required autoComplete="address-line1" value={street} onChange={(e) => setStreet(e.target.value)} />
                      </div>
                      <div className="field">
                        <label htmlFor="number">Number</label>
                        <input type="text" id="number" required autoComplete="address-line2" value={number} onChange={(e) => setNumber(e.target.value)} />
                      </div>
                    </div>
                    <div className="field-row two">
                      <div className="field">
                        <label htmlFor="postcode">Postcode</label>
                        <input type="text" id="postcode" required autoComplete="postal-code" inputMode="numeric" value={postcode} onChange={(e) => setPostcode(e.target.value)} />
                      </div>
                      <div className="field">
                        <label htmlFor="city">City</label>
                        <input type="text" id="city" required autoComplete="address-level2" value={city} onChange={(e) => setCity(e.target.value)} />
                      </div>
                    </div>
                    <div className="field-row">
                      <div className="field">
                        <label htmlFor="country">Country</label>
                        <input type="text" id="country" required autoComplete="country-name" value={country} onChange={(e) => setCountry(e.target.value)} />
                      </div>
                    </div>
                  </form>
                </section>

                <section className="where">
                  <h2>Where</h2>
                  <div className="where-options">
                    <button
                      type="button"
                      className={`pill where-option${location === 'office' ? ' is-selected' : ''}`}
                      disabled={!officeAvailable}
                      onClick={() => officeAvailable && setLocation('office')}
                    >At your office</button>
                    <button
                      type="button"
                      className={`pill where-option${location === 'remote' ? ' is-selected' : ''}`}
                      onClick={() => setLocation('remote')}
                    >Remote</button>
                  </div>
                </section>

                <section className="scope">
                  <h2>Project Scope</h2>
                  <textarea required value={description} onChange={(e) => setDescription(e.target.value)} />
                </section>
              </section>

              <section className="foot">
                <div className="agree-row">
                  <button
                    type="button"
                    className={`pill agree-check${agreed ? '' : ' is-empty'}`}
                    aria-label="Agree to terms"
                    aria-pressed={agreed}
                    onClick={() => setAgreed((a) => !a)}
                  ><span>×</span></button>
                  <span className="agree-text">I&rsquo;ve read and agree to the <a href="/calendar/terms" target="_blank" rel="noopener">terms and conditions</a></span>
                </div>
                <div className="submit-row">
                  <div className={`summary${summaryError ? ' is-error' : ''}`}>
                    {summaryError ? (
                      <p>{summaryError}</p>
                    ) : (
                      <>
                        <p>{count} {count === 1 ? 'Booking' : 'Bookings'}</p>
                        <p>·</p>
                        <p>€{total} total</p>
                      </>
                    )}
                  </div>
                  <button
                    type="button"
                    className="pill is-filled"
                    disabled={!submitEnabled}
                    onClick={(e) => handleSubmit(e as unknown as React.FormEvent)}
                  >{submitting ? 'Sending…' : 'Request Booking'}</button>
                </div>
              </section>
            </>
          )}
        </>
      )}

      {view === 'confirm' && (
        <section className="confirm">
          <h2>Booked.</h2>
          <p>{confirmBody}</p>
          <p>I&rsquo;ll follow up by email within a working day with the invoice and any logistics. If you don&rsquo;t hear back, mail me at <a href="mailto:martijn@aboutcontact.com">martijn@aboutcontact.com</a>.</p>
        </section>
      )}

      {view === 'error' && (
        <section className="error">
          <h2>That didn&rsquo;t work.</h2>
          <p>{errorBody}</p>
          <button type="button" className="pill is-filled" onClick={() => setView('booking')}>Try again</button>
        </section>
      )}
    </main>
  )
}
