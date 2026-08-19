"use client";

import { useCallback, useEffect, useRef, useState } from "react";

type Direction = "right" | "left";
type Sector = "Z" | "G" | "O" | "T";
type Spin = { id: number; number: number; direction: Direction | null; createdAt: string };
type Prediction = {
  recommended: Sector | null;
  nextDirection: Direction | null;
  scores: Record<Sector, number>;
};
type CoverageRecommendation = { columns: number[]; dozens: number[] };

const STORAGE_KEY = "memo-cache-v1";
const RED_NUMBERS = new Set([1, 3, 5, 7, 9, 12, 14, 16, 18, 19, 21, 23, 25, 27, 30, 32, 34, 36]);
const SECTORS = {
  Z: new Set([0, 3, 12, 15, 26, 32, 35]), G: new Set([2, 4, 7, 18, 19, 21, 22, 25, 28, 29]),
  O: new Set([1, 6, 9, 14, 17, 20, 31, 34]), T: new Set([5, 8, 10, 11, 13, 16, 23, 24, 27, 30, 33, 36]),
} as const;
const SECTOR_KEYS: Sector[] = ["Z", "G", "O", "T"];
const NATURAL_PRIOR: Record<Sector, number> = { Z: 7 / 37, G: 10 / 37, O: 8 / 37, T: 12 / 37 };
const EUROPEAN_WHEEL: readonly number[] = [0, 32, 15, 19, 4, 21, 2, 25, 17, 34, 6, 27, 13, 36, 11, 30, 8, 23, 10, 5, 24, 16, 33, 1, 20, 14, 31, 9, 22, 18, 29, 7, 28, 12, 35, 3, 26];
const WHEEL_INDEX = new Map<number, number>(EUROPEAN_WHEEL.map((number, index) => [number, index]));

function notationFor(number: number) {
  if (number === 0) return null;
  const remainder = number % 3;
  return { row: remainder === 0 ? "A" : remainder === 2 ? "B" : "C", dozen: Math.ceil(number / 12).toString(), sector: SECTOR_KEYS.find((sector) => SECTORS[sector].has(number)) ?? "" };
}
function numberColor(number: number) { return number === 0 ? "green" : RED_NUMBERS.has(number) ? "red" : "black"; }
function sectorOf(number: number): Sector { return SECTOR_KEYS.find((sector) => SECTORS[sector].has(number)) ?? "T"; }
function emptyCounts(): Record<Sector, number> { return { Z: 0, G: 0, O: 0, T: 0 }; }
function wheelStep(from: number, to: number, direction: Direction) {
  const start = WHEEL_INDEX.get(from) ?? 0;
  const end = WHEEL_INDEX.get(to) ?? 0;
  return direction === "right" ? (end - start + 37) % 37 : (start - end + 37) % 37;
}
function projectedNumber(from: number, step: number, direction: Direction, variation = 0) {
  const start = WHEEL_INDEX.get(from) ?? 0;
  const sign = direction === "right" ? 1 : -1;
  return EUROPEAN_WHEEL[(start + sign * step + variation + 74) % 37];
}
function wheelDistance(a: number, b: number) {
  const difference = Math.abs((WHEEL_INDEX.get(a) ?? 0) - (WHEEL_INDEX.get(b) ?? 0));
  return Math.min(difference, 37 - difference);
}

