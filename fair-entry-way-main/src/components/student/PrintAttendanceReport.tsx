// src/components/student/PrintAttendanceReport.tsx
// ─────────────────────────────────────────────────────────────────────────────
// Generates a print-ready attendance report with @media print CSS.
// ─────────────────────────────────────────────────────────────────────────────
import { Printer } from "lucide-react";
import { Button } from "@/components/ui/button";

interface CourseAttendance {
  courseId: string;
  code: string;
  name: string;
  attended: number;
  totalHeld: number;
  percentage: number;
  status: "safe" | "warning" | "shortage";
}

interface PrintReportProps {
  studentName: string | null;
  rollNo: string | null;
  overall: { attended: number; totalHeld: number; percentage: number };
  courses: CourseAttendance[];
  generatedAt?: string;
}

export function PrintAttendanceReport({
  studentName,
  rollNo,
  overall,
  courses,
  generatedAt,
}: PrintReportProps) {
  const handlePrint = () => {
    const printWindow = window.open("", "_blank", "width=800,height=600");
    if (!printWindow) return;

    const rows = courses
      .map(
        (c) => `
        <tr>
          <td>${c.code}</td>
          <td>${c.name}</td>
          <td>${c.attended}</td>
          <td>${c.totalHeld}</td>
          <td style="font-weight:bold;color:${c.percentage >= 75 ? "#16a34a" : "#dc2626"}">
            ${c.percentage.toFixed(1)}%
          </td>
          <td>${c.status.toUpperCase()}</td>
        </tr>`,
      )
      .join("");

    printWindow.document.write(`
      <!DOCTYPE html>
      <html lang="en">
      <head>
        <meta charset="UTF-8">
        <title>Attendance Report — Presence ERP</title>
        <style>
          * { margin: 0; padding: 0; box-sizing: border-box; }
          body {
            font-family: "Times New Roman", serif;
            font-size: 12pt;
            color: #000;
            padding: 2cm;
          }
          .header {
            text-align: center;
            border-bottom: 2px solid #000;
            padding-bottom: 12pt;
            margin-bottom: 16pt;
          }
          .header h1 { font-size: 16pt; font-weight: bold; }
          .header p { font-size: 11pt; margin-top: 4pt; }
          .meta { margin-bottom: 16pt; }
          .meta p { margin-bottom: 4pt; }
          .meta strong { min-width: 120pt; display: inline-block; }
          table {
            width: 100%;
            border-collapse: collapse;
            margin-bottom: 16pt;
          }
          th, td {
            border: 1px solid #000;
            padding: 6pt 8pt;
            text-align: left;
          }
          th { background: #f0f0f0; font-weight: bold; }
          .overall {
            margin-top: 12pt;
            padding: 8pt;
            border: 2px solid #000;
          }
          .footer {
            margin-top: 24pt;
            text-align: center;
            font-size: 9pt;
            color: #666;
            border-top: 1px solid #ccc;
            padding-top: 8pt;
          }
          .watermark {
            position: fixed;
            top: 50%;
            left: 50%;
            transform: translate(-50%, -50%) rotate(-45deg);
            font-size: 72pt;
            color: rgba(0,0,0,0.04);
            font-weight: bold;
            pointer-events: none;
            z-index: -1;
          }
          @media print {
            body { padding: 1cm; }
          }
        </style>
      </head>
      <body>
        <div class="watermark">PRESENCE</div>
        <div class="header">
          <h1>Presence ERP</h1>
          <p>Official Attendance Report — Presence ERP</p>
        </div>
        <div class="meta">
          <p><strong>Student Name:</strong> ${studentName ?? "—"}</p>
          <p><strong>Roll Number:</strong> ${rollNo ?? "—"}</p>
          <p><strong>Generated:</strong> ${generatedAt ?? new Date().toLocaleString()}</p>
          <p><strong>Statutory Minimum:</strong> 75% attendance required for exam eligibility</p>
        </div>
        <table>
          <thead>
            <tr>
              <th>Code</th>
              <th>Subject</th>
              <th>Attended</th>
              <th>Total Held</th>
              <th>Percentage</th>
              <th>Status</th>
            </tr>
          </thead>
          <tbody>${rows}</tbody>
        </table>
        <div class="overall">
          <strong>Overall Attendance:</strong>
          ${overall.attended} / ${overall.totalHeld} classes
          = <strong>${overall.percentage.toFixed(1)}%</strong>
          (${overall.percentage >= 75 ? "✓ Eligible for examinations" : "✗ Below statutory threshold — not eligible"})
        </div>
        <div class="footer">
          This is a computer-generated report from Presence ERP.
          For disputes, contact the examination section.
        </div>
      </body>
      </html>
    `);

    printWindow.document.close();
    printWindow.focus();
    setTimeout(() => {
      printWindow.print();
      printWindow.close();
    }, 500);
  };

  return (
    <Button
      variant="outline"
      size="sm"
      onClick={handlePrint}
      aria-label="Print attendance report"
      className="gap-1.5"
    >
      <Printer className="h-3.5 w-3.5" aria-hidden="true" />
      Print Report
    </Button>
  );
}
