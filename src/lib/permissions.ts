import type { UserRole } from "./types";

// Document permissions
export function canViewDocuments(_role: UserRole): boolean { return true; }
export function canUploadDocuments(_role: UserRole): boolean { return true; }
export function canDeleteDocuments(role: UserRole): boolean { return role === "admin" || role === "manager"; }
export function canDeleteDocument(role: UserRole): boolean { return role === "admin" || role === "manager"; }
export function canSuggestDelete(role: UserRole): boolean { return role === "agent" || role === "member"; }

// Team permissions
export function canManageTeam(role: UserRole): boolean { return role === "admin" || role === "manager"; }
export function canChangeRoles(role: UserRole): boolean { return role === "admin"; }
export function canApproveDeletions(role: UserRole): boolean { return role === "admin" || role === "manager"; }

// MPF Care permissions
export function canTriggerMpfRefresh(role: UserRole): boolean { return role === "admin" || role === "manager"; }
export function canUploadMpfData(role: UserRole): boolean { return role === "admin"; }
export function canGenerateInsight(role: UserRole): boolean { return role === "admin" || role === "manager"; }
