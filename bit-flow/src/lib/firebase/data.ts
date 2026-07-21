"use client";

import {
  equalTo,
  get,
  limitToLast,
  orderByChild,
  query,
  ref,
  runTransaction,
  update,
  type Database,
  type DataSnapshot,
} from "firebase/database";

import { getFirebaseClient } from "./client";
import { createRoundConfig, verifyRound, type RoundConfig, type RoundEvent } from "@/lib/game";
import type {
  LeaderboardEntry,
  PublicUserProfile,
  QuizAnswer,
  QuizAttempt,
  SpecialBlockKind,
  VerifiedRound,
} from "./types";

export class RoundConflictError extends Error {
  constructor(readonly code: "ROUND_NOT_FOUND" | "ROUND_ALREADY_SUBMITTED") {
    super(code === "ROUND_NOT_FOUND" ? "The round was not found." : "The round has already been submitted.");
    this.name = "RoundConflictError";
  }
}

interface RoundRecord {
  uid: string;
  issuedAt: string;
  submissionState: "issued" | "submitted";
  config: RoundConfig;
  completedAt?: string;
  events?: readonly RoundEvent[];
  verified?: VerifiedRound;
}

export interface QuizAttemptInput {
  score: number;
  answers: readonly QuizAnswer[];
}

function requireDb(): Database {
  const db = getFirebaseClient()?.db;
  if (!db) throw new Error("Firebase is not configured. Add the public Firebase environment variables first.");
  return db;
}

function kstDay(date = new Date()): string {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: "Asia/Seoul",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(date);
  const part = (type: string) => parts.find((entry) => entry.type === type)?.value;
  return `${part("year")}-${part("month")}-${part("day")}`;
}

function specialCounts(value: { compress: number; clear: number; delay: number }): Partial<Record<SpecialBlockKind, number>> {
  return { compress: value.compress, clear: value.clear, slow: value.delay };
}

