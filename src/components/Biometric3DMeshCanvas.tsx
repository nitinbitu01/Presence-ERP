/**
 * Phase B Enhancement — 3D WebGL / HTML5 Facial Mesh Visualization Canvas
 * Renders interactive 3D facial wireframe mesh contours, landmark nodes,
 * and vertical laser depth scan animations during liveness checks.
 */

import React, { useEffect, useRef } from "react";

export interface Biometric3DMeshCanvasProps {
  width?: number;
  height?: number;
  isScanning?: boolean;
  depthScore?: number;
}

export const Biometric3DMeshCanvas: React.FC<Biometric3DMeshCanvasProps> = ({
  width = 320,
  height = 240,
  isScanning = true,
  depthScore = 0.042,
}) => {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    let animFrameId: number;
    let scanY = 0;
    let scanDirection = 1;

    // 3D Facial Mesh Keypoints (Normalized 0..1 scale)
    const landmarks3D = [
      { x: 0.5, y: 0.35, z: 0.8, label: "nose_tip" },
      { x: 0.38, y: 0.3, z: 0.2, label: "left_eye" },
      { x: 0.62, y: 0.3, z: 0.2, label: "right_eye" },
      { x: 0.5, y: 0.52, z: 0.4, label: "mouth_center" },
      { x: 0.32, y: 0.45, z: -0.2, label: "left_cheek" },
      { x: 0.68, y: 0.45, z: -0.2, label: "right_cheek" },
      { x: 0.5, y: 0.72, z: 0.1, label: "chin" },
      { x: 0.25, y: 0.3, z: -0.4, label: "left_temple" },
      { x: 0.75, y: 0.3, z: -0.4, label: "right_temple" },
    ];

    const render = () => {
      ctx.clearRect(0, 0, width, height);

      // Draw background grid overlay
      ctx.strokeStyle = "rgba(99, 102, 241, 0.15)";
      ctx.lineWidth = 1;
      const gridSize = 20;
      for (let x = 0; x < width; x += gridSize) {
        ctx.beginPath();
        ctx.moveTo(x, 0);
        ctx.lineTo(x, height);
        ctx.stroke();
      }
      for (let y = 0; y < height; y += gridSize) {
        ctx.beginPath();
        ctx.moveTo(0, y);
        ctx.lineTo(width, y);
        ctx.stroke();
      }

      // Draw 3D Face Wireframe Contours
      ctx.strokeStyle = depthScore > 0.02 ? "#6366f1" : "#f59e0b";
      ctx.lineWidth = 1.5;

      // Outer Jaw Contour
      const jawIndices = [7, 4, 6, 5, 8];
      ctx.beginPath();
      jawIndices.forEach((idx, i) => {
        const pt = landmarks3D[idx];
        if (!pt) return;
        const px = pt.x * width;
        const py = pt.y * height;
        if (i === 0) ctx.moveTo(px, py);
        else ctx.lineTo(px, py);
      });
      ctx.stroke();

      // Eye Bridge & Nose Bridge Contour
      ctx.beginPath();
      ctx.moveTo(landmarks3D[1]!.x * width, landmarks3D[1]!.y * height);
      ctx.lineTo(landmarks3D[0]!.x * width, landmarks3D[0]!.y * height);
      ctx.lineTo(landmarks3D[2]!.x * width, landmarks3D[2]!.y * height);
      ctx.stroke();

      // Draw 3D Mesh Nodes
      landmarks3D.forEach((pt) => {
        const px = pt.x * width;
        const py = pt.y * height;
        const radius = 3 + pt.z * 2;

        ctx.fillStyle = "#818cf8";
        ctx.beginPath();
        ctx.arc(px, py, Math.max(2, radius), 0, Math.PI * 2);
        ctx.fill();

        // Node Glow Ring
        ctx.strokeStyle = "rgba(129, 140, 248, 0.4)";
        ctx.beginPath();
        ctx.arc(px, py, Math.max(4, radius + 3), 0, Math.PI * 2);
        ctx.stroke();
      });

      // Animated Vertical Laser Depth Scan Line
      if (isScanning) {
        scanY += scanDirection * 2;
        if (scanY >= height || scanY <= 0) {
          scanDirection *= -1;
        }

        const gradient = ctx.createLinearGradient(0, scanY - 10, 0, scanY + 10);
        gradient.addColorStop(0, "rgba(99, 102, 241, 0)");
        gradient.addColorStop(0.5, "rgba(129, 140, 248, 0.8)");
        gradient.addColorStop(1, "rgba(99, 102, 241, 0)");

        ctx.fillStyle = gradient;
        ctx.fillRect(0, scanY - 10, width, 20);

        ctx.strokeStyle = "#a5b4fc";
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.moveTo(0, scanY);
        ctx.lineTo(width, scanY);
        ctx.stroke();
      }

      animFrameId = requestAnimationFrame(render);
    };

    render();

    return () => {
      cancelAnimationFrame(animFrameId);
    };
  }, [width, height, isScanning, depthScore]);

  return (
    <canvas
      ref={canvasRef}
      width={width}
      height={height}
      className="absolute inset-0 h-full w-full pointer-events-none rounded-xl"
      aria-label="Live 3D facial mesh visualization"
    />
  );
};
