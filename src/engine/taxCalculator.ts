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
  { ceiling: 84_120,    rate: 0.10 },
  { ceiling: 120_720,   rate: 0.14 },
  { ceiling: 193_800,   rate: 0.20 },
  { ceiling: 273_360,   rate: 0.31 },
  { ceiling: 589_320,   rate: 0.35 },
  { ceiling: 759_000,   rate: 0.47 },
  { ceiling: Infinity,  rate: 0.50 }, // includes 3 % surtax
];

// ─────────────────────────────────────────────────────────────────────────────
// SECTION 2 — ENUMS & SUPPORTING TYPES
// ─────────────────────────────────────────────────────────────────────────────

/** The taxpayer's gender — drives base credit points (§2) */
export type Gender = "male" | "female";

/**
 * Academic degree types for the education credit (§6).
 * "none"     → no credit.
 * "ba"       → 1 pt/year, up to 3 years.
 * "ma"       → 0.5 pts/year, up to 2 years.
 * "phd_md"   → treated as BA then MA (handled in caller logic).
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
 * Field naming convention:  <description><FormCode(s)>
 * Monetary fields default to 0 when omitted.
 * Boolean flags default to false when omitted.
 */
export interface TaxDataInput {
  // ── Taxpayer profile ────────────────────────────────────────────────────
  gender: Gender;

  /**
   * Whether the taxpayer is a single parent not cohabiting with a partner (§6 Code 026).
   * Grants 1 extra credit point.
   */
  isSingleParent: boolean;

  // ── Personal-exertion income (§4 — taxed via brackets) ──────────────────
  /**
   * Code 158: Registered spouse gross salary (main salary for most employees).
   * This is the primary personal-exertion income field.
   */
  grossIncome158: number;

  /**
   * Code 172: Unregistered spouse gross salary.
   */
  grossIncome172: number;

  /**
   * Codes 150 / 170: Other personal-exertion income (author, lecturer, director, etc.)
   */
  otherPersonalIncome150_170: number;

  /**
   * Codes 258 / 272: Taxable severance / pension lump sum (מענקי פרישה).
   * NOTE: Capped at 40 % effective tax rate when total income < 560,280 ILS.
   * The engine applies this cap automatically.
   */
  severancePension258_272: number;

  /**
   * Codes 250 / 270 / 194 / 196: Taxable Bituach Leumi benefits
   * (maternity, reserve duty, unemployment).
   */
  bituachLeumiIncome250_270_194_196: number;

  // ── Non-personal-exertion income (§4 — flat rates) ──────────────────────
  /** Code 222: Rent from residential property. Flat 10 % tax. */
  residentialRentIncome222: number;

  /** Code 060: Interest / dividends. Flat 15 % tax. */
  interestDividends060: number;

  /** Codes 067 / 126: Interest / dividends. Flat 20 % tax. */
  interestDividends067_126: number;

  /** Codes 157 / 141 / 142: Interest / dividends. Flat 25 % tax. */
  interestDividends157_141_142: number;

  /** Code 050: Interest. Flat 35 % tax. */
  interest050: number;

  // ── Renewable-energy rent exemption (§7 Code 335) ───────────────────────
  /**
   * Code 335: Rent income from renewable energy.
   * First 5,000 ILS exempt; remainder taxed at 31 % (sliding scale).
   */
  renewableEnergyRent335: number;

  // ── Disability / blindness exemption (§7 Codes 109 / 309) ───────────────
  /**
   * Whether the taxpayer has 100 % disability or blindness.
   * When true, personal-exertion income up to 445,200 ILS is exempt from tax.
   */
  isFullDisability: boolean;

  /**
   * Whether the taxpayer is a Ministry of Defense / terror victim (§7).
   * Raises the disability exemption ceiling from 445,200 to 684,000 ILS.
   * Only relevant when `isFullDisability` is true.
   */
  isModDefenseOrTerrorVictim: boolean;

  // ── Deductions (§5) — reduce Taxable Income ─────────────────────────────
  /**
   * Codes 112 / 113 / 206 / 207: Loss-of-earning-capacity insurance premium paid.
   * Deduction is min(premiumPaid, 3.5 % of salary capped at 376,080).
   * Reduced or eliminated if employer pension contribution is > 4 % or > 7.5 %.
   */
  lossOfEarningPremium112_113: number;

