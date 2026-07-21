export type Bit = 0 | 1;

export type GameStatus = "playing" | "won" | "lost";
export type FailureReason = "buffer-full" | "ram-full" | "time-expired";
export type BufferReason = "incorrect" | "missed";
export type SpecialKind = "compress" | "clear" | "delay";
export type SpecialTokenStatus = "upcoming" | "available" | "used" | "missed";

export interface TargetPacket {
  readonly id: string;
  readonly character: string;
  readonly decimal: number;
  readonly binary: string;
  readonly bits: readonly Bit[];
}

export interface BitToken {
  readonly id: string;
  readonly value: Bit;
  readonly spawnAtMs: number;
  readonly fallDurationMs: number;
}

export interface SpecialScheduleEntry {
  readonly id: string;
  readonly kind: SpecialKind;
  readonly spawnAtMs: number;
  readonly expiresAtMs: number;
}

export interface RoundConfig {
  readonly version: 1;
  readonly seed: string;
  readonly durationMs: number;
  readonly targetSlotCapacity: number;
  readonly bufferCapacity: number;
  readonly targets: readonly TargetPacket[];
  readonly stream: readonly BitToken[];
  readonly specialSchedule: readonly SpecialScheduleEntry[];
}

export interface RoundConfigOptions {
  readonly durationMs?: number;
  readonly targetCharacters?: readonly string[];
  readonly bitIntervalMs?: number;
  readonly bitFallDurationMs?: number;
  readonly specialSchedule?: readonly SpecialScheduleEntry[];
}

export type RoundEvent =
  | {
      readonly type: "placeBit";
      readonly atMs: number;
      readonly tokenId: string;
      readonly slotIndex: number;
    }
  | { readonly type: "flush"; readonly atMs: number }
  | { readonly type: "useSpecial"; readonly atMs: number; readonly specialId: string }
  | { readonly type: "tick"; readonly atMs: number };

export interface BufferEntry {
  readonly id: string;
  readonly tokenId: string;
  readonly bit: Bit;
  readonly reason: BufferReason;
  readonly recordedAtMs: number;
}

export interface SpecialTokenState extends SpecialScheduleEntry {
  readonly status: SpecialTokenStatus;
  readonly usedAtMs: number | null;
}

export interface DelayWindow {
  readonly startAtMs: number;
  readonly endAtMs: number;
}

export interface SpecialUseCounts {
  readonly compress: number;
  readonly clear: number;
  readonly delay: number;
}

export interface GameState {
  readonly config: RoundConfig;
  readonly status: GameStatus;
  readonly failureReason: FailureReason | null;
  readonly elapsedMs: number;
  readonly score: number;
  readonly completionBonus: number;
  readonly completedAtMs: number | null;
  readonly packetsCompleted: number;
  readonly correctBitsPlaced: number;
  readonly incorrectBitsPlaced: number;
  readonly missedBits: number;
  readonly targetSlots: readonly (Bit | null)[];
  readonly buffer: readonly BufferEntry[];
  readonly consumedBitIds: readonly string[];
  readonly specialTokens: readonly SpecialTokenState[];
  readonly specialUseCounts: SpecialUseCounts;
  readonly delayWindows: readonly DelayWindow[];
  readonly flushCount: number;
}

export type EventRejectionReason =
  | "invalid-timestamp"
  | "time-regression"
  | "after-round-end"
  | "round-complete"
  | "bit-not-available"
  | "special-not-available";

export interface EventApplyResult {
  readonly state: GameState;
  readonly accepted: boolean;
  readonly rejectionReason?: EventRejectionReason;
}

export interface EventTransition {
  readonly eventIndex: number;
  readonly event: RoundEvent;
  readonly accepted: boolean;
  readonly rejectionReason?: EventRejectionReason;
  readonly elapsedMs: number;
  readonly score: number;
  readonly status: GameStatus;
}

export interface ReplayResult {
  readonly state: GameState;
  readonly transitions: readonly EventTransition[];
}

export type VerificationError = "invalid-config" | "rejected-event";

export interface VerifiedRound {
  readonly isValid: boolean;
  readonly isSuccessful: boolean;
  readonly errors: readonly VerificationError[];
  readonly status: GameStatus;
  readonly failureReason: FailureReason | null;
  readonly score: number;
  readonly completionBonus: number;
  readonly completedAtMs: number | null;
  readonly elapsedMs: number;
  readonly packetsCompleted: number;
  readonly correctBitsPlaced: number;
  readonly incorrectBitsPlaced: number;
  readonly missedBits: number;
  readonly bufferEntries: number;
  readonly specialUseCounts: SpecialUseCounts;
  readonly flushCount: number;
  readonly transitions: readonly EventTransition[];
  readonly finalState: GameState;
}

export interface RamUsage {
  readonly targetSlotsUsed: number;
  readonly targetSlotCapacity: number;
  readonly bufferSlotsUsed: number;
  readonly bufferCapacity: number;
  readonly totalUsed: number;
  readonly totalCapacity: number;
}

