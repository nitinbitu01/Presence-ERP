import { createFileRoute, Link } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { getMyLinkedStudents, getGuardianStudentSummary } from "@/lib/guardian.functions";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Users, Shield } from "lucide-react";

export const Route = createFileRoute("/_authenticated/parent")({
  component: ParentPortal,
});

type LinkedStudent = {
  student_id: string;
  relationship: string;
  profiles: { display_name: string | null; roll_no: string | null } | null;
};

function ParentPortal() {
  const listStudentsFn = useServerFn(getMyLinkedStudents);
  const getSummaryFn = useServerFn(getGuardianStudentSummary);

  const { data: students, isLoading: studentsLoading } = useQuery({
    queryKey: ["guardian-linked-students"],
    queryFn: () => listStudentsFn() as Promise<LinkedStudent[]>,
  });

  const [selectedId, setSelectedId] = useState<string | null>(null);
  const activeId = selectedId ?? students?.[0]?.student_id ?? null;

  const { data: summary, isLoading: summaryLoading } = useQuery({
    queryKey: ["guardian-student-summary", activeId],
    queryFn: () => (activeId ? getSummaryFn({ data: { studentId: activeId } }) : null),
    enabled: Boolean(activeId),
  });

  return (
    <div className="min-h-screen bg-background">
      <header className="border-b border-border">
        <div className="mx-auto flex max-w-5xl items-center justify-between px-6 py-4">
          <div className="flex items-center gap-2 font-semibold text-foreground">
            <Shield className="h-5 w-5 text-primary" />
            Presence — Parent Portal
          </div>
          <Link to="/" className="text-sm text-muted-foreground hover:text-foreground">
            Home
          </Link>
        </div>
      </header>

      <main className="mx-auto max-w-5xl space-y-6 px-6 py-8">
        {studentsLoading && <p className="text-sm text-muted-foreground">Loading…</p>}

        {!studentsLoading && (!students || students.length === 0) && (
          <Card>
            <CardContent className="flex items-center gap-3 py-8 text-sm text-muted-foreground">
              <Users className="h-5 w-5" />
              No students are linked to your account yet. Contact the college administration to get
              linked to your child's record.
            </CardContent>
          </Card>
        )}

        {students && students.length > 0 && (
          <>
            <div className="flex flex-wrap gap-2">
              {students.map((s) => (
                <button
                  key={s.student_id}
                  onClick={() => setSelectedId(s.student_id)}
                  className={`rounded-md px-3 py-1.5 text-sm font-medium ${
                    activeId === s.student_id
                      ? "bg-primary text-primary-foreground"
                      : "border border-input text-foreground hover:bg-accent"
                  }`}
                >
                  {s.profiles?.display_name ?? "Student"} ({s.profiles?.roll_no ?? "—"})
                </button>
              ))}
            </div>

            {summaryLoading && <p className="text-sm text-muted-foreground">Loading summary…</p>}

            {summary && (
              <>
                <Card>
                  <CardHeader className="pb-2">
                    <CardTitle className="text-base font-medium">Overall attendance</CardTitle>
                  </CardHeader>
                  <CardContent>
                    {summary.attendance.percentage === null ? (
                      <p className="text-sm text-muted-foreground">
                        No sessions have been held yet.
                      </p>
                    ) : (
                      <div className="flex items-center gap-4">
                        <div className="text-3xl font-bold text-foreground">
                          {summary.attendance.percentage}%
                        </div>
                        <div className="text-sm text-muted-foreground">
                          {summary.attendance.attended} / {summary.attendance.totalHeld} sessions
                          attended
                        </div>
                        {summary.attendance.percentage < 75 && (
                          <Badge className="bg-red-500/15 text-red-700 dark:text-red-400">
                            Below 75% requirement
                          </Badge>
                        )}
                      </div>
                    )}
                  </CardContent>
                </Card>

                <Card>
                  <CardHeader className="pb-2">
                    <CardTitle className="text-base font-medium">
                      Recent leave / OD requests
                    </CardTitle>
                  </CardHeader>
                  <CardContent>
                    {summary.leaveRequests.length === 0 ? (
                      <p className="text-sm text-muted-foreground">No leave requests filed.</p>
                    ) : (
                      <Table>
                        <TableHeader>
                          <TableRow>
                            <TableHead>Dates</TableHead>
                            <TableHead>Type</TableHead>
                            <TableHead>Status</TableHead>
                          </TableRow>
                        </TableHeader>
                        <TableBody>
                          {summary.leaveRequests.map((r) => (
                            <TableRow key={r.id}>
                              <TableCell className="text-xs">
                                {r.start_date} to {r.end_date}
                              </TableCell>
                              <TableCell className="text-xs uppercase">{r.request_type}</TableCell>
                              <TableCell className="text-xs">
                                <Badge
                                  className={
                                    r.status === "approved"
                                      ? "bg-emerald-500/15 text-emerald-700 dark:text-emerald-400"
                                      : r.status === "rejected"
                                        ? "bg-red-500/15 text-red-700 dark:text-red-400"
                                        : "bg-amber-500/15 text-amber-700 dark:text-amber-400"
                                  }
                                >
                                  {r.status}
                                </Badge>
                              </TableCell>
                            </TableRow>
                          ))}
                        </TableBody>
                      </Table>
                    )}
                  </CardContent>
                </Card>

                <Card>
                  <CardHeader className="pb-2">
                    <CardTitle className="text-base font-medium">Recent notifications</CardTitle>
                  </CardHeader>
                  <CardContent>
                    {summary.recentNotifications.length === 0 ? (
                      <p className="text-sm text-muted-foreground">No notifications yet.</p>
                    ) : (
                      <ul className="space-y-2">
                        {summary.recentNotifications.map((n) => (
                          <li key={n.id} className="text-sm">
                            <span className="font-medium text-foreground">{n.title}</span>{" "}
                            <span className="text-muted-foreground">— {n.message}</span>
                          </li>
                        ))}
                      </ul>
                    )}
                  </CardContent>
                </Card>
              </>
            )}
          </>
        )}
      </main>
    </div>
  );
}
