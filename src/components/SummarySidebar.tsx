/**
 * TaxHero 2025 — SummarySidebar
 * ==============================
 * A sticky right-hand panel that displays real-time tax calculations
 * sourced directly from the Zustand store. Every render reflects the
 * latest `taxResult` — no local state, no stale snapshots.
 *
 * Sections:
 *   1. Outcome banner  — REFUND / DEBT / BALANCED with the ILS amount.
 *   2. Calculation steps — gross → deductions → taxable → theoretical → actual.
 *   3. Credits breakdown — points value + direct credits.
 *   4. Withheld tax row.
 *   5. Warnings list — surfaces engine-generated advisory messages.
 */

import { useTaxStore } from '../store/useTaxStore'

// ─── helpers ─────────────────────────────────────────────────────────────────

const ILS = new Intl.NumberFormat('he-IL', {
  style: 'currency',
  currency: 'ILS',
  maximumFractionDigits: 0,
})

const fmt = (n: number) => ILS.format(Math.abs(n))

// ─── sub-components ──────────────────────────────────────────────────────────

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
        padding: '8px 0',
        borderBottom: '1px solid rgba(255,255,255,0.06)',
        opacity: muted ? 0.6 : 1,
      }}
    >
      <span style={{ fontSize: 13, color: '#C4BAE8', lineHeight: 1.4 }}>
        {label}
      </span>
      <span
        style={{
          fontSize: emphasis ? 15 : 13,
          fontWeight: emphasis ? 700 : 500,
          color: '#F0EBFF',
          fontVariantNumeric: 'tabular-nums',
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
        letterSpacing: '0.12em',
        textTransform: 'uppercase',
        color: '#8B7EC8',
        marginTop: 20,
        marginBottom: 4,
      }}
    >
      {children}
    </p>
  )
}

