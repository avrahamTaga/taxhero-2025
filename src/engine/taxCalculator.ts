/**
 * TaxHero 2025 — Israel Tax Calculation Engine
 * =============================================
 * Tax Year: 2025
 * Source of truth: tax_rules_full_2025.md (Official Tax Authority Simulator)
 *
 * Architecture contract:
 *   - PURE FUNCTIONS ONLY. No side effects, no external calls, no state mutation.
 *   - All monetary values are in ILS (whole numbers or decimals as needed).
 *   - All "credit points" are dimensionless decimal numbers.
 *   - The exported `calculateTaxRefund` function is the single public entry point.
 *
 * ─── APPLIED FIXES ────────────────────────────────────────────────────────────
 *
 *  FIX-1  Credit-cap base now uses `taxableIncomeForCaps` (post-exemption personal
 *         income) rather than the broad `taxableIncome` that included capital
 *         income. Affects donation 30% cap and institution 12.5% threshold.
 *
 *  FIX-2  Severance 40% cap baseline uses `taxablePersonalIncome` (post-exemption)
 *         instead of a raw subtraction that could double-count the exemption.
 *
 *  FIX-3  Provident Fund deduction now has a hard monetary ceiling of 11,880 ILS
 *         (2025) in addition to the 11%-of-income percentage cap.
 *
 *  FIX-4  Oleh Chadash month-boundary logic rewritten with a single, consistent
 *         inclusive-index convention. Previous mix of inclusive/exclusive caused
 *         precision errors at segment edges (months 13, 31, 43).
 *
 *  FIX-5  `gamblingLotteryIncome227` field added; engine emits a user-facing
 *         warning and excludes it from calculations (no rate in the rules doc).
 *         Field-name comments on all withheld-tax fields prevent UI mis-mapping.
 *
 *  NEW-1  `calcBracketTax` rounds its result to the nearest agora (0.01 ILS) to
 *         prevent IEEE-754 drift from accumulating across bracket boundaries.
 *
 *  NEW-2  `calcLossOfEarningDeduction` — two overlapping guards (> 7.5 early-return
 *         AND effectiveRate ≤ 0 fallback) collapsed into a single
 *         `Math.max(0, BASE_RATE − excess/100)` expression.
 *
 *  NEW-3  `calcChildCreditPoints` filters non-integer / negative ages. Invalid
 *         values emit a named warning listing the offending entries.
 *
 *  NEW-4  `olehChadashMonthsElapsed` clamped to 54 before calling the helper;
 *         a warning is emitted when the raw value exceeds the statutory window.
 *
 *  NEW-5  `calcOlehChadashPoints` unit-test fixtures documented inline.
 */

// ─────────────────────────────────────────────────────────────────────────────
// SECTION 1 — CONSTANTS  (§2, §3, §6, §7 of rules document)
// ─────────────────────────────────────────────────────────────────────────────

/** Annual value of one credit point (§2). */
const CREDIT_POINT_VALUE_YEARLY = 2_904; // ILS

/** Base credit points by gender (§2). */
const BASE_POINTS: Readonly<Record<Gender, number>> = {
  male:   2.25,
  female: 2.75,
};

/** Travel-to-work credit granted to every resident (§2). */
const TRAVEL_TO_WORK_POINTS = 0.25;

/**
 * Progressive tax brackets for PERSONAL EXERTION income (§3).
 * Each entry: { ceiling (inclusive ILS upper bound), rate (decimal) }.
 * The last bracket uses Infinity as its ceiling.
 */
const TAX_BRACKETS: ReadonlyArray<{ ceiling: number; rate: number }> = [
  { ceiling:  84_120, rate: 0.10 },
  { ceiling: 120_720, rate: 0.14 },
  { ceiling: 193_800, rate: 0.20 },
  { ceiling: 273_360, rate: 0.31 },
  { ceiling: 589_320, rate: 0.35 },
  { ceiling: 759_000, rate: 0.47 },
  { ceiling: Infinity, rate: 0.50 }, // includes 3 % surtax
];

/**
 * Hard monetary ceiling for the Provident Fund / pension deduction as an
 * independent (§5 Codes 135/180). FIX-3.
 * 2025 value = 11 % of the statutory income ceiling for this deduction.
 */
const PROVIDENT_FUND_MAX_ILS = 11_880; // ILS

// ─────────────────────────────────────────────────────────────────────────────
// SECTION 2 — ENUMS & SUPPORTING TYPES
// ─────────────────────────────────────────────────────────────────────────────

/** The taxpayer's gender — drives base credit points (§2). */
export type Gender = "male" | "female";

/**
 * Academic degree types for the education credit (§6).
 * "none"   → no credit.
 * "ba"     → 1 pt/year, up to 3 years.
 * "ma"     → 0.5 pt/year, up to 2 years.
 * "phd_md" → BA phase (years 0–2) then MA phase (years 3–4).
 */
export type AcademicDegreeType = "none" | "ba" | "ma" | "phd_md";

/**
 * Discharged-soldier service classification (§6).
 * "full"    → 23+ months (men) / 22+ months (women) → 2 pts/year.
 * "partial" → shorter service                        → 1 pt/year.
 * "none"    → not applicable.
 */
export type SoldierServiceType = "none" | "partial" | "full";

