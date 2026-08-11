import { describe, it, expect } from "vitest";
import React from "react";
import { OfflineSyncStatus } from "../OfflineSyncStatus";

describe("OfflineSyncStatus Component Unit Suite", () => {
  it("is a valid React component function", () => {
    expect(typeof OfflineSyncStatus).toBe("function");
  });

  it("constructs offline sync status element", () => {
    const element = React.createElement(OfflineSyncStatus);
    expect(element.type).toBe(OfflineSyncStatus);
  });
});
