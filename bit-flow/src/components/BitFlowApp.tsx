"use client";

import { useCallback, useEffect, useRef, useState } from "react";
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

declare global {
  interface Window {
    LetscodingRanking?: {
      submitScore: (score: number) => Promise<void>;
    };
  }
}

type Screen = "home" | "game" | "result" | "quiz" | "board";
type Entry = { name: string; score: number; packets: number };
type Answer = { questionId: string; answerIndex: number };

const quiz = [
  ["byte", "1바이트(Byte)는 몇 비트(Bit)일까요?", ["4비트", "8비트", "16비트", "32비트"], 1],
  ["volatile", "전원을 끄면 RAM 데이터가 사라지는 이유는 무엇일까요?", ["RAM은 휘발성 메모리이기 때문", "CPU가 데이터를 숨기기 때문", "비트가 자동 압축되기 때문", "HDD가 RAM을 비우기 때문"], 0],
  ["binary", "01000001은 어떤 문자와 연결되어 있나요?", ["A", "B", "0", "1"], 0],
] as const;

const cls = (...names: Array<string | false | null | undefined>) => names.filter(Boolean).join(" ");
const time = (ms: number) => { const seconds = Math.max(0, Math.ceil(ms / 1000)); return String(Math.floor(seconds / 60)).padStart(2, "0") + ":" + String(seconds % 60).padStart(2, "0"); };

