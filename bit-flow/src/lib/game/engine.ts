import type {
  Bit,
  BitToken,
  BufferEntry,
  BufferReason,
  DelayWindow,
  EventApplyResult,
  EventTransition,
  FailureReason,
  GameState,
  RamUsage,
  ReplayResult,
  RoundConfig,
  RoundConfigOptions,
  RoundEvent,
  SpecialKind,
  SpecialScheduleEntry,
  SpecialTokenState,
  SpecialUseCounts,
  TargetPacket,
  VerifiedRound,
} from "./types";

export const ROUND_DURATION_MS = 90_000;
export const TARGET_SLOT_CAPACITY = 8;
export const BUFFER_CAPACITY = 16;
export const TARGET_COUNT = 3;
export const BIT_INTERVAL_MS = 1_000;
// A queued bit stays valid for the full round. The UI presents one queued bit
// at a time, so expiring hidden overlapping tokens would unfairly corrupt RAM.
export const BIT_FALL_DURATION_MS = ROUND_DURATION_MS;
export const DELAY_DURATION_MS = 6_000;
export const SPECIAL_LIFETIME_MS = 10_000;

const CHARACTER_POOL = "ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789";

function hashSeed(seed: string): number {
  let hash = 2_166_136_261;
  for (let index = 0; index < seed.length; index += 1) {
    hash ^= seed.charCodeAt(index);
    hash = Math.imul(hash, 16_777_619);
  }
  return hash >>> 0;
}

function seededRandom(seed: string): () => number {
  let state = hashSeed(seed) || 1;
  return () => {
    state += 0x6d2b79f5;
    let value = state;
    value = Math.imul(value ^ (value >>> 15), value | 1);
    value ^= value + Math.imul(value ^ (value >>> 7), value | 61);
    return ((value ^ (value >>> 14)) >>> 0) / 4_294_967_296;
  };
}

function targetFromCharacter(character: string, index: number): TargetPacket {
  if (character.length !== 1 || character.charCodeAt(0) > 127) {
    throw new Error("Targets must be one ASCII character.");
  }
  const decimal = character.charCodeAt(0);
  const binary = decimal.toString(2).padStart(TARGET_SLOT_CAPACITY, "0");
  return {
    id: `packet-${index + 1}`,
    character,
    decimal,
    binary,
    bits: Array.from(binary, (value) => (value === "1" ? 1 : 0) as Bit),
  };
}

function defaultsForSpecials(): readonly SpecialScheduleEntry[] {
  return [
    { id: "special-compress", kind: "compress", spawnAtMs: 20_000, expiresAtMs: 30_000 },
    { id: "special-clear", kind: "clear", spawnAtMs: 45_000, expiresAtMs: 55_000 },
    { id: "special-delay", kind: "delay", spawnAtMs: 65_000, expiresAtMs: 75_000 },
  ];
}

/** Creates a deterministic 90-second round from a server-issued seed. */
export function createRoundConfig(
  seed: string | number,
  options: RoundConfigOptions = {},
): RoundConfig {
  const normalizedSeed = String(seed);
  const durationMs = options.durationMs ?? ROUND_DURATION_MS;
  const bitIntervalMs = options.bitIntervalMs ?? BIT_INTERVAL_MS;
  const bitFallDurationMs = options.bitFallDurationMs ?? BIT_FALL_DURATION_MS;
  if (!Number.isSafeInteger(durationMs) || durationMs <= 0) {
    throw new Error("durationMs must be a positive integer.");
  }
  if (!Number.isSafeInteger(bitIntervalMs) || bitIntervalMs <= 0) {
    throw new Error("bitIntervalMs must be a positive integer.");
  }
  if (!Number.isSafeInteger(bitFallDurationMs) || bitFallDurationMs <= 0) {
    throw new Error("bitFallDurationMs must be a positive integer.");
  }

  const random = seededRandom(normalizedSeed);
  const characters = options.targetCharacters
    ? [...options.targetCharacters]
    : Array.from({ length: TARGET_COUNT }, () =>
        CHARACTER_POOL[Math.floor(random() * CHARACTER_POOL.length)],
      );
  if (characters.length !== TARGET_COUNT) {
    throw new Error(`Exactly ${TARGET_COUNT} ASCII targets are required.`);
  }

  const targets = characters.map(targetFromCharacter);
  const packetBits = targets.flatMap((target) => target.bits);
  // Keep the receiver active for the whole round. A finite 24-bit stream made
  // the round impossible to finish after even one missed bit.
  const streamLength = Math.ceil(durationMs / bitIntervalMs);
  const stream = Array.from({ length: streamLength }, (_, index) => ({
      id: `bit-${index + 1}`,
      value: packetBits[index % packetBits.length],
      spawnAtMs: index * bitIntervalMs,
      fallDurationMs: bitFallDurationMs,
    }));
  const config: RoundConfig = {
    version: 1,
    seed: normalizedSeed,
    durationMs,
    targetSlotCapacity: TARGET_SLOT_CAPACITY,
    bufferCapacity: BUFFER_CAPACITY,
    targets,
    stream,
    specialSchedule: options.specialSchedule
      ? [...options.specialSchedule]
      : [...defaultsForSpecials()],
  };
  const errors = validateRoundConfig(config);
  if (errors.length > 0) throw new Error(`Invalid RoundConfig: ${errors.join(", ")}`);
  return config;
}