// ─────────────────────────────────────────────────────────────────────────────
// SECTION 3 — INPUT INTERFACE
// ─────────────────────────────────────────────────────────────────────────────

/**
 * All user-supplied data required for a complete tax calculation.
 *
 * ── UI-TEAM MAPPING NOTE ─────────────────────────────────────────────────────
 * Withheld-tax fields map to Form 106 codes as follows — map carefully:
 *
 *   withheldTaxSalary042   ← Code 042  (salary withholding, Form 106)
 *   withheldTaxOther040    ← Code 040  (other income withholding, Form 106)
 *   withheldTaxInterest043 ← Code 043  (interest/savings, bank statement / Form 867)
 *
 * Do NOT mix Code 040 and Code 042 — different form lines, same final effect.
 * ─────────────────────────────────────────────────────────────────────────────
 */
export interface TaxDataInput {
  // ── Taxpayer profile ─────────────────────────────────────────────────────
  gender: Gender;

  /**
   * Code 026: Single parent not cohabiting with a partner (§6).
   * Grants 1 extra credit point.
   */
  isSingleParent: boolean;

  // ── Personal-exertion income (§4 — progressive brackets) ─────────────────
  /** Code 158: Registered-spouse gross salary. */
  grossIncome158: number;

  /** Code 172: Unregistered-spouse gross salary. */
  grossIncome172: number;

  /** Codes 150 / 170: Other personal-exertion income (author, lecturer, director, etc.). */
  otherPersonalIncome150_170: number;

  /**
   * Codes 258 / 272: Taxable severance / pension lump sum (מענקי פרישה).
   * Automatically capped at 40 % effective rate when total gross income < 560,280 ILS.
   */
  severancePension258_272: number;

  /** Codes 250 / 270 / 194 / 196: Taxable Bituach Leumi benefits (maternity, reserve, unemployment). */
  bituachLeumiIncome250_270_194_196: number;

  // ── Non-personal-exertion income (§4 — flat rates) ───────────────────────
  /** Code 222: Rent from residential property. Flat 10 % tax. */
  residentialRentIncome222: number;

  /**
   * Code 227: Gambling, lotteries, prizes. FIX-5.
   * No flat rate is specified in the rules document. The engine emits a warning
   * and EXCLUDES this income from tax calculations.
   */
  gamblingLotteryIncome227: number;

  /** Code 060: Interest / dividends. Flat 15 % tax. */
  interestDividends060: number;

  /** Codes 067 / 126: Interest / dividends. Flat 20 % tax. */
  interestDividends067_126: number;

  /** Codes 157 / 141 / 142: Interest / dividends. Flat 25 % tax. */
  interestDividends157_141_142: number;

  /** Code 050: Interest. Flat 35 % tax. */
  interest050: number;

  // ── Renewable-energy rent (§7 Code 335) ──────────────────────────────────
  /**
   * Code 335: Rent income from renewable energy.
   * First 5,000 ILS exempt; remainder taxed at 31 % (sliding scale).
   */
  renewableEnergyRent335: number;

  // ── Disability / blindness exemption (§7 Codes 109 / 309) ────────────────
  /**
   * 100 % disability or blindness.
   * Personal-exertion income up to 445,200 ILS is exempt (684,000 for MoD/terror victims).
   */
  isFullDisability: boolean;

  /**
   * Whether the taxpayer is a Ministry of Defense / terror victim (§7).
   * Raises the disability ceiling from 445,200 to 684,000 ILS.
   * Only relevant when `isFullDisability` is true.
   */
  isModDefenseOrTerrorVictim: boolean;

  // ── Deductions (§5) — reduce Taxable Income ──────────────────────────────
  /**
   * Codes 112 / 113 / 206 / 207: Loss-of-earning-capacity insurance premium.
   * Max deduction = effectiveRate % × min(salary, 376,080).
   * effectiveRate = 3.5 % reduced by excess employer pension over 4 %; fully
   * disallowed if employer pension > 7.5 %.
   */
  lossOfEarningPremium112_113: number;

  /** Employer pension contribution percentage (0–100). Used for loss-of-earning deduction. */
  employerPensionContributionPct: number;

  /**
   * Codes 135 / 180: Provident-fund / pension contributions as an independent.
   * Capped at the LOWER of (a) 11 % of gross salary, or (b) 11,880 ILS. FIX-3.
   */
  providentFundPension135_180: number;

  /**
   * Codes 030 / 089: Bituach Leumi payments as an independent.
   * 52 % of these payments are deductible (excluding fines / health tax).
   */
  bituachLeumiIndependent030_089: number;

  // ── Withheld taxes (§4) — reduce Final Balance ───────────────────────────
  /** Code 042: Tax withheld from salary (Form 106). */
  withheldTaxSalary042: number;

  /** Code 040: Tax withheld from other income (Form 106). */
  withheldTaxOther040: number;

  /** Code 043: Tax withheld from interest / savings (bank statement / Form 867). */
  withheldTaxInterest043: number;

  // ── Credit-point credits (§6) ────────────────────────────────────────────
  /**
   * Each child's age (integer ≥ 0, where 0 = birth year).
   * The engine applies gender-appropriate point tables automatically.
   */
  childrenAges: number[];

