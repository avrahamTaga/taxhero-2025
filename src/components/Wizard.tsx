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
 *
 * FIXES APPLIED
 * ─────────────
 * FIX-1  grossSalary158              → grossIncome158
 * FIX-2  grossSalary172              → grossIncome172
 * FIX-3  otherPersonalExertionIncome150_170 → otherPersonalIncome150_170
 * FIX-4  bituachLeumiTaxableBenefits250_270 → bituachLeumiIncome250_270_194_196
 * FIX-5  isIsraeliResident REMOVED   — the travel-to-work credit (0.25 pt) is
 *         a statutory universal entitlement applied automatically by the engine
 *         for every Israeli taxpayer.  There is no toggle in the rules document.
 * FIX-6  onBlur_ typo                → onBlur (children-ages text input)
 */

import { useState } from 'react'
import { useTaxStore, useUpdateField } from '../store/useTaxStore'
import type {
  TaxDataInput,
  Gender,
  SoldierServiceType,
  AcademicDegreeType,
} from '../engine/taxCalculator'
import OcrUploader from './OcrUploader';

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
          const raw = parseFloat(e.target.value)
          onChange(isNaN(raw) ? 0 : raw)
        }}
        style={{
          width: '100%',
          padding: '10px 40px 10px 12px',
          borderRadius: 8,
          border: `1.5px solid ${C.border}`,
          backgroundColor: C.inputBg,
          fontSize: 15,
          fontFamily: T.body,
          color: C.textMain,
          outline: 'none',
          textAlign: 'left',
          appearance: 'textfield',
          MozAppearance: 'textfield',
        } as React.CSSProperties}
        onFocus={(e) => (e.currentTarget.style.borderColor = C.borderFocus)}
        onBlur={(e) => (e.currentTarget.style.borderColor = C.border)}
      />
      {suffix && (
        <span
          style={{
            position: 'absolute',
            insetInlineEnd: 12,
            fontSize: 14,
            color: C.textMuted,
            pointerEvents: 'none',
            fontFamily: T.body,
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
        marginBottom: 16,
        fontFamily: T.body,
        fontSize: 14,
        color: C.textMain,
        userSelect: 'none',
      }}
    >
      <div
        onClick={() => onChange(!value)}
        style={{
          width: 42,
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
            insetInlineStart: value ? 21 : 3,
            width: 18,
            height: 18,
            borderRadius: 9,
            backgroundColor: '#fff',
            transition: 'inset-inline-start 0.2s',
            boxShadow: '0 1px 3px rgba(0,0,0,0.2)',
          }}
        />
      </div>
      {label}
    </label>
  )
}

function RadioGroup<T extends string>({
  value,
  onChange,
  options,
}: {
  value: T
  onChange: (v: T) => void
  options: { value: T; label: string }[]
}) {
  return (
    <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap' }}>
      {options.map((o) => (
        <label
          key={o.value}
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 6,
            cursor: 'pointer',
            padding: '8px 16px',
            borderRadius: 8,
            border: `1.5px solid ${value === o.value ? C.accent : C.border}`,
            backgroundColor: value === o.value ? C.accentLight : C.inputBg,
            fontFamily: T.body,
            fontSize: 14,
            color: value === o.value ? C.accent : C.textMain,
            fontWeight: value === o.value ? 700 : 400,
            transition: 'all 0.15s',
          }}
        >
          <input
            type="radio"
            name={o.value}
            checked={value === o.value}
            onChange={() => onChange(o.value)}
            style={{ display: 'none' }}
          />
          {o.label}
        </label>
      ))}
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
        padding: '24px 28px',
        marginBottom: 20,
        boxShadow: '0 2px 8px rgba(124,58,237,0.04)',
      }}
    >
      <div style={{ marginBottom: 20 }}>
        <h3
          style={{
            margin: 0,
            fontSize: 16,
            fontWeight: 700,
            color: C.textMain,
            fontFamily: T.heading,
          }}
        >
          {title}
        </h3>
        {subtitle && (
          <p
            style={{
              margin: '4px 0 0',
              fontSize: 12,
              color: C.textMuted,
              fontFamily: T.body,
            }}
          >
            {subtitle}
          </p>
        )}
      </div>
      {children}
    </div>
  )
}

