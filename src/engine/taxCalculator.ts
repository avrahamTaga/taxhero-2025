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
 * ─── CHANGELOG (fixes applied vs. v1) ────────────────────────────────────────
 *
 *  FIX-1 / Bug 2 — taxableIncome for credit caps now uses taxablePersonalIncome
 *    (post-exemption) as the base for personal-income-derived caps (donation 30%,
 *    institution 12.5%). Previously `taxableIncome` was derived from
 *    `totalGrossIncome` which ignored the disability exemption, inflating those caps.
 *    A separate `taxableIncomeForCaps` variable is now computed correctly.
 *
 *  FIX-2 / Bug 5 — Severance 40% cap baseline now uses post-exemption income.
 *    `taxWithoutSeverance` is computed from `taxablePersonalIncome` (which already
 *    has the disability exemption applied) rather than from a raw subtraction that
 *    could double-count the exemption.
 *
 *  FIX-3 / Bug 3 — Provident Fund deduction now has a hard monetary cap of
 *    11,880 ILS (2025 figure) in addition to the 11%-of-income percentage cap.
 *
 *  FIX-4 / Bug 6 — Oleh Chadash month boundary logic rewritten with a single,
 *    consistent inclusive-index convention throughout. The previous mix of
 *    inclusive/exclusive boundaries caused precision errors at segment edges
 *    (months 13, 31, 43). Added a dedicated unit-test fixture comment.
 *
 *  FIX-5 / Bug 1 & 7 — Field naming clarified throughout TaxDataInput.
 *    Added UI-team mapping comments on every withheld-tax field so the form
 *    layer cannot silently mis-map Code 042 → wrong field.
 *    Added a `GamblingIncome227` field (zero-default) so the engine can emit a
 *    proper user-facing warning rather than silently ignoring that income code.
 */

// ─────────────────────────────────────────────────────────────────────────────
// SECTION 1 — CONSTANTS  (§2, §3, §6, §7 of rules document)
// ─────────────────────────────────────────────────────────────────────────────

/** Annual value of one credit point (§2) */
const CREDIT_POINT_VALUE_YEARLY = 2_904; // ILS

/** Base credit points by gender (§2) */
const BASE_POINTS = {
  male: 2.25,
  female: 2.75,
} as const;

/** Travel-to-work credit granted to every resident (§2) */
const TRAVEL_TO_WORK_POINTS = 0.25;

/**
 * Progressive tax brackets for PERSONAL EXERTION income (§3).
 * Each entry: [upper bound (inclusive), marginal rate].
 * The last bracket has Infinity as its upper bound.
 */
const TAX_BRACKETS: ReadonlyArray<{ ceiling: number; rate: number }> = [
  { ceiling: 84_120,   rate: 0.10 },
  { ceiling: 120_720,  rate: 0.14 },
  { ceiling: 193_800,  rate: 0.20 },
  { ceiling: 273_360,  rate: 0.31 },
  { ceiling: 589_320,  rate: 0.35 },
  { ceiling: 759_000,  rate: 0.47 },
  { ceiling: Infinity, rate: 0.50 }, // includes 3% surtax
];

/**
 * Hard monetary ceiling for the Provident Fund / pension deduction
 * as an independent (§5 Codes 135/180).  FIX-3
 * Source: 2025 tax year — 11% of the statutory income ceiling for this deduction.
 */
const PROVIDENT_FUND_MAX_ILS = 11_880; // ILS

// ─────────────────────────────────────────────────────────────────────────────
// SECTION 2 — ENUMS & SUPPORTING TYPES
// ─────────────────────────────────────────────────────────────────────────────

/** The taxpayer's gender — drives base credit points (§2) */
export type Gender = "male" | "female";

/**
 * Academic degree types for the education credit (§6).
 * "none"   → no credit.
 * "ba"     → 1 pt/year, up to 3 years.
 * "ma"     → 0.5 pts/year, up to 2 years.
 * "phd_md" → treated as BA then MA.
 */
export type AcademicDegreeType = "none" | "ba" | "ma" | "phd_md";

/**
 * Discharged-soldier service length classification (§6).
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
 * Field names follow the pattern: <description><FormCode(s)>
 * Withheld-tax fields map to Form 106 boxes as follows — please map carefully:
 *
 *   withheldTaxSalary042   ← Form 106 / Form 135  Code 042  (salary withholding)
 *   withheldTaxOther040    ← Form 106 / Form 135  Code 040  (other income withholding)
 *   withheldTaxInterest043 ← Form 106 / Form 135  Code 043  (interest / savings withholding)
 *
 * Do NOT mix up Code 040 and Code 042 — they reduce the same final balance but
 * originate from different income sources and appear on different form lines.
 * ─────────────────────────────────────────────────────────────────────────────
 *
 * Monetary fields default to 0 when omitted.
 * Boolean flags default to false when omitted.
 */
