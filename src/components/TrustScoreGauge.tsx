import React, { useEffect, useState } from 'react';
import { Check, X, AlertCircle } from 'lucide-react';

interface TrustScoreGaugeProps {
  score: number; // 0-100
  breakdown?: {
    label: string;
    weight: number;
    achieved: number;
    detail: string;
  }[];
  size?: number; // default 180
  animated?: boolean; // default true
}

export function TrustScoreGauge({ score, breakdown, size = 180, animated = true }: TrustScoreGaugeProps) {
  const [currentScore, setCurrentScore] = useState(animated ? 0 : score);

  useEffect(() => {
    if (animated) {
      const timer = setTimeout(() => {
        setCurrentScore(score);
      }, 100);
      return () => clearTimeout(timer);
    } else {
      setCurrentScore(score);
    }
  }, [score, animated]);

  const radius = size * 0.45;
  const strokeWidth = size * 0.08;
  const circumference = 2 * Math.PI * radius;
  const strokeDashoffset = circumference - (currentScore / 100) * circumference;

  let colorClass = "stroke-emerald-500";
  let textClass = "text-emerald-500";
  let shadowClass = "drop-shadow-[0_0_15px_rgba(16,185,129,0.5)]";
  
  if (score < 60) {
    colorClass = "stroke-red-500";
    textClass = "text-red-500";
    shadowClass = "drop-shadow-[0_0_15px_rgba(239,68,68,0.5)]";
  } else if (score < 85) {
    colorClass = "stroke-amber-500";
    textClass = "text-amber-500";
    shadowClass = "drop-shadow-[0_0_15px_rgba(245,158,11,0.5)]";
  }

  return (
    <div className="flex flex-col items-center w-full max-w-sm mx-auto p-6 rounded-3xl bg-card border border-border shadow-xl">
      <div className="relative flex justify-center items-center" style={{ width: size, height: size }}>
        <svg 
          className="transform -rotate-90" 
          width={size} 
          height={size}
          viewBox={`0 0 ${size} ${size}`}
        >
          <circle
            cx={size / 2} cy={size / 2} r={radius}
            className="stroke-muted"
            strokeWidth={strokeWidth}
            fill="none"
          />
          <circle
            cx={size / 2} cy={size / 2} r={radius}
            className={`${colorClass} ${shadowClass} transition-all duration-800 ease-out`}
            strokeWidth={strokeWidth}
            fill="none"
            strokeLinecap="round"
            strokeDasharray={circumference}
            strokeDashoffset={strokeDashoffset}
            style={{ transition: 'stroke-dashoffset 800ms cubic-bezier(0.16, 1, 0.3, 1)' }}
          />
        </svg>
        <div className="absolute flex flex-col items-center justify-center">
          <span className={`text-5xl font-black tracking-tighter ${textClass}`}>
            {Math.round(currentScore)}
          </span>
          <span className="text-sm font-bold text-muted-foreground">/ 100</span>
        </div>
      </div>

      {breakdown && breakdown.length > 0 && (
        <div className="mt-8 w-full space-y-2">
          {breakdown.map((item, idx) => {
            const isGood = item.achieved > 0.7;
            const isBad = item.achieved < 0.3;
            const statusClass = isGood ? "bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border-emerald-500/20" : 
                                isBad ? "bg-red-500/10 text-red-600 dark:text-red-400 border-red-500/20" : 
                                "bg-amber-500/10 text-amber-600 dark:text-amber-400 border-amber-500/20";
            return (
              <div key={idx} className={`flex items-start gap-3 p-3 rounded-xl border ${statusClass}`}>
                <div className="mt-0.5 shrink-0">
                  {isGood ? <Check className="w-4 h-4" /> : isBad ? <X className="w-4 h-4" /> : <AlertCircle className="w-4 h-4" />}
                </div>
                <div className="flex-1 min-w-0">
                  <div className="flex justify-between items-center mb-0.5">
                    <span className="font-semibold text-sm truncate pr-2">{item.label}</span>
                    <span className="text-xs font-mono opacity-80 whitespace-nowrap">{item.weight}% wgt</span>
                  </div>
                  <p className="text-xs opacity-90 leading-snug">{item.detail}</p>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
