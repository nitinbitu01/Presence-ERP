import en from "./locales/en.json";
import hi from "./locales/hi.json";
import gu from "./locales/gu.json";
import te from "./locales/te.json";
import mr from "./locales/mr.json";

export type SupportedLocale = "en" | "hi" | "gu" | "te" | "mr";

const dictionaries: Record<SupportedLocale, Record<string, string>> = {
  en,
  hi,
  gu,
  te,
  mr,
};

let currentLocale: SupportedLocale = "en";

export function setLanguage(locale: SupportedLocale): void {
  if (dictionaries[locale]) {
    currentLocale = locale;
    if (typeof localStorage !== "undefined") {
      localStorage.setItem("presence_erp_locale", locale);
    }
    // Update <html lang> attribute for screen readers and SEO
    if (typeof document !== "undefined") {
      document.documentElement.setAttribute("lang", locale);
      document.documentElement.setAttribute(
        "dir",
        ["ur", "ar", "fa", "he"].includes(locale) ? "rtl" : "ltr",
      );
    }
  }
}

export function getLanguage(): SupportedLocale {
  if (typeof localStorage !== "undefined") {
    const saved = localStorage.getItem("presence_erp_locale") as SupportedLocale;
    if (saved && dictionaries[saved]) return saved;
  }
  return currentLocale;
}

export function t(key: string, locale?: SupportedLocale): string {
  const targetLocale = locale ?? getLanguage();
  const dict = dictionaries[targetLocale] ?? dictionaries.en;
  return dict[key] ?? dictionaries.en[key] ?? key;
}

export function getSupportedLocales(): Array<{
  code: SupportedLocale;
  name: string;
  nativeName: string;
}> {
  return [
    { code: "en", name: "English", nativeName: "English" },
    { code: "hi", name: "Hindi", nativeName: "\u0939\u093f\u0902\u0926\u0940" },
    { code: "gu", name: "Gujarati", nativeName: "\u0a97\u0ac1\u0a9c\u0ab0\u0abe\u0aa4\u0ac0" },
    { code: "te", name: "Telugu", nativeName: "\u0c24\u0c46\u0c32\u0c41\u0c17\u0c41" },
    { code: "mr", name: "Marathi", nativeName: "\u092e\u0930\u093e\u0920\u0940" },
  ];
}
