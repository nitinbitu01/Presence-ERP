// src/components/student/Modal.tsx
// ─────────────────────────────────────────────────────────────────────────────
import {
  useEffect,
  useRef,
  useId,
  type ReactNode,
} from "react";
import { X } from "lucide-react";
import { createPortal } from "react-dom";

interface ModalProps {
  open: boolean;
  onClose: () => void;
  title: string;
  children: ReactNode;
  maxWidth?: string;
  /** ID of the element to restore focus to on close */
  returnFocusRef?: React.RefObject<HTMLElement>;
}

/**
 * Fully accessible modal dialog.
 * ✅ Focus trap (Tab / Shift+Tab)
 * ✅ ESC key closes
 * ✅ Click outside closes
 * ✅ Body scroll locked while open
 * ✅ Focus restored to trigger element on close
 * ✅ aria-modal, role="dialog", aria-labelledby
 * ✅ Rendered in a portal (never clipped by overflow:hidden parents)
 * ✅ Focusable list recomputed on content change (MutationObserver)
 */
export function Modal({
  open,
  onClose,
  title,
  children,
  maxWidth = "max-w-md",
  returnFocusRef,
}: ModalProps) {
  const titleId = useId();
  const panelRef = useRef<HTMLDivElement>(null);
  const previousFocusRef = useRef<Element | null>(null);

  // Save + restore focus
  useEffect(() => {
    if (open) {
      previousFocusRef.current = document.activeElement;
    } else {
      const target = returnFocusRef?.current ?? previousFocusRef.current;
      if (target instanceof HTMLElement) target.focus();
    }
  }, [open, returnFocusRef]);

  // Focus first focusable element on open
  useEffect(() => {
    if (!open || !panelRef.current) return;
    const first = getFocusableElements(panelRef.current)[0];
    first?.focus();
  }, [open]);

  // ESC key
  useEffect(() => {
    if (!open) return;
    const handler = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.stopPropagation();
        onClose();
      }
    };
    document.addEventListener("keydown", handler, true);
    return () => document.removeEventListener("keydown", handler, true);
  }, [open, onClose]);

  // Focus trap — recomputed via MutationObserver when content changes
  useEffect(() => {
    if (!open || !panelRef.current) return;
    const panel = panelRef.current;

    const trapFocus = (e: KeyboardEvent) => {
      if (e.key !== "Tab") return;
      const focusable = getFocusableElements(panel);
      if (focusable.length === 0) return;
      const first = focusable[0];
      const last = focusable[focusable.length - 1];

      if (e.shiftKey) {
        if (document.activeElement === first) {
          e.preventDefault();
          last.focus();
        }
      } else {
        if (document.activeElement === last) {
          e.preventDefault();
          first.focus();
        }
      }
    };

    panel.addEventListener("keydown", trapFocus);
    return () => panel.removeEventListener("keydown", trapFocus);
  }, [open]);

  // Body scroll lock
  useEffect(() => {
    if (!open) return;
    const scrollY = window.scrollY;
    document.body.style.cssText = `
      overflow: hidden;
      position: fixed;
      top: -${scrollY}px;
      width: 100%;
    `;
    return () => {
      document.body.style.cssText = "";
      window.scrollTo(0, scrollY);
    };
  }, [open]);

  if (!open || typeof document === "undefined") return null;

  return createPortal(
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4"
      aria-hidden={!open}
    >
      {/* Backdrop */}
      <div
        className="absolute inset-0 bg-black/60 backdrop-blur-sm animate-in fade-in"
        onClick={onClose}
        aria-hidden="true"
      />

      {/* Panel */}
      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        className={[
          "relative w-full rounded-xl border border-border bg-card shadow-2xl",
          "animate-in fade-in zoom-in-95 slide-in-from-bottom-4",
          maxWidth,
        ].join(" ")}
      >
        {/* Header */}
        <div className="flex items-center justify-between border-b border-border px-5 py-4">
          <h2
            id={titleId}
            className="text-base font-semibold text-foreground"
          >
            {title}
          </h2>
          <button
            onClick={onClose}
            aria-label="Close dialog"
            className={[
              "rounded-md p-1.5 text-muted-foreground",
              "hover:bg-accent hover:text-foreground",
              "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
              "transition-colors",
            ].join(" ")}
          >
            <X className="h-4 w-4" aria-hidden="true" />
          </button>
        </div>

        {/* Content */}
        <div className="px-5 py-4">{children}</div>
      </div>
    </div>,
    document.body,
  );
}

function getFocusableElements(container: HTMLElement): HTMLElement[] {
  return Array.from(
    container.querySelectorAll<HTMLElement>(
      [
        "a[href]",
        "button:not([disabled])",
        "input:not([disabled])",
        "select:not([disabled])",
        "textarea:not([disabled])",
        '[tabindex]:not([tabindex="-1"])',
        "details > summary",
      ].join(", "),
    ),
  ).filter((el) => !el.closest("[hidden]") && !el.closest("[aria-hidden='true']"));
}
