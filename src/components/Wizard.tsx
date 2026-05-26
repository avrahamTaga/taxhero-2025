/**
 * TaxHero 2025 — אשף מילוי הטופס (RTL עברית)
 * =============================================
 * טופס מודרך ב-4 שלבים שאוסף את כל שדות TaxDataInput
 * ומעדכן את Zustand דרך updateField.
 * כל הקלדה מפעילה חישוב מס מחדש באופן מיידי.
 *
 * מבנה השלבים:
 *   1. פרטים אישיים     — מין, תלויים, נכות
 *   2. הכנסות           — משכורת, הכנסות הון
 *   3. ניכויים וזיכויים — §5 + §6 בקובץ הכללים
 *   4. ניכוי במקור      — קודים 040 / 042 / 043
 */

import { useState } from 'react'
import { useTaxStore, useUpdateField } from '../store/useTaxStore'
import type {
  TaxDataInput,
  Gender,
  SoldierServiceType,
  AcademicDegreeType,
} from '../engine/taxCalculator'

// ─────────────────────────────────────────────────────────────────────────────
// סעיף 1 — טוקני עיצוב
// ─────────────────────────────────────────────────────────────────────────────

const C = {
  bg:          '#F4F1FC',
  card:        '#FFFFFF',
  border:      '#E8E3F5',
  borderFocus: '#7C3AED',
  textMain:    '#1C1027',
  textMuted:   '#7268A0',
  accent:      '#7C3AED',
  accentLight: '#EDE9FE',
  accentHover: '#6D28D9',
  stepDone:    '#059669',
  stepDoneBg:  '#D1FAE5',
  inputBg:     '#FAFAFA',
  danger:      '#DC2626',
  dangerBg:    '#FEF2F2',
  warn:        '#D97706',
  warnBg:      '#FFFBEB',
}

const T = {
  heading: "'Heebo', system-ui, sans-serif",
  body:    "'Assistant', system-ui, sans-serif",
}

// ─────────────────────────────────────────────────────────────────────────────
// סעיף 2 — פרימיטיבים לטופס
// ─────────────────────────────────────────────────────────────────────────────

function FieldGroup({
  label,
  hint,
  children,
  warn,
}: {
  label: string
  hint?: string
  children: React.ReactNode
  warn?: boolean
}) {
  return (
    <div style={{ marginBottom: 20 }}>
      <label
        style={{
          display: 'block',
          fontSize: 14,
          fontWeight: 700,
          color: warn ? C.warn : C.textMain,
          marginBottom: 2,
          fontFamily: T.body,
        }}
      >
        {label}
      </label>
      {hint && (
        <p
          style={{
            fontSize: 12,
            color: warn ? C.warn : C.textMuted,
            marginBottom: 6,
            lineHeight: 1.5,
            backgroundColor: warn ? C.warnBg : 'transparent',
            borderRadius: warn ? 6 : 0,
            padding: warn ? '4px 8px' : 0,
            border: warn ? `1px solid ${C.warn}44` : 'none',
          }}
        >
          {hint}
        </p>
      )}
      {children}
    </div>
  )
}

function NumberInput({
  value,
  onChange,
  placeholder = '0',
  suffix = '₪',
  min = 0,
  step = 1,
}: {
  value: number
  onChange: (v: number) => void
  placeholder?: string
  suffix?: string
  min?: number
  step?: number
}) {
  return (
    <div style={{ position: 'relative', display: 'flex', alignItems: 'center' }}>
      <input
        type="number"
        dir="ltr"
        value={value === 0 ? '' : value}
        placeholder={placeholder}
        min={min}
        step={step}
        onChange={(e) => {
          const v = parseFloat(e.target.value)
          onChange(isNaN(v) ? 0 : v)
        }}
        style={{
          width: '100%',
          padding: suffix ? '10px 36px 10px 12px' : '10px 12px',
          borderRadius: 8,
          border: `1.5px solid ${C.border}`,
          backgroundColor: C.inputBg,
          fontSize: 15,
          fontWeight: 500,
          color: C.textMain,
          fontFamily: T.body,
          outline: 'none',
          transition: 'border-color 0.15s',
          textAlign: 'left',
        }}
        onFocus={(e) => (e.currentTarget.style.borderColor = C.borderFocus)}
        onBlur={(e) => (e.currentTarget.style.borderColor = C.border)}
      />
      {suffix && (
        <span
          style={{
            position: 'absolute',
            left: 12,
            color: C.textMuted,
            fontSize: 14,
            pointerEvents: 'none',
            userSelect: 'none',
          }}
        >
          {suffix}
        </span>
      )}
    </div>
  )
}

