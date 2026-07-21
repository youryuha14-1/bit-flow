"use client";

import { useEffect, useRef, useState } from "react";
import {
  applyRoundEvent,
  createInitialGameState,
  createRoundConfig,
  getAvailableBitTokens,
  getCurrentTarget,
  getExpectedSlotIndex,
  getRamUsage,
} from "@/lib/game";
import type { GameState, RoundConfig, RoundEvent } from "@/lib/game";
import styles from "./BitFlowApp.module.css";

type Screen = "home" | "game" | "result" | "quiz" | "board";
type User = { uid: string; displayName: string | null };
type Entry = { name: string; score: number; packets: number };
type Answer = { questionId: string; answerIndex: number };

const quiz = [
  ["byte", "1바이트(Byte)는 몇 비트(Bit)일까요?", ["4비트", "8비트", "16비트", "32비트"], 1],
  ["volatile", "전원을 끄면 RAM 데이터가 사라지는 이유는 무엇일까요?", ["RAM은 휘발성 메모리이기 때문", "CPU가 데이터를 숨기기 때문", "비트가 자동 압축되기 때문", "HDD가 RAM을 비우기 때문"], 0],
  ["binary", "01000001은 어떤 문자와 연결되어 있나요?", ["A", "B", "0", "1"], 0],
] as const;

const daily: Entry[] = [{ name: "Orbit", score: 648, packets: 3 }, { name: "Pulse", score: 620, packets: 3 }, { name: "Mina", score: 586, packets: 3 }];
const allTime: Entry[] = [{ name: "Nova", score: 632, packets: 3 }, { name: "Jin", score: 614, packets: 3 }, { name: "Mina", score: 586, packets: 3 }];

const cls = (...names: Array<string | false | null | undefined>) => names.filter(Boolean).join(" ");
const time = (ms: number) => { const seconds = Math.max(0, Math.ceil(ms / 1000)); return String(Math.floor(seconds / 60)).padStart(2, "0") + ":" + String(seconds % 60).padStart(2, "0"); };

