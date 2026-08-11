// Presence ERP Service Worker — v3
// Strategy:
//  - Navigation requests: Network-first with offline fallback
//  - Model .bin files: Cache-first (large binary, version-stable between deploys)
//  - Model .json manifests: Network-first (small, must always reflect latest chunk filenames)
//  - JS/CSS/images: Stale-while-revalidate
//  - API / server-fn calls: Never cached (bypass SW entirely)
//
// IMPORTANT: The cache version string below MUST be bumped on every deploy that
// changes model manifest content.  Otherwise stale manifests can point to
// non-existent chunk URLs after a redeploy, causing face-api to receive an HTML
// error page instead of JSON, which then propagates as a raw-HTML error string
// displayed to the user.

const CACHE_VERSION = "presence-erp-v3-20260808";
const BIN_CACHE = `${CACHE_VERSION}-bins`;
const STATIC_CACHE = `${CACHE_VERSION}-static`;
const KNOWN_CACHES = [BIN_CACHE, STATIC_CACHE];

// ─── Version query (used by app to auto-evict stale SWs) ────────────────────
self.addEventListener("message", (event) => {
  if (event.data?.type === "GET_VERSION") {
    event.ports[0]?.postMessage({ version: CACHE_VERSION });
  }
});

// ─── Install ────────────────────────────────────────────────────────────────
self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(STATIC_CACHE).then((cache) =>
      cache.addAll(["/", "/favicon.ico", "/rru-logo.png"]),
    ),
  );
  self.skipWaiting();
});

// ─── Activate: delete all old caches ────────────────────────────────────────
self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(
        keys
          .filter((k) => !KNOWN_CACHES.includes(k))
          .map((k) => caches.delete(k)),
      ),
    ),
  );
  self.clients.claim();
});

// ─── Helpers ─────────────────────────────────────────────────────────────────
function isApiOrServerFn(url) {
  return (
    url.pathname.startsWith("/_server/") ||
    url.pathname.startsWith("/api/") ||
    url.searchParams.has("_serverFnId") ||
    url.pathname.includes("supabase")
  );
}

function isModelBin(url) {
  return url.pathname.includes("/models/") && url.pathname.endsWith(".bin");
}

function isModelManifest(url) {
  return (
    url.pathname.includes("/models/") && url.pathname.endsWith(".json")
  );
}

function isVendorScript(url) {
  return url.pathname.includes("/vendor/") && url.pathname.endsWith(".js");
}

function isStaticAsset(url) {
  return (
    url.pathname.endsWith(".png") ||
    url.pathname.endsWith(".jpg") ||
    url.pathname.endsWith(".ico") ||
    url.pathname.endsWith(".css") ||
    (url.pathname.endsWith(".js") && !url.pathname.includes("/vendor/"))
  );
}

// Fetch with validation: rejects if response is not OK or is HTML when JSON expected
async function safeFetch(req, expectJson) {
  const resp = await fetch(req);
  if (!resp.ok) {
    throw new Error(
      `Network response not ok: ${resp.status} ${resp.statusText} for ${req.url || req}`,
    );
  }
  if (expectJson) {
    const ct = resp.headers.get("content-type") || "";
    if (ct.includes("text/html")) {
      throw new Error(
        `Expected JSON but received HTML for ${req.url || req}. Possible 404 or server error.`,
      );
    }
  }
  return resp;
}

// ─── Fetch ────────────────────────────────────────────────────────────────────
self.addEventListener("fetch", (event) => {
  const req = event.request;
  if (req.method !== "GET") return;

  const url = new URL(req.url);

  // 1. Never intercept API/server-fn calls — let them go straight to network
  if (isApiOrServerFn(url)) return;

  // 2. Navigation: network-first, fall back to cached "/"
  if (req.mode === "navigate") {
    event.respondWith(
      fetch(req).catch(async () => {
        const cache = await caches.open(STATIC_CACHE);
        return (await cache.match(req)) || (await cache.match("/"));
      }),
    );
    return;
  }

  // 3. Model .bin files: cache-first (binary blobs are large and version-stable)
  if (isModelBin(url)) {
    event.respondWith(
      caches.open(BIN_CACHE).then(async (cache) => {
        const cached = await cache.match(req);
        if (cached) return cached;
        const resp = await safeFetch(req, false);
        cache.put(req, resp.clone());
        return resp;
      }),
    );
    return;
  }

  // 4. Model .json manifests: ALWAYS network-first — never serve stale manifests
  //    If network fails, return a proper error (do NOT serve stale HTML-as-JSON).
  if (isModelManifest(url)) {
    event.respondWith(
      safeFetch(req, true).catch((err) => {
        console.error("[SW] Model manifest fetch failed:", err.message);
        // Return a proper 503 JSON error so face-api gets a parseable failure
        return new Response(
          JSON.stringify({ error: "Model manifest unavailable", detail: err.message }),
          {
            status: 503,
            headers: { "Content-Type": "application/json" },
          },
        );
      }),
    );
    return;
  }

  // 5. Vendor scripts (face-api.min.js): cache-first after first download
  if (isVendorScript(url)) {
    event.respondWith(
      caches.open(STATIC_CACHE).then(async (cache) => {
        const cached = await cache.match(req);
        if (cached) return cached;
        const resp = await safeFetch(req, false);
        cache.put(req, resp.clone());
        return resp;
      }),
    );
    return;
  }

  // 6. Static assets: stale-while-revalidate
  if (isStaticAsset(url)) {
    event.respondWith(
      caches.open(STATIC_CACHE).then(async (cache) => {
        const cached = await cache.match(req);
        const networkFetch = safeFetch(req, false)
          .then((resp) => {
            cache.put(req, resp.clone());
            return resp;
          })
          .catch(() => cached);
        return cached || networkFetch;
      }),
    );
    return;
  }

  // 7. Everything else: pass through to network
});

// ─── Notification deep-link ──────────────────────────────────────────────────
self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const targetUrl = event.notification.data?.url || "/";
  event.waitUntil(
    clients.matchAll({ type: "window", includeUncontrolled: true }).then((clientList) => {
      for (const client of clientList) {
        if (client.url.includes(targetUrl) && "focus" in client) {
          return client.focus();
        }
      }
      if (clients.openWindow) return clients.openWindow(targetUrl);
    }),
  );
});
