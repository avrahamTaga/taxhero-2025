/**
 * TaxHero 2025 — מודול OCR לטעינת טופס 106
 * ==========================================
 * File: src/components/OcrUploader.tsx
 *
 * Architecture contract:
 *   - ZERO BACKEND: File never leaves the browser. Tesseract.js runs entirely
 *     in a local Web Worker — no network calls, no server uploads.
 *   - HUMAN-IN-THE-LOOP: Raw OCR text is surfaced to the user for visual
 *     verification before any value is committed to the Zustand store.
 *   - SINGLE INTEGRATION POINT: Saves only `grossIncome158` via
 *     `updateField('grossIncome158', value)` — consistent with TaxDataInput.
 *
 * Privacy guarantee displayed to user:
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

// ─────────────────────────────────────────────────────────────────────────────
// SECTION 1 — DESIGN TOKENS (consistent with Wizard.tsx)
// ─────────────────────────────────────────────────────────────────────────────

const C = {
  bg:           '#F4F1FC',
  card:         '#FFFFFF',
  border:       '#E8E3F5',
  borderFocus:  '#7C3AED',
  borderDanger: '#F87171',
  textMain:     '#1C1027',
  textMuted:    '#7268A0',
  textLight:    '#A9A0CC',
  accent:       '#7C3AED',
  accentLight:  '#EDE9FE',
  accentHover:  '#6D28D9',
  accentDeep:   '#4C1D95',
  success:      '#059669',
  successBg:    '#D1FAE5',
  successBorder:'#6EE7B7',
  danger:       '#DC2626',
  dangerBg:     '#FEF2F2',
  dangerBorder: '#FECACA',
  warn:         '#D97706',
  warnBg:       '#FFFBEB',
  warnBorder:   '#FDE68A',
  overlay:      'rgba(28, 16, 39, 0.65)',
  progressTrack:'#E8E3F5',
  progressFill: 'linear-gradient(90deg, #7C3AED 0%, #A855F7 100%)',
  shimmer:      'linear-gradient(90deg, #f4f1fc 25%, #ede9fe 50%, #f4f1fc 75%)',
} as const

const T = {
  heading: "'Heebo', system-ui, sans-serif",
  body:    "'Assistant', system-ui, sans-serif",
  mono:    "'Courier New', Courier, monospace",
} as const

const SHADOW = {
  card:   '0 2px 16px rgba(124,58,237,0.08), 0 1px 4px rgba(28,16,39,0.04)',
  modal:  '0 24px 64px rgba(28,16,39,0.24), 0 4px 16px rgba(124,58,237,0.12)',
  button: '0 2px 8px rgba(124,58,237,0.30)',
} as const

// ─────────────────────────────────────────────────────────────────────────────
// SECTION 2 — TYPES
// ─────────────────────────────────────────────────────────────────────────────

type OcrPhase =
  | 'idle'         // waiting for file
  | 'loading'      // tesseract running
  | 'verify'       // modal open — user reviews OCR text
  | 'saved'        // value committed to store

interface OcrProgress {
  status: string
  progress: number // 0–1
}

// ─────────────────────────────────────────────────────────────────────────────
// SECTION 3 — HELPER: FORMAT HEBREW STATUS TEXT
// ─────────────────────────────────────────────────────────────────────────────

function hebrewStatus(raw: string): string {
  const map: Record<string, string> = {
    'loading tesseract core':          'טוען מנוע זיהוי תווים…',
    'initializing tesseract':          'מאתחל Tesseract…',
    'initializing api':                'מאתחל ממשק…',
    'loading language traineddata':    'טוען נתוני עברית + אנגלית…',
    'initializing lstm feature extractor': 'טוען מודל LSTM…',
    'recognizing text':                'מזהה טקסט בתמונה…',
  }
  const lower = raw.toLowerCase()
  for (const [key, value] of Object.entries(map)) {
    if (lower.includes(key)) return value
  }
  return 'מעבד…'
}

// ─────────────────────────────────────────────────────────────────────────────
// SECTION 4 — HELPER: EXTRACT CODE 158 FROM RAW TEXT (best-effort)
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Attempts to auto-detect the Code 158 gross income from raw OCR text.
 * Returns `null` if detection fails — the user MUST confirm manually.
 *
 * Strategy: look for the numeric token closest after "158" on the same line.
 * Handles common OCR confusions: 'l' → '1', 'O' → '0', commas in numbers.
 */
function tryExtractCode158(text: string): number | null {
  const lines = text.split('\n')
  for (const line of lines) {
    // Loose pattern: "158" then optional separators then a number ≥ 1000 ILS
    if (/158/.test(line)) {
      // Normalise common OCR confusions
      const cleaned = line
        .replace(/[lL]/g, '1')
        .replace(/[oO]/g, '0')
        .replace(/,/g, '')
        .replace(/\./g, '')
      const match = cleaned.match(/158[^\d]*(\d{4,10})/)
      if (match) {
        const val = parseInt(match[1], 10)
        // Sanity bounds: ILS 1,000 – 5,000,000
        if (val >= 1_000 && val <= 5_000_000) return val
      }
    }
  }
  return null
}