/** Structural validation for an API boundary before replaying a config. */
export function validateRoundConfig(config: RoundConfig): readonly string[] {
  const errors: string[] = [];
  if (config.version !== 1) errors.push("unsupported-version");
  if (!Number.isSafeInteger(config.durationMs) || config.durationMs <= 0) errors.push("invalid-duration");
  if (config.targetSlotCapacity !== TARGET_SLOT_CAPACITY) errors.push("invalid-target-capacity");
  if (config.bufferCapacity !== BUFFER_CAPACITY) errors.push("invalid-buffer-capacity");
  if (config.targets.length !== TARGET_COUNT) errors.push("invalid-target-count");
  if (
    config.targets.some(
      (target) =>
        target.character.length !== 1 ||
        target.decimal < 0 ||
        target.decimal > 127 ||
        target.binary.length !== TARGET_SLOT_CAPACITY ||
        target.bits.length !== TARGET_SLOT_CAPACITY ||
        target.bits.some((bit) => bit !== 0 && bit !== 1),
    )
  ) {
    errors.push("invalid-target");
  }
  const bitIds = new Set<string>();
  if (config.stream.length < TARGET_COUNT * TARGET_SLOT_CAPACITY) errors.push("incomplete-stream");
  if (
    config.stream.some(
      (token) =>
        bitIds.has(token.id) ||
        (bitIds.add(token.id), false) ||
        (token.value !== 0 && token.value !== 1) ||
        !Number.isSafeInteger(token.spawnAtMs) ||
        token.spawnAtMs < 0 ||
        !Number.isSafeInteger(token.fallDurationMs) ||
        token.fallDurationMs <= 0,
    )
  ) {
    errors.push("invalid-stream");
  }
  const kinds = new Set<SpecialKind>();
  const ids = new Set<string>();
  if (
    config.specialSchedule.some(
      (special) =>
        ids.has(special.id) ||
        kinds.has(special.kind) ||
        (ids.add(special.id), kinds.add(special.kind), false) ||
        !Number.isSafeInteger(special.spawnAtMs) ||
        !Number.isSafeInteger(special.expiresAtMs) ||
        special.spawnAtMs < 0 ||
        special.expiresAtMs <= special.spawnAtMs,
    )
  ) {
    errors.push("invalid-special-schedule");
  }
  if (!kinds.has("compress") || !kinds.has("clear") || !kinds.has("delay") || kinds.size !== 3) {
    errors.push("incomplete-special-schedule");
  }
  return errors;
}

