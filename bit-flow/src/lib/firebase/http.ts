import "server-only";

import { NextResponse } from "next/server";

import { FirebaseConfigurationError, getFirebaseAdmin } from "./admin";
import type { PublicUserProfile } from "./types";

export class ApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
    readonly details?: Record<string, unknown>,
  ) {
    super(message);
    this.name = "ApiError";
  }
}

export interface AuthenticatedUser extends PublicUserProfile {
  email: string | null;
}

export async function requireAuthenticatedUser(request: Request): Promise<AuthenticatedUser> {
  const match = request.headers.get("authorization")?.match(/^Bearer\s+(.+)$/i);
  if (!match) throw new ApiError(401, "UNAUTHENTICATED", "Google ???? ?????.");

  try {
    const decoded = await getFirebaseAdmin().auth.verifyIdToken(match[1]);
    if (decoded.firebase.sign_in_provider !== "google.com") {
      throw new ApiError(403, "GOOGLE_LOGIN_REQUIRED", "Google ???? ?????.");
    }
    return {
      uid: decoded.uid,
      displayName: decoded.name?.trim() || "Bit Flow ????",
      photoURL: decoded.picture ?? null,
      email: decoded.email ?? null,
    };
  } catch (error) {
    if (error instanceof FirebaseConfigurationError) throw error;
    if (error instanceof ApiError) throw error;
    throw new ApiError(401, "INVALID_TOKEN", "??? ??? ??? ? ????.");
  }
}

export function apiErrorResponse(error: unknown): NextResponse {
  if (error instanceof FirebaseConfigurationError) {
    return NextResponse.json(
      { error: { code: "FIREBASE_NOT_CONFIGURED", message: "Firebase ?? ??? ?????.", missing: error.missing } },
      { status: 503 },
    );
  }
  if (error instanceof ApiError) {
    return NextResponse.json(
      { error: { code: error.code, message: error.message, details: error.details } },
      { status: error.status },
    );
  }
  console.error("Unexpected Bit Flow API error", error);
  return NextResponse.json(
    { error: { code: "INTERNAL_ERROR", message: "??? ???? ? ??? ??????." } },
    { status: 500 },
  );
}

export async function readJsonObject(request: Request): Promise<Record<string, unknown>> {
  try {
    const body: unknown = await request.json();
    if (!isRecord(body)) throw new ApiError(400, "INVALID_BODY", "JSON ?? ??? ?????.");
    return body;
  } catch (error) {
    if (error instanceof ApiError) throw error;
    throw new ApiError(400, "INVALID_JSON", "??? JSON ??? ?????.");
  }
}

export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function requireString(value: unknown, field: string): string {
  if (typeof value !== "string" || !value.trim()) {
    throw new ApiError(400, "INVALID_FIELD", `${field} ?? ?????.`, { field });
  }
  return value.trim();
}
