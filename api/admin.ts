import { Redis } from "@upstash/redis";
import type { IncomingMessage, ServerResponse } from "node:http";
import { HANDOFF_TTL, COOLDOWN_TTL } from "../src/state.js";

const kv = new Redis({
  url: process.env.KV_REST_API_URL!,
  token: process.env.KV_REST_API_TOKEN!,
});

export const config = { api: { bodyParser: false } };

interface Row {
  userId: string;
  name: string;
  category: string;
  at: string;
  returnAt: string;
}

interface StoredState {
  step?: string;
  category?: string;
  data?: Record<string, string>;
}

function esc(s: string): string {
  return s.replace(/[&<>"']/g, (c) =>
    ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c] as string));
}

function fmt(iso: string): string {
  if (!iso) return "";
  const d = new Date(iso);
  if (isNaN(d.getTime())) return "";
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getMonth() + 1}/${d.getDate()} ${p(d.getHours())}:${p(d.getMinutes())}`;
}

async function readBody(req: IncomingMessage): Promise<string> {
  const chunks: Buffer[] = [];
  for await (const chunk of req) chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  return Buffer.concat(chunks).toString("utf-8");
}

export default async function handler(req: IncomingMessage, res: ServerResponse) {
  const secret = process.env.ADMIN_SECRET ?? "";

  // 対応終了・対応に戻す（POSTのみ。誤クリック・プリフェッチ対策）
  if (req.method === "POST") {
    const params = new URLSearchParams(await readBody(req));
    if (params.get("key") !== secret) { res.writeHead(401); res.end("Unauthorized"); return; }
    const user = params.get("user");
    const action = params.get("action") ?? "finish";

    if (user) {
      const key = `state:${user}`;
      const st = await kv.get<StoredState>(key);
      if (st) {
        const data = { ...(st.data ?? {}) };
        if (action === "reopen") {
          // 対応に戻す。ボットは沈黙したまま、自動ではボットモードに戻らない
          delete data.botReturnAt;
          await kv.set(key, { step: "HANDOFF", category: st.category ?? "", data }, { ex: HANDOFF_TTL });
        } else {
          // 対応を終了。ここから COOLDOWN_TTL の間はボットが黙ったまま待ち、
          // 期限切れでキーごと消えて通常のボットモードに戻る
          data.botReturnAt = new Date(Date.now() + COOLDOWN_TTL * 1000).toISOString();
          await kv.set(key, { step: "COOLDOWN", category: st.category ?? "", data }, { ex: COOLDOWN_TTL });
        }
      }
    }

    res.writeHead(302, { Location: `/api/admin?key=${encodeURIComponent(secret)}` });
    res.end();
    return;
  }

  const url = new URL(req.url ?? "", "http://localhost");
  if (url.searchParams.get("key") !== secret) { res.writeHead(401); res.end("Unauthorized"); return; }

  // 担当者対応中(HANDOFF)と、終了処理後の待機中(COOLDOWN)のユーザーを集める
  const active: Row[] = [];
  const waiting: Row[] = [];
  let cursor = 0;
  let guard = 0;
  do {
    const [next, keys] = (await kv.scan(cursor, { match: "state:*", count: 100 })) as [string | number, string[]];
    cursor = Number(next);
    for (const k of keys) {
      const st = await kv.get<StoredState>(k);
      if (!st) continue;
      const row: Row = {
        userId: k.replace(/^state:/, ""),
        name: st.data?.name ?? "",
        category: st.category ?? "",
        at: st.data?.handoffAt ?? "",
        returnAt: st.data?.botReturnAt ?? "",
      };
      if (st.step === "HANDOFF" || st.step === "HANDOFF_CONFIRM") active.push(row);
      else if (st.step === "COOLDOWN") waiting.push(row);
    }
  } while (cursor !== 0 && ++guard < 50);

  active.sort((a, b) => b.at.localeCompare(a.at));
  waiting.sort((a, b) => a.returnAt.localeCompare(b.returnAt));

  const card = (h: Row, action: "finish" | "reopen") => {
    const label = action === "finish" ? "対応を終了" : "対応に戻す";
    const who = esc(h.name || "このお客様");
    const confirm = action === "finish"
      ? `${who}の担当者対応を終了しますか？\\n（2日間はボットが黙って待ち、その後ボットモードに戻ります）`
      : `${who}を担当者対応中に戻しますか？\\n（ボットは沈黙したままになります）`;
    const ret = action === "reopen" && h.returnAt
      ? `<div class="ret">${esc(fmt(h.returnAt))} にボットモードに戻ります</div>`
      : "";
    return `
    <div class="card">
      <div class="info">
        <div class="name">${esc(h.name || "（お名前未取得）")}</div>
        <div class="meta">${esc(h.category)}${h.at ? " ・ " + esc(fmt(h.at)) : ""}</div>
        ${ret}
      </div>
      <form method="POST" action="/api/admin" onsubmit="return confirm('${confirm}')">
        <input type="hidden" name="key" value="${esc(secret)}">
        <input type="hidden" name="user" value="${esc(h.userId)}">
        <input type="hidden" name="action" value="${action}">
        <button type="submit" class="${action === "reopen" ? "ghost" : ""}">${label}</button>
      </form>
    </div>`;
  };

  const activeRows = active.length
    ? active.map((h) => card(h, "finish")).join("")
    : `<p class="empty">現在、担当者対応中のお客様はいません。</p>`;
  const waitingRows = waiting.length
    ? waiting.map((h) => card(h, "reopen")).join("")
    : `<p class="empty">待機中のお客様はいません。</p>`;

  const html = `<!DOCTYPE html>
