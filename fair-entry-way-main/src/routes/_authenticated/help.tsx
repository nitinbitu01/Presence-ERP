import { createFileRoute } from "@tanstack/react-router";
import { useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { createHelpdeskTicket } from "@/lib/helpdesk.functions";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";

export const Route = createFileRoute("/_authenticated/help")({
  head: () => ({
    meta: [{ title: "Help & Support — Presence ERP" }],
  }),
  component: HelpPage,
});

function HelpPage() {
  const createTicketFn = useServerFn(createHelpdeskTicket);
  const [subject, setSubject] = useState("");
  const [description, setDescription] = useState("");
  const [category, setCategory] = useState<
    "device_issue" | "attendance_dispute" | "account_access" | "general"
  >("general");
  const [busy, setBusy] = useState(false);
  const [ticketResult, setTicketResult] = useState<string | null>(null);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setTicketResult(null);
    try {
      const res = await createTicketFn({
        data: { subject, description, category },
      });
      setTicketResult(`✅ Ticket created successfully! Ticket ID: ${res.id}`);
      setSubject("");
      setDescription("");
    } catch (err) {
      setTicketResult(`❌ Error: ${(err as Error).message}`);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="mx-auto max-w-4xl px-6 py-10 space-y-8">
      <div>
        <h1 className="text-3xl font-bold tracking-tight">Help & Support Portal</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Guides, onboarding tutorials, and IT support ticketing for Presence ERP.
        </p>
      </div>

      {/* Role Onboarding Guides */}
      <section className="grid gap-4 md:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle className="text-base">🎓 Student Guide</CardTitle>
          </CardHeader>
          <CardContent className="text-xs text-muted-foreground space-y-2">
            <p>1. Open your class session check-in link when prompted by your teacher.</p>
            <p>2. Complete the camera liveness challenge motion and confirm identity.</p>
            <p>3. Submit leave requests with documentation if absent.</p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-base">👨‍🏫 Instructor Guide</CardTitle>
          </CardHeader>
          <CardContent className="text-xs text-muted-foreground space-y-2">
            <p>1. Start an attendance session from your course timetable.</p>
            <p>2. Display the rotating classroom OTP code to students.</p>
            <p>3. Review flagged attendance items in the Human Review queue.</p>
          </CardContent>
        </Card>
      </section>

      {/* Support Ticket Submission */}
      <section className="rounded-lg border border-border bg-card p-6 space-y-4">
        <h2 className="text-lg font-semibold text-foreground">Submit a Support Ticket</h2>
        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label className="block text-xs font-medium text-muted-foreground mb-1">Category</label>
            <select
              value={category}
              onChange={(e) => setCategory(e.target.value as typeof category)}
              className="w-full rounded border border-input bg-background px-3 py-2 text-sm text-foreground"
            >
              <option value="general">General Support</option>
              <option value="device_issue">Device / WebAuthn Issue</option>
              <option value="attendance_dispute">Attendance Dispute</option>
              <option value="account_access">Account Access</option>
            </select>
          </div>

          <div>
            <label className="block text-xs font-medium text-muted-foreground mb-1">Subject</label>
            <input
              type="text"
              required
              value={subject}
              onChange={(e) => setSubject(e.target.value)}
              placeholder="Brief summary of your issue..."
              className="w-full rounded border border-input bg-background px-3 py-2 text-sm text-foreground"
            />
          </div>

          <div>
            <label className="block text-xs font-medium text-muted-foreground mb-1">
              Description
            </label>
            <textarea
              required
              rows={4}
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="Provide details about what happened..."
              className="w-full rounded border border-input bg-background px-3 py-2 text-sm text-foreground"
            />
          </div>

          <Button type="submit" disabled={busy}>
            {busy ? "Submitting..." : "Submit Ticket"}
          </Button>

          {ticketResult && (
            <p
              className={`text-sm ${
                ticketResult.startsWith("✅")
                  ? "text-emerald-600 font-semibold"
                  : "text-destructive"
              }`}
            >
              {ticketResult}
            </p>
          )}
        </form>
      </section>
    </div>
  );
}
