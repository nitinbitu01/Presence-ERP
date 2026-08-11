import React from 'react';
import { ShieldAlert, ShieldCheck, Zap } from 'lucide-react';

interface LedgerRow {
  id: string;
  studentName: string;
  rollNo: string;
  decision: string;
  trustScore: number | null;
  recordHash: string | null;
  recomputedHash: string;
  verified: boolean;
  createdAt: string;
}

interface LedgerChainViewerProps {
  rows: LedgerRow[];
  allVerified: boolean;
  onAttemptTamper?: (ledgerId: string) => void;
  tamperResult?: { tamperBlocked: boolean; message: string } | null;
}

export function LedgerChainViewer({ rows, allVerified, onAttemptTamper, tamperResult }: LedgerChainViewerProps) {
  return (
    <div className="w-full max-w-3xl mx-auto py-8">
      {/* Integrity Summary Banner */}
      <div className={`mb-8 p-4 rounded-xl border flex items-center gap-3 font-bold shadow-sm ${allVerified ? 'bg-emerald-50 border-emerald-200 text-emerald-800 dark:bg-emerald-950/30 dark:border-emerald-800 dark:text-emerald-300' : 'bg-red-50 border-red-200 text-red-800 dark:bg-red-950/30 dark:border-red-800 dark:text-red-300'}`}>
        {allVerified ? <ShieldCheck className="w-6 h-6" /> : <ShieldAlert className="w-6 h-6" />}
        <span>
          {allVerified 
            ? `All ${rows.length} records cryptographically verified ✓` 
            : `Chain integrity BROKEN. Validation failed.`}
        </span>
      </div>

      {tamperResult && (
        <div className={`mb-8 p-4 rounded-xl border text-sm font-medium flex items-center gap-2 ${tamperResult.tamperBlocked ? 'bg-red-100 border-red-300 text-red-900 dark:bg-red-900/40 dark:border-red-700 dark:text-red-200' : 'bg-amber-100 border-amber-300 text-amber-900 dark:bg-amber-900/40 dark:border-amber-700 dark:text-amber-200'}`}>
          <Zap className="w-5 h-5" />
          {tamperResult.message}
        </div>
      )}

      <div className="relative flex flex-col items-center">
        {/* GENESIS marker */}
        <div className="px-4 py-1.5 rounded-full bg-slate-200 dark:bg-slate-800 text-xs font-black tracking-widest text-slate-500 uppercase z-10 border border-slate-300 dark:border-slate-700">
          GENESIS BLOCK
        </div>

        {rows.map((row, idx) => {
          const isVerified = row.verified;
          const decisionColors = 
            row.decision === 'present' ? 'bg-emerald-100 text-emerald-700 border-emerald-200 dark:bg-emerald-500/20 dark:text-emerald-300' :
            row.decision === 'review' ? 'bg-amber-100 text-amber-700 border-amber-200 dark:bg-amber-500/20 dark:text-amber-300' :
            'bg-red-100 text-red-700 border-red-200 dark:bg-red-500/20 dark:text-red-300';
            
          return (
            <div key={row.id} className="relative w-full flex flex-col items-center group">
              {/* Connecting line to previous */}
              <div className={`w-1 h-8 ${isVerified ? 'bg-emerald-400 dark:bg-emerald-600' : 'border-l-2 border-dashed border-red-500'}`}></div>
              
              {/* Node Card */}
              <div className={`w-full relative bg-card border ${isVerified ? 'border-border shadow-sm' : 'border-red-400 shadow-red-500/20 shadow-lg'} rounded-2xl p-5 transition-all hover:shadow-md z-10`}>
                <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
                  
                  {/* Left info */}
                  <div>
                    <div className="flex items-center gap-2 mb-1">
                      <h4 className="font-bold text-foreground text-lg">{row.studentName}</h4>
                      <span className="text-xs font-medium text-muted-foreground bg-muted px-2 py-0.5 rounded-md">{row.rollNo}</span>
                    </div>
                    <div className="flex items-center gap-2">
                      <span className={`text-xs font-bold uppercase tracking-wider px-2 py-0.5 rounded-md border ${decisionColors}`}>
                        {row.decision}
                      </span>
                      {row.trustScore !== null && (
                        <span className="text-xs font-semibold text-muted-foreground">
                          Score: {row.trustScore}/100
                        </span>
                      )}
                    </div>
                  </div>

                  {/* Hash info */}
                  <div className="flex flex-col items-start sm:items-end gap-2">
                    <div className="flex items-center gap-2">
                      <span className="text-xs text-muted-foreground">Hash:</span>
                      <code className="text-xs font-mono bg-muted px-2 py-1 rounded border border-border">
                        {(row.recordHash || row.recomputedHash).substring(0, 12)}...
                      </code>
                    </div>
                    
                    <div className="flex items-center gap-3">
                      {isVerified ? (
                        <span className="inline-flex items-center gap-1 text-xs font-bold text-emerald-600 dark:text-emerald-400">
                          <CheckIcon /> VERIFIED
                        </span>
                      ) : (
                        <span className="inline-flex items-center gap-1 text-xs font-bold text-red-600 dark:text-red-400">
                          <XIcon /> BROKEN
                        </span>
                      )}
                      
                      {onAttemptTamper && (
                        <button
                          onClick={() => onAttemptTamper(row.id)}
                          className="opacity-0 group-hover:opacity-100 transition-opacity inline-flex items-center gap-1 px-2 py-1 rounded bg-slate-100 hover:bg-slate-200 dark:bg-slate-800 dark:hover:bg-slate-700 text-xs font-semibold text-slate-700 dark:text-slate-300 border border-slate-300 dark:border-slate-600"
                        >
                          <Zap className="w-3 h-3 text-amber-500" /> Tamper
                        </button>
                      )}
                    </div>
                  </div>
                </div>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

function CheckIcon() {
  return (
    <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={3}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
    </svg>
  );
}

function XIcon() {
  return (
    <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={3}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
    </svg>
  );
}