export function createInitialGameState(config: RoundConfig): GameState {
  const errors = validateRoundConfig(config);
  if (errors.length > 0) throw new Error(`Invalid RoundConfig: ${errors.join(", ")}`);
  return {
    config,
    status: "playing",
    failureReason: null,
    elapsedMs: 0,
    score: 0,
    completionBonus: 0,
    completedAtMs: null,
    packetsCompleted: 0,
    correctBitsPlaced: 0,
    incorrectBitsPlaced: 0,
    missedBits: 0,
    targetSlots: Array.from({ length: config.targetSlotCapacity }, () => null),
    buffer: [],
    consumedBitIds: [],
    specialTokens: config.specialSchedule.map((special) => ({
      ...special,
      status: "upcoming",
      usedAtMs: null,
    })),
    specialUseCounts: { compress: 0, clear: 0, delay: 0 },
    delayWindows: [],
    flushCount: 0,
  };
}

export function getCurrentTarget(state: GameState): TargetPacket | null {
  return state.config.targets[state.packetsCompleted] ?? null;
}

export function getExpectedSlotIndex(state: GameState): number | null {
  const index = state.targetSlots.findIndex((slot) => slot === null);
  return index === -1 ? null : index;
}

export function getRamUsage(state: GameState): RamUsage {
  const targetSlotsUsed = state.targetSlots.filter((slot) => slot !== null).length;
  const bufferSlotsUsed = state.buffer.length;
  return {
    targetSlotsUsed,
    targetSlotCapacity: state.config.targetSlotCapacity,
    bufferSlotsUsed,
    bufferCapacity: state.config.bufferCapacity,
    totalUsed: targetSlotsUsed + bufferSlotsUsed,
    totalCapacity: state.config.targetSlotCapacity + state.config.bufferCapacity,
  };
}

/** Calculates falling completion with every activated delay window at 0.5x speed. */
export function getBitTokenExpirationMs(
  token: BitToken,
  delayWindows: readonly DelayWindow[],
): number {
  let progressMs = 0;
  let cursorMs = token.spawnAtMs;
  const windows = [...delayWindows]
    .filter((window) => window.endAtMs > cursorMs)
    .sort((left, right) => left.startAtMs - right.startAtMs);

  for (const window of windows) {
    const normalEnd = Math.max(cursorMs, window.startAtMs);
    const normalDuration = normalEnd - cursorMs;
    if (progressMs + normalDuration >= token.fallDurationMs) {
      return cursorMs + token.fallDurationMs - progressMs;
    }
    progressMs += normalDuration;
    cursorMs = normalEnd;

    const slowEnd = Math.max(cursorMs, window.endAtMs);
    const slowProgress = (slowEnd - cursorMs) / 2;
    if (progressMs + slowProgress >= token.fallDurationMs) {
      return cursorMs + (token.fallDurationMs - progressMs) * 2;
    }
    progressMs += slowProgress;
    cursorMs = slowEnd;
  }
  return cursorMs + token.fallDurationMs - progressMs;
}

export function getAvailableBitTokens(state: GameState): readonly BitToken[] {
  if (state.status !== "playing") return [];
  const consumed = new Set(state.consumedBitIds);
  return state.config.stream.filter(
    (token) =>
      token.spawnAtMs <= state.elapsedMs &&
      getBitTokenExpirationMs(token, state.delayWindows) > state.elapsedMs &&
      !consumed.has(token.id),
  );
}

function updateSpecials(
  tokens: readonly SpecialTokenState[],
  elapsedMs: number,
): readonly SpecialTokenState[] {
  return tokens.map((token) => {
    if (token.status === "used" || token.status === "missed") return token;
    if (elapsedMs >= token.expiresAtMs) return { ...token, status: "missed" };
    if (elapsedMs >= token.spawnAtMs) return { ...token, status: "available" };
    return token;
  });
}

function withElapsed(state: GameState, elapsedMs: number): GameState {
  return { ...state, elapsedMs, specialTokens: updateSpecials(state.specialTokens, elapsedMs) };
}

function lose(state: GameState, failureReason: FailureReason): GameState {
  return { ...state, status: "lost", failureReason };
}

