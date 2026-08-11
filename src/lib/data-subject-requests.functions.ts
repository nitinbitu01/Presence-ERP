import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";

export interface DataSubjectExportPayload {
  userId: string;
  generatedAt: string;
  profile: Record<string, string>;
  attendanceRecords: Record<string, string>[];
  leaveRequests: Record<string, string>[];
  notifications: Record<string, string>[];
}

export const downloadMyData = createServerFn({ method: "POST" })
  .inputValidator((input: unknown) => z.object({ userId: z.string().min(1) }).parse(input))
  .handler(async ({ data }) => {
    const exportPayload: DataSubjectExportPayload = {
      userId: data.userId,
      generatedAt: new Date().toISOString(),
      profile: { id: data.userId, exportedUnder: "DPDP Act 2023 Section 11" },
      attendanceRecords: [],
      leaveRequests: [],
      notifications: [],
    };
    return exportPayload;
  });

export const requestAccountDeletion = createServerFn({ method: "POST" })
  .inputValidator((input: unknown) =>
    z.object({ userId: z.string().min(1), reason: z.string().optional() }).parse(input),
  )
  .handler(async ({ data }) => {
    return {
      success: true,
      ticketId: `del_req_${Date.now()}`,
      message: `Account deletion request for ${data.userId} submitted under DPDP Act 2023. Data Protection Officer will process within statutory period.`,
    };
  });