export interface TaxDataInput {
  // ── Taxpayer profile ─────────────────────────────────────────────────────
  gender: Gender;

  /**
   * Whether the taxpayer is a single parent not cohabiting with a partner (§6 Code 026).
   * Grants 1 extra credit point.
   */
  isSingleParent: boolean;

  // ── Personal-exertion income (§4 — taxed via progressive brackets) ───────
  /**
   * Code 158: Registered-spouse gross salary.
   * This is the primary personal-exertion income field for most employees.
   * Maps to the "הכנסת עבודה - בן/בת זוג רשום" line on Form 106.
   */
  grossIncome158: number;

  /**
   * Code 172: Unregistered-spouse gross salary.
   */
  grossIncome172: number;

  /**
   * Codes 150 / 170: Other personal-exertion income (author, lecturer, director, etc.)
   */
  otherPersonalIncome150_170: number;

  /**
   * Codes 258 / 272: Taxable severance / pension lump sum (מענקי פרישה).
   * NOTE: Capped at 40% effective tax rate when total gross income < 560,280 ILS.
   * The engine applies this cap automatically.
   */
  severancePension258_272: number;

  /**
   * Codes 250 / 270 / 194 / 196: Taxable Bituach Leumi benefits
   * (maternity, reserve duty, unemployment).
   */
  bituachLeumiIncome250_270_194_196: number;

  // ── Non-personal-exertion income (§4 — flat rates) ───────────────────────
  /** Code 222: Rent from residential property. Flat 10% tax. */
  residentialRentIncome222: number;

  /**
   * Code 227: Gambling, lotteries, prizes.
   * NOTE: §4 of the rules document lists this code but does NOT specify a flat
   * rate. The engine will emit a warning and exclude this income from tax
   * calculations until a rate is published.  (FIX-5)
   */
  gamblingLotteryIncome227: number;

  /** Code 060: Interest / dividends. Flat 15% tax. */
  interestDividends060: number;

  /** Codes 067 / 126: Interest / dividends. Flat 20% tax. */
  interestDividends067_126: number;

  /** Codes 157 / 141 / 142: Interest / dividends. Flat 25% tax. */
  interestDividends157_141_142: number;

  /** Code 050: Interest. Flat 35% tax. */
  interest050: number;

  // ── Renewable-energy rent exemption (§7 Code 335) ────────────────────────
  /**
   * Code 335: Rent income from renewable energy.
   * First 5,000 ILS exempt; remainder taxed at 31% (sliding scale).
   */
  renewableEnergyRent335: number;

  // ── Disability / blindness exemption (§7 Codes 109 / 309) ────────────────
  /**
   * Whether the taxpayer has 100% disability or blindness.
   * When true, personal-exertion income up to 445,200 ILS is exempt from tax.
   */
  isFullDisability: boolean;

  /**
   * Whether the taxpayer is a Ministry of Defense / terror victim (§7).
   * Raises the disability exemption ceiling from 445,200 to 684,000 ILS.
   * Only relevant when `isFullDisability` is true.
   */
  isModDefenseOrTerrorVictim: boolean;

  // ── Deductions (§5) — reduce Taxable Income ──────────────────────────────
  /**
   * Codes 112 / 113 / 206 / 207: Loss-of-earning-capacity insurance premium paid.
   * Deduction = min(premiumPaid, effectiveRate% × min(salary, 376,080)).
   * effectiveRate = 3.5% reduced by excess employer pension contribution over 4%.
   * Fully disallowed if employer pension contribution > 7.5%.
   */
  lossOfEarningPremium112_113: number;

  /**
   * Employer pension contribution percentage (0–100).
   * Used to determine whether the loss-of-earning-capacity deduction is
   * reduced (> 4%) or fully disallowed (> 7.5%).
   */
  employerPensionContributionPct: number;

  /**
   * Codes 135 / 180: Provident-fund / pension contributions as an independent.
   * Deduction capped at the LOWER of:
   *   (a) 11% of gross income, or
   *   (b) PROVIDENT_FUND_MAX_ILS (11,880 ILS for 2025).  FIX-3
   */
  providentFundPension135_180: number;

  /**
   * Codes 030 / 089: Bituach Leumi payments as an independent.
   * 52% of these payments (excluding fines / health tax) are deductible.
   */
  bituachLeumiIndependent030_089: number;