  /**
   * Employer pension contribution percentage (0–100).
   * Used to determine whether the loss-of-earning-capacity deduction is
   * reduced (> 4 %) or fully disallowed (> 7.5 %).
   */
  employerPensionContributionPct: number;

  /**
   * Codes 135 / 180: Provident-fund / pension contributions as an independent.
   * Deduction up to 11 % of income.
   */
  providentFundPension135_180: number;

  /**
   * Codes 030 / 089: Bituach Leumi payments as an independent.
   * 52 % of these payments (excluding fines/health tax) are deductible.
   */
  bituachLeumiIndependent030_089: number;

  // ── Withheld taxes (§4 — reduce Final Balance) ───────────────────────────
  /** Code 042: Tax already withheld from salary. */
  withheldTaxSalary042: number;

  /** Code 040: Tax already withheld from other incomes. */
  withheldTaxOther040: number;

  /** Code 043: Tax already withheld from interest / savings. */
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
   * Income limit is checked automatically using `totalHouseholdIncome` below.
   */
  disabledChildrenCount131_023: number;

  /**
   * Combined taxpayer + spouse income, used for the disabled-child income limit check.
   * If the taxpayer is single, use taxpayer income only.
   */
  totalHouseholdIncomeForDisabledChild: number;

  /**
   * Discharged-soldier service type (§6 Codes 324 / 224 / 124 / 024).
   * "full" or "partial" triggers the credit; "none" means not applicable.
   */
  soldierServiceType: SoldierServiceType;

  /**
   * Number of months elapsed since army discharge (used with soldierServiceType).
   * Credit is valid for up to 36 months from discharge.
   * The engine computes how many of those months fall within this tax year.
   */
  monthsSinceDischarge: number;

  /**
   * Academic degree credit (§6 Codes 181 / 182).
   * Provide the degree type and how many years the credit has been active
   * AFTER graduation (credit starts the year AFTER graduation).
   */
  academicDegree: {
    type: AcademicDegreeType;
    /** Number of post-graduation years already consumed (0-based). */
    yearsActive: number;
  };

  /**
   * New Immigrant (Oleh Chadash) — number of months elapsed since immigration (§6).
   * Valid only if immigrated after 01.01.2025. Engine computes points automatically.
   * Set to 0 if not applicable.
   */
  olehChadashMonthsElapsed: number;

  // ── Tax credits — direct amount (§6) ─────────────────────────────────────
  /**
   * Codes 037 / 237: Donations qualifying for Section 46.
   * Minimum 207 ILS. Gives 35 % direct credit, capped at 30 % of taxable income.
   */
  donations037_237: number;

  /**
   * Codes 068 / 069: Shift work income in industry.
   * Gives a 15 % direct credit on this income (max qualifying income: 143,040).
   */
  shiftWorkIncome068_069: number;

  /**
   * Codes 132 / 232: Institution maintenance expenses for a family member.
   * Credit is 35 % of the portion exceeding 12.5 % of taxable income.
   * NOTE: Cannot be claimed together with `disabledChildrenCount131_023`.
   */
  institutionMaintenanceExpenses132_232: number;

  /**
   * Codes 036 / 081: Life insurance premium (risk component only).
   * Direct credit of 25 %.
   */
  lifeInsurancePremium036_081: number;

  /**
   * Codes 140 / 240 / 045 / 086: Pension / survivors insurance payments.
   * Direct credit of 35 %.
   */
  pensionSurvivorsInsurance140_240: number;

  /**
   * Eilat resident credit (§6 Codes 139 / 183).
   * When true, a 10 % direct credit is applied to personal-exertion income
   * produced in Eilat, capped at an income of 268,560 ILS.
   */
  isEilatResident: boolean;

  /**
   * Income produced in Eilat (used only when isEilatResident is true).
   */
  eilatIncome139_183: number;

  /**
   * Security forces "Activity Level A" salary (§6).
   * 5 % direct credit on this amount, capped at income of 178,320 ILS.
   */
  securityForcesActivityASalary: number;
}

// ─────────────────────────────────────────────────────────────────────────────
// SECTION 4 — OUTPUT INTERFACE
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Detailed result object returned by `calculateTaxRefund`.
 *
 * All monetary amounts are in ILS.
 */
export interface TaxCalculationResult {
  // ── Intermediate calculations ────────────────────────────────────────────
  /** Total gross income before any deductions (personal + non-personal). */
  totalGrossIncome: number;

