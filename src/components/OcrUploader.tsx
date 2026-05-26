/**
 * TaxHero 2025 — מודול OCR מתקדם לטעינת טופס 106
 * ================================================
 * File: src/components/OcrUploader.tsx
 *
 * REWRITE v2 — Dynamic Multi-Field Auto-Extraction
 *
 * Architecture contract:
 *   - ZERO BACKEND: File never leaves the browser. Tesseract.js runs entirely
 *     in a local Web Worker — no network calls, no server uploads.
 *   - MULTI-FIELD EXTRACTION: `extractTaxData()` is a PURE FUNCTION that scans
 *     the raw Tesseract output for every Form 106 / Form 135 code defined in
 *     tax_rules_full_2025.md and maps them to their exact TaxDataInput keys.
 *   - HUMAN-IN-THE-LOOP: Each found field is surfaced as an editable <input>
 *     so the user can correct OCR errors before committing anything to state.
 *   - BATCH UPDATE: "שמור ועדכן" iterates the verified map and calls
 *     updateField(key, value) once per field — consistent with Zustand contract.
 *   - IMAGE ONLY: PDF uploads are explicitly blocked with a clear RTL warning.
 *
 * Code → StoreKey mapping is derived EXCLUSIVELY from tax_rules_full_2025.md
 * and the TaxDataInput interface. No tax logic is invented here.
 *
 * Privacy guarantee:
 *   "הקובץ מעובד לחלוטין במכשיר שלך. לא מועבר שום מידע לשרת."
 *
 * ─── DEPENDENCIES ──────────────────────────────────────────────────────────
 *   npm install tesseract.js
 * ───────────────────────────────────────────────────────────────────────────
 */

import React, {
  useState,
  useRef,
  useCallback,
  useEffect,
  type DragEvent,
  type ChangeEvent,
} from 'react'
import Tesseract from 'tesseract.js'
import { useUpdateField } from '../store/useTaxStore'
import type { TaxDataInput } from '../engine/taxCalculator'

// ─────────────────────────────────────────────────────────────────────────────
// SECTION 1 — DESIGN TOKENS  (consistent with Wizard.tsx)
// ─────────────────────────────────────────────────────────────────────────────

const C = {
  bg:            '#F4F1FC',
  card:          '#FFFFFF',
  border:        '#E8E3F5',
  borderFocus:   '#7C3AED',
  borderDanger:  '#F87171',
  textMain:      '#1C1027',
  textMuted:     '#7268A0',
  textLight:     '#A9A0CC',
  accent:        '#7C3AED',
  accentLight:   '#EDE9FE',
  accentHover:   '#6D28D9',
  accentDeep:    '#4C1D95',
  success:       '#059669',
  successBg:     '#D1FAE5',
  successBorder: '#6EE7B7',
  danger:        '#DC2626',
  dangerBg:      '#FEF2F2',
  dangerBorder:  '#FECACA',
  warn:          '#D97706',
  warnBg:        '#FFFBEB',
  warnBorder:    '#FDE68A',
  overlay:       'rgba(28, 16, 39, 0.65)',
  progressTrack: '#E8E3F5',
  progressFill:  'linear-gradient(90deg, #7C3AED 0%, #A855F7 100%)',
  catIncome:     '#EFF6FF',  // blue-tinted category header
  catWithheld:   '#F0FDF4',  // green-tinted
  catDeduction:  '#FFF7ED',  // amber-tinted
  catCredit:     '#FDF4FF',  // purple-tinted
  catCapital:    '#F0F9FF',  // sky-tinted
} as const

const T = {
  heading: "'Heebo', system-ui, sans-serif",
  body:    "'Assistant', system-ui, sans-serif",
  mono:    "'Courier New', Courier, monospace",
} as const

const SHADOW = {
  card:   '0 2px 16px rgba(124,58,237,0.08), 0 1px 4px rgba(28,16,39,0.04)',
  modal:  '0 24px 64px rgba(28,16,39,0.22), 0 4px 16px rgba(124,58,237,0.12)',
  button: '0 2px 8px rgba(124,58,237,0.30)',
  input:  'inset 0 1px 3px rgba(28,16,39,0.06)',
} as const

// ─────────────────────────────────────────────────────────────────────────────
// SECTION 2 — TYPES
// ─────────────────────────────────────────────────────────────────────────────

type OcrPhase = 'idle' | 'loading' | 'verify' | 'saved'

type FieldCategory = 'income' | 'capital' | 'withheld' | 'deduction' | 'credit'

interface OcrProgress {
  status:   string
  progress: number
}

/**
 * One entry in the CODE_DEFINITIONS registry.
 * Each entry maps one or more Form 106 numeric codes to a single TaxDataInput key.
 */
interface CodeDefinition {
  /** All numeric Form 106 codes that contribute to this store field. */
  codes: number[]
  /** The exact TaxDataInput field key. Must match the interface exactly. */
  storeKey: keyof TaxDataInput
  /** Short Hebrew label for display in the verification UI. */
  label: string
  /** Brief code-list hint shown under the label (e.g. "קוד 158"). */
  codeHint: string
  /** UI category for grouping in the modal. */
  category: FieldCategory
  /**
   * When true: if multiple codes from this definition appear on different lines,
   * their values are SUMMED into the store field (e.g. 250+270+194+196 all go
   * to bituachLeumiIncome). When false: first-found value wins.
   */
  accumulate: boolean
}

interface ExtractedResult {
  value:      number
  codesFound: number[]
  label:      string
  codeHint:   string
  category:   FieldCategory
}

/** Mutable verified entry — user may edit the value before saving. */
interface VerifiedEntry {
  storeKey:   keyof TaxDataInput
  label:      string
  codeHint:   string
  category:   FieldCategory
  codesFound: number[]
  rawValue:   number       // original OCR value
  editedValue: string      // controlled string for <input>
}

// ─────────────────────────────────────────────────────────────────────────────
// SECTION 3 — CODE DEFINITIONS REGISTRY
// ─────────────────────────────────────────────────────────────────────────────
//
// AUTHORITATIVE SOURCE: tax_rules_full_2025.md §4 + TaxDataInput interface.
// DO NOT ADD codes not present in that document.
//
// Codes are stored as integers (leading zeros dropped). The parser matches
// both padded (e.g. "042") and unpadded (e.g. "42") forms in OCR text.
//
// ─────────────────────────────────────────────────────────────────────────────

