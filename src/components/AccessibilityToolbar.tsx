import React, { useState, useEffect, useCallback } from "react";
import { Eye, Languages, Sparkles, Type, ZoomIn, ZoomOut, Volume2, BookOpen, ChevronUp, ChevronDown, Minimize2 } from "lucide-react";
import { setLanguage, getLanguage, getSupportedLocales, type SupportedLocale } from "@/i18n";
import { Button } from "@/components/ui/button";

const FONT_SIZE_KEY = "presence_erp_font_size";
const REDUCED_MOTION_KEY = "presence_erp_reduced_motion";
const DYSLEXIA_KEY = "presence_erp_dyslexia_mode";

function applyFontSize(size: number) {
  document.documentElement.style.setProperty("--base-font-size", `${size}px`);
  document.documentElement.style.fontSize = `${size}px`;
}

export const AccessibilityToolbar: React.FC = () => {
  const [isCollapsed, setIsCollapsed] = useState(true);
  const [lang, setLang] = useState<SupportedLocale>(getLanguage());
  const [highContrast, setHighContrast] = useState(false);
  const [simpleMode, setSimpleMode] = useState(false);
  const [reducedMotion, setReducedMotion] = useState(false);
  const [dyslexiaMode, setDyslexiaMode] = useState(false);
  const [fontSize, setFontSize] = useState(16);

  // Restore persisted preferences on mount
  useEffect(() => {
    const savedSize = parseInt(localStorage.getItem(FONT_SIZE_KEY) ?? "16", 10);
    const savedReducedMotion = localStorage.getItem(REDUCED_MOTION_KEY) === "true";
    const savedDyslexia = localStorage.getItem(DYSLEXIA_KEY) === "true";

    setFontSize(savedSize);
    applyFontSize(savedSize);

    if (savedReducedMotion) {
      setReducedMotion(true);
      document.documentElement.classList.add("reduced-motion");
    }
    if (savedDyslexia) {
      setDyslexiaMode(true);
      document.documentElement.classList.add("dyslexia-mode");
    }
  }, []);

  // Language change — reactive context switch, no page reload
  const handleLanguageChange = useCallback((newLang: SupportedLocale) => {
    setLang(newLang);
    setLanguage(newLang); // Updates <html lang> and <html dir> automatically
    // Dispatch a storage event so other components can react without reload
    window.dispatchEvent(
      new StorageEvent("storage", { key: "presence_erp_locale", newValue: newLang }),
    );
  }, []);

  const toggleHighContrast = useCallback(() => {
    setHighContrast((prev) => {
      const next = !prev;
      document.documentElement.classList.toggle("high-contrast", next);
      return next;
    });
  }, []);

  const toggleSimpleMode = useCallback(() => {
    setSimpleMode((prev) => {
      const next = !prev;
      document.documentElement.classList.toggle("simple-mode", next);
      return next;
    });
  }, []);

  const toggleReducedMotion = useCallback(() => {
    setReducedMotion((prev) => {
      const next = !prev;
      document.documentElement.classList.toggle("reduced-motion", next);
      localStorage.setItem(REDUCED_MOTION_KEY, String(next));
      return next;
    });
  }, []);

  const toggleDyslexiaMode = useCallback(() => {
    setDyslexiaMode((prev) => {
      const next = !prev;
      document.documentElement.classList.toggle("dyslexia-mode", next);
      localStorage.setItem(DYSLEXIA_KEY, String(next));
      return next;
    });
  }, []);

  const adjustFontSize = useCallback((delta: number) => {
    setFontSize((prev) => {
      const next = Math.max(12, Math.min(24, prev + delta));
      applyFontSize(next);
      localStorage.setItem(FONT_SIZE_KEY, String(next));
      return next;
    });
  }, []);

  const speakPageContent = useCallback(() => {
    if (!("speechSynthesis" in window)) return;
    window.speechSynthesis.cancel();
    const utterance = new SpeechSynthesisUtterance(document.body.innerText.slice(0, 2000));
    utterance.lang = lang === "hi" ? "hi-IN" : lang === "gu" ? "gu-IN" : "en-IN";
    utterance.rate = 0.9;
    window.speechSynthesis.speak(utterance);
  }, [lang]);

  const locales = getSupportedLocales();

  if (isCollapsed) {
    return (
      <button
        onClick={() => setIsCollapsed(false)}
        className="flex items-center gap-2 rounded-full bg-slate-900 text-white dark:bg-slate-100 dark:text-slate-900 px-3.5 py-2 text-xs font-semibold shadow-lg hover:scale-105 transition-all border border-slate-700/50"
        title="Open Accessibility & Language Settings"
      >
        <Sparkles className="h-4 w-4 text-emerald-400 dark:text-emerald-600" />
        <span>Accessibility</span>
        <ChevronUp className="h-3.5 w-3.5 opacity-70" />
      </button>
    );
  }

  return (
    <div
      role="toolbar"
      aria-label="Accessibility and language settings"
      className="flex items-center gap-2 flex-wrap rounded-xl border border-border bg-card/95 backdrop-blur-md p-2.5 text-xs shadow-xl animate-in fade-in slide-in-from-bottom-2 duration-200"
    >
      {/* Language Selector */}
      <div className="flex items-center gap-1">
        <Languages className="h-3.5 w-3.5 text-muted-foreground" aria-hidden="true" />
        <select
          value={lang}
          onChange={(e) => handleLanguageChange(e.target.value as SupportedLocale)}
          aria-label="Select application language"
          className="rounded border border-input bg-background px-2 py-1 text-xs text-foreground focus-visible:ring-2 focus-visible:ring-primary"
        >
          {locales.map((l) => (
            <option key={l.code} value={l.code}>
              {l.nativeName} ({l.name})
            </option>
          ))}
        </select>
      </div>

      <div className="w-px h-5 bg-border" role="separator" />

      {/* Font Size Controls */}
      <div className="flex items-center gap-1" role="group" aria-label="Font size controls">
        <Type className="h-3.5 w-3.5 text-muted-foreground" aria-hidden="true" />
        <Button
          variant="outline"
          size="icon"
          onClick={() => adjustFontSize(-1)}
          aria-label="Decrease font size"
          className="h-6 w-6"
          disabled={fontSize <= 12}
        >
          <ZoomOut className="h-3 w-3" />
        </Button>
        <span
          className="text-[11px] text-muted-foreground tabular-nums w-6 text-center"
          aria-live="polite"
        >
          {fontSize}
        </span>
        <Button
          variant="outline"
          size="icon"
          onClick={() => adjustFontSize(1)}
          aria-label="Increase font size"
          className="h-6 w-6"
          disabled={fontSize >= 24}
        >
          <ZoomIn className="h-3 w-3" />
        </Button>
      </div>

      <div className="w-px h-5 bg-border" role="separator" />

      {/* High Contrast */}
      <Button
        variant={highContrast ? "default" : "outline"}
        size="sm"
        onClick={toggleHighContrast}
        aria-pressed={highContrast}
        aria-label={highContrast ? "Disable high contrast mode" : "Enable high contrast mode"}
        className="h-7 text-[11px] gap-1"
      >
        <Eye className="h-3 w-3" aria-hidden="true" />
        Contrast
      </Button>

      {/* Simple Mode */}
      <Button
        variant={simpleMode ? "default" : "outline"}
        size="sm"
        onClick={toggleSimpleMode}
        aria-pressed={simpleMode}
        aria-label={simpleMode ? "Disable simple mode" : "Enable simple mode"}
        className="h-7 text-[11px] gap-1"
      >
        <Sparkles className="h-3 w-3" aria-hidden="true" />
        Simple
      </Button>

      {/* Reduced Motion */}
      <Button
        variant={reducedMotion ? "default" : "outline"}
        size="sm"
        onClick={toggleReducedMotion}
        aria-pressed={reducedMotion}
        aria-label={
          reducedMotion ? "Re-enable animations" : "Reduce animations (vestibular disorders)"
        }
        className="h-7 text-[11px] gap-1"
      >
        ⏸ Motion
      </Button>

      {/* Dyslexia-friendly font */}
      <Button
        variant={dyslexiaMode ? "default" : "outline"}
        size="sm"
        onClick={toggleDyslexiaMode}
        aria-pressed={dyslexiaMode}
        aria-label={
          dyslexiaMode ? "Disable dyslexia-friendly font" : "Enable dyslexia-friendly font"
        }
        className="h-7 text-[11px] gap-1"
      >
        <BookOpen className="h-3 w-3" aria-hidden="true" />
        Dyslexia
      </Button>

      {/* Text-to-Speech */}
      {"speechSynthesis" in (typeof window !== "undefined" ? window : {}) && (
        <Button
          variant="outline"
          size="sm"
          onClick={speakPageContent}
          aria-label="Read page content aloud (text-to-speech)"
          className="h-7 text-[11px] gap-1"
        >
          <Volume2 className="h-3 w-3" aria-hidden="true" />
          Read
        </Button>
      )}

      <div className="w-px h-5 bg-border ml-1" role="separator" />

      {/* Compress / Collapse Button */}
      <Button
        variant="ghost"
        size="sm"
        onClick={() => setIsCollapsed(true)}
        aria-label="Compress accessibility toolbar"
        className="h-7 px-2 text-[11px] gap-1 text-muted-foreground hover:text-foreground"
        title="Compress toolbar"
      >
        <Minimize2 className="h-3 w-3" />
        <span>Compress</span>
      </Button>
    </div>
  );
};
