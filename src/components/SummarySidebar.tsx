/**
 * TaxHero 2025 — סרגל סיכום (RTL עברית)
 * ========================================
 * פאנל סטיקי שמאלי המציג חישובי מס בזמן אמת
 * ממקור הנתונים של Zustand. כל רינדור משקף את
 * תוצאת taxResult העדכנית ביותר — ללא state מקומי.
 *
 * חלקים:
 *   1. באנר תוצאה    — החזר מס / חוב מס / מאוזן + הסכום.
 *   2. שלבי חישוב    — ברוטו → ניכויים → חייב → תיאורטי → בפועל.
 *   3. פירוט זיכויים — ערך נקודות + זיכויים ישירים.
 *   4. שורת ניכוי    — מס שנוכה במקור.
 *   5. רשימת אזהרות  — הודעות מנוע המס.
 */

import { useTaxStore } from '../store/useTaxStore'

// ─── עזרים ───────────────────────────────────────────────────────────────────

const ILS = new Intl.NumberFormat('he-IL', {
  style: 'currency',
  currency: 'ILS',
  maximumFractionDigits: 0,
})

const fmt = (n: number) => ILS.format(Math.abs(n))

// ─── רכיבי עזר ───────────────────────────────────────────────────────────────

function Row({
  label,
  value,
  muted,
  emphasis,
}: {
  label: string
  value: string
  muted?: boolean
  emphasis?: boolean
}) {
  return (
    <div
      style={{
        display: 'flex',
        justifyContent: 'space-between',
        alignItems: 'center',
        padding: '7px 0',
        borderBottom: '1px solid rgba(255,255,255,0.06)',
        opacity: muted ? 0.5 : 1,
      }}
    >
      {/* תווית — צד ימין ב-RTL */}
      <span style={{ fontSize: 13, color: '#C4BAE8', lineHeight: 1.4 }}>
        {label}
      </span>
      {/* ערך — צד שמאל ב-RTL */}
      <span
        style={{
          fontSize: emphasis ? 15 : 13,
          fontWeight: emphasis ? 800 : 500,
          color: '#F0EBFF',
          fontVariantNumeric: 'tabular-nums',
          direction: 'ltr',
          textAlign: 'left',
        }}
      >
        {value}
      </span>
    </div>
  )
}

function SectionTitle({ children }: { children: React.ReactNode }) {
  return (
    <p
      style={{
        fontSize: 10,
        fontWeight: 700,
        letterSpacing: '0.1em',
        textTransform: 'uppercase',
        color: '#8B7EC8',
        marginTop: 22,
        marginBottom: 6,
      }}
    >
      {children}
    </p>
  )
}

// ─── רכיב ראשי ───────────────────────────────────────────────────────────────