const CODE_DEFINITIONS: readonly CodeDefinition[] = [
  // ── Income (הכנסות מיגיעה אישית) ──────────────────────────────────────────
  {
    codes:      [158],
    storeKey:   'grossIncome158',
    label:      'הכנסה ברוטו — שכיר רשום',
    codeHint:   'קוד 158',
    category:   'income',
    accumulate: false,
  },
  {
    codes:      [172],
    storeKey:   'grossIncome172',
    label:      'הכנסה ברוטו — שכיר לא-רשום',
    codeHint:   'קוד 172',
    category:   'income',
    accumulate: false,
  },
  {
    codes:      [150, 170],
    storeKey:   'otherPersonalIncome150_170',
    label:      'הכנסת עבודה אחרת (סופר, מרצה, מנהל)',
    codeHint:   'קודים 150 / 170',
    category:   'income',
    accumulate: true,
  },
  {
    codes:      [258, 272],
    storeKey:   'severancePension258_272',
    label:      'מענקי פרישה / פנסיה חייבים',
    codeHint:   'קודים 258 / 272',
    category:   'income',
    accumulate: true,
  },
  {
    codes:      [250, 270, 194, 196],
    storeKey:   'bituachLeumiIncome250_270_194_196',
    label:      'גמלאות ביטוח לאומי (לידה, מילואים, אבטלה)',
    codeHint:   'קודים 250 / 270 / 194 / 196',
    category:   'income',
    accumulate: true,
  },
  // ── Capital / Passive Income (הכנסות רכוש והון) ────────────────────────────
  {
    codes:      [222],
    storeKey:   'residentialRentIncome222',
    label:      'הכנסה משכר דירה למגורים',
    codeHint:   'קוד 222 (10% מס שטוח)',
    category:   'capital',
    accumulate: false,
  },
  {
    codes:      [227],
    storeKey:   'gamblingLotteryIncome227',
    label:      'הכנסה מהגרלות / פרסים',
    codeHint:   'קוד 227',
    category:   'capital',
    accumulate: false,
  },
  {
    codes:      [60],    // OCR may read "060" as "60"
    storeKey:   'interestDividends060',
    label:      'ריבית / דיבידנד (15%)',
    codeHint:   'קוד 060',
    category:   'capital',
    accumulate: false,
  },
  {
    codes:      [67, 126],
    storeKey:   'interestDividends067_126',
    label:      'ריבית / דיבידנד (20%)',
    codeHint:   'קודים 067 / 126',
    category:   'capital',
    accumulate: true,
  },
  {
    codes:      [157, 141, 142],
    storeKey:   'interestDividends157_141_142',
    label:      'ריבית / דיבידנד (25%)',
    codeHint:   'קודים 157 / 141 / 142',
    category:   'capital',
    accumulate: true,
  },
  {
    codes:      [50],    // OCR may read "050" as "50"
    storeKey:   'interest050',
    label:      'ריבית (35%)',
    codeHint:   'קוד 050',
    category:   'capital',
    accumulate: false,
  },
  {
    codes:      [335],
    storeKey:   'renewableEnergyRent335',
    label:      'הכנסה מהשכרה לאנרגיה מתחדשת',
    codeHint:   'קוד 335',
    category:   'capital',
    accumulate: false,
  },
  // ── Withheld Tax at Source (ניכוי במקור) ──────────────────────────────────
  {
    codes:      [42],    // "042"
    storeKey:   'withheldTaxSalary042',
    label:      'מס שנוכה ממשכורת',
    codeHint:   'קוד 042',
    category:   'withheld',
    accumulate: false,
  },
  {
    codes:      [40],    // "040"
    storeKey:   'withheldTaxOther040',
    label:      'מס שנוכה מהכנסות אחרות',
    codeHint:   'קוד 040',
    category:   'withheld',
    accumulate: false,
  },
  {
    codes:      [43],    // "043"
    storeKey:   'withheldTaxInterest043',
    label:      'מס שנוכה מריבית / חסכונות',
    codeHint:   'קוד 043',
    category:   'withheld',
    accumulate: false,
  },
  // ── Deductions (ניכויים — מפחיתים הכנסה חייבת) ─────────────────────────────
  {
    codes:      [112, 113],
    storeKey:   'lossOfEarningPremium112_113',
    label:      'ביטוח אובדן כושר עבודה',
    codeHint:   'קודים 112 / 113',
    category:   'deduction',
    accumulate: true,
  },
  {
    codes:      [135, 180],
    storeKey:   'providentFundPension135_180',
    label:      'קרן פנסיה / קופת גמל (עצמאי)',
    codeHint:   'קודים 135 / 180',
    category:   'deduction',
    accumulate: true,
  },
  {
    codes:      [30, 89],   // "030" / "089"
    storeKey:   'bituachLeumiIndependent030_089',
    label:      'דמי ביטוח לאומי (עצמאי)',
    codeHint:   'קודים 030 / 089',
    category:   'deduction',
    accumulate: true,
  },
  // ── Direct Tax Credits (זיכויים — מפחיתים מס לתשלום) ──────────────────────
  {
    codes:      [37, 237],  // "037"
    storeKey:   'donations037_237',
    label:      'תרומות (סעיף 46) — 35% זיכוי',
    codeHint:   'קודים 037 / 237',
    category:   'credit',
    accumulate: true,
  },
  {
    codes:      [68, 69],   // "068" / "069"
    storeKey:   'shiftWorkIncome068_069',
    label:      'הכנסה ממשמרות בתעשייה — 15% זיכוי',
    codeHint:   'קודים 068 / 069',
    category:   'credit',
    accumulate: true,
  },
  {
    codes:      [132, 232],
    storeKey:   'institutionMaintenanceExpenses132_232',
    label:      'החזקת קרוב במוסד — 35% זיכוי',
    codeHint:   'קודים 132 / 232',
    category:   'credit',
    accumulate: true,
  },
  {
    codes:      [36, 81],   // "036" / "081"
    storeKey:   'lifeInsurancePremium036_081',
    label:      'ביטוח חיים — 25% זיכוי',
    codeHint:   'קודים 036 / 081',
    category:   'credit',
    accumulate: true,
  },
  {
    codes:      [140, 240],
    storeKey:   'pensionSurvivorsInsurance140_240',
    label:      'ביטוח פנסיה / שאירים — 35% זיכוי',
    codeHint:   'קודים 140 / 240',
    category:   'credit',
    accumulate: true,
  },
  {
    codes:      [139, 183],
    storeKey:   'eilatIncome139_183',
    label:      'הכנסה מאילת — 10% זיכוי',
    codeHint:   'קודים 139 / 183',
    category:   'credit',
    accumulate: true,
  },
] as const

// ─────────────────────────────────────────────────────────────────────────────
// SECTION 4 — PURE EXTRACTION ENGINE
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Builds a fast lookup map: integer code → index in CODE_DEFINITIONS.
 * Computed once at module initialisation (not per render).
 */
const CODE_LOOKUP = (() => {
  const map = new Map<number, number>()
  CODE_DEFINITIONS.forEach((def, idx) => {
    def.codes.forEach(code => map.set(code, idx))
  })
  return map
})()

