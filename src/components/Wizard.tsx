/**
 * TaxHero 2025 — Wizard
 * =====================
 * A 4-step guided form that collects all `TaxDataInput` fields and writes them
 * to Zustand via `updateField`. Every keystroke triggers an instant recalculation
 * in the store; the SummarySidebar reflects the new result without any explicit
 * "calculate" button.
 *
 * Step structure:
 *   1. Your Profile     — gender, dependants, disability
 *   2. Income           — salary, capital income
 *   3. Deductions & Credits — §5 + §6 of the rules document
 *   4. Tax Withheld     — codes 040 / 042 / 043
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
// SECTION 1 — DESIGN TOKENS
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
}

const T = {
  heading:  "'Bricolage Grotesque', system-ui, sans-serif",
  body:     "'DM Sans', system-ui, sans-serif",
}

// ─────────────────────────────────────────────────────────────────────────────
// SECTION 2 — REUSABLE FORM PRIMITIVES
// ─────────────────────────────────────────────────────────────────────────────

function FieldGroup({
  label,
  hint,
  children,
}: {
  label: string
  hint?: string
  children: React.ReactNode
}) {
  return (
    <div style={{ marginBottom: 20 }}>
      <label
        style={{
          display: 'block',
          fontSize: 14,
          fontWeight: 600,
          color: C.textMain,
          marginBottom: 2,
          fontFamily: T.body,
        }}
      >
        {label}
      </label>
      {hint && (
        <p style={{ fontSize: 12, color: C.textMuted, marginBottom: 6, lineHeight: 1.4 }}>
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
  prefix = '₪',
  min = 0,
  step = 1,
}: {
  value: number
  onChange: (v: number) => void
  placeholder?: string
  prefix?: string
  min?: number
  step?: number
}) {
  return (
    <div style={{ position: 'relative', display: 'flex', alignItems: 'center' }}>
      {prefix && (
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
          {prefix}
        </span>
      )}
      <input
        type="number"
        value={value === 0 ? '' : value}
        min={min}
        step={step}
        placeholder={placeholder}
        onChange={(e) => onChange(parseFloat(e.target.value) || 0)}
        style={{
          width: '100%',
          paddingLeft: prefix ? 32 : 12,
          paddingRight: 12,
          paddingTop: 10,
          paddingBottom: 10,
          border: `1.5px solid ${C.border}`,
          borderRadius: 8,
          fontSize: 14,
          backgroundColor: C.inputBg,
          color: C.textMain,
          outline: 'none',
          fontFamily: T.body,
          fontVariantNumeric: 'tabular-nums',
          transition: 'border-color 0.15s',
        }}
        onFocus={(e) => (e.target.style.borderColor = C.borderFocus)}
        onBlur={(e) => (e.target.style.borderColor = C.border)}
      />
    </div>
  )
}

function ToggleGroup<T extends string>({
  options,
  value,
  onChange,
}: {
  options: { value: T; label: string; sublabel?: string }[]
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
              fontWeight: active ? 700 : 400,
              fontSize: 13,
              cursor: 'pointer',
              fontFamily: T.body,
              display: 'flex',
              flexDirection: 'column',
              alignItems: 'center',
              transition: 'all 0.15s',
              minWidth: 90,
            }}
          >
            <span>{opt.label}</span>
            {opt.sublabel && (
              <span style={{ fontSize: 10, opacity: 0.7, marginTop: 2 }}>{opt.sublabel}</span>
            )}
          </button>
        )
      })}
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
    <button
      type="button"
      onClick={() => onChange(!value)}
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: 10,
        background: 'none',
        border: 'none',
        cursor: 'pointer',
        padding: 0,
        fontFamily: T.body,
      }}
    >
      <div
        style={{
          width: 44,
          height: 24,
          borderRadius: 12,
          backgroundColor: value ? C.accent : C.border,
          position: 'relative',
          transition: 'background 0.2s',
          flexShrink: 0,
        }}
      >
        <div
          style={{
            width: 18,
            height: 18,
            borderRadius: 9,
            backgroundColor: '#fff',
            position: 'absolute',
            top: 3,
            left: value ? 23 : 3,
            transition: 'left 0.2s',
            boxShadow: '0 1px 3px rgba(0,0,0,0.25)',
          }}
        />
      </div>
      <span style={{ fontSize: 14, color: C.textMain, fontWeight: value ? 600 : 400 }}>
        {label}
      </span>
    </button>
  )
}

function Card({ children, title }: { children: React.ReactNode; title?: string }) {
  return (
    <div
      style={{
        backgroundColor: C.card,
        border: `1.5px solid ${C.border}`,
        borderRadius: 14,
        padding: '20px 20px',
        marginBottom: 16,
      }}
    >
      {title && (
        <p
          style={{
            fontSize: 11,
            fontWeight: 700,
            letterSpacing: '0.1em',
            textTransform: 'uppercase',
            color: C.textMuted,
            marginBottom: 14,
            fontFamily: T.body,
          }}
        >
          {title}
        </p>
      )}
      {children}
    </div>
  )
}

function Divider() {
  return <div style={{ borderTop: `1px solid ${C.border}`, margin: '20px 0' }} />
}

// ─────────────────────────────────────────────────────────────────────────────
// SECTION 3 — STEP COMPONENTS
// ─────────────────────────────────────────────────────────────────────────────

function StepPersonal({
  data,
  update,
}: {
  data: TaxDataInput
  update: <K extends keyof TaxDataInput>(key: K, value: TaxDataInput[K]) => void
}) {
  // Children management
  const addChild = () =>
    update('childrenAges', [...data.childrenAges, 0])
  const removeChild = (i: number) =>
    update('childrenAges', data.childrenAges.filter((_, idx) => idx !== i))
  const setChildAge = (i: number, age: number) =>
    update(
      'childrenAges',
      data.childrenAges.map((a, idx) => (idx === i ? age : a)),
    )

  return (
    <div>
      <Card title="Taxpayer Profile">
        <FieldGroup label="Gender" hint="Affects base credit points (2.25 for men, 2.75 for women)">
          <ToggleGroup<Gender>
            options={[
              { value: 'male', label: '🧔 Male', sublabel: '2.25 pts' },
              { value: 'female', label: '👩 Female', sublabel: '2.75 pts' },
            ]}
            value={data.gender}
            onChange={(v) => update('gender', v)}
          />
        </FieldGroup>

        <Divider />

        <Toggle
          value={data.isSingleParent}
          onChange={(v) => update('isSingleParent', v)}
          label="Single Parent (not cohabiting) — +1 credit point"
        />
      </Card>

      <Card title="Children">
        <p style={{ fontSize: 13, color: C.textMuted, marginBottom: 12 }}>
          Each child's age determines credit points. Children aged 0–18 may qualify. Add
          each child separately.
        </p>

        {data.childrenAges.length === 0 ? (
          <p style={{ fontSize: 13, color: C.textMuted, fontStyle: 'italic', marginBottom: 12 }}>
            No children added yet.
          </p>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginBottom: 12 }}>
            {data.childrenAges.map((age, i) => (
              <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <span
                  style={{
                    fontSize: 13,
                    color: C.textMuted,
                    minWidth: 64,
                    fontFamily: T.body,
                  }}
                >
                  Child {i + 1}
                </span>
                <div style={{ flex: 1 }}>
                  <NumberInput
                    value={age}
                    onChange={(v) => setChildAge(i, Math.max(0, Math.floor(v)))}
                    placeholder="Age (0–18)"
                    prefix="age"
                    min={0}
                    step={1}
                  />
                </div>
                <button
                  type="button"
                  onClick={() => removeChild(i)}
                  style={{
                    width: 32,
                    height: 32,
                    borderRadius: 6,
                    border: `1px solid ${C.border}`,
                    background: C.dangerBg,
                    color: C.danger,
                    cursor: 'pointer',
                    fontSize: 16,
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    flexShrink: 0,
                  }}
                >
                  ×
                </button>
              </div>
            ))}
          </div>
        )}

        <button
          type="button"
          onClick={addChild}
          style={{
            padding: '8px 16px',
            borderRadius: 8,
            border: `1.5px dashed ${C.accent}`,
            background: C.accentLight,
            color: C.accent,
            fontSize: 13,
            fontWeight: 600,
            cursor: 'pointer',
            fontFamily: T.body,
          }}
        >
          + Add Child
        </button>

        {data.childrenAges.length > 0 && (
          <>
            <Divider />
            <FieldGroup
              label="Disabled Children (Codes 131 / 023)"
              hint="2 extra credit points per child. Subject to household income limits."
            >
              <NumberInput
                value={data.disabledChildrenCount131_023}
                onChange={(v) =>
                  update('disabledChildrenCount131_023', Math.max(0, Math.floor(v)))
                }
                placeholder="0"
                prefix="#"
                min={0}
              />
            </FieldGroup>

            {data.disabledChildrenCount131_023 > 0 && (
              <FieldGroup
                label="Total Household Income (for disabled-child limit check)"
                hint={`Limit: ₪301,000 (couple) or ₪188,000 (single parent). Credit disallowed if exceeded.`}
              >
                <NumberInput
                  value={data.totalHouseholdIncomeForDisabledChild}
                  onChange={(v) => update('totalHouseholdIncomeForDisabledChild', v)}
                />
              </FieldGroup>
            )}
          </>
        )}
      </Card>

      <Card title="Disability / Blindness Exemption (Codes 109 / 309)">
        <Toggle
          value={data.isFullDisability}
          onChange={(v) => update('isFullDisability', v)}
          label="100% disability or blindness — personal income up to ₪445,200 exempt"
        />
        {data.isFullDisability && (
          <div style={{ marginTop: 12 }}>
            <Toggle
              value={data.isModDefenseOrTerrorVictim}
              onChange={(v) => update('isModDefenseOrTerrorVictim', v)}
              label="MoD / Terror victim — exemption ceiling raised to ₪684,000"
            />
          </div>
        )}
      </Card>
    </div>
  )
}

// ── Step 2: Income ─────────────────────────────────────────────────────────

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
      <Card title="Employment Income (Progressive Brackets)">
        <FieldGroup
          label="Salary — Registered Spouse (Code 158)"
          hint="Main salary income from Form 106"
        >
          <NumberInput value={data.grossIncome158} onChange={n('grossIncome158')} />
        </FieldGroup>

        <FieldGroup
          label="Salary — Unregistered Spouse (Code 172)"
          hint="If you are registered as an unregistered spouse"
        >
          <NumberInput value={data.grossIncome172} onChange={n('grossIncome172')} />
        </FieldGroup>

        <FieldGroup
          label="Other Personal-Exertion Income (Codes 150 / 170)"
          hint="Author, lecturer, director fees, etc."
        >
          <NumberInput
            value={data.otherPersonalIncome150_170}
            onChange={n('otherPersonalIncome150_170')}
          />
        </FieldGroup>

        <FieldGroup
          label="Taxable Severance / Pension Lump Sum (Codes 258 / 272)"
          hint="Capped at 40% effective rate if total gross income < ₪560,280"
        >
          <NumberInput
            value={data.severancePension258_272}
            onChange={n('severancePension258_272')}
          />
        </FieldGroup>

        <FieldGroup
          label="Bituach Leumi Benefits (Codes 250 / 270 / 194 / 196)"
          hint="Maternity, reserve duty, unemployment payments"
        >
          <NumberInput
            value={data.bituachLeumiIncome250_270_194_196}
            onChange={n('bituachLeumiIncome250_270_194_196')}
          />
        </FieldGroup>
      </Card>

      <Card title="Capital & Passive Income (Flat Rates)">
        <FieldGroup label="Residential Rent (Code 222) — 10% flat" hint="Rent from residential property">
          <NumberInput value={data.residentialRentIncome222} onChange={n('residentialRentIncome222')} />
        </FieldGroup>

        <FieldGroup
          label="Interest / Dividends (Code 060) — 15% flat"
          hint="Bank savings, certain dividends"
        >
          <NumberInput value={data.interestDividends060} onChange={n('interestDividends060')} />
        </FieldGroup>

        <FieldGroup
          label="Interest / Dividends (Codes 067 / 126) — 20% flat"
          hint="Real dividends, certain bond interest"
        >
          <NumberInput
            value={data.interestDividends067_126}
            onChange={n('interestDividends067_126')}
          />
        </FieldGroup>

        <FieldGroup
          label="Interest / Dividends (Codes 157 / 141 / 142) — 25% flat"
          hint="Mutual funds, certain investment dividends"
        >
          <NumberInput
            value={data.interestDividends157_141_142}
            onChange={n('interestDividends157_141_142')}
          />
        </FieldGroup>

        <FieldGroup label="Interest (Code 050) — 35% flat" hint="Certain bonds and savings">
          <NumberInput value={data.interest050} onChange={n('interest050')} />
        </FieldGroup>

        <FieldGroup
          label="Renewable Energy Rent (Code 335)"
          hint="First ₪5,000 exempt; remainder taxed at 31%"
        >
          <NumberInput value={data.renewableEnergyRent335} onChange={n('renewableEnergyRent335')} />
        </FieldGroup>

        <FieldGroup
          label="Gambling / Lotteries / Prizes (Code 227)"
          hint="⚠ No flat rate specified in 2025 rules — recorded for reference only, excluded from tax"
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

// ── Step 3: Deductions & Credits ───────────────────────────────────────────

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
      {/* Deductions */}
      <Card title="Deductions — Reduce Taxable Income (§5)">
        <FieldGroup
          label="Loss-of-Earning-Capacity Insurance Premium (Codes 112 / 113)"
          hint="Max deduction: 3.5% of salary (salary capped at ₪376,080). Reduced or eliminated by employer pension > 4%."
        >
          <NumberInput
            value={data.lossOfEarningPremium112_113}
            onChange={n('lossOfEarningPremium112_113')}
          />
        </FieldGroup>

        {data.lossOfEarningPremium112_113 > 0 && (
          <FieldGroup
            label="Employer Pension Contribution %"
            hint="If > 7.5%, the loss-of-earning deduction is fully disallowed."
          >
            <NumberInput
              value={data.employerPensionContributionPct}
              onChange={n('employerPensionContributionPct')}
              placeholder="0"
              prefix="%"
              min={0}
              step={0.5}
            />
          </FieldGroup>
        )}

        <FieldGroup
          label="Provident Fund / Pension as Independent (Codes 135 / 180)"
          hint="Capped at 11% of salary or ₪11,880 (whichever is lower)"
        >
          <NumberInput
            value={data.providentFundPension135_180}
            onChange={n('providentFundPension135_180')}
          />
        </FieldGroup>

        <FieldGroup
          label="Bituach Leumi Payments as Independent (Codes 030 / 089)"
          hint="52% of these payments are deductible (excluding fines and health tax)"
        >
          <NumberInput
            value={data.bituachLeumiIndependent030_089}
            onChange={n('bituachLeumiIndependent030_089')}
          />
        </FieldGroup>
      </Card>

      {/* Discharged Soldier */}
      <Card title="Discharged Soldier Credit (Codes 324 / 224 / 124 / 024)">
        <FieldGroup label="Service Type" hint="Valid for 36 months from discharge">
          <ToggleGroup<SoldierServiceType>
            options={[
              { value: 'none', label: 'None' },
              { value: 'full', label: 'Full Service', sublabel: '23+ / 22+ mo.' },
              { value: 'partial', label: 'Partial', sublabel: '< threshold' },
            ]}
            value={data.soldierServiceType}
            onChange={(v) => update('soldierServiceType', v)}
          />
        </FieldGroup>

        {data.soldierServiceType !== 'none' && (
          <FieldGroup
            label="Months Since Discharge"
            hint="Credit expires after 36 months"
          >
            <NumberInput
              value={data.monthsSinceDischarge}
              onChange={n('monthsSinceDischarge')}
              placeholder="0"
              prefix="mo"
              min={0}
            />
          </FieldGroup>
        )}
      </Card>

      {/* Academic Degree */}
      <Card title="Academic Degree Credit (Codes 181 / 182)">
        <FieldGroup
          label="Degree Type"
          hint="Credit starts the year AFTER graduation"
        >
          <ToggleGroup<AcademicDegreeType>
            options={[
              { value: 'none', label: 'None' },
              { value: 'ba', label: "BA / Certificate", sublabel: '1 pt/yr, 3 yrs' },
              { value: 'ma', label: "MA", sublabel: '0.5 pt/yr, 2 yrs' },
              { value: 'phd_md', label: "PhD / MD", sublabel: 'BA then MA' },
            ]}
            value={data.academicDegree.type}
            onChange={(v) =>
              update('academicDegree', { ...data.academicDegree, type: v })
            }
          />
        </FieldGroup>

        {data.academicDegree.type !== 'none' && (
          <FieldGroup
            label="Years Since Graduation (post-graduation years used)"
            hint="0 = first eligible year (the year after graduating)"
          >
            <NumberInput
              value={data.academicDegree.yearsActive}
              onChange={(v) =>
                update('academicDegree', {
                  ...data.academicDegree,
                  yearsActive: Math.max(0, Math.floor(v)),
                })
              }
              placeholder="0"
              prefix="yr"
              min={0}
            />
          </FieldGroup>
        )}
      </Card>

      {/* Oleh Chadash */}
      <Card title="New Immigrant Credit — Oleh Chadash (§6)">
        <FieldGroup
          label="Months Elapsed Since Immigration"
          hint="Valid for 54 months after arrival (for immigrants arriving after 01.01.2025). Set to 0 if not applicable."
        >
          <NumberInput
            value={data.olehChadashMonthsElapsed}
            onChange={n('olehChadashMonthsElapsed')}
            placeholder="0"
            prefix="mo"
            min={0}
          />
        </FieldGroup>
      </Card>

      {/* Donations */}
      <Card title="Special Direct Credits (§6)">
        <FieldGroup
          label="Donations — Section 46 (Codes 037 / 237)"
          hint="Minimum ₪207. Credit = 35% of qualifying amount, capped at 30% of taxable income."
        >
          <NumberInput value={data.donations037_237} onChange={n('donations037_237')} />
        </FieldGroup>

        <FieldGroup
          label="Shift Work Income in Industry (Codes 068 / 069)"
          hint="15% credit; income capped at ₪143,040; max credit ₪12,540"
        >
          <NumberInput value={data.shiftWorkIncome068_069} onChange={n('shiftWorkIncome068_069')} />
        </FieldGroup>

        <FieldGroup
          label="Institution Maintenance Expenses (Codes 132 / 232)"
          hint="35% credit on expenses exceeding 12.5% of taxable income. Cannot combine with disabled-child credit."
        >
          <NumberInput
            value={data.institutionMaintenanceExpenses132_232}
            onChange={n('institutionMaintenanceExpenses132_232')}
          />
        </FieldGroup>

        <FieldGroup
          label="Life Insurance Premium — Risk Component (Codes 036 / 081)"
          hint="25% direct credit on risk portion of premium"
        >
          <NumberInput value={data.lifeInsurancePremium036_081} onChange={n('lifeInsurancePremium036_081')} />
        </FieldGroup>

        <FieldGroup
          label="Pension / Survivors Insurance (Codes 140 / 240 / 045 / 086)"
          hint="35% direct credit on payments"
        >
          <NumberInput
            value={data.pensionSurvivorsInsurance140_240}
            onChange={n('pensionSurvivorsInsurance140_240')}
          />
        </FieldGroup>
      </Card>

      {/* Location-based credits */}
      <Card title="Location & Employment Credits">
        <Toggle
          value={data.isEilatResident}
          onChange={(v) => update('isEilatResident', v)}
          label="Eilat Resident — 10% credit on Eilat income (Codes 139 / 183)"
        />

        {data.isEilatResident && (
          <div style={{ marginTop: 12 }}>
            <FieldGroup
              label="Personal-Exertion Income Earned in Eilat"
              hint="Income capped at ₪268,560 for credit calculation"
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
          label="Security Forces — Activity Level A Salary"
          hint="5% direct credit on salary; income capped at ₪178,320"
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

// ── Step 4: Withheld Tax ───────────────────────────────────────────────────

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
      <Card title="Tax Already Withheld at Source (ניכוי במקור)">
        <p style={{ fontSize: 13, color: C.textMuted, marginBottom: 16, lineHeight: 1.6 }}>
          Enter the amounts already deducted from your payments by employers or banks.
          These reduce your final balance — overpayment results in a refund, underpayment
          results in a debt.
        </p>

        <FieldGroup
          label="Tax Withheld from Salary (Code 042)"
          hint="Found on your Form 106 from your employer — look for code 042"
        >
          <NumberInput
            value={data.withheldTaxSalary042}
            onChange={n('withheldTaxSalary042')}
          />
        </FieldGroup>

        <FieldGroup
          label="Tax Withheld from Other Income (Code 040)"
          hint="From Form 106 — code 040. Separate from salary withholding."
        >
          <NumberInput
            value={data.withheldTaxOther040}
            onChange={n('withheldTaxOther040')}
          />
        </FieldGroup>

        <FieldGroup
          label="Tax Withheld from Interest / Savings (Code 043)"
          hint="From bank statements or Form 867 — code 043"
        >
          <NumberInput
            value={data.withheldTaxInterest043}
            onChange={n('withheldTaxInterest043')}
          />
        </FieldGroup>
      </Card>

      {/* Summary hint */}
      <div
        style={{
          background: 'linear-gradient(135deg, #EDE9FE 0%, #F5F3FF 100%)',
          border: `1.5px solid #C4B5FD`,
          borderRadius: 14,
          padding: '16px 18px',
        }}
      >
        <p style={{ fontSize: 13, color: '#5B21B6', fontWeight: 600, marginBottom: 4 }}>
          ✓ All inputs collected
        </p>
        <p style={{ fontSize: 12, color: '#7C3AED', lineHeight: 1.5 }}>
          Check the live summary panel on the right for your real-time tax calculation.
          All computations follow the official 2025 Israel Tax Authority rules.
        </p>
      </div>
    </div>
  )
}

