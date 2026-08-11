import { useState, useEffect, useRef, useCallback } from "react";
import { useServerFn } from "@tanstack/react-start";
import { listCourseSessions } from "@/lib/attendance.functions";

export type SessionData = {
  id: string;
  course_id: string;
  starts_at: string;
  ends_at: string;
  geo_lat: number;
  geo_lng: number;
  radius_m: number;
  ip_allowlist: string[];
};

export function useCourseSessions(courseId: string | null) {
  const fetchSessions = useServerFn(listCourseSessions);
  const [sessions, setSessions] = useState<SessionData[]>([]);
  const [status, setStatus] = useState<"idle" | "loading" | "success" | "error">("idle");
  const [error, setError] = useState<string | null>(null);

  // In-flight request cancellation token ref
  const activeRequestRef = useRef<number>(0);

  const loadSessions = useCallback(async () => {
    if (!courseId) {
      setSessions([]);
      setStatus("idle");
      setError(null);
      return;
    }

    const requestId = ++activeRequestRef.current;
    setStatus("loading");
    setError(null);

    try {
      const data = (await fetchSessions({ data: { courseId } })) as SessionData[];
      if (requestId === activeRequestRef.current) {
        setSessions(data ?? []);
        setStatus("success");
      }
    } catch (e) {
      if (requestId === activeRequestRef.current) {
        setError(e instanceof Error ? e.message : "Failed to load course sessions.");
        setStatus("error");
      }
    }
  }, [courseId, fetchSessions]);

  useEffect(() => {
    loadSessions();
  }, [loadSessions]);

  return {
    sessions,
    status,
    error,
    refresh: loadSessions,
  };
}
