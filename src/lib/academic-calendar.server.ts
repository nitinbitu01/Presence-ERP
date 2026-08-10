import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

export interface NetLeaveCalculationOptions {
  startDate: string; // YYYY-MM-DD
  endDate: string;   // YYYY-MM-DD
  isHalfDay?: boolean;
  halfDayType?: "am" | "pm";
  holidays?: string[]; // Array of YYYY-MM-DD strings
  excludeSundays?: boolean; // Default true
}

export interface NetLeaveCalculationResult {
  totalCalendarDays: number;
  excludedSundaysCount: number;
  excludedHolidaysCount: number;
  netLeaveDays: number;
  validLeaveDates: string[];
}

/**
 * Calculates net leave days by excluding Sundays and institutional holidays.
 * Supports half-day leave calculations (0.5 days).
 */
export function calculateNetLeaveDuration(
  opts: NetLeaveCalculationOptions,
): NetLeaveCalculationResult {
  if (opts.isHalfDay) {
    return {
      totalCalendarDays: 1,
      excludedSundaysCount: 0,
      excludedHolidaysCount: 0,
      netLeaveDays: 0.5,
      validLeaveDates: [opts.startDate],
    };
  }

  const [sYear, sMonth, sDay] = opts.startDate.split("T")[0].split("-").map(Number);
  const [eYear, eMonth, eDay] = opts.endDate.split("T")[0].split("-").map(Number);

  let curTime = Date.UTC(sYear, sMonth - 1, sDay);
  const endTime = Date.UTC(eYear, eMonth - 1, eDay);

  const holidaySet = new Set((opts.holidays ?? []).map((h) => h.split("T")[0]));
  const excludeSundays = opts.excludeSundays ?? true;

  let totalCalendarDays = 0;
  let excludedSundaysCount = 0;
  let excludedHolidaysCount = 0;
  const validLeaveDates: string[] = [];

  while (curTime <= endTime) {
    totalCalendarDays++;
    const d = new Date(curTime);
    const y = d.getUTCFullYear();
    const m = String(d.getUTCMonth() + 1).padStart(2, "0");
    const day = String(d.getUTCDate()).padStart(2, "0");
    const dateStr = `${y}-${m}-${day}`;

    const dayOfWeek = d.getUTCDay(); // 0 = Sunday

    if (excludeSundays && dayOfWeek === 0) {
      excludedSundaysCount++;
    } else if (holidaySet.has(dateStr)) {
      excludedHolidaysCount++;
    } else {
      validLeaveDates.push(dateStr);
    }

    curTime += 86400000;
  }

  const netLeaveDays = validLeaveDates.length;

  return {
    totalCalendarDays,
    excludedSundaysCount,
    excludedHolidaysCount,
    netLeaveDays,
    validLeaveDates,
  };
}

export type AttendanceRoundingPolicy = "none" | "nearest_integer" | "half_percent_up" | "ceil";

/**
 * Applies institutional attendance rounding rules to raw attendance percentages.
 */
export function applyAttendanceRounding(
  percentage: number,
  policy: AttendanceRoundingPolicy = "none",
): number {
  if (isNaN(percentage)) return 0;
  const clamped = Math.max(0, Math.min(100, percentage));

  switch (policy) {
    case "nearest_integer":
      return Math.round(clamped);
    case "half_percent_up":
      return Math.ceil(clamped * 2) / 2;
    case "ceil":
      return Math.ceil(clamped);
    case "none":
    default:
      return Math.round(clamped * 10) / 10;
  }
}

// ── Server Functions ───────────────────────────────────────────────────────

export const calculateLeaveDays = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) =>
    z
      .object({
        startDate: z.string().min(10),
        endDate: z.string().min(10),
        isHalfDay: z.boolean().optional(),
        halfDayType: z.enum(["am", "pm"]).optional(),
      })
      .parse(input),
  )
  .handler(async ({ data }): Promise<NetLeaveCalculationResult> => {
    // Fetch active academic calendar holidays
    let holidays: string[] = [];
    try {
      const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
      const { data: cal } = await (supabaseAdmin as any)
        .from("academic_calendars")
        .select("holidays")
        .eq("is_active", true)
        .limit(1)
        .maybeSingle();
      if (cal?.holidays && Array.isArray(cal.holidays)) {
        holidays = cal.holidays.map(String);
      }
    } catch {
      // Fallback
    }

    return calculateNetLeaveDuration({
      startDate: data.startDate,
      endDate: data.endDate,
      isHalfDay: data.isHalfDay,
      halfDayType: data.halfDayType,
      holidays,
    });
  });