export default function SummarySidebar() {
  const { taxResult } = useTaxStore()

  const {
    totalGrossIncome,
    totalDeductions,
    taxableIncome,
    theoreticalTax,
    totalCreditPointsValue,
    totalDirectCredits,
    totalCreditsValue,
    actualTax,
    totalWithheldTax,
    finalBalance,
    outcome,
    creditPointsBreakdown,
    warnings,
  } = taxResult

  const outcomeColor =
    outcome === 'REFUND' ? '#34D399' : outcome === 'DEBT' ? '#F87171' : '#94A3B8'

  const outcomeLabelHe =
    outcome === 'REFUND' ? 'החזר מס' : outcome === 'DEBT' ? 'חוב מס' : 'מאוזן'

  const outcomeLabelEn =
    outcome === 'REFUND' ? 'Tax Refund' : outcome === 'DEBT' ? 'Tax Debt' : 'Balanced'

  const outcomeSubtitleHe =
    outcome === 'REFUND'
      ? 'יוחזר אליכם על ידי רשות המסים'
      : outcome === 'DEBT'
        ? 'יש לשלם לרשות המסים'
        : ''

  const totalPoints = creditPointsBreakdown.total

  // פירוט נקודות זיכוי — תרגום לעברית
  const pointsRows: [string, number][] = [
    ['בסיס (מין)',                 creditPointsBreakdown.base],
    ['נסיעות לעבודה',              creditPointsBreakdown.travel],
    ['הורה יחידני',                creditPointsBreakdown.singleParent],
    ['ילדים',                      creditPointsBreakdown.children],
    ['ילדים עם מוגבלות',           creditPointsBreakdown.disabledChildren],
    ['שוחרר/ת מצה״ל',             creditPointsBreakdown.dischargedSoldier],
    ['תואר אקדמי',                 creditPointsBreakdown.academicDegree],
    ['עולה חדש/ה',                 creditPointsBreakdown.olehChadash],
  ]

  return (
    <aside
      dir="rtl"
      style={{
        width: '100%',
        minHeight: '100%',
        backgroundColor: '#0E0920',
        backgroundImage:
          'radial-gradient(ellipse 60% 40% at 50% 0%, rgba(124,58,237,0.18) 0%, transparent 70%)',
        padding: '28px 22px 48px',
        display: 'flex',
        flexDirection: 'column',
        fontFamily: "'Assistant', system-ui, sans-serif",
        overflowY: 'auto',
        color: '#F0EBFF',
      }}
    >
      {/* ── לוגו ─────────────────────────────────────────────────────────── */}
      <div
        style={{
          marginBottom: 28,
          display: 'flex',
          alignItems: 'center',
          gap: 9,
        }}
      >
        <div
          style={{
            width: 34,
            height: 34,
            borderRadius: 10,
            background: 'linear-gradient(135deg, #7C3AED 0%, #A855F7 100%)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            fontSize: 17,
            fontWeight: 800,
            color: '#fff',
            flexShrink: 0,
            boxShadow: '0 4px 14px rgba(124,58,237,0.4)',
          }}
        >
          ₪
        </div>
        <div>
          <span
            style={{
              fontSize: 15,
              fontWeight: 800,
              color: '#F0EBFF',
              fontFamily: "'Heebo', system-ui, sans-serif",
              letterSpacing: '-0.2px',
              display: 'block',
              lineHeight: 1.1,
            }}
          >
            TaxHero 2025
          </span>
          <span style={{ fontSize: 11, color: '#8B7EC8', fontWeight: 500 }}>
            סיכום חישוב מס — עודכן בזמן אמת
          </span>
        </div>
      </div>

      {/* ── באנר תוצאה ───────────────────────────────────────────────────── */}
      <div
        style={{
          borderRadius: 18,
          padding: '24px 20px',
          background:
            outcome === 'REFUND'
              ? 'linear-gradient(135deg, #064E3B 0%, #065F46 100%)'
              : outcome === 'DEBT'
                ? 'linear-gradient(135deg, #450A0A 0%, #7F1D1D 100%)'
                : 'linear-gradient(135deg, #1E1B4B 0%, #312E81 100%)',
          border: `1px solid ${outcomeColor}33`,
          marginBottom: 10,
          textAlign: 'center',
          position: 'relative',
          overflow: 'hidden',
        }}
      >
        {/* זוהר */}
        <div
          style={{
            position: 'absolute',
            top: -50,
            left: '50%',
            transform: 'translateX(-50%)',
            width: 180,
            height: 90,
            borderRadius: '50%',
            background: `${outcomeColor}1A`,
            filter: 'blur(28px)',
            pointerEvents: 'none',
          }}
        />

        <p
          style={{
            fontSize: 11,
            fontWeight: 700,
            letterSpacing: '0.1em',
            textTransform: 'uppercase',
            color: outcomeColor,
            marginBottom: 8,
            position: 'relative',
          }}
        >
          {outcomeLabelHe} · {outcomeLabelEn}
        </p>
        <p
          style={{
            fontSize: 44,
            fontWeight: 900,
            color: outcomeColor,
            lineHeight: 1,
            marginBottom: 6,
            fontVariantNumeric: 'tabular-nums',
            fontFamily: "'Heebo', system-ui, sans-serif",
            position: 'relative',
            direction: 'ltr',
          }}
        >
          {fmt(finalBalance)}
        </p>
        {outcome !== 'BALANCED' && (
          <p
            style={{
              fontSize: 12,
              color: `${outcomeColor}BB`,
              position: 'relative',
            }}
          >
            {outcomeSubtitleHe}
          </p>
        )}
      </div>

      {/* ── שלבי חישוב ───────────────────────────────────────────────────── */}
      <SectionTitle>שלבי החישוב</SectionTitle>

      <Row label="הכנסה ברוטו (קוד 158)" value={fmt(totalGrossIncome)} />
      <Row
        label="בניכוי: ניכויים מהכנסה"
        value={totalDeductions > 0 ? `− ${fmt(totalDeductions)}` : '₪0'}
        muted={totalDeductions === 0}
      />
      <Row label="= הכנסה חייבת במס" value={fmt(taxableIncome)} emphasis />
      <Row label="מס תיאורטי (לפי מדרגות)" value={fmt(theoreticalTax)} />
      <Row
        label="בניכוי: זיכויי מס"
        value={
          totalCreditsValue > 0
            ? `− ${fmt(Math.min(totalCreditsValue, theoreticalTax))}`
            : '₪0'
        }
        muted={totalCreditsValue === 0}
      />
      <Row label="= מס בפועל (לאחר זיכויים)" value={fmt(actualTax)} emphasis />
      <Row
        label="בניכוי: מס שנוכה במקור"
        value={totalWithheldTax > 0 ? `− ${fmt(totalWithheldTax)}` : '₪0'}
        muted={totalWithheldTax === 0}
      />

      {/* ── יתרה סופית ────────────────────────────────────────────────────── */}
      <div
        style={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          padding: '12px 14px',
          borderRadius: 10,
          backgroundColor: `${outcomeColor}12`,
          border: `1px solid ${outcomeColor}33`,
          marginTop: 10,
          marginBottom: 4,
        }}
      >
        <span style={{ fontSize: 14, fontWeight: 700, color: '#F0EBFF' }}>
          יתרה סופית
        </span>
        <span
          style={{
            fontSize: 18,
            fontWeight: 900,
            color: outcomeColor,
            fontVariantNumeric: 'tabular-nums',
            direction: 'ltr',
          }}
        >
          {outcome === 'REFUND' ? '← ' : outcome === 'DEBT' ? '→ ' : ''}
          {outcome === 'REFUND'
            ? `${fmt(finalBalance)} החזר`
            : outcome === 'DEBT'
              ? `${fmt(finalBalance)} חוב`
              : '₪0'}
        </span>
      </div>

      {/* ── פירוט זיכויים ───────────────────────────────────────────────── */}
      <SectionTitle>פירוט נקודות זיכוי</SectionTitle>

      <div
        style={{
          background: 'rgba(255,255,255,0.04)',
          borderRadius: 12,
          padding: '12px 14px',
          marginBottom: 4,
          border: '1px solid rgba(255,255,255,0.06)',
        }}
      >
        {pointsRows
          .filter(([, v]) => v > 0)
          .map(([label, v]) => (
            <div
              key={label}
              style={{
                display: 'flex',
                justifyContent: 'space-between',
                fontSize: 12,
                color: '#C4BAE8',
                padding: '3px 0',
              }}
            >
              <span>{label}</span>
              <span
                style={{
                  fontVariantNumeric: 'tabular-nums',
                  color: '#A78BFA',
                  direction: 'ltr',
                }}
              >
                {(v as number).toFixed(2)} נק׳
              </span>
            </div>
          ))}

        <div
          style={{
            borderTop: '1px solid rgba(255,255,255,0.1)',
            marginTop: 8,
            paddingTop: 8,
            display: 'flex',
            justifyContent: 'space-between',
            fontSize: 13,
            color: '#F0EBFF',
            fontWeight: 700,
          }}
        >
          <span>סה״כ: {totalPoints.toFixed(2)} נק׳ × ₪2,904</span>
          <span style={{ color: '#A78BFA', direction: 'ltr' }}>
            {fmt(totalCreditPointsValue)}
          </span>
        </div>
      </div>

      {/* זיכויים ישירים */}
      {totalDirectCredits > 0 && (
        <div
          style={{
            display: 'flex',
            justifyContent: 'space-between',
            fontSize: 13,
            color: '#C4BAE8',
            padding: '7px 0',
            borderBottom: '1px solid rgba(255,255,255,0.06)',
          }}
        >
          <span>זיכויים ישירים נוספים</span>
          <span
            style={{ color: '#A78BFA', fontWeight: 700, direction: 'ltr' }}
          >
            {fmt(totalDirectCredits)}
          </span>
        </div>
      )}

      <div
        style={{
          display: 'flex',
          justifyContent: 'space-between',
          fontSize: 13,
          color: '#F0EBFF',
          fontWeight: 700,
          padding: '8px 0',
          borderBottom: '1px solid rgba(255,255,255,0.08)',
        }}
      >
        <span>סה״כ זיכויי מס</span>
        <span style={{ color: '#A78BFA', direction: 'ltr' }}>
          {fmt(totalCreditsValue)}
        </span>
      </div>

      {/* ── אזהרות ─────────────────────────────────────────────────────────── */}
      {warnings.length > 0 && (
        <>
          <SectionTitle>הודעות מנוע המס</SectionTitle>
          <div
            style={{
              backgroundColor: 'rgba(251,191,36,0.08)',
              border: '1px solid rgba(251,191,36,0.25)',
              borderRadius: 10,
              padding: '12px 14px',
            }}
          >
            {warnings.map((w, i) => (
              <div
                key={i}
                style={{
                  fontSize: 12,
                  color: '#FCD34D',
                  lineHeight: 1.55,
                  paddingBottom: i < warnings.length - 1 ? 8 : 0,
                  borderBottom:
                    i < warnings.length - 1
                      ? '1px solid rgba(251,191,36,0.15)'
                      : 'none',
                  marginBottom: i < warnings.length - 1 ? 8 : 0,
                }}
              >
                ⚠ {w}
              </div>
            ))}
          </div>
        </>
      )}

      {/* ── כתב ויתור ─────────────────────────────────────────────────────── */}
      <div
        style={{
          marginTop: 'auto',
          paddingTop: 24,
          fontSize: 11,
          color: '#4B4369',
          lineHeight: 1.6,
          textAlign: 'center',
        }}
      >
        <div
          style={{
            width: '100%',
            height: 1,
            backgroundColor: 'rgba(255,255,255,0.06)',
            marginBottom: 16,
          }}
        />
        חישוב מכוון לשנת המס 2025 בלבד.
        <br />
        כל הנתונים מעובדים <strong style={{ color: '#6B5FC7' }}>מקומית בדפדפן</strong> —
        שום מידע לא נשלח לשרת.
        <br />
        אינו מהווה ייעוץ מס מקצועי.
      </div>
    </aside>
  )
}
