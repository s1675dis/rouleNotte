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
type StateResponse = { spins: Spin[]; hiddenCount: number; prediction: Prediction };

const RED_NUMBERS = new Set([1, 3, 5, 7, 9, 12, 14, 16, 18, 19, 21, 23, 25, 27, 30, 32, 34, 36]);
const SECTORS = {
  Z: new Set([0, 3, 12, 15, 26, 32, 35]),
  G: new Set([2, 4, 7, 18, 19, 21, 22, 25, 28, 29]),
  O: new Set([1, 6, 9, 14, 17, 20, 31, 34]),
  T: new Set([5, 8, 10, 11, 13, 16, 23, 24, 27, 30, 33, 36]),
} as const;
const SECTOR_KEYS: Sector[] = ["Z", "G", "O", "T"];

function notationFor(number: number) {
  if (number === 0) return null;
  const remainder = number % 3;
  return {
    row: remainder === 0 ? "A" : remainder === 2 ? "B" : "C",
    dozen: Math.ceil(number / 12).toString(),
    sector: SECTOR_KEYS.find((sector) => SECTORS[sector].has(number)) ?? "",
  };
}

function numberColor(number: number) {
  if (number === 0) return "green";
  return RED_NUMBERS.has(number) ? "red" : "black";
}

function RecordTile({ spin, armed, onTap }: { spin: Spin; armed: boolean; onTap: () => void }) {
  const notation = notationFor(spin.number);
  return (
    <button
      type="button"
      className={`record-tile ${armed ? "armed" : ""} ${spin.number === 0 ? "is-zero" : ""}`}
      onClick={onTap}
      aria-label={`${spin.number}の記録。2回タップで削除`}
    >
      {spin.direction && <span className={`tile-direction ${spin.direction}`}>{spin.direction === "right" ? "↻" : "↺"}</span>}
      {spin.number === 0 ? (
        <span className="tile-zero">0</span>
      ) : (
        <>
          <span className={`tile-number ${numberColor(spin.number)}`}>{spin.number}</span>
          <span className="tile-code">{notation?.row}</span>
          <span className="tile-code">{notation?.dozen}</span>
          <span className="tile-code sector">{notation?.sector}</span>
        </>
      )}
      {armed && <span className="delete-hint">もう一度</span>}
    </button>
  );
}

