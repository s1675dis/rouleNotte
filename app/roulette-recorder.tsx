"use client";

import { FormEvent, useCallback, useEffect, useMemo, useRef, useState } from "react";

type Spin = {
  id: number;
  number: number;
  createdAt: string;
};

const RED_NUMBERS = new Set([
  1, 3, 5, 7, 9, 12, 14, 16, 18,
  19, 21, 23, 25, 27, 30, 32, 34, 36,
]);

const SECTORS = {
  Z: new Set([0, 3, 12, 15, 26, 32, 35]),
  G: new Set([2, 4, 7, 18, 19, 21, 22, 25, 28, 29]),
  O: new Set([1, 6, 9, 14, 17, 20, 31, 34]),
  T: new Set([5, 8, 10, 11, 13, 16, 23, 24, 27, 30, 33, 36]),
} as const;

const BOARD_ROWS = [
  { label: "A", numbers: Array.from({ length: 12 }, (_, index) => (index + 1) * 3) },
  { label: "B", numbers: Array.from({ length: 12 }, (_, index) => (index + 1) * 3 - 1) },
  { label: "C", numbers: Array.from({ length: 12 }, (_, index) => (index + 1) * 3 - 2) },
];

function notationFor(number: number) {
  if (number === 0) return null;

  const remainder = number % 3;
  const row = remainder === 0 ? "A" : remainder === 2 ? "B" : "C";
  const dozen = Math.ceil(number / 12).toString();
  const sector = (Object.keys(SECTORS) as Array<keyof typeof SECTORS>).find((key) =>
    SECTORS[key].has(number),
  ) ?? "";

  return { row, dozen, sector };
}

function numberColor(number: number) {
  if (number === 0) return "green";
  return RED_NUMBERS.has(number) ? "red" : "black";
}

function formatTime(value: string) {
  return new Intl.DateTimeFormat("ja-JP", {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  }).format(new Date(value));
}

function NotationCard({ spin, featured = false }: { spin: Spin; featured?: boolean }) {
  const notation = notationFor(spin.number);

  return (
    <article className={`notation-card ${featured ? "featured" : ""} ${spin.number === 0 ? "zero-card" : ""}`}>
      {spin.number === 0 ? (
        <div className="zero-mark">0</div>
      ) : (
        <>
          <div className={`result-number ${numberColor(spin.number)}`}>{spin.number}</div>
          <div className="notation-value">{notation?.row}</div>
          <div className="notation-value">{notation?.dozen}</div>
          <div className="notation-value sector-value">{notation?.sector}</div>
        </>
      )}
      {!featured && <time dateTime={spin.createdAt}>{formatTime(spin.createdAt)}</time>}
    </article>
  );
}

