/**
 * Phase 6.9 — Dynamic Per-Tenant PWA Manifest Engine
 * Generates a custom manifest.json for each college/institution tenant
 * matching their official institution name, short name, theme colors, and logos.
 */

import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";

export interface TenantManifestOptions {
  tenantId?: string;
  name?: string;
  shortName?: string;
  themeColor?: string;
  backgroundColor?: string;
  iconUrl?: string;
}

export const getDynamicTenantManifest = createServerFn({ method: "GET" })
  .inputValidator((input: unknown) =>
    z
      .object({
        name: z.string().optional().default("Presence ERP"),
        shortName: z.string().optional().default("Presence"),
        themeColor: z.string().optional().default("#0f172a"),
        backgroundColor: z.string().optional().default("#0f172a"),
        iconUrl: z.string().optional().default("/logo.png"),
      })
      .parse(input ?? {}),
  )
  .handler(async ({ data }) => {
    return {
      name: data.name,
      short_name: data.shortName,
      start_url: "/",
      display: "standalone",
      background_color: data.backgroundColor,
      theme_color: data.themeColor,
      description: `Official attendance and academic workforce ERP system for ${data.name}`,
      icons: [
        {
          src: data.iconUrl,
          sizes: "192x192 512x512",
          type: "image/png",
          purpose: "any maskable",
        },
      ],
    };
  });
