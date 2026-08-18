"use client";

import { useCallback, useEffect, useRef, useState } from "react";

type Direction = "right" | "left";
type Sector = "Z" | "G" | "O" | "T";
type Spin = { id: number; number: number; direction: Direction | null; createdAt: string };
type Prediction = {
  recommended: Sector | null;
  nextDirection: Direction | null;
  scores: Record<Sector, number>;
  confidence: "データ収集中" | "低" | "中" | "高";
  sampleSize: number;
  factors: { longTerm: number; recent: number; transition: number; direction: number };
};

const STORAGE_KEY = "memo-cache-v1";
const RED_NUMBERS = new Set([1, 3, 5, 7, 9, 12, 14, 16, 18, 19, 21, 23, 25, 27, 30, 32, 34, 36]);
const SECTORS = {
  Z: new Set([0, 3, 12, 15, 26, 32, 35]), G: new Set([2, 4, 7, 18, 19, 21, 22, 25, 28, 29]),
  O: new Set([1, 6, 9, 14, 17, 20, 31, 34]), T: new Set([5, 8, 10, 11, 13, 16, 23, 24, 27, 30, 33, 36]),
} as const;
const SECTOR_KEYS: Sector[] = ["Z", "G", "O", "T"];
const NATURAL_PRIOR: Record<Sector, number> = { Z: 7 / 37, G: 10 / 37, O: 8 / 37, T: 12 / 37 };

function notationFor(number: number) {
  if (number === 0) return null;
  const remainder = number % 3;
  return { row: remainder === 0 ? "A" : remainder === 2 ? "B" : "C", dozen: Math.ceil(number / 12).toString(), sector: SECTOR_KEYS.find((sector) => SECTORS[sector].has(number)) ?? "" };
}
function numberColor(number: number) { return number === 0 ? "green" : RED_NUMBERS.has(number) ? "red" : "black"; }
function sectorOf(number: number): Sector { return SECTOR_KEYS.find((sector) => SECTORS[sector].has(number)) ?? "T"; }
function emptyCounts(): Record<Sector, number> { return { Z: 0, G: 0, O: 0, T: 0 }; }
function smoothedDistribution(counts: Record<Sector, number>, strength: number) {
  const total = SECTOR_KEYS.reduce((sum, sector) => sum + counts[sector], 0);
  return Object.fromEntries(SECTOR_KEYS.map((sector) => [sector, (counts[sector] + NATURAL_PRIOR[sector] * strength) / (total + strength)])) as Record<Sector, number>;
}