function Toggle({
  value,
  onChange,
  label,
}: {
  value: boolean
  onChange: (v: boolean) => void
  label: string
}) {
  return (
    <label
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: 10,
        cursor: 'pointer',
        marginBottom: 14,
        userSelect: 'none',
      }}
    >
      {/* מתג */}
      <div
        onClick={() => onChange(!value)}
        style={{
          width: 44,
          height: 24,
          borderRadius: 12,
          backgroundColor: value ? C.accent : C.border,
          position: 'relative',
          transition: 'background-color 0.2s',
          flexShrink: 0,
        }}
      >
        <div
          style={{
            position: 'absolute',
            top: 3,
            right: value ? 3 : undefined,
            left: value ? undefined : 3,
            width: 18,
            height: 18,
            borderRadius: 9,
            backgroundColor: '#fff',
            boxShadow: '0 1px 4px rgba(0,0,0,0.18)',
            transition: 'left 0.2s, right 0.2s',
          }}
        />
      </div>
      <span style={{ fontSize: 14, color: C.textMain, fontFamily: T.body, lineHeight: 1.4 }}>
        {label}
      </span>
    </label>
  )
}

function RadioGroup<T extends string>({
  options,
  value,
  onChange,
}: {
  options: { value: T; label: string }[]
  value: T
  onChange: (v: T) => void
}) {
  return (
    <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
      {options.map((opt) => {
        const active = value === opt.value
        return (
          <button
            key={opt.value}
            type="button"
            onClick={() => onChange(opt.value)}
            style={{
              padding: '8px 16px',
              borderRadius: 8,
              border: `1.5px solid ${active ? C.accent : C.border}`,
              backgroundColor: active ? C.accentLight : C.card,
              color: active ? C.accent : C.textMuted,
              fontSize: 13,
              fontWeight: active ? 700 : 500,
              cursor: 'pointer',
              fontFamily: T.body,
              transition: 'all 0.15s',
            }}
          >
            {opt.label}
          </button>
        )
      })}
    </div>
  )
}

function Card({
  title,
  subtitle,
  children,
}: {
  title: string
  subtitle?: string
  children: React.ReactNode
}) {
  return (
    <div
      style={{
        backgroundColor: C.card,
        borderRadius: 14,
        border: `1px solid ${C.border}`,
        padding: '24px 24px 8px',
        marginBottom: 20,
        boxShadow: '0 2px 12px rgba(124,58,237,0.04)',
      }}
    >
      <div style={{ marginBottom: 18 }}>
        <h3
          style={{
            fontSize: 16,
            fontWeight: 800,
            color: C.textMain,
            fontFamily: T.heading,
            margin: 0,
          }}
        >
          {title}
        </h3>
        {subtitle && (
          <p style={{ fontSize: 12, color: C.textMuted, marginTop: 3 }}>{subtitle}</p>
        )}
      </div>
      {children}
    </div>
  )
}

function Divider() {
  return (
    <div
      style={{
        height: 1,
        backgroundColor: C.border,
        margin: '16px 0',
      }}
    />
  )
}

function InfoBox({ children }: { children: React.ReactNode }) {
  return (
    <div
      style={{
        backgroundColor: C.accentLight,
        border: `1px solid #DDD6FE`,
        borderRadius: 10,
        padding: '12px 16px',
        fontSize: 13,
        color: C.accent,
        lineHeight: 1.6,
        marginBottom: 16,
      }}
    >
      {children}
    </div>
  )
}

// ─────────────────────────────────────────────────────────────────────────────
// סעיף 3 — שלבי תוכן
// ─────────────────────────────────────────────────────────────────────────────

// ── שלב 1: פרטים אישיים ──────────────────────────────────────────────────