// ─────────────────────────────────────────────────────────────────────────────
// SECTION 5 — SUB-COMPONENTS
// ─────────────────────────────────────────────────────────────────────────────

// ── 5a. Privacy Badge ──────────────────────────────────────────────────────

function PrivacyBadge() {
  return (
    <div
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        gap: 6,
        backgroundColor: C.successBg,
        border: `1px solid ${C.successBorder}`,
        borderRadius: 20,
        padding: '4px 12px',
        fontSize: 12,
        fontFamily: T.body,
        color: C.success,
        fontWeight: 600,
        marginBottom: 16,
        userSelect: 'none',
      }}
    >
      <LockIcon size={13} />
      הקובץ מעובד לחלוטין במכשיר שלך — לא מועבר שום מידע לשרת
    </div>
  )
}

// ── 5b. Inline SVG Icons (no external dependency) ─────────────────────────

function LockIcon({ size = 16 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.5} strokeLinecap="round" strokeLinejoin="round">
      <rect x="3" y="11" width="18" height="11" rx="2" ry="2"/>
      <path d="M7 11V7a5 5 0 0 1 10 0v4"/>
    </svg>
  )
}

function UploadIcon({ size = 32 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round">
      <polyline points="16 16 12 12 8 16"/>
      <line x1="12" y1="12" x2="12" y2="21"/>
      <path d="M20.39 18.39A5 5 0 0 0 18 9h-1.26A8 8 0 1 0 3 16.3"/>
    </svg>
  )
}

function ScanIcon({ size = 18 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
      <polyline points="23 6 23 2 19 2"/>
      <polyline points="1 6 1 2 5 2"/>
      <polyline points="23 18 23 22 19 22"/>
      <polyline points="1 18 1 22 5 22"/>
      <line x1="1" y1="12" x2="23" y2="12"/>
    </svg>
  )
}

function CheckIcon({ size = 18 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.5} strokeLinecap="round" strokeLinejoin="round">
      <polyline points="20 6 9 17 4 12"/>
    </svg>
  )
}

function XIcon({ size = 16 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.5} strokeLinecap="round" strokeLinejoin="round">
      <line x1="18" y1="6" x2="6" y2="18"/>
      <line x1="6" y1="6" x2="18" y2="18"/>
    </svg>
  )
}

function WarningIcon({ size = 16 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
      <path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"/>
      <line x1="12" y1="9" x2="12" y2="13"/>
      <line x1="12" y1="17" x2="12.01" y2="17"/>
    </svg>
  )
}

// ── 5c. Progress Bar ──────────────────────────────────────────────────────

function ProgressBar({ value, label }: { value: number; label: string }) {
  const pct = Math.round(value * 100)
  return (
    <div style={{ width: '100%' }}>
      <div style={{
        display: 'flex',
        justifyContent: 'space-between',
        marginBottom: 8,
        fontFamily: T.body,
      }}>
        <span style={{ fontSize: 13, color: C.textMuted, direction: 'rtl' }}>{label}</span>
        <span style={{ fontSize: 13, fontWeight: 700, color: C.accent, fontVariantNumeric: 'tabular-nums' }}>
          {pct}%
        </span>
      </div>
      <div style={{
        height: 8,
        borderRadius: 8,
        backgroundColor: C.progressTrack,
        overflow: 'hidden',
      }}>
        <div style={{
          height: '100%',
          width: `${pct}%`,
          background: C.progressFill,
          borderRadius: 8,
          transition: 'width 0.25s ease',
        }} />
      </div>
    </div>
  )
}

// ── 5d. Animated Spinner ──────────────────────────────────────────────────

function Spinner({ size = 24 }: { size?: number }) {
  return (
    <>
      <style>{`
        @keyframes th-spin {
          to { transform: rotate(360deg); }
        }
        @keyframes th-pulse-scale {
          0%, 100% { transform: scale(1); opacity: 1; }
          50%       { transform: scale(0.92); opacity: 0.7; }
        }
      `}</style>
      <div style={{
        width: size,
        height: size,
        borderRadius: '50%',
        border: `3px solid ${C.accentLight}`,
        borderTopColor: C.accent,
        animation: 'th-spin 0.75s linear infinite',
        flexShrink: 0,
      }} />
    </>
  )
}

// ─────────────────────────────────────────────────────────────────────────────
// SECTION 6 — VERIFICATION MODAL
// ─────────────────────────────────────────────────────────────────────────────

interface VerifyModalProps {
  rawText:        string
  suggestedValue: number | null
  onConfirm:      (value: number) => void
  onClose:        () => void
}

