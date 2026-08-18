import { env } from "cloudflare:workers";

type SpinRow = { id: number; number: number; created_at: string };

async function ensureSchema() {
  await env.DB.prepare(`
    CREATE TABLE IF NOT EXISTS spins (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      number INTEGER NOT NULL CHECK(number >= 0 AND number <= 36),
      created_at TEXT NOT NULL
    )
  `).run();
}

function present(row: SpinRow) {
  return { id: row.id, number: row.number, createdAt: row.created_at };
}

export async function GET() {
  try {
    await ensureSchema();
    const result = await env.DB.prepare(
      "SELECT id, number, created_at FROM spins ORDER BY id DESC LIMIT 500",
    ).all<SpinRow>();
    return Response.json({ spins: result.results.map(present) });
  } catch {
    return Response.json({ error: "履歴を読み込めませんでした" }, { status: 500 });
  }
}

export async function POST(request: Request) {
  try {
    const payload = (await request.json()) as { number?: unknown };
    const number = payload.number;
    if (!Number.isInteger(number) || (number as number) < 0 || (number as number) > 36) {
      return Response.json({ error: "0から36の整数を指定してください" }, { status: 400 });
    }

    await ensureSchema();
    const createdAt = new Date().toISOString();
    const result = await env.DB.prepare(
      "INSERT INTO spins (number, created_at) VALUES (?, ?) RETURNING id, number, created_at",
    ).bind(number, createdAt).first<SpinRow>();

    if (!result) throw new Error("insert failed");
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
    return Response.json({ ok: true });
  } catch {
    return Response.json({ error: "削除できませんでした" }, { status: 500 });
  }
}