function addContamination(
  state: GameState,
  token: BitToken,
  reason: BufferReason,
  atMs: number,
): GameState {
  const entry: BufferEntry = {
    id: `${token.id}:${reason}:${atMs}`,
    tokenId: token.id,
    bit: token.value,
    reason,
    recordedAtMs: atMs,
  };
  let next: GameState = {
    ...state,
    buffer: [...state.buffer, entry],
    incorrectBitsPlaced: reason === "incorrect" ? state.incorrectBitsPlaced + 1 : state.incorrectBitsPlaced,
    missedBits: reason === "missed" ? state.missedBits + 1 : state.missedBits,
  };
  const usage = getRamUsage(next);
  if (next.buffer.length >= next.config.bufferCapacity) next = lose(next, "buffer-full");
  else if (usage.totalUsed >= usage.totalCapacity) next = lose(next, "ram-full");
  return next;
}

/** Advances time, moving unclaimed falling bits to the contamination buffer. */
export function advanceGameState(state: GameState, toMs: number): GameState {
  if (!Number.isSafeInteger(toMs) || toMs <= state.elapsedMs || state.status !== "playing") return state;
  const endMs = Math.min(toMs, state.config.durationMs);
  const consumed = new Set(state.consumedBitIds);
  const expired = state.config.stream
    .filter((token) => !consumed.has(token.id) && token.spawnAtMs <= endMs)
    .map((token) => ({ token, expiresAtMs: getBitTokenExpirationMs(token, state.delayWindows) }))
    .filter(({ expiresAtMs }) => expiresAtMs > state.elapsedMs && expiresAtMs <= endMs)
    .sort((left, right) => left.expiresAtMs - right.expiresAtMs || left.token.id.localeCompare(right.token.id));

  let next = state;
  for (const { token, expiresAtMs } of expired) {
    next = addContamination(withElapsed(next, expiresAtMs), token, "missed", expiresAtMs);
    if (next.status !== "playing") return next;
  }
  next = withElapsed(next, endMs);
  return endMs >= state.config.durationMs ? lose(next, "time-expired") : next;
}

function reject(state: GameState, rejectionReason: EventApplyResult["rejectionReason"]): EventApplyResult {
  return { state, accepted: false, rejectionReason };
}

function completePacket(state: GameState, atMs: number): GameState {
  const packetsCompleted = state.packetsCompleted + 1;
  let next: GameState = {
    ...state,
    packetsCompleted,
    score: state.score + 100,
    targetSlots: Array.from({ length: state.config.targetSlotCapacity }, () => null),
  };
  if (packetsCompleted === state.config.targets.length) {
    const completionBonus = Math.floor((state.config.durationMs - atMs) / 1_000) * 2;
    next = {
      ...next,
      status: "won",
      completionBonus,
      completedAtMs: atMs,
      score: next.score + completionBonus,
    };
  }
  return next;
}

function applySpecial(state: GameState, special: SpecialTokenState, atMs: number): GameState {
  const specialTokens = state.specialTokens.map((candidate) =>
    candidate.id === special.id ? { ...candidate, status: "used" as const, usedAtMs: atMs } : candidate,
  );
  const specialUseCounts: SpecialUseCounts = {
    ...state.specialUseCounts,
    [special.kind]: state.specialUseCounts[special.kind] + 1,
  };
  let next: GameState = { ...state, specialTokens, specialUseCounts };
  if (special.kind === "compress") next = { ...next, buffer: next.buffer.filter((_, index) => index % 2 === 0) };
  if (special.kind === "clear") next = { ...next, buffer: [] };
  if (special.kind === "delay") {
    next = {
      ...next,
      delayWindows: [...next.delayWindows, { startAtMs: atMs, endAtMs: Math.min(state.config.durationMs, atMs + DELAY_DURATION_MS) }],
    };
  }
  return next;
}

