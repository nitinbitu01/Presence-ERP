/**
 * enroll.tsx
 * Route shell — orchestrates data fetching and dispatches to state machine.
 * Delegates rendering to focused sub-components.
 */

import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import {
  useEffect,
  useRef,
  useState,
  useCallback,
  Component,
  type ReactNode,
  type ErrorInfo,
} from "react";
import { useServerFn } from "@tanstack/react-start";
import {
  saveEnrollment,
  requestEnrollmentChallenge,
  getEnrolledPhoto,
} from "@/lib/attendance.functions";
import { generateVoicePassphrase } from "@/lib/voice-verification.server";
import {
  hasEnrollment,
  withdrawBiometric,
  getMyProfile,
  updateMyProfile,
  listDepartments,
  listPrograms,
  getMyRoles,
} from "@/lib/admin.functions";
import {
  startWebauthnRegistration,
  finishWebauthnRegistration,
  listMyWebauthnDevices,
  removeWebauthnDevice,
} from "@/lib/webauthn.functions";
import {
  computeDeviceFingerprint,
  detectFacesCount,
  captureLivenessFrameSequence,
  loadFaceApi,
  estimateHeadAngles,
} from "@/lib/face-api-loader";
import {
  assessFrameQuality,
  averageEmbeddings,
  isEmbeddingEligible,
  MIN_PASSING_FRAMES,
  QUALITY_REASON_MESSAGES,
} from "@/lib/face-quality";
import {
  verifyLivenessSignals,
  type LivenessChallenge,
  type LivenessAction,
} from "@/lib/attendance-crypto.server";
import { supabase } from "@/integrations/supabase/client";
import { useEnrollment, AuthError, type Profile } from "@/components/enroll/useEnrollment";
import { EnrolledView } from "@/components/enroll/EnrolledView";
import { ProfileForm, type Dept, type Prog } from "@/components/enroll/ProfileForm";

// ─── Constants ────────────────────────────────────────────────────────────────

const POLICY_VERSION = "2026-07-01";

const FALLBACK_DEPTS: Dept[] = [
  {
    id: "bd77422e-39be-4796-b990-634f040eba6b",
    code: "SASET",
    name: "School of Advanced Sciences, Engineering and Technology (SASET)",
  },
  {
    id: "f2efc950-5aa2-4fa5-a96b-f441496c4637",
    code: "SITAICS",
    name: "School of Information Technology, AI & Cyber Security (SITAICS)",
  },
  {
    id: "3eb09141-b36b-4bb9-b5c7-520138390b81",
    code: "SISDSS",
    name: "School of Internal Security, Defence & Strategic Studies (SISDSS)",
  },
  {
    id: "9f3ac950-250c-4930-96d1-8f581c355928",
    code: "SISSP",
    name: "School of Internal Security and Strategic Policy (SISSP)",
  },
  {
    id: "1b1c68c9-190a-4fe9-b064-60a89c26830a",
    code: "SPES",
    name: "School of Physical Education and Sports (SPES)",
  },
];

const FALLBACK_PROGS: Prog[] = [
  {
    id: "10000000-0000-0000-0000-000000000001",
    department_id: "f2efc950-5aa2-4fa5-a96b-f441496c4637",
    code: "BTECH-CS",
    name: "B.Tech Computer Science & Engineering",
  },
  {
    id: "10000000-0000-0000-0000-000000000002",
    department_id: "f2efc950-5aa2-4fa5-a96b-f441496c4637",
    code: "BTECH-CY",
    name: "B.Tech Cyber Security",
  },
  {
    id: "10000000-0000-0000-0000-000000000003",
    department_id: "f2efc950-5aa2-4fa5-a96b-f441496c4637",
    code: "MTECH-AI",
    name: "M.Tech Artificial Intelligence",
  },
  {
    id: "10000000-0000-0000-0000-000000000004",
    department_id: "f2efc950-5aa2-4fa5-a96b-f441496c4637",
    code: "MSC-DS",
    name: "M.Sc Data Science & Analytics",
  },
  {
    id: "10000000-0000-0000-0000-000000000005",
    department_id: "bd77422e-39be-4796-b990-634f040eba6b",
    code: "BTECH-SASET",
    name: "B.Tech Advanced Engineering",
  },
  {
    id: "10000000-0000-0000-0000-000000000006",
    department_id: "3eb09141-b36b-4bb9-b5c7-520138390b81",
    code: "MA-SS",
    name: "M.A. Strategic Studies",
  },
  {
    id: "10000000-0000-0000-0000-000000000007",
    department_id: "9f3ac950-250c-4930-96d1-8f581c355928",
    code: "MA-SP",
    name: "M.A. Strategic Policy",
  },
  {
    id: "10000000-0000-0000-0000-000000000008",
    department_id: "1b1c68c9-190a-4fe9-b064-60a89c26830a",
    code: "BPED",
    name: "Bachelor of Physical Education",
  },
];

// ─── Auth helper (module-level — stable reference, no stale closure) ──────────

async function getAuthHeaders(): Promise<{ Authorization: string }> {
  let { data } = await supabase.auth.getSession();
  let token = data.session?.access_token;
  if (!token) {
    const refreshed = await supabase.auth.refreshSession();
    token = refreshed.data.session?.access_token;
  }
  if (!token) throw new AuthError();
  return { Authorization: `Bearer ${token}` };
}

// ─── Error message cleaner ────────────────────────────────────────────────────

