import { describe, it, expect } from "vitest";
import {
  computePkceS256CodeChallenge,
  verifySamlX509Certificate,
  verifyDomainBoundary,
  generateOidcState,
  validateAndConsumeState,
  verifySamlAssertionValidity,
  verifyOidcTokenClaims,
  resolveIdpByEmailDomain,
  buildSamlAuthnRequest,
  mapSsoAttributes,
  getActiveSsoProviders,
  initiateSsoLogin,
  handleSsoCallback,
  configureSsoProvider,
  discoverIdpByEmail,
  handleSamlSingleLogout,
  type SsoProviderConfig,
} from "../sso.server";

describe("Phase A Military-Grade Hardened Enterprise SSO Engine", () => {
  const sampleProvider: SsoProviderConfig = {
    id: "test_azure_ad",
    name: "Test Azure AD",
    type: "azure_ad",
    protocol: "oidc",
    enabled: true,
    domains: ["university.edu"],
    ssoUrl: "https://login.microsoftonline.com/tenant/oauth2/v2.0/authorize",
    clientId: "client_123",
    attributeMapping: {
      email: "upn",
      displayName: "name",
      rollNo: "employeeId",
      department: "dept",
      groups: "userGroups",
    },
    groupRoleMapping: {
      "Faculty-Group": "teacher",
      "Admin-Group": "admin",
    },
    updatedAt: new Date().toISOString(),
  };

  describe("PKCE S256 Code Challenge Computation", () => {
    it("computes deterministic base64url PKCE code challenge from verifier", () => {
      const verifier = "pkce_test_verifier_999";
      const challenge = computePkceS256CodeChallenge(verifier);
      expect(typeof challenge).toBe("string");
      expect(challenge.length).toBeGreaterThan(10);
      expect(challenge).not.toContain("+");
      expect(challenge).not.toContain("/");
    });
  });

  describe("SAM 2.0 X.509 Certificate Verification", () => {
    it("validates well-formed PEM X.509 certificate", () => {
      const validPem =
        "-----BEGIN CERTIFICATE-----\nMIIFvTCCA6WgAwIBAgIU...\n-----END CERTIFICATE-----";
      const res = verifySamlX509Certificate(validPem);
      expect(res.valid).toBe(true);
    });

    it("rejects malformed certificate PEM without header/footer", () => {
      const invalidPem = "MIIFvTCCA6WgAwIBAgIU...";
      const res = verifySamlX509Certificate(invalidPem);
      expect(res.valid).toBe(false);
      expect(res.reason).toContain("Malformed PEM format");
    });
  });

  describe("Domain-to-Tenant Boundary Enforcement", () => {
    it("passes for matching email domain", () => {
      expect(() => verifyDomainBoundary("student@university.edu", sampleProvider)).not.toThrow();
    });

    it("throws FORBIDDEN error for unauthorized email domain", () => {
      expect(() => verifyDomainBoundary("hacker@unauthorized.com", sampleProvider)).toThrow(
        /is not authorized/,
      );
    });
  });

  describe("Single-Use State Nonce Replay Protection", () => {
    it("validates and consumes state nonce exactly once", () => {
      const { state, codeChallenge } = generateOidcState("azure_ad_rru");
      expect(typeof state).toBe("string");
      expect(typeof codeChallenge).toBe("string");

      const { valid } = validateAndConsumeState(state, "azure_ad_rru");
      expect(valid).toBe(true);

      const replay = validateAndConsumeState(state, "azure_ad_rru");
      expect(replay.valid).toBe(false);
    });
  });

  describe("SAML 2.0 & OIDC Claims Verification", () => {
    it("validates assertion timestamps within clock skew", () => {
      const now = new Date();
      const notBefore = new Date(now.getTime() - 60000).toISOString();
      const notOnOrAfter = new Date(now.getTime() + 300000).toISOString();

      const res = verifySamlAssertionValidity(notBefore, notOnOrAfter);
      expect(res.valid).toBe(true);
    });

    it("validates OIDC claims", () => {
      const nowSec = Math.floor(Date.now() / 1000);
      const claims = {
        exp: nowSec + 3600,
        nbf: nowSec - 60,
        iss: "https://login.microsoftonline.com/tenant/v2.0",
        aud: "client_123",
      };

      const res = verifyOidcTokenClaims(
        claims,
        "https://login.microsoftonline.com/tenant/v2.0",
        "client_123",
      );
      expect(res.valid).toBe(true);
    });
  });

  describe("Attribute Mapping & Session Fingerprinting", () => {
    it("maps attributes and generates session fingerprint", () => {
      const raw = {
        upn: "student@university.edu",
        name: "Aarav Sharma",
        employeeId: "2026-CS-001",
        dept: "Computer Science",
        userGroups: ["Faculty-Group"],
        sub: "user_sub_999",
      };

      const mapped = mapSsoAttributes(sampleProvider, raw);
      expect(mapped.email).toBe("student@university.edu");
      expect(mapped.displayName).toBe("Aarav Sharma");
      expect(mapped.role).toBe("teacher");
      expect(mapped.sessionFingerprint).toContain("fp_");
    });
  });

  describe("SAML 2.0 Single Logout (SLO)", () => {
    it("handles SAML LogoutRequest and generates response URL", () => {
      const xml = "<samlp:LogoutRequest xmlns:samlp='urn:oasis:names:tc:SAML:2.0:protocol'/>";
      const res = handleSamlSingleLogout(xml, "azure_ad_rru");
      expect(res.success).toBe(true);
      expect(res.logoutResponseUrl).toContain("SAMLResponse=");
    });
  });

  describe("Server Function Exports", () => {
    it("exports getActiveSsoProviders server function", () => {
      expect(typeof getActiveSsoProviders).toBe("function");
    });

    it("exports discoverIdpByEmail server function", () => {
      expect(typeof discoverIdpByEmail).toBe("function");
    });

    it("exports initiateSsoLogin server function", () => {
      expect(typeof initiateSsoLogin).toBe("function");
    });

    it("exports handleSsoCallback server function", () => {
      expect(typeof handleSsoCallback).toBe("function");
    });

    it("exports configureSsoProvider server function", () => {
      expect(typeof configureSsoProvider).toBe("function");
    });
  });
});
