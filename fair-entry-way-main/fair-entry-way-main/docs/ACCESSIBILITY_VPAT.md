# Voluntary Product Accessibility Template (VPAT®) — WCAG 2.1 Conformance Report

**Name of Product**: Presence ERP  
**Product Version**: v8.0.0 (Phase 7 Conformance)  
**Publication Date**: July 2026  
**Standard Evaluated**: WCAG 2.1 Level AA / AAA Feasible

---

## Executive Summary

Presence ERP has been evaluated against W3C Web Content Accessibility Guidelines (WCAG) 2.1 Level A and Level AA success criteria, as well as selected Level AAA guidelines.

---

## Conformance Table

| WCAG 2.1 Success Criteria                  | Status       | Implementation Details                                                                                                   |
| :----------------------------------------- | :----------- | :----------------------------------------------------------------------------------------------------------------------- |
| **1.1.1 Non-text Content (Level A)**       | **Supports** | All decorative icons have `aria-hidden="true"`; interactive images hold descriptive `alt` text.                          |
| **1.3.1 Info and Relationships (Level A)** | **Supports** | Semantic HTML5 structure (`<header>`, `<main>`, `<nav>`, `<table>`). Form inputs are bound to `<label>` elements.        |
| **1.4.3 Contrast (Minimum) (Level AA)**    | **Supports** | Text contrast ratios exceed 4.5:1 for body text and 3:1 for large text across light and dark themes.                     |
| **1.4.6 Contrast (Enhanced) (Level AAA)**  | **Supports** | Opt-in High Contrast mode (`AccessibilityToolbar.tsx`) provides > 7:1 contrast ratios.                                   |
| **2.1.1 Keyboard Navigation (Level A)**    | **Supports** | 100% of user workflows (login, check-in challenge, leave submission, admin review) operate with keyboard tab navigation. |
| **2.4.7 Focus Visible (Level AA)**         | **Supports** | Visible focus rings (`ring-2 ring-primary`) render around active focused interactive controls.                           |
| **3.1.1 Language of Page (Level A)**       | **Supports** | `<html lang="en">` attribute set dynamically based on user locale selection (`en`, `hi`, `gu`).                          |

---

## Assistive Technology Compatibility Matrix

- **NVDA (Windows)**: Verified full form field readings, ARIA live region status updates, and table navigation.
- **VoiceOver (iOS / macOS)**: Verified camera check-in instructions, gesture support, and modal dialog focus traps.
- **TalkBack (Android)**: Verified touch exploration and notification announcements.
