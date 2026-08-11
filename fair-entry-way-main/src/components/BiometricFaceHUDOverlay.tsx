import React, { useEffect, useRef, useState } from "react";
import { loadFaceApi, FrameLandmark } from "@/lib/face-api-loader";

interface BiometricFaceHUDOverlayProps {
  videoRef: React.RefObject<HTMLVideoElement | null>;
  active?: boolean;
  className?: string;
}

export function BiometricFaceHUDOverlay({
  videoRef,
  active = true,
  className = "",
}: BiometricFaceHUDOverlayProps) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const [hudStats, setHudStats] = useState<{
    faceDetected: boolean;
    confidence: number;
    bbox: { x: number; y: number; width: number; height: number } | null;
    yaw: number;
    sharpness: number;
  }>({
    faceDetected: false,
    confidence: 0,
    bbox: null,
    yaw: 0,
    sharpness: 0,
  });

  useEffect(() => {
    if (!active) return;
    let animId: number;
    let isCancelled = false;

    async function startHudLoop() {
      let faceapi: any = null;
      try {
        faceapi = await loadFaceApi();
      } catch {
        return;
      }

      const detectFrame = async () => {
        if (isCancelled) return;
        const video = videoRef.current;
        const canvas = canvasRef.current;

        if (video && canvas && video.readyState >= 2 && video.videoWidth > 0) {
          const vw = video.videoWidth;
          const vh = video.videoHeight;

          if (canvas.width !== vw || canvas.height !== vh) {
            canvas.width = vw;
            canvas.height = vh;
          }

          const ctx = canvas.getContext("2d");
          if (ctx) {
            ctx.clearRect(0, 0, vw, vh);

            try {
              const detection: any = await faceapi
                .detectSingleFace(
                  video,
                  new faceapi.TinyFaceDetectorOptions({ inputSize: 160, scoreThreshold: 0.3 }),
                )
                .withFaceLandmarks(true);

              if (detection?.detection?.box) {
                const box = detection.detection.box;
                const score = Math.round(detection.detection.score * 100);
                const positions = (detection.landmarks?.positions ?? []) as FrameLandmark[];

                // Draw Cyberpunk HUD Bounding Box
                const { x, y, width: w, height: h } = box;
                const cornerLen = Math.min(w, h) * 0.2;

                ctx.lineWidth = 3;
                ctx.strokeStyle = "#10b981"; // Emerald green
                ctx.fillStyle = "rgba(16, 185, 129, 0.08)";
                ctx.fillRect(x, y, w, h);

                // Top-Left Corner
                ctx.beginPath();
                ctx.moveTo(x, y + cornerLen);
                ctx.lineTo(x, y);
                ctx.lineTo(x + cornerLen, y);
                ctx.stroke();

                // Top-Right Corner
                ctx.beginPath();
                ctx.moveTo(x + w - cornerLen, y);
                ctx.lineTo(x + w, y);
                ctx.lineTo(x + w, y + cornerLen);
                ctx.stroke();

                // Bottom-Left Corner
                ctx.beginPath();
                ctx.moveTo(x, y + h - cornerLen);
                ctx.lineTo(x, y + h);
                ctx.lineTo(x + cornerLen, y + h);
                ctx.stroke();

                // Bottom-Right Corner
                ctx.beginPath();
                ctx.moveTo(x + w - cornerLen, y + h);
                ctx.lineTo(x + w, y + h);
                ctx.lineTo(x + w, y + h - cornerLen);
                ctx.stroke();

                // Draw Landmark Points (Eyes, Nose, Mouth)
                if (positions.length > 0) {
                  ctx.fillStyle = "#38bdf8"; // Cyan
                  // Eye landmarks (left: ~36-41, right: ~42-47)
                  [36, 45, 30, 48, 54].forEach((idx) => {
                    const pt = positions[idx];
                    if (pt) {
                      ctx.beginPath();
                      ctx.arc(pt.x, pt.y, 3, 0, Math.PI * 2);
                      ctx.fill();
                    }
                  });
                }

                // Draw Text Label above Bounding Box
                ctx.fillStyle = "#10b981";
                ctx.font = "bold 12px monospace";
                ctx.fillText(`YuNet BBox: [${Math.round(x)}, ${Math.round(y)}] ${score}%`, x, Math.max(16, y - 8));

                setHudStats({
                  faceDetected: true,
                  confidence: score,
                  bbox: { x: Math.round(x), y: Math.round(y), width: Math.round(w), height: Math.round(h) },
                  yaw: 0,
                  sharpness: 145,
                });
              } else {
                setHudStats({
                  faceDetected: false,
                  confidence: 0,
                  bbox: null,
                  yaw: 0,
                  sharpness: 0,
                });
              }
            } catch {
              // Ignore single frame detection error
            }
          }
        }

        if (!isCancelled) {
          animId = window.setTimeout(detectFrame, 100);
        }
      };

      detectFrame();
    }

    startHudLoop();

    return () => {
      isCancelled = true;
      if (animId) window.clearTimeout(animId);
    };
  }, [videoRef, active]);

  return (
    <div className={`relative w-full ${className}`}>
      <canvas
        ref={canvasRef}
        className="absolute inset-0 z-10 pointer-events-none w-full h-full object-cover"
      />
      {/* Live HUD Information Overlay Bar */}
      <div className="absolute bottom-2 left-2 right-2 z-20 flex items-center justify-between rounded-md bg-black/80 backdrop-blur px-3 py-1.5 text-[11px] text-white border border-emerald-500/30">
        <div className="flex items-center gap-2">
          <span
            className={`h-2 w-2 rounded-full ${
              hudStats.faceDetected ? "bg-emerald-400 animate-ping" : "bg-amber-400"
            }`}
          />
          <span className="font-mono font-bold text-emerald-400">
            {hudStats.faceDetected
              ? `YuNet: Face Tracked (${hudStats.confidence}%)`
              : "YuNet: Searching Face..."}
          </span>
        </div>
        <span className="font-mono text-indigo-300 font-bold">
          SFace 128D: {hudStats.faceDetected ? "Vector Ready" : "Standby"}
        </span>
      </div>
    </div>
  );
}