function StepPersonal({
  data,
  update,
}: {
  data: TaxDataInput
  update: <K extends keyof TaxDataInput>(key: K, value: TaxDataInput[K]) => void
}) {
  return (
    <div>
      <Card title="פרטי הנישום" subtitle="קובע את נקודות הזיכוי הבסיסיות">
        <FieldGroup
          label="מין הנישום"
          hint="גבר: 2.25 נקודות זיכוי. אישה: 2.75 נקודות זיכוי (כולל 0.5 נקודה נוספת לאישה)."
        >
          <RadioGroup<Gender>
            value={data.gender}
            onChange={(v) => update('gender', v)}
            options={[
              { value: 'male',   label: 'גבר' },
              { value: 'female', label: 'אישה' },
            ]}
          />
        </FieldGroup>

        <Divider />

        <Toggle
          value={data.isSingleParent}
          onChange={(v) => update('isSingleParent', v)}
          label="הורה יחידני (קוד 026) — נקודת זיכוי נוספת"
        />

        <Toggle
          value={data.isIsraeliResident}
          onChange={(v) => update('isIsraeliResident', v)}
          label="תושב/ת ישראל — זכאי/ת לנקודת זיכוי לנסיעה לעבודה (0.25)"
        />
      </Card>

      {/* ילדים */}
      <Card title="ילדים" subtitle="גילאי הילדים נכון לשנת המס 2025">
        <FieldGroup
          label="גילאי הילדים (מופרדים בפסיק)"
          hint="לדוגמה: 0, 3, 7, 14 — כל גיל מחושב לפי טבלת נקודות הזיכוי המתאימה."
        >
          <input
            dir="ltr"
            type="text"
            placeholder="לדוגמה: 2, 5, 10"
            defaultValue={data.childrenAges.join(', ')}
            onBlur={(e) => {
              const ages = e.target.value
                .split(',')
                .map((s) => parseInt(s.trim(), 10))
                .filter((n) => !isNaN(n) && n >= 0)
              update('childrenAges', ages)
            }}
            style={{
              width: '100%',
              padding: '10px 12px',
              borderRadius: 8,
              border: `1.5px solid ${C.border}`,
              backgroundColor: C.inputBg,
              fontSize: 14,
              fontFamily: T.body,
              color: C.textMain,
              outline: 'none',
              textAlign: 'left',
            }}
            onFocus={(e) => (e.currentTarget.style.borderColor = C.borderFocus)}
            onBlur_={(e) => (e.currentTarget.style.borderColor = C.border)}
          />
        </FieldGroup>

        <FieldGroup
          label="מספר ילדים עם מוגבלות (קודים 131 / 023)"
          hint="2 נקודות זיכוי לכל ילד. מוגבל בתקרת הכנסה: מעל ₪301,000 (זוג) / ₪188,000 (יחיד) — אין זיכוי."
        >
          <NumberInput
            value={data.disabledChildrenCount131_023}
            onChange={(v) => update('disabledChildrenCount131_023', Math.round(v))}
            suffix=""
            placeholder="0"
          />
        </FieldGroup>
      </Card>

      {/* שירות צבאי ולימודים */}
      <Card title="שחרור מצה״ל ותואר אקדמי" subtitle="זיכויים זמניים מבוססי תקופה">
        <FieldGroup
          label="סוג שירות צבאי (קודים 324 / 224 / 124 / 024)"
          hint="תקף עד 36 חודשים ממועד השחרור. שירות מלא (גבר 23+ חודשים / אישה 22+): 1/6 נקודה לחודש. שירות חלקי: 1/12 נקודה לחודש."
        >
          <RadioGroup<SoldierServiceType>
            value={data.dischargedSoldierService}
            onChange={(v) => update('dischargedSoldierService', v)}
            options={[
              { value: 'none',    label: 'לא רלוונטי' },
              { value: 'partial', label: 'שירות חלקי' },
              { value: 'full',    label: 'שירות מלא' },
            ]}
          />
        </FieldGroup>

        {data.dischargedSoldierService !== 'none' && (
          <FieldGroup
            label="מספר חודשים שחלפו ממועד השחרור (עד 36 חודשים)"
            hint="טווח תקף: 1–36 חודשים."
          >
            <NumberInput
              value={data.dischargedSoldierMonthsElapsed}
              onChange={(v) => update('dischargedSoldierMonthsElapsed', Math.round(Math.min(36, Math.max(0, v))))}
              suffix=""
              placeholder="0"
            />
          </FieldGroup>
        )}

        <Divider />

        <FieldGroup
          label="תואר אקדמי (קודים 181 / 182)"
          hint="תואר ראשון: 1 נקודה לשנה (עד 3 שנים). תואר שני: 0.5 נקודה לשנה (עד 2 שנים). מד״ר / רפואה: ראשון ואז שני."
        >
          <RadioGroup<AcademicDegreeType>
            value={data.academicDegreeType}
            onChange={(v) => update('academicDegreeType', v)}
            options={[
              { value: 'none',   label: 'ללא תואר' },
              { value: 'ba',     label: 'תואר ראשון (B.A)' },
              { value: 'ma',     label: 'תואר שני (M.A)' },
              { value: 'phd_md', label: 'דוקטורט / רפואה' },
            ]}
          />
        </FieldGroup>

        {data.academicDegreeType !== 'none' && (
          <FieldGroup
            label="מספר שנות לימוד שחלפו מאז הסיום (שנת הסיום + 1)"
            hint="הזיכוי מתחיל בשנה שלאחר הסיום."
          >
            <NumberInput
              value={data.academicDegreeYearsElapsed}
              onChange={(v) => update('academicDegreeYearsElapsed', Math.round(v))}
              suffix=""
              placeholder="0"
            />
          </FieldGroup>
        )}
      </Card>

      {/* עולה חדש */}
      <Card title="עולה חדש" subtitle="זיכוי מס לפי חוק עידוד עלייה">
        <Toggle
          value={data.isOlehChadash}
          onChange={(v) => update('isOlehChadash', v)}
          label="עולה חדש — זכאי/ת לזיכוי מס בשנות קליטה"
        />
        {data.isOlehChadash && (
          <FieldGroup
            label="מספר חודשים שחלפו מאז העלייה"
            hint="טווח תקף: 1–54 חודשים (4.5 שנות הקליטה)."
          >
            <NumberInput
              value={data.olehChadashMonthsElapsed}
              onChange={(v) =>
                update('olehChadashMonthsElapsed', Math.round(Math.min(54, Math.max(0, v))))}
              suffix=""
              placeholder="0"
            />
          </FieldGroup>
        )}
      </Card>
    </div>
  )
}

