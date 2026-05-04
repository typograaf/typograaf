'use client'

import { useEffect, useRef, useState } from 'react'
import Link from 'next/link'
import { usePathname, useRouter } from 'next/navigation'

// Persistent layout shell — the logo button + menu overlay live here so
// they stay mounted across same-domain navigations (no flicker between
// /work and /about). Page content renders as `children` below the menu
// overlay (which sits z-index 90 over the page when open).
//
// The gentle close on landing via ?from=menu is handled separately in
// the head <script> + CSS @keyframes (data-from-menu attribute path),
// so this component doesn't need to know about it.
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
  // navigation intent — first hover/touch on the logo. Cheaper than
  // doing it on every page mount, more aggressive than waiting for the
  // menu to open. Idempotent — runs once per session.
  const primeRoutes = () => {
    if (prefetchedRef.current) return
    prefetchedRef.current = true
    for (const r of ROUTES) router.prefetch(r)
  }

  // Smooth view transition for client-side navigation. Falls back to
  // an immediate push on browsers without startViewTransition (Firefox
  // <127 etc.) so behavior stays correct everywhere.
  const navigate = (href: string) => (e: React.MouseEvent<HTMLAnchorElement>) => {
    if (e.metaKey || e.ctrlKey || e.shiftKey || e.button !== 0) return
    e.preventDefault()
    const go = () => router.push(href)
    const doc = document as Document & { startViewTransition?: (cb: () => void) => unknown }
    if (typeof doc.startViewTransition === 'function') doc.startViewTransition(go)
    else go()
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
              <Link href="/work" prefetch onClick={navigate('/work')}>Work</Link>&nbsp;&nbsp;<Link href="/calendar" prefetch onClick={navigate('/calendar')}>Calendar</Link>&nbsp;&nbsp;<Link href="/about" prefetch onClick={navigate('/about')}>About</Link><br />
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
