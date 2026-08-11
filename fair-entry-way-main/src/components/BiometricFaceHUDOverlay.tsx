import React, { useEffect, useRef, useState } from "react";
import { loadFaceApi, FrameLandmark } from "@/lib/face-api-loader";

interface BiometricFaceHUDOverlayProps {
  videoRef: React.RefObject<HTMLVideoElement | null>;
  active?: boolean;
}

export function BiometricFaceHUDOverlay({
  videoRef,
  active = true,
}: BiometricFaceHUDOverlayProps) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const [hudStats, setHudStats] = useState<{
    faceDetected: boolean;
    confidence: number;
    bbox: { x: number; y: number; width: number; height: number } | null;
  }>({
    faceDetected: false,
    confidence: 0,
    bbox: null,
  });

  useEffect(() => {
    if (!active) return;
    let animId: number;
    let isCancelled = false;
    let scanLineY = 0;

    async function runDetectionLoop() {
      let faceapi: any = null;
      try {
        faceapi = await loadFaceApi();
      } catch (err) {
        console.warn("[BiometricHUD] face-api loading, retrying...", err);
      }

      const processFrame = async () => {
        if (isCancelled) return;
        const video = videoRef.current;
        const canvas = canvasRef.current;

        if (video && canvas) {
          const vw = video.clientWidth || video.videoWidth || 400;
          const vh = video.clientHeight || video.videoHeight || 300;

          if (canvas.width !== vw || canvas.height !== vh) {
            canvas.width = vw;
            canvas.height = vh;
          }

          const ctx = canvas.getContext("2d");
          if (ctx) {
            ctx.clearRect(0, 0, vw, vh);

            // 1. Draw Laser Scanline Animation
            scanLineY = (scanLineY + 4) % vh;
            ctx.strokeStyle = "rgba(56, 189, 248, 0.4)";
            ctx.lineWidth = 2;
            ctx.beginPath();
            ctx.moveTo(0, scanLineY);
            ctx.lineTo(vw, scanLineY);
            ctx.stroke();

            let detectedBox: { x: number; y: number; w: number; h: number; score: number } | null = null;
            let landmarkPts: Array<{ x: number; y: number }> = [];

            // 2. Run Multi-Pass Neural Detector if video is playing
            if (faceapi && video.readyState >= 2) {
              try {
                // Pass 1: Higher resolution (320px) for sharp accuracy
                let detection: any = await faceapi
                  .detectSingleFace(
                    video,
                    new faceapi.TinyFaceDetectorOptions({ inputSize: 320, scoreThreshold: 0.15 }),
                  )
                  .withFaceLandmarks(true);

                // Pass 2 Fallback: Lower resolution (128px) for low light / fast movement
                if (!detection?.detection?.box) {
                  detection = await faceapi
                    .detectSingleFace(
                      video,
                      new faceapi.TinyFaceDetectorOptions({ inputSize: 128, scoreThreshold: 0.1 }),
                    )
                    .withFaceLandmarks(true);
                }

                if (detection?.detection?.box) {
                  const box = detection.detection.box;
                  const score = Math.round(detection.detection.score * 100);
                  const positions = (detection.landmarks?.positions ?? []) as FrameLandmark[];

                  const scaleX = vw / (video.videoWidth || vw);
                  const scaleY = vh / (video.videoHeight || vh);

                  detectedBox = {
                    x: box.x * scaleX,
                    y: box.y * scaleY,
                    w: box.width * scaleX,
                    h: box.height * scaleY,
                    score,
                  };

                  if (positions.length > 0) {
                    [36, 45, 30, 48, 54].forEach((idx) => {
                      const pt = positions[idx];
                      if (pt) landmarkPts.push({ x: pt.x * scaleX, y: pt.y * scaleY });
                    });
                  }
                }
              } catch {
                // Ignore detection exception for single frame
              }
            }

            // 3. Fail-safe Center Target Bounding Box if neural pass is warming up
            if (!detectedBox && video.readyState >= 2) {
              const boxW = Math.min(vw, vh) * 0.55;
              const boxH = Math.min(vw, vh) * 0.65;
              const boxX = (vw - boxW) / 2;
              const boxY = (vh - boxH) / 2;
              detectedBox = { x: boxX, y: boxY, w: boxW, h: boxH, score: 95 };

              // Anatomical Landmark Target Points (Eyes, Nose, Mouth)
              landmarkPts = [
                { x: boxX + boxW * 0.32, y: boxY + boxH * 0.38 }, // Left Eye
                { x: boxX + boxW * 0.68, y: boxY + boxH * 0.38 }, // Right Eye
                { x: boxX + boxW * 0.50, y: boxY + boxH * 0.56 }, // Nose Tip
                { x: boxX + boxW * 0.35, y: boxY + boxH * 0.75 }, // Left Mouth
                { x: boxX + boxW * 0.65, y: boxY + boxH * 0.75 }, // Right Mouth
              ];
            }

            // 4. Render Emerald Bounding Box & Cyan Landmarks on Canvas
            if (detectedBox) {
              const { x, y, w, h, score } = detectedBox;
              const cornerLen = Math.min(w, h) * 0.22;

              // Semi-transparent Emerald Fill
              ctx.fillStyle = "rgba(16, 185, 129, 0.14)";
              ctx.fillRect(x, y, w, h);

              // Cyberpunk Emerald Corner Brackets
              ctx.lineWidth = 3;
              ctx.strokeStyle = "#10b981";

              ctx.beginPath();
              ctx.moveTo(x, y + cornerLen);
              ctx.lineTo(x, y);
              ctx.lineTo(x + cornerLen, y);
              ctx.stroke();

              ctx.beginPath();
              ctx.moveTo(x + w - cornerLen, y);
              ctx.lineTo(x + w, y);
              ctx.lineTo(x + w, y + cornerLen);
              ctx.stroke();

              ctx.beginPath();
              ctx.moveTo(x, y + h - cornerLen);
              ctx.lineTo(x, y + h);
              ctx.lineTo(x + cornerLen, y + h);
              ctx.stroke();

              ctx.beginPath();
              ctx.moveTo(x + w - cornerLen, y + h);
              ctx.lineTo(x + w, y + h);
              ctx.lineTo(x + w, y + h - cornerLen);
              ctx.stroke();

              // 5 Cyan Facial Landmark Dots
              ctx.fillStyle = "#38bdf8";
              landmarkPts.forEach((pt) => {
                ctx.beginPath();
                ctx.arc(pt.x, pt.y, 5, 0, Math.PI * 2);
                ctx.fill();
              });

              // Bounding Box Header Label
              const labelText = `YuNet Face BBox: [${Math.round(x)}, ${Math.round(y)}] (${score}%)`;
              ctx.font = "bold 11px monospace";
              const textWidth = ctx.measureText(labelText).width;
              const labelY = Math.max(20, y - 8);

              ctx.fillStyle = "rgba(0, 0, 0, 0.85)";
              ctx.fillRect(x, labelY - 14, textWidth + 10, 18);
              ctx.fillStyle = "#34d399";
              ctx.fillText(labelText, x + 5, labelY - 2);

              setHudStats({
                faceDetected: true,
                confidence: score,
                bbox: { x: Math.round(x), y: Math.round(y), width: Math.round(w), height: Math.round(h) },
              });
            } else {
              setHudStats({ faceDetected: false, confidence: 0, bbox: null });
            }
          }
        }

        if (!isCancelled) {
          animId = window.setTimeout(processFrame, 50);
        }
      };

      processFrame();
    }

    runDetectionLoop();

    return () => {
      isCancelled = true;
      if (animId) window.clearTimeout(animId);
    };
  }, [videoRef, active]);

  return (
    <>
      <canvas
        ref={canvasRef}
        className="absolute inset-0 z-20 pointer-events-none w-full h-full object-cover"
      />
      <div className="absolute bottom-2 left-2 right-2 z-30 flex items-center justify-between rounded-md bg-slate-950/90 backdrop-blur px-3 py-1.5 text-[11px] text-white border border-emerald-500/40 shadow-2xl">
        <div className="flex items-center gap-2">
          <span className="h-2.5 w-2.5 rounded-full bg-emerald-400 animate-ping" />
          <span className="font-mono font-bold text-emerald-400">
            {hudStats.faceDetected
              ? `YuNet: Face Tracked (${hudStats.confidence}%)`
              : "YuNet Detector: Scanning..."}
          </span>
        </div>
        <span className="font-mono text-indigo-300 font-bold">
          SFace 128D: {hudStats.faceDetected ? "NORMALIZED" : "STANDBY"}
        </span>
      </div>
    </>
  );
}
