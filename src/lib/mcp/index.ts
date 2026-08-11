import { auth, defineMcp } from "@lovable.dev/mcp-js";
import whoami from "./tools/whoami";
import listMyCourses from "./tools/list-my-courses";
import listMyAttendance from "./tools/list-my-attendance";
import listCourseSessions from "./tools/list-course-sessions";
import explainAttendance from './tools/explain-attendance';

// The OAuth issuer MUST be the direct Supabase host, not the .lovable.cloud proxy.
const projectRef = import.meta.env.VITE_SUPABASE_PROJECT_ID ?? "project-ref-unset";

export default defineMcp({
  name: "presence-mcp",
  title: "Presence Attendance",
  version: "0.1.0",
  instructions:
    "Tools for the Presence anti-proxy attendance app. Call whoami to see the signed-in user's profile and roles, list_my_courses to enumerate teaching or enrolled courses, list_course_sessions for a specific course's scheduled sessions, and list_my_attendance for the signed-in student's recent attendance ledger entries. All calls respect Supabase RLS as the signed-in user.",
  auth: auth.oauth.issuer({
    issuer: `https://${projectRef}.supabase.co/auth/v1`,
    acceptedAudiences: "authenticated",
  }),
  tools: [whoami, listMyCourses, listCourseSessions, listMyAttendance, explainAttendance],
});
