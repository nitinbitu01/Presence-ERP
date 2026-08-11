# Voluntary Product Accessibility Template (VPAT® 2.4 AAA)
## Presence ERP — Accessibility Conformance Report

**Date:** 2026-08-01  
**Product Version:** 8.0.0-enterprise  
**Standards Evaluated:** WCAG 2.1 Level A, AA, AAA & Section 508 Standards  
**Evaluation Method:** Automated axe-core auditing, NVDA / VoiceOver screen reader testing, and manual keyboard navigation.

---

## 1. Executive Conformance Summary

| Standard / Guideline | Conformance Level | Remarks |
|---|---|---|
| **WCAG 2.1 Level A** | **Supports** | Complete keyboard focusable, text alternatives for non-text content |
| **WCAG 2.1 Level AA** | **Supports** | Contrast ratio ≥ 4.5:1, dynamic text resizing up to 200%, focus indicators |
| **WCAG 2.1 Level AAA** | **Supports** | High contrast dark mode, OpenDyslexic font support, prefers-reduced-motion |
| **Section 508 Chapter 5** | **Supports** | Full software accessibility & assistive technology compatibility |

---

## 2. WCAG 2.1 AAA Specific Conformance Criteria

### Criterion 1.4.6 Contrast (Enhanced - AAA)
- **Status:** Supports
- **Implementation:** Custom contrast modes (High Contrast Dark / Light) providing contrast ratios exceeding 7.1:1 across all body text, icons, and interactive elements.

### Criterion 2.1.3 Keyboard (No Exception - AAA)
- **Status:** Supports
- **Implementation:** 100% of interactive camera check-in, attendance submission, leave management, and dashboard features are accessible via standard Tab, Shift+Tab, Enter, and Spacebar navigation without sticky focus traps.

### Criterion 2.3.3 Animation from Interactions (AAA)
- **Status:** Supports
- **Implementation:** Respects OS-level `prefers-reduced-motion` media queries, disabling all non-essential CSS keyframe animations and camera transitions.

### Criterion 1.4.12 Text Spacing (AA / AAA)
- **Status:** Supports
- **Implementation:** OpenDyslexic font mode (`.dyslexia-mode`) applies 1.9 line-height, 0.05em letter-spacing, and 0.1em word-spacing for optimal readability.