  /**
   * Codes 131 / 023: Disabled children qualifying for 2 extra points each.
   * Income limit applied automatically via `totalHouseholdIncomeForDisabledChild`.
   * Mutually exclusive with `institutionMaintenanceExpenses132_232`.
   */
  disabledChildrenCount131_023: number;

  /**
   * Combined taxpayer + spouse income for the disabled-child income-limit check.
   * Use taxpayer income only when single.
   * Limit: 301,000 ILS (couple) / 188,000 ILS (single parent).
   */
  totalHouseholdIncomeForDisabledChild: number;

  /** Codes 324 / 224 / 124 / 024: Discharged-soldier service type. */
  soldierServiceType: SoldierServiceType;

  /**
   * Calendar months elapsed since army discharge date (0 = discharged this month).
   * Credit valid for up to 36 months from discharge.
   */
  monthsSinceDischarge: number;

  /**
   * Academic degree credit (§6 Codes 181 / 182).
   * Credit starts the tax year AFTER graduation; `yearsActive` = 0 in the first
   * eligible year.
   */
  academicDegree: {
    type: AcademicDegreeType;
    /** Post-graduation years already consumed (0-based). */
    yearsActive: number;
  };

  /**
   * Oleh Chadash: calendar months elapsed since immigration (§6).
   * Valid only for immigrants arriving after 01.01.2025. Set to 0 if not applicable.
   * Statutory maximum is 54 months.
   */
  olehChadashMonthsElapsed: number;

  // ── Direct monetary credits (§6) ────────────────────────────────────────
  /**
   * Codes 037 / 237: Donations qualifying for Section 46.
   * Minimum 207 ILS. Credit = 35 % of qualifying amount, capped at 30 % of
   * `taxableIncomeForCaps` or 10,354,846 ILS (whichever is lower).
   */
  donations037_237: number;

  /**
   * Codes 068 / 069: Shift-work income in industry.
   * 15 % direct credit; qualifying income capped at 143,040 ILS; max credit 12,540 ILS.
   */
  shiftWorkIncome068_069: number;

  /**
   * Codes 132 / 232: Institution maintenance expenses for a family member.
   * Credit = 35 % of the portion exceeding 12.5 % of `taxableIncomeForCaps`.
   * Mutually exclusive with `disabledChildrenCount131_023`.
   */
  institutionMaintenanceExpenses132_232: number;

  /**
   * Codes 036 / 081: Life insurance premium (risk component only).
   * 25 % direct credit.
   */
  lifeInsurancePremium036_081: number;

  /**
   * Codes 140 / 240 / 045 / 086: Pension / survivors insurance payments.
   * 35 % direct credit.
   */
  pensionSurvivorsInsurance140_240: number;

  /**
   * Codes 139 / 183: Eilat resident credit.
   * 10 % direct credit on Eilat personal-exertion income; income capped at 268,560 ILS.
   */
  isEilatResident: boolean;

  /** Personal-exertion income produced in Eilat. Used only when `isEilatResident` is true. */
  eilatIncome139_183: number;

  /**
   * Security forces "Activity Level A" salary (§6).
   * 5 % direct credit; income capped at 178,320 ILS.
   */
  securityForcesActivityASalary: number;
}

// ─────────────────────────────────────────────────────────────────────────────
// SECTION 4 — OUTPUT INTERFACE
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Full result object returned by `calculateTaxRefund`. All monetary amounts in ILS.
 */
export interface TaxCalculationResult {
  // ── Intermediate calculations ─────────────────────────────────────────────

  /** Total gross income before any deductions (personal + non-personal). */
  totalGrossIncome: number;

  /** Sum of all deductions that reduce taxable income. */
  totalDeductions: number;

  /**
   * Broad taxable income = totalGrossIncome − totalDeductions.
   * Used for reporting only. Do NOT use for credit caps — see `taxableIncomeForCaps`.
   */
  taxableIncome: number;

  /**
   * Post-exemption personal-exertion taxable income (FIX-1).
   * Authoritative base for income-derived credit caps:
   *   • Donation cap:               30 % of this value (§6 Codes 037/237)
   *   • Institution threshold:    12.5 % of this value (§6 Codes 132/232)
   */
  taxableIncomeForCaps: number;

  /** Step 2: bracket tax on personal income + flat-rate tax on capital income. */
  theoreticalTax: number;

  /** Annual monetary value of all credit points (creditPoints × 2,904 ILS). */
  totalCreditPointsValue: number;

  /** Sum of all direct monetary credits (donations, shift work, insurance, etc.). */
  totalDirectCredits: number;

  /** totalCreditPointsValue + totalDirectCredits. */
  totalCreditsValue: number;

  /** Step 3: max(0, theoreticalTax − totalCreditsValue). Cannot be negative. */
  actualTax: number;

  /** Total tax already withheld at source (codes 042, 040, 043). */
  totalWithheldTax: number;

  /**
   * Step 4: actualTax − totalWithheldTax.
   * Negative → TAX REFUND (החזר מס).
   * Positive → TAX DEBT   (חוב מס).
   * Zero     → BALANCED.
   */
  finalBalance: number;

  /** "REFUND" | "DEBT" | "BALANCED" */
  outcome: "REFUND" | "DEBT" | "BALANCED";

