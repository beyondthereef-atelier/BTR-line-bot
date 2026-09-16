import { Redis } from "@upstash/redis";

const kv = new Redis({
  url: process.env.KV_REST_API_URL!,
  token: process.env.KV_REST_API_TOKEN!,
});

export type Step =
  | "CATEGORY"
  // 1. ご購入のお客様
  | "P_EMAIL" | "P_ORDER" | "P_NAME" | "P_TYPE" | "P_DETAIL" | "P_PHOTO"
  // 2. 修理・メンテナンス
  | "R_EMAIL" | "R_ORDER" | "R_NAME" | "R_DETAIL" | "R_PHOTO"
  // 3. 一般（購入前）
  | "G_EMAIL" | "G_NAME" | "G_TYPE" | "G_DETAIL" | "G_PHOTO"
  // 4. ワークショップ
  | "W_EMAIL" | "W_NAME" | "W_TYPE" | "W_DETAIL"
  // 担当者対応中（ボットは沈黙）
  | "HANDOFF"
  // 担当者対応中に「お問い合わせ」等が押されたときの確認ステップ
  | "HANDOFF_CONFIRM"
  // 終了処理の後、ボットが黙ったまま待つ期間
  | "COOLDOWN";

export interface UserState {
  step: Step;
  category?: string;
  data?: Record<string, string>;
}

const TTL = 60 * 60 * 24;
// 担当者対応中は長め（7日間）に保持。お客様が再度「お問い合わせ」等を送るまでボットは沈黙する。
export const HANDOFF_TTL = 60 * 60 * 24 * 7;
// 終了処理の後、ボットが黙ったまま待つ期間（2日間）。
// 対応終了の直後にお客様が送ってくださる「ありがとうございました」に、
// ボットが新しい問い合わせとして反応してしまうのを防ぐための時間。
export const COOLDOWN_TTL = 60 * 60 * 24 * 2;

export async function getState(userId: string): Promise<UserState | null> {
  return kv.get<UserState>(`state:${userId}`);
}

export async function setState(userId: string, state: UserState, ttlSeconds: number = TTL): Promise<void> {
  await kv.set(`state:${userId}`, state, { ex: ttlSeconds });
}

export async function clearState(userId: string): Promise<void> {
  await kv.del(`state:${userId}`);
}