function Divider() {
  return (
    <hr
      style={{
        border: 'none',
        borderTop: `1px solid ${C.border}`,
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
        border: `1px solid ${C.accent}44`,
        borderRadius: 10,
        padding: '12px 16px',
        marginBottom: 20,
        fontSize: 13,
        color: C.accent,
        fontFamily: T.body,
        lineHeight: 1.6,
      }}
    >
      {children}
    </div>
  )
}

// ─────────────────────────────────────────────────────────────────────────────
// סעיף 3 — רכיבי שלבים
// ─────────────────────────────────────────────────────────────────────────────

// ── שלב 1: פרטים אישיים ───────────────────────────────────────────────────

function StepPersonal({
  data,
  update,
}: {
  data: TaxDataInput
  update: <K extends keyof TaxDataInput>(key: K, value: TaxDataInput[K]) => void
}) {
  return (
    <div>
      <InfoBox>
        💡 פרטים אלו קובעים את נקודות הזיכוי הבסיסיות שלכם לשנת המס 2025.
        כל הנתונים מעובדים מקומית בדפדפן — לא נשמר שום מידע בשרת.
      </InfoBox>

      {/* פרופיל */}
      <Card title="פרופיל הנישום" subtitle="קובע את נקודות הזיכוי הבסיסיות">
        <FieldGroup
          label="מין (§2 — נקודות זיכוי בסיסיות)"
          hint="גבר: 2.25 נקודות זיכוי בסיסיות. אישה: 2.75 נקודות זיכוי (כולל 0.5 נקודה נוספת לאישה)."
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

        {/*
         * FIX-5: The `isIsraeliResident` toggle has been REMOVED.
         *
         * The travel-to-work credit (0.25 credit points, §2) is a universal
         * statutory entitlement granted automatically to every Israeli taxpayer.
         * The tax engine applies it unconditionally via the `TRAVEL_TO_WORK_POINTS`
         * constant — there is no `isIsraeliResident` field in `TaxDataInput` and
         * no toggle is needed in the UI.
         *
         * If non-resident taxation is ever required, a dedicated engine path
         * must first be added to `taxCalculator.ts`.
         */}

        <Divider />

        <Toggle
          value={data.isSingleParent}
          onChange={(v) => update('isSingleParent', v)}
          label="הורה יחידני (קוד 026) — נקודת זיכוי נוספת"
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
            onBlur={(e) => {
              e.currentTarget.style.borderColor = C.border
              const ages = e.target.value
                .split(',')
                .map((s) => parseInt(s.trim(), 10))
                .filter((n) => !isNaN(n) && n >= 0)
              update('childrenAges', ages)
            }}
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

        {data.disabledChildrenCount131_023 > 0 && (
          <FieldGroup
            label="סך הכנסת המשק בית לצורך בדיקת תקרה (ילד נכה)"
            hint="הכנסת הנישום + בן/בת הזוג. תקרה: ₪301,000 (זוג) / ₪188,000 (הורה יחיד). מעל התקרה — אין זיכוי."
          >
            <NumberInput
              value={data.totalHouseholdIncomeForDisabledChild}
              onChange={(v) => update('totalHouseholdIncomeForDisabledChild', v)}
            />
          </FieldGroup>
        )}
      </Card>

      {/* נכות */}
      <Card title="נכות ועיוורון" subtitle="פטור ממס על הכנסה מיגיעה אישית — §7 קודים 109 / 309">
        <Toggle
          value={data.isFullDisability}
          onChange={(v) => update('isFullDisability', v)}
          label="נכות מלאה 100% או עיוורון — פטור ממס עד ₪445,200"
        />

        {data.isFullDisability && (
          <>
            <Divider />
            <Toggle
              value={data.isModDefenseOrTerrorVictim}
              onChange={(v) => update('isModDefenseOrTerrorVictim', v)}
              label="נפגע/ת משרד הביטחון / טרור — תקרת הפטור מועלית ל-₪684,000"
            />
          </>
        )}
      </Card>

      {/* שירות צבאי ולימודים */}
      <Card title="שחרור מצה״ל ותואר אקדמי" subtitle="זיכויים זמניים מבוססי תקופה">
        <FieldGroup
          label="סוג שירות צבאי (קודים 324 / 224 / 124 / 024)"
          hint="תקף עד 36 חודשים ממועד השחרור. שירות מלא (גבר 23+ חודשים / אישה 22+): 1/6 נקודה לחודש. שירות חלקי: 1/12 נקודה לחודש."
        >
          <RadioGroup<SoldierServiceType>
            value={data.soldierServiceType}
            onChange={(v) => update('soldierServiceType', v)}
            options={[
              { value: 'none',    label: 'לא רלוונטי' },
              { value: 'partial', label: 'שירות חלקי' },
              { value: 'full',    label: 'שירות מלא' },
            ]}
          />
        </FieldGroup>

        {data.soldierServiceType !== 'none' && (
          <FieldGroup
            label="חודשים שחלפו מאז השחרור"
            hint="0 = שוחרר/ה החודש. הזיכוי תקף עד 36 חודשים."
          >
            <NumberInput
              value={data.monthsSinceDischarge}
              onChange={(v) =>
                update('monthsSinceDischarge', Math.round(Math.max(0, v)))}
              suffix=""
              placeholder="0"
            />
          </FieldGroup>
        )}

        <Divider />

        <FieldGroup
          label="תואר אקדמי (§6 קודים 181 / 182)"
          hint="הזיכוי מתחיל בשנת המס שאחרי שנת הסיום. תואר ראשון: 1 נקודה/שנה (עד 3 שנים). תואר שני: 0.5 נקודה/שנה (עד 2 שנים). PhD / רופא: שלב ראשון כ-B.A, שלב שני כ-M.A."
        >
          <RadioGroup<AcademicDegreeType>
            value={data.academicDegree.type}
            onChange={(v) =>
              update('academicDegree', { ...data.academicDegree, type: v })}
            options={[
              { value: 'none',   label: 'ללא' },
              { value: 'ba',     label: 'תואר ראשון / תעודה' },
              { value: 'ma',     label: 'תואר שני' },
              { value: 'phd_md', label: 'PhD / ד״ר רפואה' },
            ]}
          />
        </FieldGroup>

        {data.academicDegree.type !== 'none' && (
          <FieldGroup
            label="שנות זיכוי שנוצלו עד כה (0 = השנה הראשונה)"
            hint="0 בשנה הראשונה לאחר הסיום, 1 בשנה השנייה וכן הלאה."
          >
            <NumberInput
              value={data.academicDegree.yearsActive}
              onChange={(v) =>
                update('academicDegree', {
                  ...data.academicDegree,
                  yearsActive: Math.round(Math.max(0, v)),
                })}
              suffix=""
              placeholder="0"
            />
          </FieldGroup>
        )}
      </Card>

      {/* עולה חדש */}
      <Card title="עולה חדש" subtitle="§6 — תקף 54 חודשים מיום העלייה (עלייה לאחר 01.01.2025)">
        <FieldGroup
          label="חודשים שחלפו מאז העלייה"
          hint="0 = עלה/תה החודש. הזיכוי בתוקף עד 54 חודשים. אם אינך עולה חדש/ה השאר/י 0."
        >
          <NumberInput
            value={data.olehChadashMonthsElapsed}
            onChange={(v) =>
              update('olehChadashMonthsElapsed', Math.round(Math.min(54, Math.max(0, v))))}
            suffix=""
            placeholder="0"
          />
        </FieldGroup>
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
      <OcrUploader />
      {/* הכנסת עבודה */}
      <Card title="הכנסות מעבודה ועסק" subtitle="הכנסה מיגיעה אישית — ממוסה בשיעורי מס שולי">
        {/*
         * FIX-1: was `data.grossSalary158` / `n('grossSalary158')`
         *        → corrected to `data.grossIncome158` / `n('grossIncome158')`
         */}
        <FieldGroup
          label="הכנסה ברוטו (קוד 158)"
          hint="סך המשכורת הגולמית השנתית של הנישום המדווח — כולל בונוסים ותשלומים נוספים."
        >
          <NumberInput value={data.grossIncome158} onChange={n('grossIncome158')} />
        </FieldGroup>

        {/*
         * FIX-2: was `data.grossSalary172` / `n('grossSalary172')`
         *        → corrected to `data.grossIncome172` / `n('grossIncome172')`
         */}
        <FieldGroup
          label="הכנסה ברוטו — בן/בת זוג לא מדווח/ת (קוד 172)"
          hint="הכנסת בן/בת הזוג שאינו/ה מגיש/ה דוח נפרד. משפיעה על חישוב הכנסה משפחתית כוללת."
        >
          <NumberInput value={data.grossIncome172} onChange={n('grossIncome172')} />
        </FieldGroup>

        {/*
         * FIX-3: was `data.otherPersonalExertionIncome150_170` / `n('otherPersonalExertionIncome150_170')`
         *        → corrected to `data.otherPersonalIncome150_170` / `n('otherPersonalIncome150_170')`
         */}
        <FieldGroup
          label="הכנסות אחרות מיגיעה אישית (קודים 150 / 170)"
          hint="הכנסות ממחבר, מרצה, דירקטור וכד׳ — הכנסה שאינה ממשכורת רגילה."
        >
          <NumberInput value={data.otherPersonalIncome150_170} onChange={n('otherPersonalIncome150_170')} />
        </FieldGroup>

        <FieldGroup
          label="מענקי פרישה / פנסיה חייבים במס (קודים 258 / 272)"
          hint="כפוף לתקרת מס אפקטיבי של 40% כאשר סך ההכנסה הגולמית נמוכה מ-₪560,280."
        >
          <NumberInput value={data.severancePension258_272} onChange={n('severancePension258_272')} />
        </FieldGroup>

        {/*
         * FIX-4: was `data.bituachLeumiTaxableBenefits250_270` / `n('bituachLeumiTaxableBenefits250_270')`
         *        → corrected to `data.bituachLeumiIncome250_270_194_196` / `n('bituachLeumiIncome250_270_194_196')`
         */}
        <FieldGroup
          label="גמלאות ביטוח לאומי חייבות במס (קודים 250 / 270 / 194 / 196)"
          hint="דמי לידה, מילואים, דמי אבטלה — הסכום החייב במס כפי שדווח על ידי ביטוח לאומי."
        >
          <NumberInput
            value={data.bituachLeumiIncome250_270_194_196}
            onChange={n('bituachLeumiIncome250_270_194_196')}
          />
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
          hint="סכום ראשון עד ₪5,000 — פטור ממס. היתרה ממוסה בשיעור 31% (סולם שיעורים יחסי)."
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
          <NumberInput value={data.lossOfEarningPremium112_113} onChange={n('lossOfEarningPremium112_113')} />
        </FieldGroup>

        <FieldGroup
          label="שיעור הפרשת מעביד לפנסיה (%)"
          hint="משמש לחישוב הניכוי בגין אובדן כושר עבודה. הניכוי מתאפס אם שיעור זה עולה על 7.5%."
        >
          <NumberInput
            value={data.employerPensionContributionPct}
            onChange={(v) => update('employerPensionContributionPct', Math.min(100, Math.max(0, v)))}
            suffix="%"
            placeholder="0"
          />
        </FieldGroup>

        <Divider />

        <FieldGroup
          label="הפקדות לקרן פנסיה / קרן השתלמות כעצמאי (קודים 135 / 180)"
          hint="ניכוי מוגבל לנמוך מבין: 11% מהשכר או ₪11,880 לשנה."
        >
          <NumberInput value={data.providentFundPension135_180} onChange={n('providentFundPension135_180')} />
        </FieldGroup>

        <FieldGroup
          label="תשלומי ביטוח לאומי כעצמאי (קודים 030 / 089)"
          hint="52% מהתשלומים ששולמו (ללא קנסות וביטוח בריאות) מוכרים כניכוי."
        >
          <NumberInput value={data.bituachLeumiIndependent030_089} onChange={n('bituachLeumiIndependent030_089')} />
        </FieldGroup>
      </Card>

      {/* זיכויים ישירים */}
      <Card
        title="זיכויים ישירים (§6)"
        subtitle="מפחיתים את המס המחושב ישירות — לאחר חישוב המס התיאורטי"
      >
        <FieldGroup
          label="תרומות לפי סעיף 46 (קודים 037 / 237)"
          hint="זיכוי: 35% מסכום התרומה. מינימום ₪207. תקרה: 30% מההכנסה החייבת או ₪10,354,846."
        >
          <NumberInput value={data.donations037_237} onChange={n('donations037_237')} />
        </FieldGroup>

        <FieldGroup
          label="הכנסה ממשמרות בתעשייה (קודים 068 / 069)"
          hint="זיכוי ישיר: 15% מהשכר. הכנסה מוגבלת לחישוב עד ₪143,040. זיכוי מקסימלי ₪12,540."
        >
          <NumberInput value={data.shiftWorkIncome068_069} onChange={n('shiftWorkIncome068_069')} />
        </FieldGroup>

        <FieldGroup
          label="הוצאות אחזקת בן/בת משפחה במוסד (קודים 132 / 232)"
          hint="זיכוי: 35% מהסכום העולה על 12.5% מההכנסה החייבת. אינו מצטבר עם זיכוי ילד נכה."
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
          <NumberInput value={data.withheldTaxSalary042} onChange={n('withheldTaxSalary042')} />
        </FieldGroup>

        <FieldGroup
          label="מס שנוכה במקור מהכנסות אחרות (קוד 040)"
          hint="כפי שמופיע בשדה 040 בטופס 106 — הכנסות שאינן משכורת רגילה."
        >
          <NumberInput value={data.withheldTaxOther040} onChange={n('withheldTaxOther040')} />
        </FieldGroup>

        <FieldGroup
          label="מס שנוכה על ריבית / חיסכון (קוד 043)"
          hint="מופיע בדפי חשבון הבנק או בטופס 867 — ניכוי מס על ריבית ופיקדונות."
        >
          <NumberInput value={data.withheldTaxInterest043} onChange={n('withheldTaxInterest043')} />
        </FieldGroup>
      </Card>
    </div>
  )
}

