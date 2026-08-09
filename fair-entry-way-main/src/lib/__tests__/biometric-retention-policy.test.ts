/**
 * Tests for the rewritten biometric-retention-policy.server.ts (see that file's header for the
 * two real bugs found in the original version: it referenced a student status column that
 * doesn't exist in the schema, and its audit-log insert silently failed on every call).
 *
 * Unlike the tests this replaces (see phase8-hardening-compliance.test.ts and
 * phase8-circuit-breaker.test.ts), these actually mock the Supabase client so the assertions
 * are checking real query/error-handling behavior, not just "did the function fall through its
 * own catch block and return a hardcoded default."
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

const fromMock = vi.fn();

vi.mock("@/integrations/supabase/client.server", () => ({
  supabaseAdmin: { from: (...args: unknown[]) => fromMock(...args) },
}));

import {
  reportStaleEmbeddings,
  runLivenessSessionLogPurge,
} from "../biometric-retention-policy.server";

beforeEach(() => {
  fromMock.mockReset();
});

describe("reportStaleEmbeddings — reporting only, must never delete", () => {
  it("reports a count without calling delete", () => {
    const selectSpy = vi.fn(() => ({
      lt: () => Promise.resolve({ count: 42, error: null }),
    }));
    fromMock.mockImplementation((table: string) => {
      expect(table).toBe("face_embeddings");
      return { select: selectSpy, delete: vi.fn() };
    });

    return reportStaleEmbeddings(365).then((result) => {
      expect(result.staleEmbeddingsCount).toBe(42);
      expect(result.retentionDays).toBe(365);
      // The whole point of this function: it must query, never mutate.
      const table = fromMock.mock.results[0].value;
      expect(table.delete).not.toHaveBeenCalled();
    });
  });

  it("throws (does not swallow) when the count query errors", async () => {
    fromMock.mockImplementation(() => ({
      select: () => ({
        lt: () => Promise.resolve({ count: null, error: { message: "connection refused" } }),
      }),
    }));

    await expect(reportStaleEmbeddings(365)).rejects.toThrow(/connection refused/);
  });
});

describe("runLivenessSessionLogPurge — dry-run mode", () => {
  it("defaults to dry-run and only counts, never deletes", async () => {
    fromMock.mockImplementation((table: string) => {
      expect(table).toBe("liveness_sessions");
      return {
        select: () => ({
          lt: () => Promise.resolve({ count: 7, error: null }),
        }),
      };
    });

    const result = await runLivenessSessionLogPurge(730);
    expect(result.dryRun).toBe(true);
    expect(result.deletedCount).toBe(7);
    expect(result.auditLogId).toBeNull();
  });
});

describe("runLivenessSessionLogPurge — live mode", () => {
  it("deletes and writes a well-formed audit log entry (real UUIDs, actor_id null for system actions)", async () => {
    const deleteEq = vi.fn(() => Promise.resolve({ count: 12, error: null }));
    const insertMock = vi.fn((_row: Record<string, unknown>) => Promise.resolve({ error: null }));

    fromMock.mockImplementation((table: string) => {
      if (table === "liveness_sessions") {
        return { delete: () => ({ lt: deleteEq }) };
      }
      if (table === "audit_logs") {
        return { insert: insertMock };
      }
      throw new Error(`Unexpected table: ${table}`);
    });

    const result = await runLivenessSessionLogPurge(730, false);

    expect(result.dryRun).toBe(false);
    expect(result.deletedCount).toBe(12);
    expect(result.auditLogId).toBeTruthy();

    // This is the actual regression check for the original bug: actor_id must be null (a real,
    // schema-legal value for a system action) rather than a non-UUID string like
    // "system_retention_policy", and target_id must be a real UUID, not a custom string like
    // "purge_<timestamp>_<rand>".
    const insertedRow = insertMock.mock.calls[0][0];
    const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
    expect(insertedRow.actor_id).toBeNull();
    expect(insertedRow.target_id).toMatch(uuidPattern);
    expect(insertedRow.id).toMatch(uuidPattern);
  });

  it("surfaces (does not hide) an audit-log write failure after a successful delete", async () => {
    fromMock.mockImplementation((table: string) => {
      if (table === "liveness_sessions") {
        return { delete: () => ({ lt: () => Promise.resolve({ count: 5, error: null }) }) };
      }
      if (table === "audit_logs") {
        return { insert: () => Promise.resolve({ error: { message: "uuid constraint" } }) };
      }
      throw new Error(`Unexpected table: ${table}`);
    });

    // This is exactly the scenario the original module got wrong: the delete succeeded, but
    // the caller has no way to know the audit trail is broken because the error was swallowed.
    await expect(runLivenessSessionLogPurge(730, false)).rejects.toThrow(/audit log write failed/);
  });

  it("throws when the delete itself fails, without attempting an audit log write", async () => {
    const insertMock = vi.fn();
    fromMock.mockImplementation((table: string) => {
      if (table === "liveness_sessions") {
        return {
          delete: () => ({
            lt: () => Promise.resolve({ count: null, error: { message: "timeout" } }),
          }),
        };
      }
      if (table === "audit_logs") {
        return { insert: insertMock };
      }
      throw new Error(`Unexpected table: ${table}`);
    });

    await expect(runLivenessSessionLogPurge(730, false)).rejects.toThrow(/timeout/);
    expect(insertMock).not.toHaveBeenCalled();
  });
});