/**
 * Category display metadata (Hebrew labels + colours).
 */
const CATEGORY_META: Readonly<
  Record<FieldCategory, { label: string; bg: string; accent: string }>
> = {
  income:    { label: 'הכנסות מיגיעה אישית',   bg: C.catIncome,    accent: '#2563EB' },
  capital:   { label: 'הכנסות רכוש והון',        bg: C.catCapital,   accent: '#0284C7' },
  withheld:  { label: 'ניכוי במקור',             bg: C.catWithheld,  accent: '#16A34A' },
  deduction: { label: 'ניכויים',                 bg: C.catDeduction, accent: '#D97706' },
  credit:    { label: 'זיכויים',                 bg: C.catCredit,    accent: '#9333EA' },
}

/** Ordered category display sequence. */
const CATEGORY_ORDER: readonly FieldCategory[] = [
  'income', 'capital', 'withheld', 'deduction', 'credit',
]

/**
 * `extractTaxData` — pure function, zero side-effects.
 *
 * Algorithm per line:
 *   1. Tokenise into numeric tokens (strips commas, handles decimal dots).
 *   2. For each integer-valued token, look it up in CODE_LOOKUP.
 *   3. When a code match is found, the monetary value on that line is the
 *      LARGEST non-code numeric token.
 *   4. Accumulate across lines per the `accumulate` flag on the definition.
 *
 * RTL-safety: we don't rely on token position (left/right), only on value
 * comparisons, so Hebrew/English layout direction has no effect.
 *
 * @param rawText  Raw string output from Tesseract.recognize().
 * @returns        Map from TaxDataInput key → extracted result.
 */
export function extractTaxData(
  rawText: string,
): Map<keyof TaxDataInput, ExtractedResult> {

  // Accumulation buffer: defIndex → { value, codesFound }
  const buffer = new Map<number, { value: number; codesFound: number[] }>()

  const lines = rawText.split(/\r?\n/)

  for (const rawLine of lines) {
    const line = rawLine.trim()
    if (!line) continue

    // Tokenise: extract all runs of digits (with optional embedded commas and
    // a trailing decimal portion). Example tokens from "158    45,984.00":
    //   ["158", "45,984.00"]
    const numericTokens = [...line.matchAll(/\d[\d,]*(?:\.\d+)?/g)].map(m => ({
      raw:      m[0],
      value:    parseFloat(m[0].replace(/,/g, '')),
    })).filter(t => !isNaN(t.value) && isFinite(t.value))

    if (numericTokens.length < 2) continue  // need at least code + amount

    // Identify code candidates: integer tokens whose value is in CODE_LOOKUP.
    // An integer token has value === Math.floor(value) (no decimal part).
    for (const codeTok of numericTokens) {
      const codeInt = Math.round(codeTok.value)
      if (codeTok.value !== codeInt) continue  // skip decimals as code candidates

      const defIdx = CODE_LOOKUP.get(codeInt)
      if (defIdx === undefined) continue

      // Monetary candidates: every other token on this line, positive, not equal
      // to the code value itself. Take the largest.
      const candidates = numericTokens
        .filter(t => t !== codeTok && t.value > 0)
        .map(t => t.value)

      if (candidates.length === 0) continue

      const monValue = Math.max(...candidates)

      // Sanity-check: monetary value shouldn't look like another known code.
      // If the largest "candidate" is itself a valid code integer, it's more
      // likely a label than an amount — skip this line.
      if (CODE_LOOKUP.has(monValue) && monValue === Math.round(monValue)) {
        // The only "other" token is also a code — ambiguous line, skip.
        if (candidates.length === 1) continue
        // If there are more candidates, take the largest non-code one.
        const filtered = candidates.filter(v => !CODE_LOOKUP.has(Math.round(v)) || v > 999)
        if (filtered.length === 0) continue
        // use filtered max
        const filteredMax = Math.max(...filtered)
        const def = CODE_DEFINITIONS[defIdx]
        const existing = buffer.get(defIdx)
        if (existing) {
          if (!existing.codesFound.includes(codeInt)) {
            if (def.accumulate) existing.value += filteredMax
            existing.codesFound.push(codeInt)
          }
        } else {
          buffer.set(defIdx, { value: filteredMax, codesFound: [codeInt] })
        }
        continue
      }

      const def = CODE_DEFINITIONS[defIdx]
      const existing = buffer.get(defIdx)

      if (existing) {
        if (!existing.codesFound.includes(codeInt)) {
          if (def.accumulate) existing.value += monValue
          // if not accumulate, keep first-found value
          existing.codesFound.push(codeInt)
        }
      } else {
        buffer.set(defIdx, { value: monValue, codesFound: [codeInt] })
      }
    }
  }

  // Materialise into the output map
  const output = new Map<keyof TaxDataInput, ExtractedResult>()
  for (const [defIdx, entry] of buffer) {
    const def = CODE_DEFINITIONS[defIdx]
    output.set(def.storeKey, {
      value:      Math.round(entry.value),  // round to whole shekels
      codesFound: entry.codesFound,
      label:      def.label,
      codeHint:   def.codeHint,
      category:   def.category,
    })
  }

  return output
}

// ─────────────────────────────────────────────────────────────────────────────
// SECTION 5 — HELPER: TESSERACT STATUS → HEBREW
// ─────────────────────────────────────────────────────────────────────────────

function hebrewStatus(status: string): string {
  if (status.includes('load'))            return 'טוען מנוע זיהוי תווים…'
  if (status.includes('initializ'))       return 'מאתחל מודל שפה…'
  if (status.includes('recogniz'))        return 'מזהה טקסט בתמונה…'
  if (status.includes('read'))            return 'קורא נתוני אימון…'
  if (status.includes('detect'))         return 'מזהה גושי טקסט…'
  return 'מעבד…'
}

// ─────────────────────────────────────────────────────────────────────────────
// SECTION 6 — SVG ICONS
// ─────────────────────────────────────────────────────────────────────────────

function ShieldIcon({ size = 16 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none"
      stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
      <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" />
    </svg>
  )
}

function ScanIcon({ size = 16 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none"
      stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
      <path d="M3 7V5a2 2 0 0 1 2-2h2M17 3h2a2 2 0 0 1 2 2v2M21 17v2a2 2 0 0 1-2 2h-2M7 21H5a2 2 0 0 1-2-2v-2" />
      <line x1="3" y1="12" x2="21" y2="12" />
    </svg>
  )
}

function UploadCloudIcon({ size = 40 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none"
      stroke="currentColor" strokeWidth={1.5} strokeLinecap="round" strokeLinejoin="round">
      <polyline points="16 16 12 12 8 16" />
      <line x1="12" y1="12" x2="12" y2="21" />
      <path d="M20.39 18.39A5 5 0 0 0 18 9h-1.26A8 8 0 1 0 3 16.3" />
    </svg>
  )
}