  /** Sum of all deductions that reduce taxable income. */
  totalDeductions: number;

  /**
   * Step 1 result: Gross Income − Deductions.
   * Base for bracket calculation and credit caps.
   */
  taxableIncome: number;

  /**
   * Step 2 result: tax computed from brackets on personal-exertion income
   * plus flat-rate taxes on non-personal income.
   */
  theoreticalTax: number;

  /** Total value of credit points (base + special), converted to ILS. */
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
   * Negative  → TAX REFUND  (החזר מס).
   * Positive  → TAX DEBT    (חוב מס).
   * Zero      → BALANCED.
   */
  finalBalance: number;

  /**
   * Human-readable outcome label.
   * "REFUND" | "DEBT" | "BALANCED"
   */
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

  // ── Warning messages (limits hit, unsupported scenarios) ─────────────────
  /**
   * Non-fatal warnings the UI should surface to the user.
   * E.g. when a credit was disallowed due to an income limit, or
   * when a scenario falls outside the rules document's explicit coverage.
   */
  warnings: string[];
}

// ─────────────────────────────────────────────────────────────────────────────
// SECTION 5 — PURE HELPER FUNCTIONS
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Applies the progressive tax brackets to the given personal-exertion income.
 * Returns the total theoretical tax on that income (ILS).
 *
 * The brackets are defined in §3 of the rules document.
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
 * Computes the child credit points for the taxpayer based on the children's
 * ages and the taxpayer's gender (§6).
 *
 * Women (and single parents, handled separately) receive "Children Points".
 * Men receive "Toddler Points" (only for ages 0–12).
 *
 * Age 0  = birth year.
 * Ages 1–5   = early childhood.
 * Ages 6–12  = school age (both genders).
 * Ages 13–17 = teens (women only).
 * Age 18     = leaving age (women only, 0.5 pts).
 */
function calcChildCreditPoints(ages: number[], gender: Gender): number {
  let points = 0;

  for (const age of ages) {
    if (gender === "female") {
      // Women's "Children Points" table
      if (age === 0)              points += 1.5;
      else if (age >= 1 && age <= 5)  points += 2.5;
      else if (age >= 6 && age <= 12) points += 2.0;
      else if (age >= 13 && age <= 17) points += 1.0;
      else if (age === 18)        points += 0.5;
      // Ages > 18: no credit
    } else {
      // Men's "Toddler Points" table (§6)
      if (age === 0)              points += 1.5;
      else if (age >= 1 && age <= 5) points += 2.5;
      else if (age >= 6 && age <= 12) points += 1.0;
      // Ages > 12: no credit for men
    }
  }

  return points;
}

/**
 * Computes the discharged-soldier credit points for the current tax year (§6).
 *
 * The credit is valid for 36 months from discharge.
 * Full service: 1/6 point per month (= 2 pts/year).
 * Partial service: 1/12 point per month (= 1 pt/year).
 *
 * We compute how many of the 12 months of this tax year fall within the
 * 36-month eligibility window.
 *
 * @param serviceType   "full" | "partial" | "none"
 * @param monthsElapsed Number of calendar months elapsed since discharge date.
 *                      0 = discharged this month; 36 = just expired.
 */
function calcSoldierCreditPoints(
  serviceType: SoldierServiceType,
  monthsElapsed: number
): number {
  if (serviceType === "none") return 0;

  // Months still eligible: up to 36 total from discharge
  const remainingEligibleMonths = Math.max(0, 36 - monthsElapsed);
  // We grant credit for the months within THIS tax year that are still eligible.
  // Simplification: treat the tax year as 12 months; clamp eligible months to [0,12].
  const eligibleMonthsThisYear = Math.min(12, remainingEligibleMonths);

  if (eligibleMonthsThisYear <= 0) return 0;

  const ratePerMonth = serviceType === "full" ? 1 / 6 : 1 / 12;
  return eligibleMonthsThisYear * ratePerMonth;
}

/**
 * Computes the academic-degree credit points for the current tax year (§6).
 *
 * BA / Professional Certificate: 1 point/year, max 3 years.
 * MA:                            0.5 points/year, max 2 years.
 * Direct PhD / MD: treated as BA (3 yrs) then MA (2 yrs).
 *
 * The credit starts the year AFTER graduation; `yearsActive` represents
 * how many post-graduation years have already passed (0 = first eligible year).
 *
 * Returns points for the CURRENT year only (0 if outside the window).
 */
