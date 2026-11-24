import type { Message, QuickReply } from "@line/bot-sdk";

function qr(items: { label: string; data: string }[]): QuickReply {
  return {
    items: items.map(({ label, data }) => ({
      type: "action",
      action: { type: "postback", label, data, displayText: label },
    })),
  };
}

function text(t: string, quickReply?: QuickReply): Message {
  return quickReply ? { type: "text", text: t, quickReply } : { type: "text", text: t };
}

interface CarouselCard {
  title: string;
  imageUrl: string;
  linkUrl: string;
  utmCampaign: string;
  buttonLabel?: string;
  showOverlay?: boolean;
}

function withUtm(url: string, campaign: string): string {
  const u = new URL(url);
  u.searchParams.set("utm_source", "line");
  u.searchParams.set("utm_medium", "social");
  u.searchParams.set("utm_campaign", campaign);
  return u.toString();
}

const COUPON_CARD: CarouselCard = {
  title: "500円OFFクーポン",
  imageUrl: "https://res.cloudinary.com/qeubtw8q/image/upload/v1783042416/coupon-card-new_zccfqe.png",
  linkUrl: "https://beyondthereef.jp/discount/BTR-LINE?redirect=/",
  utmCampaign: "coupon",
  buttonLabel: "クーポンを使う（自動適用）",
};

const WELCOME_CARDS: CarouselCard[] = [
  { title: "オリゾン", imageUrl: "https://res.cloudinary.com/qeubtw8q/image/upload/v1783042416/3%E3%82%AA%E3%83%AA%E3%82%BD%E3%82%99%E3%83%B3_tc4jex.jpg", linkUrl: "https://beyondthereef.jp/collections/horizon", utmCampaign: "carousel_horizon", buttonLabel: "オリゾンを見る" },
  { title: "キット", imageUrl: "https://res.cloudinary.com/qeubtw8q/image/upload/v1783042415/6%E3%82%AD%E3%83%83%E3%83%88_gfqxka.jpg", linkUrl: "https://beyondthereef.jp/collections/kit", utmCampaign: "carousel_kit", buttonLabel: "キットを見る" },
  { title: "ワークショップ", imageUrl: "https://res.cloudinary.com/qeubtw8q/image/upload/v1783042415/4%E3%83%AF%E3%83%BC%E3%82%AF%E3%82%B7%E3%83%A7%E3%83%83%E3%83%95%E3%82%9A_u5coaw.jpg", linkUrl: "https://beyondthereef.jp/collections/workshop", utmCampaign: "carousel_workshop", buttonLabel: "ワークショップを見る" },
  { title: "新着アイテム", imageUrl: "https://res.cloudinary.com/qeubtw8q/image/upload/v1782999995/1%E6%96%B0%E7%9D%80%E3%82%A2%E3%82%A4%E3%83%86%E3%83%A0_zbrxey.jpg", linkUrl: "https://beyondthereef.jp/collections/feature", utmCampaign: "carousel_new_items" },
  { title: "ランキング", imageUrl: "https://res.cloudinary.com/qeubtw8q/image/upload/v1782999995/2%E3%83%A9%E3%83%B3%E3%82%AD%E3%83%B3%E3%82%AF%E3%82%99_tnmngv.jpg", linkUrl: "https://beyondthereef.jp/collections/ranking", utmCampaign: "carousel_ranking" },
  { title: "アトリエ店舗", imageUrl: "https://res.cloudinary.com/qeubtw8q/image/upload/v1783042416/5%E3%82%A2%E3%83%88%E3%83%AA%E3%82%A8_tymexl.jpg", linkUrl: "https://beyondthereef.jp/pages/atelier-event", utmCampaign: "carousel_atelier", buttonLabel: "アトリエ店舗を見る" },
];

export function welcomeGreeting(): Message {
  return text(
    "お友だち登録ありがとうございます🤍\n" +
    "BEYOND THE REEF公式LINEです。\n\n" +
    "ご登録のお礼に、お買い物にお使いいただけるクーポンをお届けいたします✨\n\n" +
    "新作のご案内やワークショップの情報のほか、このLINEだけでそっとお届けする情報なども、ご用意してまいります。お楽しみに！\n\n" +
    "BEYOND THE REEF"
  );
}

function overlayBubble(card: CarouselCard): object {
  const uri = withUtm(card.linkUrl, card.utmCampaign);
  return {
    type: "bubble",
    size: "kilo",
    body: {
      type: "box",
      layout: "vertical",
      paddingAll: "0px",
      contents: [
        {
          type: "image",
          url: card.imageUrl,
          size: "full",
          aspectRatio: "1:1",
          aspectMode: "cover",
          gravity: "top",
        },
        {
          type: "box",
          layout: "vertical",
          position: "absolute",
          offsetBottom: "0px",
          offsetStart: "0px",
          offsetEnd: "0px",
          backgroundColor: "#00000099",
          paddingAll: "12px",
          action: { type: "uri", uri },
          contents: [
            {
              type: "text",
              text: card.buttonLabel ?? "詳細はこちら",
              color: "#ffffff",
              align: "center",
              weight: "bold",
              size: "md",
              wrap: true,
            },
          ],
        },
      ],
    },
  };
}