// ─────────────────────────────────────────────────────────────────────────────
// SECTION 4 — WIZARD SHELL
// ─────────────────────────────────────────────────────────────────────────────

const STEPS = [
  { id: 1, title: 'Your Profile',           subtitle: 'פרטים אישיים' },
  { id: 2, title: 'Income',                 subtitle: 'הכנסות' },
  { id: 3, title: 'Deductions & Credits',   subtitle: 'ניכויים וזיכויים' },
  { id: 4, title: 'Tax Withheld',           subtitle: 'ניכוי במקור' },
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
        marginLeft: 'auto',
        marginRight: 'auto',
      }}
    >
      {/* ── Step indicator ────────────────────────────────────────────────── */}
      <div style={{ marginBottom: 28 }}>
        <div
          style={{
            display: 'flex',
            alignItems: 'flex-start',
            gap: 0,
            position: 'relative',
          }}
        >
          {/* Progress line */}
          <div
            style={{
              position: 'absolute',
              top: 16,
              left: 20,
              right: 20,
              height: 2,
              backgroundColor: C.border,
              zIndex: 0,
            }}
          />
          <div
            style={{
              position: 'absolute',
              top: 16,
              left: 20,
              height: 2,
              width: `calc(${((step - 1) / (STEPS.length - 1)) * 100}% - 0px)`,
              backgroundColor: C.accent,
              zIndex: 1,
              transition: 'width 0.3s ease',
            }}
          />

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
                    width: 32,
                    height: 32,
                    borderRadius: 16,
                    backgroundColor: isDone
                      ? C.stepDone
                      : isActive
                        ? C.accent
                        : C.card,
                    border: `2px solid ${isDone ? C.stepDone : isActive ? C.accent : C.border}`,
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    fontSize: isDone ? 14 : 13,
                    fontWeight: 700,
                    color: isDone || isActive ? '#fff' : C.textMuted,
                    transition: 'all 0.2s',
                    boxShadow: isActive ? `0 0 0 4px ${C.accent}22` : 'none',
                  }}
                >
                  {isDone ? '✓' : s.id}
                </div>
                <p
                  style={{
                    fontSize: 11,
                    fontWeight: isActive ? 700 : 400,
                    color: isActive ? C.accent : isDone ? C.textMain : C.textMuted,
                    marginTop: 6,
                    textAlign: 'center',
                    lineHeight: 1.3,
                    maxWidth: 80,
                  }}
                >
                  {s.title}
                </p>
                <p style={{ fontSize: 10, color: C.textMuted, marginTop: 1 }}>
                  {s.subtitle}
                </p>
              </div>
            )
          })}
        </div>
      </div>

      {/* ── Step heading ──────────────────────────────────────────────────── */}
      <div style={{ marginBottom: 20 }}>
        <h2
          style={{
            fontSize: 26,
            fontWeight: 800,
            color: C.textMain,
            fontFamily: T.heading,
            margin: 0,
            letterSpacing: '-0.5px',
          }}
        >
          {STEPS[step - 1].title}
        </h2>
        <p style={{ fontSize: 13, color: C.textMuted, marginTop: 4 }}>
          Step {step} of {STEPS.length}
          {' · '}
          {STEPS[step - 1].subtitle}
        </p>
      </div>

      {/* ── Step content ──────────────────────────────────────────────────── */}
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

      {/* ── Navigation ────────────────────────────────────────────────────── */}
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
                fontWeight: 600,
                cursor: 'pointer',
                fontFamily: T.body,
              }}
            >
              ← Back
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
            Reset
          </button>
        </div>

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
              fontWeight: 700,
              cursor: 'pointer',
              fontFamily: T.body,
              boxShadow: '0 4px 12px rgba(124,58,237,0.35)',
              transition: 'transform 0.1s, box-shadow 0.1s',
            }}
            onMouseDown={(e) => {
              ;(e.currentTarget as HTMLButtonElement).style.transform = 'scale(0.97)'
            }}
            onMouseUp={(e) => {
              ;(e.currentTarget as HTMLButtonElement).style.transform = 'scale(1)'
            }}
          >
            Next →
          </button>
        ) : (
          <span
            style={{
              fontSize: 13,
              color: C.stepDone,
              fontWeight: 600,
              background: C.stepDoneBg,
              padding: '8px 14px',
              borderRadius: 8,
            }}
          >
            ✓ All steps complete — see summary →
          </span>
        )}
      </div>
    </div>
  )
}