function calcAcademicCreditPoints(
  degree: TaxDataInput["academicDegree"]
): number {
  const { type, yearsActive } = degree;
  if (type === "none") return 0;

  if (type === "ba") {
    // 1 point per year, years 0–2 (3 years total)
    return yearsActive >= 0 && yearsActive < 3 ? 1.0 : 0;
  }

  if (type === "ma") {
    // 0.5 points per year, years 0–1 (2 years total)
    return yearsActive >= 0 && yearsActive < 2 ? 0.5 : 0;
  }

  if (type === "phd_md") {
    // BA phase: years 0–2 → 1 pt each; MA phase: years 3–4 → 0.5 pts each
    if (yearsActive >= 0 && yearsActive < 3) return 1.0;
    if (yearsActive >= 3 && yearsActive < 5) return 0.5;
    return 0;
  }

  return 0;
}

/**
 * Computes Oleh Chadash (new immigrant) credit points for the current tax year (§6).
 *
 * Schedule (months elapsed since immigration, rate per month):
 *   Months  1–12:  1/12 point/month
 *   Months 13–30:  1/4  point/month
 *   Months 31–42:  1/6  point/month
 *   Months 43–54:  1/12 point/month
 *
 * Valid only for immigrants who arrived after 01.01.2025.
 * `monthsElapsed` = 0 means the immigrant just arrived.
 *
 * Returns the total points earned in the CURRENT tax year.
 */
function calcOlehChadashPoints(monthsElapsed: number): number {
  if (monthsElapsed <= 0) return 0;

  // The monthly credit schedule as [startMonth, endMonth (exclusive), rate]
  const schedule: Array<[number, number, number]> = [
    [1,  13, 1 / 12],
    [13, 31, 1 / 4],
    [31, 43, 1 / 6],
    [43, 55, 1 / 12],
  ];

  // Which months of the 54-month window fall in the CURRENT tax year?
  // Current year = months (monthsElapsed - 11) through monthsElapsed (last 12 months).
  const yearStart = Math.max(1, monthsElapsed - 11);
  const yearEnd   = Math.min(54, monthsElapsed);

  let points = 0;
  for (const [segStart, segEnd, rate] of schedule) {
    const overlapStart = Math.max(yearStart, segStart);
    const overlapEnd   = Math.min(yearEnd, segEnd - 1); // segEnd is exclusive in months
    if (overlapEnd >= overlapStart) {
      points += (overlapEnd - overlapStart + 1) * rate;
    }
  }

  return points;
}

/**
 * Computes the loss-of-earning-capacity insurance deduction (§5).
 *
 * Rules:
 *  - Base deduction = min(premiumPaid, 3.5 % of salary, 3.5 % of 376,080).
 *  - If employer pension contribution > 4 %: reduce the 3.5 % by the excess
 *    (e.g., employer contributes 5 % → allowed deduction rate = 3.5 % − 1 % = 2.5 %).
 *  - If employer pension contribution > 7.5 %: NO deduction.
 */
