import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
  Outlet,
  Link,
  createRootRouteWithContext,
  useRouter,
  HeadContent,
  Scripts,
} from "@tanstack/react-router";
import { useEffect, type ReactNode } from "react";

import appCss from "../styles.css?url";
import { reportLovableError } from "../lib/lovable-error-reporting";
import { supabase } from "../integrations/supabase/client";
import { PwaUpdateBanner } from "@/components/PwaUpdateBanner";
import { AccessibilityToolbar } from "@/components/AccessibilityToolbar";
import { SingleSessionGuard } from "@/components/SingleSessionGuard";

function NotFoundComponent() {
  return (
    <div className="flex min-h-screen items-center justify-center bg-background px-4">
      <div className="max-w-md text-center">
        <h1 className="text-7xl font-bold text-foreground">404</h1>
        <h2 className="mt-4 text-xl font-semibold text-foreground">Page not found</h2>
        <p className="mt-2 text-sm text-muted-foreground">
          The page you're looking for doesn't exist or has been moved.
        </p>
        <div className="mt-6">
          <Link
            to="/"
            className="inline-flex items-center justify-center rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/90"
          >
            Go home
          </Link>
        </div>
      </div>
    </div>
  );
}

// Strip HTML error pages from error messages before displaying to users.
// This prevents raw Cloudflare/server HTML from leaking into the UI.
function sanitizeErrorMsg(raw: string): string {
  const isHtml = /<!doctype|<html|<head|this page didn't load|something went wrong/i.test(raw);
  if (isHtml) return "A server error occurred. Please reload the page or sign in again.";
  return raw.length > 300 ? raw.slice(0, 300) + "…" : raw;
}

function ErrorComponent({ error, reset }: { error: Error; reset: () => void }) {
  console.error("[RootErrorComponent]", error);
  const router = useRouter();
  useEffect(() => {
    reportLovableError(error, { boundary: "tanstack_root_error_component" });
  }, [error]);

  const rawMsg = error?.message || String(error);
  const errorMsg = sanitizeErrorMsg(rawMsg);
  const isAuthError =
    rawMsg.includes("Unauthorized") ||
    rawMsg.includes("session") ||
    rawMsg.includes("token") ||
    rawMsg.includes("redirect");

  return (
    <div className="flex min-h-screen items-center justify-center bg-background px-4">
      <div className="max-w-md w-full rounded-xl border border-border bg-card p-6 text-center shadow-lg">
        <div className="mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-full bg-amber-500/10 text-amber-600 dark:text-amber-400">
          ⚠️
        </div>
        <h1 className="text-xl font-semibold tracking-tight text-foreground">
          {isAuthError ? "Authentication Required" : "Session Update Required"}
        </h1>
        <p className="mt-2 text-sm text-muted-foreground">
          {isAuthError
            ? "Your session expired or sign-in is required to access this page."
            : "A momentary connection glitch occurred. Click below to reload."}
        </p>
        {errorMsg && !isAuthError && (
          <p className="mt-3 rounded bg-muted/50 p-2 text-xs font-mono text-muted-foreground overflow-x-auto text-left max-h-24">
            {errorMsg}
          </p>
        )}
        <div className="mt-6 flex flex-col sm:flex-row justify-center gap-2">
          {isAuthError ? (
            <a
              href="/auth"
              className="inline-flex items-center justify-center rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/90"
            >
              Sign In to Presence ERP →
            </a>
          ) : (
            <button
              onClick={() => {
                router.invalidate();
                reset();
              }}
              className="inline-flex items-center justify-center rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/90"
            >
              Try again
            </button>
          )}
          <a
            href="/"
            className="inline-flex items-center justify-center rounded-md border border-input bg-background px-4 py-2 text-sm font-medium text-foreground transition-colors hover:bg-accent"
          >
            Go home
          </a>
        </div>
      </div>
    </div>
  );
}

const TITLE = "Presence ERP — Presence ERP";
const DESC =
  "Official Attendance Verification and Academic ERP for Presence ERP with biometric verification and append-only audit ledger.";

