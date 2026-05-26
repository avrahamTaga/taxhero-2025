/**
 * TaxHero 2025 — שורש האפליקציה (RTL)
 * =====================================
 * מארגן את הפריסה הדו-עמודית:
 *   ימין  (flex: 1, גלילה) — אשף 4 השלבים
 *   שמאל  (360px, sticky)  — סרגל סיכום חי
 *
 * גופנים: Heebo (כותרות) + Assistant (גוף), נטענים מ-Google Fonts.
 * כיוון: dir="rtl" על כל עטיפת הדף.
 */

import { useEffect } from 'react'
import Wizard from './components/Wizard'
import SummarySidebar from './components/SummarySidebar'

// ─────────────────────────────────────────────────────────────────────────────
// קבועים
// ─────────────────────────────────────────────────────────────────────────────

const PAGE_BG      = '#F1EEF9'
const HEADER_BG    = 'rgba(241,238,249,0.92)'
const HEADER_TEXT  = '#1C1027'
const HEADER_MUTED = '#7268A0'
const BORDER       = '#E1DBF3'
const ACCENT       = '#7C3AED'

// ─────────────────────────────────────────────────────────────────────────────
// רכיב
// ─────────────────────────────────────────────────────────────────────────────

export default function App() {
  // הזרקת גופנים עבריים ל-<head> פעם אחת
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
    // Heebo — כותרות עבריות; Assistant — גוף עברי
    fontLink.href =
      'https://fonts.googleapis.com/css2?family=Heebo:wght@400;500;600;700;800;900&family=Assistant:wght@300;400;500;600;700&display=swap'

    document.head.append(preconnect1, preconnect2, fontLink)
  }, [])

  return (
    <>
      {/* איפוס סגנון Vite + כיוון RTL */}
      <style>{`
        *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }
        #root {
          max-width: 100% !important;
          border-inline: none !important;
          padding: 0 !important;
          width: 100% !important;
        }
        body {
          background: ${PAGE_BG};
          direction: rtl;
        }
        /* מניעת חצי-סיבוב של מספרים בגופן RTL */
        input[type="number"] { direction: ltr; text-align: left; }
        /* תנועה מופחתת */
        @media (prefers-reduced-motion: reduce) {
          *, *::before, *::after { animation-duration: 0.01ms !important; transition-duration: 0.01ms !important; }
        }
      `}</style>

      {/* עטיפה ראשית — RTL */}
      <div
        dir="rtl"
        lang="he"
        style={{
          minHeight: '100vh',
          backgroundColor: PAGE_BG,
          fontFamily: "'Assistant', system-ui, sans-serif",
        }}
      >
        {/* ── כותרת עליונה ─────────────────────────────────────────────── */}
        <header
          style={{
            position: 'sticky',
            top: 0,
            zIndex: 50,
            backgroundColor: HEADER_BG,
            backdropFilter: 'blur(12px)',
            WebkitBackdropFilter: 'blur(12px)',
            borderBottom: `1px solid ${BORDER}`,
            padding: '0 32px',
            height: 60,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
          }}
        >
          {/* לוגו + שם */}
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <div
              style={{
                width: 34,
                height: 34,
                borderRadius: 10,
                background: `linear-gradient(135deg, ${ACCENT} 0%, #A855F7 100%)`,
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                fontSize: 18,
                color: '#fff',
                fontWeight: 800,
                boxShadow: '0 4px 14px rgba(124,58,237,0.35)',
                flexShrink: 0,
              }}
            >
              ₪
            </div>
            <div>
              <span
                style={{
                  fontSize: 17,
                  fontWeight: 800,
                  color: HEADER_TEXT,
                  fontFamily: "'Heebo', system-ui, sans-serif",
                  letterSpacing: '-0.3px',
                  display: 'block',
                  lineHeight: 1.1,
                }}
              >
                TaxHero 2025
              </span>
              <span
                style={{
                  fontSize: 11,
                  color: HEADER_MUTED,
                  fontWeight: 500,
                  letterSpacing: '0.02em',
                }}
              >
                מחשבון החזר מס — שנת מס 2025
              </span>
            </div>
          </div>

          {/* תג פרטיות */}
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 6,
              backgroundColor: '#EDE9FE',
              border: `1px solid #DDD6FE`,
              borderRadius: 20,
              padding: '5px 12px',
              fontSize: 12,
              color: ACCENT,
              fontWeight: 600,
            }}
          >
            <span style={{ fontSize: 14 }}>🔒</span>
            פרטיות מלאה — אין שרת
          </div>
        </header>

        {/* ── אזור תוכן ראשי ───────────────────────────────────────────── */}
        <div
          style={{
            display: 'flex',
            minHeight: 'calc(100vh - 60px)',
            alignItems: 'stretch',
          }}
        >
          {/* ── אזור אשף (ימין — ראשון ב-RTL) ────────────────────────── */}
          <main
            style={{
              flex: 1,
              overflowY: 'auto',
              padding: '36px 40px 80px',
              minWidth: 0,
            }}
          >
            {/* כותרת עמוד */}
            <div style={{ marginBottom: 32 }}>
              <h1
                style={{
                  fontSize: 30,
                  fontWeight: 900,
                  color: HEADER_TEXT,
                  fontFamily: "'Heebo', system-ui, sans-serif",
                  letterSpacing: '-0.6px',
                  lineHeight: 1.15,
                  marginBottom: 8,
                }}
              >
                הגשת בקשה להחזר מס
              </h1>
              <p
                style={{
                  fontSize: 15,
                  color: HEADER_MUTED,
                  lineHeight: 1.6,
                  maxWidth: 560,
                }}
              >
                מלאו את הפרטים בהדרכה שלב אחר שלב. כל שינוי מחשב מחדש את תוצאת
                המס באופן מיידי בהתאם לחוקי מס הכנסה לשנת 2025.
              </p>
            </div>

            <Wizard />
          </main>

          {/* ── סרגל סיכום (שמאל — שני ב-RTL) ────────────────────────── */}
          <aside
            style={{
              width: 360,
              flexShrink: 0,
              position: 'sticky',
              top: 60,
              height: 'calc(100vh - 60px)',
              overflowY: 'auto',
              borderRight: `1px solid ${BORDER}`,
            }}
          >
            <SummarySidebar />
          </aside>
        </div>
      </div>
    </>
  )
}