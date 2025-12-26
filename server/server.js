// server/server.js
require("dotenv").config();
const express = require("express");
const axios = require("axios");
const cors = require("cors");
const nodemailer = require("nodemailer");

const app = express();

/** =========================
 *  ENV
 *  ========================= */
const SUBDOMAIN = process.env.KINTONE_SUBDOMAIN;

// ドライバー
const DRIVER_APP_ID = process.env.KINTONE_DRIVER_APP_ID;
const DRIVER_API_TOKEN = process.env.KINTONE_DRIVER_API_TOKEN;

// 車両
const TRUCK_APP_ID = process.env.KINTONE_TRUCK_APP_ID;
const TRUCK_API_TOKEN = process.env.KINTONE_TRUCK_API_TOKEN;

// シャーシ
const CHASSIS_APP_ID = process.env.KINTONE_CHASSIS_APP_ID;
const CHASSIS_API_TOKEN = process.env.KINTONE_CHASSIS_API_TOKEN;

// コンテナ
const CONTAINER_APP_ID = process.env.KINTONE_CONTAINER_APP_ID;
const CONTAINER_API_TOKEN = process.env.KINTONE_CONTAINER_API_TOKEN;

// Kintone write switch（安全装置）
const ALLOW_KINTONE_WRITE = process.env.ALLOW_KINTONE_WRITE === "true";

/** =========================
 *  CORS / JSON
 *  ========================= */
const allowedOrigins = [
  "http://localhost:3000",
  "http://localhost:5173",
  "https://dispatch-web.vercel.app",
];

app.use(
  cors({
    origin: (origin, cb) => {
      if (!origin) return cb(null, true);
      if (allowedOrigins.includes(origin)) return cb(null, true);
      if (origin.endsWith(".vercel.app")) return cb(null, true);
      return cb(new Error(`CORS blocked: ${origin}`));
    },
    methods: ["GET", "POST", "PUT", "DELETE", "OPTIONS"],
    credentials: true,
  })
);

app.use(express.json());

/** =========================
 *  Utilities
 *  ========================= */
function kintoneBaseUrl() {
  return `https://${SUBDOMAIN}.cybozu.com/k/v1`;
}

function assertContainerEnv(res) {
  if (!SUBDOMAIN || !CONTAINER_APP_ID || !CONTAINER_API_TOKEN) {
    console.error("コンテナAPI 環境変数不足", {
      SUBDOMAIN,
      CONTAINER_APP_ID,
      hasToken: !!CONTAINER_API_TOKEN,
    });
    res.status(500).json({ error: "環境変数不足（CONTAINER）" });
    return false;
  }
  return true;
}

function shouldSkipDestination(destRaw) {
  const s = (destRaw ?? "").toString().trim();
  if (!s) return false;
  const u = s.toUpperCase();
  return u.includes("FEEDER") || u.includes("POSITION");
}

function stripCompanyTokens(destRaw) {
  let s = (destRaw ?? "").toString().trim();
  if (!s) return "";

  s = s.replace(/\s+/g, " ");
  s = s
    .replace(
      /^\s*(株式会社|（株）|\(株\)|有限会社|（有）|\(有\)|合同会社|（同）|\(同\)|合資会社|合名会社)\s*/g,
      ""
    )
    .replace(
      /\s*(株式会社|（株）|\(株\)|有限会社|（有）|\(有\)|合同会社|（同）|\(同\)|合資会社|合名会社)\s*$/g,
      ""
    );

  s = s
    .replace(/\s*(株式会社|有限会社|合同会社)\s*/g, " ")
    .replace(/\s*(（株）|\(株\)|（有）|\(有\)|（同）|\(同\))\s*/g, " ")
    .replace(/\s+/g, " ")
    .trim();

  return s;
}

function resolvePickupYardGroup(pickupYard) {
  const text = (pickupYard ?? "").toString().trim();
  if (!text) return "";
  if (text.includes("大井")) return "大井";
  if (text.includes("青海")) return "青海";
  if (text.includes("品川")) return "品川";
  if (text.includes("本牧")) return "本牧";
  if (text.includes("中防")) return "中防";
  return "その他";
}

async function kintoneGetRecords({ appId, apiToken, query }) {
  const baseUrl = kintoneBaseUrl();
  const res = await axios.get(`${baseUrl}/records.json`, {
    headers: { "X-Cybozu-API-Token": apiToken },
    params: { app: appId, query },
  });
  return res.data.records || [];
}

async function kintonePutRecords({ appId, apiToken, records }) {
  const baseUrl = kintoneBaseUrl();
  const body = { app: appId, records };
  return axios.put(`${baseUrl}/records.json`, body, {
    headers: {
      "X-Cybozu-API-Token": apiToken,
      "Content-Type": "application/json",
    },
  });
}