export default function BitFlowApp() {
  const [screen, setScreen] = useState<Screen>("home");
  const [message, setMessage] = useState("");
  const [config, setConfig] = useState<RoundConfig | null>(null);
  const [game, setGame] = useState<GameState | null>(null);
  const [elapsed, setElapsed] = useState(0);
  const [selected, setSelected] = useState("");
  const [powerOff, setPowerOff] = useState(false);
  const [question, setQuestion] = useState(0);
  const [answers, setAnswers] = useState<Answer[]>([]);
  const [history, setHistory] = useState<Entry[]>([]);
  const [rankingStatus, setRankingStatus] = useState("");
  const started = useRef(0);
  const rankingSubmitted = useRef(false);
  const rankingRound = useRef(0);

  const submitRanking = useCallback((score: number) => {
    if (rankingSubmitted.current) return;
    const round = rankingRound.current;
    if (!window.LetscodingRanking) {
      queueMicrotask(() => {
        if (rankingRound.current !== round) return;
        setRankingStatus("랭킹 SDK가 로드되지 않았어요 (로컬 테스트 환경인가요?)");
      });
      return;
    }
    rankingSubmitted.current = true;
    queueMicrotask(() => {
      if (rankingRound.current !== round) return;
      setRankingStatus("랭킹 등록 중...");
    });
    const safeScore = Math.max(0, Math.floor(score));
    window.LetscodingRanking.submitScore(safeScore)
      .then(() => {
        if (rankingRound.current !== round) return;
        setRankingStatus("🏆 랭킹에 등록되었어요!");
      })
      .catch((error: Error) => {
        if (rankingRound.current !== round) return;
        rankingSubmitted.current = false;
        setRankingStatus("랭킹 등록 실패: " + error.message);
      });
  }, []);

  const name = "메모리 연구원";
  const target = game ? getCurrentTarget(game) : null;
  const bit = game ? getAvailableBitTokens(game)[0] : null;
  const expected = game ? getExpectedSlotIndex(game) : null;
  const usage = game ? getRamUsage(game) : null;
  const special = game?.specialTokens.find((item) => item.status === "available") || null;
  const remaining = config ? Math.max(0, config.durationMs - elapsed) : 90000;
  const activeScreen: Screen = screen === "game" && game && game.status !== "playing" ? "result" : screen;
  const gameStatus = game?.status;
  const gameScore = game?.score;
  const selectedBit = game ? getAvailableBitTokens(game).find((item) => item.id === selected) : null;
  const bitId = selectedBit?.id || bit?.id || "";

  useEffect(() => {
    if (!config || game?.status !== "playing" || screen !== "game") return;
    const interval = window.setInterval(() => {
      const atMs = Math.min(config.durationMs, Date.now() - started.current);
      setElapsed(atMs);
      setGame((state) => state ? applyRoundEvent(state, { type: "tick", atMs }).state : state);
    }, 250);
    return () => window.clearInterval(interval);
  }, [config, game?.status, screen]);

  useEffect(() => {
    if (gameStatus !== "won" && gameStatus !== "lost") return;
    if (gameScore === undefined) return;
    submitRanking(gameScore);
  }, [gameScore, gameStatus, submitRanking]);

  function start() {
    setMessage("");
    const nextConfig = createRoundConfig("local-demo-" + Date.now());
    setConfig(nextConfig);
    setGame(createInitialGameState(nextConfig));
    setElapsed(0);
    setSelected("");
    setPowerOff(false);
    setQuestion(0);
    setAnswers([]);
    rankingRound.current += 1;
    rankingSubmitted.current = false;
    setRankingStatus("");
    started.current = Date.now();
    setScreen("game");
  }

  function dispatch(event: RoundEvent) {
    setGame((state) => {
      if (!state || state.status !== "playing") return state;
      return applyRoundEvent(state, event).state;
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

  function finishQuiz() {
    const correct = answers.reduce((sum, value) => sum + Number(quiz.find((item) => item[0] === value.questionId)?.[3] === value.answerIndex), 0);
    setHistory((items) => [{ name, score: game?.score || 0, packets: game?.packetsCompleted || 0 }, ...items].slice(0, 4));
    setMessage("퀴즈 " + correct + "/3 정답! 학습 기록을 저장했습니다.");
    setScreen("board");
  }

  function erase() {
    setHistory([]);
    setMessage("게임·퀴즈 이력을 삭제했습니다.");
  }

  const quizItem = quiz[question];
  const quizAnswer = answers.find((item) => item.questionId === quizItem[0])?.answerIndex;
  const status = game?.status === "won" ? "패킷 처리 완료" : game?.status === "lost" ? "RAM 과부하" : special ? "특수 블록 도착" : "데이터 수신 중";

  return <div className={styles.app}>
    <header className={styles.header}>
      <button className={styles.brand} type="button" onClick={() => setScreen("home")}><span className={styles.brandMark}>01</span><span className={styles.brandText}>BIT FLOW<small>RAM LEARNING LAB</small></span></button>
      <div className={styles.headerRight}><nav className={styles.nav}><button className={styles.navButton} type="button" onClick={() => setScreen("home")}>실험실</button><button className={styles.navButton} type="button" onClick={() => setScreen("board")}>내 기록</button></nav></div>
    </header>
    <main className={styles.main}>
      {message ? <div className={styles.alert} role="status">{message}</div> : null}
      {activeScreen === "home" ? <section className={styles.landing}>
        <div><p className={styles.kicker}>MEMORY CONTROLLER TRAINING</p><h1 className={styles.heroTitle}>0과 1이<br /><span>흐르는 곳.</span></h1><p className={styles.heroCopy}>떨어지는 비트를 알맞은 RAM 주소로 보내고, 8비트 패킷을 완성하세요. 공간을 비우고 데이터를 압축하며 RAM의 휘발성을 직접 실험합니다.</p><div className={styles.buttonRow}><button className={styles.primaryButton} type="button" onClick={start}>RAM 실험 시작</button><button className={styles.secondaryButton} type="button" onClick={() => setScreen("board")}>내 기록 보기</button></div><div className={styles.heroMeta}><span>90초 실시간 라운드</span><span>8비트 ASCII 패킷</span><span>현재 세션 기록</span></div></div>
        <aside className={styles.chipPreview}><div className={styles.previewTop}><span>RAM // CHANNEL_01</span><i className={styles.liveDot} /></div><div className={styles.previewTarget}><span>현재 목표 패킷</span><b>01000001</b><span>decimal 65 · character A</span></div><div className={styles.previewGrid}>{Array.from({ length: 8 }, (_, index) => <span key={index} className={cls(styles.previewCell, index < 5 && styles.on)} />)}</div><div className={styles.previewFooter}><span>용량 13 / 24</span><span>안정적</span></div></aside>
      </section> : null}

      {activeScreen === "game" && game && config && target && usage ? <section className={styles.gameShell}>
        <div className={styles.hud}><div className={styles.hudCard}><span className={styles.hudLabel}>SYSTEM STATUS</span><span className={styles.hudValue}>{status}</span></div><div className={styles.hudCard}><span className={styles.hudLabel}>TIME</span><span className={styles.hudValue}>{time(remaining)}</span></div><div className={styles.hudCard}><span className={styles.hudLabel}>SCORE</span><span className={styles.hudValue}>{game.score}</span></div><div className={styles.hudCard}><span className={styles.hudLabel}>PACKETS</span><span className={styles.hudValue}>{game.packetsCompleted}/3</span></div><div className={styles.hudCard}><span className={cls(styles.hudValue, usage.totalUsed / usage.totalCapacity > 0.75 && styles.danger)}>{usage.totalUsed}/24</span></div></div>
        <div className={styles.gameGrid}><div className={styles.playArea}>
          <div className={styles.panel}><div className={styles.targetHeader}><div><h2 className={styles.sectionTitle}>목표 데이터 패킷</h2><p className={styles.sectionSub}>빛나는 주소에 다음 정답 비트를 드래그하거나 선택 후 터치하세요.</p></div><span className={styles.quizProgress}>PACKET {game.packetsCompleted + 1}/3</span></div><div className={styles.packetDisplay}><span className={styles.packetBinary}>{target.binary}</span><span className={styles.packetInfo}>10진수 {target.decimal} · 문자 {target.character}</span></div><div className={styles.fallingLane}>{bit ? <button className={styles.token} type="button" draggable onClick={() => setSelected(bit.id)} onDragStart={(event) => event.dataTransfer.setData("bit", bit.id)}>{bit.value}<small>BIT DATA</small></button> : <span className={styles.emptyState}>다음 데이터 스트림을 수신 중입니다…</span>}{special ? <button className={cls(styles.token, styles.special)} type="button" draggable onClick={activate} onDragStart={(event) => event.dataTransfer.setData("special", special.id)}>{special.kind === "compress" ? "압축" : special.kind === "clear" ? "클리어" : "지연"}<small>UTILITY BLOCK</small></button> : null}</div></div>
          <div className={styles.panel}><div className={styles.memoryLabel}><span>WORKING WORD · 8 BIT</span><span>EXPECTED {expected === null ? "—" : "0x0" + expected}</span></div><div className={styles.slotGrid}>{game.targetSlots.map((value, index) => <button key={index} className={cls(styles.slot, value === null ? styles.empty : styles.filled, expected === index && styles.highlight)} type="button" onClick={() => put(bitId, index)} onDragOver={(event) => event.preventDefault()} onDrop={(event) => { event.preventDefault(); put(event.dataTransfer.getData("bit") || bitId, index); }}>{value === null ? "·" : value}</button>)}</div><div className={styles.memoryLabel}><span>CORRUPTED DATA BUFFER · {usage.bufferSlotsUsed}/16</span><button className={styles.ghostButton} type="button" onClick={flush}>FLUSH −50</button></div><div className={styles.bufferGrid}>{Array.from({ length: 16 }, (_, index) => <span key={index} className={cls(styles.slot, game.buffer[index] ? styles.corrupt : styles.empty)}>{game.buffer[index]?.bit || "·"}</span>)}</div></div>
          <div className={styles.panel}><h2 className={styles.sectionTitle}>유틸리티 포트</h2><div className={styles.utility}>{(["compress", "clear", "delay"] as const).map((kind) => <button key={kind} className={cls(styles.utilityPort, special?.kind === kind && styles.active)} type="button" onClick={() => { if (special?.kind === kind) activate(); }} onDragOver={(event) => event.preventDefault()} onDrop={(event) => { event.preventDefault(); if (event.dataTransfer.getData("special") === special?.id && special.kind === kind) activate(); }}>{kind === "compress" ? "압축" : kind === "clear" ? "클리어" : "지연"}<span>{kind === "compress" ? "오염 데이터 점유량 절반" : kind === "clear" ? "오염 버퍼 즉시 비우기" : "6초간 낙하 속도 감소"}</span></button>)}</div></div>
        </div><aside className={styles.sideStack}><div className={styles.panel}><h2 className={styles.sectionTitle}>조작 프로토콜</h2><ol className={styles.instructionList}><li><span className={styles.step}>1</span><span>수신 비트를 선택하거나 드래그합니다.</span></li><li><span className={styles.step}>2</span><span>정답이면 빛나는 작업 주소에 넣습니다.</span></li><li><span className={styles.step}>3</span><span>버퍼가 가득 차기 전에 특수 블록과 Flush를 사용합니다.</span></li></ol></div><div className={styles.panel}><h2 className={styles.sectionTitle}>RAM 위험도</h2><div className={styles.previewGrid}>{Array.from({ length: 24 }, (_, index) => <span key={index} className={cls(styles.previewCell, index < usage.totalUsed && styles.on)} />)}</div><p className={styles.alert}>오염 데이터 {game.incorrectBitsPlaced + game.missedBits}개 · Flush {game.flushCount}회</p></div></aside></div>
      </section> : null}

      {activeScreen === "result" && game ? <section className={styles.resultGrid}><div className={styles.panel}><p className={styles.kicker}>{game.status === "won" ? "PACKET TRANSFER COMPLETE" : "MEMORY OVERLOAD DETECTED"}</p><h1 className={styles.sectionTitle}>{game.status === "won" ? "처리 완료! RAM 흐름을 제어했습니다." : "RAM이 한계에 도달했습니다."}</h1><div className={styles.resultScore}>{game.score}</div><span className={styles.resultLabel}>이번 라운드 점수</span><span id="rankingStatus" className={styles.sectionSub}>{rankingStatus}</span><div className={styles.statList}><div className={styles.stat}><b>{game.packetsCompleted}/3</b><span>처리한 패킷</span></div><div className={styles.stat}><b>{game.correctBitsPlaced}</b><span>정답 비트</span></div><div className={styles.stat}><b>{game.incorrectBitsPlaced + game.missedBits}</b><span>오염 데이터</span></div><div className={styles.stat}><b>{game.flushCount}</b><span>Flush 사용</span></div></div><div className={styles.buttonRow}><button className={styles.primaryButton} type="button" onClick={() => setScreen("quiz")}>학습 퀴즈 풀기</button><button className={styles.secondaryButton} type="button" onClick={start}>다시 실험하기</button></div></div><aside className={cls(styles.panel, styles.volatility, powerOff && styles.volatilityOff)}><p className={styles.kicker}>VOLATILITY EXPERIMENT</p><h2 className={styles.sectionTitle}>전원을 끄면 RAM은 비워집니다.</h2><p className={styles.sectionSub}>전력이 끊기면 RAM은 작업 데이터를 유지하지 못합니다.</p><div className={styles.previewGrid}>{Array.from({ length: 16 }, (_, index) => <span key={index} className={cls(styles.previewCell, !powerOff && index < 11 && styles.on)} />)}</div><button className={styles.powerButton} type="button" onClick={() => setPowerOff((value) => !value)}>⏻</button><p className={styles.sectionSub}>{powerOff ? "전원 OFF · 모든 RAM 셀이 비워졌습니다." : "전원을 눌러 휘발성을 확인하세요."}</p></aside></section> : null}

      {activeScreen === "quiz" ? <section className={styles.resultGrid}><div className={styles.panel}><p className={styles.kicker}>KNOWLEDGE CHECK</p><h1 className={styles.sectionTitle}>방금 처리한 데이터 흐름을 떠올려 보세요.</h1><p className={styles.quizProgress}>QUESTION {question + 1}/3</p><h2 className={styles.sectionTitle}>{quizItem[1]}</h2><div className={styles.quizOptions}>{quizItem[2].map((option, index) => <button key={option} className={cls(styles.quizOption, quizAnswer === index && styles.selected)} type="button" onClick={() => answer(index)}>{String.fromCharCode(65 + index)}. {option}</button>)}</div><div className={styles.buttonRow}><button className={styles.secondaryButton} type="button" disabled={question === 0} onClick={() => setQuestion((value) => value - 1)}>이전</button>{question < 2 ? <button className={styles.primaryButton} type="button" disabled={quizAnswer === undefined} onClick={() => setQuestion((value) => value + 1)}>다음 문항</button> : <button className={styles.primaryButton} type="button" disabled={answers.length !== 3} onClick={finishQuiz}>결과 저장하기</button>}</div></div><aside className={styles.panel}><h2 className={styles.sectionTitle}>오늘의 핵심 개념</h2><ol className={styles.instructionList}><li><span className={styles.step}>01</span><span>8개의 비트가 모여 1바이트가 됩니다.</span></li><li><span className={styles.step}>02</span><span>RAM은 주소별로 데이터를 임시 보관합니다.</span></li><li><span className={styles.step}>03</span><span>전원이 끊기면 RAM은 비워집니다.</span></li></ol></aside></section> : null}

      {activeScreen === "board" ? <section className={styles.sideStack}><div className={styles.panel}><p className={styles.kicker}>LOCAL SESSION</p><h1 className={styles.sectionTitle}>내 기록</h1><p className={styles.sectionSub}>현재 브라우저 세션에서 완료한 실험 기록입니다.</p></div><div className={styles.panel}><div className={styles.targetHeader}><div><h2 className={styles.sectionTitle}>내 실험 기록</h2><p className={styles.sectionSub}>현재 세션에만 보관되는 로컬 기록입니다.</p></div><button className={styles.dangerButton} type="button" onClick={erase}>기록 전체 삭제</button></div><div className={styles.history}>{history.length ? history.map((entry, index) => <div className={styles.historyItem} key={index}><span>{entry.name} · 패킷 {entry.packets}/3</span><b>{entry.score}점</b></div>) : <p className={styles.emptyState}>아직 저장된 실험 기록이 없습니다. 첫 라운드를 시작해 보세요.</p>}</div></div></section> : null}
    </main>
  </div>;
}
