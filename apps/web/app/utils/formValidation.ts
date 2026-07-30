/**
 * Shared helpers for accessible client-side schema validation.
 *
 * @module
 */

import { nextTick } from "vue";

export interface ValidationIssue {
  path: readonly PropertyKey[];
  message: string;
}

/**
 * Keeps the first validation message for each top-level form field.
 */
export const createFieldErrorMap = (
  issues: readonly ValidationIssue[]
): Record<string, string> =>
  issues.reduce<Record<string, string>>((errors, issue) => {
    const field = String(issue.path[0] ?? "form");

    if (!errors[field]) {
      errors[field] = issue.message;
    }

    return errors;
  }, {});

/**
 * Focuses an error summary after Vue has rendered its messages.
 */
export const focusFormErrorSummary = async (
  summary: HTMLElement | null
): Promise<void> => {
  await nextTick();
  summary?.focus();
};