// ── שלב 2: הכנסות ─────────────────────────────────────────────────────────

function StepIncome({
  data,
  update,
}: {
  data: TaxDataInput
  update: <K extends keyof TaxDataInput>(key: K, value: TaxDataInput[K]) => void
}) {
  const n =
    <K extends keyof TaxDataInput>(key: K) =>
    (v: number) =>
      update(key, v as TaxDataInput[K])

  return (
    <div>
      <InfoBox>
        💡 הזינו את הסכומים השנתיים ברוטו כפי שמופיעים בטופס 106 שקיבלתם ממעסיקיכם.
        כל הערכים בשקלים חדשים (₪).
      </InfoBox>

      {/* הכנסת עבודה */}
      <Card title="הכנסות מעבודה ועסק" subtitle="הכנסה מיגיעה אישית — ממוסה בשיעורי מס שולי">
        <FieldGroup
          label="הכנסה ברוטו (קוד 158)"
          hint="סך המשכורת הגולמית השנתית של הנישום המדווח — כולל בונוסים ותשלומים נוספים."
        >
          <NumberInput value={data.grossSalary158} onChange={n('grossSalary158')} />
        </FieldGroup>

        <FieldGroup
          label="הכנסה ברוטו — בן/בת זוג לא מדווח/ת (קוד 172)"
          hint="הכנסת בן/בת הזוג שאינו/ה מגיש/ה דוח נפרד. משפיעה על חישוב הכנסה משפחתית כוללת."
        >
          <NumberInput value={data.grossSalary172} onChange={n('grossSalary172')} />
        </FieldGroup>

        <FieldGroup
          label="הכנסות אחרות מיגיעה אישית (קודים 150 / 170)"
          hint="הכנסות ממחבר, מרצה, דירקטור וכד׳ — הכנסה שאינה ממשכורת רגילה."
        >
          <NumberInput value={data.otherPersonalExertionIncome150_170} onChange={n('otherPersonalExertionIncome150_170')} />
        </FieldGroup>

        <FieldGroup
          label="מענקי פרישה / פנסיה חייבים במס (קודים 258 / 272)"
          hint="כפוף לתקרת מס אפקטיבי של 40% כאשר סך ההכנסה הגולמית נמוכה מ-₪560,280."
        >
          <NumberInput value={data.severancePension258_272} onChange={n('severancePension258_272')} />
        </FieldGroup>

        <FieldGroup
          label="גמלאות ביטוח לאומי חייבות במס (קודים 250 / 270 / 194 / 196)"
          hint="דמי לידה, מילואים, דמי אבטלה — הסכום החייב במס כפי שדווח על ידי ביטוח לאומי."
        >
          <NumberInput value={data.bituachLeumiTaxableBenefits250_270} onChange={n('bituachLeumiTaxableBenefits250_270')} />
        </FieldGroup>
      </Card>

      {/* הכנסות הון */}
      <Card title="הכנסות הון ורכוש" subtitle="ממוסות בשיעורי מס קבועים — ללא מדרגות מס">
        <FieldGroup
          label="דמי שכירות מדירת מגורים (קוד 222)"
          hint="שיעור מס קבוע: 10%. מגבלות תחולה — ראו הנחיות פקיד השומה."
        >
          <NumberInput value={data.residentialRentIncome222} onChange={n('residentialRentIncome222')} />
        </FieldGroup>

        <FieldGroup
          label="ריבית / דיבידנד — שיעור 15% (קוד 060)"
          hint="ריבית על פיקדונות בנקאיים ודיבידנד ממניות בישראל — שיעור מס 15%."
        >
          <NumberInput value={data.interestDividends060} onChange={n('interestDividends060')} />
        </FieldGroup>

        <FieldGroup
          label="ריבית / דיבידנד — שיעור 20% (קודים 067 / 126)"
          hint="שיעור מס 20%."
        >
          <NumberInput value={data.interestDividends067_126} onChange={n('interestDividends067_126')} />
        </FieldGroup>

        <FieldGroup
          label="ריבית / דיבידנד — שיעור 25% (קודים 157 / 141 / 142)"
          hint="שיעור מס 25%."
        >
          <NumberInput value={data.interestDividends157_141_142} onChange={n('interestDividends157_141_142')} />
        </FieldGroup>

        <FieldGroup
          label="ריבית — שיעור 35% (קוד 050)"
          hint="שיעור מס 35%."
        >
          <NumberInput value={data.interest050} onChange={n('interest050')} />
        </FieldGroup>

        <FieldGroup
          label="הכנסה מייצור חשמל מאנרגיה מתחדשת (קוד 335)"
          hint="סכום ראשון עד ₪25,200 — פטור ממס. היתרה ממוסה בשיעור 31%."
        >
          <NumberInput value={data.renewableEnergyRent335} onChange={n('renewableEnergyRent335')} />
        </FieldGroup>

        <FieldGroup
          label="הימורים, הגרלות ופרסים (קוד 227)"
          hint="⚠️ שיעור מס לא מוגדר בכללי 2025 — מוזן לצרכי תיעוד בלבד, לא נכלל בחישוב."
          warn
        >
          <NumberInput
            value={data.gamblingLotteryIncome227}
            onChange={n('gamblingLotteryIncome227')}
          />
        </FieldGroup>
      </Card>
    </div>
  )
}

