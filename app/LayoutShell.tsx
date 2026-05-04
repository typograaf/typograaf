'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import { usePathname } from 'next/navigation'

// Persistent layout shell — the logo button + menu overlay live here so
// they stay mounted across same-domain navigations (no flicker between
// /work and /about). Page content renders as `children` below the menu
// overlay (which sits z-index 90 over the page when open).
//
// The gentle close on landing via ?from=menu is handled separately in
// the head <script> + CSS @keyframes (data-from-menu attribute path),
// so this component doesn't need to know about it.
export default function LayoutShell({ children }: { children: React.ReactNode }) {
  const [menuOpen, setMenuOpen] = useState(false)
  const pathname = usePathname()

  // Close the menu whenever the route changes (Link navigation).
  useEffect(() => {
    setMenuOpen(false)
  }, [pathname])

  return (
    <>
      <button
        type="button"
        className={`logo${menuOpen ? ' logo-open' : ''}`}
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
              <Link href="/work">Work</Link>&nbsp;&nbsp;<Link href="/calendar">Calendar</Link>&nbsp;&nbsp;<Link href="/about">About</Link><br />
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