export function RouletteRecorder() {
  const [spins, setSpins] = useState<Spin[]>([]);
  const [prediction, setPrediction] = useState<Prediction | null>(null);
  const [hiddenCount, setHiddenCount] = useState(0);
  const [draft, setDraft] = useState("");
  const [chosenDirection, setChosenDirection] = useState<Direction | null>(null);
  const [armedId, setArmedId] = useState<number | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [notice, setNotice] = useState("");
  const disarmTimer = useRef<number | null>(null);

  const loadState = useCallback(async () => {
    const response = await fetch("/api/spins");
    if (!response.ok) throw new Error("履歴を読み込めませんでした");
    const data = (await response.json()) as StateResponse;
    setSpins(data.spins);
    setPrediction(data.prediction);
    setHiddenCount(data.hiddenCount);
  }, []);

  useEffect(() => {
    loadState()
      .catch(() => setNotice("履歴の読み込みに失敗しました"))
      .finally(() => setLoading(false));
  }, [loadState]);

  useEffect(() => {
    if (!notice) return;
    const timer = window.setTimeout(() => setNotice(""), 2200);
    return () => window.clearTimeout(timer);
  }, [notice]);

  const appendDigit = useCallback((digit: string) => {
    setDraft((current) => {
      const next = current === "0" ? digit : `${current}${digit}`;
      if (next.length > 2 || Number(next) > 36) {
        setNotice("0〜36を入力してください");
        return current;
      }
      return next;
    });
  }, []);

  const recordSpin = useCallback(async () => {
    if (saving || draft === "") return;
    const number = Number(draft);
    setSaving(true);
    try {
      const response = await fetch("/api/spins", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ number, direction: chosenDirection }),
      });
      const data = (await response.json()) as { error?: string };
      if (!response.ok) throw new Error(data.error ?? "記録できませんでした");
      await loadState();
      setDraft("");
      setChosenDirection(null);
      setNotice(`${number} を記録しました`);
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "記録に失敗しました");
    } finally {
      setSaving(false);
    }
  }, [chosenDirection, draft, loadState, saving]);

  useEffect(() => {
    const handleKey = (event: KeyboardEvent) => {
      if (/^\d$/.test(event.key)) appendDigit(event.key);
      if (event.key === "Backspace") setDraft((current) => current.slice(0, -1));
      if (event.key === "Escape") setDraft("");
      if (event.key === "Enter") void recordSpin();
    };
    window.addEventListener("keydown", handleKey);
    return () => window.removeEventListener("keydown", handleKey);
  }, [appendDigit, recordSpin]);

  async function deleteSpin(id: number) {
    if (saving) return;
    setSaving(true);
    try {
      const response = await fetch(`/api/spins?id=${id}`, { method: "DELETE" });
      if (!response.ok) throw new Error("削除できませんでした");
      await loadState();
      setNotice("記録を削除しました");
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "削除に失敗しました");
    } finally {
      setSaving(false);
    }
  }

  function tapRecord(id: number) {
    if (armedId === id) {
      if (disarmTimer.current) window.clearTimeout(disarmTimer.current);
      setArmedId(null);
      void deleteSpin(id);
      return;
    }
    setArmedId(id);
    setNotice("もう一度タップすると削除します");
    if (disarmTimer.current) window.clearTimeout(disarmTimer.current);
    disarmTimer.current = window.setTimeout(() => setArmedId(null), 900);
  }

  async function clearHistory() {
    if (!spins.length || saving || !window.confirm("すべてのゲーム記録を削除しますか？")) return;
    setSaving(true);
    try {
      const response = await fetch("/api/spins?all=true", { method: "DELETE" });
      if (!response.ok) throw new Error("削除できませんでした");
      await loadState();
      setNotice("すべての記録を削除しました");
    } catch {
      setNotice("履歴の削除に失敗しました");
    } finally {
      setSaving(false);
    }
  }

  const displayedDirection = chosenDirection ?? prediction?.nextDirection ?? null;

  return (
    <main className="mobile-app">
      <header className="compact-header">
        <div className="compact-brand"><span>R</span><strong>Roulette Notes</strong></div>
        <div className="record-count"><b>{prediction?.sampleSize ?? spins.length}</b><span>SPINS</span></div>
      </header>

      <section className="records-panel" aria-labelledby="records-title">
        <div className="records-toolbar">
          <h1 id="records-title">ゲーム記録</h1>
          <span>2回タップで削除</span>
          <button type="button" onClick={clearHistory} disabled={!spins.length || saving}>全消去</button>
        </div>
        {loading ? (
          <div className="records-empty">読み込み中…</div>
        ) : spins.length ? (
          <div className="records-grid">
            {spins.map((spin) => (
              <RecordTile key={spin.id} spin={spin} armed={armedId === spin.id} onTap={() => tapRecord(spin.id)} />
            ))}
          </div>
        ) : (
          <div className="records-empty">下の数字キーから最初の出目を記録</div>
        )}
        {hiddenCount > 0 && <div className="older-count">過去 {hiddenCount.toLocaleString("ja-JP")} 回も分析に含まれます</div>}
      </section>

      <section className="forecast-strip" aria-label="次のエリア傾向">
        <div className="forecast-lead">
          <span>NEXT AREA</span>
          <b>{prediction?.recommended ?? "—"}</b>
          <small>強度 {prediction?.confidence ?? "—"}</small>
        </div>
        <div className="forecast-scores">
          {SECTOR_KEYS.map((sector) => (
            <div className={prediction?.recommended === sector ? "forecast-top" : ""} key={sector}>
              <span><b>{sector}</b><i>{prediction?.scores[sector] ?? 0}%</i></span>
              <em><i style={{ width: `${prediction?.scores[sector] ?? 0}%` }} /></em>
            </div>
          ))}
        </div>
        <p>過去傾向の統計表示です。出目を保証するものではありません。</p>
      </section>

      <section className="calculator" aria-label="出目入力">
        <div className="calculator-top">
          <div className="number-display">
            <span>NUMBER · 0–36</span>
            <b>{draft || "—"}</b>
          </div>
          <div className="rotation-buttons" aria-label="回転方向">
            <button
              type="button"
              className={displayedDirection === "left" ? "active" : ""}
              onClick={() => setChosenDirection("left")}
              aria-pressed={displayedDirection === "left"}
            ><span>↺</span> 左</button>
            <button
              type="button"
              className={displayedDirection === "right" ? "active" : ""}
              onClick={() => setChosenDirection("right")}
              aria-pressed={displayedDirection === "right"}
            ><span>↻</span> 右</button>
          </div>
        </div>

        <div className="calculator-body">
          <div className="number-pad">
            {[1, 2, 3, 4, 5, 6, 7, 8, 9].map((digit) => (
              <button type="button" key={digit} onClick={() => appendDigit(String(digit))}>{digit}</button>
            ))}
            <button type="button" className="key-muted" onClick={() => setDraft("")}>C</button>
            <button type="button" onClick={() => appendDigit("0")}>0</button>
            <button type="button" className="key-muted" onClick={() => setDraft((current) => current.slice(0, -1))} aria-label="1文字消す">⌫</button>
          </div>
          <button type="button" className="send-button" onClick={() => void recordSpin()} disabled={draft === "" || saving}>
            <span>{saving ? "…" : "記録"}</span><i>ENTER</i>
          </button>
        </div>
      </section>

      {notice && <div className="toast" role="status">{notice}</div>}
    </main>
  );
}
