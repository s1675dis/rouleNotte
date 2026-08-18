import { env } from "cloudflare:workers";

type Direction = "right" | "left";
type Sector = "Z" | "G" | "O" | "T";
type SpinRow = { id: number; number: number; direction: Direction | null; created_at: string };
type CountRow = { number: number; direction?: Direction | null; count: number };

const SECTORS: Record<Sector, Set<number>> = {
  Z: new Set([0, 3, 12, 15, 26, 32, 35]),
  G: new Set([2, 4, 7, 18, 19, 21, 22, 25, 28, 29]),
  O: new Set([1, 6, 9, 14, 17, 20, 31, 34]),
  T: new Set([5, 8, 10, 11, 13, 16, 23, 24, 27, 30, 33, 36]),
};
const SECTOR_KEYS = Object.keys(SECTORS) as Sector[];
const NATURAL_PRIOR: Record<Sector, number> = { Z: 7 / 37, G: 10 / 37, O: 8 / 37, T: 12 / 37 };

async function ensureSchema() {
  await env.DB.prepare(`
    CREATE TABLE IF NOT EXISTS spins (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      number INTEGER NOT NULL CHECK(number >= 0 AND number <= 36),
      direction TEXT CHECK(direction IN ('right', 'left')),
      created_at TEXT NOT NULL
    )
  `).run();

  const columns = await env.DB.prepare("PRAGMA table_info(spins)").all<{ name: string }>();
  if (!columns.results.some((column) => column.name === "direction")) {
    await env.DB.prepare("ALTER TABLE spins ADD COLUMN direction TEXT CHECK(direction IN ('right', 'left'))").run();
  }
}

async function normalizeDirections() {
  const anchor = await env.DB.prepare(`
    SELECT s.id, s.direction,
      (SELECT COUNT(*) FROM spins p WHERE p.id <= s.id) AS sequence
    FROM spins s
    WHERE s.direction IS NOT NULL
    ORDER BY s.id ASC
    LIMIT 1
  `).first<{ id: number; direction: Direction; sequence: number }>();
  if (!anchor) return;

  const opposite: Direction = anchor.direction === "right" ? "left" : "right";
  await env.DB.prepare(`
    WITH ordered AS (
      SELECT id, ROW_NUMBER() OVER (ORDER BY id ASC) AS sequence FROM spins
    )
    UPDATE spins
    SET direction = CASE
      WHEN ABS((SELECT sequence FROM ordered WHERE ordered.id = spins.id) - ?) % 2 = 0 THEN ?
      ELSE ?
    END
  `).bind(Number(anchor.sequence), anchor.direction, opposite).run();
}

function sectorOf(number: number): Sector {
  return SECTOR_KEYS.find((sector) => SECTORS[sector].has(number)) ?? "T";
}

function emptyCounts(): Record<Sector, number> {
  return { Z: 0, G: 0, O: 0, T: 0 };
}

function smoothedDistribution(counts: Record<Sector, number>, priorStrength: number) {
  const total = SECTOR_KEYS.reduce((sum, sector) => sum + counts[sector], 0);
  return Object.fromEntries(SECTOR_KEYS.map((sector) => [
    sector,
    (counts[sector] + NATURAL_PRIOR[sector] * priorStrength) / (total + priorStrength),
  ])) as Record<Sector, number>;
}

function weightedRecent(rows: SpinRow[]) {
  const counts = emptyCounts();
  const recent = rows.slice(-96).reverse();
  recent.forEach((row, distance) => {
    counts[sectorOf(row.number)] += Math.exp(-distance / 24);
  });
  return counts;
}

function calculatePrediction(
  rows: SpinRow[],
  longTermRows: CountRow[],
  directionRows: CountRow[],
  total: number,
) {
  const latest = rows.at(-1);
  const nextDirection: Direction | null = latest?.direction
    ? latest.direction === "right" ? "left" : "right"
    : null;

  const longCounts = emptyCounts();
  longTermRows.forEach((row) => { longCounts[sectorOf(row.number)] += Number(row.count); });

  const directionCounts = emptyCounts();
  if (nextDirection) {
    directionRows
      .filter((row) => row.direction === nextDirection)
      .forEach((row) => { directionCounts[sectorOf(row.number)] += Number(row.count); });
  }

  const transitionCounts = emptyCounts();
  let transitionSamples = 0;
  const lastSector = latest ? sectorOf(latest.number) : null;
  if (lastSector) {
    for (let index = 1; index < rows.length; index += 1) {
      if (sectorOf(rows[index - 1].number) === lastSector) {
        transitionCounts[sectorOf(rows[index].number)] += 1;
        transitionSamples += 1;
      }
    }
  }

  const recentCounts = weightedRecent(rows);
  const longDist = smoothedDistribution(longCounts, 20);
  const recentDist = smoothedDistribution(recentCounts, 9);
  const transitionDist = smoothedDistribution(transitionCounts, 14);
  const directionDist = smoothedDistribution(directionCounts, 16);
  const directionSamples = SECTOR_KEYS.reduce((sum, sector) => sum + directionCounts[sector], 0);

  const weights = {
    longTerm: 0.35,
    recent: 0.30,
    transition: 0.20 * Math.min(1, transitionSamples / 24),
    direction: nextDirection ? 0.15 * Math.min(1, directionSamples / 36) : 0,
  };
  const weightTotal = Object.values(weights).reduce((sum, weight) => sum + weight, 0);
  const rawScores = Object.fromEntries(SECTOR_KEYS.map((sector) => [sector,
    (longDist[sector] * weights.longTerm
      + recentDist[sector] * weights.recent
      + transitionDist[sector] * weights.transition
      + directionDist[sector] * weights.direction) / weightTotal,
  ])) as Record<Sector, number>;

  const sorted = [...SECTOR_KEYS].sort((a, b) => rawScores[b] - rawScores[a]);
  const gap = rawScores[sorted[0]] - rawScores[sorted[1]];
  const evidence = Math.min(1, total / 180) * Math.min(1, gap / 0.12);
  const confidence = total < 12 ? "データ収集中" : evidence > 0.62 ? "高" : evidence > 0.28 ? "中" : "低";

  return {
    recommended: total ? sorted[0] : null,
    nextDirection,
    scores: Object.fromEntries(SECTOR_KEYS.map((sector) => [sector, Math.round(rawScores[sector] * 1000) / 10])),
    confidence,
    sampleSize: total,
    factors: {
      longTerm: total,
      recent: Math.min(total, 96),
      transition: transitionSamples,
      direction: directionSamples,
    },
  };
}