export function welcomeCoupon(): Message {
  const uri = withUtm(COUPON_CARD.linkUrl, COUPON_CARD.utmCampaign);
  return {
    type: "flex",
    altText: "500円OFFクーポンのご案内",
    contents: {
      type: "bubble",
      size: "giga",
      hero: {
        type: "image",
        url: COUPON_CARD.imageUrl,
        size: "full",
        aspectRatio: "1:1",
        aspectMode: "cover",
        action: { type: "uri", label: COUPON_CARD.buttonLabel ?? "詳細はこちら", uri },
      },
    },
  };
}

export function welcomeCarousel(): Message {
  return {
    type: "flex",
    altText: "BEYOND THE REEF公式LINEへようこそ！",
    contents: {
      type: "carousel",
      contents: WELCOME_CARDS.map((card) => overlayBubble(card)),
    },
  };
}

export function confirmRestart(): Message {
  return {
    type: "text",
    text: "現在、担当者が対応中です🙇\n新しいお問い合わせを始めますか？",
    quickReply: {
      items: [
        { type: "action", action: { type: "message", label: "はい（新しく始める）", text: "はい" } },
        { type: "action", action: { type: "message", label: "いいえ（そのまま）", text: "いいえ" } },
      ],
    },
  };
}

export function categoryMenu(): Message {
  return text(
    "こんにちは！BEYOND THE REEF公式LINEです😊\n\nまず、お問い合わせのカテゴリをお選びください。",
    qr([
      { label: "📦 ご購入のお客様", data: "cat:purchase" },
      { label: "🔧 修理・メンテナンス", data: "cat:repair" },
      { label: "🙋 一般（購入前）", data: "cat:general" },
      { label: "🧵 ワークショップ・講座", data: "cat:workshop" },
    ])
  );
}

export function askEmail(): Message {
  return text("メールアドレスを入力してください。\n（例：example@email.com）");
}

export function askOrderNo(): Message {
  return {
    type: "text",
    text: "ご注文番号（4桁または5桁）を入力してください。\n（例：1234）\n（わからない場合は下のボタンでスキップできます）",
    quickReply: {
      items: [
        { type: "action", action: { type: "message", label: "スキップ", text: "スキップ" } },
      ],
    },
  };
}

export function askName(): Message {
  return text("お客様のお名前を入力してください。");
}

export function askDetail(): Message {
  return text("お問い合わせの詳細をご記入ください。");
}

export function askAddressDetail(): Message {
  return text(
    "新しいお届け先ご住所をご記入ください。\n" +
    "（例：〒223-0062 神奈川県横浜市港北区日吉本町1-24-8）"
  );
}

export function askNewEmailDetail(): Message {
  return text("新しいメールアドレスをご記入ください。\n（例：example@email.com）");
}

export function askPhoto(): Message {
  return {
    type: "text",
    text: "商品の写真があれば送ってください📷\n（不要な場合は下のボタンでスキップできます）",
    quickReply: {
      items: [
        { type: "action", action: { type: "message", label: "スキップ", text: "スキップ" } },
      ],
    },
  };
}

export function purchaseTypeMenu(): Message {
  return text(
    "お問い合わせの種類をお選びください。",
    qr([
      { label: "📋 注文内容の確認", data: "ptype:order_check" },
      { label: "📍 お届け先住所の変更", data: "ptype:address" },
      { label: "🚚 配送状況・日時変更", data: "ptype:delivery" },
      { label: "⚠️ 商品に不備がある", data: "ptype:defect" },
    ])
  );
}

export function generalTypeMenu(): Message {
  return text(
    "お問い合わせの種類をお選びください。",
    qr([
      { label: "🧶 商品仕様について", data: "gtype:product_spec" },
      { label: "🛒 商品販売について", data: "gtype:product_sale" },
      { label: "🔐 ログインできない", data: "gtype:login" },
      { label: "📧 メルマガが届かない", data: "gtype:newsletter" },
      { label: "✉️ 登録メアドの変更", data: "gtype:email_change" },
      { label: "🗑️ アカウント削除", data: "gtype:delete" },
      { label: "💬 その他", data: "gtype:other" },
    ])
  );
}

export function workshopTypeMenu(): Message {
  return text(
    "お問い合わせの種類をお選びください。",
    qr([
      { label: "📚 講座の内容・カリキュラム", data: "wtype:curriculum" },
      { label: "📅 日程・スケジュール", data: "wtype:schedule" },
      { label: "🎯 受講資格・レベル相談", data: "wtype:level" },
      { label: "💳 申込・支払い方法", data: "wtype:payment" },
      { label: "💬 その他", data: "wtype:other" },
    ])
  );
}

export function inquiryComplete(): Message {
  return text(
    "お問い合わせありがとうございました。\n" +
    "内容を確認次第、担当者より改めてご連絡いたします。\n\n" +
    "※返信は翌営業日以降、順次対応いたします。\n" +
    "※土日祝・お盆・年末年始は休業となります。\n" +
    "※営業時間：11:00〜17:00"
  );
}
