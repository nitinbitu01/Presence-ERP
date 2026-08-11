// reflect-metadata MUST be the very first import.
// tsyringe (pulled in as a transitive dependency) checks for Reflect.metadata
// at module initialisation time and crashes if it isn't present yet.
import "reflect-metadata";

import "./lib/error-capture";
import { setCfEnv } from "./lib/cf-env.server";

import { consumeLastCapturedError } from "./lib/error-capture";
import { renderErrorPage } from "./lib/error-page";

type ServerEntry = {
  fetch: (request: Request, env: unknown, ctx: unknown) => Promise<Response> | Response;
};

let serverEntryPromise: Promise<ServerEntry> | undefined;

async function getServerEntry(): Promise<ServerEntry> {
  if (!serverEntryPromise) {
    serverEntryPromise = import("@tanstack/react-start/server-entry").then(
      (m) => (m.default ?? m) as ServerEntry,
    );
  }
  return serverEntryPromise;
}

// ── Cloudflare env → cf-env bridge ─────────────────────────────────────────
// In Cloudflare Workers, secrets and vars live on the `env` object passed to
// fetch(), NOT in process.env (process.env is read-only in CF Workers runtime).
// We store the env object via setCfEnv() so that getSecret() in
// cf-env.server.ts can return the correct values to all server functions.

// h3 swallows in-handler throws into a normal 500 Response with body
// {\"unhandled\":true,\"message\":\"HTTPError\"} — try/catch alone never fires for those.
async function normalizeCatastrophicSsrResponse(response: Response): Promise<Response> {
  if (response.status < 500) return response;
  const contentType = response.headers.get("content-type") ?? "";
  if (!contentType.includes("application/json")) return response;

  const body = await response.clone().text();
  if (!isH3SwallowedErrorBody(body)) return response;

  console.error(consumeLastCapturedError() ?? new Error(`h3 swallowed SSR error: ${body}`));
  return new Response(
    renderErrorPage(consumeLastCapturedError() ?? new Error(`h3 swallowed SSR error: ${body}`)),
    {
      status: 500,
      headers: { "content-type": "text/html; charset=utf-8" },
    },
  );
}

function isH3SwallowedErrorBody(body: string): boolean {
  try {
    const payload = JSON.parse(body) as { unhandled?: unknown; message?: unknown };
    return payload.unhandled === true && payload.message === "HTTPError";
  } catch {
    return false;
  }
}

export default {
  async fetch(request: Request, env: unknown, ctx: unknown) {
    // Nitro Cloudflare Pages preset attaches secrets & bindings to request.runtime.cloudflare.env
    const realEnv = env ?? (request as any)?.runtime?.cloudflare?.env;
    setCfEnv(realEnv);

    // Ensure ctx is never null/undefined and always has a valid waitUntil function
    // to prevent Nitro's augmentReq from throwing TypeError: Cannot read properties of undefined (reading 'bind')
    const safeCtx = {
      ...(typeof ctx === "object" && ctx ? ctx : {}),
      waitUntil: (promise: Promise<unknown>) => {
        if (ctx && typeof (ctx as any).waitUntil === "function") {
          try {
            (ctx as any).waitUntil(promise);
          } catch {
            // ignore waitUntil errors on non-supporting runtimes
          }
        }
      },
    };

    try {
      const handler = await getServerEntry();
      const response = await handler.fetch(request, realEnv, safeCtx);
      return await normalizeCatastrophicSsrResponse(response);
    } catch (error) {
      console.error("[SSR Fetch Catastrophic Error]", error);
      return new Response(renderErrorPage(error), {
        status: 500,
        headers: { "content-type": "text/html; charset=utf-8" },
      });
    }
  },
};
