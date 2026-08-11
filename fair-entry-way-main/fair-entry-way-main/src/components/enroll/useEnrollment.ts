/**
 * useEnrollment.ts
 * Single useReducer state machine replacing 25+ useState calls.
 * Every state transition is explicit and traceable.
 */
import { useReducer } from "react";
import type { LivenessChallenge } from "@/lib/attendance-crypto.server";

// ─── Types ────────────────────────────────────────────────────────────────────

export type EnrollStage = "capture" | "preview" | "done";

export type ModelState =
  { status: "loading" } | { status: "ready" } | { status: "failed"; reason: string };

export type PendingCapture = {
  embedding: number[];
  photoDataUrl: string;
  livenessChallenge: LivenessChallenge;
  livenessSignals?: Array<{
    ear: number;
    yaw: number;
    pitch: number;
    faceArea: number;
    faceX: number;
    faceY: number;
  }>;
  qualityPassedFrames: number;
  qualityTotalFrames: number;
  qualityWarnings: string[];
};

export type Profile = {
  department_id: string | null;
  program_id: string | null;
  current_semester: number | null;
  roll_no: string | null;
};

export type WebauthnDevice = {
  id: string;
  device_label: string | null;
  created_at: string;
  last_used_at: string | null;
};

// ─── Typed error classes (replaces string inspection) ─────────────────────────

export class AuthError extends Error {
  constructor(msg = "You are not signed in. Please sign in to continue.") {
    super(msg);
    this.name = "AuthError";
  }
}

export class LivenessError extends Error {
  constructor(msg: string) {
    super(msg);
    this.name = "LivenessError";
  }
}

export class CameraError extends Error {
  constructor(msg: string) {
    super(msg);
    this.name = "CameraError";
  }
}

// ─── State ────────────────────────────────────────────────────────────────────

export type EnrollState = {
  // Enrollment lifecycle
  enrollmentStatus: "loading" | "enrolled" | "not_enrolled";
  stage: EnrollStage;
  model: ModelState;
  busy: boolean;
  error: string | null;
  livenessPrompt: string | null;
  pendingCapture: PendingCapture | null;

  // User identity
  userEmail: string;
  isAdmin: boolean;
  isAdminOrTeacher: boolean;

  // Profile
  profile: Profile | null;
  profileBusy: boolean;

  // Enrollment photo
  enrolledPhoto: string | null;

  // WebAuthn devices
  devices: WebauthnDevice[];
  deviceBusy: boolean;
  deviceError: string | null;
  webauthnSupported: boolean;
  isMounted: boolean;

  // Consent
  consent: boolean;
  allowFallback: boolean;

  // Voice
  voiceEnroll: boolean;
  voicePassphrase: string | null;
  voiceTranscript: string | null;
  voiceListening: boolean;
  voiceError: string | null;
  speechSupported: boolean;
};

// ─── Actions ──────────────────────────────────────────────────────────────────

export type EnrollAction =
  // Lifecycle
  | { type: "MOUNT"; speechSupported: boolean }
  | { type: "WEBAUTHN_SUPPORTED"; value: boolean }
  | { type: "SET_USER"; email: string; isAdmin: boolean; isAdminOrTeacher: boolean }
  | { type: "SET_ENROLLMENT_STATUS"; enrolled: boolean }
  | { type: "SET_ENROLLED_PHOTO"; photo: string }
  | { type: "CLEAR_ENROLLED_PHOTO" }
  // Model
  | { type: "MODEL_READY" }
  | { type: "MODEL_FAILED"; reason: string }
  // Camera & capture
  | { type: "SET_LIVENESS_PROMPT"; prompt: string | null }
  | { type: "CAPTURE_READY"; capture: PendingCapture }
  | { type: "RETAKE" }
  | { type: "ENROLLMENT_CONFIRMED"; photo: string }
  | { type: "BIOMETRIC_WITHDRAWN" }
  // Profile
  | { type: "SET_PROFILE"; profile: Profile }
  | { type: "PROFILE_BUSY"; value: boolean }
  // Devices
  | { type: "SET_DEVICES"; devices: WebauthnDevice[] }
  | { type: "DEVICE_BUSY"; value: boolean }
  | { type: "DEVICE_ERROR"; error: string | null }
  // Consent
  | { type: "SET_CONSENT"; value: boolean }
  | { type: "SET_ALLOW_FALLBACK"; value: boolean }
  // Voice
  | { type: "SET_VOICE_ENROLL"; value: boolean }
  | { type: "SET_VOICE_PASSPHRASE"; passphrase: string }
  | { type: "VOICE_LISTENING_START" }
  | { type: "VOICE_LISTENING_DONE"; transcript: string }
  | { type: "VOICE_ERROR"; error: string }
  // Busy / error
  | { type: "SET_BUSY"; value: boolean }
  | { type: "SET_ERROR"; error: string | null };

