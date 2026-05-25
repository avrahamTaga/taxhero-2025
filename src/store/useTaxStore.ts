/**
 * TaxHero 2025 — Zustand Reactive State Store
 * ============================================
 * File: src/store/useTaxStore.ts
 *
 * Architecture contract:
 *   - ZERO BACKEND: All state lives in-memory in the browser only.
 *   - INSTANT REACTIVITY: Every call to `updateField` immediately recomputes
 *     the full tax result via the pure `calculateTaxRefund` engine function.
 *   - TYPE SAFETY: All field updates are constrained to keyof TaxDataInput,
 *     ensuring the compiler catches invalid field names at build time.
 */

import { create } from "zustand";
import {
  type TaxDataInput,
  type TaxCalculationResult,
  calculateTaxRefund,
  createEmptyTaxInput,
} from "../engine/taxCalculator";

// ─────────────────────────────────────────────────────────────────────────────
// SECTION 1 — STORE SHAPE
// ─────────────────────────────────────────────────────────────────────────────

/**
 * The complete shape of the Zustand store.
 *
 * `formData`  — the raw user inputs; mirrors `TaxDataInput` 1:1.
 * `taxResult` — the computed output, always in sync with `formData`.
 * `updateField` — the single mutation point; triggers instant recalculation.
 * `resetForm`   — restores all fields to their zero-state defaults.
 */
interface TaxStore {
  /** Current user inputs. Initialized to safe zero-state defaults. */
  formData: TaxDataInput;

  /**
   * Computed tax result, recalculated synchronously on every `updateField` call.
   * Never null — the store initializes it by running the engine on the default
   * zero-state inputs so components can always destructure it safely.
   */
  taxResult: TaxCalculationResult;

  /**
   * Update a single field in `formData` and instantly recompute `taxResult`.
   *
   * Type-safe: `key` must be a valid `keyof TaxDataInput`, and `value` must
   * match the type of that field.
   *
   * @example
   *   updateField("grossIncome158", 180_000);
   *   updateField("childrenAges", [3, 7]);
   *   updateField("gender", "female");
   */
  updateField: <K extends keyof TaxDataInput>(
    key: K,
    value: TaxDataInput[K]
  ) => void;

  /**
   * Resets `formData` to zeroed defaults and recomputes `taxResult`.
   * Useful for a "Start Over" button.
   */
  resetForm: () => void;
}

// ─────────────────────────────────────────────────────────────────────────────
// SECTION 2 — INITIAL STATE BOOTSTRAP
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Build the initial zero-state form data and pre-compute the initial result.
 * Using `createEmptyTaxInput()` from the engine ensures we stay in sync with
 * the engine's own defaults rather than duplicating them here.
 */
const initialFormData = createEmptyTaxInput("male");
const initialTaxResult = calculateTaxRefund(initialFormData);

// ─────────────────────────────────────────────────────────────────────────────
// SECTION 3 — STORE DEFINITION
// ─────────────────────────────────────────────────────────────────────────────

export const useTaxStore = create<TaxStore>((set) => ({
  // ── Initial state ──────────────────────────────────────────────────────────
  formData: initialFormData,
  taxResult: initialTaxResult,

  // ── updateField ────────────────────────────────────────────────────────────
  updateField: <K extends keyof TaxDataInput>(
    key: K,
    value: TaxDataInput[K]
  ) => {
    set((state) => {
      // 1. Produce the new formData immutably.
      const newFormData: TaxDataInput = {
        ...state.formData,
        [key]: value,
      };

      // 2. CRITICAL REACTIVITY: immediately recompute the full tax result.
      //    `calculateTaxRefund` is a pure function with no side effects,
      //    so this is safe to call synchronously inside the setter.
      const newTaxResult = calculateTaxRefund(newFormData);

      // 3. Return both updated slices in a single atomic state update,
      //    preventing any intermediate render with stale taxResult data.
      return {
        formData: newFormData,
        taxResult: newTaxResult,
      };
    });
  },

  // ── resetForm ──────────────────────────────────────────────────────────────
  resetForm: () => {
    set((state) => {
      // Preserve the user's chosen gender when resetting, so the base credit
      // points stay correct. All numeric/boolean fields return to zero.
      const freshFormData = createEmptyTaxInput(state.formData.gender);
      const freshTaxResult = calculateTaxRefund(freshFormData);

      return {
        formData: freshFormData,
        taxResult: freshTaxResult,
      };
    });
  },
}));

// ─────────────────────────────────────────────────────────────────────────────
// SECTION 4 — CONVENIENCE SELECTOR HOOKS
// ─────────────────────────────────────────────────────────────────────────────
//
// These thin wrappers follow the Zustand "selector per slice" pattern.
// Using granular selectors prevents components from re-rendering when
// unrelated parts of the store change.
//
// Usage:
//   const grossIncome = useTaxFormField("grossIncome158");
//   const finalBalance = useTaxResultField("finalBalance");
//   const outcome = useTaxResultField("outcome");
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Returns a single field from `formData`.
 *
 * @example
 *   const gender = useTaxFormField("gender");        // "male" | "female"
 *   const ages   = useTaxFormField("childrenAges");  // number[]
 */
export function useTaxFormField<K extends keyof TaxDataInput>(
  key: K
): TaxDataInput[K] {
  return useTaxStore((state) => state.formData[key]);
}

/**
 * Returns a single field from `taxResult`.
 *
 * @example
 *   const balance  = useTaxResultField("finalBalance");   // number
 *   const outcome  = useTaxResultField("outcome");        // "REFUND"|"DEBT"|"BALANCED"
 *   const warnings = useTaxResultField("warnings");       // string[]
 */
export function useTaxResultField<K extends keyof TaxCalculationResult>(
  key: K
): TaxCalculationResult[K] {
  return useTaxStore((state) => state.taxResult[key]);
}

/**
 * Returns the `updateField` action without subscribing to any state slice.
 * Components that only dispatch updates (no reads) should use this to
 * avoid unnecessary re-renders.
 *
 * @example
 *   const updateField = useUpdateField();
 *   updateField("grossIncome158", 120_000);
 */
export function useUpdateField(): TaxStore["updateField"] {
  return useTaxStore((state) => state.updateField);
}

/**
 * Returns the `resetForm` action without subscribing to any state slice.
 *
 * @example
 *   const reset = useResetForm();
 *   <button onClick={reset}>Start Over</button>
 */
export function useResetForm(): TaxStore["resetForm"] {
  return useTaxStore((state) => state.resetForm);
}
