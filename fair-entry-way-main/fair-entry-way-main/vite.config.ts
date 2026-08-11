// @lovable.dev/vite-tanstack-config already includes the following — do NOT add them manually
// or the app will break with duplicate plugins:
//   - TanStack devtools (dev-only, first), tanstackStart, viteReact, tailwindcss, tsConfigPaths,
//     nitro (build-only using cloudflare as a default target), VITE_* env injection, @ path alias,
//     React/TanStack dedupe, error logger plugins, and sandbox detection (port/host/strictPort).
// You can pass additional config via defineConfig({ vite: { ... }, etc... }) if needed.
/// <reference types="vitest" />
import { defineConfig } from "@lovable.dev/vite-tanstack-config";
import path from "path";

// NOTE: @lovable.dev/mcp-js Vite plugin removed — it has a Windows path-separator bug
// (assertContains compares forward-slash config.root against backslash path.resolve output).
// The MCP plugin is for Lovable.dev platform integration, not needed for self-hosted deployment.
// The existing auto-generated MCP route files are kept but excluded from lint via eslint.config.js.

export default defineConfig({
  tanstackStart: {
    // Redirect TanStack Start's bundled server entry to src/server.ts (our SSR error wrapper).
    // nitro/vite builds from this
    server: { entry: "server" },
  },
  vite: {
    // ─── tslib ESM/CJS interop fix ───────────────────────────────────────────
    // tslib MUST NOT be in ssr.noExternal.
    // When bundled via noExternal, Vite wraps it with __toESM(require('tslib')).
    // tslib's CJS build has no .default property, so __toESM(...).default is undefined.
    // This causes: "Cannot destructure property '__extends' of '__toESM(...).default'"
    resolve: {
      alias: {
        tslib: path.resolve("node_modules/tslib/tslib.es6.mjs"),
        "node:https": path.resolve("src/lib/node-https-mock.ts"),
        "node:http": path.resolve("src/lib/node-https-mock.ts"),
        https: path.resolve("src/lib/node-https-mock.ts"),
        http: path.resolve("src/lib/node-https-mock.ts"),
      },
    },
    optimizeDeps: {
      include: ["tslib"],
    },
    ssr: {
      // ─── tsyringe / reflect-metadata: server-only, never ship to client ───
      // tsyringe is a DI library used only on the server side (pulled in as a
      // transitive dependency). It calls Reflect.metadata at module init, which
      // does not exist in the browser. Externalising both packages prevents Vite
      // from including them in the client bundle entirely.
      external: ["tsyringe", "reflect-metadata"],
      noExternal: [
        // NOTE: tslib intentionally omitted — handled via resolve.alias + optimizeDeps above.
        "pvtsutils",
        "asn1js",
        "pkijs",
        "@simplewebauthn/server",
        "@simplewebauthn/browser",
        "@peculiar/x509",
        "@peculiar/asn1-schema",
        "@peculiar/asn1-x509",
        "@peculiar/asn1-cms",
        "@peculiar/asn1-csr",
        "@peculiar/asn1-ecc",
        "@peculiar/asn1-pkcs9",
        "@peculiar/asn1-rsa",
        "@peculiar/asn1-android",
        "@hexagon/base64",
        "@levischuck/tiny-cbor",
        "seroval",
        "@tanstack/router-core",
        "@tanstack/react-router",
        "@tanstack/react-start",
      ],
    },
  },
} as Parameters<typeof defineConfig>[0]);