// ── שלב 3: ניכויים וזיכויים ───────────────────────────────────────────────

function StepDeductionsCredits({
  data,
  update,
}: {
  data: TaxDataInput
  update: <K extends keyof TaxDataInput>(key: K, value: TaxDataInput[K]) => void
}) {
  const n =
    <K extends keyof TaxDataInput>(key: K) =>
    (v: number) =>
      update(key, v as TaxDataInput[K])

  return (
    <div>
      {/* ניכויים */}
      <Card
        title="ניכויים מהכנסה חייבת (§5)"
        subtitle="מפחיתים את ההכנסה החייבת לפני חישוב המס"
      >
        <FieldGroup
          label="פרמיית ביטוח אובדן כושר עבודה (קודים 112 / 113)"
          hint="ניכוי מקסימלי: 3.5% מהמשכורת, עד משכורת של ₪376,080. מצטמצם או מתאפס לפי שיעור הפרשת מעביד לפנסיה."
        >
          <NumberInput
            value={data.lossOfEarningPremium112_113}
            onChange={n('lossOfEarningPremium112_113')}
          />
        </FieldGroup>

        {data.lossOfEarningPremium112_113 > 0 && (
          <FieldGroup
            label="אחוז הפרשת מעביד לפנסיה (%)"
            hint="מעל 7.5% — הניכוי לביטוח אובדן כושר עבודה מתאפס לחלוטין."
          >
            <NumberInput
              value={data.employerPensionContributionPercent}
              onChange={n('employerPensionContributionPercent')}
              suffix="%"
              min={0}
              step={0.1}
              placeholder="0.0"
            />
          </FieldGroup>
        )}

        <Divider />

        <FieldGroup
          label="קרן פנסיה / קופת גמל כעצמאי (קודים 135 / 180)"
          hint="ניכוי עד 11% מההכנסה. תקרת ניכוי: ₪11,880 בשנת 2025."
        >
          <NumberInput
            value={data.providentFundIndependent135_180}
            onChange={n('providentFundIndependent135_180')}
          />
        </FieldGroup>

        <Divider />

        <FieldGroup
          label="תשלומי ביטוח לאומי כעצמאי (קודים 030 / 089)"
          hint="52% מהסכום ששולם (לא כולל קנסות ודמי ביטוח בריאות) מותרים בניכוי."
        >
          <NumberInput
            value={data.bituachLeumiIndependent030_089}
            onChange={n('bituachLeumiIndependent030_089')}
          />
        </FieldGroup>
      </Card>

      {/* זיכויים */}
      <Card
        title="זיכויים מיוחדים (§6)"
        subtitle="מפחיתים את המס המחושב בפועל"
      >
        <FieldGroup
          label="תרומות לפי סעיף 46 (קודים 037 / 237)"
          hint="מינימום תרומה: ₪207. זיכוי מס ישיר: 35% מסכום התרומה. תקרה: 30% מההכנסה החייבת או ₪10,354,846."
        >
          <NumberInput value={data.donations037_237} onChange={n('donations037_237')} />
        </FieldGroup>

        <Divider />

        <FieldGroup
          label="הכנסה ממשמרות בתעשייה (קודים 068 / 069)"
          hint="זיכוי מס ישיר: 15% מהכנסת המשמרות. הכנסה מקסימלית לחישוב: ₪143,040. זיכוי מקסימלי: ₪12,540."
        >
          <NumberInput value={data.shiftWorkIncome068_069} onChange={n('shiftWorkIncome068_069')} />
        </FieldGroup>

        <Divider />

        <FieldGroup
          label="הוצאות החזקת קרוב מוסד (קודים 132 / 232)"
          hint="זיכוי של 35% על ההוצאות שמעל 12.5% מההכנסה החייבת. אינו מצטבר עם זיכוי ילד נכה."
        >
          <NumberInput
            value={data.institutionMaintenanceExpenses132_232}
            onChange={n('institutionMaintenanceExpenses132_232')}
          />
        </FieldGroup>

        <Divider />

        <FieldGroup
          label="פרמיית ביטוח חיים — מרכיב סיכון (קודים 036 / 081)"
          hint="זיכוי מס ישיר: 25% מהפרמיה ששולמה (מרכיב הסיכון בלבד)."
        >
          <NumberInput value={data.lifeInsurancePremium036_081} onChange={n('lifeInsurancePremium036_081')} />
        </FieldGroup>

        <FieldGroup
          label="ביטוח פנסיוני / שאירים (קודים 140 / 240 / 045 / 086)"
          hint="זיכוי מס ישיר: 35% מהסכום ששולם."
        >
          <NumberInput
            value={data.pensionSurvivorsInsurance140_240}
            onChange={n('pensionSurvivorsInsurance140_240')}
          />
        </FieldGroup>
      </Card>

      {/* זיכויים גיאוגרפיים */}
      <Card title="זיכויים לפי מיקום ותעסוקה">
        <Toggle
          value={data.isEilatResident}
          onChange={(v) => update('isEilatResident', v)}
          label="תושב/ת אילת — זיכוי 10% על הכנסה מיגיעה אישית (קודים 139 / 183)"
        />

        {data.isEilatResident && (
          <div style={{ marginTop: 12 }}>
            <FieldGroup
              label="הכנסה מיגיעה אישית שהופקה באילת"
              hint="הכנסה מוגבלת לחישוב עד ₪268,560."
            >
              <NumberInput
                value={data.eilatIncome139_183}
                onChange={n('eilatIncome139_183')}
              />
            </FieldGroup>
          </div>
        )}

        <Divider />

        <FieldGroup
          label="שכר כוחות הביטחון — רמת פעילות א׳"
          hint="זיכוי מס ישיר: 5% על השכר. שכר מוגבל לחישוב עד ₪178,320."
        >
          <NumberInput
            value={data.securityForcesActivityASalary}
            onChange={n('securityForcesActivityASalary')}
          />
        </FieldGroup>
      </Card>
    </div>
  )
}

