/**
 * TaxHero 2025 — App Root
 * ========================
 * Orchestrates the two-column layout:
 *   Left  (flex: 1, scrollable) — the 4-step Wizard
 *   Right (360px, sticky)       — the live SummarySidebar
 *
 * Fonts: Bricolage Grotesque (headings) + DM Sans (body), loaded from Google Fonts.
 * Base palette overrides the default Vite template styles via inline overrides.
 *
 * NOTE: If Tailwind is not yet active, add this to the top of src/index.css:
 *   @import "tailwindcss";
 */

import { useEffect } from 'react'
import Wizard from './components/Wizard'
import SummarySidebar from './components/SummarySidebar'

// ─────────────────────────────────────────────────────────────────────────────
// CONSTANTS
// ─────────────────────────────────────────────────────────────────────────────

const PAGE_BG      = '#F1EEF9'
const HEADER_BG    = 'rgba(241,238,249,0.85)'
const HEADER_TEXT  = '#1C1027'
const HEADER_MUTED = '#7268A0'
const BORDER       = '#E1DBF3'
const ACCENT       = '#7C3AED'

// ─────────────────────────────────────────────────────────────────────────────
// COMPONENT
// ─────────────────────────────────────────────────────────────────────────────

export default function App() {
  // Inject Google Fonts into <head> once
  useEffect(() => {
    if (document.getElementById('taxhero-fonts')) return

    const preconnect1 = document.createElement('link')
    preconnect1.rel = 'preconnect'
    preconnect1.href = 'https://fonts.googleapis.com'

    const preconnect2 = document.createElement('link')
    preconnect2.rel = 'preconnect'
    preconnect2.href = 'https://fonts.gstatic.com'
    preconnect2.crossOrigin = 'anonymous'

    const fontLink = document.createElement('link')
    fontLink.id = 'taxhero-fonts'
    fontLink.rel = 'stylesheet'
    fontLink.href =
      'https://fonts.googleapis.com/css2?family=Bricolage+Grotesque:opsz,wght@12..96,500;12..96,700;12..96,800&family=DM+Sans:ital,opsz,wght@0,9..40,300;0,9..40,400;0,9..40,500;0,9..40,600;0,9..40,700;1,9..40,400&display=swap'

    document.head.append(preconnect1, preconnect2, fontLink)
  }, [])

  return (
    <>
      {/*
       * Global style overrides:
       *   • Neutralise the Vite template's #root border-inline and 1126px width
       *     so our layout can go full-width with the sidebar flush to the edge.
       *   • Set a soft lavender page background.
       */}
      <style>{`
        body { margin: 0; background: ${PAGE_BG}; }
        #root {
          width: 100% !important;
          max-width: 100% !important;
          border-inline: none !important;
          text-align: left !important;
          display: flex !important;
          flex-direction: column !important;
          min-height: 100svh;
          font-family: 'DM Sans', system-ui, sans-serif;
        }
        *, *::before, *::after { box-sizing: border-box; }
        input[type=number]::-webkit-inner-spin-button,
        input[type=number]::-webkit-outer-spin-button { opacity: 0.4; }
      `}</style>

      {/* ── Sticky header ─────────────────────────────────────────────────── */}
      <header
        style={{
          position: 'sticky',
          top: 0,
          zIndex: 40,
          backgroundColor: HEADER_BG,
          backdropFilter: 'blur(12px)',
          WebkitBackdropFilter: 'blur(12px)',
          borderBottom: `1px solid ${BORDER}`,
          padding: '0 24px',
          height: 56,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          flexShrink: 0,
        }}
      >
        {/* Logo */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <div
            style={{
              width: 30,
              height: 30,
              borderRadius: 8,
              background: `linear-gradient(135deg, ${ACCENT} 0%, #A855F7 100%)`,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              fontSize: 16,
              color: '#fff',
              flexShrink: 0,
              fontWeight: 800,
            }}
          >
            ₪
          </div>
          <span
            style={{
              fontSize: 16,
              fontWeight: 800,
              color: HEADER_TEXT,
              fontFamily: "'Bricolage Grotesque', system-ui, sans-serif",
              letterSpacing: '-0.3px',
            }}
          >
            TaxHero
            <span
              style={{
                marginLeft: 4,
                fontSize: 12,
                fontWeight: 500,
                color: HEADER_MUTED,
                background: `${ACCENT}18`,
                padding: '2px 7px',
                borderRadius: 20,
                verticalAlign: 'middle',
                letterSpacing: 0,
              }}
            >
              2025
            </span>
          </span>
        </div>

        {/* Right meta */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 16 }}>
          <span
            style={{
              fontSize: 12,
              color: HEADER_MUTED,
              display: 'flex',
              alignItems: 'center',
              gap: 5,
            }}
          >
            <span
              style={{
                width: 7,
                height: 7,
                borderRadius: '50%',
                backgroundColor: '#10B981',
                display: 'inline-block',
              }}
            />
            100% client-side · Zero data sent
          </span>

          <span
            style={{
              fontSize: 12,
              color: HEADER_MUTED,
              borderLeft: `1px solid ${BORDER}`,
              paddingLeft: 16,
            }}
          >
            Tax Year 2025
          </span>
        </div>
      </header>

      {/* ── Main two-column layout ─────────────────────────────────────────── */}
      <div
        style={{
          display: 'flex',
          flex: 1,
          minHeight: 0,
        }}
      >
        {/* ── Left: Wizard ─────────────────────────────────────────────────── */}
        <main
          style={{
            flex: 1,
            minWidth: 0,
            overflowY: 'auto',
            padding: '32px 40px 80px',
          }}
        >
          {/* Page title area */}
          <div style={{ marginBottom: 32 }}>
            <h1
              style={{
                margin: '0 0 6px',
                fontSize: 32,
                fontWeight: 800,
                fontFamily: "'Bricolage Grotesque', system-ui, sans-serif",
                color: HEADER_TEXT,
                letterSpacing: '-1px',
                lineHeight: 1.1,
              }}
            >
              Israeli Tax Return Calculator
            </h1>
            <p style={{ margin: 0, fontSize: 14, color: HEADER_MUTED, lineHeight: 1.6 }}>
              Fill in your details across the four steps below. Your tax result updates live in
              the summary panel.
            </p>
          </div>

          <Wizard />

          {/* Bottom disclaimer */}
          <div
            style={{
              marginTop: 48,
              padding: '14px 16px',
              borderRadius: 10,
              background: `${ACCENT}08`,
              border: `1px solid ${ACCENT}22`,
            }}
          >
            <p style={{ margin: 0, fontSize: 12, color: HEADER_MUTED, lineHeight: 1.6 }}>
              <strong style={{ color: HEADER_TEXT }}>Disclaimer:</strong> TaxHero is an
              estimation tool based on publicly available 2025 ITA rules. No data leaves
              your browser. Always verify results with a licensed tax advisor or the
              official{' '}
              <a
                href="https://www.misim.gov.il"
                target="_blank"
                rel="noopener noreferrer"
                style={{ color: ACCENT, textDecoration: 'none', fontWeight: 600 }}
              >
                misim.gov.il
              </a>{' '}
              simulator before filing.
            </p>
          </div>
        </main>

        {/* ── Right: Summary sidebar ────────────────────────────────────────── */}
        <aside
          style={{
            width: 340,
            flexShrink: 0,
            position: 'sticky',
            top: 56, // header height
            height: 'calc(100vh - 56px)',
            overflowY: 'auto',
            borderLeft: `1px solid ${BORDER}`,
          }}
        >
          <SummarySidebar />
        </aside>
      </div>
    </>
  )
}
