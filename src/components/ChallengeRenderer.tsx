import React, { useEffect, useState, useRef, useCallback } from "react";

export interface ChallengeRendererProps {
  colors: string[];
  colorDurationMs: number;
  action?: "blink" | "turn_left" | "turn_right" | "nod" | "smile";
  actionWindowMs?: number;
  mode?: "full_screen" | "spatial_periphery";
  onSequenceComplete?: () => void;
  onSequenceStart?: () => void;
  onColorChange?: (colorHex: string, timestampMs: number) => void;
}

const ACTION_INSTRUCTIONS: Record<string, string> = {
  blink: "👁️ Please blink your eyes now",
  turn_left: "← Slowly turn head left",
  turn_right: "→ Slowly turn head right",
  nod: "↕️ Nod your head up and down",
  smile: "😊 Smile at the camera",
};

/**
 * ChallengeRenderer
 * Renders active challenge color flashes with Spatial & Temporal Separation.
 * 
 * Defense & Signal Integrity:
 * 1. Temporal Interleaving: Flash sequence runs in Phase 2, separate from Phase 1 ambient rPPG.
 * 2. Spatial Separation: Peripheral flash banners illuminate screen borders while preserving
 *    a clear central aperture over the webcam preview to prevent ambient saturation.
 */
export const ChallengeRenderer: React.FC<ChallengeRendererProps> = ({
  colors,
  colorDurationMs = 350,
  action,
  actionWindowMs,
  mode = "spatial_periphery",
  onSequenceComplete,
  onSequenceStart,
  onColorChange,
}) => {
  const [currentColorIndex, setCurrentColorIndex] = useState<number>(-1);
  const [showActionPrompt, setShowActionPrompt] = useState<boolean>(false);
  const startTimeRef = useRef<number>(0);

  const runSequence = useCallback(() => {
    if (!colors || colors.length === 0) return () => {};

    startTimeRef.current = Date.now();
    onSequenceStart?.();

    let index = 0;
    setCurrentColorIndex(0);
    onColorChange?.(colors[0], 0);

    const colorTimer = setInterval(() => {
      index++;
      if (index >= colors.length) {
        clearInterval(colorTimer);
        setCurrentColorIndex(-1);
        onSequenceComplete?.();
      } else {
        setCurrentColorIndex(index);
        const elapsed = Date.now() - startTimeRef.current;
        onColorChange?.(colors[index], elapsed);
      }
    }, colorDurationMs);

    let actionTimer: NodeJS.Timeout | null = null;
    let actionHideTimer: NodeJS.Timeout | null = null;

    if (action && actionWindowMs) {
      actionTimer = setTimeout(() => {
        setShowActionPrompt(true);
        actionHideTimer = setTimeout(() => {
          setShowActionPrompt(false);
        }, 1500);
      }, actionWindowMs);
    }

    return () => {
      clearInterval(colorTimer);
      if (actionTimer) clearTimeout(actionTimer);
      if (actionHideTimer) clearTimeout(actionHideTimer);
    };
  }, [colors, colorDurationMs, action, actionWindowMs, onSequenceStart, onSequenceComplete, onColorChange]);

  useEffect(() => {
    const cleanup = runSequence();
    return cleanup;
  }, [runSequence]);

  const activeColor = currentColorIndex >= 0 && colors[currentColorIndex]
    ? colors[currentColorIndex]
    : "transparent";

  if (mode === "spatial_periphery") {
    return (
      <div aria-hidden="true" className="absolute inset-0 pointer-events-none rounded-xl overflow-hidden z-20">
        {/* Top Peripheral Flash Bar */}
        <div
          className="absolute top-0 inset-x-0 h-10 transition-colors duration-150 ease-in-out"
          style={{ backgroundColor: activeColor, opacity: currentColorIndex >= 0 ? 0.75 : 0 }}
        />
        {/* Bottom Peripheral Flash Bar */}
        <div
          className="absolute bottom-0 inset-x-0 h-10 transition-colors duration-150 ease-in-out"
          style={{ backgroundColor: activeColor, opacity: currentColorIndex >= 0 ? 0.75 : 0 }}
        />
        {/* Left Peripheral Flash Bar */}
        <div
          className="absolute inset-y-0 left-0 w-10 transition-colors duration-150 ease-in-out"
          style={{ backgroundColor: activeColor, opacity: currentColorIndex >= 0 ? 0.75 : 0 }}
        />
        {/* Right Peripheral Flash Bar */}
        <div
          className="absolute inset-y-0 right-0 w-10 transition-colors duration-150 ease-in-out"
          style={{ backgroundColor: activeColor, opacity: currentColorIndex >= 0 ? 0.75 : 0 }}
        />

        {showActionPrompt && action && (
          <div className="absolute top-12 left-1/2 -translate-x-1/2 bg-slate-900/90 backdrop-blur-md text-white text-xs font-semibold px-4 py-2 rounded-full border border-indigo-500/40 shadow-lg animate-bounce z-30">
            {ACTION_INSTRUCTIONS[action] || action}
          </div>
        )}
      </div>
    );
  }

  return (
    <div
      aria-hidden="true"
      className="absolute inset-0 pointer-events-none rounded-xl overflow-hidden transition-colors duration-150 ease-in-out z-20"
      style={{
        backgroundColor: activeColor,
        opacity: currentColorIndex >= 0 ? 0.4 : 0,
      }}
    >
      {showActionPrompt && action && (
        <div className="absolute top-4 left-1/2 -translate-x-1/2 bg-slate-900/90 backdrop-blur-md text-white text-xs font-semibold px-4 py-2 rounded-full border border-indigo-500/40 shadow-lg animate-bounce z-30">
          {ACTION_INSTRUCTIONS[action] || action}
        </div>
      )}
    </div>
  );
};