// ── שלב 4: ניכוי מס במקור ─────────────────────────────────────────────────

function StepWithheld({
  data,
  update,
}: {
  data: TaxDataInput
  update: <K extends keyof TaxDataInput>(key: K, value: TaxDataInput[K]) => void
}) {
  const n =
    <K extends keyof TaxDataInput>(key: K) =>
    (v: number) =>
      update(key, v as TaxDataInput[K])

  return (
    <div>
      <Card title="מס שנוכה במקור (ניכוי במקור)" subtitle="קודים 040 / 042 / 043">
        <InfoBox>
          💡 הזינו את סכומי המס שכבר נוכו מתשלומיכם על ידי המעסיק או הבנק.
          סכומים אלו מפחיתים את היתרה הסופית — תשלום יתר מביא להחזר מס,
          תשלום חסר יביא לחוב מס.
        </InfoBox>

        <FieldGroup
          label="מס שנוכה במקור ממשכורת (קוד 042)"
          hint="כפי שמופיע בשדה 042 בטופס 106 שקיבלתם מהמעסיק."
        >
          <NumberInput
            value={data.taxWithheldSalary042}
            onChange={n('taxWithheldSalary042')}
          />
        </FieldGroup>

        <FieldGroup
          label="מס שנוכה במקור מהכנסות אחרות (קוד 040)"
          hint="ניכוי מס ממשלמים אחרים שאינם המעסיק הראשי."
        >
          <NumberInput
            value={data.taxWithheldOther040}
            onChange={n('taxWithheldOther040')}
          />
        </FieldGroup>

        <FieldGroup
          label="מס שנוכה במקור מריבית / פיקדונות (קוד 043)"
          hint="ניכוי מס על ריבית בחשבונות בנק, פיקדונות ותוכניות חיסכון."
        >
          <NumberInput
            value={data.taxWithheldInterest043}
            onChange={n('taxWithheldInterest043')}
          />
        </FieldGroup>
      </Card>

      {/* סיכום שלב */}
      <div
        style={{
          backgroundColor: C.stepDoneBg,
          borderRadius: 14,
          padding: '20px 24px',
          border: `1px solid ${C.stepDone}44`,
          textAlign: 'center',
        }}
      >
        <div style={{ fontSize: 28, marginBottom: 8 }}>✅</div>
        <h3
          style={{
            fontSize: 16,
            fontWeight: 800,
            color: C.stepDone,
            fontFamily: T.heading,
            marginBottom: 6,
          }}
        >
          כל הנתונים הוזנו
        </h3>
        <p style={{ fontSize: 13, color: '#065F46', lineHeight: 1.6 }}>
          בדקו את סיכום החישוב בפאנל השמאלי. כל החישובים מבוצעים לפי
          כללי רשות המסים לשנת המס 2025.
        </p>
      </div>
    </div>
  )
}