function VerifyModal({ rawText, suggestedValue, onConfirm, onClose }: VerifyModalProps) {
  const [inputVal, setInputVal] = useState<string>(
    suggestedValue !== null ? String(suggestedValue) : ''
  )
  const [touched,  setTouched]  = useState(false)
  const inputRef = useRef<HTMLInputElement>(null)

  // Focus the number input when the modal opens
  useEffect(() => {
    const t = setTimeout(() => inputRef.current?.focus(), 100)
    return () => clearTimeout(t)
  }, [])

  // Trap Escape key
  useEffect(() => {
    const handler = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose() }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [onClose])

  const parsed   = parseFloat(inputVal.replace(/,/g, ''))
  const isValid  = !isNaN(parsed) && parsed >= 0 && parsed <= 5_000_000
  const showErr  = touched && !isValid

  const handleConfirm = () => {
    setTouched(true)
    if (isValid) onConfirm(parsed)
  }

  return (
    <>
      {/* ── Backdrop ── */}
      <div
        onClick={onClose}
        style={{
          position:  'fixed',
          inset:     0,
          zIndex:    1000,
          background: C.overlay,
          backdropFilter: 'blur(4px)',
          WebkitBackdropFilter: 'blur(4px)',
          animation: 'th-fade-in 0.2s ease',
        }}
      />

      {/* ── Panel ── */}
      <div
        role="dialog"
        aria-modal="true"
        aria-label="אימות טקסט OCR"
        dir="rtl"
        style={{
          position:  'fixed',
          inset:     0,
          zIndex:    1001,
          display:   'flex',
          alignItems: 'center',
          justifyContent: 'center',
          padding:   16,
          pointerEvents: 'none',
        }}
      >
        <div style={{
          pointerEvents:  'auto',
          background:     C.card,
          borderRadius:   20,
          boxShadow:      SHADOW.modal,
          width:          '100%',
          maxWidth:       640,
          maxHeight:      '90vh',
          display:        'flex',
          flexDirection:  'column',
          overflow:       'hidden',
          animation:      'th-slide-up 0.22s cubic-bezier(0.22,0.61,0.36,1)',
        }}>

          {/* ── Modal Header ── */}
          <div style={{
            padding:      '20px 24px 16px',
            borderBottom: `1px solid ${C.border}`,
            display:      'flex',
            alignItems:   'flex-start',
            gap:          12,
            flexShrink:   0,
          }}>
            <div style={{
              width:          40,
              height:         40,
              borderRadius:   12,
              background:     C.accentLight,
              display:        'flex',
              alignItems:     'center',
              justifyContent: 'center',
              color:          C.accent,
              flexShrink:     0,
            }}>
              <ScanIcon size={20} />
            </div>
            <div style={{ flex: 1 }}>
              <h2 style={{
                margin:      0,
                fontSize:    18,
                fontWeight:  800,
                color:       C.textMain,
                fontFamily:  T.heading,
                lineHeight:  1.3,
              }}>
                אימות תוצאות OCR
              </h2>
              <p style={{
                margin:      '4px 0 0',
                fontSize:    13,
                color:       C.textMuted,
                fontFamily:  T.body,
                lineHeight:  1.5,
              }}>
                בדקו את הטקסט שזוהה מהתמונה ואשרו את הכנסת הברוטו שלכם (קוד 158).
              </p>
            </div>
            <button
              onClick={onClose}
              aria-label="סגור"
              style={{
                background:   'none',
                border:       'none',
                cursor:       'pointer',
                padding:      6,
                color:        C.textMuted,
                borderRadius: 8,
                display:      'flex',
                alignItems:   'center',
                justifyContent: 'center',
                flexShrink:   0,
                transition:   'color 0.15s, background 0.15s',
              }}
              onMouseEnter={e => {
                ;(e.currentTarget as HTMLButtonElement).style.color = C.danger
                ;(e.currentTarget as HTMLButtonElement).style.background = C.dangerBg
              }}
              onMouseLeave={e => {
                ;(e.currentTarget as HTMLButtonElement).style.color = C.textMuted
                ;(e.currentTarget as HTMLButtonElement).style.background = 'none'
              }}
            >
              <XIcon size={18} />
            </button>
          </div>

          {/* ── Scrollable Body ── */}
          <div style={{ overflowY: 'auto', flex: 1, padding: '20px 24px' }}>

            {/* ── Raw OCR Text Section ── */}
            <p style={{
              margin:      '0 0 8px',
              fontSize:    13,
              fontWeight:  700,
              color:       C.textMain,
              fontFamily:  T.body,
              display:     'flex',
              alignItems:  'center',
              gap:         6,
            }}>
              <span style={{
                background: C.accentLight,
                color:      C.accent,
                borderRadius: 6,
                padding:    '2px 8px',
                fontSize:   11,
                fontWeight: 700,
                letterSpacing: '0.05em',
              }}>
                OCR
              </span>
              טקסט שזוהה מהתמונה
            </p>

            <div style={{
              background:   '#1C1027',
              border:       `1px solid ${C.accentDeep}`,
              borderRadius: 12,
              padding:      '14px 16px',
              marginBottom: 20,
              maxHeight:    260,
              overflowY:    'auto',
            }}>
              <pre style={{
                margin:      0,
                fontFamily:  T.mono,
                fontSize:    12,
                lineHeight:  1.7,
                color:       '#D4C8F5',
                whiteSpace:  'pre-wrap',
                wordBreak:   'break-word',
                direction:   'rtl',
              }}>
                {rawText.trim() || '(לא זוהה טקסט — נסו תמונה ברורה יותר)'}
              </pre>
            </div>

            {/* ── Auto-detection hint ── */}
            {suggestedValue !== null && (
              <div style={{
                background:   C.warnBg,
                border:       `1px solid ${C.warnBorder}`,
                borderRadius: 10,
                padding:      '10px 14px',
                marginBottom: 16,
                display:      'flex',
                alignItems:   'center',
                gap:          8,
                fontSize:     13,
                color:        C.warn,
                fontFamily:   T.body,
              }}>
                <WarningIcon size={15} />
                <span>
                  זוהה ערך אוטומטי <strong>{suggestedValue.toLocaleString('he-IL')} ₪</strong> עבור קוד 158 —
                  {' '}אנא ודאו שהוא נכון לפני אישור.
                </span>
              </div>
            )}

            {/* ── Code 158 Input ── */}
            <label
              htmlFor="ocr-code-158-input"
              style={{
                display:     'block',
                fontSize:    14,
                fontWeight:  800,
                color:       C.textMain,
                marginBottom: 6,
                fontFamily:  T.body,
              }}
            >
              הכנסת ברוטו — קוד 158
              <span style={{
                marginRight: 8,
                fontSize:    12,
                fontWeight:  500,
                color:       C.textMuted,
              }}>
                (סה״כ שכר ברוטו שנתי — ₪)
              </span>
            </label>

            <div style={{ position: 'relative' }}>
              <input
                id="ocr-code-158-input"
                ref={inputRef}
                type="number"
                inputMode="numeric"
                min={0}
                max={5_000_000}
                step={1}
                value={inputVal}
                onChange={(e: ChangeEvent<HTMLInputElement>) => {
                  setTouched(false)
                  setInputVal(e.target.value)
                }}
                onBlur={() => setTouched(true)}
                placeholder="לדוגמה: 180000"
                dir="ltr"
                style={{
                  width:          '100%',
                  boxSizing:      'border-box',
                  padding:        '13px 16px',
                  fontSize:       16,
                  fontWeight:     700,
                  fontFamily:     T.body,
                  fontVariantNumeric: 'tabular-nums',
                  border:         `2px solid ${showErr ? C.dangerBorder : isValid && touched ? C.successBorder : C.border}`,
                  borderRadius:   10,
                  background:     showErr ? C.dangerBg : C.card,
                  color:          C.textMain,
                  outline:        'none',
                  transition:     'border-color 0.15s, background 0.15s',
                  textAlign:      'left',
                }}
                onFocus={e => {
                  e.currentTarget.style.borderColor = C.borderFocus
                  e.currentTarget.style.boxShadow = `0 0 0 3px ${C.accentLight}`
                }}
                onBlurCapture={e => {
                  setTouched(true)
                  e.currentTarget.style.boxShadow = 'none'
                  e.currentTarget.style.borderColor = showErr ? C.dangerBorder : C.border
                }}
              />
              {/* Currency symbol overlay */}
              <span style={{
                position:   'absolute',
                left:       14,
                top:        '50%',
                transform:  'translateY(-50%)',
                fontSize:   16,
                color:      C.textLight,
                pointerEvents: 'none',
                fontFamily: T.body,
              }}>
                ₪
              </span>
            </div>

            {/* Validation error */}
            {showErr && (
              <p style={{
                margin:    '6px 0 0',
                fontSize:  12,
                color:     C.danger,
                fontFamily: T.body,
                display:   'flex',
                alignItems: 'center',
                gap:        4,
              }}>
                <WarningIcon size={12} />
                יש להזין סכום תקין בין 0 ל-5,000,000 ₪
              </p>
            )}

            {/* Help text */}
            <p style={{
              margin:    '8px 0 0',
              fontSize:  12,
              color:     C.textMuted,
              fontFamily: T.body,
              lineHeight: 1.6,
            }}>
              חפשו את השורה <strong style={{ color: C.textMain }}>קוד 158</strong> בטקסט שלמעלה והזינו את הסכום המתאים.
              בטופס 106 המקורי הסכום מופיע בשדה "הכנסה ברוטו".
            </p>
          </div>

          {/* ── Modal Footer ── */}
          <div style={{
            padding:      '16px 24px',
            borderTop:    `1px solid ${C.border}`,
            display:      'flex',
            gap:          10,
            justifyContent: 'flex-start',
            flexShrink:   0,
            background:   '#FDFCFF',
          }}>
            {/* Primary action */}
            <button
              onClick={handleConfirm}
              disabled={!isValid && touched}
              style={{
                display:        'flex',
                alignItems:     'center',
                gap:            7,
                padding:        '11px 22px',
                fontSize:       14,
                fontWeight:     700,
                fontFamily:     T.body,
                color:          '#FFF',
                background:     C.accent,
                border:         'none',
                borderRadius:   10,
                cursor:         'pointer',
                boxShadow:      SHADOW.button,
                transition:     'background 0.15s, transform 0.1s',
              }}
              onMouseEnter={e => (e.currentTarget.style.background = C.accentHover)}
              onMouseLeave={e => (e.currentTarget.style.background = C.accent)}
              onMouseDown={e  => (e.currentTarget.style.transform = 'scale(0.97)')}
              onMouseUp={e    => (e.currentTarget.style.transform = 'scale(1)')}
            >
              <CheckIcon size={16} />
              אשר ושמור בטופס
            </button>

            {/* Secondary: cancel */}
            <button
              onClick={onClose}
              style={{
                padding:    '11px 18px',
                fontSize:   14,
                fontWeight: 600,
                fontFamily: T.body,
                color:      C.textMuted,
                background: C.bg,
                border:     `1px solid ${C.border}`,
                borderRadius: 10,
                cursor:     'pointer',
                transition: 'background 0.15s',
              }}
              onMouseEnter={e => (e.currentTarget.style.background = C.accentLight)}
              onMouseLeave={e => (e.currentTarget.style.background = C.bg)}
            >
              ביטול
            </button>
          </div>
        </div>
      </div>

      {/* ── Modal Keyframes ── */}
      <style>{`
        @keyframes th-fade-in    { from { opacity: 0; } to { opacity: 1; } }
        @keyframes th-slide-up   { from { opacity: 0; transform: translateY(20px) scale(0.97); }
                                    to   { opacity: 1; transform: translateY(0)    scale(1);    } }
      `}</style>
    </>
  )
}

