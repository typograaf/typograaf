'use client'

import { useEffect, useState } from 'react'

export default function About() {
  const [menuOpen, setMenuOpen] = useState(false)
  const [closingFromMenu, setClosingFromMenu] = useState(() => {
    if (typeof window === 'undefined') return false
    return new URLSearchParams(window.location.search).get('from') === 'menu'
  })

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

  const logoOpen = menuOpen || closingFromMenu

  return (
    <>
      <button
        type="button"
        className={`logo${logoOpen ? ' logo-open' : ''}`}
        onClick={() => setMenuOpen(!menuOpen)}
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
              <a href="/work?from=menu">Work</a>&nbsp;&nbsp;<a href="/calendar?from=menu">Calendar</a>&nbsp;&nbsp;<a href="/about?from=menu">About</a><br />
              t. +32 (0) 493 45 92 96<br />
              m. <a href="mailto:hello@typografie.be">hello@typografie.be</a><br />
              i. <a href="https://instagram.com/typograaf" target="_blank" rel="noopener noreferrer">@typograaf</a>
            </p>
          </div>
        </aside>
      )}

      {!menuOpen && (
        <main className="about-page">
          <p>Martijn Mertens (1999) is an all-round graphic designer based in Antwerp. He specialises in typography and brand design.</p>
          <p>Additionally, Martijn teaches part-time at Sint Lucas Antwerp, focusing on a systems-based approach to branding.</p>

          <p>SELECTED CLIENTS</p>
          <p>Stad Brugge, KRC Genk, RAFC Antwerp, RSCA, Brussels Airlines, Mas Antwerpen, Caroline Bosmans, Prado</p>

          <p>SELECTED AGENCIES</p>
          <p>Mutant™, WeWantMore, Base Design, Today, AKQA, Lobster, Mr. Henry, Off The Grid, Lucy</p>

          <p>SERVICES</p>
          <p>Typography, Branding, Motion Design, 3D, UX/UI, Creative Coding</p>
        </main>
      )}
    </>
  )
}
