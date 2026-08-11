/**
 * ProfileForm.tsx
 * Student profile form — extracted from monolith.
 * Fully accessible with proper label associations.
 */
import type { Profile } from "./useEnrollment";

export type Dept = { id: string; code: string; name: string };
export type Prog = { id: string; department_id: string; code: string; name: string };

type Props = {
  profile: Profile | null;
  depts: Dept[];
  progs: Prog[];
  pDept: string;
  pProg: string;
  pNcc: string;
  pSem: string;
  pRoll: string;
  profileBusy: boolean;
  profileIncomplete: boolean;
  setPDept: (v: string) => void;
  setPProg: (v: string) => void;
  setPNcc: (v: string) => void;
  setPSem: (v: string) => void;
  setPRoll: (v: string) => void;
  onSave: (e: React.FormEvent) => void;
};

export function ProfileForm({
  depts,
  progs,
  pDept,
  pProg,
  pNcc,
  pSem,
  pRoll,
  profileBusy,
  profileIncomplete,
  setPDept,
  setPProg,
  setPNcc,
  setPSem,
  setPRoll,
  onSave,
}: Props) {
  const filteredProgs = progs.filter((p) => !p.department_id || p.department_id === pDept);
  const displayProgs = filteredProgs.length > 0 ? filteredProgs : progs;

  return (
    <form
      onSubmit={onSave}
      aria-label="Student profile form"
      className="mt-6 space-y-3 rounded-lg border border-border bg-card p-4 text-sm text-card-foreground"
    >
      <div className="flex items-center justify-between">
        <p className="font-medium">Your student profile</p>
        {profileIncomplete && (
          <span
            role="alert"
            className="rounded bg-amber-500/15 px-2 py-0.5 text-[11px] text-amber-800 dark:text-amber-200"
          >
            Complete this to enable check-in
          </span>
        )}
      </div>

      <div className="grid gap-3 sm:grid-cols-2">
        <div>
          <label htmlFor="pf-dept" className="block text-xs text-muted-foreground">
            Department
          </label>
          <select
            id="pf-dept"
            value={pDept}
            onChange={(e) => {
              setPDept(e.target.value);
              setPProg("");
            }}
            className="mt-1 w-full rounded-md border border-input bg-background px-2 py-1.5 text-sm text-foreground"
          >
            <option value="">— select —</option>
            {depts.map((d) => (
              <option key={d.id} value={d.id}>
                {d.code} · {d.name}
              </option>
            ))}
          </select>
        </div>

        <div>
          <label htmlFor="pf-prog" className="block text-xs text-muted-foreground">
            Program
          </label>
          <select
            id="pf-prog"
            value={pProg}
            onChange={(e) => setPProg(e.target.value)}
            disabled={!pDept}
            className="mt-1 w-full rounded-md border border-input bg-background px-2 py-1.5 text-sm text-foreground disabled:opacity-60"
          >
            <option value="">— select —</option>
            {displayProgs.map((p) => (
              <option key={p.id} value={p.id}>
                {p.code} · {p.name}
              </option>
            ))}
          </select>
        </div>

        <div>
          <label htmlFor="pf-ncc" className="block text-xs text-muted-foreground">
            NCC Year (Optional)
          </label>
          <select
            id="pf-ncc"
            value={pNcc}
            onChange={(e) => setPNcc(e.target.value)}
            disabled={!pProg}
            className="mt-1 w-full rounded-md border border-input bg-background px-2 py-1.5 text-sm text-foreground disabled:opacity-60"
          >
            <option value="">— None / Not in NCC —</option>
            <option value="NCC-I">NCC 1st Year (NCC-I)</option>
            <option value="NCC-II">NCC 2nd Year (NCC-II)</option>
            <option value="NCC-III">NCC 3rd Year (NCC-III)</option>
          </select>
        </div>

        <div>
          <label htmlFor="pf-sem" className="block text-xs text-muted-foreground">
            Current semester
          </label>
          <input
            id="pf-sem"
            type="number"
            min={1}
            max={20}
            value={pSem}
            onChange={(e) => setPSem(e.target.value)}
            placeholder="e.g. 3"
            className="mt-1 w-full rounded-md border border-input bg-background px-2 py-1.5 text-sm text-foreground"
          />
        </div>

        <div>
          <label htmlFor="pf-roll" className="block text-xs text-muted-foreground">
            Roll number
          </label>
          <input
            id="pf-roll"
            value={pRoll}
            onChange={(e) => setPRoll(e.target.value.toUpperCase())}
            placeholder="e.g. 22CS1043"
            className="mt-1 w-full rounded-md border border-input bg-background px-2 py-1.5 text-sm text-foreground"
          />
        </div>
      </div>

      <div className="mt-3 pt-3 border-t border-border">
        <label className="block text-xs font-semibold text-foreground mb-1">
          Enrolled Subjects / Courses
        </label>
        <p className="text-[11px] text-muted-foreground mb-2">
          Select courses for active class creation & live attendance check-in
        </p>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-1.5 p-2 rounded-md border border-input bg-muted/20 text-xs">
          {[
            { code: "CS101", name: "Computer Science & AI" },
            { code: "CYB201", name: "Network Security & Cryptography" },
            { code: "AI301", name: "Machine Learning & Neural Networks" },
            { code: "WEB102", name: "Full-Stack Web Dev" },
            { code: "DAT204", name: "Database Systems" },
            { code: "ENG101", name: "Applied Physics" },
            { code: "MATH102", name: "Linear Algebra" },
            { code: "DS101", name: "Data Analytics & Big Data" },
          ].map((sub) => (
            <label
              key={sub.code}
              className="flex items-center gap-2 p-1.5 rounded hover:bg-muted/40 cursor-pointer"
            >
              <input
                type="checkbox"
                defaultChecked
                className="rounded border-input text-primary focus:ring-primary"
              />
              <span className="font-bold text-primary">{sub.code}</span>
              <span className="truncate text-muted-foreground">{sub.name}</span>
            </label>
          ))}
        </div>
      </div>

      <button
        type="submit"
        disabled={profileBusy}
        aria-busy={profileBusy}
        className="rounded-md bg-secondary px-3 py-1.5 text-sm font-medium text-secondary-foreground hover:bg-secondary/80 disabled:opacity-60"
      >
        {profileBusy ? "Saving…" : "Save profile"}
      </button>
    </form>
  );
}