// ─────────────────────────────────────────────────────────────────────────────
// SECTION 7 — SUCCESS BANNER
// ─────────────────────────────────────────────────────────────────────────────

function SuccessBanner({ value, onReset }: { value: number; onReset: () => void }) {
  return (
    <div style={{
      display:       'flex',
      alignItems:    'center',
      gap:           14,
      padding:       '16px 20px',
      background:    C.successBg,
      border:        `1px solid ${C.successBorder}`,
      borderRadius:  14,
      animation:     'th-fade-in 0.3s ease',
    }}>
      <div style={{
        width:          40,
        height:         40,
        borderRadius:   50,
        background:     C.success,
        display:        'flex',
        alignItems:     'center',
        justifyContent: 'center',
        flexShrink:     0,
      }}>
        <CheckIcon size={20} />
      </div>
      <div style={{ flex: 1 }}>
        <p style={{
          margin:     0,
          fontSize:   14,
          fontWeight: 800,
          color:      C.success,
          fontFamily: T.body,
        }}>
          הכנסת ברוטו עודכנה בהצלחה
        </p>
        <p style={{
          margin:     '3px 0 0',
          fontSize:   13,
          color:      '#065F46',
          fontFamily: T.body,
        }}>
          קוד 158:{' '}
          <strong style={{ fontVariantNumeric: 'tabular-nums' }}>
            {value.toLocaleString('he-IL')} ₪
          </strong>
          {' '}— ערך זה כבר משתקף בחישוב המס שלכם.
        </p>
      </div>
      <button
        onClick={onReset}
        style={{
          background:   'none',
          border:       `1px solid ${C.successBorder}`,
          borderRadius: 8,
          padding:      '6px 12px',
          fontSize:     12,
          fontWeight:   600,
          color:        C.success,
          cursor:       'pointer',
          fontFamily:   T.body,
          whiteSpace:   'nowrap',
          transition:   'background 0.15s',
        }}
        onMouseEnter={e => (e.currentTarget.style.background = 'rgba(6,95,70,0.08)')}
        onMouseLeave={e => (e.currentTarget.style.background = 'none')}
      >
        העלה שוב
      </button>
    </div>
  )
}