function chunk(array, size) {
  const out = [];
  for (let i = 0; i < array.length; i += size) out.push(array.slice(i, i + size));
  return out;
}

/** =========================
 *  Mail
 *  ========================= */
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
  if (!process.env.MAIL_HOST || !process.env.MAIL_USER || !process.env.MAIL_PASS) {
    return res.status(501).json({
      error: "メール送信は未設定のため無効です（mailto方式を使用してください）",
    });
  }

  try {
    const { to, subject, text, html } = req.body;
    if (!to || !subject || !(text || html)) {
      return res.status(400).json({ error: "to / subject / text(html) は必須です" });
    }

    await sendMail({ to, subject, text, html });
    res.json({ ok: true });
  } catch (err) {
    console.error("===== メール送信エラー =====");
    console.error("msg:", err.message);
    console.error("stack:", err.stack);
    console.error("====================================");
    res.status(500).json({ error: "メール送信に失敗しました", detail: err.message });
  }
});

/** =========================
 *  GET /api/drivers
 *  ========================= */
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

    const records = await kintoneGetRecords({
      appId: DRIVER_APP_ID,
      apiToken: DRIVER_API_TOKEN,
      query: 'ドライバー_状態 in ("在籍") order by ドライバー_略称 asc',
    });

    const drivers = records.map((r) => ({
      id: r.$id.value,
      name: r["ドライバー_略称"].value,
      status: r["ドライバー_状態"].value,
      baseTruckNo: r["ドライバー_車両"].value,
      email: r["ドライバー_メール"].value,
      driverType: r["ドライバー_区分"]?.value ?? "",
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

/** =========================
 *  GET /api/trucks
 *  ========================= */
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

    const records = await kintoneGetRecords({
      appId: TRUCK_APP_ID,
      apiToken: TRUCK_API_TOKEN,
      query: '車両_状態 in ("稼働") order by 車両_番号 asc',
    });

    const trucks = records.map((r) => ({
      id: r.$id.value,
      number: r["車両_番号"].value,
      carNo: r["車両_車番"].value,
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

/** =========================
 *  GET /api/chassis
 *  ========================= */
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

    const records = await kintoneGetRecords({
      appId: CHASSIS_APP_ID,
      apiToken: CHASSIS_API_TOKEN,
      query: 'シャーシ_状態 in ("稼働","修理") order by シャーシ_番号 asc',
    });

    const chassis = records.map((r) => {
      const sizeRaw = r["シャーシ_サイズ"].value;
      const kindRaw = r["シャーシ_種別"].value;
      const noteRaw = r["シャーシ_備考"]?.value ?? "";

      const size = sizeRaw === "40F" ? "40" : "20";

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
          axle = "both";
          break;
        case "MG":
        default:
          axle = "MG";
          break;
      }

      return {
        id: r.$id.value,
        displayNo: r["シャーシ_番号"].value,
        carNo: r["シャーシ_車番"].value,
        size,
        sizeLabel: sizeRaw,
        axle,
        kindLabel: kindRaw,
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

/** =========================
 *  GET /api/containers  (取得のみ)
 *  Web用フラグ: 配車_連携2
 *  ========================= */
app.get("/api/containers", async (req, res) => {
  try {
    if (!assertContainerEnv(res)) return;

    // Web用フラグ：配車_連携2
    const query =
      '配車_連携2 in ("未")' +
      ' and 配送先_配送依頼 not like "FEEDER"' +
      ' and 配送先_配送依頼 not like "POSITION"' +
      " order by 配送日 asc";

    const records = await kintoneGetRecords({
      appId: CONTAINER_APP_ID,
      apiToken: CONTAINER_API_TOKEN,
      query,
    });

    if (!records.length) return res.json({ containers: [] });

    const eligibleRecords = records.filter((r) => {
      const destinationRaw = (r["配送先_配送依頼"]?.value ?? "").toString();
      return !shouldSkipDestination(destinationRaw);
    });

    if (!eligibleRecords.length) return res.json({ containers: [] });

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

      const eta = (r["着時間0"]?.value ?? "").toString();
      const dropoffOverride = (r["搬入_配車上書き"]?.value ?? "").toString().trim();
      const dropoffBase = (r["搬入"]?.value ?? "").toString().trim();
      const dropoffYard = dropoffOverride || dropoffBase;

      const destinationRaw = (r["配送先_配送依頼"]?.value ?? "").toString();
      const destination = stripCompanyTokens(destinationRaw);

      const destadd = (r["配送先住所"]?.value ?? "").toString();
      const desttel = (r["連絡先電話番号"]?.value ?? "").toString();
      const no = (r["コンテナ番号_配送依頼"]?.value ?? "").toString();
      const ship = (r["本船名_配送依頼"]?.value ?? "").toString();
      const booking = (r["BL_BK"]?.value ?? "").toString();
      const kindCode = (r["種類"]?.value ?? "").toString();

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

    return res.json({ containers });
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

/** =========================
 *  POST /api/containers/mark-board-done
 *  Body: { ids: ["82","81", ...] }
 *  配車_連携2 を「済」に更新
 *  ========================= */
app.post("/api/containers/mark-board-done", async (req, res) => {
  try {
    if (!assertContainerEnv(res)) return;

    if (!ALLOW_KINTONE_WRITE) {
      return res.status(403).json({ error: "Kintone write disabled" });
    }

    const ids = Array.isArray(req.body?.ids) ? req.body.ids : [];
    const cleaned = ids.map((v) => String(v || "").trim()).filter(Boolean);

    if (!cleaned.length) {
      return res.status(400).json({ error: "ids is required" });
    }

    const chunks = chunk(cleaned, 100);
    let updated = 0;

    for (const part of chunks) {
      await kintonePutRecords({
        appId: CONTAINER_APP_ID,
        apiToken: CONTAINER_API_TOKEN,
        records: part.map((id) => ({
          id,
          record: {
            配車_連携2: { value: ["済"] }, // チェックボックス
          },
        })),
      });
      updated += part.length;
    }

    console.log("[containers] mark-board-done updated =", updated);
    return res.json({ ok: true, updated });
  } catch (err) {
    console.error("===== mark-board-done エラー =====");
    console.error("status:", err.response?.status);
    console.error("data  :", err.response?.data);
    console.error("msg   :", err.message);
    console.error("====================================");
    res.status(500).json({
      error: "kintone 更新に失敗しました",
      status: err.response?.status,
      detail: err.response?.data || err.message,
    });
  }
});

/** =========================
 *  GET /api/containers/updates
 *  Web側コンテナ情報アップデート（取得は常にOK）
 *  - 取得条件：配車_更新2 in ("未")
 *  - ACK（済更新）は ALLOW_KINTONE_WRITE=true のときだけ実行
 *  注意：あなたの元コードは ACK が「配車_更新」になっており不一致でした。
 *        ここでは配車_更新2 に統一しています。
 *  ========================= */
app.get("/api/containers/updates", async (req, res) => {
  try {
    if (!assertContainerEnv(res)) return;

    const query = '配車_更新2 in ("未") order by 更新日時 asc';

    const records = await kintoneGetRecords({
      appId: CONTAINER_APP_ID,
      apiToken: CONTAINER_API_TOKEN,
      query,
    });

    if (!records.length) return res.json({ containers: [] });

    const containers = [];
    const ackTargets = [];

    for (const r of records) {
      const stepRaw = (r["配車_工程"]?.value ?? "").toString().trim();

      // 工程が無いものは誤ACKの可能性が高いので未のまま放置
      if (!stepRaw) continue;

      const dropoffOverride = (r["搬入_配車上書き"]?.value ?? "").toString().trim();
      const dropoffBase = (r["搬入"]?.value ?? "").toString().trim();
      const dropoffYard = dropoffOverride || dropoffBase;

      const worker4 = (r["作業者_4"]?.value ?? "").toString().trim();

      containers.push({
        id: r.$id.value,
        no: (r["コンテナ番号_配送依頼"]?.value ?? "").toString(),
        dropoffYard,
        step: Number(stepRaw),
        worker4,
      });

	  // ★ ここがポイント：step=4 のときだけ「済」にする
	  if (step === 4) {
	    ackTargets.push(r.$id.value);
	  }
	}

    // 返すものが無いなら更新もしない
    if (!containers.length) return res.json({ containers: [] });

    // ACK（配車_更新2 を済）…ただし書き込み許可のときのみ
    if (ALLOW_KINTONE_WRITE) {
      const chunks = chunk(ackTargets, 100);
      for (const part of chunks) {
        await kintonePutRecords({
          appId: CONTAINER_APP_ID,
          apiToken: CONTAINER_API_TOKEN,
          records: part.map((id) => ({
            id,
            record: { 配車_更新2: { value: ["済"] } }, // ← ここが修正点（配車_更新2）
          })),
        });
      }
    } else {
      console.log("[updates] skip kintone update (ALLOW_KINTONE_WRITE != true)");
    }

    return res.json({ containers });
  } catch (err) {
    console.error("===== updates エラー =====");
    console.error("status:", err.response?.status);
    console.error("data  :", err.response?.data);
    console.error("msg   :", err.message);
    console.error("====================================");
    res.status(500).json({
      error: "updates 取得失敗",
      status: err.response?.status,
      detail: err.response?.data || err.message,
    });
  }
});

/** =========================
 *  Start
 *  ========================= */
const PORT = process.env.PORT || 3001;
app.listen(PORT, () => {
  console.log(`API server listening on ${PORT}`);
});