function CheckCircleIcon({ size = 18 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none"
      stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
      <path d="M22 11.08V12a10 10 0 1 1-5.93-9.14" />
      <polyline points="22 4 12 14.01 9 11.01" />
    </svg>
  )
}

function AlertTriangleIcon({ size = 16 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none"
      stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
      <path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z" />
      <line x1="12" y1="9" x2="12" y2="13" />
      <line x1="12" y1="17" x2="12.01" y2="17" />
    </svg>
  )
}

function XIcon({ size = 18 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none"
      stroke="currentColor" strokeWidth={2.5} strokeLinecap="round" strokeLinejoin="round">
      <line x1="18" y1="6" x2="6" y2="18" />
      <line x1="6" y1="6" x2="18" y2="18" />
    </svg>
  )
}

function InfoIcon({ size = 14 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none"
      stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
      <circle cx="12" cy="12" r="10" />
      <line x1="12" y1="16" x2="12" y2="12" />
      <line x1="12" y1="8" x2="12.01" y2="8" />
    </svg>
  )
}

// ─────────────────────────────────────────────────────────────────────────────
// SECTION 7 — SHARED SUB-COMPONENTS
// ─────────────────────────────────────────────────────────────────────────────

function Spinner({ size = 24 }: { size?: number }) {
  return (
    <>
      <style>{`
        @keyframes th-spin { to { transform: rotate(360deg); } }
        @keyframes th-fade-in { from { opacity: 0; } to { opacity: 1; } }
        @keyframes th-slide-up {
          from { opacity: 0; transform: translateY(16px); }
          to   { opacity: 1; transform: translateY(0); }
        }
        @keyframes th-field-in {
          from { opacity: 0; transform: translateX(8px); }
          to   { opacity: 1; transform: translateX(0); }
        }
      `}</style>
      <div style={{
        width: size, height: size, borderRadius: '50%',
        border: `3px solid ${C.accentLight}`,
        borderTopColor: C.accent,
        animation: 'th-spin 0.75s linear infinite',
        flexShrink: 0,
      }} />
    </>
  )
}

function ProgressBar({ value, label }: { value: number; label: string }) {
  const pct = Math.round(value * 100)
  return (
    <div style={{ width: '100%' }}>
      <div style={{
        display: 'flex', justifyContent: 'space-between',
        marginBottom: 6, fontFamily: T.body,
      }}>
        <span style={{ fontSize: 13, color: C.textMuted, direction: 'rtl' }}>{label}</span>
        <span style={{ fontSize: 13, fontWeight: 700, color: C.accent, fontVariantNumeric: 'tabular-nums' }}>
          {pct}%
        </span>
      </div>
      <div style={{
        height: 7, borderRadius: 8,
        backgroundColor: C.progressTrack, overflow: 'hidden',
      }}>
        <div style={{
          height: '100%', width: `${pct}%`,
          background: C.progressFill, borderRadius: 8,
          transition: 'width 0.25s ease',
        }} />
      </div>
    </div>
  )
}

// ─────────────────────────────────────────────────────────────────────────────
// SECTION 8 — SUCCESS BANNER
// ─────────────────────────────────────────────────────────────────────────────

interface SuccessBannerProps {
  savedCount: number
  onReset:    () => void
}

