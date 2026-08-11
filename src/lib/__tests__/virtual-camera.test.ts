/**
 * Tests for Virtual Camera / Injected Video Driver Detection (Day 2 Task 6):
 * 1. Known virtual camera driver labels (OBS Virtual Camera, DroidCam, ManyCam, Snap Camera) are flagged.
 * 2. Normal hardware camera labels pass verification.
 */

import { describe, it, expect } from "vitest";
import { detectVirtualCamera } from "../face-api-loader";

describe("Virtual Camera Detection Engine", () => {
  it("rejects stream with OBS Virtual Camera label", () => {
    const mockStream = {
      getVideoTracks: () => [{ label: "OBS Virtual Camera" }],
    } as unknown as MediaStream;

    const res = detectVirtualCamera(mockStream);
    expect(res.isVirtual).toBe(true);
    expect(res.label).toBe("OBS Virtual Camera");
  });

  it("rejects stream with DroidCam Video label", () => {
    const mockStream = {
      getVideoTracks: () => [{ label: "DroidCam Source 3" }],
    } as unknown as MediaStream;

    const res = detectVirtualCamera(mockStream);
    expect(res.isVirtual).toBe(true);
  });

  it("rejects stream with ManyCam Virtual Webcam label", () => {
    const mockStream = {
      getVideoTracks: () => [{ label: "ManyCam Virtual Webcam" }],
    } as unknown as MediaStream;

    const res = detectVirtualCamera(mockStream);
    expect(res.isVirtual).toBe(true);
  });

  it("passes stream with physical Integrated Webcam label", () => {
    const mockStream = {
      getVideoTracks: () => [{ label: "Integrated Webcam (04f2:b604)" }],
    } as unknown as MediaStream;

    const res = detectVirtualCamera(mockStream);
    expect(res.isVirtual).toBe(false);
    expect(res.label).toBe("Integrated Webcam (04f2:b604)");
  });
});