// ── סיכום שלב ─────────────────────────────────────────────────────────────

function StepSummaryHint({ step }: { step: number }) {
  const hints: Record<number, string> = {
    1: 'מלאו פרטים אישיים, ילדים, שירות צבאי ותואר אקדמי.',
    2: 'הזינו את כל הכנסותיכם מטופס 106 ומקורות נוספים.',
    3: 'הוסיפו ניכויים וזיכויים — תרומות, ביטוח חיים, פנסיה.',
    4: 'הזינו מסים שנוכו במקור — הסכום הנוכה מהמשכורת והבנק.',
  }
  return (
    <div
      style={{
        textAlign: 'center',
        padding: '12px 0 0',
        fontSize: 13,
        color: C.textMuted,
        fontFamily: T.body,
      }}
    >
      {hints[step]}
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
      dir="rtl"
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
                    backgroundColor: isDone
                      ? C.stepDone
                      : isActive
                      ? C.accent
                      : C.card,
                    border: `2px solid ${
                      isDone
                        ? C.stepDone
                        : isActive
                        ? C.accent
                        : C.border
                    }`,
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    fontSize: 14,
                    fontWeight: 700,
                    color: isDone || isActive ? '#fff' : C.textMuted,
                    transition: 'all 0.25s',
                    boxShadow: isActive
                      ? `0 0 0 4px ${C.accentLight}`
                      : 'none',
                  }}
                >
                  {isDone ? '✓' : s.id}
                </div>
                <div
                  style={{
                    marginTop: 6,
                    fontSize: 11,
                    fontWeight: isActive ? 700 : 400,
                    color: isActive ? C.accent : isDone ? C.stepDone : C.textMuted,
                    textAlign: 'center',
                    fontFamily: T.body,
                    lineHeight: 1.3,
                  }}
                >
                  {s.title}
                  <br />
                  <span style={{ fontSize: 10, opacity: 0.7 }}>{s.subtitle}</span>
                </div>
              </div>
            )
          })}
        </div>
      </div>

      {/* ── תוכן השלב הנוכחי ──────────────────────────────────────────── */}
      <div>
        {step === 1 && (
          <StepPersonal data={formData} update={updateField} />
        )}
        {step === 2 && (
          <StepIncome data={formData} update={updateField} />
        )}
        {step === 3 && (
          <StepDeductionsCredits data={formData} update={updateField} />
        )}
        {step === 4 && (
          <StepWithheld data={formData} update={updateField} />
        )}
      </div>

      <StepSummaryHint step={step} />

      {/* ── ניווט ─────────────────────────────────────────────────────── */}
      <div
        style={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          marginTop: 28,
          gap: 12,
        }}
      >
        {/* כפתור איפוס */}
        <button
          onClick={resetForm}
          style={{
            padding: '9px 18px',
            borderRadius: 8,
            border: `1.5px solid ${C.border}`,
            backgroundColor: 'transparent',
            color: C.textMuted,
            fontSize: 13,
            fontFamily: T.body,
            cursor: 'pointer',
          }}
        >
          איפוס
        </button>

        <div style={{ display: 'flex', gap: 10 }}>
          {/* הקודם */}
          {!isFirst && (
            <button
              onClick={() => setStep((p) => p - 1)}
              style={{
                padding: '10px 24px',
                borderRadius: 8,
                border: `1.5px solid ${C.border}`,
                backgroundColor: C.card,
                color: C.textMain,
                fontSize: 14,
                fontWeight: 600,
                fontFamily: T.body,
                cursor: 'pointer',
              }}
            >
              ← הקודם
            </button>
          )}

          {/* הבא / סיום */}
          <button
            onClick={() => {
              if (!isLast) setStep((p) => p + 1)
            }}
            style={{
              padding: '10px 28px',
              borderRadius: 8,
              border: 'none',
              backgroundColor: isLast ? C.stepDone : C.accent,
              color: '#fff',
              fontSize: 14,
              fontWeight: 700,
              fontFamily: T.body,
              cursor: isLast ? 'default' : 'pointer',
              opacity: isLast ? 0.85 : 1,
            }}
          >
            {isLast ? '✓ הטופס מלא' : 'הבא →'}
          </button>
        </div>
      </div>

      {/* ── פוטר ──────────────────────────────────────────────────────── */}
      <div
        style={{
          marginTop: 40,
          paddingTop: 20,
          borderTop: `1px solid ${C.border}`,
          textAlign: 'center',
        }}
      >
        <p
          style={{
            fontSize: 11,
            color: C.textMuted,
            fontFamily: T.body,
            lineHeight: 1.6,
            margin: 0,
          }}
        >
          TaxHero 2025 — כל החישובים מבוצעים מקומית בדפדפן בלבד.
          <br />
          לא נשלח שום מידע לשרת. כל החישובים מבוצעים לפי
          כללי רשות המסים לשנת המס 2025.
        </p>
      </div>
    </div>
  )
}