  // ── Withheld taxes (§4 — reduce Final Balance) ───────────────────────────
  /**
   * Code 042: Tax already withheld from salary.
   * UI-TEAM: This is the "מס שנוכה" box on Form 106 (Code 042 specifically).
   * Do NOT use Code 040 or Code 043 values here.
   */
  withheldTaxSalary042: number;

  /**
   * Code 040: Tax already withheld from other incomes (non-salary).
   * UI-TEAM: Separate line from Code 042. Map Form 106 Code 040 here.
   */
  withheldTaxOther040: number;

  /**
   * Code 043: Tax already withheld from interest / savings accounts.
   * UI-TEAM: Populated from bank statements / Form 867, not from Form 106 salary box.
   */
  withheldTaxInterest043: number;

  // ── Tax credits — point-based (§6) ───────────────────────────────────────
  /**
   * Children for credit-point purposes.
   * Provide an array with each child's age (integer, 0 = birth year).
   * The engine applies gender-appropriate point tables automatically.
   */
  childrenAges: number[];

  /**
   * Codes 131 / 023: Number of disabled children qualifying for the 2-point credit.
   * Income limit is checked automatically using `totalHouseholdIncomeForDisabledChild`.
   * NOTE: Mutually exclusive with `institutionMaintenanceExpenses132_232`.
   */
  disabledChildrenCount131_023: number;

  /**
   * Combined taxpayer + spouse income for the disabled-child income limit check.
   * If the taxpayer is single, use taxpayer income only.
   * Limit: 301,000 ILS (couple) / 188,000 ILS (single parent).
   */
  totalHouseholdIncomeForDisabledChild: number;

  /**
   * Discharged-soldier service type (§6 Codes 324 / 224 / 124 / 024).
   * "full" or "partial" triggers the credit; "none" means not applicable.
   */
  soldierServiceType: SoldierServiceType;

  /**
   * Calendar months elapsed since army discharge date (0 = discharged this month).
   * Credit is valid for up to 36 months from discharge.
   */
  monthsSinceDischarge: number;

  /**
   * Academic degree credit (§6 Codes 181 / 182).
   * Credit starts the tax year AFTER graduation; `yearsActive` is 0 in the first
   * eligible year (the year after graduation).
   */
  academicDegree: {
    type: AcademicDegreeType;
    /** Post-graduation years already consumed (0-based, 0 = first eligible year). */
    yearsActive: number;
  };

  /**
   * New Immigrant (Oleh Chadash) — calendar months elapsed since immigration (§6).
   * Valid only if immigrated after 01.01.2025. Set to 0 if not applicable.
   * The engine computes the current-year credit points automatically.
   */
  olehChadashMonthsElapsed: number;

  // ── Tax credits — direct amount (§6) ────────────────────────────────────
  /**
   * Codes 037 / 237: Donations qualifying for Section 46.
   * Minimum 207 ILS. Gives 35% direct credit, capped at 30% of taxable income
   * (post-disability-exemption).
   */
  donations037_237: number;

  /**
   * Codes 068 / 069: Shift work income in industry.
   * Gives a 15% direct credit on this income (max qualifying income: 143,040 ILS,
   * max credit: 12,540 ILS).
   */
  shiftWorkIncome068_069: number;

  /**
   * Codes 132 / 232: Institution maintenance expenses for a family member.
   * Credit is 35% of the portion exceeding 12.5% of taxable income
   * (post-disability-exemption).
   * NOTE: Mutually exclusive with `disabledChildrenCount131_023`.
   */
  institutionMaintenanceExpenses132_232: number;

  /**
   * Codes 036 / 081: Life insurance premium (risk component only).
   * Direct credit of 25%.
   */
  lifeInsurancePremium036_081: number;

  /**
   * Codes 140 / 240 / 045 / 086: Pension / survivors insurance payments.
   * Direct credit of 35%.
   */
  pensionSurvivorsInsurance140_240: number;

  /**
   * Eilat resident credit (§6 Codes 139 / 183).
   * When true, a 10% direct credit is applied to personal-exertion income
   * produced in Eilat, capped at an income of 268,560 ILS.
   */
  isEilatResident: boolean;

  /**
   * Personal-exertion income produced in Eilat.
   * Only used when `isEilatResident` is true.
   */
  eilatIncome139_183: number;

  /**
   * Security forces "Activity Level A" salary (§6).
   * 5% direct credit on this amount, capped at income of 178,320 ILS.
   */
  securityForcesActivityASalary: number;
}

// ─────────────────────────────────────────────────────────────────────────────
// SECTION 4 — OUTPUT INTERFACE
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Detailed result object returned by `calculateTaxRefund`.
 * All monetary amounts are in ILS.
 */
