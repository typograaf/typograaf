'use client'

import { useEffect, useRef, useState } from 'react'
import Link from 'next/link'
import { usePathname, useRouter } from 'next/navigation'

// Persistent layout shell — the logo button + menu overlay live here so
// they stay mounted across same-domain navigations (no flicker between
// /work and /about). Page content renders as `children` below the menu
// overlay (which sits z-index 90 over the page when open).
const ROUTES = ['/work', '/calendar', '/about'] as const

export default function LayoutShell({ children }: { children: React.ReactNode }) {
  const [menuOpen, setMenuOpen] = useState(false)
  const pathname = usePathname()
  const router = useRouter()
  const prefetchedRef = useRef(false)

  // Close the menu whenever the route changes (Link navigation).
  useEffect(() => {
    setMenuOpen(false)
  }, [pathname])

  // Prefetch every other top-level route once the user shows any
  // navigation intent — first hover/touch/focus on the logo. Idempotent.
  const primeRoutes = () => {
    if (prefetchedRef.current) return
    prefetchedRef.current = true
    for (const r of ROUTES) router.prefetch(r)
  }

  return (
    <>
      <button
        type="button"
        className={`logo${menuOpen ? ' logo-open' : ''}`}
        onClick={() => setMenuOpen((o) => !o)}
        onPointerEnter={primeRoutes}
        onTouchStart={primeRoutes}
        onFocus={primeRoutes}
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
              <Link href="/work" prefetch>Work</Link>&nbsp;&nbsp;<Link href="/calendar" prefetch>Calendar</Link>&nbsp;&nbsp;<Link href="/about" prefetch>About</Link><br />
              t. +32 (0) 493 45 92 96<br />
              m. <a href="mailto:hello@typografie.be">hello@typografie.be</a><br />
              i. <a href="https://instagram.com/typograaf" target="_blank" rel="noopener noreferrer">@typograaf</a><br />
              a. <a href="https://www.are.na/martijn-mertens/channels" target="_blank" rel="noopener noreferrer">Martijn Mertens</a>
            </p>
          </div>
        </aside>
      )}

      {children}
    </>
  )
}
