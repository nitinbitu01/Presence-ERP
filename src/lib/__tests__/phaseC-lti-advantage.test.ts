import { describe, it, expect } from "vitest";
import {
  buildLtiOidcInitiationUrl,
  verifyLtiIdTokenClaims,
  getActiveLtiPlatforms,
  initiateLtiLaunch,
  syncAttendanceToLmsGradebook,
  syncLmsCourseRoster,
  type LtiPlatformConfig,
} from "../lti-advantage.server";

describe("Phase C.1 LTI 1.3 Advantage LMS Protocol Engine", () => {
  const sampleCanvas: LtiPlatformConfig = {
    id: "canvas_test",
    name: "canvas",
    issuer: "https://canvas.instructure.com",
    clientId: "10000000000001",
    authEndpoint: "https://canvas.instructure.com/api/lti/authorize_redirect",
    tokenEndpoint: "https://canvas.instructure.com/login/oauth2/token",
    jwksUrl: "https://canvas.instructure.com/api/lti/security/jwks",
    enabled: true,
  };

  describe("OIDC Login Initiation Builder", () => {
    it("constructs valid OIDC initiation URL with target_link_uri and nonce", () => {
      const url = buildLtiOidcInitiationUrl(
        sampleCanvas,
        "https://rru-presence.pages.dev/attend",
        "user_hint_123",
      );

      expect(url).toContain("https://canvas.instructure.com/api/lti/authorize_redirect");
      expect(url).toContain("iss=https%3A%2F%2Fcanvas.instructure.com");
      expect(url).toContain("client_id=10000000000001");
      expect(url).toContain("nonce=lti_nonce_");
    });
  });

  describe("LTI 1.3 id_token Claims Verification", () => {
    it("validates compliant LTI 1.3 ResourceLinkRequest claims", () => {
      const claims = {
        "https://purl.imsglobal.org/spec/lti/claim/version": "1.3.0",
        "https://purl.imsglobal.org/spec/lti/claim/message_type": "LtiResourceLinkRequest",
        iss: "https://canvas.instructure.com",
        aud: "10000000000001",
      };

      const res = verifyLtiIdTokenClaims(
        claims,
        "10000000000001",
        "https://canvas.instructure.com",
      );
      expect(res.valid).toBe(true);
    });

    it("rejects non-1.3.0 version claim", () => {
      const claims = {
        "https://purl.imsglobal.org/spec/lti/claim/version": "1.1.0",
        "https://purl.imsglobal.org/spec/lti/claim/message_type": "LtiResourceLinkRequest",
        iss: "https://canvas.instructure.com",
        aud: "10000000000001",
      };

      const res = verifyLtiIdTokenClaims(
        claims,
        "10000000000001",
        "https://canvas.instructure.com",
      );
      expect(res.valid).toBe(false);
      expect(res.reason).toContain("Required: 1.3.0");
    });
  });

  describe("Server Function Exports", () => {
    it("exports getActiveLtiPlatforms function", () => {
      expect(typeof getActiveLtiPlatforms).toBe("function");
    });

    it("exports initiateLtiLaunch function", () => {
      expect(typeof initiateLtiLaunch).toBe("function");
    });

    it("exports syncAttendanceToLmsGradebook function", () => {
      expect(typeof syncAttendanceToLmsGradebook).toBe("function");
    });

    it("exports syncLmsCourseRoster function", () => {
      expect(typeof syncLmsCourseRoster).toBe("function");
    });
  });
});