function calcLossOfEarningDeduction(
  premiumPaid: number,
  grossSalary: number,
  employerPensionPct: number
): number {
  if (employerPensionPct > 7.5) return 0;

  const SALARY_CAP = 376_080;
  const BASE_RATE  = 0.035;

  // Effective rate after employer-contribution reduction
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
 * Up to 5,000 ILS is fully exempt.
 * Over 5,000 ILS: taxed at 31 % on the portion above 5,000 ILS (sliding scale).
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

  // ── Derived convenience values ──────────────────────────────────────────
  const totalSalary =
    data.grossIncome158 +
    data.grossIncome172 +
    data.otherPersonalIncome150_170 +
    data.bituachLeumiIncome250_270_194_196;

  // ── STEP 1: Deductions → Taxable Income ─────────────────────────────────

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
      "Loss-of-earning-capacity deduction disallowed: employer pension contribution exceeds 7.5 %."
    );
  }

  // 1b. Provident-fund / pension deduction as independent (§5)
  //     Capped at 11 % of income. The rules document says "up to 11 % … capped"
  //     but does not specify the exact monetary cap beyond the percentage.
  //     We apply 11 % of gross salary as the ceiling.
  const providentFundDeduction = Math.min(
    data.providentFundPension135_180,
    totalSalary * 0.11
  );

  // 1c. Bituach Leumi independent deduction (§5): 52 % of payments
  const bituachLeumiDeduction = data.bituachLeumiIndependent030_089 * 0.52;

  const totalDeductions =
    lossOfEarningDeduction +
    providentFundDeduction +
    bituachLeumiDeduction;

  // 1d. Disability / blindness exemption (§7)
  let personalExertionIncomeForBrackets =
    totalSalary + data.severancePension258_272;

  let taxablePersonalIncome = Math.max(
    0,
    personalExertionIncomeForBrackets - totalDeductions
  );

  if (data.isFullDisability) {
    const exemptCeiling = data.isModDefenseOrTerrorVictim ? 684_000 : 445_200;
    const exemptAmount  = Math.min(taxablePersonalIncome, exemptCeiling);
    taxablePersonalIncome = Math.max(0, taxablePersonalIncome - exemptAmount);

    if (exemptAmount > 0) {
      warnings.push(
        `Disability / blindness exemption applied: ${exemptAmount.toFixed(2)} ILS of personal income is tax-exempt.`
      );
    }
  }

  // Total gross income (personal + capital)
  const totalGrossIncome =
    personalExertionIncomeForBrackets +
    data.residentialRentIncome222 +
    data.interestDividends060 +
    data.interestDividends067_126 +
    data.interestDividends157_141_142 +
    data.interest050 +
    data.renewableEnergyRent335;

  // Taxable income (used for credit caps etc.)
  const taxableIncome = Math.max(
    0,
    totalGrossIncome - totalDeductions
  );

  // ── STEP 2: Theoretical Tax ──────────────────────────────────────────────

  // 2a. Bracket tax on personal-exertion income
  let bracketTax = calcBracketTax(taxablePersonalIncome);

  // 2b. Severance / pension 40 % cap (§4 Codes 258/272)
  //     The cap applies if total income (pre-deduction) < 560,280 ILS.
  if (
    data.severancePension258_272 > 0 &&
    totalGrossIncome < 560_280
  ) {
    const severanceTaxIfCapped = data.severancePension258_272 * 0.40;
    // Tax attributable to severance under normal brackets
    const taxWithoutSeverance  = calcBracketTax(
      Math.max(0, taxablePersonalIncome - data.severancePension258_272)
    );
    const severanceTaxUnderBrackets = bracketTax - taxWithoutSeverance;

    if (severanceTaxUnderBrackets > severanceTaxIfCapped) {
      bracketTax =
        taxWithoutSeverance + severanceTaxIfCapped;
      warnings.push(
        "Severance/pension income is capped at 40 % effective tax rate (total income < 560,280 ILS)."
      );
    }
  }

  // 2c. Flat-rate taxes on non-personal-exertion income (§4)
  const rentTax        = data.residentialRentIncome222    * 0.10;
  const interest15Tax  = data.interestDividends060         * 0.15;
  const interest20Tax  = data.interestDividends067_126     * 0.20;
  const interest25Tax  = data.interestDividends157_141_142 * 0.25;
  const interest35Tax  = data.interest050                  * 0.35;
  const renewableTax   = calcRenewableEnergyRentTax(data.renewableEnergyRent335);

  // Code 227 (gambling / lotteries / prizes) — §4 lists this code but does NOT
  // specify a flat rate in the provided rules document. We flag it as unsupported.
  // (A future rules update may supply the rate.)

  const flatRateTax =
    rentTax +
    interest15Tax +
    interest20Tax +
    interest25Tax +
    interest35Tax +
    renewableTax;

  const theoreticalTax = bracketTax + flatRateTax;

  // ── STEP 3: Credits → Actual Tax ────────────────────────────────────────

  // 3a. Base credit points (§2)
  const basePoints   = BASE_POINTS[data.gender];
  const travelPoints = TRAVEL_TO_WORK_POINTS;

  // 3b. Single-parent extra point (§6 Code 026)
  const singleParentPoints = data.isSingleParent ? 1.0 : 0;

  // 3c. Children credit points (§6)
  const childrenPoints = calcChildCreditPoints(data.childrenAges, data.gender);

  // 3d. Disabled-child credit points (§6 Codes 131/023)
  //     2 extra points per child; income limit check
  let disabledChildPoints = 0;
  if (data.disabledChildrenCount131_023 > 0) {
    const incomeLimit = data.isSingleParent ? 188_000 : 301_000;

    if (data.institutionMaintenanceExpenses132_232 > 0) {
      warnings.push(
        "Disabled-child credit (Code 131) and Institution Maintenance credit (Code 132) cannot both be claimed. " +
        "Only the Institution Maintenance credit will be applied."
      );
    } else if (data.totalHouseholdIncomeForDisabledChild > incomeLimit) {
      warnings.push(
        `Disabled-child credit disallowed: household income (${data.totalHouseholdIncomeForDisabledChild.toFixed(0)} ILS) ` +
        `exceeds the limit of ${incomeLimit.toLocaleString()} ILS.`
      );
    } else {
      disabledChildPoints = data.disabledChildrenCount131_023 * 2;
    }
  }

  // 3e. Discharged-soldier credit points (§6)
  const soldierPoints = calcSoldierCreditPoints(
    data.soldierServiceType,
    data.monthsSinceDischarge
  );

  // 3f. Academic degree credit points (§6)
  const academicPoints = calcAcademicCreditPoints(data.academicDegree);

  // 3g. Oleh Chadash credit points (§6)
  const olehPoints = calcOlehChadashPoints(data.olehChadashMonthsElapsed);

  // 3h. Total credit points → monetary value
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

  // Donations — Section 46 (§6 Codes 037/237)
  let donationCredit = 0;
  if (data.donations037_237 >= 207) {
    const donationCap = Math.min(taxableIncome * 0.30, 10_354_846);
    const qualifyingDonation = Math.min(data.donations037_237, donationCap);
    donationCredit = qualifyingDonation * 0.35;
  } else if (data.donations037_237 > 0) {
    warnings.push(
      `Donations credit disallowed: amount (${data.donations037_237} ILS) is below the 207 ILS minimum.`
    );
  }

  // Shift work in industry (§6 Codes 068/069)
  const shiftWorkCap        = 143_040;
  const shiftWorkMaxCredit  = 12_540;
  const qualifyingShiftIncome = Math.min(data.shiftWorkIncome068_069, shiftWorkCap);
  const shiftWorkCredit = Math.min(
    qualifyingShiftIncome * 0.15,
    shiftWorkMaxCredit
  );

  // Institution maintenance (§6 Codes 132/232)
  // Cannot be claimed together with disabled-child credit (flagged above).
  let institutionCredit = 0;
  if (
    data.institutionMaintenanceExpenses132_232 > 0 &&
    data.disabledChildrenCount131_023 === 0
  ) {
    const threshold = taxableIncome * 0.125;
    const qualifyingExpenses = Math.max(
      0,
      data.institutionMaintenanceExpenses132_232 - threshold
    );
    institutionCredit = qualifyingExpenses * 0.35;
  }

  // Life insurance (§6 Codes 036/081): 25 % of risk premium
  const lifeInsuranceCredit = data.lifeInsurancePremium036_081 * 0.25;

  // Pension / survivors insurance (§6 Codes 140/240/045/086): 35 %
  const pensionCredit = data.pensionSurvivorsInsurance140_240 * 0.35;

  // Eilat resident (§6 Codes 139/183): 10 % on Eilat income, cap at 268,560
  let eilatCredit = 0;
  if (data.isEilatResident) {
    const eilatIncomeCapped = Math.min(data.eilatIncome139_183, 268_560);
    eilatCredit = eilatIncomeCapped * 0.10;
  }

  // Security forces Activity Level A (§6): 5 % on qualifying salary, cap 178,320
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

  // 3j. Actual Tax Owed — cannot be negative (§1 rule)
  const actualTax = Math.max(0, theoreticalTax - totalCreditsValue);

  // ── STEP 4: Final Balance ────────────────────────────────────────────────
  const totalWithheldTax =
    data.withheldTaxSalary042 +
    data.withheldTaxOther040 +
    data.withheldTaxInterest043;

  const finalBalance = actualTax - totalWithheldTax;

  // ── Outcome label ────────────────────────────────────────────────────────
  let outcome: TaxCalculationResult["outcome"];
  if (finalBalance < 0)      outcome = "REFUND";
  else if (finalBalance > 0) outcome = "DEBT";
  else                       outcome = "BALANCED";

  // ── Return full result ───────────────────────────────────────────────────
  return {
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
    withheldTaxSalary042:                    0,
    withheldTaxOther040:                     0,
    withheldTaxInterest043:                  0,
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