function calculatePrediction(allRows: Spin[]): Prediction {
  const rows = allRows.slice(-5000);
  const latest = rows.at(-1);
  const nextDirection: Direction | null = latest?.direction ? latest.direction === "right" ? "left" : "right" : null;
  const longCounts = emptyCounts(); allRows.forEach((row) => { longCounts[sectorOf(row.number)] += 1; });
  const recentCounts = emptyCounts(); rows.slice(-96).reverse().forEach((row, distance) => { recentCounts[sectorOf(row.number)] += Math.exp(-distance / 24); });
  const directionCounts = emptyCounts();
  if (nextDirection) allRows.filter((row) => row.direction === nextDirection).forEach((row) => { directionCounts[sectorOf(row.number)] += 1; });
  const transitionCounts = emptyCounts(); let transitionSamples = 0; const lastSector = latest ? sectorOf(latest.number) : null;
  if (lastSector) for (let i = 1; i < rows.length; i += 1) if (sectorOf(rows[i - 1].number) === lastSector) { transitionCounts[sectorOf(rows[i].number)] += 1; transitionSamples += 1; }
  const longDist = smoothedDistribution(longCounts, 20), recentDist = smoothedDistribution(recentCounts, 9), transitionDist = smoothedDistribution(transitionCounts, 14), directionDist = smoothedDistribution(directionCounts, 16);
  const directionSamples = SECTOR_KEYS.reduce((sum, sector) => sum + directionCounts[sector], 0);
  const weights = { longTerm: .35, recent: .30, transition: .20 * Math.min(1, transitionSamples / 24), direction: nextDirection ? .15 * Math.min(1, directionSamples / 36) : 0 };
  const totalWeight = Object.values(weights).reduce((sum, weight) => sum + weight, 0);
  const raw = Object.fromEntries(SECTOR_KEYS.map((sector) => [sector, (longDist[sector] * weights.longTerm + recentDist[sector] * weights.recent + transitionDist[sector] * weights.transition + directionDist[sector] * weights.direction) / totalWeight])) as Record<Sector, number>;
  const sorted = [...SECTOR_KEYS].sort((a, b) => raw[b] - raw[a]); const gap = raw[sorted[0]] - raw[sorted[1]]; const evidence = Math.min(1, allRows.length / 180) * Math.min(1, gap / .12);
  return { recommended: allRows.length ? sorted[0] : null, nextDirection, scores: Object.fromEntries(SECTOR_KEYS.map((sector) => [sector, Math.round(raw[sector] * 1000) / 10])) as Record<Sector, number>, confidence: allRows.length < 12 ? "データ収集中" : evidence > .62 ? "高" : evidence > .28 ? "中" : "低", sampleSize: allRows.length, factors: { longTerm: allRows.length, recent: Math.min(allRows.length, 96), transition: transitionSamples, direction: directionSamples } };
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

function RecordTile({ spin, armed, onTap }: { spin: Spin; armed: boolean; onTap: () => void }) {
  const notation = notationFor(spin.number);
  return <button type="button" className={`record-tile ${armed ? "armed" : ""} ${spin.number === 0 ? "is-zero" : ""}`} onClick={onTap} aria-label={`${spin.number}の記録。2回タップで削除`}>
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
  return <main className="mobile-app">
    <header className="memo-toolbar"><span aria-hidden="true" /><button type="button" onClick={clearHistory} disabled={!spins.length || saving} aria-label="すべて削除">⋮</button></header>
    <section className="records-panel" aria-labelledby="records-title"><h1 id="records-title" className="visually-hidden">メモ</h1>{loading ? <div className="records-empty">読み込み中…</div> : spins.length ? <div className="records-grid">{spins.map((spin) => <RecordTile key={spin.id} spin={spin} armed={armedId === spin.id} onTap={() => tapRecord(spin.id)} />)}</div> : <div className="records-empty">メモはありません</div>}{hiddenCount > 0 && <div className="older-count">過去 {hiddenCount.toLocaleString("ja-JP")} 回も分析に含まれます</div>}</section>
    <section className="forecast-strip" aria-label="確率">{SECTOR_KEYS.map((sector) => <span className={prediction.recommended === sector ? "forecast-top" : ""} key={sector}><b>{sector}</b><i>{prediction.scores[sector]}%</i></span>)}</section>
    <section className="calculator" aria-label="入力"><div className="calculator-top"><div className="number-display"><b>{draft || "—"}</b></div><div className="rotation-buttons" aria-label="回転方向"><button type="button" className={displayedDirection === "left" ? "active" : ""} onClick={() => setChosenDirection("left")} aria-pressed={displayedDirection === "left"} aria-label="左回り"><span>↺</span></button><button type="button" className={displayedDirection === "right" ? "active" : ""} onClick={() => setChosenDirection("right")} aria-pressed={displayedDirection === "right"} aria-label="右回り"><span>↻</span></button></div></div><div className="calculator-body"><div className="number-pad">{[1,2,3,4,5,6,7,8,9].map((digit) => <button type="button" key={digit} onClick={() => appendDigit(String(digit))}>{digit}</button>)}<button type="button" className="key-muted" onClick={() => setDraft("")}>C</button><button type="button" onClick={() => appendDigit("0")}>0</button><button type="button" className="key-muted" onClick={() => setDraft((v) => v.slice(0,-1))} aria-label="1文字消す">⌫</button></div><button type="button" className="send-button" onClick={recordSpin} disabled={draft === "" || saving}><span>{saving ? "…" : "✓"}</span></button></div></section>
    {notice && <div className="toast" role="status">{notice}</div>}
  </main>;
}
