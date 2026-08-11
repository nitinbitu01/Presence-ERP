export function sanitizeNext(next: string | undefined): string | null {
  if (!next) return null;
  // Only allow same-origin relative paths (must start with "/" but not "//").
  if (!next.startsWith("/") || next.startsWith("//")) return null;
  return next;
}

export type UserRoles = {
  isAdmin?: boolean;
  isTeacher?: boolean;
  isStudent?: boolean;
  isGuardian?: boolean;
  isEmployee?: boolean;
};

export function determineDefaultDashboard(roles: UserRoles): string {
  if (roles.isAdmin) return "/admin";
  if (roles.isTeacher) return "/teacher";
  if (roles.isStudent) return "/student";
  if (roles.isGuardian) return "/parent";
  if (roles.isEmployee) return "/employee";
  return "/enroll";
}