// ─────────────────────────────────────────────────────────────────────────────
// SECTION 8 — MAIN COMPONENT
// ─────────────────────────────────────────────────────────────────────────────

export default function OcrUploader() {
  const updateField = useUpdateField()

  // ── Local State ───────────────────────────────────────────────────────────
  const [phase,        setPhase]        = useState<OcrPhase>('idle')
  const [ocrProgress,  setOcrProgress]  = useState<OcrProgress>({ status: '', progress: 0 })
  const [rawText,      setRawText]      = useState('')
  const [suggestedVal, setSuggestedVal] = useState<number | null>(null)
  const [savedValue,   setSavedValue]   = useState<number | null>(null)
  const [dragOver,     setDragOver]     = useState(false)
  const [fileError,    setFileError]    = useState<string | null>(null)
  const [previewUrl,   setPreviewUrl]   = useState<string | null>(null)

  const inputRef = useRef<HTMLInputElement>(null)

  // Revoke object URL on unmount to avoid memory leaks
  useEffect(() => {
    return () => {
      if (previewUrl) URL.revokeObjectURL(previewUrl)
    }
  }, [previewUrl])

  // ── File Validation ───────────────────────────────────────────────────────

  const validateFile = (file: File): string | null => {
    if (file.type === 'application/pdf' || file.name.toLowerCase().endsWith('.pdf')) {
      return 'קבצי PDF אינם נתמכים כרגע. אנא המירו את הקובץ לתמונה (PNG, JPG) ונסו שוב.'
    }
    if (!file.type.startsWith('image/')) {
      return `סוג קובץ "${file.type || file.name}" אינו נתמך. אנא העלו תמונה בלבד (PNG, JPG, WEBP, GIF, BMP).`
    }
    if (file.size > 20 * 1024 * 1024) {
      return 'הקובץ גדול מדי (מקסימום 20MB). אנא דחסו את התמונה ונסו שוב.'
    }
    return null
  }

  // ── OCR Runner ────────────────────────────────────────────────────────────

  const runOcr = useCallback(async (file: File) => {
    setFileError(null)
    setPhase('loading')
    setOcrProgress({ status: 'טוען מנוע זיהוי תווים…', progress: 0 })

    // Create a preview URL for optional display
    const objUrl = URL.createObjectURL(file)
    setPreviewUrl(objUrl)

    try {
      /**
       * Tesseract.recognize with DUAL language: Hebrew ('heb') + English ('eng').
       * This is critical for Form 106 which mixes Hebrew labels with numeric
       * and Latin-character codes. The '+' operator tells Tesseract to use
       * both language packs simultaneously.
       *
       * PRIVACY: Tesseract.js runs entirely in a Web Worker — the image bytes
       * never leave the browser process.
       */
      const result = await Tesseract.recognize(
        file,
        'heb+eng',
        {
          logger: (logEntry: Tesseract.LoggerMessage) => {
            // Map Tesseract's progress events to Hebrew UI feedback
            setOcrProgress({
              status:   hebrewStatus(logEntry.status),
              progress: typeof logEntry.progress === 'number' ? logEntry.progress : 0,
            })
          },
        }
      )

      const text = result.data.text
      setRawText(text)
      setSuggestedVal(tryExtractCode158(text))
      setPhase('verify')

    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err)
      setFileError(`שגיאה בעיבוד התמונה: ${msg}. אנא נסו תמונה ברורה יותר או בפורמט שונה.`)
      setPhase('idle')
      URL.revokeObjectURL(objUrl)
      setPreviewUrl(null)
    }
  }, [])

  // ── Event Handlers ────────────────────────────────────────────────────────

  const handleFileSelected = useCallback((file: File) => {
    const err = validateFile(file)
    if (err) {
      setFileError(err)
      return
    }
    runOcr(file)
  }, [runOcr])

  const handleInputChange = (e: ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (file) handleFileSelected(file)
    // Reset input value so the same file can be re-selected
    e.target.value = ''
  }

  const handleDrop = (e: DragEvent<HTMLDivElement>) => {
    e.preventDefault()
    setDragOver(false)
    const file = e.dataTransfer.files?.[0]
    if (file) handleFileSelected(file)
  }

  const handleDragOver = (e: DragEvent<HTMLDivElement>) => {
    e.preventDefault()
    setDragOver(true)
  }

  const handleDragLeave = () => setDragOver(false)

  const handleConfirm = (value: number) => {
    // Commit to Zustand store — triggers instant tax recalculation
    updateField('grossIncome158', value)
    setSavedValue(value)
    setPhase('saved')
  }

  const handleModalClose = () => {
    setPhase('idle')
    setRawText('')
    setSuggestedVal(null)
    if (previewUrl) {
      URL.revokeObjectURL(previewUrl)
      setPreviewUrl(null)
    }
  }

  const handleReset = () => {
    setPhase('idle')
    setSavedValue(null)
    setRawText('')
    setSuggestedVal(null)
    setFileError(null)
    if (previewUrl) {
      URL.revokeObjectURL(previewUrl)
      setPreviewUrl(null)
    }
  }

  // ─────────────────────────────────────────────────────────────────────────
  // RENDER
  // ─────────────────────────────────────────────────────────────────────────

  return (
    <div
      dir="rtl"
      style={{
        fontFamily: T.body,
        color:      C.textMain,
        maxWidth:   600,
      }}
    >
      {/* ── Global animation keyframes ── */}
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=Heebo:wght@400;700;800;900&family=Assistant:wght@400;600;700&display=swap');
        @keyframes th-fade-in  { from { opacity: 0; }               to { opacity: 1; }               }
        @keyframes th-slide-up { from { opacity:0; transform:translateY(16px); }
                                  to   { opacity:1; transform:translateY(0);    } }
        @keyframes th-shimmer  {
          0%   { background-position: -200% 0; }
          100% { background-position:  200% 0; }
        }
        .th-drop-zone:hover { background: ${C.accentLight} !important; border-color: ${C.borderFocus} !important; }
        .th-upload-btn:hover { background: ${C.accentHover} !important; }
        input[type=number]::-webkit-inner-spin-button,
        input[type=number]::-webkit-outer-spin-button { -webkit-appearance: none; margin: 0; }
      `}</style>

      {/* ── Section Header ── */}
      <div style={{ marginBottom: 16 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 6 }}>
          <div style={{
            width:          36,
            height:         36,
            borderRadius:   10,
            background:     C.accentLight,
            display:        'flex',
            alignItems:     'center',
            justifyContent: 'center',
            color:          C.accent,
          }}>
            <ScanIcon size={18} />
          </div>
          <h3 style={{
            margin:     0,
            fontSize:   18,
            fontWeight: 800,
            color:      C.textMain,
            fontFamily: T.heading,
          }}>
            ייבוא אוטומטי מטופס 106
          </h3>
        </div>
        <p style={{
          margin:     0,
          fontSize:   13,
          color:      C.textMuted,
          lineHeight: 1.6,
          paddingRight: 46,
        }}>
          העלו צילום מסך של טופס 106 ומערכת ה-OCR תזהה את הנתונים אוטומטית — ישירות במכשיר שלכם.
        </p>
      </div>

      {/* ── Privacy Badge ── */}
      <PrivacyBadge />

      {/* ── PDF Warning Note ── */}
      <div style={{
        display:      'flex',
        alignItems:   'flex-start',
        gap:          8,
        background:   C.warnBg,
        border:       `1px solid ${C.warnBorder}`,
        borderRadius: 10,
        padding:      '10px 14px',
        marginBottom: 20,
        fontSize:     13,
        color:        C.warn,
        fontFamily:   T.body,
        lineHeight:   1.6,
      }}>
        <div style={{ flexShrink: 0, marginTop: 1 }}>
          <WarningIcon size={15} />
        </div>
        <p style={{ margin: 0 }}>
          <strong>שימו לב:</strong> נא להעלות צילום מסך או תמונה של טופס ה-106
          {' '}(קובצי PDF אינם נתמכים כרגע). ניתן לצלם את המסך או לייצא כתמונה מהמחשב.
        </p>
      </div>

      {/* ── File Error Banner ── */}
      {fileError && (
        <div style={{
          display:      'flex',
          alignItems:   'flex-start',
          gap:          8,
          background:   C.dangerBg,
          border:       `1px solid ${C.dangerBorder}`,
          borderRadius: 10,
          padding:      '10px 14px',
          marginBottom: 16,
          fontSize:     13,
          color:        C.danger,
          fontFamily:   T.body,
          lineHeight:   1.6,
          animation:    'th-fade-in 0.2s ease',
        }}>
          <div style={{ flexShrink: 0, marginTop: 1 }}>
            <WarningIcon size={15} />
          </div>
          <div style={{ flex: 1 }}>{fileError}</div>
          <button
            onClick={() => setFileError(null)}
            style={{
              background: 'none',
              border:     'none',
              cursor:     'pointer',
              color:      C.danger,
              padding:    2,
              flexShrink: 0,
            }}
            aria-label="סגור שגיאה"
          >
            <XIcon size={14} />
          </button>
        </div>
      )}

      {/* ── Main Content by Phase ── */}
      {phase === 'idle' && (
        /* ── DROP ZONE ── */
        <div
          className="th-drop-zone"
          onDrop={handleDrop}
          onDragOver={handleDragOver}
          onDragLeave={handleDragLeave}
          onClick={() => inputRef.current?.click()}
          role="button"
          tabIndex={0}
          aria-label="לחצו או גררו תמונה של טופס 106"
          onKeyDown={e => { if (e.key === 'Enter' || e.key === ' ') inputRef.current?.click() }}
          style={{
            border:         `2px dashed ${dragOver ? C.accent : C.border}`,
            borderRadius:   16,
            background:     dragOver ? C.accentLight : C.card,
            padding:        '48px 24px',
            textAlign:      'center',
            cursor:         'pointer',
            transition:     'border-color 0.18s, background 0.18s',
            boxShadow:      dragOver ? `0 0 0 4px ${C.accentLight}` : SHADOW.card,
            animation:      'th-fade-in 0.25s ease',
          }}
        >
          {/* Hidden file input — accepts images only */}
          <input
            ref={inputRef}
            type="file"
            accept="image/*"
            style={{ display: 'none' }}
            onChange={handleInputChange}
            aria-hidden="true"
          />

          {/* Upload icon */}
          <div style={{
            display:        'flex',
            justifyContent: 'center',
            marginBottom:   16,
            color:          dragOver ? C.accent : C.textLight,
            transition:     'color 0.18s',
          }}>
            <UploadIcon size={44} />
          </div>

          {/* Primary CTA */}
          <p style={{
            margin:     '0 0 6px',
            fontSize:   16,
            fontWeight: 800,
            color:      dragOver ? C.accent : C.textMain,
            fontFamily: T.heading,
            transition: 'color 0.18s',
          }}>
            {dragOver ? 'שחררו את הקובץ כאן' : 'גררו תמונה לכאן, או לחצו לבחירה'}
          </p>

          <p style={{
            margin:     '0 0 20px',
            fontSize:   13,
            color:      C.textMuted,
            fontFamily: T.body,
          }}>
            PNG, JPG, WEBP, BMP — עד 20MB
          </p>

          {/* Upload button */}
          <button
            className="th-upload-btn"
            tabIndex={-1}
            style={{
              display:     'inline-flex',
              alignItems:  'center',
              gap:         8,
              padding:     '11px 24px',
              fontSize:    14,
              fontWeight:  700,
              fontFamily:  T.body,
              color:       '#FFF',
              background:  C.accent,
              border:      'none',
              borderRadius: 10,
              cursor:      'pointer',
              boxShadow:   SHADOW.button,
              transition:  'background 0.15s',
              pointerEvents: 'none', // click handled by outer div
            }}
          >
            <UploadIcon size={16} />
            בחרו קובץ
          </button>
        </div>
      )}

      {phase === 'loading' && (
        /* ── LOADING STATE ── */
        <div style={{
          background:   C.card,
          border:       `1px solid ${C.border}`,
          borderRadius: 16,
          padding:      '36px 28px',
          boxShadow:    SHADOW.card,
          animation:    'th-fade-in 0.2s ease',
        }}>
          {/* Animated scan header */}
          <div style={{
            display:        'flex',
            flexDirection:  'column',
            alignItems:     'center',
            gap:            16,
            marginBottom:   28,
          }}>
            <div style={{
              position:       'relative',
              width:          64,
              height:         64,
              display:        'flex',
              alignItems:     'center',
              justifyContent: 'center',
            }}>
              {/* Outer ring */}
              <div style={{
                position:    'absolute',
                inset:       0,
                borderRadius: '50%',
                border:      `2px solid ${C.accentLight}`,
              }} />
              <Spinner size={48} />
              {/* Inner icon */}
              <div style={{
                position: 'absolute',
                color:    C.accent,
              }}>
                <ScanIcon size={20} />
              </div>
            </div>

            <div style={{ textAlign: 'center' }}>
              <p style={{
                margin:     0,
                fontSize:   16,
                fontWeight: 800,
                color:      C.textMain,
                fontFamily: T.heading,
              }}>
                מזהה טקסט בתמונה…
              </p>
              <p style={{
                margin:     '4px 0 0',
                fontSize:   13,
                color:      C.textMuted,
                fontFamily: T.body,
              }}>
                Tesseract OCR — עברית + אנגלית
              </p>
            </div>
          </div>

          {/* Progress bar */}
          <ProgressBar
            value={ocrProgress.progress}
            label={ocrProgress.status}
          />

          {/* Privacy reminder during processing */}
          <div style={{
            marginTop:    20,
            display:      'flex',
            alignItems:   'center',
            justifyContent: 'center',
            gap:          6,
            fontSize:     12,
            color:        C.textLight,
            fontFamily:   T.body,
          }}>
            <LockIcon size={11} />
            הכל מעובד מקומית — ללא שרתים
          </div>
        </div>
      )}

      {phase === 'saved' && savedValue !== null && (
        /* ── SUCCESS STATE ── */
        <SuccessBanner value={savedValue} onReset={handleReset} />
      )}

      {/* ── Verify Modal (rendered at root level so it overlays the wizard) ── */}
      {phase === 'verify' && (
        <VerifyModal
          rawText={rawText}
          suggestedValue={suggestedVal}
          onConfirm={handleConfirm}
          onClose={handleModalClose}
        />
      )}

      {/* ── Footer Note ── */}
      {phase === 'idle' && (
        <p style={{
          marginTop:  14,
          fontSize:   11,
          color:      C.textLight,
          fontFamily: T.body,
          lineHeight: 1.6,
          textAlign:  'center',
        }}>
          לאחר הזיהוי תתבקשו לאמת ידנית את הערך לפני שמירתו.
          {' '}הנתונים לא יישמרו בשרת ויישארו במכשיר שלכם בלבד.
        </p>
      )}
    </div>
  )
}