/** Applies exactly one deterministic player event. */
export function applyRoundEvent(state: GameState, event: RoundEvent): EventApplyResult {
  const atMs = event.atMs;
  if (!Number.isSafeInteger(atMs) || atMs < 0) return reject(state, "invalid-timestamp");
  if (atMs < state.elapsedMs) return reject(state, "time-regression");
  if (atMs > state.config.durationMs) return reject(advanceGameState(state, state.config.durationMs), "after-round-end");

  const advanced = advanceGameState(state, atMs);
  if (advanced.status !== "playing") return reject(advanced, "round-complete");

  if (event.type === "tick") return { state: advanced, accepted: true };
  if (event.type === "flush") {
    return {
      accepted: true,
      state: {
        ...advanced,
        score: advanced.score - 50,
        targetSlots: Array.from({ length: advanced.config.targetSlotCapacity }, () => null),
        buffer: [],
        flushCount: advanced.flushCount + 1,
      },
    };
  }
  if (event.type === "useSpecial") {
    const special = advanced.specialTokens.find(
      (candidate) => candidate.id === event.specialId && candidate.status === "available",
    );
    return special
      ? { state: applySpecial(advanced, special, atMs), accepted: true }
      : reject(advanced, "special-not-available");
  }

  const token = getAvailableBitTokens(advanced).find((candidate) => candidate.id === event.tokenId);
  if (!token) return reject(advanced, "bit-not-available");

  const consumed: GameState = { ...advanced, consumedBitIds: [...advanced.consumedBitIds, token.id] };
  const expectedSlotIndex = getExpectedSlotIndex(consumed);
  const target = getCurrentTarget(consumed);
  const correct =
    target !== null &&
    expectedSlotIndex !== null &&
    event.slotIndex === expectedSlotIndex &&
    target.bits[expectedSlotIndex] === token.value;

  if (!correct) return { state: addContamination(consumed, token, "incorrect", atMs), accepted: true };

  const targetSlots = [...consumed.targetSlots];
  targetSlots[event.slotIndex] = token.value;
  const placed: GameState = {
    ...consumed,
    targetSlots,
    correctBitsPlaced: consumed.correctBitsPlaced + 1,
    score: consumed.score + 10,
  };
  return {
    accepted: true,
    state: targetSlots.every((slot) => slot !== null) ? completePacket(placed, atMs) : placed,
  };
}

export function finalizeRound(state: GameState): GameState {
  return advanceGameState(state, state.config.durationMs);
}

export function replayRound(config: RoundConfig, events: readonly RoundEvent[]): ReplayResult {
  let state = createInitialGameState(config);
  const transitions: EventTransition[] = [];
  events.forEach((event, eventIndex) => {
    const result = applyRoundEvent(state, event);
    state = result.state;
    transitions.push({
      eventIndex,
      event,
      accepted: result.accepted,
      rejectionReason: result.rejectionReason,
      elapsedMs: state.elapsedMs,
      score: state.score,
      status: state.status,
    });
  });
  return { state: finalizeRound(state), transitions };
}

/** Replays an event trace and returns only engine-derived score/outcome fields. */
export function verifyRound(config: RoundConfig, events: readonly RoundEvent[]): VerifiedRound {
  if (validateRoundConfig(config).length > 0) {
    const fallback = createInitialGameState(createRoundConfig("invalid"));
    return {
      isValid: false,
      isSuccessful: false,
      errors: ["invalid-config"],
      status: fallback.status,
      failureReason: fallback.failureReason,
      score: 0,
      completionBonus: 0,
      completedAtMs: null,
      elapsedMs: 0,
      packetsCompleted: 0,
      correctBitsPlaced: 0,
      incorrectBitsPlaced: 0,
      missedBits: 0,
      bufferEntries: 0,
      specialUseCounts: fallback.specialUseCounts,
      flushCount: 0,
      transitions: [],
      finalState: fallback,
    };
  }

  const replay = replayRound(config, events);
  const rejected = replay.transitions.some((transition) => !transition.accepted);
  const state = replay.state;
  return {
    isValid: !rejected,
    isSuccessful: !rejected && state.status === "won",
    errors: rejected ? ["rejected-event"] : [],
    status: state.status,
    failureReason: state.failureReason,
    score: state.score,
    completionBonus: state.completionBonus,
    completedAtMs: state.completedAtMs,
    elapsedMs: state.elapsedMs,
    packetsCompleted: state.packetsCompleted,
    correctBitsPlaced: state.correctBitsPlaced,
    incorrectBitsPlaced: state.incorrectBitsPlaced,
    missedBits: state.missedBits,
    bufferEntries: state.buffer.length,
    specialUseCounts: state.specialUseCounts,
    flushCount: state.flushCount,
    transitions: replay.transitions,
    finalState: state,
  };
}