function present(row: SpinRow) {
  return { id: row.id, number: row.number, direction: row.direction, createdAt: row.created_at };
}

async function readState() {
  const [analysisResult, longTermResult, directionResult, totalResult] = await Promise.all([
    env.DB.prepare("SELECT id, number, direction, created_at FROM spins ORDER BY id DESC LIMIT 5000").all<SpinRow>(),
    env.DB.prepare("SELECT number, COUNT(*) AS count FROM spins GROUP BY number").all<CountRow>(),
    env.DB.prepare("SELECT number, direction, COUNT(*) AS count FROM spins WHERE direction IS NOT NULL GROUP BY number, direction").all<CountRow>(),
    env.DB.prepare("SELECT COUNT(*) AS count FROM spins").first<{ count: number }>(),
  ]);
  const descendingRows = analysisResult.results;
  const analysisRows = [...descendingRows].reverse();
  const total = Number(totalResult?.count ?? 0);
  return {
    spins: descendingRows.slice(0, 500).reverse().map(present),
    hiddenCount: Math.max(0, total - 500),
    prediction: calculatePrediction(analysisRows, longTermResult.results, directionResult.results, total),
  };
}

export async function GET() {
  try {
    await ensureSchema();
    return Response.json(await readState());
  } catch {
    return Response.json({ error: "履歴を読み込めませんでした" }, { status: 500 });
  }
}

export async function POST(request: Request) {
  try {
    const payload = (await request.json()) as { number?: unknown; direction?: unknown };
    const number = payload.number;
    const requestedDirection = payload.direction === "right" || payload.direction === "left"
      ? payload.direction as Direction
      : null;
    if (!Number.isInteger(number) || (number as number) < 0 || (number as number) > 36) {
      return Response.json({ error: "0から36の整数を指定してください" }, { status: 400 });
    }

    await ensureSchema();
    const [anchor, totalResult] = await Promise.all([
      env.DB.prepare(`
        SELECT s.id, s.direction,
          (SELECT COUNT(*) FROM spins p WHERE p.id <= s.id) AS sequence
        FROM spins s
        WHERE s.direction IS NOT NULL
        ORDER BY s.id ASC
        LIMIT 1
      `).first<{ id: number; direction: Direction; sequence: number }>(),
      env.DB.prepare("SELECT COUNT(*) AS count FROM spins").first<{ count: number }>(),
    ]);
    const nextSequence = Number(totalResult?.count ?? 0) + 1;
    let effectiveDirection = requestedDirection;

    if (anchor) {
      const sameParity = Math.abs(nextSequence - Number(anchor.sequence)) % 2 === 0;
      const expectedDirection: Direction = sameParity
        ? anchor.direction
        : anchor.direction === "right" ? "left" : "right";
      if (requestedDirection && requestedDirection !== expectedDirection) {
        return Response.json({
          error: `交互回転のため、この回は「${expectedDirection === "right" ? "右" : "左"}」になります`,
        }, { status: 409 });
      }
      effectiveDirection = expectedDirection;
    }

    const createdAt = new Date().toISOString();
    const result = await env.DB.prepare(
      "INSERT INTO spins (number, direction, created_at) VALUES (?, ?, ?) RETURNING id, number, direction, created_at",
    ).bind(number, effectiveDirection, createdAt).first<SpinRow>();
    if (!result) throw new Error("insert failed");

    if (!anchor && effectiveDirection) {
      const opposite: Direction = effectiveDirection === "right" ? "left" : "right";
      await env.DB.prepare(`
        WITH ordered AS (
          SELECT id, ROW_NUMBER() OVER (ORDER BY id ASC) AS sequence FROM spins
        )
        UPDATE spins
        SET direction = CASE
          WHEN ABS((SELECT sequence FROM ordered WHERE ordered.id = spins.id) - ?) % 2 = 0 THEN ?
          ELSE ?
        END
      `).bind(nextSequence, effectiveDirection, opposite).run();
    }

    return Response.json({ spin: present(result) }, { status: 201 });
  } catch {
    return Response.json({ error: "記録できませんでした" }, { status: 500 });
  }
}

export async function DELETE(request: Request) {
  try {
    await ensureSchema();
    const url = new URL(request.url);
    if (url.searchParams.get("all") === "true") {
      await env.DB.prepare("DELETE FROM spins").run();
      return Response.json({ ok: true });
    }

    const id = Number(url.searchParams.get("id"));
    if (!Number.isInteger(id) || id < 1) {
      return Response.json({ error: "有効なIDが必要です" }, { status: 400 });
    }
    await env.DB.prepare("DELETE FROM spins WHERE id = ?").bind(id).run();
    await normalizeDirections();
    return Response.json({ ok: true });
  } catch {
    return Response.json({ error: "削除できませんでした" }, { status: 500 });
  }
}
