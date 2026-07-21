import "server-only";

import type { DocumentData, DocumentReference } from "firebase-admin/firestore";

import { getFirebaseAdmin } from "./admin";
import type {
  LeaderboardEntry,
  PublicUserProfile,
  QuizAttempt,
  RoundEvent,
  VerifiedRound,
} from "./types";

export class SubmissionConflictError extends Error {
  constructor(readonly code: "ROUND_NOT_FOUND" | "ROUND_ALREADY_SUBMITTED") {
    super(code === "ROUND_NOT_FOUND" ? "The round was not found." : "The round has already been submitted.");
    this.name = "SubmissionConflictError";
  }
}

export interface IssuedRound {
  id: string;
  uid: string;
  issuedAt: string;
  config: unknown;
  submissionState: "issued" | "submitted";
}

export interface RoundPersistenceInput {
  roundId: string;
  user: PublicUserProfile;
  events: readonly RoundEvent[];
  verified: VerifiedRound;
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

function asEntry(data: DocumentData): LeaderboardEntry {
  return {
    uid: String(data.uid),
    displayName: typeof data.displayName === "string" ? data.displayName : "Bit Flow ????",
    photoURL: typeof data.photoURL === "string" ? data.photoURL : null,
    score: typeof data.score === "number" ? data.score : 0,
    processedPackets: typeof data.processedPackets === "number" ? data.processedPackets : 0,
    achievedAt: typeof data.achievedAt === "string" ? data.achievedAt : "",
  };
}

export async function saveUserProfile(user: PublicUserProfile): Promise<void> {
  await getFirebaseAdmin().db.collection("users").doc(user.uid).set(
    { ...user, updatedAt: new Date().toISOString() },
    { merge: true },
  );
}

export async function issueRound(
  roundId: string,
  user: PublicUserProfile,
  config: unknown,
): Promise<{ roundId: string; issuedAt: string }> {
  const issuedAt = new Date().toISOString();
  const { db } = getFirebaseAdmin();
  await saveUserProfile(user);
  await db.collection("rounds").doc(roundId).create({
    uid: user.uid,
    issuedAt,
    submissionState: "issued",
    config: config as DocumentData,
  });
  return { roundId, issuedAt };
}

export async function getIssuedRound(roundId: string, uid: string): Promise<IssuedRound> {
  const snapshot = await getFirebaseAdmin().db.collection("rounds").doc(roundId).get();
  if (!snapshot.exists || snapshot.data()?.uid !== uid) throw new SubmissionConflictError("ROUND_NOT_FOUND");
  const data = snapshot.data()!;
  return {
    id: snapshot.id,
    uid,
    issuedAt: typeof data.issuedAt === "string" ? data.issuedAt : "",
    config: data.config,
    submissionState: data.submissionState === "submitted" ? "submitted" : "issued",
  };
}

export async function persistVerifiedRound(input: RoundPersistenceInput): Promise<void> {
  const { db } = getFirebaseAdmin();
  const roundRef = db.collection("rounds").doc(input.roundId);
  const boards = input.verified.status === "success" ? ["all", `today-${kstDay(new Date(input.verified.completedAt))}`] : [];

  const boardRefs = boards.map((board) => db.collection("leaderboards").doc(board));
  const boardEntryRefs = boardRefs.map((boardRef) =>
    boardRef.collection("entries").doc(input.user.uid),
  );

  await db.runTransaction(async (transaction) => {
    // Firestore requires every transaction read to finish before its first write.
    const [roundSnapshot, ...existingEntries] = await Promise.all([
      transaction.get(roundRef),
      ...boardEntryRefs.map((entryRef) => transaction.get(entryRef)),
    ]);
    if (!roundSnapshot.exists || roundSnapshot.data()?.uid !== input.user.uid) throw new SubmissionConflictError("ROUND_NOT_FOUND");
    if (roundSnapshot.data()?.submissionState === "submitted") throw new SubmissionConflictError("ROUND_ALREADY_SUBMITTED");

    transaction.set(
      roundRef,
      {
        submissionState: "submitted",
        completedAt: input.verified.completedAt,
        events: input.events,
        verified: input.verified,
      },
      { merge: true },
    );

    if (input.verified.status !== "success") return;
    boardRefs.forEach((boardRef) => {
      transaction.set(boardRef, { updatedAt: input.verified.completedAt }, { merge: true });
    });
    const entry: LeaderboardEntry = {
      uid: input.user.uid,
      displayName: input.user.displayName,
      photoURL: input.user.photoURL,
      score: input.verified.score,
      processedPackets: input.verified.processedPackets,
      achievedAt: input.verified.completedAt,
    };
    boardEntryRefs.forEach((entryRef, index) => {
      const existing = existingEntries[index];
      const existingScore = existing.exists && typeof existing.data()?.score === "number" ? existing.data()!.score : -1;
      if (entry.score > existingScore) transaction.set(entryRef, entry);
    });
  });
}

export async function getLeaderboard(scope: "today" | "all", limit: number): Promise<LeaderboardEntry[]> {
  const board = scope === "today" ? `today-${kstDay()}` : "all";
  const snapshot = await getFirebaseAdmin().db.collection("leaderboards").doc(board).collection("entries")
    .orderBy("score", "desc").limit(limit).get();
  return snapshot.docs.map((entry) => asEntry(entry.data()));
}

export async function saveQuizAttempt(attempt: QuizAttempt): Promise<QuizAttempt> {
  const { db } = getFirebaseAdmin();
  const round = await db.collection("rounds").doc(attempt.roundId).get();
  if (!round.exists || round.data()?.uid !== attempt.uid || round.data()?.submissionState !== "submitted") {
    throw new SubmissionConflictError("ROUND_NOT_FOUND");
  }
  const ref = db.collection("quizAttempts").doc(attempt.id);
  const existing = await ref.get();
  if (existing.exists) return existing.data() as QuizAttempt;
  await ref.create(attempt);
  return attempt;
}

export async function getAccountData(uid: string, limit: number): Promise<{ rounds: DocumentData[]; quizAttempts: DocumentData[] }> {
  const { db } = getFirebaseAdmin();
  const [rounds, quizAttempts] = await Promise.all([
    db.collection("rounds").where("uid", "==", uid).limit(limit).get(),
    db.collection("quizAttempts").where("uid", "==", uid).limit(limit).get(),
  ]);
  const byNewest = (left: DocumentData, right: DocumentData) =>
    String(right.completedAt ?? right.issuedAt ?? "").localeCompare(String(left.completedAt ?? left.issuedAt ?? ""));
  return {
    rounds: rounds.docs.map((entry) => ({ id: entry.id, ...entry.data() })).sort(byNewest),
    quizAttempts: quizAttempts.docs.map((entry) => ({ id: entry.id, ...entry.data() })).sort(byNewest),
  };
}

async function deleteInBatches(refs: DocumentReference[]): Promise<void> {
  const { db } = getFirebaseAdmin();
  for (let index = 0; index < refs.length; index += 450) {
    const batch = db.batch();
    refs.slice(index, index + 450).forEach((ref) => batch.delete(ref));
    await batch.commit();
  }
}

export async function deleteAccountData(uid: string): Promise<{ rounds: number; quizAttempts: number }> {
  const { db } = getFirebaseAdmin();
  const [rounds, quizAttempts, boards] = await Promise.all([
    db.collection("rounds").where("uid", "==", uid).get(),
    db.collection("quizAttempts").where("uid", "==", uid).get(),
    db.collection("leaderboards").get(),
  ]);
  const refs: DocumentReference[] = [
    ...rounds.docs.map((entry) => entry.ref),
    ...quizAttempts.docs.map((entry) => entry.ref),
    ...boards.docs.map((board) => board.ref.collection("entries").doc(uid)),
    db.collection("users").doc(uid),
  ];
  await deleteInBatches(refs);
  return { rounds: rounds.size, quizAttempts: quizAttempts.size };
}
