import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { handleSsoCallback } from "@/lib/sso.server";
import { Loader2, AlertCircle, CheckCircle2 } from "lucide-react";

export const Route = createFileRoute("/auth/sso/callback")({
  component: SsoCallbackPage,
});

function SsoCallbackPage() {
  const navigate = useNavigate();
  const processCallback = useServerFn(handleSsoCallback);
  const [error, setError] = useState<string | null>(null);
  const [status, setStatus] = useState<"processing" | "success" | "error">("processing");

  useEffect(() => {
    async function run() {
      try {
        const params = new URLSearchParams(window.location.search);
        const providerId = params.get("providerId") || "azure_ad_rru";
        const state = params.get("state") || params.get("RelayState") || "";
        const code = params.get("code") || undefined;
        const samlResponse = params.get("SAMLResponse") || undefined;

        if (!state) {
          throw new Error("Missing required state parameter in SSO response.");
        }

        const result = await processCallback({
          data: {
            providerId,
            state,
            code,
            samlResponse,
          },
        });

        if (result.success) {
          setStatus("success");
          setTimeout(() => {
            navigate({ to: "/admin" });
          }, 1200);
        }
      } catch (err) {
        setStatus("error");
        setError((err as Error).message);
      }
    }

    run();
  }, [navigate, processCallback]);

  return (
    <div className="flex min-h-screen flex-col items-center justify-center bg-slate-950 px-4 text-white">
      <div className="w-full max-w-md rounded-2xl border border-slate-800 bg-slate-900/80 p-8 shadow-2xl backdrop-blur-xl text-center">
        {status === "processing" && (
          <div className="flex flex-col items-center space-y-4">
            <Loader2 className="h-12 w-12 animate-spin text-indigo-500" />
            <h2 className="text-xl font-bold">Verifying SSO Identity...</h2>
            <p className="text-sm text-slate-400">Exchanging authorization tokens and validating session assertion.</p>
          </div>
        )}

        {status === "success" && (
          <div className="flex flex-col items-center space-y-4">
            <CheckCircle2 className="h-12 w-12 text-emerald-500 animate-bounce" />
            <h2 className="text-xl font-bold text-emerald-400">SSO Authentication Successful!</h2>
            <p className="text-sm text-slate-400">Redirecting to your dashboard...</p>
          </div>
        )}

        {status === "error" && (
          <div className="flex flex-col items-center space-y-4">
            <AlertCircle className="h-12 w-12 text-rose-500" />
            <h2 className="text-xl font-bold text-rose-400">SSO Verification Failed</h2>
            <p className="text-sm text-slate-300 bg-rose-950/50 p-3 rounded-lg border border-rose-800/50 w-full text-left font-mono text-xs">{error}</p>
            <button
              onClick={() => navigate({ to: "/auth" })}
              className="mt-4 rounded-lg bg-indigo-600 px-5 py-2 text-sm font-semibold hover:bg-indigo-500 transition-colors"
            >
              Return to Login
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
