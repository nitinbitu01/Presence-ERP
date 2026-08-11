import React, { useEffect } from "react";
import { useServerFn } from "@tanstack/react-start";
import { useNavigate } from "@tanstack/react-router";
import { supabase } from "@/integrations/supabase/client";
import {
  registerUserActiveSession,
  validateUserActiveSession,
} from "@/lib/single-session.server";

const SESSION_STORAGE_KEY = "presence_active_session_id";

export function SingleSessionGuard() {
  const navigate = useNavigate();
  const registerSessionFn = useServerFn(registerUserActiveSession);
  const validateSessionFn = useServerFn(validateUserActiveSession);

  useEffect(() => {
    let isMounted = true;
    let timerId: NodeJS.Timeout;

    const getOrCreateLocalSessionId = () => {
      let sid = localStorage.getItem(SESSION_STORAGE_KEY);
      if (!sid) {
        sid = typeof crypto !== "undefined" && crypto.randomUUID
          ? crypto.randomUUID()
          : `session_${Date.now()}_${Math.random().toString(36).substring(2, 9)}`;
        localStorage.setItem(SESSION_STORAGE_KEY, sid);
      }
      return sid;
    };

    const handleConcurrentLogout = async () => {
      localStorage.removeItem(SESSION_STORAGE_KEY);
      await supabase.auth.signOut();
      if (isMounted) {
        navigate({
          to: "/auth",
          search: { next: undefined },
        });
        // Set query param or toast message
        window.location.href = "/auth?reason=concurrent_login";
      }
    };

    const performSessionCheck = async () => {
      try {
        const { data: authData } = await supabase.auth.getSession();
        if (!authData.session) return; // User not logged in

        const localSessionId = getOrCreateLocalSessionId();

        const res = await validateSessionFn({ data: { sessionId: localSessionId } });
        if (!isMounted) return;

        if (!res.valid && res.reason === "concurrent_login_detected") {
          console.warn("Concurrent login detected! Logging out previous session.");
          await handleConcurrentLogout();
        }
      } catch (e) {
        console.warn("SingleSessionGuard check warning:", e);
      }
    };

    // Register active session on initial load if logged in
    const initSession = async () => {
      const { data: authData } = await supabase.auth.getSession();
      if (authData.session) {
        const sid = getOrCreateLocalSessionId();
        try {
          await registerSessionFn({ data: { sessionId: sid } });
        } catch (e) {
          console.warn("Failed to register session token:", e);
        }
      }
    };

    initSession();

    // Poll every 10 seconds
    timerId = setInterval(performSessionCheck, 10000);

    // Also check on tab focus / visibility change
    const onVisibilityChange = () => {
      if (document.visibilityState === "visible") {
        performSessionCheck();
      }
    };
    window.addEventListener("visibilitychange", onVisibilityChange);
    window.addEventListener("focus", performSessionCheck);

    return () => {
      isMounted = false;
      clearInterval(timerId);
      window.removeEventListener("visibilitychange", onVisibilityChange);
      window.removeEventListener("focus", performSessionCheck);
    };
  }, [navigate, registerSessionFn, validateSessionFn]);

  return null;
}
