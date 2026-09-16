import type { messagingApi } from "@line/bot-sdk";
import type { Message } from "@line/bot-sdk";
import { getState, setState, clearState, HANDOFF_TTL } from "./state.js";
import { uploadImageToDrive } from "./drive.js";
import {
  categoryMenu, confirmRestart,
  askEmail, askOrderNo, askName, askDetail, askPhoto,
  askAddressDetail, askNewEmailDetail,
  purchaseTypeMenu, generalTypeMenu, workshopTypeMenu,
  welcomeGreeting, welcomeCoupon, welcomeCarousel,
} from "./messages.js";

const PURCHASE_TYPES: Record<string, string> = {
  "ptype:order_check": "注文内容のご確認",
  "ptype:address":     "お届け先住所の変更",
  "ptype:delivery":    "配送状況・配送日時変更",
  "ptype:defect":      "商品に不備・お気づきの点がある",
};

const GENERAL_TYPES: Record<string, string> = {
  "gtype:product_spec":  "商品仕様について",
  "gtype:product_sale":  "商品販売について",
  "gtype:login":         "ログインできない",
  "gtype:newsletter":    "メルマガが届かない",
  "gtype:email_change":  "登録メアドの変更",
  "gtype:delete":        "アカウントの削除",
  "gtype:other":         "その他",
};

const WORKSHOP_TYPES: Record<string, string> = {
  "wtype:curriculum": "講座の内容・カリキュラム",
  "wtype:schedule":   "日程・スケジュール",
  "wtype:level":      "受講資格・レベル相談",
  "wtype:payment":    "お申し込み・お支払い方法",
  "wtype:other":      "その他",
};

const RESET_KEYWORDS = ["お問い合わせ", "問い合わせ", "メニュー", "最初から", "トップ"];

export async function handleFollow(
  client: messagingApi.MessagingApiClient,
  userId: string,
  replyToken: string
): Promise<void> {
  // 友だち追加（再登録含む）時は状態をリセットし、まっさらな状態に戻す。
  // （担当者対応中のまま再登録してボットが沈黙し続けるのを防ぐ）
  await clearState(userId);
  await client.replyMessage({ replyToken, messages: [welcomeGreeting(), welcomeCoupon(), welcomeCarousel()] });
}

export async function handlePostback(
  client: messagingApi.MessagingApiClient,
  userId: string,
  replyToken: string,
  data: string
): Promise<void> {
  const reply = (msgs: Message | Message[]) =>
    client.replyMessage({ replyToken, messages: Array.isArray(msgs) ? msgs : [msgs] });

  if (data === "cat:purchase") {
    await setState(userId, { step: "P_EMAIL", category: "ご購入のお客様", data: {} });
    await reply(askEmail());
    return;
  }
  if (data === "cat:repair") {
    await setState(userId, { step: "R_EMAIL", category: "修理・メンテナンス", data: {} });
    await reply(askEmail());
    return;
  }
  if (data === "cat:general") {
    await setState(userId, { step: "G_EMAIL", category: "一般（購入前）", data: {} });
    await reply(askEmail());
    return;
  }
  if (data === "cat:workshop") {
    await setState(userId, { step: "W_EMAIL", category: "ワークショップ・養成講座", data: {} });
    await reply(askEmail());
    return;
  }

  if (data in PURCHASE_TYPES) {
    const state = await getState(userId);
    if (!state) { await reply(categoryMenu()); return; }
    await setState(userId, {
      ...state,
      step: "P_DETAIL",
      data: { ...state.data, inquiryType: PURCHASE_TYPES[data], needsPhoto: data === "ptype:defect" ? "1" : "" },
    });
    await reply(data === "ptype:address" ? askAddressDetail() : askDetail());
    return;
  }

  if (data in GENERAL_TYPES) {
    const state = await getState(userId);
    if (!state) { await reply(categoryMenu()); return; }
    await setState(userId, { ...state, step: "G_DETAIL", data: { ...state.data, inquiryType: GENERAL_TYPES[data] } });
    await reply(data === "gtype:email_change" ? askNewEmailDetail() : askDetail());
    return;
  }

  if (data in WORKSHOP_TYPES) {
    const state = await getState(userId);
    if (!state) { await reply(categoryMenu()); return; }
    await setState(userId, { ...state, step: "W_DETAIL", data: { ...state.data, inquiryType: WORKSHOP_TYPES[data] } });
    await reply(askDetail());
    return;
  }
}