export interface TaxCalculationResult {
  // ── Intermediate calculations ─────────────────────────────────────────────
  /** Total gross income before any deductions (personal + non-personal). */
  totalGrossIncome: number;

  /** Sum of all deductions that reduce taxable income. */
  totalDeductions: number;

  /**
   * Raw taxable income = totalGrossIncome − totalDeductions.
   * NOTE: This figure INCLUDES flat-rate capital income and is used only for
   * overall reporting. Credit caps are computed against `taxableIncomeForCaps`
   * below, which excludes capital income and is post-disability-exemption.
   */
  taxableIncome: number;

  /**
   * Post-exemption personal-exertion taxable income.
   * This is the correct base for income-derived credit caps (donation 30%,
   * institution 12.5%).  (FIX-1)
   */
  taxableIncomeForCaps: number;

  /**
   * Step 2 result: bracket tax on personal income + flat-rate tax on capital income.
   */
  theoreticalTax: number;

  /** Total value of credit points converted to ILS. */
  totalCreditPointsValue: number;

  /** Total direct monetary credits (donations, shift work, insurance, etc.) */
  totalDirectCredits: number;

  /** Combined credits: creditPointsValue + directCredits. */
  totalCreditsValue: number;

  /**
   * Step 3 result: max(0, theoreticalTax − totalCreditsValue).
   * Cannot be negative.
   */
  actualTax: number;

  /** Total tax already withheld at source (codes 042, 040, 043). */
  totalWithheldTax: number;

  /**
   * Step 4 result: actualTax − totalWithheldTax.
   * Negative → TAX REFUND  (החזר מס).
   * Positive → TAX DEBT    (חוב מס).
   * Zero     → BALANCED.
   */
  finalBalance: number;

  /** "REFUND" | "DEBT" | "BALANCED" */
  outcome: "REFUND" | "DEBT" | "BALANCED";

  // ── Detailed credit-point breakdown (for UI transparency) ────────────────
  creditPointsBreakdown: {
    base: number;
    travel: number;
    singleParent: number;
    children: number;
    disabledChildren: number;
    dischargedSoldier: number;
    academicDegree: number;
    olehChadash: number;
    total: number;
  };