  // ── Credit-point breakdown (for UI transparency) ──────────────────────────
  creditPointsBreakdown: {
    base:              number;
    travel:            number;
    singleParent:      number;
    children:          number;
    disabledChildren:  number;
    dischargedSoldier: number;
    academicDegree:    number;
    olehChadash:       number;
    total:             number;
  };

  // ── Non-fatal warnings ────────────────────────────────────────────────────
  /**
   * Warnings the UI should surface to the user.
   * E.g. a credit disallowed due to an income limit, or a scenario outside the
   * rules document's explicit coverage.
   */
  warnings: string[];
}

// ─────────────────────────────────────────────────────────────────────────────
// SECTION 5 — PURE HELPER FUNCTIONS
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Applies the progressive tax brackets to the given personal-exertion income.
 * Returns total theoretical bracket tax (ILS).
 *
 * NEW-1: Result is rounded to the nearest agora (0.01 ILS) to prevent
 * IEEE-754 drift from accumulating across five or more bracket multiplications.
 */
function calcBracketTax(personalExertionIncome: number): number {
  if (personalExertionIncome <= 0) return 0;

  let tax = 0;
  let remaining = personalExertionIncome;
  let previousCeiling = 0;

  for (const bracket of TAX_BRACKETS) {
    if (remaining <= 0) break;

    const bracketWidth =
      bracket.ceiling === Infinity
        ? remaining
        : Math.min(remaining, bracket.ceiling - previousCeiling);

    tax += bracketWidth * bracket.rate;
    remaining -= bracketWidth;
    previousCeiling = bracket.ceiling;
  }

  // Round to nearest agora — financial output must not carry sub-agora drift.
  return Math.round(tax * 100) / 100;
}

/**
 * Computes child credit points for the taxpayer based on ages and gender (§6).
 *
 * Women (and single parents, handled by caller) receive the full "Children Points"
 * table. Men receive "Toddler Points" (ages 0–12 only).
 *
 * NEW-3: Non-integer or negative ages are filtered silently. The caller is
 * responsible for emitting a warning when invalid ages are detected.
 */
function calcChildCreditPoints(ages: number[], gender: Gender): number {
  const safeAges = ages.filter((a) => Number.isInteger(a) && a >= 0);

  let points = 0;

  for (const age of safeAges) {
    if (gender === "female") {
      if      (age === 0)                   points += 1.5;
      else if (age >= 1  && age <= 5)       points += 2.5;
      else if (age >= 6  && age <= 12)      points += 2.0;
      else if (age >= 13 && age <= 17)      points += 1.0;
      else if (age === 18)                  points += 0.5;
      // age > 18: no credit
    } else {
      // Male — Toddler Points only (§6)
      if      (age === 0)                   points += 1.5;
      else if (age >= 1 && age <= 5)        points += 2.5;
      else if (age >= 6 && age <= 12)       points += 1.0;
      // age > 12: no credit for men
    }
  }

  return points;
}

/**
 * Computes discharged-soldier credit points for the current tax year (§6).
 *
 * Credit valid for 36 months from discharge.
 *   Full service:    1/6 pt/month (≈ 2 pts/year).
 *   Partial service: 1/12 pt/month (≈ 1 pt/year).
 *
 * @param serviceType   "full" | "partial" | "none"
 * @param monthsElapsed Calendar months elapsed since discharge (0 = this month).
 */
function calcSoldierCreditPoints(
  serviceType: SoldierServiceType,
  monthsElapsed: number,
): number {
  if (serviceType === "none") return 0;

  const remainingEligibleMonths = Math.max(0, 36 - monthsElapsed);
  const eligibleMonthsThisYear  = Math.min(12, remainingEligibleMonths);
  if (eligibleMonthsThisYear <= 0) return 0;

  const ratePerMonth = serviceType === "full" ? 1 / 6 : 1 / 12;
  return eligibleMonthsThisYear * ratePerMonth;
}

/**
 * Computes academic-degree credit points for the current tax year (§6).
 *
 * BA / Certificate: 1 pt/year, up to 3 years (yearsActive 0–2).
 * MA:              0.5 pt/year, up to 2 years (yearsActive 0–1).
 * PhD / Medical MD: BA phase first (years 0–2), then MA phase (years 3–4).
 *
 * `yearsActive` = 0 in the first eligible year (the year AFTER graduation).
 */
function calcAcademicCreditPoints(
  degree: TaxDataInput["academicDegree"],
): number {
  const { type, yearsActive } = degree;
  if (type === "none") return 0;

  if (type === "ba")     return yearsActive >= 0 && yearsActive < 3 ? 1.0 : 0;
  if (type === "ma")     return yearsActive >= 0 && yearsActive < 2 ? 0.5 : 0;
  if (type === "phd_md") {
    if (yearsActive >= 0 && yearsActive < 3) return 1.0; // BA phase
    if (yearsActive >= 3 && yearsActive < 5) return 0.5; // MA phase
    return 0;
  }

  return 0;
}

