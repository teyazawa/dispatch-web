// server/server.js
require("dotenv").config();
const express = require("express");
const axios = require("axios");
const cors = require("cors");

const app = express();

// kintone 共通
const SUBDOMAIN = process.env.KINTONE_SUBDOMAIN;

// ドライバー
const DRIVER_APP_ID = process.env.KINTONE_DRIVER_APP_ID;
const DRIVER_API_TOKEN = process.env.KINTONE_DRIVER_API_TOKEN;

// 車両
const TRUCK_APP_ID = process.env.KINTONE_TRUCK_APP_ID;
const TRUCK_API_TOKEN = process.env.KINTONE_TRUCK_API_TOKEN;

// ★ シャーシ
const CHASSIS_APP_ID = process.env.KINTONE_CHASSIS_APP_ID;
const CHASSIS_API_TOKEN = process.env.KINTONE_CHASSIS_API_TOKEN;

// ★ コンテナ
const CONTAINER_APP_ID = process.env.KINTONE_CONTAINER_APP_ID;
const CONTAINER_API_TOKEN = process.env.KINTONE_CONTAINER_API_TOKEN;


function shouldSkipDestination(destRaw) {
  const s = (destRaw ?? "").toString().trim();
  if (!s) return false;

  // 大文字小文字・全角半角ゆれをある程度吸収したいなら必要に応じて追加
  const u = s.toUpperCase();

  // 「含むなら除外」
  return u.includes("FEEDER") || u.includes("POSITION");
}

function stripCompanyTokens(destRaw) {
  let s = (destRaw ?? "").toString().trim();
  if (!s) return "";

  s = s.replace(/\s+/g, " ");

  // 前後に付く法人格
  s = s
    .replace(/^\s*(株式会社|（株）|\(株\)|有限会社|（有）|\(有\)|合同会社|（同）|\(同\)|合資会社|合名会社)\s*/g, "")
    .replace(/\s*(株式会社|（株）|\(株\)|有限会社|（有）|\(有\)|合同会社|（同）|\(同\)|合資会社|合名会社)\s*$/g, "");

  // 文中に紛れた最低限の除去（過剰に消さないため控えめ）
  s = s
    .replace(/\s*(株式会社|有限会社|合同会社)\s*/g, " ")
    .replace(/\s*(（株）|\(株\)|（有）|\(有\)|（同）|\(同\))\s*/g, " ")
    .replace(/\s+/g, " ")
    .trim();

  return s;
}


app.use(cors());
app.use(express.json());

// server/server.js のどこか（app 定義のあと）に

const nodemailer = require("nodemailer");

const mailTransporter = nodemailer.createTransport({
  host: process.env.MAIL_HOST,
  port: Number(process.env.MAIL_PORT || 587),
  secure: false,
  auth: {
    user: process.env.MAIL_USER,
    pass: process.env.MAIL_PASS,
  },
});

async function sendMail({ to, subject, text, html }) {
  const from = process.env.MAIL_FROM || process.env.MAIL_USER;
  return mailTransporter.sendMail({ from, to, subject, text, html });
}

app.post("/api/send-driver-mail", async (req, res) => {
  try {
    const { to, subject, text, html } = req.body;
    if (!to || !subject || !(text || html)) {
      return res
        .status(400)
        .json({ error: "to / subject / text(html) は必須です" });
    }

    await sendMail({ to, subject, text, html });
    res.json({ ok: true });
  } catch (err) {
    console.error("===== メール送信エラー =====");
    console.error("msg:", err.message);
    console.error("stack:", err.stack);
    console.error("====================================");
    res.status(500).json({
      error: "メール送信に失敗しました",
      detail: err.message,
    });
  }
});





/**
 * GET /api/drivers
 * 在籍ドライバー一覧を取得
 */