export const Route = createRootRouteWithContext<{ queryClient: QueryClient }>()({
  head: () => ({
    meta: [
      { charSet: "utf-8" },
      { name: "viewport", content: "width=device-width, initial-scale=1" },
      { title: TITLE },
      { name: "description", content: DESC },
      { property: "og:title", content: TITLE },
      { property: "og:description", content: DESC },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
    links: [
      { rel: "stylesheet", href: appCss },
      { rel: "icon", href: "/favicon.png", type: "image/png" },
    ],
  }),
  shellComponent: RootShell,
  component: RootComponent,
  notFoundComponent: NotFoundComponent,
  errorComponent: ErrorComponent,
});

function RootShell({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <head>
        <HeadContent />
      </head>
      <body className="relative min-h-screen bg-slate-50/80 text-slate-900 dark:bg-slate-950/90 dark:text-slate-100 antialiased selection:bg-primary selection:text-primary-foreground">
        {/* Background Crest Watermark */}
        <div
          aria-hidden="true"
          className="pointer-events-none fixed inset-0 z-0 flex items-center justify-center overflow-hidden opacity-[0.04] dark:opacity-[0.08] select-none"
        >
          <img
            src="/logo.png"
            alt="Presence ERP Logo"
            className="h-[80vw] w-[80vw] max-h-[480px] max-w-[480px] object-contain filter drop-shadow-2xl"
          />
        </div>
        <div className="fixed bottom-4 right-4 z-50">
          <AccessibilityToolbar />
        </div>
        <div className="relative z-10 min-h-screen">{children}</div>
        <Scripts />
      </body>
    </html>
  );
}

// The expected SW version — must match CACHE_VERSION in public/sw.js.
// When the SW is updated, old clients with a stale SW are auto-evicted
// without requiring the user to manually clear their browser cache.
const EXPECTED_SW_VERSION = "presence-erp-v5-20260812";

function RootComponent() {
  const { queryClient } = Route.useRouteContext();
  const router = useRouter();

  // ── Service Worker: auto-evict stale SW versions ───────────────────────
  useEffect(() => {
    if (typeof window === "undefined" || !("serviceWorker" in navigator)) return;

    const evictStaleSw = async () => {
      try {
        const registrations = await navigator.serviceWorker.getRegistrations();
        for (const reg of registrations) {
          const sw = reg.active || reg.waiting || reg.installing;
          // Communicate with the SW to check its cache version
          if (sw) {
            const msgChannel = new MessageChannel();
            const versionPromise = new Promise<string>((resolve) => {
              msgChannel.port1.onmessage = (e) => resolve(e.data?.version ?? "");
              setTimeout(() => resolve(""), 2000); // 2s timeout
            });
            sw.postMessage({ type: "GET_VERSION" }, [msgChannel.port2]);
            const version = await versionPromise;
            if (version && version !== EXPECTED_SW_VERSION) {
              console.info(`[SW] Evicting stale SW (${version} → ${EXPECTED_SW_VERSION})`);
              await reg.unregister();
              // Re-register the new SW immediately
              await navigator.serviceWorker.register("/sw.js", { updateViaCache: "none" });
              // Hard reload once to pick up the new SW
              window.location.reload();
              return;
            }
          }
        }
        // If no SW is registered yet, register it fresh
        if (registrations.length === 0) {
          await navigator.serviceWorker.register("/sw.js", { updateViaCache: "none" });
        }
      } catch (e) {
        console.warn("[SW] Eviction check failed:", e);
      }
    };

    evictStaleSw();
  }, []);

  // ── Auth: handle password-recovery redirect ────────────────────────────
  useEffect(() => {
    if (typeof window === "undefined") return;

    const handleRecoveryCheck = (event?: string) => {
      const hash = window.location.hash || "";
      const search = window.location.search || "";
      const isRecovery =
        event === "PASSWORD_RECOVERY" ||
        hash.includes("type=recovery") ||
        search.includes("type=recovery");

      if (isRecovery && window.location.pathname !== "/reset-password") {
        router.navigate({ to: "/reset-password" });
      }
    };

    handleRecoveryCheck();

    const { data: sub } = supabase.auth.onAuthStateChange((event) => {
      if (event === "PASSWORD_RECOVERY") {
        handleRecoveryCheck(event);
      }
    });

    return () => {
      sub.subscription.unsubscribe();
    };
  }, [router]);

  return (
    <QueryClientProvider client={queryClient}>
      <SingleSessionGuard />
      <Outlet />
      <PwaUpdateBanner />
    </QueryClientProvider>
  );
}