/**
 * Computes Oleh Chadash (new immigrant) credit points for the current tax
 * year (§6). Valid only for immigrants arriving after 01.01.2025.
 *
 * ── Monthly credit schedule (all segment boundaries INCLUSIVE) ───────────────
 *
 *   Months  1–12:  1/12 pt / month
 *   Months 13–30:  1/4  pt / month
 *   Months 31–42:  1/6  pt / month
 *   Months 43–54:  1/12 pt / month
 *
 * Convention: `monthsElapsed` = 0 means the immigrant arrived this month and has
 * not yet completed month 1.  Month 1 is complete when monthsElapsed = 1.
 * All boundaries are expressed as COMPLETED-month counts (inclusive on both sides).
 *
 * FIX-4: Previous version mixed inclusive/exclusive conventions, causing
 * off-by-one errors at transition months (13, 31, 43).
 *
 * ── Unit-test fixtures ────────────────────────────────────────────────────────
 *   monthsElapsed =  0 → 0 pts     (not yet started month 1)
 *   monthsElapsed =  6 → 0.500 pts (6 × 1/12)
 *   monthsElapsed = 12 → 1.000 pts (12 × 1/12)
 *   monthsElapsed = 13 → 1.167 pts (11 × 1/12 + 1 × 1/4)
 *   monthsElapsed = 30 → 3.000 pts (12 × 1/4)
 *   monthsElapsed = 42 → 2.000 pts (12 × 1/6)
 *   monthsElapsed = 54 → 1.000 pts (12 × 1/12)
 */
function calcOlehChadashPoints(monthsElapsed: number): number {
  if (monthsElapsed <= 0) return 0;

  // [segmentFirstMonth, segmentLastMonth, pointsPerMonth] — all inclusive
  const segments: ReadonlyArray<[number, number, number]> = [
    [ 1, 12, 1 / 12],
    [13, 30, 1 / 4 ],
    [31, 42, 1 / 6 ],
    [43, 54, 1 / 12],
  ];

  // The "current tax year" covers the 12 completed months ending at monthsElapsed.
  // yearStart is clamped below at 1 (month 0 doesn't generate credit).
  const yearEnd   = Math.min(54, monthsElapsed);
  const yearStart = Math.max(1, yearEnd - 11);

  let points = 0;

  for (const [segFirst, segLast, rate] of segments) {
    // Overlap of [yearStart, yearEnd] and [segFirst, segLast] (both inclusive).
    const overlapFirst = Math.max(yearStart, segFirst);
    const overlapLast  = Math.min(yearEnd,   segLast);

    if (overlapLast >= overlapFirst) {
      points += (overlapLast - overlapFirst + 1) * rate;
    }
  }

  return points;
}

/**
 * Computes the loss-of-earning-capacity insurance deduction (§5).
 *
 *   Base rate:       3.5 % of salary (salary capped at 376,080 ILS).
 *   Employer pension > 4 %:  effective rate = 3.5 % − excess percentage points.
 *   Employer pension > 7.5 %: effective rate → 0; deduction fully disallowed.
 *
 * NEW-2: The previous two overlapping guards (> 7.5 early-return AND
 * effectiveRate ≤ 0 fallback) are collapsed into a single
 * `Math.max(0, BASE_RATE − excess/100)` expression.
 */
function calcLossOfEarningDeduction(
  premiumPaid: number,
  grossSalary: number,
  employerPensionPct: number,
): number {
  const SALARY_CAP = 376_080;
  const BASE_RATE  = 0.035; // 3.5 %

  // At employerPensionPct = 7.5 the excess is 3.5 pp, exactly zeroing the rate.
  // Above 7.5 % the max(0, …) clamp holds at 0 — deduction disallowed.
  const effectiveRate = Math.max(
    0,
    BASE_RATE - Math.max(0, employerPensionPct - 4) / 100,
  );

  if (effectiveRate === 0) return 0;

  const cappedSalary = Math.min(grossSalary, SALARY_CAP);
  const maxDeduction = cappedSalary * effectiveRate;

  return Math.min(premiumPaid, maxDeduction);
}

/**
 * Computes the renewable-energy rent tax (§7 Code 335).
 *
 * Up to 5,000 ILS: fully exempt.
 * Over 5,000 ILS:  31 % on the portion above 5,000 ILS.
 */
function calcRenewableEnergyRentTax(income: number): number {
  const EXEMPT_THRESHOLD = 5_000;
  const TAX_RATE         = 0.31;

  if (income <= EXEMPT_THRESHOLD) return 0;
  return (income - EXEMPT_THRESHOLD) * TAX_RATE;
}

// ─────────────────────────────────────────────────────────────────────────────
// SECTION 6 — MAIN CALCULATION ENGINE
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Calculates the Israeli 2025 income tax liability and final balance.
 *
 * Strictly follows the 4-step pipeline from §1 of tax_rules_full_2025.md:
 *   1. Taxable Income  = Gross Income − Deductions
 *   2. Theoretical Tax = bracket tax (personal) + flat-rate tax (capital)
 *   3. Actual Tax      = max(0, Theoretical Tax − Credits)
 *   4. Final Balance   = Actual Tax − Withheld Tax
 *
 * @param data — All user inputs as defined by `TaxDataInput`.
 * @returns    — Full breakdown in `TaxCalculationResult`.
 */