app.get("/api/drivers", async (req, res) => {
  try {
    if (!SUBDOMAIN || !DRIVER_APP_ID || !DRIVER_API_TOKEN) {
      console.error("Driver API env missing", {
        SUBDOMAIN,
        DRIVER_APP_ID,
        hasToken: !!DRIVER_API_TOKEN,
      });
      return res.status(500).json({ error: "Missing env (DRIVER)" });
    }

    const url = `https://${SUBDOMAIN}.cybozu.com/k/v1/records.json`;

    const params = {
      app: DRIVER_APP_ID,
      // 並び順はお好みで（略称 or 並び順フィールド）
      query: 'ドライバー_状態 in ("在籍") order by ドライバー_略称 asc',
    };

    const kintoneRes = await axios.get(url, {
      headers: {
        "X-Cybozu-API-Token": DRIVER_API_TOKEN,
      },
      params,
    });

    const records = kintoneRes.data.records || [];

    const drivers = records.map((r) => ({
      id: r.$id.value,
      name: r["ドライバー_略称"].value,
      status: r["ドライバー_状態"].value,
      baseTruckNo: r["ドライバー_車両"].value,
      email: r["ドライバー_メール"].value,
      driverType: r["ドライバー_区分"]?.value ?? "",
      // ドレー / ポジ / ガレージ / 山翔 / セトリヤマ … を入れるフィールド
      // フィールドコードは、もし別ならここを書き換えてください
      driverGroup: r["ドライバー_グループ"]?.value ?? "",
    }));

    res.json({ drivers });
  } catch (err) {
    console.error("===== kintone driver error =====");
    console.error("status:", err.response?.status);
    console.error("data  :", err.response?.data);
    console.error("msg   :", err.message);
    console.error("================================");
    res.status(500).json({
      error: "Failed to fetch drivers from kintone",
      status: err.response?.status,
      detail: err.response?.data || err.message,
    });
  }
});

/**
 * GET /api/trucks
 * 使用中の車両だけ取得
 */
app.get("/api/trucks", async (req, res) => {
  try {
    if (!SUBDOMAIN || !TRUCK_APP_ID || !TRUCK_API_TOKEN) {
      console.error("Truck API env missing", {
        SUBDOMAIN,
        TRUCK_APP_ID,
        hasToken: !!TRUCK_API_TOKEN,
      });
      return res.status(500).json({ error: "Missing env (TRUCK)" });
    }

    const url = `https://${SUBDOMAIN}.cybozu.com/k/v1/records.json`;

    const params = {
      app: TRUCK_APP_ID,
      query: '車両_状態 in ("稼働") order by 車両_番号 asc',
    };

    const kintoneRes = await axios.get(url, {
      headers: {
        "X-Cybozu-API-Token": TRUCK_API_TOKEN,
      },
      params,
    });

    const records = kintoneRes.data.records || [];

    const trucks = records.map((r) => ({
      id: r.$id.value,
      number: r["車両_番号"].value,  // カードに出す番号
      carNo: r["車両_車番"].value,   // ホバー時に出す車番
      status: r["車両_状態"].value,
    }));

    res.json({ trucks });
  } catch (err) {
    console.error("===== kintone truck error =====");
    console.error("status:", err.response?.status);
    console.error("data  :", err.response?.data);
    console.error("msg   :", err.message);
    console.error("================================");
    res.status(500).json({
      error: "Failed to fetch trucks from kintone",
      status: err.response?.status,
      detail: err.response?.data || err.message,
    });
  }
});

/**
 * /api/chassis
 * シャーシアプリから「廃車以外」のシャーシだけ取得
 */
app.get("/api/chassis", async (req, res) => {
  try {
    if (!SUBDOMAIN || !CHASSIS_APP_ID || !CHASSIS_API_TOKEN) {
      console.error("シャーシAPI 環境変数不足", {
        SUBDOMAIN,
        CHASSIS_APP_ID,
        hasToken: !!CHASSIS_API_TOKEN,
      });
      return res.status(500).json({ error: "環境変数不足（CHASSIS）" });
    }

    const url = `https://${SUBDOMAIN}.cybozu.com/k/v1/records.json`;

    const params = {
      app: CHASSIS_APP_ID,
      // 廃車以外（稼働・修理など）だけ取る
      query: 'シャーシ_状態 in ("稼働","修理") order by シャーシ_番号 asc',
    };

    const kintoneRes = await axios.get(url, {
      headers: {
        "X-Cybozu-API-Token": CHASSIS_API_TOKEN,
      },
      params,
    });

    const records = kintoneRes.data.records || [];

    const chassis = records.map((r) => {
      const sizeRaw = r["シャーシ_サイズ"].value;   // 例: "20F" / "40F"
      const kindRaw = r["シャーシ_種別"].value;     // 例: "1軸" / "2軸" / "3軸" / "MG" / "2個積み" / "兼用"
      const noteRaw = r["シャーシ_備考"]?.value ?? "";

      // ★ Size 型用に "20" | "40" に変換
      const size = sizeRaw === "40F" ? "40" : "20";

      // ★ AxleKind 型用に変換（兼用も追加）
      let axle;
      switch (kindRaw) {
        case "1軸":
          axle = "1";
          break;
        case "2軸":
          axle = "2";
          break;
        case "3軸":
          axle = "3";
          break;
        case "2個積":
        case "2個積み":
          axle = "2stack";
          break;
        case "兼用":
          axle = "both";          // ← 兼用用の新しい種別
          break;
        case "MG":
        default:
          axle = "MG";
          break;
      }

      return {
        id: r.$id.value,
        displayNo: r["シャーシ_番号"].value,   // カードに表示する番号
        carNo: r["シャーシ_車番"].value,       // ホバー用の車番
        size,                                  // "20" | "40"
        sizeLabel: sizeRaw,                    // "20F" / "40F"（表示用）
        axle,                                  // "1" | "2" | "3" | "MG" | "2stack" | "both"
        kindLabel: kindRaw,                    // "1軸" などの日本語表示
        note: noteRaw,
        status: r["シャーシ_状態"].value,
      };
    });

    res.json({ chassis });
  } catch (err) {
    console.error("===== kintone シャーシエラー =====");
    console.error("status:", err.response?.status);
    console.error("data  :", err.response?.data);
    console.error("msg   :", err.message);
    console.error("====================================");
    res.status(500).json({
      error: "kintone からシャーシ取得に失敗しました",
      status: err.response?.status,
      detail: err.response?.data || err.message,
    });
  }
});


