'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import { usePathname, useSearchParams } from 'next/navigation'

// Persistent layout shell — the logo button + menu overlay live here so
// they stay mounted across same-domain navigations (no flicker between
// /work and /about). Page content renders as `children` below the menu
// overlay (which sits z-index 90 over the page when open).
//
// Cross-domain navigation to calendar.typografie.be still does a full
// page reload; the booking app reads ?from=menu via its inline <head>
// script and runs the same close animation independently.
export default function LayoutShell({ children }: { children: React.ReactNode }) {
  const [menuOpen, setMenuOpen] = useState(false)
  const pathname = usePathname()
  const searchParams = useSearchParams()

  // ?from=menu on initial load means we just arrived from another site's
  // menu (e.g. calendar.typografie.be). Start the logo in its open pose
  // and transition closed after first paint. Using useSearchParams so the
  // value matches between SSR and CSR (no hydration mismatch).
  const fromMenu = searchParams.get('from') === 'menu'
  const [closingFromMenu, setClosingFromMenu] = useState(fromMenu)

  // Strip ?from=menu from the URL and trigger the close transition once
  // the open pose has been painted at least once.
  useEffect(() => {
    if (!closingFromMenu) return
    const url = new URL(window.location.href)
    url.searchParams.delete('from')
    window.history.replaceState({}, '', url.pathname + url.search + url.hash)
    requestAnimationFrame(() => {
      requestAnimationFrame(() => setClosingFromMenu(false))
    })
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // Close the menu whenever the route changes (e.g. user clicked About).
  useEffect(() => {
    setMenuOpen(false)
  }, [pathname])

  const logoOpen = menuOpen || closingFromMenu

  return (
    <>
      <button
        type="button"
        className={`logo${logoOpen ? ' logo-open' : ''}`}
        onClick={() => setMenuOpen((o) => !o)}
        aria-label={menuOpen ? 'Close menu' : 'Open menu'}
        aria-expanded={menuOpen}
      >
        <div className="logo-layer logo-back" />
        <div className="logo-layer logo-middle" />
        <div className="logo-layer logo-front" />
      </button>

      {menuOpen && (
        <aside className="menu">
          <div className="menu-inner">
            <p className="menu-block">
              <Link href="/work">Work</Link>&nbsp;&nbsp;<a href="/calendar?from=menu">Calendar</a>&nbsp;&nbsp;<Link href="/about">About</Link><br />
              t. +32 (0) 493 45 92 96<br />
              m. <a href="mailto:hello@typografie.be">hello@typografie.be</a><br />
              i. <a href="https://instagram.com/typograaf" target="_blank" rel="noopener noreferrer">@typograaf</a>
            </p>
          </div>
        </aside>
      )}

      {children}
    </>
  )
}