function cleanErrorMessage(e: unknown): string {
  if (!e) return "An error occurred. Please try again.";
  let msg: string;
  if (e instanceof AuthError) return e.message;
  if (typeof e === "string") {
    msg = e;
  } else if (e instanceof Error) {
    msg = e.message;
  } else {
    const obj = e as Record<string, unknown>;
    const candidate = obj.message ?? obj.error ?? obj.statusText ?? String(e);
    msg = typeof candidate === "string" ? candidate : String(candidate);
    if (msg === "[object Object]") {
      try {
        msg = JSON.stringify(e);
      } catch {
        msg = "An error occurred.";
      }
    }
  }
  if (
    msg.includes("Unauthorized") ||
    msg.includes("No authorization token") ||
    msg.includes("not signed in") ||
    msg.includes("Invalid token")
  ) {
    return "You are not signed in. Please sign in to continue.";
  }
  const isHtml =
    /<!doctype|<html|<head|this page didn't load|something went wrong|500 internal/i.test(msg);
  if (isHtml) return "Server unreachable or session expired. Please refresh and sign in again.";
  return msg.length > 200 ? msg.slice(0, 200) + "…" : msg;
}

// ─── Error Boundary ───────────────────────────────────────────────────────────

class EnrollErrorBoundary extends Component<{ children: ReactNode }, { error: Error | null }> {
  state = { error: null };
  static getDerivedStateFromError(e: Error) {
    return { error: e };
  }
  componentDidCatch(e: Error, info: ErrorInfo) {
    console.error("[EnrollPage] Render error:", e, info);
  }
  render() {
    if (this.state.error) {
      return (
        <div className="mx-auto max-w-md px-6 py-16 text-center">
          <p className="text-xl font-bold text-foreground">Something went wrong</p>
          <p className="mt-2 text-sm text-muted-foreground">
            {cleanErrorMessage(this.state.error)}
          </p>
          <button
            onClick={() => window.location.reload()}
            className="mt-6 rounded-md bg-primary px-5 py-2.5 text-sm font-semibold text-primary-foreground"
          >
            Reload Page
          </button>
        </div>
      );
    }
    return this.props.children;
  }
}

// ─── Route ────────────────────────────────────────────────────────────────────

export const Route = createFileRoute("/_authenticated/enroll")({
  head: () => ({
    meta: [
      { title: "Face Enrollment — Presence ERP" },
      { name: "description", content: "Grant consent and enroll your face descriptor." },
      { name: "robots", content: "noindex" },
    ],
  }),
  component: () => (
    <EnrollErrorBoundary>
      <EnrollPage />
    </EnrollErrorBoundary>
  ),
});

// ─── Main Component ───────────────────────────────────────────────────────────