function resolvePickupYardGroup(pickupYard) {
  const text = (pickupYard ?? "").toString().trim();

  if (!text) return ""; // 何も入ってなければグループなし

  if (text.includes("大井")) return "大井";
  if (text.includes("青海")) return "青海";
  if (text.includes("品川")) return "品川";
  if (text.includes("本牧")) return "本牧";
  if (text.includes("中防")) return "中防";

  return "その他";
 }

/**
 * /api/containers
 * コンテナアプリから「配車_連携 = 未」だけ取得して、
 * 取得したものは「済」に更新する
 */
app.get("/api/containers", async (req, res) => {
  try {
    if (!SUBDOMAIN || !CONTAINER_APP_ID || !CONTAINER_API_TOKEN) {
      console.error("コンテナAPI 環境変数不足", {
        SUBDOMAIN,
        CONTAINER_APP_ID,
        hasToken: !!CONTAINER_API_TOKEN,
      });
      return res.status(500).json({ error: "環境変数不足（CONTAINER）" });
    }

    const baseUrl = `https://${SUBDOMAIN}.cybozu.com/k/v1`;

//    const getParams = {
//     app: CONTAINER_APP_ID,
//     query: 'order by 配送日 asc',
//    };

    // ① 「配車_連携 = 未」だけ取得（＋配送先に FEEDER/POSITION を含むものは除外）
    const getParams = {
      app: CONTAINER_APP_ID,
      query:
        '配車_連携 in ("未")' +
        ' and 配送先_配送依頼 not like "FEEDER"' +
        ' and 配送先_配送依頼 not like "POSITION"' +
        " order by 配送日 asc",
    };

    const getRes = await axios.get(`${baseUrl}/records.json`, {
      headers: {
        "X-Cybozu-API-Token": CONTAINER_API_TOKEN,
      },
      params: getParams,
    });

    const records = getRes.data.records || [];

    // 0件ならそのまま返す
    if (records.length === 0) {
      return res.json({ containers: [] });
    }

    // ★保険：アプリ内でも除外（そして “除外したものは済にしない”）
    const eligibleRecords = records.filter((r) => {
      const destinationRaw = (r["配送先_配送依頼"]?.value ?? "").toString();
      return !shouldSkipDestination(destinationRaw);
    });

    // eligibleが0件なら、更新もせず返す
    if (eligibleRecords.length === 0) {
      return res.json({ containers: [] });
    }

    // ② レスポンス用に整形（法人格除去は表示用）
    const containers = eligibleRecords.map((r) => {
      const pickupYard = (r["搬出"]?.value ?? "").toString();
      const pickupYardGroup = resolvePickupYardGroup(pickupYard);

      const sizeRaw = (r["サイズ"]?.value ?? "").toString();
      let size = "20";
      if (sizeRaw.includes("40")) size = "40";

      const rawDate = (r["配送日"]?.value ?? "").toString();
      let date = "";
      if (rawDate) {
        const [, mm, dd] = rawDate.split("-");
        if (mm && dd) date = `${mm}/${dd}`;
      }

      const eta             = (r["着時間0"]?.value ?? "").toString();
      const dropoffOverride = (r["搬入_配車上書き"]?.value ?? "").toString().trim();
      const dropoffBase     = (r["搬入"]?.value ?? "").toString().trim();
      const dropoffYard     = dropoffOverride || dropoffBase;

      const destinationRaw  = (r["配送先_配送依頼"]?.value ?? "").toString();
      const destination     = stripCompanyTokens(destinationRaw);

      const destadd     = (r["配送先住所"]?.value ?? "").toString();
      const desttel     = (r["連絡先電話番号"]?.value ?? "").toString();
      const no          = (r["コンテナ番号_配送依頼"]?.value ?? "").toString();
      const ship        = (r["本船名_配送依頼"]?.value ?? "").toString();
      const booking     = (r["BL_BK"]?.value ?? "").toString();
      const kindCode    = (r["種類"]?.value ?? "").toString();

      return {
        id: r.$id.value,
        size,
        date,
        eta,
        pickupYard,
        pickupYardGroup,
        dropoffYard,
        destination,
        destadd,
        desttel,
        no,
        ship,
        booking,
        kindCode,
      };
    });

    // ③ 取得したレコードの「配車_連携」を「済」に更新（※eligibleだけ）
    const updateBody = {
      app: CONTAINER_APP_ID,
      records: eligibleRecords.map((r) => ({
        id: r.$id.value,
        record: {
          配車_連携: { value: ["済"] },
        },
      })),
    };

    await axios.put(`${baseUrl}/records.json`, updateBody, {
      headers: {
        "X-Cybozu-API-Token": CONTAINER_API_TOKEN,
        "Content-Type": "application/json",
      },
    });

    // ④ フロントに新規コンテナだけ返す
    res.json({ containers });
  } catch (err) {
    console.error("===== kintone コンテナエラー =====");
    console.error("status:", err.response?.status);
    console.error("data  :", err.response?.data);
    console.error("msg   :", err.message);
    console.error("====================================");
    res.status(500).json({
      error: "kintone からコンテナ取得に失敗しました",
      status: err.response?.status,
      detail: err.response?.data || err.message,
    });
  }
});