function SuccessBanner({ savedCount, onReset }: SuccessBannerProps) {
  return (
    <div style={{
      display: 'flex', alignItems: 'center', justifyContent: 'space-between',
      gap: 12, padding: '14px 16px',
      background: C.successBg, border: `1px solid ${C.successBorder}`,
      borderRadius: 12, direction: 'rtl',
    }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
        <span style={{ color: C.success }}><CheckCircleIcon size={20} /></span>
        <div>
          <p style={{ margin: 0, fontSize: 14, fontWeight: 700, color: C.success, fontFamily: T.heading }}>
            נשמר בהצלחה
          </p>
          <p style={{ margin: 0, fontSize: 12, color: '#065F46', fontFamily: T.body, marginTop: 2 }}>
            {savedCount} {savedCount === 1 ? 'שדה עודכן' : 'שדות עודכנו'} בטופס
          </p>
        </div>
      </div>
      <button
        onClick={onReset}
        style={{
          background: 'none', border: `1px solid ${C.successBorder}`,
          borderRadius: 8, padding: '6px 12px',
          fontSize: 12, fontWeight: 600, color: C.success,
          cursor: 'pointer', fontFamily: T.body, whiteSpace: 'nowrap',
          transition: 'background 0.15s',
        }}
        onMouseEnter={e => { e.currentTarget.style.background = 'rgba(6,95,70,0.08)' }}
        onMouseLeave={e => { e.currentTarget.style.background = 'none' }}
      >
        סרוק שוב
      </button>
    </div>
  )
}

// ─────────────────────────────────────────────────────────────────────────────
// SECTION 9 — VERIFY MODAL
// ─────────────────────────────────────────────────────────────────────────────

interface VerifyModalProps {
  extractedMap: Map<keyof TaxDataInput, ExtractedResult>
  rawText:      string
  onSave:       (entries: VerifiedEntry[]) => void
  onClose:      () => void
}

function VerifyModal({ extractedMap, rawText, onSave, onClose }: VerifyModalProps) {

  // Initialise mutable verified state from the extracted map
  const [entries, setEntries] = useState<VerifiedEntry[]>(() => {
    const list: VerifiedEntry[] = []
    for (const [storeKey, result] of extractedMap) {
      list.push({
        storeKey,
        label:       result.label,
        codeHint:    result.codeHint,
        category:    result.category,
        codesFound:  result.codesFound,
        rawValue:    result.value,
        editedValue: String(result.value),
      })
    }
    return list
  })

  const [showRaw, setShowRaw] = useState(false)

  // Trap Escape
  useEffect(() => {
    const handler = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose() }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [onClose])

  const updateEntry = (storeKey: keyof TaxDataInput, value: string) => {
    setEntries(prev => prev.map(e => e.storeKey === storeKey ? { ...e, editedValue: value } : e))
  }

  const validEntries = entries.filter(e => {
    const n = parseFloat(e.editedValue)
    return !isNaN(n) && n >= 0 && n <= 10_000_000
  })

  // Group by category for display
  const grouped = CATEGORY_ORDER.map(cat => ({
    cat,
    meta:  CATEGORY_META[cat],
    items: entries.filter(e => e.category === cat),
  })).filter(g => g.items.length > 0)

  const noFieldsFound = entries.length === 0

  return (
    <>
      {/* ── Backdrop ── */}
      <div
        onClick={onClose}
        style={{
          position: 'fixed', inset: 0, zIndex: 1000,
          background: C.overlay, backdropFilter: 'blur(4px)',
          WebkitBackdropFilter: 'blur(4px)', animation: 'th-fade-in 0.2s ease',
        }}
      />

      {/* ── Modal Panel ── */}
      <div
        role="dialog" aria-modal="true" aria-label="אימות שדות OCR"
        dir="rtl"
        style={{
          position: 'fixed', inset: 0, zIndex: 1001,
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          padding: 16, pointerEvents: 'none',
        }}
      >
        <div style={{
          pointerEvents: 'auto',
          background: C.card, borderRadius: 20, boxShadow: SHADOW.modal,
          width: '100%', maxWidth: 680, maxHeight: '92vh',
          display: 'flex', flexDirection: 'column', overflow: 'hidden',
          animation: 'th-slide-up 0.22s cubic-bezier(0.22,0.61,0.36,1)',
        }}>

          {/* ── Header ── */}
          <div style={{
            padding: '20px 24px 16px',
            borderBottom: `1px solid ${C.border}`,
            display: 'flex', alignItems: 'flex-start', gap: 12,
            flexShrink: 0,
          }}>
            {/* Icon badge */}
            <div style={{
              width: 44, height: 44, borderRadius: 12, flexShrink: 0,
              background: C.accentLight, color: C.accent,
              display: 'flex', alignItems: 'center', justifyContent: 'center',
            }}>
              <ScanIcon size={22} />
            </div>
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                <h2 style={{
                  margin: 0, fontSize: 18, fontWeight: 700,
                  color: C.textMain, fontFamily: T.heading,
                }}>
                  אימות נתוני OCR
                </h2>
                {!noFieldsFound && (
                  <span style={{
                    display: 'inline-flex', alignItems: 'center',
                    padding: '2px 10px', borderRadius: 20,
                    background: C.accentLight, color: C.accent,
                    fontSize: 12, fontWeight: 700, fontFamily: T.body,
                  }}>
                    {entries.length} שדות זוהו
                  </span>
                )}
              </div>
              <p style={{
                margin: '4px 0 0', fontSize: 13, color: C.textMuted,
                fontFamily: T.body, lineHeight: 1.5,
              }}>
                {noFieldsFound
                  ? 'מנוע OCR לא זיהה קודי טופס 106 מוכרים בתמונה זו.'
                  : 'בדקו את הערכים שזוהו ותקנו שגיאות OCR לפני השמירה.'}
              </p>
            </div>
            {/* Close button */}
            <button
              onClick={onClose}
              aria-label="סגור"
              style={{
                background: 'none', border: 'none', cursor: 'pointer',
                color: C.textMuted, padding: 4, borderRadius: 6,
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                transition: 'color 0.15s, background 0.15s', flexShrink: 0,
              }}
              onMouseEnter={e => {
                e.currentTarget.style.color = C.textMain
                e.currentTarget.style.background = C.accentLight
              }}
              onMouseLeave={e => {
                e.currentTarget.style.color = C.textMuted
                e.currentTarget.style.background = 'none'
              }}
            >
              <XIcon size={20} />
            </button>
          </div>

          {/* ── Body (scrollable) ── */}
          <div style={{
            flex: 1, overflowY: 'auto', padding: '0 24px',
            scrollbarWidth: 'thin',
            scrollbarColor: `${C.accentLight} transparent`,
          }}>

            {/* ── No fields found state ── */}
            {noFieldsFound && (
              <div style={{ padding: '24px 0' }}>
                <div style={{
                  background: C.warnBg, border: `1px solid ${C.warnBorder}`,
                  borderRadius: 12, padding: 16, marginBottom: 16,
                  display: 'flex', gap: 10, alignItems: 'flex-start',
                }}>
                  <span style={{ color: C.warn, marginTop: 2 }}><AlertTriangleIcon size={18} /></span>
                  <div>
                    <p style={{ margin: 0, fontSize: 14, fontWeight: 700, color: C.warn, fontFamily: T.heading }}>
                      לא זוהו שדות מוכרים
                    </p>
                    <p style={{ margin: '4px 0 0', fontSize: 13, color: '#92400E', fontFamily: T.body, lineHeight: 1.5 }}>
                      ייתכן שהתמונה אינה ברורה מספיק, הטקסט מטופס שאינו 106,
                      או שמנוע OCR לא הצליח לקרוא את הקודים. נסו להעלות תמונה חדה יותר.
                    </p>
                  </div>
                </div>

                {/* Show raw OCR for debugging */}
                <button
                  onClick={() => setShowRaw(r => !r)}
                  style={{
                    background: 'none', border: `1px solid ${C.border}`,
                    borderRadius: 8, padding: '7px 12px',
                    fontSize: 12, color: C.textMuted, cursor: 'pointer',
                    fontFamily: T.body, marginBottom: 12,
                    transition: 'border-color 0.15s',
                  }}
                  onMouseEnter={e => { e.currentTarget.style.borderColor = C.accent }}
                  onMouseLeave={e => { e.currentTarget.style.borderColor = C.border }}
                >
                  {showRaw ? '▲ הסתר טקסט גולמי' : '▼ הצג טקסט גולמי של OCR'}
                </button>
                {showRaw && (
                  <pre style={{
                    fontSize: 11, fontFamily: T.mono, color: C.textMuted,
                    background: '#FAFAFA', border: `1px solid ${C.border}`,
                    borderRadius: 8, padding: 12, maxHeight: 200, overflow: 'auto',
                    direction: 'ltr', whiteSpace: 'pre-wrap', wordBreak: 'break-all',
                    lineHeight: 1.6,
                  }}>
                    {rawText || '(ריק)'}
                  </pre>
                )}
              </div>
            )}

            {/* ── Privacy notice ── */}
            {!noFieldsFound && (
              <div style={{
                margin: '16px 0 4px', display: 'flex', alignItems: 'center', gap: 6,
                padding: '8px 12px', borderRadius: 8,
                background: C.accentLight, color: C.accentDeep,
              }}>
                <ShieldIcon size={13} />
                <span style={{ fontSize: 11, fontFamily: T.body, lineHeight: 1.4 }}>
                  כל הנתונים מעובדים מקומית בדפדפן בלבד — לא מועלה מידע לשרת.
                </span>
              </div>
            )}

            {/* ── Category sections ── */}
            {grouped.map(({ cat, meta, items }) => (
              <div key={cat} style={{ marginTop: 20, marginBottom: 4 }}>

                {/* Category header */}
                <div style={{
                  display: 'flex', alignItems: 'center', gap: 8,
                  padding: '7px 12px', borderRadius: 8, marginBottom: 10,
                  background: meta.bg,
                }}>
                  <span style={{
                    width: 8, height: 8, borderRadius: '50%', flexShrink: 0,
                    background: meta.accent, display: 'inline-block',
                  }} />
                  <span style={{
                    fontSize: 12, fontWeight: 700, color: meta.accent, fontFamily: T.heading,
                    letterSpacing: '0.02em',
                  }}>
                    {meta.label}
                  </span>
                  <span style={{
                    fontSize: 11, color: meta.accent, opacity: 0.7, fontFamily: T.body,
                  }}>
                    ({items.length} {items.length === 1 ? 'שדה' : 'שדות'})
                  </span>
                </div>

                {/* Field rows */}
                {items.map((entry, i) => (
                  <FieldRow
                    key={entry.storeKey as string}
                    entry={entry}
                    index={i}
                    accentColor={meta.accent}
                    onChange={(val) => updateEntry(entry.storeKey, val)}
                  />
                ))}
              </div>
            ))}

            {/* ── Show raw toggle (when fields found) ── */}
            {!noFieldsFound && (
              <div style={{ marginTop: 16, marginBottom: 8 }}>
                <button
                  onClick={() => setShowRaw(r => !r)}
                  style={{
                    background: 'none', border: 'none',
                    fontSize: 12, color: C.textLight, cursor: 'pointer',
                    fontFamily: T.body, padding: '4px 0', display: 'flex',
                    alignItems: 'center', gap: 4,
                  }}
                >
                  <InfoIcon size={12} />
                  {showRaw ? 'הסתר טקסט OCR גולמי' : 'הצג טקסט OCR גולמי'}
                </button>
                {showRaw && (
                  <pre style={{
                    fontSize: 10, fontFamily: T.mono, color: C.textMuted,
                    background: '#FAFAFA', border: `1px solid ${C.border}`,
                    borderRadius: 8, padding: 10, maxHeight: 140, overflow: 'auto',
                    direction: 'ltr', whiteSpace: 'pre-wrap', wordBreak: 'break-all',
                    lineHeight: 1.5, marginTop: 6,
                  }}>
                    {rawText}
                  </pre>
                )}
              </div>
            )}

            {/* Bottom padding */}
            <div style={{ height: 20 }} />
          </div>

          {/* ── Footer ── */}
          <div style={{
            padding: '14px 24px 18px',
            borderTop: `1px solid ${C.border}`,
            display: 'flex', alignItems: 'center', justifyContent: 'space-between',
            gap: 12, flexShrink: 0,
            background: C.card,
          }}>

            {/* Stats */}
            <div style={{ fontSize: 12, color: C.textMuted, fontFamily: T.body }}>
              {noFieldsFound ? (
                <span style={{ color: C.warn }}>לא נמצאו שדות</span>
              ) : (
                <>
                  <span style={{ fontWeight: 700, color: validEntries.length > 0 ? C.success : C.warn }}>
                    {validEntries.length}
                  </span>
                  {' / '}{entries.length} שדות תקינים לשמירה
                </>
              )}
            </div>

            <div style={{ display: 'flex', gap: 10 }}>
              {/* Cancel */}
              <button
                onClick={onClose}
                style={{
                  background: 'none', border: `1.5px solid ${C.border}`,
                  borderRadius: 10, padding: '9px 18px',
                  fontSize: 14, fontWeight: 600, color: C.textMuted,
                  cursor: 'pointer', fontFamily: T.body,
                  transition: 'border-color 0.15s, color 0.15s',
                }}
                onMouseEnter={e => {
                  e.currentTarget.style.borderColor = C.accent
                  e.currentTarget.style.color = C.accent
                }}
                onMouseLeave={e => {
                  e.currentTarget.style.borderColor = C.border
                  e.currentTarget.style.color = C.textMuted
                }}
              >
                ביטול
              </button>

              {/* Save */}
              <button
                onClick={() => onSave(validEntries)}
                disabled={validEntries.length === 0}
                style={{
                  background: validEntries.length === 0 ? C.textLight : C.accent,
                  border: 'none', borderRadius: 10, padding: '9px 20px',
                  fontSize: 14, fontWeight: 700, color: '#FFF',
                  cursor: validEntries.length === 0 ? 'not-allowed' : 'pointer',
                  fontFamily: T.body, boxShadow: validEntries.length > 0 ? SHADOW.button : 'none',
                  transition: 'background 0.15s, box-shadow 0.15s',
                  display: 'flex', alignItems: 'center', gap: 7,
                  opacity: validEntries.length === 0 ? 0.55 : 1,
                }}
                onMouseEnter={e => {
                  if (validEntries.length > 0) e.currentTarget.style.background = C.accentHover
                }}
                onMouseLeave={e => {
                  if (validEntries.length > 0) e.currentTarget.style.background = C.accent
                }}
              >
                <CheckCircleIcon size={16} />
                שמור ועדכן
                {validEntries.length > 0 && (
                  <span style={{
                    background: 'rgba(255,255,255,0.25)',
                    borderRadius: 10, padding: '1px 7px',
                    fontSize: 12,
                  }}>
                    {validEntries.length}
                  </span>
                )}
              </button>
            </div>
          </div>
        </div>
      </div>
    </>
  )
}

// ─────────────────────────────────────────────────────────────────────────────
// SECTION 10 — FIELD ROW SUB-COMPONENT
// ─────────────────────────────────────────────────────────────────────────────

interface FieldRowProps {
  entry:       VerifiedEntry
  index:       number
  accentColor: string
  onChange:    (val: string) => void
}

function FieldRow({ entry, index, accentColor, onChange }: FieldRowProps) {
  const [focused, setFocused] = useState(false)

  const numVal = parseFloat(entry.editedValue)
  const isValid = !isNaN(numVal) && numVal >= 0 && numVal <= 10_000_000
  const wasModified = entry.editedValue !== String(entry.rawValue)

  const borderColor = !isValid
    ? C.dangerBorder
    : focused
    ? C.borderFocus
    : C.border

  return (
    <div
      style={{
        display: 'flex', alignItems: 'center', gap: 12,
        padding: '10px 12px', borderRadius: 10, marginBottom: 6,
        border: `1px solid ${isValid ? (wasModified ? C.warnBorder : C.border) : C.dangerBorder}`,
        background: !isValid ? C.dangerBg : wasModified ? C.warnBg : '#FAFAFA',
        direction: 'rtl',
        animation: `th-field-in 0.18s ease ${index * 0.03}s both`,
        transition: 'border-color 0.15s, background 0.15s',
      }}
    >
      {/* Code chip(s) */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: 3, flexShrink: 0 }}>
        {entry.codesFound.slice(0, 2).map(code => (
          <span
            key={code}
            style={{
              padding: '1px 7px', borderRadius: 6,
              fontSize: 10, fontWeight: 700, fontFamily: T.mono,
              background: accentColor + '18',
              color: accentColor, whiteSpace: 'nowrap',
            }}
          >
            {String(code).padStart(3, '0')}
          </span>
        ))}
        {entry.codesFound.length > 2 && (
          <span style={{ fontSize: 9, color: C.textLight, fontFamily: T.body, paddingRight: 7 }}>
            +{entry.codesFound.length - 2}
          </span>
        )}
      </div>

      {/* Label */}
      <div style={{ flex: 1, minWidth: 0 }}>
        <p style={{
          margin: 0, fontSize: 13, fontWeight: 600,
          color: C.textMain, fontFamily: T.body,
          overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
        }}>
          {entry.label}
        </p>
        <p style={{ margin: 0, fontSize: 11, color: C.textLight, fontFamily: T.body }}>
          {entry.codeHint}
          {wasModified && (
            <span style={{ color: C.warn, marginRight: 6 }}>
              {' '}(שונה מ-{entry.rawValue.toLocaleString('he-IL')} ₪)
            </span>
          )}
        </p>
      </div>

      {/* Number input + ₪ */}
      <div style={{
        display: 'flex', alignItems: 'center', gap: 4,
        border: `1.5px solid ${borderColor}`,
        borderRadius: 8, overflow: 'hidden', flexShrink: 0,
        background: C.card, transition: 'border-color 0.15s',
        boxShadow: focused ? `0 0 0 3px ${C.accentLight}` : SHADOW.input,
      }}>
        <input
          type="number"
          min={0}
          max={10_000_000}
          step={1}
          value={entry.editedValue}
          onChange={e => onChange(e.target.value)}
          onFocus={() => setFocused(true)}
          onBlur={() => setFocused(false)}
          aria-label={entry.label}
          style={{
            width: 110, padding: '6px 8px',
            fontSize: 14, fontWeight: 700, fontFamily: T.mono,
            color: !isValid ? C.danger : C.textMain,
            background: 'transparent', border: 'none', outline: 'none',
            textAlign: 'left', direction: 'ltr',
            MozAppearance: 'textfield',
          } as React.CSSProperties}
        />
        <span style={{
          padding: '6px 8px 6px 0',
          fontSize: 13, fontWeight: 600, color: C.textMuted, fontFamily: T.body,
          flexShrink: 0,
        }}>
          ₪
        </span>
      </div>
    </div>
  )
}