function EnrollPage() {
  const navigate = useNavigate();
  const videoRef = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const abortRef = useRef(new AbortController());

  const [state, dispatch] = useEnrollment();
  const [statusMsg, setStatusMsg] = useState("Awaiting camera permission…");

  // Form state
  const [depts, setDepts] = useState<Dept[]>([]);
  const [progs, setProgs] = useState<Prog[]>([]);
  const [pDept, setPDept] = useState("");
  const [pProg, setPProg] = useState("");
  const [pNcc, setPNcc] = useState("");
  const [pSem, setPSem] = useState("");
  const [pRoll, setPRoll] = useState("");
  const [deviceLabel, setDeviceLabel] = useState("");

  // Server functions
  const save = useServerFn(saveEnrollment);
  const checkEnrolled = useServerFn(hasEnrollment);
  const withdraw = useServerFn(withdrawBiometric);
  const getProfile = useServerFn(getMyProfile);
  const saveProfile = useServerFn(updateMyProfile);
  const listDeptsApi = useServerFn(listDepartments);
  const listProgsApi = useServerFn(listPrograms);
  const startDeviceReg = useServerFn(startWebauthnRegistration);
  const finishDeviceReg = useServerFn(finishWebauthnRegistration);
  const listDevicesApi = useServerFn(listMyWebauthnDevices);
  const removeDeviceApi = useServerFn(removeWebauthnDevice);
  const reqEnrollChallenge = useServerFn(requestEnrollmentChallenge);
  const fetchEnrolledPhoto = useServerFn(getEnrolledPhoto);
  const genVoicePassphrase = useServerFn(generateVoicePassphrase);
  const getRoles = useServerFn(getMyRoles);

  // ─── Mount: detect capabilities ───────────────────────────────────────────

  useEffect(() => {
    const SR = (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;
    dispatch({ type: "MOUNT", speechSupported: !!SR });

    import("@simplewebauthn/browser")
      .then((mod) => dispatch({ type: "WEBAUTHN_SUPPORTED", value: mod.browserSupportsWebAuthn() }))
      .catch(() => dispatch({ type: "WEBAUTHN_SUPPORTED", value: false }));

    return () => abortRef.current.abort();
  }, [dispatch]);

  // ─── Init: coordinated data fetch ─────────────────────────────────────────

  useEffect(() => {
    const abort = abortRef.current;

    (async () => {
      try {
        const [userResult, headers] = await Promise.all([
          supabase.auth.getUser(),
          getAuthHeaders(),
        ]);
        if (abort.signal.aborted) return;

        const email = userResult.data?.user?.email ?? "";

        // All non-critical requests run in parallel, failures are non-fatal
        const [enrollResult, rolesResult, profileResult, deptsResult, progsResult, devicesResult] =
          await Promise.allSettled([
            checkEnrolled({ data: undefined, headers }),
            getRoles({ data: undefined, headers }),
            getProfile({ data: undefined, headers }),
            listDeptsApi({ data: undefined, headers }),
            listProgsApi({ data: undefined, headers }),
            listDevicesApi({ data: undefined, headers }),
          ]);

        if (abort.signal.aborted) return;

        // Enrollment status
        if (enrollResult.status === "fulfilled") {
          const enrolled = (enrollResult.value as { enrolled: boolean }).enrolled;
          dispatch({ type: "SET_ENROLLMENT_STATUS", enrolled });
          if (enrolled) {
            fetchEnrolledPhoto({ data: undefined, headers })
              .then((res) => {
                if (!abort.signal.aborted && res?.photo) {
                  dispatch({ type: "SET_ENROLLED_PHOTO", photo: res.photo });
                }
              })
              .catch((e) => console.warn("[EnrollPage] Photo fetch failed:", e));
          }
        } else {
          console.warn("[EnrollPage] Enrollment check failed:", enrollResult.reason);
          dispatch({ type: "SET_ENROLLMENT_STATUS", enrolled: false });
        }

        // Roles — isAdmin from server ONLY
        if (rolesResult.status === "fulfilled") {
          const roles = rolesResult.value as {
            isAdmin: boolean;
            isTeacher: boolean;
            isStudent: boolean;
          };
          dispatch({
            type: "SET_USER",
            email,
            isAdmin: roles.isAdmin,
            isAdminOrTeacher: roles.isAdmin || roles.isTeacher,
          });
        } else {
          console.warn("[EnrollPage] Roles fetch failed:", rolesResult.reason);
          dispatch({ type: "SET_USER", email, isAdmin: false, isAdminOrTeacher: false });
        }

        // Profile
        if (profileResult.status === "fulfilled") {
          const prof = profileResult.value as Profile | null;
          if (prof) {
            dispatch({ type: "SET_PROFILE", profile: prof });
            setPDept(prof.department_id ?? "");
            setPProg(prof.program_id ?? "");
            setPSem(prof.current_semester ? String(prof.current_semester) : "");
            setPRoll(prof.roll_no ?? "");
          }
        } else {
          console.warn("[EnrollPage] Profile fetch failed:", profileResult.reason);
        }

        // Departments
        const fetchedDepts =
          deptsResult.status === "fulfilled" ? (deptsResult.value as Dept[]) : [];
        setDepts(fetchedDepts.length > 0 ? fetchedDepts : FALLBACK_DEPTS);

        // Programs
        const fetchedProgs =
          progsResult.status === "fulfilled" ? (progsResult.value as Prog[]) : [];
        setProgs(fetchedProgs.length > 0 ? fetchedProgs : FALLBACK_PROGS);

        // Devices
        if (devicesResult.status === "fulfilled") {
          dispatch({
            type: "SET_DEVICES",
            devices: devicesResult.value as any[],
          });
        }
      } catch (e) {
        if (abort.signal.aborted) return;
        console.warn("[EnrollPage] Init fetch failed:", e);
        dispatch({ type: "SET_ENROLLMENT_STATUS", enrolled: false });
        setDepts(FALLBACK_DEPTS);
        setProgs(FALLBACK_PROGS);
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ─── Camera stream ─────────────────────────────────────────────────────────

  useEffect(() => {
    if (state.enrollmentStatus !== "not_enrolled" || state.stage !== "capture") return;

    let activeStream: MediaStream | null = null;
    let subscribed = true;

    (async () => {
      try {
        const stream = await navigator.mediaDevices.getUserMedia({
          video: { width: 320, height: 240, facingMode: "user" },
        });
        if (!subscribed) {
          stream.getTracks().forEach((t) => t.stop());
          return;
        }
        activeStream = stream;
        if (videoRef.current) {
          videoRef.current.srcObject = stream;
          await videoRef.current.play().catch(() => undefined);
        }
        await loadFaceApi();
        if (!subscribed) return;
        dispatch({ type: "MODEL_READY" });
        setStatusMsg("Look at the camera and click Capture");
      } catch (e) {
        if (!subscribed) return;
        dispatch({ type: "MODEL_FAILED", reason: cleanErrorMessage(e) });
      }
    })();

    return () => {
      subscribed = false;
      activeStream?.getTracks().forEach((t) => t.stop());
    };
  }, [state.enrollmentStatus, state.stage, dispatch]);

  // ─── Helpers ───────────────────────────────────────────────────────────────

  const refreshDevices = useCallback(async () => {
    try {
      const headers = await getAuthHeaders();
      const d = await listDevicesApi({ data: undefined, headers });
      dispatch({ type: "SET_DEVICES", devices: d as any[] });
    } catch (e) {
      console.warn("[EnrollPage] Device refresh failed:", e);
    }
  }, [dispatch, listDevicesApi]);

  const capturePhotoSnapshot = useCallback((): string | null => {
    const video = videoRef.current;
    const canvas = canvasRef.current;
    if (!video || !canvas) return null;
    canvas.width = video.videoWidth || 320;
    canvas.height = video.videoHeight || 240;
    const ctx = canvas.getContext("2d");
    if (!ctx) return null;
    ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
    return canvas.toDataURL("image/jpeg", 0.85);
  }, []);

  // ─── Handlers ──────────────────────────────────────────────────────────────

  const onSaveProfile = useCallback(
    async (e: React.FormEvent) => {
      e.preventDefault();
      dispatch({ type: "PROFILE_BUSY", value: true });
      dispatch({ type: "SET_ERROR", error: null });
      try {
        const headers = await getAuthHeaders();
        await saveProfile({
          data: {
            departmentId: pDept || null,
            programId: pProg || null,
            currentSemester: pSem ? Number(pSem) : null,
            rollNo: pRoll || null,
          },
          headers,
        });
        dispatch({
          type: "SET_PROFILE",
          profile: {
            department_id: pDept || null,
            program_id: pProg || null,
            current_semester: pSem ? Number(pSem) : null,
            roll_no: pRoll || null,
          },
        });
      } catch (err) {
        dispatch({ type: "SET_ERROR", error: cleanErrorMessage(err) });
      } finally {
        dispatch({ type: "PROFILE_BUSY", value: false });
      }
    },
    [dispatch, saveProfile, pDept, pProg, pSem, pRoll],
  );

  const onCaptureAndVerify = useCallback(async () => {
    if (!state.consent) return;
    dispatch({ type: "SET_BUSY", value: true });
    dispatch({ type: "SET_ERROR", error: null });
    try {
      const video = videoRef.current;
      if (!video) throw new Error("Camera not initialised.");
      if (state.model.status !== "ready") {
        throw new Error("Camera is not ready. Allow camera access and wait.");
      }

      setStatusMsg("Checking frame for multiple faces…");
      const count = await detectFacesCount(video);
      if (count > 1) throw new Error("Multiple faces detected — please be alone in frame.");

      setStatusMsg("Requesting liveness challenge…");
      const headers = await getAuthHeaders();
      const challenge = (await reqEnrollChallenge({ headers })) as LivenessChallenge;

      const PROMPTS: Record<string, string> = {
        blink: "👀 Please BLINK your eyes now",
        turn_left: "👈 Please TURN head slightly LEFT",
        turn_right: "👉 Please TURN head slightly RIGHT",
        nod: "👇 Please NOD head slightly DOWN",
      };
      const prompt = PROMPTS[challenge.action] ?? `Action: ${challenge.action}`;
      dispatch({ type: "SET_LIVENESS_PROMPT", prompt });
      setStatusMsg(prompt);
      await new Promise((r) => setTimeout(r, 600));

      setStatusMsg("Capturing face sequence…");
      const seq = await captureLivenessFrameSequence(video, undefined, challenge.action);
      dispatch({ type: "SET_LIVENESS_PROMPT", prompt: null });

      if (!seq) throw new Error("Could not capture frames. Face camera in good lighting.");

      const check = verifyLivenessSignals(challenge.action as LivenessAction, seq.livenessSignals);
      if (!check.passed) {
        const REASONS: Record<string, string> = {
          turn_right_not_detected:
            "Right head turn not detected. Please turn head right when prompted.",
          turn_left_not_detected:
            "Left head turn not detected. Please turn head left when prompted.",
          blink_not_detected: "Blink not detected. Please blink clearly when prompted.",
          nod_not_detected: "Nod not detected. Please nod down when prompted.",
          static_photo_detected: "Static image detected. Please move naturally.",
        };
        throw new Error(REASONS[check.reason] ?? `Liveness failed (${check.reason}).`);
      }

      setStatusMsg("Assessing frame quality…");
      const passingEmbeddings: number[][] = [];
      const allQualityReasons = new Set<string>();

      for (let i = 0; i < seq.frameEmbeddings.length; i++) {
        const frameAction = seq.frameActions?.[i] ?? challenge.action;
        if (frameAction === "turn_left" || frameAction === "turn_right") {
          allQualityReasons.add("turn_gesture_frame_excluded");
          continue;
        }
        const signal = seq.livenessSignals?.[i];
        if (signal && !isEmbeddingEligible({ yaw: signal.yaw, pitch: signal.pitch })) {
          allQualityReasons.add("off_angle_pose");
          continue;
        }
        const landmarks = seq.frameLandmarks?.[i];
        const bbox = seq.frameBboxes?.[i];
        if (landmarks && bbox) {
          const q = assessFrameQuality(landmarks, bbox, video);
          if (!q.passed) {
            q.reasons.forEach((r) => allQualityReasons.add(r));
            continue;
          }
        }
        passingEmbeddings.push(seq.frameEmbeddings[i]);
      }

      // ── Step 2: Dedicated Straight Frontal Profile Photo Capture ──────
      // Prompt user to hold steady and face camera squarely
      const promptMsg = "📸 Hold steady & look at camera for profile photo...";
      dispatch({ type: "SET_LIVENESS_PROMPT", prompt: promptMsg });
      setStatusMsg(promptMsg);

      // Brief delay (600ms) to allow user to stabilize posture after gesture
      await new Promise((r) => setTimeout(r, 600));

      const faceapi = await loadFaceApi();
      let frontalPhotoUrl: string | null = null;
      let frontalEmbedding: number[] | null = null;
      let bestFramePhoto: string | null = null;
      let bestFrameEmbedding: number[] | null = null;
      let minAngle = Infinity;
      let retries = 15; // 15 attempts (~3s window)

      while (retries > 0) {
        const det: any = await faceapi
          .detectSingleFace(
            video,
            new faceapi.TinyFaceDetectorOptions({ inputSize: 128, scoreThreshold: 0.25 }),
          )
          .withFaceLandmarks(true)
          .withFaceDescriptor();

        if (det?.landmarks && det?.descriptor) {
          const positions = det.landmarks.positions;
          const { yaw, pitch } = estimateHeadAngles(positions);
          const totalAngle = Math.abs(yaw) + Math.abs(pitch);
          const currentPhoto = capturePhotoSnapshot();

          if (currentPhoto && totalAngle < minAngle) {
            minAngle = totalAngle;
            bestFramePhoto = currentPhoto;
            bestFrameEmbedding = Array.from(det.descriptor as Float32Array);
          }

          // Mobile-friendly posture threshold (|yaw| <= 25°, |pitch| <= 25°)
          if (Math.abs(yaw) <= 25 && Math.abs(pitch) <= 25 && currentPhoto) {
            frontalEmbedding = Array.from(det.descriptor as Float32Array);
            frontalPhotoUrl = currentPhoto;
            break;
          }
        }
        retries--;
        await new Promise((r) => setTimeout(r, 150));
      }

      // Best-frame fallback: if strict threshold wasn't hit, use the straightest frame captured
      if (!frontalPhotoUrl || !frontalEmbedding) {
        frontalPhotoUrl = bestFramePhoto || capturePhotoSnapshot();
        frontalEmbedding = bestFrameEmbedding;
      }

      dispatch({ type: "SET_LIVENESS_PROMPT", prompt: null });

      if (!frontalPhotoUrl || !frontalEmbedding) {
        throw new Error(
          "Could not detect face for profile photo. Please face the camera squarely in good lighting and try again.",
        );
      }

      passingEmbeddings.push(frontalEmbedding);
      const embedding = averageEmbeddings(passingEmbeddings);
      const photoDataUrl = frontalPhotoUrl;

      const qualityWarnings = [...allQualityReasons]
        .map((r) => QUALITY_REASON_MESSAGES[r] ?? r)
        .filter((r) => r && r !== "turn_gesture_frame_excluded" && r !== "off_angle_pose");

      dispatch({
        type: "CAPTURE_READY",
        capture: {
          embedding,
          photoDataUrl,
          livenessChallenge: challenge,
          livenessSignals: seq.livenessSignals,
          qualityPassedFrames: passingEmbeddings.length,
          qualityTotalFrames: seq.frameEmbeddings.length,
          qualityWarnings,
        },
      });
      setStatusMsg("Straight frontal profile photo captured successfully. Click Confirm.");
    } catch (e) {
      dispatch({ type: "SET_LIVENESS_PROMPT", prompt: null });
      dispatch({ type: "SET_ERROR", error: cleanErrorMessage(e) });
      setStatusMsg("Capture failed. Adjust lighting or permissions and try again.");
    }
  }, [state.consent, state.model.status, dispatch, reqEnrollChallenge, capturePhotoSnapshot]);

  const onConfirmEnrollment = useCallback(async () => {
    if (!state.pendingCapture) return;
    dispatch({ type: "SET_BUSY", value: true });
    dispatch({ type: "SET_ERROR", error: null });
    try {
      setStatusMsg("Encrypting descriptor and saving enrollment…");
      const fp = await computeDeviceFingerprint();
      const headers = await getAuthHeaders();
      await save({
        data: {
          embedding: state.pendingCapture.embedding,
          deviceFingerprint: fp,
          consent: {
            policyVersion: POLICY_VERSION,
            allowFallback: state.allowFallback,
            retentionDays: 365,
            voiceEnrolled: state.voiceEnroll && state.voiceTranscript ? true : undefined,
            voicePassphrase:
              state.voiceEnroll && state.voiceTranscript
                ? (state.voicePassphrase ?? undefined)
                : undefined,
          },
          livenessChallenge: state.pendingCapture.livenessChallenge,
          livenessSignals: state.pendingCapture.livenessSignals,
          photoDataUrl: state.pendingCapture.photoDataUrl,
        },
        headers,
      });
      dispatch({
        type: "ENROLLMENT_CONFIRMED",
        photo: state.pendingCapture.photoDataUrl,
      });
      setStatusMsg("Enrollment complete. You can now check into sessions.");
    } catch (e) {
      dispatch({ type: "SET_ERROR", error: cleanErrorMessage(e) });
      setStatusMsg("Enrollment saving failed. Please retake photo or try again.");
    }
  }, [state, dispatch, save]);

  const onWithdrawBiometric = useCallback(async () => {
    try {
      const headers = await getAuthHeaders();
      await withdraw({ data: { reason: "user-initiated" }, headers });
      dispatch({ type: "BIOMETRIC_WITHDRAWN" });
      setStatusMsg("Biometric data deleted. You may re-enroll.");
    } catch (e) {
      dispatch({ type: "SET_ERROR", error: cleanErrorMessage(e) });
    }
  }, [dispatch, withdraw]);

  const onAdminReset = useCallback(async () => {
    try {
      const headers = await getAuthHeaders();
      await withdraw({ data: { reason: "admin-initiated" }, headers });
      dispatch({ type: "BIOMETRIC_WITHDRAWN" });
    } catch (e) {
      dispatch({ type: "SET_ERROR", error: cleanErrorMessage(e) });
    }
  }, [dispatch, withdraw]);

  const onRegisterDevice = useCallback(async () => {
    dispatch({ type: "DEVICE_BUSY", value: true });
    dispatch({ type: "DEVICE_ERROR", error: null });
    try {
      const { startRegistration } = await import("@simplewebauthn/browser");
      const headers = await getAuthHeaders();
      const { options, envelope } = await startDeviceReg({ data: undefined, headers });
      const response = await startRegistration({ optionsJSON: options });
      await finishDeviceReg({
        data: { response, envelope, deviceLabel: deviceLabel.trim() || undefined },
        headers,
      });
      setDeviceLabel("");
      await refreshDevices();
    } catch (e) {
      dispatch({
        type: "DEVICE_ERROR",
        error: e instanceof Error ? e.message : "Registration failed or cancelled.",
      });
    } finally {
      dispatch({ type: "DEVICE_BUSY", value: false });
    }
  }, [dispatch, startDeviceReg, finishDeviceReg, deviceLabel, refreshDevices]);

  const onRemoveDevice = useCallback(
    async (id: string) => {
      dispatch({ type: "DEVICE_BUSY", value: true });
      dispatch({ type: "DEVICE_ERROR", error: null });
      try {
        const headers = await getAuthHeaders();
        await removeDeviceApi({ data: { id }, headers });
        await refreshDevices();
      } catch (e) {
        dispatch({
          type: "DEVICE_ERROR",
          error: e instanceof Error ? e.message : "Could not remove device.",
        });
      } finally {
        dispatch({ type: "DEVICE_BUSY", value: false });
      }
    },
    [dispatch, removeDeviceApi, refreshDevices],
  );

  const onSignOut = useCallback(async () => {
    await supabase.auth.signOut();
    navigate({ to: "/" });
  }, [navigate]);

  const onSpeakPassphrase = useCallback(() => {
    const SR = (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;
    if (!SR) {
      dispatch({ type: "VOICE_ERROR", error: "Speech recognition not supported." });
      return;
    }
    dispatch({ type: "VOICE_LISTENING_START" });
    const rec = new SR();
    rec.lang = "en-US";
    rec.interimResults = false;
    rec.maxAlternatives = 1;
    rec.onresult = (event: any) => {
      dispatch({
        type: "VOICE_LISTENING_DONE",
        transcript: event.results?.[0]?.[0]?.transcript ?? "",
      });
    };
    rec.onerror = () =>
      dispatch({ type: "VOICE_ERROR", error: "Could not capture speech. Try again." });
    rec.onend = () => {
      if (state.voiceListening) dispatch({ type: "VOICE_LISTENING_DONE", transcript: "" });
    };
    rec.start();
  }, [dispatch, state.voiceListening]);

  // ─── Derived ───────────────────────────────────────────────────────────────

  const profileIncomplete =
    !state.isAdminOrTeacher &&
    (!state.profile || !state.profile.department_id || !state.profile.roll_no);

  const isAuthError =
    state.error && (state.error.includes("signed in") || state.error.includes("Unauthorized"));

  // ─── Guards ────────────────────────────────────────────────────────────────

  if (isAuthError) {
    return (
      <div className="mx-auto max-w-md px-6 py-16 text-center">
        <div className="mx-auto mb-4 flex h-14 w-14 items-center justify-center rounded-full bg-amber-500/10 text-3xl">
          🔑
        </div>
        <h1 className="text-xl font-bold text-foreground">Sign In Required</h1>
        <p className="mt-2 text-sm text-muted-foreground">
          You need an active university account session to access face enrollment.
        </p>
        <Link
          to="/auth"
          className="mt-6 inline-flex items-center justify-center rounded-md bg-primary px-5 py-2.5 text-sm font-semibold text-primary-foreground shadow hover:bg-primary/90 transition-colors"
        >
          Sign In to Presence ERP →
        </Link>
      </div>
    );
  }

  if (state.enrollmentStatus === "loading") {
    return (
      <div className="mx-auto max-w-2xl px-6 py-16 text-center" aria-live="polite">
        <div className="mx-auto mb-4 h-12 w-12 animate-spin rounded-full border-4 border-primary border-t-transparent" />
        <p className="text-sm text-muted-foreground">Loading your enrollment status…</p>
      </div>
    );
  }

  if (state.enrollmentStatus === "enrolled") {
    return (
      <EnrolledView
        state={state}
        depts={depts}
        progs={progs}
        deviceLabel={deviceLabel}
        setDeviceLabel={setDeviceLabel}
        onRegisterDevice={onRegisterDevice}
        onRemoveDevice={onRemoveDevice}
        onWithdrawBiometric={onWithdrawBiometric}
        onAdminReset={onAdminReset}
        onSignOut={onSignOut}
      />
    );
  }

  // ─── Not enrolled view ─────────────────────────────────────────────────────

  return (
    <div className="mx-auto max-w-2xl px-6 py-10">
      <h1 className="text-2xl font-semibold text-foreground">Enroll your face</h1>
      <p className="mt-2 text-sm text-muted-foreground">
        Your camera image is processed <strong>only in this browser</strong>. We never store raw
        images or video. What leaves your device is a 128-dimension numeric descriptor, encrypted
        with AES-GCM on the server.
      </p>

      {!state.isAdminOrTeacher && (
        <ProfileForm
          profile={state.profile}
          depts={depts}
          progs={progs}
          pDept={pDept}
          pProg={pProg}
          pNcc={pNcc}
          pSem={pSem}
          pRoll={pRoll}
          profileBusy={state.profileBusy}
          profileIncomplete={profileIncomplete}
          setPDept={setPDept}
          setPProg={setPProg}
          setPNcc={setPNcc}
          setPSem={setPSem}
          setPRoll={setPRoll}
          onSave={onSaveProfile}
        />
      )}

      {/* Camera / Preview */}
      {state.stage === "capture" && (
        <div className="relative mt-6 overflow-hidden rounded-lg border border-border bg-black">
          {state.livenessPrompt && (
            <div
              role="alert"
              aria-live="assertive"
              className="absolute top-4 left-1/2 -translate-x-1/2 z-10 rounded-full bg-amber-500 px-4 py-2 text-xs sm:text-sm font-bold text-black shadow-lg animate-pulse"
            >
              {state.livenessPrompt}
            </div>
          )}
          <video
            ref={videoRef}
            autoPlay
            playsInline
            muted
            aria-label="Camera preview for face enrollment"
            className="mx-auto block aspect-[4/3] w-full max-w-md"
          />
        </div>
      )}

      {state.stage === "preview" && state.pendingCapture && (
        <div className="mt-6 rounded-lg border border-border bg-card p-6 text-center shadow-md">
          <h3 className="text-base font-semibold text-foreground mb-3">
            Review Your Captured Face Photo
          </h3>
          <div className="mx-auto relative w-48 h-48 mb-4 overflow-hidden rounded-full border-4 border-primary/40 shadow">
            <img
              src={state.pendingCapture.photoDataUrl}
              alt="Your captured face for enrollment review"
              className="w-full h-full object-cover"
            />
          </div>
          <div className="mb-2 flex flex-wrap justify-center gap-2">
            <span className="inline-flex items-center gap-1 rounded-full bg-emerald-500/15 px-3 py-1 text-xs font-semibold text-emerald-700 dark:text-emerald-300">
              ✓ Single face verified
            </span>
            <span className="inline-flex items-center gap-1 rounded-full bg-emerald-500/15 px-3 py-1 text-xs font-semibold text-emerald-700 dark:text-emerald-300">
              ✓ Liveness: {state.pendingCapture.livenessChallenge?.action ?? "passed"}
            </span>
            <span className="inline-flex items-center gap-1 rounded-full bg-blue-500/15 px-3 py-1 text-xs font-semibold text-blue-700 dark:text-blue-300">
              📷 {state.pendingCapture.qualityPassedFrames}/
              {state.pendingCapture.qualityTotalFrames} frames passed
            </span>
          </div>
          {state.pendingCapture.qualityWarnings.length > 0 && (
            <div className="mb-3 mx-auto max-w-sm rounded-md bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-700/40 px-3 py-2 text-left">
              <p className="text-xs font-semibold text-amber-800 dark:text-amber-300 mb-1">
                ⚠ Some frames had quality issues:
              </p>
              <ul className="list-disc list-inside space-y-0.5">
                {state.pendingCapture.qualityWarnings.map((w, i) => (
                  <li key={i} className="text-xs text-amber-700 dark:text-amber-400">
                    {w}
                  </li>
                ))}
              </ul>
            </div>
          )}
          <p className="text-xs text-muted-foreground mb-4">
            If clear and well-lit, click Confirm &amp; Enroll. Otherwise, retake.
          </p>
          <div className="flex justify-center gap-3">
            <button
              disabled={state.busy}
              onClick={onConfirmEnrollment}
              aria-busy={state.busy}
              className="rounded-md bg-primary px-5 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-60 shadow"
            >
              {state.busy ? "Encrypting & Saving…" : "Confirm & Enroll"}
            </button>
            <button
              disabled={state.busy}
              onClick={() => dispatch({ type: "RETAKE" })}
              className="rounded-md border border-input px-4 py-2 text-sm font-medium hover:bg-accent disabled:opacity-60"
            >
              Retake Photo
            </button>
          </div>
        </div>
      )}

      <canvas ref={canvasRef} className="hidden" aria-hidden="true" />
      <p aria-live="polite" className="mt-2 text-xs text-muted-foreground">
        {statusMsg}
      </p>

      {/* Consent */}
      {state.stage === "capture" && (
        <div className="mt-6 space-y-3 rounded-lg border border-border bg-card p-4 text-sm text-card-foreground">
          <p className="font-medium">Consent (policy v{POLICY_VERSION})</p>
          <p className="text-muted-foreground">
            Under GDPR Art. 9, India's DPDP Act, and BIPA, face descriptors are special-category
            biometric data. By continuing you grant explicit, revocable consent for Presence to
            store your encrypted descriptor for up to 365 days, solely to verify your identity at
            attendance.
          </p>
          <label className="flex items-start gap-2">
            <input
              type="checkbox"
              checked={state.consent}
              onChange={(e) => dispatch({ type: "SET_CONSENT", value: e.target.checked })}
              aria-label="I consent to biometric enrollment"
              className="mt-0.5"
            />
            <span>I consent to biometric enrollment as described above.</span>
          </label>
          <label className="flex items-start gap-2">
            <input
              type="checkbox"
              checked={state.allowFallback}
              onChange={(e) => dispatch({ type: "SET_ALLOW_FALLBACK", value: e.target.checked })}
              aria-label="Allow non-biometric fallback"
              className="mt-0.5"
            />
            <span>
              Allow non-biometric fallback (OTP + teacher justification) if biometric fails.
            </span>
          </label>

          {/* Voice enrollment */}
          <div className="mt-4 rounded-lg border border-blue-500/30 bg-blue-500/5 p-3">
            <label className="flex items-start gap-2">
              <input
                type="checkbox"
                checked={state.voiceEnroll}
                onChange={(e) => {
                  dispatch({ type: "SET_VOICE_ENROLL", value: e.target.checked });
                  if (e.target.checked && !state.voicePassphrase) {
                    genVoicePassphrase().then((r) =>
                      dispatch({ type: "SET_VOICE_PASSPHRASE", passphrase: r.passphrase }),
                    );
                  }
                }}
                className="mt-0.5"
              />
              <span>
                <span className="font-medium">Set up voice verification (optional)</span>
                <span className="block text-xs text-muted-foreground mt-0.5">
                  Borderline face matches can be resolved by speaking a passphrase instead of
                  waiting for teacher approval.
                </span>
              </span>
            </label>
            {state.voiceEnroll && (
              <div className="mt-3 space-y-2">
                {!state.speechSupported ? (
                  <p className="text-xs text-amber-600 dark:text-amber-400">
                    Web Speech API not supported. Voice verification unavailable.
                  </p>
                ) : (
                  <>
                    <p className="text-xs text-muted-foreground">
                      Your passphrase:{" "}
                      <span className="font-mono font-bold text-foreground text-sm">
                        {state.voicePassphrase ?? "Generating…"}
                      </span>
                    </p>
                    <button
                      type="button"
                      disabled={state.voiceListening || !state.voicePassphrase}
                      onClick={onSpeakPassphrase}
                      aria-busy={state.voiceListening}
                      className="rounded-md border border-blue-500/40 bg-blue-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-blue-700 disabled:opacity-50"
                    >
                      {state.voiceListening
                        ? "Listening… speak the passphrase"
                        : "Speak passphrase"}
                    </button>
                    {state.voiceTranscript && (
                      <p className="text-xs text-emerald-700 dark:text-emerald-300">
                        Heard: <span className="font-mono">{state.voiceTranscript}</span>
                      </p>
                    )}
                    {state.voiceError && (
                      <p role="alert" className="text-xs text-destructive">
                        {state.voiceError}
                      </p>
                    )}
                  </>
                )}
              </div>
            )}
          </div>
        </div>
      )}

      {/* Error */}
      {state.error && !isAuthError && (
        <div
          role="alert"
          className="mt-4 rounded-xl border border-amber-500/40 bg-amber-500/10 p-4 text-sm text-amber-900 dark:text-amber-200 shadow-sm"
        >
          <p className="font-semibold">{state.error}</p>
        </div>
      )}

      {/* Capture button */}
      {state.stage === "capture" && (
        <div className="mt-6 flex flex-wrap gap-3">
          <button
            disabled={
              !state.consent || state.busy || profileIncomplete || state.model.status !== "ready"
            }
            onClick={onCaptureAndVerify}
            aria-busy={state.busy}
            className="rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-60"
          >
            {state.busy ? "Verifying Face…" : "Capture & Verify Face"}
          </button>
          <button
            onClick={onSignOut}
            className="rounded-md border border-input px-4 py-2 text-sm hover:bg-accent"
          >
            Sign out
          </button>
        </div>
      )}

      <p className="mt-6 text-xs text-muted-foreground">
        Read the full{" "}
        <Link to="/privacy" className="text-primary underline">
          privacy &amp; biometric data policy
        </Link>
        .
      </p>

      {/* Device binding (enrollment page bottom) */}
      <div className="mt-8 border-t border-border pt-6">
        <h2 className="text-sm font-semibold">Bind a device (recommended)</h2>
        <p className="mt-1 text-xs text-muted-foreground">
          Registering Face ID / Touch ID / Windows Hello adds hardware-backed check-in on top of
          face verification.
        </p>
        {!state.isMounted ? (
          <div className="mt-3 text-xs text-muted-foreground animate-pulse">
            Checking device authenticator support…
          </div>
        ) : (
          <>
            {!state.webauthnSupported && (
              <p className="mt-2 text-xs text-amber-700 dark:text-amber-400">
                This browser doesn't support device binding. Try Chrome, Safari, or Edge.
              </p>
            )}
            {state.devices.length > 0 && (
              <ul className="mt-3 space-y-1 text-sm" aria-label="Registered devices">
                {state.devices.map((d) => (
                  <li key={d.id} className="flex items-center justify-between gap-2">
                    <span>
                      {d.device_label || "Unnamed device"} —{" "}
                      {new Date(d.created_at).toLocaleDateString()}
                    </span>
                    <button
                      disabled={state.deviceBusy}
                      onClick={() => onRemoveDevice(d.id)}
                      className="text-xs text-destructive underline disabled:opacity-60"
                    >
                      Remove
                    </button>
                  </li>
                ))}
              </ul>
            )}
            {state.deviceError && (
              <p role="alert" className="mt-2 text-xs text-destructive">
                {state.deviceError}
              </p>
            )}
            <div className="mt-3 flex flex-wrap items-center gap-2">
              <label htmlFor="bottom-device-label" className="sr-only">
                Device name
              </label>
              <input
                id="bottom-device-label"
                value={deviceLabel}
                onChange={(e) => setDeviceLabel(e.target.value)}
                placeholder="Device name (optional)"
                className="rounded-md border border-input bg-background px-2 py-1.5 text-sm"
              />
              <button
                disabled={state.deviceBusy || !state.webauthnSupported}
                onClick={onRegisterDevice}
                className="rounded-md border border-input px-3 py-1.5 text-sm hover:bg-accent disabled:opacity-60"
              >
                {state.deviceBusy ? "Working…" : "Register this device"}
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
