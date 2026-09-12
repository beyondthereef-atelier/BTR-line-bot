import { Redis } from "@upstash/redis";
import type { IncomingMessage, ServerResponse } from "node:http";

/**
 * 本番サイトの健全性チェック（毎朝 Vercel Cron から実行）
 *
 * 2026-09-10に、テーマ公開時にお問い合わせページのテンプレートが消えたまま
 * 2日間気づかなかった事故が起きたため作成。
 * 異常を見つけたときだけ、担当者のLINEに通知する。
 *
 * 通知先は環境変数 SITE_CHECK_NOTIFY_TO（LINEのユーザーID）。
 * 同じ異常での通知は20時間に1回までに抑える（連続通知の防止）。
 */

const kv = new Redis({
  url: process.env.KV_REST_API_URL!,
  token: process.env.KV_REST_API_TOKEN!,
});

const NOTIFY_KEY = "site-check:last-notified";
const NOTIFY_TTL = 60 * 60 * 20; // 20時間

const BASE = "https://beyondthereef.jp";

interface Check {
  path: string;
  label: string;
  /** このページに必ず含まれていなければならない文字列 */
  mustContain: { token: string; name: string }[];
  /** これを下回ったら中身が抜け落ちている */
  minBytes: number;
}

const CHECKS: Check[] = [
  {
    path: "/pages/contact",
    label: "お問い合わせページ",
    mustContain: [
      { token: "btr-category", name: "カテゴリ選択" },
      { token: "ContactForm--", name: "フォーム本体" },
      { token: "btr-file-url", name: "画像アップロード欄" },
    ],
    minBytes: 100000,
  },
  {
    path: "/",
    label: "トップページ",
    mustContain: [{ token: "BEYOND THE REEF", name: "サイト名" }],
    minBytes: 50000,
  },
  {
    path: "/pages/faq",
    label: "よくあるご質問",
    mustContain: [],
    minBytes: 30000,
  },
  {
    path: "/cart",
    label: "カート",
    mustContain: [],
    minBytes: 20000,
  },
  {
    path: "/collections/all",
    label: "商品一覧",
    mustContain: [],
    minBytes: 30000,
  },
];

async function pushLine(text: string): Promise<boolean> {
  const token = process.env.LINE_CHANNEL_ACCESS_TOKEN;
  const to = process.env.SITE_CHECK_NOTIFY_TO;
  if (!token || !to) return false;

  const r = await fetch("https://api.line.me/v2/bot/message/push", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify({
      to,
      messages: [{ type: "text", text: text.slice(0, 4900) }],
    }),
  });
  return r.ok;
}

function themeName(html: string): string | null {
  const m = html.match(/Shopify\.theme = (\{.*?\});/s);
  if (!m) return null;
  try {
    return (JSON.parse(m[1]) as { name?: string }).name ?? null;
  } catch {
    return null;
  }
}

export default async function handler(_req: IncomingMessage, res: ServerResponse) {
  const problems: string[] = [];
  const checked: string[] = [];
  let theme: string | null = null;

  for (const chk of CHECKS) {
    let status = 0;
    let body = "";
    try {
      const r = await fetch(BASE + chk.path, {
        headers: { "User-Agent": "BTR-site-check/1.0" },
      });
      status = r.status;
      body = await r.text();
    } catch {
      problems.push(`${chk.label} に接続できません`);
      continue;
    }

    if (status !== 200) {
      problems.push(`${chk.label} が開けません（応答 ${status}）`);
      continue;
    }

    if (theme === null) theme = themeName(body);

    const size = new TextEncoder().encode(body).length;
    const missing = chk.mustContain
      .filter((c) => !body.includes(c.token))
      .map((c) => c.name);

    if (missing.length > 0) {
      problems.push(`${chk.label} から消えています → ${missing.join("、")}`);
    } else if (size < chk.minBytes) {
      problems.push(
        `${chk.label} の中身が異常に少ないです（${size.toLocaleString()}バイト）`
      );
    } else {
      checked.push(`OK ${chk.label}`);
    }
  }

  let notified = false;

  if (problems.length > 0) {
    // 同じ内容の通知が続かないよう、20時間は再通知しない
    const fingerprint = problems.join("|");
    const last = await kv.get<string>(NOTIFY_KEY);

    if (last !== fingerprint) {
      const msg =
        "⚠️ BTRサイト異常検知\n\n" +
        problems.map((p) => `・${p}`).join("\n") +
        `\n\n公開テーマ: ${theme ?? "不明"}\n\n` +
        "直前にテーマを公開・編集した人に確認してください。\n" +
        `${BASE}/pages/contact`;
      notified = await pushLine(msg);
      if (notified) await kv.set(NOTIFY_KEY, fingerprint, { ex: NOTIFY_TTL });
    }
  } else {
    // 復旧したら記録を消す（次の異常ですぐ通知できるように）
    await kv.del(NOTIFY_KEY);
  }

  res.setHeader("Content-Type", "application/json; charset=utf-8");
  res.end(
    JSON.stringify({
      result: problems.length > 0 ? "NG" : "OK",
      theme,
      problems,
      checked,
      notified,
      at: new Date().toISOString(),
    })
  );
}
