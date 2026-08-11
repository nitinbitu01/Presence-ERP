# WCAG 2.1 Conformance Statement
## Presence ERP — Accessibility Audit Report

**Version:** 1.0  
**Date:** 2026-08-01  
**Prepared by:** Engineering Team, Presence ERP  
**Standard:** WCAG 2.1 (W3C Recommendation 05 June 2018)  
**Target Level:** AA (with selected AAA criteria)

---

## Scope

This conformance statement covers the following Presence ERP interfaces:

- Student Dashboard (`/student`)
- Teacher Dashboard (`/teacher`)
- Admin Panel (`/admin`)
- Attendance Check-in (`/attend/:sessionId`)
- Enrollment (`/enroll`)
- Helpdesk & Support (`/help`)
- Authentication flows (`/auth/*`, `/reset-password`)

---

## Conformance Status

**Partially Conformant** — Some parts of the content do not fully conform to WCAG 2.1 Level AA. See Known Limitations below.

---

## Supported: AA Success Criteria

| Criterion | Level | Status | Notes |
|---|---|---|---|
| 1.1.1 Non-text Content | A | ✅ Pass | All images have `alt` text; ARIA labels on icons |
| 1.3.1 Info and Relationships | A | ✅ Pass | Semantic HTML5 (main, nav, section, article) |
| 1.3.3 Sensory Characteristics | A | ✅ Pass | Not reliant on shape/color alone |
| 1.4.1 Use of Color | A | ✅ Pass | Status conveyed by text + icon, not color alone |
| 1.4.3 Contrast (Minimum) | AA | ✅ Pass | oklch color system maintains ≥4.5:1 ratio |
| 1.4.4 Resize Text | AA | ✅ Pass | Font size slider 12px–24px; no content loss |
| 1.4.10 Reflow | AA | ✅ Pass | Responsive layout; no horizontal scroll at 320px |
| 1.4.11 Non-text Contrast | AA | ✅ Pass | UI components ≥3:1 ratio |
| 1.4.12 Text Spacing | AA | ✅ Pass | Dyslexia mode increases letter/word spacing |
| 2.1.1 Keyboard | A | ✅ Pass | All interactive elements keyboard accessible |
| 2.1.2 No Keyboard Trap | A | ✅ Pass | Modal dialogs include focus trap with Escape |
| 2.4.3 Focus Order | A | ✅ Pass | Logical DOM order maintained |
| 2.4.7 Focus Visible | AA | ✅ Pass | `:focus-visible` ring on all interactive elements |
| 2.4.11 Focus Appearance (Enhanced) | AAA | ✅ Pass | 3px ring with 2px offset (exceeds AA) |
| 3.1.1 Language of Page | A | ✅ Pass | `<html lang>` updated dynamically per selected locale |
| 3.1.2 Language of Parts | AA | ✅ Pass | Translated content in Hindi/Gujarati/Telugu/Marathi |
| 3.2.1 On Focus | A | ✅ Pass | No context change on focus |
| 3.3.1 Error Identification | A | ✅ Pass | Form errors identified in text |
| 3.3.2 Labels or Instructions | A | ✅ Pass | All form fields have associated labels |
| 4.1.2 Name, Role, Value | A | ✅ Pass | `aria-label`, `aria-pressed`, `aria-live` used throughout |
| 4.1.3 Status Messages | AA | ✅ Pass | Sync status uses `role="status" aria-live="polite"` |

---

## Known Limitations (Partially Failing)

| Criterion | Level | Status | Detail | Target Fix |
|---|---|---|---|---|
| 1.2.1 Audio-only / Video-only | A | ⚠️ N/A | No pre-recorded media currently | — |
| 2.5.3 Label in Name | A | ⚠️ Partial | Some icon-only buttons may lack visible text | Q3 2026 |
| Camera permission UI | — | ⚠️ No ARIA | The browser camera permission dialog is OS-controlled; guidance text not spoken by screen reader | Workaround in progress |
| Biometric check-in screen | — | ⚠️ Complex | Face-detection canvas lacks live audio guidance (e.g. "move left", "align face") | Q4 2026 |

---

## Accessibility Features Implemented

### Manual Controls (Accessibility Toolbar)
| Feature | Implementation |
|---|---|
| Language selection | 5 languages (EN/HI/GU/TE/MR) — no page reload |
| Font size | 12px–24px slider, persisted per user |
| High Contrast mode | Inverts to high-contrast oklch palette |
| Simple/Cognitive mode | Reduces visual complexity |
| Reduced Motion | Disables all CSS animations (also auto via OS) |
| Dyslexia-friendly font | OpenDyslexic-style spacing |
| Text-to-Speech | Web Speech API reads page content in selected locale |

### OS-Level Automatic Respect
| OS Setting | CSS Media Query | Effect |
|---|---|---|
| Reduce Motion | `@media (prefers-reduced-motion: reduce)` | All transitions → 0.01ms |
| Increase Contrast | `@media (prefers-contrast: more)` | High-contrast variable set applied |
| Dark Mode | `@media (prefers-color-scheme: dark)` | Dark color scheme |

---

## Testing Methodology

| Method | Tool / Approach | Scope |
|---|---|---|
| Automated scan | axe-core (via browser extension) | All major routes |
| Manual keyboard navigation | Chrome DevTools, Windows keyboard only | Check-in flow, forms |
| Screen reader | NVDA + Firefox | Dashboard, attendance marking |
| Color contrast | Colour Contrast Analyser | All text elements |
| Zoom to 200% | Browser zoom | Layout reflow |

> **Note:** This is a self-certification. An independent VPAT from a certified accessibility auditor (e.g. Level Access, Deque) is recommended before institutional procurement.

---

## Feedback & Contact

To report an accessibility barrier, use the built-in **Accessibility Toolbar → Report Accessibility Issue** feature, or email: `accessibility@rru.ac.in`

---

## Revision History

| Date | Version | Change |
|---|---|---|
| 2026-08-01 | 1.0 | Initial conformance statement |