// ─────────────────────────────────────────────────────────────────────────────
// SECTION 11 — MAIN COMPONENT
// ─────────────────────────────────────────────────────────────────────────────

export default function OcrUploader() {
  const updateField = useUpdateField()

  // ── Local State ────────────────────────────────────────────────────────────
  const [phase,        setPhase]        = useState<OcrPhase>('idle')
  const [ocrProgress,  setOcrProgress]  = useState<OcrProgress>({ status: '', progress: 0 })
  const [rawText,      setRawText]      = useState('')
  const [extractedMap, setExtractedMap] = useState<Map<keyof TaxDataInput, ExtractedResult>>(
    new Map()
  )
  const [savedCount,   setSavedCount]   = useState(0)
  const [dragOver,     setDragOver]     = useState(false)
  const [fileError,    setFileError]    = useState<string | null>(null)
  const [previewUrl,   setPreviewUrl]   = useState<string | null>(null)

  const inputRef = useRef<HTMLInputElement>(null)

  // Revoke object URL on unmount
  useEffect(() => {
    return () => { if (previewUrl) URL.revokeObjectURL(previewUrl) }
  }, [previewUrl])

  // ── File Validation ─────────────────────────────────────────────────────────

  const validateFile = (file: File): string | null => {
    // PDF blocked — Tesseract.js works on pixel data; PDF requires rendering
    if (
      file.type === 'application/pdf' ||
      file.name.toLowerCase().endsWith('.pdf')
    ) {
      return (
        'קבצי PDF אינם נתמכים — מנוע OCR מצריך תמונה (פיקסלים). ' +
        'המירו את ה-PDF לתמונה (PNG / JPG) ונסו שוב.'
      )
    }
    if (!file.type.startsWith('image/')) {
      return (
        `סוג קובץ "${file.type || file.name}" אינו נתמך. ` +
        'אנא העלו תמונה בלבד: PNG, JPG, WEBP, GIF, BMP.'
      )
    }
    if (file.size > 20 * 1024 * 1024) {
      return 'הקובץ גדול מדי (מקסימום 20 MB). אנא דחסו את התמונה ונסו שוב.'
    }
    return null
  }

  // ── OCR Runner ──────────────────────────────────────────────────────────────

  const runOcr = useCallback(async (file: File) => {
    setFileError(null)
    setPhase('loading')
    setOcrProgress({ status: 'טוען מנוע זיהוי תווים…', progress: 0 })

    const objUrl = URL.createObjectURL(file)
    setPreviewUrl(objUrl)

    try {
      /**
       * Dual-language recognition: Hebrew (heb) + English (eng).
       * Form 106 mixes Hebrew labels with Latin-character codes and numbers.
       * PRIVACY: Tesseract runs in a Web Worker — bytes never leave the browser.
       */
      const result = await Tesseract.recognize(file, 'heb+eng', {
        logger: (logEntry: Tesseract.LoggerMessage) => {
          setOcrProgress({
            status:   hebrewStatus(logEntry.status),
            progress: typeof logEntry.progress === 'number' ? logEntry.progress : 0,
          })
        },
      })

      const text = result.data.text
      setRawText(text)

      // Run pure extraction engine
      const map = extractTaxData(text)
      setExtractedMap(map)
      setPhase('verify')

    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err)
      setFileError(
        `שגיאה בעיבוד התמונה: ${msg}. ` +
        'אנא נסו תמונה ברורה יותר בפורמט PNG או JPG.'
      )
      setPhase('idle')
      URL.revokeObjectURL(objUrl)
      setPreviewUrl(null)
    }
  }, [])

  // ── Event Handlers ──────────────────────────────────────────────────────────

  const handleFileSelected = useCallback((file: File) => {
    const err = validateFile(file)
    if (err) { setFileError(err); return }
    runOcr(file)
  }, [runOcr])

  const handleInputChange = (e: ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (file) handleFileSelected(file)
    e.target.value = ''
  }

  const handleDrop = (e: DragEvent<HTMLDivElement>) => {
    e.preventDefault()
    setDragOver(false)
    const file = e.dataTransfer.files?.[0]
    if (file) handleFileSelected(file)
  }

  /**
   * Batch update: iterate verified entries and call updateField once per key.
   * This is the ONLY place state is written to Zustand — after user approval.
   */
  const handleSave = (entries: VerifiedEntry[]) => {
    let count = 0
    for (const entry of entries) {
      const n = parseFloat(entry.editedValue)
      if (!isNaN(n) && n >= 0) {
        updateField(entry.storeKey as keyof TaxDataInput, n as never)
        count++
      }
    }
    setSavedCount(count)
    setPhase('saved')
  }

  const handleReset = () => {
    setPhase('idle')
    setRawText('')
    setExtractedMap(new Map())
    setSavedCount(0)
    setFileError(null)
    if (previewUrl) {
      URL.revokeObjectURL(previewUrl)
      setPreviewUrl(null)
    }
  }

  // ── Render ──────────────────────────────────────────────────────────────────

  return (
    <div dir="rtl" style={{ width: '100%', fontFamily: T.body }}>

      {/* Hidden animations + input styles */}
      <style>{`
        @keyframes th-spin { to { transform: rotate(360deg); } }
        @keyframes th-fade-in { from { opacity: 0; } to { opacity: 1; } }
        @keyframes th-slide-up {
          from { opacity: 0; transform: translateY(14px); }
          to   { opacity: 1; transform: translateY(0); }
        }
        @keyframes th-field-in {
          from { opacity: 0; transform: translateX(8px); }
          to   { opacity: 1; transform: translateX(0); }
        }
        input[type=number]::-webkit-inner-spin-button,
        input[type=number]::-webkit-outer-spin-button {
          -webkit-appearance: none;
          margin: 0;
        }
      `}</style>

      {/* ── Hidden file input ── */}
      <input
        ref={inputRef}
        type="file"
        accept="image/*"
        onChange={handleInputChange}
        style={{ display: 'none' }}
        aria-hidden="true"
      />

      {/* ── IDLE — Drop Zone ── */}
      {phase === 'idle' && (
        <div>
          <div
            role="button"
            tabIndex={0}
            aria-label="גרור תמונת טופס 106 לכאן או לחץ להעלאה"
            onDragOver={e => { e.preventDefault(); setDragOver(true) }}
            onDragLeave={() => setDragOver(false)}
            onDrop={handleDrop}
            onClick={() => inputRef.current?.click()}
            onKeyDown={e => { if (e.key === 'Enter' || e.key === ' ') inputRef.current?.click() }}
            style={{
              border: `2px dashed ${dragOver ? C.accent : C.border}`,
              borderRadius: 14, padding: '28px 20px',
              textAlign: 'center', cursor: 'pointer',
              background: dragOver ? C.accentLight : C.bg,
              transition: 'border-color 0.2s, background 0.2s',
              display: 'flex', flexDirection: 'column',
              alignItems: 'center', gap: 10,
            }}
          >
            <div style={{ color: dragOver ? C.accent : C.textLight }}>
              <UploadCloudIcon size={38} />
            </div>
            <div>
              <p style={{
                margin: 0, fontSize: 15, fontWeight: 700,
                color: dragOver ? C.accent : C.textMain, fontFamily: T.heading,
              }}>
                גרור תמונת טופס 106 לכאן
              </p>
              <p style={{ margin: '4px 0 0', fontSize: 13, color: C.textMuted }}>
                או{' '}
                <span style={{ color: C.accent, fontWeight: 600 }}>לחצו לבחירה</span>
                {' '}— PNG, JPG, WEBP
              </p>
            </div>

            {/* Privacy + image-only badges */}
            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', justifyContent: 'center' }}>
              <span style={{
                display: 'inline-flex', alignItems: 'center', gap: 4,
                fontSize: 11, color: C.textMuted, fontFamily: T.body,
                background: C.card, border: `1px solid ${C.border}`,
                borderRadius: 20, padding: '3px 10px',
              }}>
                <ShieldIcon size={11} />
                עיבוד מקומי בלבד
              </span>
              <span style={{
                display: 'inline-flex', alignItems: 'center', gap: 4,
                fontSize: 11, color: C.warn, fontFamily: T.body,
                background: C.warnBg, border: `1px solid ${C.warnBorder}`,
                borderRadius: 20, padding: '3px 10px',
              }}>
                <AlertTriangleIcon size={11} />
                PDF אינו נתמך
              </span>
            </div>
          </div>

          {/* File error */}
          {fileError && (
            <div style={{
              marginTop: 10, padding: '10px 14px',
              background: C.dangerBg, border: `1px solid ${C.dangerBorder}`,
              borderRadius: 10, display: 'flex', gap: 8, alignItems: 'flex-start',
            }}>
              <span style={{ color: C.danger, flexShrink: 0, marginTop: 1 }}>
                <AlertTriangleIcon size={15} />
              </span>
              <p style={{ margin: 0, fontSize: 13, color: C.danger, fontFamily: T.body, lineHeight: 1.5 }}>
                {fileError}
              </p>
            </div>
          )}
        </div>
      )}

      {/* ── LOADING — OCR in progress ── */}
      {phase === 'loading' && (
        <div style={{
          background: C.card, border: `1px solid ${C.border}`,
          borderRadius: 14, padding: '24px 20px',
          display: 'flex', flexDirection: 'column', gap: 16, alignItems: 'center',
        }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 12, width: '100%' }}>
            <Spinner size={28} />
            <div>
              <p style={{ margin: 0, fontSize: 14, fontWeight: 700, color: C.textMain, fontFamily: T.heading }}>
                מנתח תמונה…
              </p>
              <p style={{ margin: 0, fontSize: 12, color: C.textMuted, fontFamily: T.body }}>
                Tesseract OCR — עברית + אנגלית
              </p>
            </div>
          </div>
          <div style={{ width: '100%' }}>
            <ProgressBar value={ocrProgress.progress} label={ocrProgress.status} />
          </div>
          <div style={{
            display: 'flex', alignItems: 'center', gap: 5,
            fontSize: 11, color: C.textLight, fontFamily: T.body,
          }}>
            <ShieldIcon size={11} />
            הכל מעובד מקומית — ללא שרתים
          </div>
        </div>
      )}

      {/* ── SAVED — Success Banner ── */}
      {phase === 'saved' && (
        <SuccessBanner savedCount={savedCount} onReset={handleReset} />
      )}

      {/* ── VERIFY — Modal (portal-like fixed overlay) ── */}
      {phase === 'verify' && (
        <VerifyModal
          extractedMap={extractedMap}
          rawText={rawText}
          onSave={handleSave}
          onClose={() => {
            // Closing without saving returns to idle
            setPhase('idle')
            setRawText('')
            setExtractedMap(new Map())
          }}
        />
      )}

      {/* ── Footer hint (idle only) ── */}
      {phase === 'idle' && !fileError && (
        <p style={{
          marginTop: 10, fontSize: 11, color: C.textLight,
          fontFamily: T.body, lineHeight: 1.6, textAlign: 'center',
        }}>
          לאחר הסריקה תוצג רשימת שדות לאישור ידני לפני שמירה לטופס.
        </p>
      )}
    </div>
  )
}