// ─── Initial state ────────────────────────────────────────────────────────────

export const initialEnrollState: EnrollState = {
  enrollmentStatus: "loading",
  stage: "capture",
  model: { status: "loading" },
  busy: false,
  error: null,
  livenessPrompt: null,
  pendingCapture: null,
  userEmail: "",
  isAdmin: false,
  isAdminOrTeacher: false,
  profile: null,
  profileBusy: false,
  enrolledPhoto: null,
  devices: [],
  deviceBusy: false,
  deviceError: null,
  webauthnSupported: false,
  isMounted: false,
  consent: false,
  allowFallback: true,
  voiceEnroll: false,
  voicePassphrase: null,
  voiceTranscript: null,
  voiceListening: false,
  voiceError: null,
  speechSupported: false,
};

// ─── Reducer ──────────────────────────────────────────────────────────────────

export function enrollReducer(state: EnrollState, action: EnrollAction): EnrollState {
  switch (action.type) {
    case "MOUNT":
      return { ...state, isMounted: true, speechSupported: action.speechSupported };
    case "WEBAUTHN_SUPPORTED":
      return { ...state, webauthnSupported: action.value };
    case "SET_USER":
      return {
        ...state,
        userEmail: action.email,
        isAdmin: action.isAdmin,
        isAdminOrTeacher: action.isAdminOrTeacher,
      };
    case "SET_ENROLLMENT_STATUS":
      return {
        ...state,
        enrollmentStatus: action.enrolled ? "enrolled" : "not_enrolled",
      };
    case "SET_ENROLLED_PHOTO":
      return { ...state, enrolledPhoto: action.photo };
    case "CLEAR_ENROLLED_PHOTO":
      return { ...state, enrolledPhoto: null };
    case "MODEL_READY":
      return { ...state, model: { status: "ready" } };
    case "MODEL_FAILED":
      return { ...state, model: { status: "failed", reason: action.reason } };
    case "SET_LIVENESS_PROMPT":
      return { ...state, livenessPrompt: action.prompt };
    case "CAPTURE_READY":
      return {
        ...state,
        pendingCapture: action.capture,
        stage: "preview",
        busy: false,
        error: null,
      };
    case "RETAKE":
      return {
        ...state,
        pendingCapture: null,
        livenessPrompt: null,
        stage: "capture",
        error: null,
      };
    case "ENROLLMENT_CONFIRMED":
      return {
        ...state,
        enrollmentStatus: "enrolled",
        enrolledPhoto: action.photo,
        stage: "done",
        busy: false,
      };
    case "BIOMETRIC_WITHDRAWN":
      return {
        ...state,
        enrollmentStatus: "not_enrolled",
        enrolledPhoto: null,
        stage: "capture",
        pendingCapture: null,
        livenessPrompt: null,
        error: null,
      };
    case "SET_PROFILE":
      return { ...state, profile: action.profile };
    case "PROFILE_BUSY":
      return { ...state, profileBusy: action.value };
    case "SET_DEVICES":
      return { ...state, devices: action.devices };
    case "DEVICE_BUSY":
      return { ...state, deviceBusy: action.value };
    case "DEVICE_ERROR":
      return { ...state, deviceError: action.error };
    case "SET_CONSENT":
      return { ...state, consent: action.value };
    case "SET_ALLOW_FALLBACK":
      return { ...state, allowFallback: action.value };
    case "SET_VOICE_ENROLL":
      return { ...state, voiceEnroll: action.value };
    case "SET_VOICE_PASSPHRASE":
      return { ...state, voicePassphrase: action.passphrase };
    case "VOICE_LISTENING_START":
      return { ...state, voiceListening: true, voiceError: null };
    case "VOICE_LISTENING_DONE":
      return { ...state, voiceListening: false, voiceTranscript: action.transcript };
    case "VOICE_ERROR":
      return { ...state, voiceListening: false, voiceError: action.error };
    case "SET_BUSY":
      return { ...state, busy: action.value };
    case "SET_ERROR":
      return { ...state, error: action.error, busy: false };
    default:
      return state;
  }
}

export function useEnrollment() {
  return useReducer(enrollReducer, initialEnrollState);
}
