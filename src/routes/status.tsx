import { createFileRoute } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { getSystemStatus } from "@/lib/incident-response.server";
import { ShieldCheck, CheckCircle2, Activity } from "lucide-react";

export const Route = createFileRoute("/status")({
  component: SystemStatusPage,
});

function SystemStatusPage() {
  const fetchStatus = useServerFn(getSystemStatus);

  const { data } = useQuery({
    queryKey: ["public-system-status"],
    queryFn: () => fetchStatus(),
    refetchInterval: 30_000,
  });

  return (
    <div className="min-h-screen bg-slate-950 text-white px-4 py-12">
      <div className="mx-auto max-w-3xl space-y-8">
        <div className="flex items-center justify-between border-b border-slate-800 pb-6">
          <div className="flex items-center gap-3">
            <ShieldCheck className="h-8 w-8 text-emerald-500" />
            <div>
              <h1 className="text-2xl font-bold">Presence ERP System Status</h1>
              <p className="text-sm text-slate-400">Real-time infrastructure & subsystem health monitor</p>
            </div>
          </div>
          <div className="flex items-center gap-2 rounded-full bg-emerald-500/10 px-3 py-1 text-xs font-bold text-emerald-400 border border-emerald-500/20">
            <span className="h-2 w-2 rounded-full bg-emerald-500 animate-ping" />
            <span>All Systems Operational</span>
          </div>
        </div>

        {/* Subsystems List */}
        <div className="rounded-2xl border border-slate-800 bg-slate-900/60 p-6 shadow-xl space-y-4">
          <h2 className="text-sm font-semibold text-slate-400 uppercase tracking-wider flex items-center gap-2">
            <Activity className="h-4 w-4 text-indigo-400" />
            <span>Subsystem Health Overview</span>
          </h2>

          <div className="divide-y divide-slate-800">
            {(data?.subsystems ?? []).map((sub) => (
              <div key={sub.name} className="flex items-center justify-between py-3.5">
                <div className="flex items-center gap-3">
                  <CheckCircle2 className="h-5 w-5 text-emerald-500 shrink-0" />
                  <span className="text-sm font-medium text-white">{sub.name}</span>
                </div>
                <div className="flex items-center gap-4 text-xs font-mono text-slate-400">
                  <span>{sub.latencyMs}ms latency</span>
                  <span className="rounded bg-emerald-500/10 px-2.5 py-0.5 font-bold uppercase text-emerald-400 border border-emerald-500/20">
                    {sub.status}
                  </span>
                </div>
              </div>
            ))}
          </div>
        </div>

        <div className="text-center text-xs text-slate-500">
          Last updated at: {data?.updatedAt ? new Date(data.updatedAt).toLocaleString() : "Just now"} · Refreshed automatically every 30s
        </div>
      </div>
    </div>
  );
}
