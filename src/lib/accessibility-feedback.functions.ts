import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";

export interface AccessibilityReportItem {
  id: string;
  route: string;
  issueDescription: string;
  assistiveTechUsed?: string;
  userEmail?: string;
  createdAt: string;
  status: "open" | "investigating" | "resolved";
}

const reportsQueue: AccessibilityReportItem[] = [];

export const submitAccessibilityReport = createServerFn({ method: "POST" })
  .inputValidator((input: unknown) =>
    z
      .object({
        route: z.string().min(1),
        issueDescription: z.string().min(5),
        assistiveTechUsed: z.string().optional(),
        userEmail: z.string().email().optional(),
      })
      .parse(input),
  )
  .handler(async ({ data }) => {
    const newReport: AccessibilityReportItem = {
      id: `a11y_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
      route: data.route,
      issueDescription: data.issueDescription,
      assistiveTechUsed: data.assistiveTechUsed,
      userEmail: data.userEmail,
      createdAt: new Date().toISOString(),
      status: "open",
    };
    reportsQueue.push(newReport);
    return { success: true, reportId: newReport.id };
  });

export const listAccessibilityReports = createServerFn({ method: "GET" }).handler(async () => {
  return reportsQueue;
});