function calculatePrediction(allRows: Spin[]): Prediction {
  const rows = allRows.slice(-5000);
  const latest = rows.at(-1);
  const nextDirection: Direction | null = latest?.direction ? latest.direction === "right" ? "left" : "right" : null;
  const projected = emptyCounts();
  let sampleWeight = 0;

  if (latest && nextDirection) {
    for (let index = 1; index < rows.length; index += 1) {
      const current = rows[index];
      const previous = rows[index - 1];
      if (!current.direction) continue;
      const age = rows.length - 1 - index;
      const recency = Math.exp(-age / 72);
      const sameDirection = current.direction === nextDirection ? 1.35 : 1;
      const similarStart = 1 + .7 * Math.exp(-wheelDistance(previous.number, latest.number) / 4);
      const weight = recency * sameDirection * similarStart;
      const travel = wheelStep(previous.number, current.number, current.direction);
      for (const [variation, share] of [[-1, .2], [0, .6], [1, .2]] as const) {
        projected[sectorOf(projectedNumber(latest.number, travel, nextDirection, variation))] += weight * share;
      }
      sampleWeight += weight;
    }
  }

  const smoothing = 4;
  const total = sampleWeight + smoothing;
  const distribution = Object.fromEntries(SECTOR_KEYS.map((sector) => [sector, (projected[sector] + NATURAL_PRIOR[sector] * smoothing) / total])) as Record<Sector, number>;
  const sorted = [...SECTOR_KEYS].sort((a, b) => distribution[b] - distribution[a]);
  return {
    recommended: sampleWeight > 0 ? sorted[0] : null,
    nextDirection,
    scores: Object.fromEntries(SECTOR_KEYS.map((sector) => [sector, Math.round(distribution[sector] * 1000) / 10])) as Record<Sector, number>,
  };
}

function calculateCoverage(allRows: Spin[]): CoverageRecommendation {
  if (!allRows.some((row) => row.number !== 0)) return { columns: [], dozens: [] };
  const numberScores = Array.from({ length: 37 }, () => 0);
  allRows.slice(-160).reverse().forEach((row, distance) => {
    if (row.number !== 0) numberScores[row.number] += 1 + 2.5 * Math.exp(-distance / 24);
  });
  const hotNumbers = Array.from({ length: 36 }, (_, index) => index + 1).sort((a, b) => numberScores[b] - numberScores[a]).slice(0, 8);
  const columnScores = [0, 0, 0];
  const dozenScores = [0, 0, 0];
  hotNumbers.forEach((number) => {
    const score = numberScores[number];
    columnScores[(number - 1) % 3] += score;
    dozenScores[Math.floor((number - 1) / 12)] += score;
  });
  const topTwo = (scores: number[]) => [0, 1, 2].sort((a, b) => scores[b] - scores[a]).slice(0, 2).map((index) => index + 1);
  return { columns: topTwo(columnScores), dozens: topTwo(dozenScores) };
}

function normalizeDirections(rows: Spin[]) {
  const anchor = rows.findIndex((row) => row.direction !== null); if (anchor < 0) return rows;
  const base = rows[anchor].direction as Direction;
  return rows.map((row, index) => ({ ...row, direction: Math.abs(index - anchor) % 2 === 0 ? base : base === "right" ? "left" : "right" }));
}
function readCache(): Spin[] {
  try {
    const parsed = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? "[]") as unknown;
    if (!Array.isArray(parsed)) return [];
    return parsed.filter((item): item is Spin => { const s = item as Partial<Spin>; return !!item && typeof item === "object" && typeof s.id === "number" && Number.isInteger(s.number) && Number(s.number) >= 0 && Number(s.number) <= 36 && (s.direction === null || s.direction === "right" || s.direction === "left") && typeof s.createdAt === "string"; }).sort((a, b) => a.id - b.id);
  } catch { return []; }
}

function RecordTile({ spin, armed, highlighted, onTap }: { spin: Spin; armed: boolean; highlighted: boolean; onTap: () => void }) {
  const notation = notationFor(spin.number);
  return <button type="button" className={`record-tile ${armed ? "armed" : ""} ${highlighted ? "wheel-highlight" : ""} ${spin.number === 0 ? "is-zero" : ""}`} onClick={onTap} aria-label={`${spin.number}の記録。2回タップで削除`}>
    {spin.direction && <span className={`tile-direction ${spin.direction}`}>{spin.direction === "right" ? "↻" : "↺"}</span>}
    {spin.number === 0 ? <span className="tile-zero">0</span> : <><span className={`tile-number ${numberColor(spin.number)}`}>{spin.number}</span><span className="tile-code">{notation?.row}</span><span className="tile-code">{notation?.dozen}</span><span className="tile-code sector">{notation?.sector}</span></>}
    {armed && <span className="delete-hint">もう一度</span>}
  </button>;
}