export async function handleText(
  client: messagingApi.MessagingApiClient,
  userId: string,
  replyToken: string,
  text: string,
  groupId?: string
): Promise<void> {
  if (groupId) {
    console.log("groupId:", groupId);
    return;
  }

  const reply = (msgs: Message | Message[]) =>
    client.replyMessage({ replyToken, messages: Array.isArray(msgs) ? msgs : [msgs] });

  const state = await getState(userId);

  // 担当者対応中に「お問い合わせ」等が押された後の確認ステップ。
  // 「はい」だけ新しい問い合わせを開始。それ以外は担当者対応に戻す（誤タップ対策）。
  if (state && state.step === "HANDOFF_CONFIRM") {
    if (text.trim() === "はい") {
      await setState(userId, { step: "CATEGORY" });
      await reply(categoryMenu());
    } else {
      await setState(userId, { step: "HANDOFF", category: state.category, data: state.data }, HANDOFF_TTL);
      if (text.trim() === "いいえ") {
        await reply({ type: "text", text: "承知しました。引き続き担当者が対応いたします😊" });
      }
    }
    return;
  }

  // リセットキーワード（お問い合わせ・メニュー等）。
  if (RESET_KEYWORDS.includes(text.trim())) {
    // 担当者対応中は、誤タップ対策で一度確認してから戻す。
    if (state && state.step === "HANDOFF") {
      await setState(userId, { step: "HANDOFF_CONFIRM", category: state.category, data: state.data }, HANDOFF_TTL);
      await reply(confirmRestart());
      return;
    }
    await setState(userId, { step: "CATEGORY" });
    await reply(categoryMenu());
    return;
  }

  // 担当者対応中はボットは沈黙し、スタッフの手動対応に任せる。
  // 終了処理の後の待機中（COOLDOWN）も、「ありがとうございました」等のお礼に
  // ボットが反応してしまわないよう、同じく沈黙する。
  if (state && (state.step === "HANDOFF" || state.step === "COOLDOWN")) {
    return;
  }

  if (!state || state.step === "CATEGORY") {
    await setState(userId, { step: "CATEGORY" });
    await reply(categoryMenu());
    return;
  }

  const d = state.data ?? {};

  switch (state.step) {
    case "P_EMAIL":
      await setState(userId, { ...state, step: "P_ORDER", data: { ...d, email: text } });
      await reply(askOrderNo());
      break;
    case "P_ORDER":
      await setState(userId, { ...state, step: "P_NAME", data: { ...d, orderNo: text.trim() === "スキップ" ? "不明" : text } });
      await reply(askName());
      break;
    case "P_NAME":
      await setState(userId, { ...state, step: "P_TYPE", data: { ...d, name: text } });
      await reply(purchaseTypeMenu());
      break;
    case "P_DETAIL":
      if (d.needsPhoto === "1") {
        await setState(userId, { ...state, step: "P_PHOTO", data: { ...d, detail: text } });
        await reply(askPhoto());
      } else {
        await finishInquiry(client, userId, replyToken, state.category ?? "", { ...d, detail: text });
      }
      break;
    case "P_PHOTO":
      await finishInquiry(client, userId, replyToken, state.category ?? "", {
        ...d, photo: text.trim() === "スキップ" ? "なし" : text,
      });
      break;

    case "R_EMAIL":
      await setState(userId, { ...state, step: "R_ORDER", data: { ...d, email: text } });
      await reply(askOrderNo());
      break;
    case "R_ORDER":
      await setState(userId, { ...state, step: "R_NAME", data: { ...d, orderNo: text.trim() === "スキップ" ? "不明" : text } });
      await reply(askName());
      break;
    case "R_NAME":
      await setState(userId, { ...state, step: "R_DETAIL", data: { ...d, name: text } });
      await reply(askDetail());
      break;
    case "R_DETAIL":
      await setState(userId, { ...state, step: "R_PHOTO", data: { ...d, detail: text } });
      await reply(askPhoto());
      break;
    case "R_PHOTO":
      await finishInquiry(client, userId, replyToken, state.category ?? "", {
        ...d, photo: text.trim() === "スキップ" ? "なし" : text,
      });
      break;

    case "G_EMAIL":
      await setState(userId, { ...state, step: "G_NAME", data: { ...d, email: text } });
      await reply(askName());
      break;
    case "G_NAME":
      await setState(userId, { ...state, step: "G_TYPE", data: { ...d, name: text } });
      await reply(generalTypeMenu());
      break;
    case "G_DETAIL":
      await finishInquiry(client, userId, replyToken, state.category ?? "", { ...d, detail: text });
      break;

    case "W_EMAIL":
      await setState(userId, { ...state, step: "W_NAME", data: { ...d, email: text } });
      await reply(askName());
      break;
    case "W_NAME":
      await setState(userId, { ...state, step: "W_TYPE", data: { ...d, name: text } });
      await reply(workshopTypeMenu());
      break;
    case "W_DETAIL":
      await finishInquiry(client, userId, replyToken, state.category ?? "", {
        ...d, detail: text,
      });
      break;

    default:
      await setState(userId, { step: "CATEGORY" });
      await reply(categoryMenu());
  }
}