export function RouletteRecorder() {
  const [spins, setSpins] = useState<Spin[]>([]);
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [notice, setNotice] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    fetch("/api/spins")
      .then(async (response) => {
        if (!response.ok) throw new Error("履歴を読み込めませんでした");
        return response.json() as Promise<{ spins: Spin[] }>;
      })
      .then((data) => setSpins(data.spins))
      .catch(() => setNotice("履歴の読み込みに失敗しました。再読み込みしてください。"))
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => {
    if (!notice) return;
    const timer = window.setTimeout(() => setNotice(""), 3200);
    return () => window.clearTimeout(timer);
  }, [notice]);

  const latest = spins[0];
  const parsedInput = Number(input);
  const inputIsValid = /^\d{1,2}$/.test(input) && Number.isInteger(parsedInput) && parsedInput >= 0 && parsedInput <= 36;

  const addSpin = useCallback(async (number: number) => {
    if (saving || number < 0 || number > 36) return;
    setSaving(true);
    try {
      const response = await fetch("/api/spins", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ number }),
      });
      if (!response.ok) throw new Error("記録できませんでした");
      const data = (await response.json()) as { spin: Spin };
      setSpins((current) => [data.spin, ...current]);
      setInput("");
      setNotice(`${number} を記録しました`);
      inputRef.current?.focus();
    } catch {
      setNotice("記録に失敗しました。もう一度お試しください。");
    } finally {
      setSaving(false);
    }
  }, [saving]);

  function submitInput(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (inputIsValid) void addSpin(parsedInput);
  }

  async function undoLatest() {
    if (!latest || saving) return;
    setSaving(true);
    try {
      const response = await fetch(`/api/spins?id=${latest.id}`, { method: "DELETE" });
      if (!response.ok) throw new Error("取り消せませんでした");
      setSpins((current) => current.filter((spin) => spin.id !== latest.id));
      setNotice(`${latest.number} の記録を取り消しました`);
    } catch {
      setNotice("取り消しに失敗しました。");
    } finally {
      setSaving(false);
    }
  }

  async function clearHistory() {
    if (!spins.length || saving || !window.confirm("すべてのゲーム記録を削除しますか？")) return;
    setSaving(true);
    try {
      const response = await fetch("/api/spins?all=true", { method: "DELETE" });
      if (!response.ok) throw new Error("削除できませんでした");
      setSpins([]);
      setNotice("すべての記録を削除しました");
    } catch {
      setNotice("履歴の削除に失敗しました。");
    } finally {
      setSaving(false);
    }
  }

  const sessionSummary = useMemo(() => {
    const red = spins.filter((spin) => RED_NUMBERS.has(spin.number)).length;
    const black = spins.filter((spin) => spin.number !== 0 && !RED_NUMBERS.has(spin.number)).length;
    const zero = spins.filter((spin) => spin.number === 0).length;
    return { red, black, zero };
  }, [spins]);

  return (
    <main>
      <header className="topbar">
        <div className="brand-mark" aria-hidden="true"><span>R</span></div>
        <div className="brand-copy">
          <p>EUROPEAN ROULETTE</p>
          <h1>Roulette Notes</h1>
        </div>
        <div className="session-pill"><span className="live-dot" /> SESSION <b>{spins.length}</b></div>
      </header>

      <div className="workspace">
        <section className="entry-panel" aria-labelledby="entry-title">
          <div className="section-heading">
            <div>
              <span className="eyebrow">NEW SPIN</span>
              <h2 id="entry-title">出目を記録</h2>
            </div>
            <span className="keyboard-hint">0–36</span>
          </div>

          <form className="quick-entry" onSubmit={submitInput}>
            <label htmlFor="number-input">数字を直接入力</label>
            <div className="input-row">
              <input
                ref={inputRef}
                id="number-input"
                inputMode="numeric"
                autoComplete="off"
                value={input}
                onChange={(event) => setInput(event.target.value.replace(/\D/g, "").slice(0, 2))}
                placeholder="例：32"
                aria-invalid={input.length > 0 && !inputIsValid}
              />
              <button className="record-button" type="submit" disabled={!inputIsValid || saving}>記録する</button>
            </div>
          </form>

          <div className="board-wrap" aria-label="ルーレット数字盤">
            <div className="board-corner">ROW</div>
            <button className="number-button zero-button" onClick={() => void addSpin(0)} disabled={saving}>0</button>
            {BOARD_ROWS.map((row, rowIndex) => (
              <div className="board-row" key={row.label}>
                <span className="row-label">{row.label}</span>
                {row.numbers.map((number) => (
                  <button
                    key={number}
                    className={`number-button ${numberColor(number)}`}
                    onClick={() => void addSpin(number)}
                    disabled={saving}
                    aria-label={`${number}を記録`}
                  >
                    {number}
                  </button>
                ))}
                {rowIndex === 2 && <span className="dozen-guide" aria-hidden="true">1st DOZEN　　2nd DOZEN　　3rd DOZEN</span>}
              </div>
            ))}
          </div>
        </section>

        <aside className="preview-panel" aria-labelledby="preview-title">
          <div className="section-heading light-heading">
            <div>
              <span className="eyebrow">LATEST</span>
              <h2 id="preview-title">最新の表記</h2>
            </div>
            {latest && <button className="undo-button" onClick={undoLatest} disabled={saving}>↶ 取り消す</button>}
          </div>
          <div className="preview-stage">
            {latest ? (
              <NotationCard spin={latest} featured />
            ) : (
              <div className="empty-preview">
                <span>—</span>
                <p>数字を選ぶと<br />ここに表記されます</p>
              </div>
            )}
          </div>
          <div className="notation-key">
            <div><b>A B C</b><span>ベットエリアの横列</span></div>
            <div><b>1 2 3</b><span>1st / 2nd / 3rd ダズン</span></div>
            <div><b>Z G O T</b><span>ホイールセクター</span></div>
          </div>
        </aside>
      </div>

      <section className="history-section" aria-labelledby="history-title">
        <div className="history-header">
          <div>
            <span className="eyebrow">GAME LOG</span>
            <h2 id="history-title">ゲーム記録</h2>
          </div>
          <div className="history-actions">
            <div className="mini-stats" aria-label="色別集計">
              <span><i className="stat-dot red" />{sessionSummary.red}</span>
              <span><i className="stat-dot black" />{sessionSummary.black}</span>
              <span><i className="stat-dot green" />{sessionSummary.zero}</span>
            </div>
            <button className="clear-button" onClick={clearHistory} disabled={!spins.length || saving}>すべて削除</button>
          </div>
        </div>

        {loading ? (
          <div className="history-empty">記録を読み込んでいます…</div>
        ) : spins.length ? (
          <div className="history-strip">
            {spins.map((spin) => <NotationCard key={spin.id} spin={spin} />)}
          </div>
        ) : (
          <div className="history-empty"><span>まだ記録がありません</span><small>最初の出目を上の数字盤から選んでください</small></div>
        )}
      </section>

      <footer>EUROPEAN SINGLE-ZERO · PERSONAL NOTATION LOG</footer>
      {notice && <div className="toast" role="status">{notice}</div>}
    </main>
  );
}
