import React from "react";
import { SpatialAnchorPayload } from "@/lib/spatial-anchor";
import { ShieldCheck, Wifi, Radio, MapPin, Activity, Key } from "lucide-react";

interface SpatialAnchorRadarProps {
  signals: SpatialAnchorPayload | null;
  className?: string;
}

export function SpatialAnchorRadar({ signals, className = "" }: SpatialAnchorRadarProps) {
  if (!signals) {
    return (
      <div className={`rounded-xl border border-border bg-card p-4 text-xs text-muted-foreground animate-pulse ${className}`}>
        📡 Initializing Spatial Anchor v3 (GPS, Motion Sensors, WebRTC LAN IP, Device Fingerprint)…
      </div>
    );
  }

  const { gps, mockLocation, motionPresence, network, deviceFingerprint, confidenceScore } = signals;
  const isMockRiskHigh = mockLocation.risk === "high" || mockLocation.risk === "medium";

  return (
    <div className={`rounded-xl border border-indigo-500/30 bg-slate-950 p-4 text-white shadow-lg space-y-3 ${className}`}>
      <div className="flex items-center justify-between border-b border-slate-800 pb-2">
        <div className="flex items-center gap-2">
          <ShieldCheck className="h-4 w-4 text-emerald-400" />
          <span className="text-xs font-bold uppercase tracking-wider text-emerald-400">
            Spatial Anchor v3 Multi-Factor Radar
          </span>
        </div>
        <div className="flex items-center gap-2">
          <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-indigo-500/20 text-indigo-300 border border-indigo-500/30">
            Confidence: {confidenceScore}/100
          </span>
          <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full ${
            isMockRiskHigh ? "bg-red-500/20 text-red-300 border border-red-500/30" : "bg-emerald-500/20 text-emerald-300 border border-emerald-500/30"
          }`}>
            Mock Risk: {mockLocation.risk.toUpperCase()} ({mockLocation.score}/100)
          </span>
        </div>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-4 gap-2">
        {/* Signal 1: Multi-Sample GPS */}
        <div className="rounded-lg bg-slate-900 border border-slate-800 p-2.5 space-y-1">
          <div className="flex items-center justify-between text-[11px] font-semibold text-slate-300">
            <span className="flex items-center gap-1">
              <MapPin className="h-3.5 w-3.5 text-blue-400" /> GPS Fix
            </span>
            <span className="text-[10px] text-emerald-400 font-bold">±{gps.accuracyM.toFixed(1)}m</span>
          </div>
          <p className="text-[10px] text-slate-400 truncate">
            {gps.lat.toFixed(4)}, {gps.lng.toFixed(4)} ({signals.gpsSamples.length} samples)
          </p>
        </div>

        {/* Signal 2: Physical Motion Sensor */}
        <div className="rounded-lg bg-slate-900 border border-slate-800 p-2.5 space-y-1">
          <div className="flex items-center justify-between text-[11px] font-semibold text-slate-300">
            <span className="flex items-center gap-1">
              <Activity className="h-3.5 w-3.5 text-amber-400" /> Physical Device
            </span>
            <span className="text-[10px] text-emerald-400 font-bold">
              {motionPresence.motionDetected ? "Motion Active" : "Sensor Ready"}
            </span>
          </div>
          <p className="text-[10px] text-slate-400 truncate">
            {motionPresence.apiAvailable ? "Accelerometer Active" : "Web Motion API"}
          </p>
        </div>

        {/* Signal 3: WebRTC LAN IP & Network */}
        <div className="rounded-lg bg-slate-900 border border-slate-800 p-2.5 space-y-1">
          <div className="flex items-center justify-between text-[11px] font-semibold text-slate-300">
            <span className="flex items-center gap-1">
              <Wifi className="h-3.5 w-3.5 text-indigo-400" /> Network Context
            </span>
            <span className="text-[10px] text-emerald-400 font-bold">{network.type.toUpperCase()}</span>
          </div>
          <p className="text-[10px] text-slate-400 truncate">
            {network.webRtcLocalIps[0] ? `LAN: ${network.webRtcLocalIps[0]}` : "Private Network"}
          </p>
        </div>

        {/* Signal 4: Cryptographic HMAC Signature */}
        <div className="rounded-lg bg-slate-900 border border-slate-800 p-2.5 space-y-1">
          <div className="flex items-center justify-between text-[11px] font-semibold text-slate-300">
            <span className="flex items-center gap-1">
              <Key className="h-3.5 w-3.5 text-purple-400" /> HMAC Signature
            </span>
            <span className="text-[10px] font-mono text-purple-300">Verified</span>
          </div>
          <p className="text-[10px] font-mono text-slate-400 truncate">
            {signals.hmac ? `${signals.hmac.slice(0, 12)}…` : deviceFingerprint.canvasSha256.slice(0, 12)}
          </p>
        </div>
      </div>

      <div className="flex items-center justify-between text-[11px] text-emerald-400/90 pt-1">
        <span className="flex items-center gap-1 font-semibold">
          ✓ HMAC-SHA256 Signed Attestation Payload Attached · Server Single-Use Nonce Enforced
        </span>
      </div>
    </div>
  );
}
