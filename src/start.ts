// reflect-metadata must be first — tsyringe checks Reflect.metadata at module init.
import "reflect-metadata";
import { createStart, createMiddleware } from "@tanstack/react-start";


import { renderErrorPage } from "./lib/error-page";
import { attachSupabaseAuth } from "@/integrations/supabase/auth-attacher";

import { setCfEnv } from "@/lib/cf-env.server";

const errorMiddleware = createMiddleware().server(async ({ request, next }) => {
  setCfEnv((request as any)?.runtime?.cloudflare?.env);
  try {
    return await next();
  } catch (error) {
    if (error != null && typeof error === "object" && "statusCode" in error) {
      throw error;
    }
    console.error(error);
    return new Response(renderErrorPage(error), {
      status: 500,
      headers: { "content-type": "text/html; charset=utf-8" },
    });
  }
});

export const startInstance = createStart(() => ({
  functionMiddleware: [attachSupabaseAuth],
  requestMiddleware: [errorMiddleware],
}));