<html lang="ja"><head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex">
<title>BEYOND THE REEF公式LINE 担当者対応 管理</title>
<style>
  * { box-sizing: border-box; }
  body { font-family: -apple-system, "Hiragino Sans", sans-serif; background: #f4f6f8; color: #262626; margin: 0; padding: 20px; }
  .wrap { max-width: 640px; margin: 0 auto; }
  .brand { font-size: 12px; font-weight: 700; color: #2E75B6; letter-spacing: .04em; margin: 0 0 4px; }
  h1 { font-size: 20px; color: #1F4E79; margin: 0; }
  h2 { font-size: 16px; color: #1F4E79; margin: 28px 0 2px; padding-bottom: 6px; border-bottom: 2px solid #dce6f1; }
  .sub { color: #7f7f7f; font-size: 13px; margin: 6px 0 14px; }
  .card { background: #fff; border: 1px solid #e2e8f0; border-radius: 12px; padding: 14px 16px; margin-bottom: 12px; display: flex; align-items: center; justify-content: space-between; gap: 12px; }
  .name { font-weight: 700; font-size: 16px; }
  .meta { color: #7f7f7f; font-size: 13px; margin-top: 2px; }
  .ret { color: #2E75B6; font-size: 13px; font-weight: 700; margin-top: 4px; }
  button { background: #1F4E79; color: #fff; border: none; border-radius: 8px; padding: 10px 16px; font-size: 14px; font-weight: 700; cursor: pointer; white-space: nowrap; }
  button.ghost { background: #fff; color: #1F4E79; border: 1px solid #1F4E79; }
  button:active { opacity: .8; }
  .empty { color: #7f7f7f; text-align: center; padding: 28px 0; }
  .bar { display: flex; justify-content: space-between; align-items: center; margin-bottom: 4px; }
  .reload { color: #1F4E79; text-decoration: none; font-size: 14px; font-weight: 700; }
</style></head>
<body><div class="wrap">
  <div class="bar">
    <div><p class="brand">【 BEYOND THE REEF 公式LINE 】</p><h1>担当者対応 管理</h1></div>
    <a class="reload" href="/api/admin?key=${encodeURIComponent(secret)}">↻ 更新</a>
  </div>

  <h2>担当者対応中（${active.length}件）</h2>
  <p class="sub">対応が終わったら「対応を終了」を押してください</p>
  ${activeRows}

  <h2>対応済み（ボット待機中）（${waiting.length}件）</h2>
  <p class="sub">ボットが黙って待っている状態です。お礼ではなく新しいご質問が届いたら「対応に戻す」を押してください</p>
  ${waitingRows}
</div></body></html>`;

  res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
  res.end(html);
}
