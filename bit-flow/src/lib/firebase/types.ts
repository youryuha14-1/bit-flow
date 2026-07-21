/** Shared API contracts. The engine owns each event payload's exact fields. */
export type SpecialBlockKind = "compress" | "clear" | "slow";

export interface RoundPacket {
  index: number;
  character: string;
  ascii: number;
  bits: string;
}

export interface SpecialBlockSchedule {
  kind: SpecialBlockKind;
  dropAtMs: number;
}

export interface RoundConfig {
  seed: string;
  durationMs: number;
  packets: RoundPacket[];
  specialBlocks: SpecialBlockSchedule[];
  [key: string]: unknown;
}

export interface RoundEvent {
  type: string;
  atMs: number;
  [key: string]: unknown;
}

export interface GameState {
  score: number;
  status: "playing" | "success" | "failed";
  processedPackets: number;
  processedBits: number;
  contamination: number;
  [key: string]: unknown;
}

export interface VerifiedRound {
  roundId: string;
  uid: string;
  status: "success" | "failed";
  score: number;
  elapsedMs: number;
  remainingTimeMs: number;
  processedPackets: number;
  processedBits: number;
  contamination: number;
  specialBlocksUsed: Partial<Record<SpecialBlockKind, number>>;
  completedAt: string;
}

export interface QuizAnswer {
  questionId: string;
  answerIndex: number;
  isCorrect: boolean;
}

export interface QuizAttempt {
  id: string;
  uid: string;
  roundId: string;
  score: number;
  answers: QuizAnswer[];
  completedAt: string;
}

export interface LeaderboardEntry {
  uid: string;
  displayName: string;
  photoURL: string | null;
  score: number;
  processedPackets: number;
  achievedAt: string;
}

export interface PublicUserProfile {
  uid: string;
  displayName: string;
  photoURL: string | null;
}
