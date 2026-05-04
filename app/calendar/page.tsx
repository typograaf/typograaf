import CalendarBooking, { type Busy } from './CalendarBooking'
import { requireEnv, fetchEvents, computeBusyDays, brusselsToUtc } from '@/lib/caldav'

// Pre-render the page HTML at the edge and refresh at most once per minute.
// Visitors within the window get the cached HTML + busy data instantly.
export const revalidate = 60

const MIN_LEAD_DAYS = 2
const MAX_AHEAD_MONTHS = 4

function ymd(d: Date) {
  const y = d.getFullYear()
  const m = String(d.getMonth() + 1).padStart(2, '0')
  const day = String(d.getDate()).padStart(2, '0')
  return `${y}-${m}-${day}`
}

async function loadInitialBusy(): Promise<Busy[] | null> {
  try {
    const cfg = requireEnv()
    const today = new Date()
    today.setHours(0, 0, 0, 0)
    const earliest = new Date(today); earliest.setDate(earliest.getDate() + MIN_LEAD_DAYS)
    const latest = new Date(today); latest.setMonth(latest.getMonth() + MAX_AHEAD_MONTHS)
    const from = ymd(earliest)
    const to = ymd(latest)
    const [fy, fm, fd] = from.split('-').map(Number)
    const [ty, tm, td] = to.split('-').map(Number)
    const fromUtc = brusselsToUtc(fy, fm, fd, 0, 0)
    const toUtc = brusselsToUtc(ty, tm, td, 23, 59)
    const events = await fetchEvents(cfg, fromUtc, toUtc)
    return computeBusyDays(events, from, to) as Busy[]
  } catch {
    return null
  }
}

export default async function CalendarPage() {
  const initialBusy = await loadInitialBusy()
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
      <CalendarBooking initialBusy={initialBusy} />
    </main>
  )
}