export async function handleImage(
  client: messagingApi.MessagingApiClient,
  userId: string,
  replyToken: string,
  messageId: string
): Promise<void> {
  const reply = (msgs: Message | Message[]) =>
    client.replyMessage({ replyToken, messages: Array.isArray(msgs) ? msgs : [msgs] });

  const state = await getState(userId);
  if (!state) { await reply(categoryMenu()); return; }

  // 担当者対応中・終了処理後の待機中は画像にも反応しない
  if (state.step === "HANDOFF" || state.step === "HANDOFF_CONFIRM" || state.step === "COOLDOWN") { return; }

  const photoSteps = ["P_PHOTO", "R_PHOTO"];
  if (photoSteps.includes(state.step)) {
    const token = process.env.LINE_CHANNEL_ACCESS_TOKEN ?? "";
    const res = await fetch(`https://api-data.line.me/v2/bot/message/${messageId}/content`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    const buffer = Buffer.from(await res.arrayBuffer());
    const filename = `inquiry_${Date.now()}.jpg`;
    const driveLink = await uploadImageToDrive(buffer, filename);

    await finishInquiry(client, userId, replyToken, state.category ?? "", {
      ...state.data,
      photo: driveLink,
    });
  }
}

export async function handleOther(
  client: messagingApi.MessagingApiClient,
  userId: string,
  replyToken: string
): Promise<void> {
  const reply = (msgs: Message | Message[]) =>
    client.replyMessage({ replyToken, messages: Array.isArray(msgs) ? msgs : [msgs] });

  const state = await getState(userId);

  // 担当者対応中・終了処理後の待機中は沈黙
  if (state && (state.step === "HANDOFF" || state.step === "HANDOFF_CONFIRM" || state.step === "COOLDOWN")) { return; }

  // 写真ステップなら、改めて画像かスキップを促す
  if (state && (state.step === "P_PHOTO" || state.step === "R_PHOTO")) {
    await reply(askPhoto());
    return;
  }

  // それ以外の未対応メッセージ（動画・スタンプ等）への案内。メニューで復帰できる。
  await reply({
    type: "text",
    text: "恐れ入りますが、メッセージはテキストでお送りください🙏\n最初からやり直す場合は下のボタンを押してください。",
    quickReply: {
      items: [
        { type: "action", action: { type: "message", label: "メニュー", text: "メニュー" } },
      ],
    },
  });
}

async function finishInquiry(
  client: messagingApi.MessagingApiClient,
  userId: string,
  replyToken: string,
  category: string,
  data: Record<string, string>
): Promise<void> {
  // 問い合わせ完了後は「担当者対応中」に切り替え、ボットは沈黙する。
  // お客様が「お問い合わせ」等（RESET_KEYWORDS）を送ると通常フローに戻る。
  // 管理ページ（/api/admin）で一覧表示するため、お名前・カテゴリ・日時を保存する。
  await setState(userId, {
    step: "HANDOFF",
    category,
    data: { name: data.name ?? "", handoffAt: new Date().toISOString() },
  }, HANDOFF_TTL);

  await client.replyMessage({
    replyToken,
    messages: [{
      type: "text",
      text: "お問い合わせありがとうございました。\n内容を確認次第、担当者より改めてご連絡いたします。\n\n※返信は翌営業日以降、順次対応いたします。\n※土日祝・お盆・年末年始は休業となります。\n※営業時間：11:00〜17:00",
    }],
  });
}
