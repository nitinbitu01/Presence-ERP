/**
 * Phase 7 World-Class Locale Formatter
 * Uses native ECMAScript Intl APIs for precision locale-aware formatting.
 * Supports Indian Numbering System (lakh/crore), locale-aware dates,
 * relative time expressions, and RTL directionality detection.
 */

import type { SupportedLocale } from "@/i18n";

/** Maps app locale codes to BCP 47 locale tags for Intl APIs */
const LOCALE_MAP: Record<SupportedLocale, string> = {
  en: "en-IN",
  hi: "hi-IN",
  gu: "gu-IN",
  te: "te-IN",
  mr: "mr-IN",
};

/**
 * Format number as Indian Rupee currency using Intl.NumberFormat.
 * Automatically applies Indian digit grouping (1,00,000 not 100,000).
 */
export function formatIndianCurrency(amount: number, locale: SupportedLocale = "en"): string {
  if (isNaN(amount)) return "\u20b90.00";
  const bcp47 = LOCALE_MAP[locale] ?? "en-IN";
  try {
    return new Intl.NumberFormat(bcp47, {
      style: "currency",
      currency: "INR",
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    }).format(amount);
  } catch {
    // Fallback for environments without full Intl support
    const fixed = amount.toFixed(2);
    const [intPart, decPart] = fixed.split(".");
    let last3 = (intPart ?? "0").slice(-3);
    const rest = (intPart ?? "0").slice(0, -3);
    if (rest) last3 = "," + last3;
    const formatted = rest.replace(/\B(?=(\d{2})+(?!\d))/g, ",") + last3;
    return `\u20b9${formatted}.${decPart}`;
  }
}

/**
 * Format date in locale-aware format.
 * Returns DD/MM/YYYY for en-IN, or locale-native format.
 */
export function formatIndianDate(
  dateInput: string | Date | number,
  locale: SupportedLocale = "en",
): string {
  try {
    const d = new Date(dateInput);
    if (isNaN(d.getTime())) return String(dateInput);
    const bcp47 = LOCALE_MAP[locale] ?? "en-IN";
    return new Intl.DateTimeFormat(bcp47, {
      day: "2-digit",
      month: "2-digit",
      year: "numeric",
    }).format(d);
  } catch {
    const d = new Date(dateInput);
    if (isNaN(d.getTime())) return String(dateInput);
    return `${String(d.getDate()).padStart(2, "0")}/${String(d.getMonth() + 1).padStart(2, "0")}/${d.getFullYear()}`;
  }
}

/**
 * Format relative time (e.g., "2 hours ago", "3 \u0926\u093f\u0928 \u092a\u0939\u0932\u0947").
 * Uses Intl.RelativeTimeFormat for locale-native expressions.
 */
export function formatRelativeTime(
  dateInput: string | Date | number,
  locale: SupportedLocale = "en",
): string {
  try {
    const d = new Date(dateInput);
    if (isNaN(d.getTime())) return String(dateInput);
    const bcp47 = LOCALE_MAP[locale] ?? "en-IN";
    const rtf = new Intl.RelativeTimeFormat(bcp47, { numeric: "auto", style: "long" });
    const diffMs = d.getTime() - Date.now();
    const diffSec = Math.round(diffMs / 1000);
    const diffMin = Math.round(diffSec / 60);
    const diffHrs = Math.round(diffMin / 60);
    const diffDays = Math.round(diffHrs / 24);

    if (Math.abs(diffSec) < 60) return rtf.format(diffSec, "second");
    if (Math.abs(diffMin) < 60) return rtf.format(diffMin, "minute");
    if (Math.abs(diffHrs) < 24) return rtf.format(diffHrs, "hour");
    return rtf.format(diffDays, "day");
  } catch {
    return String(dateInput);
  }
}

/**
 * Returns the text directionality for the given locale.
 * RTL readiness: Urdu and Arabic would return 'rtl'.
 */
export function getDirectionality(locale: SupportedLocale): "ltr" | "rtl" {
  const RTL_LOCALES = new Set(["ur", "ar", "fa", "he"]);
  // None of our current locales are RTL, but this makes RTL retrofit trivial
  if (RTL_LOCALES.has(locale)) return "rtl";
  return "ltr";
}

/**
 * Format a number with Indian digit grouping (no currency symbol).
 */
export function formatIndianNumber(n: number, locale: SupportedLocale = "en"): string {
  if (isNaN(n)) return "0";
  const bcp47 = LOCALE_MAP[locale] ?? "en-IN";
  try {
    return new Intl.NumberFormat(bcp47).format(n);
  } catch {
    return String(n);
  }
}
