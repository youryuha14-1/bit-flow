import { NextResponse } from "next/server";

import { verifyRound, type RoundEvent } from "@/lib/game";
import {
  ApiError,
  apiErrorResponse,
  isRecord,
  readJsonObject,
  requireAuthenticatedUser,
  requireString,
} from "@/lib/firebase/http";
import { getIssuedRound, persistVerifiedRound, SubmissionConflictError } from "@/lib/firebase/store";
import type { SpecialBlockKind, VerifiedRound } from "@/lib/firebase/types";

export const runtime = "nodejs";

const MAX_EVENTS = 1_024;
const ALLOWED_EVENT_TYPES = new Set(["placeBit", "flush", "useSpecial", "tick"]);

function specialCounts(value: { compress: number; clear: number; delay: number }): Partial<Record<SpecialBlockKind, number>> {
  return { compress: value.compress, clear: value.clear, slow: value.delay };
}

function parseEvents(value: unknown, durationMs: number, issuedAt: string): RoundEvent[] {
  if (!Array.isArray(value) || value.length > MAX_EVENTS) {
    throw new ApiError(400, "INVALID_EVENTS", `events must contain at most ${MAX_EVENTS} records.`);
  }

  let previousAtMs = -1;
  for (const event of value) {
    if (!isRecord(event) || !ALLOWED_EVENT_TYPES.has(String(event.type))) {
      throw new ApiError(400, "INVALID_EVENT", "? ? ?? ?? ???? ???? ????.");
    }
    if (typeof event.atMs !== "number" || !Number.isSafeInteger(event.atMs) || event.atMs < 0 || event.atMs > durationMs) {
      throw new ApiError(400, "INVALID_EVENT_TIME", "??? ??? ?? ??? ??????.");
    }
    if (event.atMs < previousAtMs) {
      throw new ApiError(400, "INVALID_EVENT_TIME", "??? ??? ???? ????? ???.");
    }
    previousAtMs = event.atMs;
  }

  const startedAtMs = Date.parse(issuedAt);
  const elapsedOnServer = Number.isFinite(startedAtMs) ? Date.now() - startedAtMs : durationMs;
  if (elapsedOnServer > durationMs + 8_000) {
    throw new ApiError(400, "ROUND_EXPIRED", "?? ??? ?? ??? ?????.");
  }
  if (previousAtMs > elapsedOnServer + 2_500) {
    throw new ApiError(400, "IMPOSSIBLE_TIMELINE", "?? ???? ?? ?? ???? ??? ? ????.");
  }
  return value as RoundEvent[];
}

function normalizeVerifiedRound(
  result: ReturnType<typeof verifyRound>,
  roundId: string,
  uid: string,
  durationMs: number,
): VerifiedRound {
  if (!result.isValid) {
    throw new ApiError(400, "ROUND_VERIFICATION_FAILED", "??? ?? ??? ???? ?????.", {
      reasons: result.errors,
    });
  }
  if (!Number.isSafeInteger(result.score) || !Number.isSafeInteger(result.elapsedMs) || !Number.isSafeInteger(result.packetsCompleted)) {
    throw new ApiError(400, "INVALID_VERIFICATION", "?? ??? ???? ?? ??? ???? ????.");
  }
  if (result.score < -10_000 || result.score > 10_000 || result.elapsedMs < 0 || result.elapsedMs > durationMs) {
    throw new ApiError(400, "INVALID_VERIFICATION", "?? ??? ?? ??? ??? ??????.");
  }

  return {
    roundId,
    uid,
    status: result.isSuccessful ? "success" : "failed",
    score: result.score,
    elapsedMs: result.elapsedMs,
    remainingTimeMs: Math.max(0, durationMs - result.elapsedMs),
    processedPackets: result.packetsCompleted,
    processedBits: result.correctBitsPlaced,
    contamination: result.bufferEntries,
    specialBlocksUsed: specialCounts(result.specialUseCounts),
    completedAt: new Date().toISOString(),
  };
}

export async function POST(request: Request): Promise<NextResponse> {
  try {
    const user = await requireAuthenticatedUser(request);
    const body = await readJsonObject(request);
    const roundId = requireString(body.roundId, "roundId");
    const issued = await getIssuedRound(roundId, user.uid);
    if (issued.submissionState === "submitted") throw new SubmissionConflictError("ROUND_ALREADY_SUBMITTED");
    if (!isRecord(issued.config) || typeof issued.config.durationMs !== "number") {
      throw new ApiError(500, "ROUND_CONFIG_INVALID", "??? ?? ??? ?? ? ????.");
    }

    const events = parseEvents(body.events, issued.config.durationMs, issued.issuedAt);
    const result = verifyRound(issued.config as unknown as Parameters<typeof verifyRound>[0], events);
    const verified = normalizeVerifiedRound(result, roundId, user.uid, issued.config.durationMs);
    await persistVerifiedRound({ roundId, user, events, verified });
    return NextResponse.json({ verified });
  } catch (error) {
    if (error instanceof SubmissionConflictError) {
      return apiErrorResponse(new ApiError(error.code === "ROUND_NOT_FOUND" ? 404 : 409, error.code, error.message));
    }
    return apiErrorResponse(error);
  }
}