export function RouletteRecorder() {
  const [allSpins, setAllSpins] = useState<Spin[]>([]), [prediction, setPrediction] = useState<Prediction>(() => calculatePrediction([]));
  const [draft, setDraft] = useState(""), [chosenDirection, setChosenDirection] = useState<Direction | null>(null), [armedId, setArmedId] = useState<number | null>(null);
  const [loading, setLoading] = useState(true), [saving, setSaving] = useState(false), [notice, setNotice] = useState("");
  const disarmTimer = useRef<number | null>(null);
  const applySpins = useCallback((next: Spin[], persist = true) => {
    const ordered = [...next].sort((a, b) => a.id - b.id);
    try {
      if (persist) localStorage.setItem(STORAGE_KEY, JSON.stringify(ordered));
      else localStorage.removeItem(STORAGE_KEY);
    }
    catch { setNotice("端末の保存容量を確認してください"); return false; }
    setAllSpins(ordered); setPrediction(calculatePrediction(ordered)); return true;
  }, []);
  useEffect(() => {
    const timer = window.setTimeout(() => { applySpins(readCache()); setLoading(false); }, 0);
    return () => window.clearTimeout(timer);
  }, [applySpins]);
  useEffect(() => { if (!notice) return; const timer = window.setTimeout(() => setNotice(""), 2200); return () => clearTimeout(timer); }, [notice]);
  const appendDigit = useCallback((digit: string) => setDraft((current) => { const next = current === "0" ? digit : current + digit; if (next.length > 2 || Number(next) > 36) { setNotice("0〜36を入力してください"); return current; } return next; }), []);
  const recordSpin = useCallback(() => {
    if (saving || draft === "") return; setSaving(true); const number = Number(draft); let direction = chosenDirection; const anchor = allSpins.findIndex((row) => row.direction !== null);
    if (anchor >= 0) { const base = allSpins[anchor].direction as Direction; const expected: Direction = Math.abs(allSpins.length - anchor) % 2 === 0 ? base : base === "right" ? "left" : "right"; if (chosenDirection && chosenDirection !== expected) { setNotice(`交互回転のため、この回は「${expected === "right" ? "右" : "左"}」です`); setSaving(false); return; } direction = expected; }
    const id = Math.max(Date.now(), (allSpins.at(-1)?.id ?? 0) + 1); let next = [...allSpins, { id, number, direction, createdAt: new Date().toISOString() }]; if (anchor < 0 && direction) next = normalizeDirections(next);
    if (applySpins(next)) { setDraft(""); setChosenDirection(null); setNotice(`${number} を保存しました`); } setSaving(false);
  }, [allSpins, applySpins, chosenDirection, draft, saving]);
  useEffect(() => { const key = (event: KeyboardEvent) => { if (/^\d$/.test(event.key)) appendDigit(event.key); if (event.key === "Backspace") setDraft((v) => v.slice(0, -1)); if (event.key === "Escape") setDraft(""); if (event.key === "Enter") recordSpin(); }; addEventListener("keydown", key); return () => removeEventListener("keydown", key); }, [appendDigit, recordSpin]);
  const deleteSpin = (id: number) => { if (!saving && applySpins(normalizeDirections(allSpins.filter((spin) => spin.id !== id)))) setNotice("削除しました"); };
  const tapRecord = (id: number) => { if (armedId === id) { if (disarmTimer.current) clearTimeout(disarmTimer.current); setArmedId(null); deleteSpin(id); return; } setArmedId(id); setNotice("もう一度タップすると削除します"); if (disarmTimer.current) clearTimeout(disarmTimer.current); disarmTimer.current = window.setTimeout(() => setArmedId(null), 900); };
  const clearHistory = () => { if (allSpins.length && !saving && confirm("すべてのメモを削除しますか？") && applySpins([], false)) setNotice("すべて削除しました"); };
  const spins = allSpins.slice(-500), hiddenCount = Math.max(0, allSpins.length - 500), displayedDirection = chosenDirection ?? prediction.nextDirection;
  const latestNumber = allSpins.at(-1)?.number;
  const latestIndex = latestNumber === undefined ? -1 : WHEEL_INDEX.get(latestNumber) ?? -1;
  const highlightedNumbers = latestIndex < 0 ? new Set<number>() : new Set<number>([EUROPEAN_WHEEL[(latestIndex + 36) % 37], EUROPEAN_WHEEL[latestIndex], EUROPEAN_WHEEL[(latestIndex + 1) % 37]]);
  const coverage = calculateCoverage(allSpins);
  return <main className="mobile-app">
    <header className="memo-toolbar"><span aria-hidden="true" /><button type="button" onClick={clearHistory} disabled={!spins.length || saving} aria-label="すべて削除">⋮</button></header>
    <section className="records-panel" aria-labelledby="records-title"><h1 id="records-title" className="visually-hidden">メモ</h1>{loading ? <div className="records-empty">読み込み中…</div> : spins.length ? <div className="records-grid">{spins.map((spin) => <RecordTile key={spin.id} spin={spin} armed={armedId === spin.id} highlighted={highlightedNumbers.has(spin.number)} onTap={() => tapRecord(spin.id)} />)}</div> : <div className="records-empty">メモはありません</div>}{hiddenCount > 0 && <div className="older-count">過去 {hiddenCount.toLocaleString("ja-JP")} 回も分析に含まれます</div>}</section>
    <section className="forecast-strip" aria-label="次のエリア予測">{SECTOR_KEYS.map((sector) => <span className={prediction.recommended === sector ? "forecast-top" : ""} key={sector}><b>{sector}</b><i>{prediction.scores[sector]}%</i></span>)}</section>
    <section className="coverage-strip" aria-label="2コラム2ダズン"><span>{coverage.columns.length ? coverage.columns.map((column) => `C${column}`).join(" ") : "C—"}</span><span>{coverage.dozens.length ? coverage.dozens.map((dozen) => `D${dozen}`).join(" ") : "D—"}</span></section>
    <section className="calculator" aria-label="入力"><div className="calculator-top"><div className="number-display"><b>{draft || "—"}</b></div><div className="rotation-buttons" aria-label="回転方向"><button type="button" className={displayedDirection === "left" ? "active" : ""} onClick={() => setChosenDirection("left")} aria-pressed={displayedDirection === "left"} aria-label="左回り"><span>↺</span></button><button type="button" className={displayedDirection === "right" ? "active" : ""} onClick={() => setChosenDirection("right")} aria-pressed={displayedDirection === "right"} aria-label="右回り"><span>↻</span></button></div></div><div className="calculator-body"><div className="number-pad">{[1,2,3,4,5,6,7,8,9].map((digit) => <button type="button" key={digit} onClick={() => appendDigit(String(digit))}>{digit}</button>)}<button type="button" className="key-muted" onClick={() => setDraft("")}>C</button><button type="button" onClick={() => appendDigit("0")}>0</button><button type="button" className="key-muted" onClick={() => setDraft((v) => v.slice(0,-1))} aria-label="1文字消す">⌫</button></div><button type="button" className="send-button" onClick={recordSpin} disabled={draft === "" || saving}><span>{saving ? "…" : "✓"}</span></button></div></section>
    {notice && <div className="toast" role="status">{notice}</div>}
  </main>;
}