export function calculateTaxRefund(data: TaxDataInput): TaxCalculationResult {
  const warnings: string[] = [];

  // ── Guard: Code 227 has no published flat rate (FIX-5) ───────────────────
  if (data.gamblingLotteryIncome227 > 0) {
    warnings.push(
      "Code 227 (gambling / lotteries / prizes): the rules document does not " +
      "specify a flat tax rate for this income. It has been excluded from the " +
      "calculation. Please consult a tax advisor or check the ITA simulator directly.",
    );
  }

  // ─────────────────────────────────────────────────────────────────────────
  // STEP 1  Deductions → Taxable Income
  // ─────────────────────────────────────────────────────────────────────────

  // "Salary" for deduction-limit purposes (personal exertion, before deductions).
  const totalSalary =
    data.grossIncome158 +
    data.grossIncome172 +
    data.otherPersonalIncome150_170 +
    data.bituachLeumiIncome250_270_194_196;

  // 1a. Loss-of-earning-capacity insurance deduction (§5 Codes 112/113/206/207).
  const lossOfEarningDeduction = calcLossOfEarningDeduction(
    data.lossOfEarningPremium112_113,
    totalSalary,
    data.employerPensionContributionPct,
  );

  if (
    data.lossOfEarningPremium112_113 > 0 &&
    data.employerPensionContributionPct > 7.5
  ) {
    warnings.push(
      "Loss-of-earning-capacity deduction disallowed: employer pension " +
      "contribution exceeds 7.5 %.",
    );
  }

  // 1b. Provident-fund / pension deduction as independent (§5 Codes 135/180).
  //     FIX-3: capped at the LOWER of (a) 11 % of salary, (b) 11,880 ILS.
  const providentFundDeduction = Math.min(
    data.providentFundPension135_180,
    totalSalary * 0.11,
    PROVIDENT_FUND_MAX_ILS,
  );

  // 1c. Bituach Leumi independent deduction (§5 Codes 030/089): 52 % of payments.
  const bituachLeumiDeduction = data.bituachLeumiIndependent030_089 * 0.52;

  const totalDeductions =
    lossOfEarningDeduction + providentFundDeduction + bituachLeumiDeduction;

  // 1d. Raw personal-exertion income (before deductions or disability exemption).
  const personalExertionIncomeRaw = totalSalary + data.severancePension258_272;

  // 1e. Apply deductions → pre-exemption taxable personal income.
  const taxablePersonalIncomePreExemption = Math.max(
    0,
    personalExertionIncomeRaw - totalDeductions,
  );

  // 1f. Disability / blindness exemption (§7 Codes 109/309).
  let disabilityExemptionApplied = 0;
  let taxablePersonalIncome      = taxablePersonalIncomePreExemption;

  if (data.isFullDisability) {
    const exemptCeiling = data.isModDefenseOrTerrorVictim ? 684_000 : 445_200;
    disabilityExemptionApplied = Math.min(taxablePersonalIncome, exemptCeiling);
    taxablePersonalIncome      = Math.max(
      0,
      taxablePersonalIncome - disabilityExemptionApplied,
    );

    if (disabilityExemptionApplied > 0) {
      warnings.push(
        `Disability / blindness exemption applied: ` +
        `${disabilityExemptionApplied.toFixed(2)} ILS of personal income ` +
        `is tax-exempt (Code 109/309).`,
      );
    }
  }

  // FIX-1: `taxableIncomeForCaps` — the correct base for income-derived credit
  // caps. This is post-exemption personal income; capital income is NOT included
  // because it is taxed at flat rates and is irrelevant to these caps.
  const taxableIncomeForCaps = taxablePersonalIncome;

  // Broad gross income (for reporting + severance cap eligibility check).
  const totalGrossIncome =
    personalExertionIncomeRaw +
    data.residentialRentIncome222 +
    data.gamblingLotteryIncome227 + // included in gross even if untaxed
    data.interestDividends060 +
    data.interestDividends067_126 +
    data.interestDividends157_141_142 +
    data.interest050 +
    data.renewableEnergyRent335;

  // Broad taxable income (for reporting only — NOT used for credit caps).
  const taxableIncome = Math.max(0, totalGrossIncome - totalDeductions);

  // ─────────────────────────────────────────────────────────────────────────
  // STEP 2  Theoretical Tax
  // ─────────────────────────────────────────────────────────────────────────

  // 2a. Progressive bracket tax on post-exemption personal income.
  let bracketTax = calcBracketTax(taxablePersonalIncome);

  // 2b. Severance / pension 40 % cap (§4 Codes 258/272). FIX-2.
  //     Cap applies when total GROSS income < 560,280 ILS.
  //     Baseline ("tax without severance") is computed against
  //     `taxablePersonalIncome` (post-exemption) to avoid double-counting.
  if (data.severancePension258_272 > 0 && totalGrossIncome < 560_280) {
    const taxablePersonalWithoutSeverance = Math.max(
      0,
      taxablePersonalIncome - data.severancePension258_272,
    );
    const taxWithoutSeverance       = calcBracketTax(taxablePersonalWithoutSeverance);
    const severanceTaxUnderBrackets = bracketTax - taxWithoutSeverance;
    const severanceTaxIfCapped      = data.severancePension258_272 * 0.40;

    if (severanceTaxUnderBrackets > severanceTaxIfCapped) {
      bracketTax = taxWithoutSeverance + severanceTaxIfCapped;
      warnings.push(
        "Severance / pension income capped at 40 % effective tax rate " +
        "(total gross income < 560,280 ILS).",
      );
    }
  }

  // 2c. Flat-rate taxes on non-personal-exertion income (§4).
  const rentTax       = data.residentialRentIncome222    * 0.10;
  const interest15Tax = data.interestDividends060         * 0.15;
  const interest20Tax = data.interestDividends067_126     * 0.20;
  const interest25Tax = data.interestDividends157_141_142 * 0.25;
  const interest35Tax = data.interest050                  * 0.35;
  const renewableTax  = calcRenewableEnergyRentTax(data.renewableEnergyRent335);

  const flatRateTax =
    rentTax + interest15Tax + interest20Tax +
    interest25Tax + interest35Tax + renewableTax;

  const theoreticalTax = bracketTax + flatRateTax;

  // ─────────────────────────────────────────────────────────────────────────
  // STEP 3  Credits → Actual Tax
  // ─────────────────────────────────────────────────────────────────────────

  // 3a. Base + travel credit points (§2).
  const basePoints   = BASE_POINTS[data.gender];
  const travelPoints = TRAVEL_TO_WORK_POINTS;

  // 3b. Single-parent extra point (§6 Code 026).
  const singleParentPoints = data.isSingleParent ? 1.0 : 0;

  // 3c. Children credit points (§6). NEW-3: warn on invalid ages.
  const invalidAges = data.childrenAges.filter(
    (a) => !Number.isInteger(a) || a < 0,
  );
  if (invalidAges.length > 0) {
    warnings.push(
      `childrenAges contains ${invalidAges.length} invalid value(s) ` +
      `(${invalidAges.join(", ")}). Non-integer or negative ages are ignored ` +
      `and will not generate credit points.`,
    );
  }
  const childrenPoints = calcChildCreditPoints(data.childrenAges, data.gender);

  // 3d. Disabled-child credit points (§6 Codes 131/023): 2 pts each.
  let disabledChildPoints = 0;
  if (data.disabledChildrenCount131_023 > 0) {
    const incomeLimit = data.isSingleParent ? 188_000 : 301_000;

    if (data.institutionMaintenanceExpenses132_232 > 0) {
      warnings.push(
        "Disabled-child credit (Code 131) and Institution Maintenance credit " +
        "(Code 132) cannot both be claimed. Only the Institution Maintenance " +
        "credit will be applied.",
      );
    } else if (data.totalHouseholdIncomeForDisabledChild > incomeLimit) {
      warnings.push(
        `Disabled-child credit disallowed: household income ` +
        `(${data.totalHouseholdIncomeForDisabledChild.toFixed(0)} ILS) ` +
        `exceeds the limit of ${incomeLimit.toLocaleString()} ILS.`,
      );
    } else {
      disabledChildPoints = data.disabledChildrenCount131_023 * 2;
    }
  }

  // 3e. Discharged-soldier credit points (§6).
  const soldierPoints = calcSoldierCreditPoints(
    data.soldierServiceType,
    data.monthsSinceDischarge,
  );

  // 3f. Academic degree credit points (§6).
  const academicPoints = calcAcademicCreditPoints(data.academicDegree);

  // 3g. Oleh Chadash credit points (§6). NEW-4: clamp + warn. FIX-4 in helper.
  const rawOlehMonths = data.olehChadashMonthsElapsed;
  if (rawOlehMonths > 54) {
    warnings.push(
      `Oleh Chadash credit: ${rawOlehMonths} months elapsed exceeds the ` +
      `54-month eligibility window. No Oleh Chadash credit will be applied.`,
    );
  }
  const olehPoints = calcOlehChadashPoints(Math.min(rawOlehMonths, 54));

  // 3h. Total credit points → ILS.
  const totalCreditPoints =
    basePoints +
    travelPoints +
    singleParentPoints +
    childrenPoints +
    disabledChildPoints +
    soldierPoints +
    academicPoints +
    olehPoints;

  const totalCreditPointsValue = totalCreditPoints * CREDIT_POINT_VALUE_YEARLY;

  // 3i. Direct monetary credits ─────────────────────────────────────────────

  // Donations — Section 46 (§6 Codes 037/237). FIX-1: cap uses taxableIncomeForCaps.
  let donationCredit = 0;
  if (data.donations037_237 >= 207) {
    const donationCap        = Math.min(taxableIncomeForCaps * 0.30, 10_354_846);
    const qualifyingDonation = Math.min(data.donations037_237, donationCap);
    donationCredit           = qualifyingDonation * 0.35;
  } else if (data.donations037_237 > 0) {
    warnings.push(
      `Donations credit disallowed: amount (${data.donations037_237} ILS) ` +
      `is below the 207 ILS minimum.`,
    );
  }

  // Shift work in industry (§6 Codes 068/069).
  const qualifyingShiftIncome = Math.min(data.shiftWorkIncome068_069, 143_040);
  const shiftWorkCredit       = Math.min(qualifyingShiftIncome * 0.15, 12_540);

  // Institution maintenance (§6 Codes 132/232). FIX-1: threshold uses taxableIncomeForCaps.
  let institutionCredit = 0;
  if (
    data.institutionMaintenanceExpenses132_232 > 0 &&
    data.disabledChildrenCount131_023 === 0
  ) {
    const threshold          = taxableIncomeForCaps * 0.125;
    const qualifyingExpenses = Math.max(
      0,
      data.institutionMaintenanceExpenses132_232 - threshold,
    );
    institutionCredit = qualifyingExpenses * 0.35;
  }

  // Life insurance (§6 Codes 036/081): 25 % of risk premium.
  const lifeInsuranceCredit = data.lifeInsurancePremium036_081 * 0.25;

  // Pension / survivors insurance (§6 Codes 140/240/045/086): 35 %.
  const pensionCredit = data.pensionSurvivorsInsurance140_240 * 0.35;

  // Eilat resident (§6 Codes 139/183): 10 %, income capped at 268,560.
  let eilatCredit = 0;
  if (data.isEilatResident) {
    eilatCredit = Math.min(data.eilatIncome139_183, 268_560) * 0.10;
  }

  // Security forces Activity Level A (§6): 5 %, income capped at 178,320.
  const securityForcesCredit =
    Math.min(data.securityForcesActivityASalary, 178_320) * 0.05;

  const totalDirectCredits =
    donationCredit +
    shiftWorkCredit +
    institutionCredit +
    lifeInsuranceCredit +
    pensionCredit +
    eilatCredit +
    securityForcesCredit;

  const totalCreditsValue = totalCreditPointsValue + totalDirectCredits;

  // 3j. Actual Tax Owed — cannot be negative (§1).
  const actualTax = Math.max(0, theoreticalTax - totalCreditsValue);

  // ─────────────────────────────────────────────────────────────────────────
  // STEP 4  Final Balance
  // ─────────────────────────────────────────────────────────────────────────
  //
  // UI-TEAM: ensure form fields map correctly:
  //   withheldTaxSalary042   ← Code 042 (salary withholding, Form 106)
  //   withheldTaxOther040    ← Code 040 (other income, Form 106)
  //   withheldTaxInterest043 ← Code 043 (interest / savings, Form 867)
  const totalWithheldTax =
    data.withheldTaxSalary042 +
    data.withheldTaxOther040 +
    data.withheldTaxInterest043;

  const finalBalance = actualTax - totalWithheldTax;

  const outcome: TaxCalculationResult["outcome"] =
    finalBalance < 0 ? "REFUND" : finalBalance > 0 ? "DEBT" : "BALANCED";

  // ── Return ────────────────────────────────────────────────────────────────
  return {
    totalGrossIncome,
    totalDeductions,
    taxableIncome,
    taxableIncomeForCaps,
    theoreticalTax,
    totalCreditPointsValue,
    totalDirectCredits,
    totalCreditsValue,
    actualTax,
    totalWithheldTax,
    finalBalance,
    outcome,
    creditPointsBreakdown: {
      base:              basePoints,
      travel:            travelPoints,
      singleParent:      singleParentPoints,
      children:          childrenPoints,
      disabledChildren:  disabledChildPoints,
      dischargedSoldier: soldierPoints,
      academicDegree:    academicPoints,
      olehChadash:       olehPoints,
      total:             totalCreditPoints,
    },
    warnings,
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// SECTION 7 — UTILITY: EMPTY INPUT FACTORY
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Returns a fully-initialised zero-state `TaxDataInput`.
 *
 * Useful as the Zustand initial state so components can always destructure
 * safely without null-checks. Every field added to `TaxDataInput` MUST have a
 * corresponding zero-default entry here.
 *
 * @param gender — Preserve the user's chosen gender across resets so base
 *                 credit points stay correct. Defaults to "male".
 */
export function createEmptyTaxInput(gender: Gender = "male"): TaxDataInput {
  return {
    gender,
    isSingleParent:                       false,
    grossIncome158:                        0,
    grossIncome172:                        0,
    otherPersonalIncome150_170:            0,
    severancePension258_272:               0,
    bituachLeumiIncome250_270_194_196:     0,
    residentialRentIncome222:              0,
    gamblingLotteryIncome227:              0,   // FIX-5
    interestDividends060:                  0,
    interestDividends067_126:              0,
    interestDividends157_141_142:          0,
    interest050:                           0,
    renewableEnergyRent335:                0,
    isFullDisability:                      false,
    isModDefenseOrTerrorVictim:            false,
    lossOfEarningPremium112_113:           0,
    employerPensionContributionPct:        0,
    providentFundPension135_180:           0,
    bituachLeumiIndependent030_089:        0,
    withheldTaxSalary042:                  0,   // Code 042 — salary
    withheldTaxOther040:                   0,   // Code 040 — other income
    withheldTaxInterest043:                0,   // Code 043 — interest/savings
    childrenAges:                          [],
    disabledChildrenCount131_023:          0,
    totalHouseholdIncomeForDisabledChild:  0,
    soldierServiceType:                    "none",
    monthsSinceDischarge:                  0,
    academicDegree:                        { type: "none", yearsActive: 0 },
    olehChadashMonthsElapsed:              0,
    donations037_237:                      0,
    shiftWorkIncome068_069:                0,
    institutionMaintenanceExpenses132_232: 0,
    lifeInsurancePremium036_081:           0,
    pensionSurvivorsInsurance140_240:      0,
    isEilatResident:                       false,
    eilatIncome139_183:                    0,
    securityForcesActivityASalary:         0,
  };
}