export default function BitFlowApp() {
  const [screen, setScreen] = useState<Screen>("home");
  const [configured, setConfigured] = useState(false);
  const [ready, setReady] = useState(false);
  const [user, setUser] = useState<User | null>(null);
  const [message, setMessage] = useState("");
  const [config, setConfig] = useState<RoundConfig | null>(null);
  const [game, setGame] = useState<GameState | null>(null);
  const [events, setEvents] = useState<RoundEvent[]>([]);
  const [roundId, setRoundId] = useState<string | null>(null);
  const [elapsed, setElapsed] = useState(0);
  const [selected, setSelected] = useState("");
  const [powerOff, setPowerOff] = useState(false);
  const [question, setQuestion] = useState(0);
  const [answers, setAnswers] = useState<Answer[]>([]);
  const [history, setHistory] = useState<Entry[]>([]);
  const started = useRef(0);
  const submitted = useRef(false);
  const lastTick = useRef(-1);

  const name = user?.displayName || "메모리 연구원";
  const target = game ? getCurrentTarget(game) : null;
  const bit = game ? getAvailableBitTokens(game)[0] : null;
  const expected = game ? getExpectedSlotIndex(game) : null;
  const usage = game ? getRamUsage(game) : null;
  const special = game?.specialTokens.find((item) => item.status === "available") || null;
  const remaining = config ? Math.max(0, config.durationMs - elapsed) : 90000;
  const activeScreen: Screen = screen === "game" && game && game.status !== "playing" ? "result" : screen;
  const selectedBit = game ? getAvailableBitTokens(game).find((item) => item.id === selected) : null;
  const bitId = selectedBit?.id || bit?.id || "";

  useEffect(() => {
    let unsubscribe: (() => void) | undefined;
    import("@/lib/firebase/client").then((firebase) => {
      const nextConfigured = firebase.isFirebaseClientConfigured();
      setConfigured(nextConfigured);
      setReady(true);
      if (nextConfigured) unsubscribe = firebase.observeAuthState((next) => setUser(next ? { uid: next.uid, displayName: next.displayName } : null));
    }).catch(() => setReady(true));
    return () => unsubscribe?.();
  }, []);

  useEffect(() => {
    if (!config || game?.status !== "playing" || screen !== "game") return;
    const interval = window.setInterval(() => {
      const atMs = Math.min(config.durationMs, Date.now() - started.current);
      setElapsed(atMs);
      setGame((state) => state ? applyRoundEvent(state, { type: "tick", atMs }).state : state);
      const second = Math.floor(atMs / 1000);
      if (second !== lastTick.current) {
        lastTick.current = second;
        setEvents((items) => [...items, { type: "tick", atMs }]);
      }
    }, 250);
    return () => window.clearInterval(interval);
  }, [config, game?.status, screen]);

  useEffect(() => {
    if (activeScreen !== "result" || !roundId || !user || submitted.current) return;
    submitted.current = true;
    import("@/lib/firebase/client").then(async (firebase) => {
      const token = await firebase.getCurrentUserIdToken();
      await fetch("/api/rounds/submit", { method: "POST", headers: { "Content-Type": "application/json", Authorization: "Bearer " + token }, body: JSON.stringify({ roundId, events }) });
    }).catch(() => setMessage("Firebase 설정 후 점수 검증과 온라인 기록이 자동으로 활성화됩니다."));
  }, [activeScreen, events, roundId, user]);

  async function signIn() {
    try {
      const firebase = await import("@/lib/firebase/client");
      await firebase.signInWithGoogle();
    } catch {
      setMessage("Google 로그인에 실패했습니다.");
    }
  }

  async function start() {
    setMessage("");
    let nextConfig: RoundConfig;
    let nextId: string | null = null;
    if (configured) {
      if (!user) {
        await signIn();
        return;
      }
      try {
        const firebase = await import("@/lib/firebase/client");
        const token = await firebase.getCurrentUserIdToken();
        const response = await fetch("/api/rounds/start", { method: "POST", headers: { Authorization: "Bearer " + token } });
        const data = await response.json() as { config?: RoundConfig; roundId?: string; error?: { message?: string } };
        if (!response.ok || !data.config || !data.roundId) throw new Error(data.error?.message || "라운드를 만들지 못했습니다.");
        nextConfig = data.config;
        nextId = data.roundId;
      } catch (error) {
        setMessage(error instanceof Error ? error.message : "온라인 라운드 연결에 실패했습니다.");
        return;
      }
    } else {
      nextConfig = createRoundConfig("local-demo-" + Date.now());
    }
    setConfig(nextConfig);
    setGame(createInitialGameState(nextConfig));
    setEvents([]);
    setRoundId(nextId);
    setElapsed(0);
    setSelected("");
    setPowerOff(false);
    setQuestion(0);
    setAnswers([]);
    started.current = Date.now();
    submitted.current = false;
    lastTick.current = -1;
    setScreen("game");
  }

  function dispatch(event: RoundEvent) {
    setGame((state) => {
      if (!state || state.status !== "playing") return state;
      const result = applyRoundEvent(state, event);
      if (result.accepted && event.type !== "tick") setEvents((items) => [...items, event]);
      return result.state;
    });
    setSelected("");
  }

  function put(tokenId: string, slotIndex: number) {
    if (!tokenId) return;
    dispatch({ type: "placeBit", tokenId, slotIndex, atMs: Math.min(config?.durationMs || 90000, elapsed) });
  }

  function flush() {
    dispatch({ type: "flush", atMs: Math.min(config?.durationMs || 90000, elapsed) });
  }

  function activate() {
    if (!special) return;
    dispatch({ type: "useSpecial", specialId: special.id, atMs: Math.min(config?.durationMs || 90000, elapsed) });
  }

  function answer(index: number) {
    const current = quiz[question];
    setAnswers((items) => [...items.filter((answer) => answer.questionId !== current[0]), { questionId: current[0], answerIndex: index }]);
  }

  async function finishQuiz() {
    const correct = answers.reduce((sum, value) => sum + Number(quiz.find((item) => item[0] === value.questionId)?.[3] === value.answerIndex), 0);
    if (roundId && user) {
      try {
        const firebase = await import("@/lib/firebase/client");
        const token = await firebase.getCurrentUserIdToken();
        await fetch("/api/quiz", { method: "POST", headers: { "Content-Type": "application/json", Authorization: "Bearer " + token }, body: JSON.stringify({ roundId, answers }) });
      } catch {}
    }
    setHistory((items) => [{ name, score: game?.score || 0, packets: game?.packetsCompleted || 0 }, ...items].slice(0, 4));
    setMessage("퀴즈 " + correct + "/3 정답! 학습 기록을 저장했습니다.");
    setScreen("board");
  }

  async function erase() {
    if (user) {
      try {
        const firebase = await import("@/lib/firebase/client");
        const token = await firebase.getCurrentUserIdToken();
        await fetch("/api/account/data", { method: "DELETE", headers: { Authorization: "Bearer " + token } });
      } catch {}
    }
    setHistory([]);
    setMessage("게임·퀴즈 이력과 공개 순위 기록을 삭제했습니다.");
  }

  const quizItem = quiz[question];
  const quizAnswer = answers.find((item) => item.questionId === quizItem[0])?.answerIndex;
  const status = game?.status === "won" ? "패킷 처리 완료" : game?.status === "lost" ? "RAM 과부하" : special ? "특수 블록 도착" : "데이터 수신 중";
  const boards: Array<[string, Entry[]]> = [["TODAY", daily], ["ALL TIME", allTime]];

  return <div className={styles.app}>
    <header className={styles.header}>
      <button className={styles.brand} type="button" onClick={() => setScreen("home")}><span className={styles.brandMark}>01</span><span className={styles.brandText}>BIT FLOW<small>RAM LEARNING LAB</small></span></button>
      <div className={styles.headerRight}><nav className={styles.nav}><button className={styles.navButton} type="button" onClick={() => setScreen("home")}>실험실</button><button className={styles.navButton} type="button" onClick={() => setScreen("board")}>리더보드</button></nav>{user ? <span className={styles.profilePill}><span className={styles.avatar}>{name.slice(0, 1)}</span><span>{name}</span></span> : <button className={styles.ghostButton} type="button" onClick={configured ? signIn : start}>{configured ? "Google 로그인" : "로컬 데모"}</button>}</div>
    </header>
    <main className={styles.main}>
      {message ? <div className={styles.alert} role="status">{message}</div> : null}
      {activeScreen === "home" ? <section className={styles.landing}>
        <div><p className={styles.kicker}>MEMORY CONTROLLER TRAINING</p><h1 className={styles.heroTitle}>0과 1이<br /><span>흐르는 곳.</span></h1><p className={styles.heroCopy}>떨어지는 비트를 알맞은 RAM 주소로 보내고, 8비트 패킷을 완성하세요. 공간을 비우고 데이터를 압축하며 RAM의 휘발성을 직접 실험합니다.</p><div className={styles.buttonRow}><button className={styles.primaryButton} type="button" disabled={!ready} onClick={start}>{configured && !user ? "Google 로그인 후 시작" : "RAM 실험 시작"}</button><button className={styles.secondaryButton} type="button" onClick={() => setScreen("board")}>순위와 내 기록 보기</button></div>{!configured && ready ? <div className={styles.setupBox}>현재는 <b>로컬 데모 모드</b>입니다. 실제 로그인·온라인 기록을 활성화하려면 <code>.env.local</code>에 Firebase 웹 앱 설정값을 넣어주세요.</div> : null}<div className={styles.heroMeta}><span>90초 실시간 라운드</span><span>8비트 ASCII 패킷</span><span>오늘·역대 순위</span></div></div>
        <aside className={styles.chipPreview}><div className={styles.previewTop}><span>RAM // CHANNEL_01</span><i className={styles.liveDot} /></div><div className={styles.previewTarget}><span>현재 목표 패킷</span><b>01000001</b><span>decimal 65 · character A</span></div><div className={styles.previewGrid}>{Array.from({ length: 8 }, (_, index) => <span key={index} className={cls(styles.previewCell, index < 5 && styles.on)} />)}</div><div className={styles.previewFooter}><span>용량 13 / 24</span><span>안정적</span></div></aside>
      </section> : null}

      {activeScreen === "game" && game && config && target && usage ? <section className={styles.gameShell}>
        <div className={styles.hud}><div className={styles.hudCard}><span className={styles.hudLabel}>SYSTEM STATUS</span><span className={styles.hudValue}>{status}</span></div><div className={styles.hudCard}><span className={styles.hudLabel}>TIME</span><span className={styles.hudValue}>{time(remaining)}</span></div><div className={styles.hudCard}><span className={styles.hudLabel}>SCORE</span><span className={styles.hudValue}>{game.score}</span></div><div className={styles.hudCard}><span className={styles.hudLabel}>PACKETS</span><span className={styles.hudValue}>{game.packetsCompleted}/3</span></div><div className={styles.hudCard}><span className={cls(styles.hudValue, usage.totalUsed / usage.totalCapacity > 0.75 && styles.danger)}>{usage.totalUsed}/24</span></div></div>
        <div className={styles.gameGrid}><div className={styles.playArea}>
          <div className={styles.panel}><div className={styles.targetHeader}><div><h2 className={styles.sectionTitle}>목표 데이터 패킷</h2><p className={styles.sectionSub}>빛나는 주소에 다음 정답 비트를 드래그하거나 선택 후 터치하세요.</p></div><span className={styles.quizProgress}>PACKET {game.packetsCompleted + 1}/3</span></div><div className={styles.packetDisplay}><span className={styles.packetBinary}>{target.binary}</span><span className={styles.packetInfo}>10진수 {target.decimal} · 문자 {target.character}</span></div><div className={styles.fallingLane}>{special ? <button className={cls(styles.token, styles.special)} type="button" draggable onClick={activate} onDragStart={(event) => event.dataTransfer.setData("special", special.id)}>{special.kind === "compress" ? "압축" : special.kind === "clear" ? "클리어" : "지연"}<small>UTILITY BLOCK</small></button> : bit ? <button className={styles.token} type="button" draggable onClick={() => setSelected(bit.id)} onDragStart={(event) => event.dataTransfer.setData("bit", bit.id)}>{bit.value}<small>BIT DATA</small></button> : <span className={styles.emptyState}>다음 데이터 스트림을 수신 중입니다…</span>}</div></div>
          <div className={styles.panel}><div className={styles.memoryLabel}><span>WORKING WORD · 8 BIT</span><span>EXPECTED {expected === null ? "—" : "0x0" + expected}</span></div><div className={styles.slotGrid}>{game.targetSlots.map((value, index) => <button key={index} className={cls(styles.slot, value === null ? styles.empty : styles.filled, expected === index && styles.highlight)} type="button" onClick={() => put(bitId, index)} onDragOver={(event) => event.preventDefault()} onDrop={(event) => { event.preventDefault(); put(event.dataTransfer.getData("bit") || bitId, index); }}>{value === null ? "·" : value}</button>)}</div><div className={styles.memoryLabel}><span>CORRUPTED DATA BUFFER · {usage.bufferSlotsUsed}/16</span><button className={styles.ghostButton} type="button" onClick={flush}>FLUSH −50</button></div><div className={styles.bufferGrid}>{Array.from({ length: 16 }, (_, index) => <span key={index} className={cls(styles.slot, game.buffer[index] ? styles.corrupt : styles.empty)}>{game.buffer[index]?.bit || "·"}</span>)}</div></div>
          <div className={styles.panel}><h2 className={styles.sectionTitle}>유틸리티 포트</h2><div className={styles.utility}>{(["compress", "clear", "delay"] as const).map((kind) => <button key={kind} className={cls(styles.utilityPort, special?.kind === kind && styles.active)} type="button" onClick={() => { if (special?.kind === kind) activate(); }} onDragOver={(event) => event.preventDefault()} onDrop={(event) => { event.preventDefault(); if (event.dataTransfer.getData("special") === special?.id && special.kind === kind) activate(); }}>{kind === "compress" ? "압축" : kind === "clear" ? "클리어" : "지연"}<span>{kind === "compress" ? "오염 데이터 점유량 절반" : kind === "clear" ? "오염 버퍼 즉시 비우기" : "6초간 낙하 속도 감소"}</span></button>)}</div></div>
        </div><aside className={styles.sideStack}><div className={styles.panel}><h2 className={styles.sectionTitle}>조작 프로토콜</h2><ol className={styles.instructionList}><li><span className={styles.step}>1</span><span>수신 비트를 선택하거나 드래그합니다.</span></li><li><span className={styles.step}>2</span><span>정답이면 빛나는 작업 주소에 넣습니다.</span></li><li><span className={styles.step}>3</span><span>버퍼가 가득 차기 전에 특수 블록과 Flush를 사용합니다.</span></li></ol></div><div className={styles.panel}><h2 className={styles.sectionTitle}>RAM 위험도</h2><div className={styles.previewGrid}>{Array.from({ length: 24 }, (_, index) => <span key={index} className={cls(styles.previewCell, index < usage.totalUsed && styles.on)} />)}</div><p className={styles.alert}>오염 데이터 {game.incorrectBitsPlaced + game.missedBits}개 · Flush {game.flushCount}회</p></div></aside></div>
      </section> : null}

      {activeScreen === "result" && game ? <section className={styles.resultGrid}><div className={styles.panel}><p className={styles.kicker}>{game.status === "won" ? "PACKET TRANSFER COMPLETE" : "MEMORY OVERLOAD DETECTED"}</p><h1 className={styles.sectionTitle}>{game.status === "won" ? "처리 완료! RAM 흐름을 제어했습니다." : "RAM이 한계에 도달했습니다."}</h1><div className={styles.resultScore}>{game.score}</div><span className={styles.resultLabel}>이번 라운드 점수</span><div className={styles.statList}><div className={styles.stat}><b>{game.packetsCompleted}/3</b><span>처리한 패킷</span></div><div className={styles.stat}><b>{game.correctBitsPlaced}</b><span>정답 비트</span></div><div className={styles.stat}><b>{game.incorrectBitsPlaced + game.missedBits}</b><span>오염 데이터</span></div><div className={styles.stat}><b>{game.flushCount}</b><span>Flush 사용</span></div></div><div className={styles.buttonRow}><button className={styles.primaryButton} type="button" onClick={() => setScreen("quiz")}>학습 퀴즈 풀기</button><button className={styles.secondaryButton} type="button" onClick={start}>다시 실험하기</button></div></div><aside className={cls(styles.panel, styles.volatility, powerOff && styles.volatilityOff)}><p className={styles.kicker}>VOLATILITY EXPERIMENT</p><h2 className={styles.sectionTitle}>전원을 끄면 RAM은 비워집니다.</h2><p className={styles.sectionSub}>전력이 끊기면 RAM은 작업 데이터를 유지하지 못합니다.</p><div className={styles.previewGrid}>{Array.from({ length: 16 }, (_, index) => <span key={index} className={cls(styles.previewCell, !powerOff && index < 11 && styles.on)} />)}</div><button className={styles.powerButton} type="button" onClick={() => setPowerOff((value) => !value)}>⏻</button><p className={styles.sectionSub}>{powerOff ? "전원 OFF · 모든 RAM 셀이 비워졌습니다." : "전원을 눌러 휘발성을 확인하세요."}</p></aside></section> : null}

      {activeScreen === "quiz" ? <section className={styles.resultGrid}><div className={styles.panel}><p className={styles.kicker}>KNOWLEDGE CHECK</p><h1 className={styles.sectionTitle}>방금 처리한 데이터 흐름을 떠올려 보세요.</h1><p className={styles.quizProgress}>QUESTION {question + 1}/3</p><h2 className={styles.sectionTitle}>{quizItem[1]}</h2><div className={styles.quizOptions}>{quizItem[2].map((option, index) => <button key={option} className={cls(styles.quizOption, quizAnswer === index && styles.selected)} type="button" onClick={() => answer(index)}>{String.fromCharCode(65 + index)}. {option}</button>)}</div><div className={styles.buttonRow}><button className={styles.secondaryButton} type="button" disabled={question === 0} onClick={() => setQuestion((value) => value - 1)}>이전</button>{question < 2 ? <button className={styles.primaryButton} type="button" disabled={quizAnswer === undefined} onClick={() => setQuestion((value) => value + 1)}>다음 문항</button> : <button className={styles.primaryButton} type="button" disabled={answers.length !== 3} onClick={finishQuiz}>결과 저장하기</button>}</div></div><aside className={styles.panel}><h2 className={styles.sectionTitle}>오늘의 핵심 개념</h2><ol className={styles.instructionList}><li><span className={styles.step}>01</span><span>8개의 비트가 모여 1바이트가 됩니다.</span></li><li><span className={styles.step}>02</span><span>RAM은 주소별로 데이터를 임시 보관합니다.</span></li><li><span className={styles.step}>03</span><span>전원이 끊기면 RAM은 비워집니다.</span></li></ol></aside></section> : null}

      {activeScreen === "board" ? <section className={styles.sideStack}><div className={styles.panel}><p className={styles.kicker}>PUBLIC DATA FLOW</p><h1 className={styles.sectionTitle}>리더보드</h1><p className={styles.sectionSub}>서버에서 재검증된 성공 라운드만 공개 순위에 반영됩니다.</p></div><div className={styles.leaderboard}>{boards.map(([title, board]) => <div className={styles.panel} key={title}><h2 className={styles.sectionTitle}>{title}</h2><table className={styles.table}><thead><tr><th>순위</th><th>플레이어</th><th>점수</th><th>패킷</th></tr></thead><tbody>{board.map((entry, index) => <tr key={entry.name}><td className={styles.rank}>#{index + 1}</td><td>{entry.name}</td><td>{entry.score}</td><td>{entry.packets}/3</td></tr>)}</tbody></table></div>)}</div><div className={styles.panel}><div className={styles.targetHeader}><div><h2 className={styles.sectionTitle}>내 실험 기록</h2><p className={styles.sectionSub}>{user ? name + " 계정에 저장된 최근 라운드입니다." : "로컬 데모 기록입니다."}</p></div>{user ? <button className={styles.dangerButton} type="button" onClick={erase}>기록 전체 삭제</button> : null}</div><div className={styles.history}>{history.length ? history.map((entry, index) => <div className={styles.historyItem} key={index}><span>{entry.name} · 패킷 {entry.packets}/3</span><b>{entry.score}점</b></div>) : <p className={styles.emptyState}>아직 저장된 실험 기록이 없습니다. 첫 라운드를 시작해 보세요.</p>}</div></div></section> : null}
    </main>
  </div>;
}