// ─── main component ───────────────────────────────────────────────────────────

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
    outcome === 'REFUND' ? '#10B981' : outcome === 'DEBT' ? '#F87171' : '#94A3B8'

  const outcomeLabel =
    outcome === 'REFUND'
      ? 'Tax Refund'
      : outcome === 'DEBT'
        ? 'Tax Owed'
        : 'Balanced'

  const outcomeHebrew =
    outcome === 'REFUND' ? 'החזר מס' : outcome === 'DEBT' ? 'חוב מס' : 'מאוזן'

  const totalPoints = creditPointsBreakdown.total

  return (
    <aside
      style={{
        width: '100%',
        minHeight: '100vh',
        backgroundColor: '#110C25',
        padding: '28px 24px 40px',
        display: 'flex',
        flexDirection: 'column',
        fontFamily: "'DM Sans', system-ui, sans-serif",
        overflowY: 'auto',
      }}
    >
      {/* ── Logo mark ───────────────────────────────────────────────────── */}
      <div style={{ marginBottom: 28, display: 'flex', alignItems: 'center', gap: 8 }}>
        <div
          style={{
            width: 32,
            height: 32,
            borderRadius: 8,
            background: 'linear-gradient(135deg, #7C3AED 0%, #A855F7 100%)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            fontSize: 16,
          }}
        >
          ₪
        </div>
        <span
          style={{
            fontSize: 15,
            fontWeight: 700,
            color: '#F0EBFF',
            fontFamily: "'Bricolage Grotesque', system-ui, sans-serif",
            letterSpacing: '-0.3px',
          }}
        >
          TaxHero 2025
        </span>
      </div>

      {/* ── Outcome banner ──────────────────────────────────────────────── */}
      <div
        style={{
          borderRadius: 16,
          padding: '24px 20px',
          background:
            outcome === 'REFUND'
              ? 'linear-gradient(135deg, #064E3B 0%, #065F46 100%)'
              : outcome === 'DEBT'
                ? 'linear-gradient(135deg, #450A0A 0%, #7F1D1D 100%)'
                : 'linear-gradient(135deg, #1E1B4B 0%, #312E81 100%)',
          border: `1px solid ${outcomeColor}33`,
          marginBottom: 8,
          textAlign: 'center',
          position: 'relative',
          overflow: 'hidden',
        }}
      >
        {/* Glow accent */}
        <div
          style={{
            position: 'absolute',
            top: -40,
            left: '50%',
            transform: 'translateX(-50%)',
            width: 160,
            height: 80,
            borderRadius: '50%',
            background: `${outcomeColor}22`,
            filter: 'blur(24px)',
            pointerEvents: 'none',
          }}
        />

        <p
          style={{
            fontSize: 11,
            fontWeight: 700,
            letterSpacing: '0.12em',
            textTransform: 'uppercase',
            color: outcomeColor,
            marginBottom: 6,
            position: 'relative',
          }}
        >
          {outcomeLabel} · {outcomeHebrew}
        </p>
        <p
          style={{
            fontSize: 42,
            fontWeight: 800,
            color: outcomeColor,
            lineHeight: 1,
            marginBottom: 4,
            fontVariantNumeric: 'tabular-nums',
            fontFamily: "'Bricolage Grotesque', system-ui, sans-serif",
            position: 'relative',
          }}
        >
          {fmt(finalBalance)}
        </p>
        {outcome !== 'BALANCED' && (
          <p
            style={{
              fontSize: 12,
              color: `${outcomeColor}99`,
              position: 'relative',
            }}
          >
            {outcome === 'REFUND' ? 'to be returned to you' : 'still owed to the ITA'}
          </p>
        )}
      </div>

      {/* ── Calculation steps ───────────────────────────────────────────── */}
      <SectionTitle>Calculation Steps</SectionTitle>

      <Row label="Gross Income" value={fmt(totalGrossIncome)} />
      <Row
        label="− Deductions"
        value={totalDeductions > 0 ? `− ${fmt(totalDeductions)}` : '₪0'}
        muted={totalDeductions === 0}
      />
      <Row label="= Taxable Income" value={fmt(taxableIncome)} emphasis />
      <Row label="Theoretical Tax" value={fmt(theoreticalTax)} />
      <Row
        label="− Credits Applied"
        value={totalCreditsValue > 0 ? `− ${fmt(Math.min(totalCreditsValue, theoreticalTax))}` : '₪0'}
        muted={totalCreditsValue === 0}
      />
      <Row label="= Tax Owed (Actual)" value={fmt(actualTax)} emphasis />
      <Row
        label="− Withheld at Source"
        value={totalWithheldTax > 0 ? `− ${fmt(totalWithheldTax)}` : '₪0'}
        muted={totalWithheldTax === 0}
      />

      {/* ── Credit breakdown ────────────────────────────────────────────── */}
      <SectionTitle>Credits Breakdown</SectionTitle>

      <div
        style={{
          background: 'rgba(255,255,255,0.04)',
          borderRadius: 10,
          padding: '12px 14px',
          marginBottom: 4,
        }}
      >
        {/* Points grid */}
        {[
          ['Base', creditPointsBreakdown.base],
          ['Travel', creditPointsBreakdown.travel],
          ['Single Parent', creditPointsBreakdown.singleParent],
          ['Children', creditPointsBreakdown.children],
          ['Disabled Children', creditPointsBreakdown.disabledChildren],
          ['Discharged Soldier', creditPointsBreakdown.dischargedSoldier],
          ['Academic', creditPointsBreakdown.academicDegree],
          ["Oleh Chadash", creditPointsBreakdown.olehChadash],
        ]
          .filter(([, v]) => (v as number) > 0)
          .map(([label, v]) => (
            <div
              key={label as string}
              style={{
                display: 'flex',
                justifyContent: 'space-between',
                fontSize: 12,
                color: '#C4BAE8',
                padding: '3px 0',
              }}
            >
              <span>{label as string}</span>
              <span style={{ fontVariantNumeric: 'tabular-nums', color: '#A78BFA' }}>
                {(v as number).toFixed(2)} pts
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
            fontWeight: 600,
          }}
        >
          <span>Total: {totalPoints.toFixed(2)} pts × ₪2,904</span>
          <span style={{ color: '#A78BFA' }}>{fmt(totalCreditPointsValue)}</span>
        </div>
      </div>

      {totalDirectCredits > 0 && (
        <div
          style={{
            display: 'flex',
            justifyContent: 'space-between',
            fontSize: 13,
            color: '#C4BAE8',
            padding: '6px 0',
          }}
        >
          <span>Direct Credits</span>
          <span style={{ color: '#A78BFA', fontWeight: 600 }}>{fmt(totalDirectCredits)}</span>
        </div>
      )}

      {/* ── Warnings ────────────────────────────────────────────────────── */}
      {warnings.length > 0 && (
        <>
          <SectionTitle>Notices</SectionTitle>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
            {warnings.map((w, i) => (
              <div
                key={i}
                style={{
                  background: 'rgba(251,191,36,0.08)',
                  border: '1px solid rgba(251,191,36,0.25)',
                  borderRadius: 8,
                  padding: '8px 10px',
                  fontSize: 11,
                  color: '#FCD34D',
                  lineHeight: 1.5,
                }}
              >
                ⚠ {w}
              </div>
            ))}
          </div>
        </>
      )}

      {/* ── Footer note ─────────────────────────────────────────────────── */}
      <p
        style={{
          marginTop: 'auto',
          paddingTop: 24,
          fontSize: 11,
          color: '#4B4468',
          lineHeight: 1.5,
        }}
      >
        Calculations are for estimation purposes only and are based on the 2025 Israeli
        Tax Authority guidelines. Consult a licensed tax advisor for official assessment.
      </p>
    </aside>
  )
}