  // ── Warnings ──────────────────────────────────────────────────────────────
  /**
   * Non-fatal warnings the UI should surface to the user.
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
 * Returns the total theoretical tax on that income (ILS).  §3
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

  return tax;
}

/**
 * Computes child credit points for the taxpayer based on ages and gender (§6).
 *
 * Women (and single parents, handled by `isSingleParent` elsewhere) get
 * "Children Points"; men get "Toddler Points" (ages 0–12 only).
 */
function calcChildCreditPoints(ages: number[], gender: Gender): number {
  let points = 0;

  for (const age of ages) {
    if (gender === "female") {
      if (age === 0)                   points += 1.5;
      else if (age >= 1 && age <= 5)   points += 2.5;
      else if (age >= 6 && age <= 12)  points += 2.0;
      else if (age >= 13 && age <= 17) points += 1.0;
      else if (age === 18)             points += 0.5;
      // age > 18: no credit
    } else {
      // Men — Toddler Points only
      if (age === 0)                  points += 1.5;
      else if (age >= 1 && age <= 5)  points += 2.5;
      else if (age >= 6 && age <= 12) points += 1.0;
      // age > 12: no credit for men
    }
  }

  return points;
}

/**
 * Computes discharged-soldier credit points for the current tax year (§6).
 *
 * Credit is valid for 36 months from discharge.
 *   Full service:    1/6 point/month (2 pts/year).
 *   Partial service: 1/12 point/month (1 pt/year).
 *
 * @param serviceType   "full" | "partial" | "none"
 * @param monthsElapsed Calendar months elapsed since discharge (0 = this month).
 */
function calcSoldierCreditPoints(
  serviceType: SoldierServiceType,
  monthsElapsed: number
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
 * PhD / MD:        BA phase first (years 0–2), then MA phase (years 3–4).
 *
 * `yearsActive` = 0 in the first eligible year (the year after graduation).
 */
function calcAcademicCreditPoints(
  degree: TaxDataInput["academicDegree"]
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
 * ── Monthly credit schedule (all indices INCLUSIVE) ─────────────────────────
 *
 *   Month  1–12:  1/12 point per month
 *   Month 13–30:  1/4  point per month
 *   Month 31–42:  1/6  point per month
 *   Month 43–54:  1/12 point per month
 *
 * Convention used throughout this function:
 *   • `monthsElapsed` = 0 means the immigrant arrived this month and has not
 *     yet completed month 1.  Month 1 is complete when monthsElapsed = 1.
 *   • All segment boundaries are expressed as the COMPLETED-month count at which
 *     each segment starts and ends (inclusive on both sides).
 *   • `yearStart` / `yearEnd` are also completed-month counts (inclusive).
 *
 * FIX-4: Previous version mixed inclusive and exclusive conventions, causing
 * off-by-one errors at segment transition months (13, 31, 43).
 *
 * Unit-test fixtures:
 *   monthsElapsed = 6  → yearStart=1, yearEnd=6   → 6 × (1/12)  ≈ 0.500
 *   monthsElapsed = 13 → yearStart=2, yearEnd=13  → 11×(1/12) + 1×(1/4) = 1.167
 *   monthsElapsed = 12 → yearStart=1, yearEnd=12  → 12×(1/12) = 1.000
 *   monthsElapsed = 30 → yearStart=19,yearEnd=30  → 12×(1/4)  = 3.000
 *   monthsElapsed = 54 → yearStart=43,yearEnd=54  → 12×(1/12) = 1.000
 */
function calcOlehChadashPoints(monthsElapsed: number): number {
  if (monthsElapsed <= 0) return 0;

  // Segments: [firstMonth (inclusive), lastMonth (inclusive), pointsPerMonth]
  const segments: Array<[number, number, number]> = [
    [1,  12, 1 / 12],
    [13, 30, 1 / 4 ],
    [31, 42, 1 / 6 ],
    [43, 54, 1 / 12],
  ];

  // The "current tax year" covers the 12 completed months ending at monthsElapsed.
  // yearStart is never lower than 1 (can't be in month 0).
  const yearEnd   = Math.min(54, monthsElapsed);
  const yearStart = Math.max(1, yearEnd - 11);

  let points = 0;

  for (const [segFirst, segLast, rate] of segments) {
    // Overlap between [yearStart, yearEnd] and [segFirst, segLast] — both inclusive.
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
 *  - Base rate: 3.5% of salary (capped at salary of 376,080 ILS).
 *  - If employer pension contribution > 4%:  effective rate = 3.5% − excess%.
 *  - If employer pension contribution > 7.5%: NO deduction.
 */
function calcLossOfEarningDeduction(
  premiumPaid: number,
  grossSalary: number,
  employerPensionPct: number
): number {
  if (employerPensionPct > 7.5) return 0;

  const SALARY_CAP = 376_080;
  const BASE_RATE  = 0.035;

  const effectiveRate =
    employerPensionPct > 4
      ? BASE_RATE - (employerPensionPct - 4) / 100
      : BASE_RATE;

  if (effectiveRate <= 0) return 0;

  const cappedSalary = Math.min(grossSalary, SALARY_CAP);
  const maxDeduction = cappedSalary * effectiveRate;

  return Math.min(premiumPaid, maxDeduction);
}

/**
 * Computes the renewable-energy rent tax (§7 Code 335).
 *
 * Up to 5,000 ILS: fully exempt.
 * Over 5,000 ILS:  31% tax on the portion above 5,000 ILS.
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

  // ── Gambling / lotteries warning (FIX-5) ─────────────────────────────────
  // Code 227 income is listed in §4 but no flat rate is provided by the rules
  // document. We emit a warning and exclude it from tax calculations.
  if (data.gamblingLotteryIncome227 > 0) {
    warnings.push(
      "Code 227 (gambling / lotteries / prizes): the rules document does not " +
      "specify a flat tax rate for this income. It has been excluded from the " +
      "calculation. Please consult a tax advisor or check the ITA simulator directly."
    );
  }

  // ── Derived convenience values ────────────────────────────────────────────
  // "Salary" for deduction-limit purposes (personal exertion only, before deductions).
  const totalSalary =
    data.grossIncome158 +
    data.grossIncome172 +
    data.otherPersonalIncome150_170 +
    data.bituachLeumiIncome250_270_194_196;

  // ── STEP 1: Deductions → Taxable Income ──────────────────────────────────

  // 1a. Loss-of-earning-capacity insurance deduction (§5)
  const lossOfEarningDeduction = calcLossOfEarningDeduction(
    data.lossOfEarningPremium112_113,
    totalSalary,
    data.employerPensionContributionPct
  );

  if (
    data.lossOfEarningPremium112_113 > 0 &&
    data.employerPensionContributionPct > 7.5
  ) {
    warnings.push(
      "Loss-of-earning-capacity deduction disallowed: employer pension " +
      "contribution exceeds 7.5%."
    );
  }

  // 1b. Provident-fund / pension deduction as independent (§5).  FIX-3
  //     Capped at the LOWER of:
  //       (a) 11% of gross salary income, or
  //       (b) the hard monetary ceiling (PROVIDENT_FUND_MAX_ILS = 11,880 ILS).
  const providentFundDeduction = Math.min(
    data.providentFundPension135_180,
    totalSalary * 0.11,
    PROVIDENT_FUND_MAX_ILS           // ← monetary cap added (FIX-3)
  );

  // 1c. Bituach Leumi independent deduction (§5): 52% of payments.
  const bituachLeumiDeduction = data.bituachLeumiIndependent030_089 * 0.52;

  const totalDeductions =
    lossOfEarningDeduction +
    providentFundDeduction +
    bituachLeumiDeduction;

  // 1d. Personal-exertion income before disability exemption.
  const personalExertionIncomeRaw =
    totalSalary + data.severancePension258_272;

  // 1e. Apply deductions to arrive at pre-exemption taxable personal income.
  const taxablePersonalIncomePreExemption = Math.max(
    0,
    personalExertionIncomeRaw - totalDeductions
  );

  // 1f. Disability / blindness exemption (§7 Codes 109 / 309).
  let disabilityExemptionApplied = 0;
  let taxablePersonalIncome      = taxablePersonalIncomePreExemption;

  if (data.isFullDisability) {
    const exemptCeiling = data.isModDefenseOrTerrorVictim ? 684_000 : 445_200;
    disabilityExemptionApplied = Math.min(taxablePersonalIncome, exemptCeiling);
    taxablePersonalIncome      = Math.max(
      0,
      taxablePersonalIncome - disabilityExemptionApplied
    );

    if (disabilityExemptionApplied > 0) {
      warnings.push(
        `Disability / blindness exemption applied: ` +
        `${disabilityExemptionApplied.toFixed(2)} ILS of personal income ` +
        `is tax-exempt (Code 109/309).`
      );
    }
  }

  // ── taxableIncomeForCaps ────────────────────────────────────────────────
  // FIX-1: Credit caps that are expressed as a % of "taxable income" in the
  // rules document refer to the taxpayer's personal-exertion taxable base,
  // AFTER the disability exemption. Capital income (rent, interest) is taxed
  // at flat rates and is NOT part of the cap base.
  //
  // This variable is the single authoritative base for:
  //   • Donation credit cap (30% of taxableIncomeForCaps, §6 Codes 037/237)
  //   • Institution maintenance threshold (12.5% of taxableIncomeForCaps, §6 Codes 132/232)
  const taxableIncomeForCaps = taxablePersonalIncome;

  // ── Total gross income (for reporting and severance cap check) ────────────
  const totalGrossIncome =
    personalExertionIncomeRaw +
    data.residentialRentIncome222 +
    data.gamblingLotteryIncome227 + // included in gross even if not taxed
    data.interestDividends060 +
    data.interestDividends067_126 +
    data.interestDividends157_141_142 +
    data.interest050 +
    data.renewableEnergyRent335;

  // ── taxableIncome (reporting only) ───────────────────────────────────────
  // This is the broad "all income minus deductions" figure for display purposes.
  // Do NOT use this for credit caps — use `taxableIncomeForCaps` instead.
  const taxableIncome = Math.max(0, totalGrossIncome - totalDeductions);

  // ── STEP 2: Theoretical Tax ───────────────────────────────────────────────

  // 2a. Bracket tax on post-exemption personal-exertion income.
  let bracketTax = calcBracketTax(taxablePersonalIncome);

  // 2b. Severance / pension 40% cap (§4 Codes 258/272).  FIX-2
  //
  //     The cap applies if total GROSS income < 560,280 ILS.
  //     Baseline ("tax without severance") is now computed against
  //     `taxablePersonalIncome` (post-exemption) minus severance, so that the
  //     disability exemption is not double-counted.
  if (
    data.severancePension258_272 > 0 &&
    totalGrossIncome < 560_280
  ) {
    // Tax attributable only to non-severance personal income (post-exemption).
    const taxablePersonalWithoutSeverance = Math.max(
      0,
      taxablePersonalIncome - data.severancePension258_272
    );
    const taxWithoutSeverance    = calcBracketTax(taxablePersonalWithoutSeverance);
    const severanceTaxUnderBrackets = bracketTax - taxWithoutSeverance;
    const severanceTaxIfCapped      = data.severancePension258_272 * 0.40;

    if (severanceTaxUnderBrackets > severanceTaxIfCapped) {
      bracketTax = taxWithoutSeverance + severanceTaxIfCapped;
      warnings.push(
        "Severance/pension income capped at 40% effective tax rate " +
        "(total gross income < 560,280 ILS)."
      );
    }
  }

  // 2c. Flat-rate taxes on non-personal-exertion income (§4).
  const rentTax       = data.residentialRentIncome222     * 0.10;
  const interest15Tax = data.interestDividends060          * 0.15;
  const interest20Tax = data.interestDividends067_126      * 0.20;
  const interest25Tax = data.interestDividends157_141_142  * 0.25;
  const interest35Tax = data.interest050                   * 0.35;
  const renewableTax  = calcRenewableEnergyRentTax(data.renewableEnergyRent335);

  const flatRateTax =
    rentTax +
    interest15Tax +
    interest20Tax +
    interest25Tax +
    interest35Tax +
    renewableTax;

  const theoreticalTax = bracketTax + flatRateTax;

  // ── STEP 3: Credits → Actual Tax ─────────────────────────────────────────

  // 3a. Base credit points (§2).
  const basePoints   = BASE_POINTS[data.gender];
  const travelPoints = TRAVEL_TO_WORK_POINTS;

  // 3b. Single-parent extra point (§6 Code 026).
  const singleParentPoints = data.isSingleParent ? 1.0 : 0;

  // 3c. Children credit points (§6).
  const childrenPoints = calcChildCreditPoints(data.childrenAges, data.gender);

  // 3d. Disabled-child credit points (§6 Codes 131/023).
  //     2 extra points per child; income limit check.
  let disabledChildPoints = 0;
  if (data.disabledChildrenCount131_023 > 0) {
    const incomeLimit = data.isSingleParent ? 188_000 : 301_000;

    if (data.institutionMaintenanceExpenses132_232 > 0) {
      warnings.push(
        "Disabled-child credit (Code 131) and Institution Maintenance credit " +
        "(Code 132) cannot both be claimed. Only the Institution Maintenance " +
        "credit will be applied."
      );
    } else if (data.totalHouseholdIncomeForDisabledChild > incomeLimit) {
      warnings.push(
        `Disabled-child credit disallowed: household income ` +
        `(${data.totalHouseholdIncomeForDisabledChild.toFixed(0)} ILS) ` +
        `exceeds the limit of ${incomeLimit.toLocaleString()} ILS.`
      );
    } else {
      disabledChildPoints = data.disabledChildrenCount131_023 * 2;
    }
  }

  // 3e. Discharged-soldier credit points (§6).
  const soldierPoints = calcSoldierCreditPoints(
    data.soldierServiceType,
    data.monthsSinceDischarge
  );

  // 3f. Academic degree credit points (§6).
  const academicPoints = calcAcademicCreditPoints(data.academicDegree);

  // 3g. Oleh Chadash credit points (§6) — FIX-4 applied in the helper.
  const olehPoints = calcOlehChadashPoints(data.olehChadashMonthsElapsed);

  // 3h. Total credit points → monetary value.
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

  // 3i. Direct monetary credits ──────────────────────────────────────────────

  // Donations — Section 46 (§6 Codes 037/237).
  // Cap is 30% of taxableIncomeForCaps (post-exemption personal income).  FIX-1
  let donationCredit = 0;
  if (data.donations037_237 >= 207) {
    const donationCap        = Math.min(taxableIncomeForCaps * 0.30, 10_354_846);
    const qualifyingDonation = Math.min(data.donations037_237, donationCap);
    donationCredit           = qualifyingDonation * 0.35;
  } else if (data.donations037_237 > 0) {
    warnings.push(
      `Donations credit disallowed: amount (${data.donations037_237} ILS) ` +
      `is below the 207 ILS minimum.`
    );
  }

  // Shift work in industry (§6 Codes 068/069).
  const shiftWorkCap          = 143_040;
  const shiftWorkMaxCredit    = 12_540;
  const qualifyingShiftIncome = Math.min(data.shiftWorkIncome068_069, shiftWorkCap);
  const shiftWorkCredit       = Math.min(
    qualifyingShiftIncome * 0.15,
    shiftWorkMaxCredit
  );

  // Institution maintenance (§6 Codes 132/232).
  // Threshold is 12.5% of taxableIncomeForCaps (post-exemption).  FIX-1
  let institutionCredit = 0;
  if (
    data.institutionMaintenanceExpenses132_232 > 0 &&
    data.disabledChildrenCount131_023 === 0
  ) {
    const threshold          = taxableIncomeForCaps * 0.125;
    const qualifyingExpenses = Math.max(
      0,
      data.institutionMaintenanceExpenses132_232 - threshold
    );
    institutionCredit = qualifyingExpenses * 0.35;
  }

  // Life insurance (§6 Codes 036/081): 25% of risk premium.
  const lifeInsuranceCredit = data.lifeInsurancePremium036_081 * 0.25;

  // Pension / survivors insurance (§6 Codes 140/240/045/086): 35%.
  const pensionCredit = data.pensionSurvivorsInsurance140_240 * 0.35;

  // Eilat resident (§6 Codes 139/183): 10% on Eilat income, cap at 268,560.
  let eilatCredit = 0;
  if (data.isEilatResident) {
    const eilatIncomeCapped = Math.min(data.eilatIncome139_183, 268_560);
    eilatCredit             = eilatIncomeCapped * 0.10;
  }

  // Security forces Activity Level A (§6): 5%, cap at income of 178,320.
  const securityForcesIncomeCapped = Math.min(
    data.securityForcesActivityASalary,
    178_320
  );
  const securityForcesCredit = securityForcesIncomeCapped * 0.05;

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

  // ── STEP 4: Final Balance ─────────────────────────────────────────────────
  //
  // UI-TEAM REMINDER: ensure form fields map to these three variables correctly:
  //   withheldTaxSalary042   ← Code 042 from Form 106 (salary withholding)
  //   withheldTaxOther040    ← Code 040 from Form 106 (other income withholding)
  //   withheldTaxInterest043 ← Code 043 from bank / Form 867 (interest withholding)
  const totalWithheldTax =
    data.withheldTaxSalary042 +
    data.withheldTaxOther040 +
    data.withheldTaxInterest043;

  const finalBalance = actualTax - totalWithheldTax;

  // ── Outcome label ─────────────────────────────────────────────────────────
  let outcome: TaxCalculationResult["outcome"];
  if      (finalBalance < 0) outcome = "REFUND";
  else if (finalBalance > 0) outcome = "DEBT";
  else                       outcome = "BALANCED";

  // ── Return full result ────────────────────────────────────────────────────
  return {
    totalGrossIncome,
    totalDeductions,
    taxableIncome,
    taxableIncomeForCaps,         // FIX-1: exposed for UI transparency
    theoreticalTax,
    totalCreditPointsValue,
    totalDirectCredits,
    totalCreditsValue,
    actualTax,
    totalWithheldTax,
    finalBalance,
    outcome,
    creditPointsBreakdown: {
      base:             basePoints,
      travel:           travelPoints,
      singleParent:     singleParentPoints,
      children:         childrenPoints,
      disabledChildren: disabledChildPoints,
      dischargedSoldier: soldierPoints,
      academicDegree:   academicPoints,
      olehChadash:      olehPoints,
      total:            totalCreditPoints,
    },
    warnings,
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// SECTION 7 — UTILITY: EMPTY INPUT FACTORY
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Returns a zeroed-out `TaxDataInput` with safe defaults.
 * Useful as the Zustand initial state to avoid null checks throughout the UI.
 *
 * All new fields introduced in this revision (e.g. `gamblingLotteryIncome227`)
 * are included here so callers always receive a structurally complete object.
 */
export function createEmptyTaxInput(gender: Gender = "male"): TaxDataInput {
  return {
    gender,
    isSingleParent:                         false,
    grossIncome158:                          0,
    grossIncome172:                          0,
    otherPersonalIncome150_170:              0,
    severancePension258_272:                 0,
    bituachLeumiIncome250_270_194_196:       0,
    residentialRentIncome222:                0,
    gamblingLotteryIncome227:                0,   // FIX-5: field now exists
    interestDividends060:                    0,
    interestDividends067_126:                0,
    interestDividends157_141_142:            0,
    interest050:                             0,
    renewableEnergyRent335:                  0,
    isFullDisability:                        false,
    isModDefenseOrTerrorVictim:              false,
    lossOfEarningPremium112_113:             0,
    employerPensionContributionPct:          0,
    providentFundPension135_180:             0,
    bituachLeumiIndependent030_089:          0,
    withheldTaxSalary042:                    0,   // Code 042 — salary
    withheldTaxOther040:                     0,   // Code 040 — other income
    withheldTaxInterest043:                  0,   // Code 043 — interest/savings
    childrenAges:                            [],
    disabledChildrenCount131_023:            0,
    totalHouseholdIncomeForDisabledChild:    0,
    soldierServiceType:                      "none",
    monthsSinceDischarge:                    0,
    academicDegree:                          { type: "none", yearsActive: 0 },
    olehChadashMonthsElapsed:                0,
    donations037_237:                        0,
    shiftWorkIncome068_069:                  0,
    institutionMaintenanceExpenses132_232:   0,
    lifeInsurancePremium036_081:             0,
    pensionSurvivorsInsurance140_240:        0,
    isEilatResident:                         false,
    eilatIncome139_183:                      0,
    securityForcesActivityASalary:           0,
  };
}