// ─────────────────────────────────────────────────────────────────────────────
// סעיף 4 — מעטפת האשף
// ─────────────────────────────────────────────────────────────────────────────

const STEPS = [
  { id: 1, title: 'פרטים אישיים',    subtitle: 'Your Profile' },
  { id: 2, title: 'הכנסות',          subtitle: 'Income' },
  { id: 3, title: 'ניכויים וזיכויים', subtitle: 'Deductions & Credits' },
  { id: 4, title: 'ניכוי במקור',     subtitle: 'Tax Withheld' },
]

export default function Wizard() {
  const [step, setStep] = useState(1)
  const { formData, resetForm } = useTaxStore()
  const updateField = useUpdateField()

  const isFirst = step === 1
  const isLast  = step === STEPS.length

  return (
    <div
      style={{
        fontFamily: T.body,
        maxWidth: 680,
        marginInlineStart: 'auto',
        marginInlineEnd: 'auto',
      }}
    >
      {/* ── מחוון שלבים ────────────────────────────────────────────────── */}
      <div style={{ marginBottom: 32 }}>
        <div
          style={{
            display: 'flex',
            alignItems: 'flex-start',
            gap: 0,
            position: 'relative',
          }}
        >
          {/* קו התקדמות רקע */}
          <div
            style={{
              position: 'absolute',
              top: 16,
              insetInlineStart: 20,
              insetInlineEnd: 20,
              height: 2,
              backgroundColor: C.border,
              zIndex: 0,
            }}
          />
          {/* קו התקדמות פעיל */}
          <div
            style={{
              position: 'absolute',
              top: 16,
              // In RTL, progress fills from the right
              insetInlineEnd: 20,
              height: 2,
              width: `calc(${((step - 1) / (STEPS.length - 1)) * 100}% - 0px)`,
              backgroundColor: C.accent,
              zIndex: 1,
              transition: 'width 0.35s ease',
            }}
          />

          {/* שלבים */}
          {STEPS.map((s) => {
            const isDone   = step > s.id
            const isActive = step === s.id
            return (
              <div
                key={s.id}
                style={{
                  flex: 1,
                  display: 'flex',
                  flexDirection: 'column',
                  alignItems: 'center',
                  position: 'relative',
                  zIndex: 2,
                  cursor: isDone ? 'pointer' : 'default',
                }}
                onClick={() => isDone && setStep(s.id)}
              >
                <div
                  style={{
                    width: 34,
                    height: 34,
                    borderRadius: 17,
                    backgroundColor: isDone ? C.stepDone : isActive ? C.accent : C.card,
                    border: `2px solid ${
                      isDone ? C.stepDone : isActive ? C.accent : C.border
                    }`,
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    fontSize: isDone ? 15 : 13,
                    fontWeight: 800,
                    color: isDone || isActive ? '#fff' : C.textMuted,
                    transition: 'all 0.2s',
                    boxShadow: isActive ? `0 0 0 5px ${C.accent}22` : 'none',
                  }}
                >
                  {isDone ? '✓' : s.id}
                </div>
                <p
                  style={{
                    fontSize: 12,
                    fontWeight: isActive ? 800 : 500,
                    color: isActive ? C.accent : isDone ? C.textMain : C.textMuted,
                    marginTop: 7,
                    textAlign: 'center',
                    lineHeight: 1.3,
                    maxWidth: 88,
                  }}
                >
                  {s.title}
                </p>
                <p style={{ fontSize: 10, color: C.textMuted, marginTop: 1, textAlign: 'center' }}>
                  {s.subtitle}
                </p>
              </div>
            )
          })}
        </div>
      </div>

      {/* ── כותרת שלב ────────────────────────────────────────────────────── */}
      <div style={{ marginBottom: 22 }}>
        <h2
          style={{
            fontSize: 26,
            fontWeight: 900,
            color: C.textMain,
            fontFamily: T.heading,
            margin: 0,
            letterSpacing: '-0.4px',
          }}
        >
          {STEPS[step - 1].title}
        </h2>
        <p style={{ fontSize: 13, color: C.textMuted, marginTop: 4 }}>
          שלב {step} מתוך {STEPS.length}
          {' · '}
          {STEPS[step - 1].subtitle}
        </p>
      </div>

      {/* ── תוכן השלב ─────────────────────────────────────────────────────── */}
      <div>
        {step === 1 && <StepPersonal data={formData} update={updateField} />}
        {step === 2 && <StepIncome   data={formData} update={updateField} />}
        {step === 3 && <StepDeductionsCredits data={formData} update={updateField} />}
        {step === 4 && <StepWithheld data={formData} update={updateField} />}
      </div>

      {/* ── ניווט ──────────────────────────────────────────────────────────── */}
      <div
        style={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          marginTop: 8,
          paddingTop: 20,
          borderTop: `1px solid ${C.border}`,
        }}
      >
        {/* כפתורי ניווט לאחור + איפוס */}
        <div style={{ display: 'flex', gap: 8 }}>
          {!isFirst && (
            <button
              type="button"
              onClick={() => setStep((s) => s - 1)}
              style={{
                padding: '10px 20px',
                borderRadius: 8,
                border: `1.5px solid ${C.border}`,
                backgroundColor: C.card,
                color: C.textMain,
                fontSize: 14,
                fontWeight: 700,
                cursor: 'pointer',
                fontFamily: T.body,
                display: 'flex',
                alignItems: 'center',
                gap: 6,
              }}
            >
              {/* חץ ימינה ב-RTL = חזרה */}
              ← הקודם
            </button>
          )}
          <button
            type="button"
            onClick={resetForm}
            style={{
              padding: '10px 16px',
              borderRadius: 8,
              border: `1.5px solid ${C.border}`,
              backgroundColor: 'transparent',
              color: C.textMuted,
              fontSize: 13,
              cursor: 'pointer',
              fontFamily: T.body,
            }}
          >
            אפס הכל
          </button>
        </div>

        {/* כפתור קדימה / סיום */}
        {!isLast ? (
          <button
            type="button"
            onClick={() => setStep((s) => s + 1)}
            style={{
              padding: '10px 28px',
              borderRadius: 8,
              border: 'none',
              background: `linear-gradient(135deg, ${C.accent} 0%, #A855F7 100%)`,
              color: '#fff',
              fontSize: 14,
              fontWeight: 800,
              cursor: 'pointer',
              fontFamily: T.body,
              boxShadow: '0 4px 14px rgba(124,58,237,0.35)',
              transition: 'transform 0.1s, box-shadow 0.1s',
              display: 'flex',
              alignItems: 'center',
              gap: 6,
            }}
            onMouseDown={(e) => {
              ;(e.currentTarget as HTMLButtonElement).style.transform = 'scale(0.97)'
            }}
            onMouseUp={(e) => {
              ;(e.currentTarget as HTMLButtonElement).style.transform = 'scale(1)'
            }}
          >
            הבא →
          </button>
        ) : (
          <span
            style={{
              fontSize: 13,
              color: C.stepDone,
              fontWeight: 700,
              background: C.stepDoneBg,
              padding: '9px 16px',
              borderRadius: 8,
              border: `1px solid ${C.stepDone}44`,
            }}
          >
            ✓ כל השלבים הושלמו — ראו סיכום ←
          </span>
        )}
      </div>
    </div>
  )
}