function normalizeVerifiedRound(
  result: ReturnType<typeof verifyRound>,
  roundId: string,
  uid: string,
  durationMs: number,
): VerifiedRound {
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

function asEntry(data: Record<string, unknown>): LeaderboardEntry {
  return {
    uid: String(data.uid),
    displayName: typeof data.displayName === "string" ? data.displayName : "Bit Flow Player",
    photoURL: typeof data.photoURL === "string" ? data.photoURL : null,
    score: typeof data.score === "number" ? data.score : 0,
    processedPackets: typeof data.processedPackets === "number" ? data.processedPackets : 0,
    achievedAt: typeof data.achievedAt === "string" ? data.achievedAt : "",
  };
}

function toIdArray(snapshot: DataSnapshot): Record<string, unknown>[] {
  const data = (snapshot.val() as Record<string, Record<string, unknown>> | null) ?? {};
  return Object.entries(data).map(([id, value]) => ({ id, ...value }));
}

export async function startRound(
  user: PublicUserProfile,
): Promise<{ roundId: string; issuedAt: string; seed: string; config: RoundConfig }> {
  const db = requireDb();
  const roundId = crypto.randomUUID();
  const seed = crypto.randomUUID();
  const config = createRoundConfig(seed);
  const issuedAt = new Date().toISOString();

  await update(ref(db, `users/${user.uid}`), { ...user, updatedAt: issuedAt });

  const record: RoundRecord = { uid: user.uid, issuedAt, submissionState: "issued", config };
  const result = await runTransaction(ref(db, `rounds/${roundId}`), (current: RoundRecord | null) =>
    current === null ? record : undefined,
  );
  if (!result.committed) throw new Error(`Round id already exists: ${roundId}`);

  return { roundId, issuedAt, seed, config };
}

export async function submitRound(
  user: PublicUserProfile,
  roundId: string,
  events: readonly RoundEvent[],
): Promise<{ verified: VerifiedRound }> {
  const db = requireDb();
  const roundRef = ref(db, `rounds/${roundId}`);

  const issuedSnapshot = await get(roundRef);
  const issued = issuedSnapshot.val() as RoundRecord | null;
  if (issued === null || issued.uid !== user.uid) throw new RoundConflictError("ROUND_NOT_FOUND");
  if (issued.submissionState === "submitted") throw new RoundConflictError("ROUND_ALREADY_SUBMITTED");

  const replay = verifyRound(issued.config, events);
  if (!replay.isValid) throw new Error(`Round replay rejected an event: ${replay.errors.join(", ")}`);
  const verified = normalizeVerifiedRound(replay, roundId, user.uid, issued.config.durationMs);

  const transactionResult = await runTransaction(roundRef, (current: RoundRecord | null) => {
    if (current === null || current.uid !== user.uid) return undefined;
    if (current.submissionState === "submitted") return undefined;
    return { ...current, submissionState: "submitted", completedAt: verified.completedAt, events, verified };
  });

  if (!transactionResult.committed) {
    const existing = transactionResult.snapshot.val() as RoundRecord | null;
    if (existing === null || existing.uid !== user.uid) throw new RoundConflictError("ROUND_NOT_FOUND");
    throw new RoundConflictError("ROUND_ALREADY_SUBMITTED");
  }

  if (verified.status === "success") {
    const boards = ["all", `today-${kstDay(new Date(verified.completedAt))}`];
    const entry: LeaderboardEntry = {
      uid: user.uid,
      displayName: user.displayName,
      photoURL: user.photoURL,
      score: verified.score,
      processedPackets: verified.processedPackets,
      achievedAt: verified.completedAt,
    };

    // RTDB transactions are per-node, so this is not atomic with the round write above.
    await Promise.all(
      boards.map((board) =>
        runTransaction(ref(db, `leaderboards/${board}/entries/${user.uid}`), (current: LeaderboardEntry | null) => {
          if (current && typeof current.score === "number" && current.score >= entry.score) return undefined;
          return entry;
        }),
      ),
    );
  }

  return { verified };
}

export async function submitQuizAttempt(
  user: PublicUserProfile,
  roundId: string,
  attempt: QuizAttemptInput,
): Promise<QuizAttempt> {
  const db = requireDb();
  const record: QuizAttempt = {
    id: roundId,
    uid: user.uid,
    roundId,
    score: attempt.score,
    answers: [...attempt.answers],
    completedAt: new Date().toISOString(),
  };
  await update(ref(db, `quizAttempts/${record.id}`), record);
  return record;
}

export async function fetchLeaderboard(scope: "today" | "all", limit: number): Promise<LeaderboardEntry[]> {
  const db = requireDb();
  const board = scope === "today" ? `today-${kstDay()}` : "all";
  const snapshot = await get(query(ref(db, `leaderboards/${board}/entries`), orderByChild("score"), limitToLast(limit)));
  const data = (snapshot.val() as Record<string, Record<string, unknown>> | null) ?? {};
  return Object.values(data)
    .map(asEntry)
    .sort((a, b) => b.score - a.score);
}

export async function fetchAccountData(
  uid: string,
  limit: number,
): Promise<{ rounds: Record<string, unknown>[]; quizAttempts: Record<string, unknown>[] }> {
  const db = requireDb();
  const [roundsSnapshot, quizAttemptsSnapshot] = await Promise.all([
    get(query(ref(db, "rounds"), orderByChild("uid"), equalTo(uid))),
    get(query(ref(db, "quizAttempts"), orderByChild("uid"), equalTo(uid))),
  ]);
  const byNewest = (left: Record<string, unknown>, right: Record<string, unknown>) =>
    String(right.completedAt ?? right.issuedAt ?? "").localeCompare(String(left.completedAt ?? left.issuedAt ?? ""));
  return {
    rounds: toIdArray(roundsSnapshot).sort(byNewest).slice(0, limit),
    quizAttempts: toIdArray(quizAttemptsSnapshot).sort(byNewest).slice(0, limit),
  };
}

export async function deleteAccountData(uid: string): Promise<{ rounds: number; quizAttempts: number }> {
  const db = requireDb();
  const [roundsSnapshot, quizAttemptsSnapshot, leaderboardsSnapshot] = await Promise.all([
    get(query(ref(db, "rounds"), orderByChild("uid"), equalTo(uid))),
    get(query(ref(db, "quizAttempts"), orderByChild("uid"), equalTo(uid))),
    get(ref(db, "leaderboards")),
  ]);

  const roundIds = Object.keys((roundsSnapshot.val() as Record<string, unknown> | null) ?? {});
  const quizAttemptIds = Object.keys((quizAttemptsSnapshot.val() as Record<string, unknown> | null) ?? {});
  const boardIds = Object.keys((leaderboardsSnapshot.val() as Record<string, unknown> | null) ?? {});

  const updates: Record<string, null> = {};
  roundIds.forEach((id) => {
    updates[`rounds/${id}`] = null;
  });
  quizAttemptIds.forEach((id) => {
    updates[`quizAttempts/${id}`] = null;
  });
  boardIds.forEach((boardId) => {
    updates[`leaderboards/${boardId}/entries/${uid}`] = null;
  });
  updates[`users/${uid}`] = null;

  await update(ref(db), updates);
  return { rounds: roundIds.length, quizAttempts: quizAttemptIds.length };
}
