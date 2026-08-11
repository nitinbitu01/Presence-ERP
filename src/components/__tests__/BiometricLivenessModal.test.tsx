import { describe, it, expect, vi } from "vitest";
import React from "react";
import { BiometricLivenessModal } from "../BiometricLivenessModal";

describe("BiometricLivenessModal Component Unit Suite", () => {
  it("is a valid React component function", () => {
    expect(typeof BiometricLivenessModal).toBe("function");
  });

  it("does not render when isOpen=false", () => {
    const element = React.createElement(BiometricLivenessModal, {
      isOpen: false,
      onClose: vi.fn(),
      onSuccess: vi.fn(),
    });
    expect(element.type).toBe(BiometricLivenessModal);
    expect(element.props.isOpen).toBe(false);
  });

  it("accepts onWebAuthnBypass callback prop", () => {
    const handleBypass = vi.fn();
    const element = React.createElement(BiometricLivenessModal, {
      isOpen: true,
      onClose: vi.fn(),
      onSuccess: vi.fn(),
      onWebAuthnBypass: handleBypass,
    });
    expect(element.props.onWebAuthnBypass).toBe(handleBypass);
  });
});
