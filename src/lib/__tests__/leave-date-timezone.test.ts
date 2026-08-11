import { describe, it, expect, beforeEach, afterEach } from "vitest";

function expandLeaveDatesUtc(startDate: string, endDate: string): string[] {
  const leaveDates: string[] = [];
  const [sYear, sMonth, sDay] = startDate.split("T")[0].split("-").map(Number);
  const [eYear, eMonth, eDay] = endDate.split("T")[0].split("-").map(Number);
  let curTime = Date.UTC(sYear, sMonth - 1, sDay);
  const endTime = Date.UTC(eYear, eMonth - 1, eDay);
  while (curTime <= endTime) {
    const d = new Date(curTime);
    const y = d.getUTCFullYear();
    const m = String(d.getUTCMonth() + 1).padStart(2, "0");
    const day = String(d.getUTCDate()).padStart(2, "0");
    leaveDates.push(`${y}-${m}-${day}`);
    curTime += 86400000;
  }
  return leaveDates;
}

describe("Timezone-Safe Leave Date Expansion Suite", () => {
  const originalTz = process.env.TZ;

  afterEach(() => {
    process.env.TZ = originalTz;
  });

  it("correctly expands multi-day leave under negative timezone offset (America/Los_Angeles)", () => {
    process.env.TZ = "America/Los_Angeles";
    const dates = expandLeaveDatesUtc("2026-08-01", "2026-08-03");
    expect(dates).toEqual(["2026-08-01", "2026-08-02", "2026-08-03"]);
  });

  it("correctly expands multi-day leave under positive timezone offset (Asia/Kolkata)", () => {
    process.env.TZ = "Asia/Kolkata";
    const dates = expandLeaveDatesUtc("2026-08-01", "2026-08-03");
    expect(dates).toEqual(["2026-08-01", "2026-08-02", "2026-08-03"]);
  });

  it("correctly expands month-boundary leave under UTC", () => {
    process.env.TZ = "UTC";
    const dates = expandLeaveDatesUtc("2026-07-31", "2026-08-02");
    expect(dates).toEqual(["2026-07-31", "2026-08-01", "2026-08-02"]);
  });
});