app.get("/api/containers/updates", async (req, res) => {
  try {
    const baseUrl = `https://${SUBDOMAIN}.cybozu.com/k/v1`;

    const getParams = {
      app: CONTAINER_APP_ID,
      query: '配車_更新 in ("未") order by 更新日時 asc',
    };

    const getRes = await axios.get(`${baseUrl}/records.json`, {
      headers: { "X-Cybozu-API-Token": CONTAINER_API_TOKEN },
      params: getParams,
    });

    const records = getRes.data.records || [];
    if (records.length === 0) return res.json({ containers: [] });

    const containers = [];
    const ackTargets = [];

    for (const r of records) {
      const stepRaw = (r["配車_工程"]?.value ?? "").toString().trim();
      if (!stepRaw) {
        // ★ 工程が入ってないものは誤ACKの可能性が高いので放置（未のまま）
        continue;
      }

      const dropoffOverride = (r["搬入_配車上書き"]?.value ?? "").toString().trim();
      const dropoffBase     = (r["搬入"]?.value ?? "").toString().trim();
      const dropoffYard     = dropoffOverride || dropoffBase;
      const worker4 = (r["作業者_4"]?.value ?? "").toString().trim();

      containers.push({
        id: r.$id.value,
        no: (r["コンテナ番号_配送依頼"]?.value ?? "").toString(),
        dropoffYard,
        step: Number(stepRaw), // React側は ContainerStep 想定なので number に寄せる
        worker4,
      });

      ackTargets.push(r.$id.value);
    }

    // 返すものが無いなら更新もしない
    if (ackTargets.length === 0) {
      return res.json({ containers: [] });
    }

    // 取得したものを「済」にする
    const updateBody = {
      app: CONTAINER_APP_ID,
      records: ackTargets.map((id) => ({
        id,
        record: { 配車_更新: { value: ["済"] } },
      })),
    };

    await axios.put(`${baseUrl}/records.json`, updateBody, {
      headers: {
        "X-Cybozu-API-Token": CONTAINER_API_TOKEN,
        "Content-Type": "application/json",
      },
    });

    res.json({ containers });
  } catch (err) {
    res.status(500).json({ error: "updates 取得失敗", detail: err.response?.data || err.message });
  }
});


// サーバー起動
const port = process.env.PORT || 3001;
app.listen(port, () => {
  console.log(`Driver API server running at http://localhost:${port}`);
});
