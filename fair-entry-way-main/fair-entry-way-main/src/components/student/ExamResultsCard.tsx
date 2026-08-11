// src/components/student/ExamResultsCard.tsx
// ─────────────────────────────────────────────────────────────────────────────
import { memo, useMemo } from "react";
import { useServerFn } from "@tanstack/react-start";
import { useQuery } from "@tanstack/react-query";
import { getMyExamResults } from "@/lib/exam.functions";
import { useStableServerFn } from "@/lib/useStableServerFn";
import { SectionErrorBoundary } from "@/components/student/ErrorBoundary";
import { TableSkeleton } from "@/components/student/Skeleton";
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
import { AlertTriangle, BookOpen } from "lucide-react";

type StudentExamRow = {
  examId: string;
  examName: string;
  examType: string;
  maxMarks: number;
  weightagePercent: number;
  marksObtained: number | null;
  isAbsent: boolean;
  percentage: number | null;
};

type StudentCourseResult = {
  courseId: string;
  courseCode: string;
  courseName: string;
  exams: StudentExamRow[];
  weightedPercentage: number | null;
  grade: {
    letter: string;
    grade_point: number;
    is_passing: boolean;
  } | null;
};

export const ExamResultsCard = memo(function ExamResultsCard() {
  const getResultsFn = useStableServerFn(useServerFn(getMyExamResults));

  const { data, isLoading, error, refetch } = useQuery({
    queryKey: ["my-exam-results"],
    queryFn: () => getResultsFn({ data: {} }) as Promise<StudentCourseResult[]>,
    staleTime: 5 * 60_000,
  });

  const coursesWithExams = useMemo(() => (data ?? []).filter((c) => c.exams.length > 0), [data]);

  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="flex items-center gap-2 text-base font-medium">
          <BookOpen className="h-4 w-4" aria-hidden="true" />
          Exam Results
        </CardTitle>
      </CardHeader>
      <CardContent>
        <SectionErrorBoundary sectionName="Exam Results">
          {isLoading && <TableSkeleton rows={3} />}
          {error && (
            <div
              role="alert"
              className="flex items-start gap-3 rounded-lg border border-destructive/30 bg-destructive/10 px-4 py-3"
            >
              <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-destructive" />
              <div className="flex-1 text-sm text-destructive">Could not load exam results.</div>
              <button
                onClick={() => refetch()}
                className="shrink-0 text-xs text-destructive underline hover:no-underline"
              >
                Retry
              </button>
            </div>
          )}
          {!isLoading && !error && coursesWithExams.length === 0 && (
            <div className="flex flex-col items-center gap-2 py-10 text-center">
              <BookOpen className="h-8 w-8 text-muted-foreground/40" aria-hidden="true" />
              <p className="text-sm text-muted-foreground">
                No published results yet. Check back once your teachers publish marks.
              </p>
            </div>
          )}
          {coursesWithExams.length > 0 && (
            <div className="space-y-6">
              {coursesWithExams.map((c) => (
                <div key={c.courseId}>
                  <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
                    <span className="text-sm font-semibold">
                      {c.courseCode} — {c.courseName}
                    </span>
                    <div className="flex items-center gap-2">
                      {c.weightedPercentage !== null && (
                        <span className="text-xs tabular-nums text-muted-foreground">
                          {c.weightedPercentage.toFixed(1)}%
                        </span>
                      )}
                      {c.grade && (
                        <Badge
                          className={
                            c.grade.is_passing
                              ? "bg-emerald-500/15 text-emerald-700 dark:text-emerald-400"
                              : "bg-red-500/15 text-red-700 dark:text-red-400"
                          }
                        >
                          {c.grade.letter} ({c.grade.grade_point.toFixed(1)})
                        </Badge>
                      )}
                    </div>
                  </div>
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Exam</TableHead>
                        <TableHead>Type</TableHead>
                        <TableHead className="text-right">Marks</TableHead>
                        <TableHead className="text-right">%</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {c.exams.map((ex) => (
                        <TableRow key={ex.examId}>
                          <TableCell className="text-xs">{ex.examName}</TableCell>
                          <TableCell className="text-xs text-muted-foreground">
                            {ex.examType.replace(/_/g, " ")}
                          </TableCell>
                          <TableCell className="text-right text-xs tabular-nums">
                            {ex.isAbsent
                              ? "Absent"
                              : ex.marksObtained !== null
                                ? `${ex.marksObtained} / ${ex.maxMarks}`
                                : "—"}
                          </TableCell>
                          <TableCell className="text-right text-xs tabular-nums">
                            {ex.percentage !== null ? `${ex.percentage.toFixed(1)}%` : "—"}
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </div>
              ))}
            </div>
          )}
        </SectionErrorBoundary>
      </CardContent>
    </Card>
  );
});
