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

/** GASボタン経由でシートから読み込んだコンテナをメモリに保持 */
let sheetContainerMemory = [];

/** GASアプリからの工程通知（kintoneId → { step, yardIn2? }）*/
const stepOverridesMap = new Map();

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

function mapKintoneFiles(fileFieldValue) {
  const arr = Array.isArray(fileFieldValue) ? fileFieldValue : [];
  return arr.map((f) => ({
    name: f.name,
    fileKey: f.fileKey,
    contentType: f.contentType,
    size: f.size,
    // フロントから叩けるようにAPIのURLを返す（添付はできないのでリンク用途）
    url: `/api/kintone/file?fileKey=${encodeURIComponent(f.fileKey)}&name=${encodeURIComponent(f.name)}`,
  }));
}


function shouldSkipDestination(destRaw) {
  const s = (destRaw ?? "").toString().trim();
  if (!s) return false;
  const u = s.toUpperCase();
  return (
    u.includes("FEEDER") ||
    u.includes("POSITION") ||
    u.includes("X線検査") ||
    u.includes("Ⅹ線検査") ||  // 全角ローマ数字対応
    u.includes("税関検査")
  );
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

function parseStepValue(rec) {
  const raw = (rec["配車_工程"]?.value ?? "").toString().trim();
  if (!raw) return 0;

  // "4" だけでなく "④" や "step4" も拾える保険
  const m = raw.match(/\d+/);
  if (m) return Number(m[0]);

  // 数字が取れない形式は 0 扱い（必要ならログ出してもOK）
  return 0;
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
    // ── kintone からコンテナ取得（環境変数が揃っている場合のみ）──
    let kintoneContainers = [];
    if (SUBDOMAIN && CONTAINER_APP_ID && CONTAINER_API_TOKEN) {
      try {
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

        const eligibleRecords = records.filter((r) => {
          const destinationRaw = (r["配送先_配送依頼"]?.value ?? "").toString();
          return !shouldSkipDestination(destinationRaw);
        });

        kintoneContainers = eligibleRecords.map((r) => {
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
          const handoverNo = (r["引渡番号"]?.value ?? "").toString().trim();
          const receiptFiles = mapKintoneFiles(r["受領書"]?.value ?? []);
          const dispatchFiles = mapKintoneFiles(r["ディスパッチ"]?.value ?? []);
          const step = parseStepValue(r);
          const worker4 = (r["作業者_4"]?.value ?? "").toString().trim();

          return {
            id: r.$id.value,
            size,
            sizeRaw,
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
            handoverNo,
            receiptFiles,
            dispatchFiles,
            step,
            worker4,
          };
        });
      } catch (kErr) {
        console.error("kintone コンテナ取得エラー:", kErr.response?.status, kErr.message);
      }
    }

    const overriddenKintone = kintoneContainers.map(c => {
      const ov = stepOverridesMap.get(String(c.id));
      return ov ? { ...c, ...ov } : c;
    });
    return res.json({ containers: [...overriddenKintone, ...sheetContainerMemory] });
  } catch (err) {
    console.error("===== /api/containers エラー =====");
    console.error("msg:", err.message);
    res.status(500).json({ error: "コンテナ取得に失敗しました", detail: err.message });
  }
});

/** =========================
 *  POST /api/containers/mark-board-done
 *  Body: { ids: ["82","81", ...] }
 *  配車_連携2 を「済」に更新
 *  ========================= */
app.post("/api/containers/mark-board-done", async (req, res) => {
  try {
    const ids = Array.isArray(req.body?.ids) ? req.body.ids : [];
    const allIds = ids.map((v) => String(v || "").trim()).filter(Boolean);

    // sheet_ IDをメモリから削除
    const sheetIds = allIds.filter((v) => v.startsWith("sheet_"));
    if (sheetIds.length) {
      sheetContainerMemory = sheetContainerMemory.filter((c) => !sheetIds.includes(c.id));
      console.log(`[sheet] removed ${sheetIds.length} containers from memory`);
    }

    // kintone更新対象（sheet_ 以外）
    const cleaned = allIds.filter((v) => !v.startsWith("sheet_"));
    if (!cleaned.length) {
      return res.json({ ok: true, updated: 0 });
    }

    if (!assertContainerEnv(res)) return;
    if (!ALLOW_KINTONE_WRITE) {
      return res.status(403).json({ error: "Kintone write disabled" });
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
 *  Kintone添付ファイルを落とすAPIを追加
 *  フロントにトークンを出さないために サーバーでプロキシします。
 *  ========================= */

app.get("/api/kintone/file", async (req, res) => {
  try {
    if (!SUBDOMAIN || !CONTAINER_API_TOKEN) {
      return res.status(500).json({ error: "Missing env for kintone file proxy" });
    }

    const fileKey = String(req.query.fileKey || "").trim();
    const name = String(req.query.name || "").trim();

    if (!fileKey) return res.status(400).json({ error: "fileKey is required" });

    const url = `${kintoneBaseUrl()}/file.json`;
    const kRes = await axios.get(url, {
      headers: { "X-Cybozu-API-Token": CONTAINER_API_TOKEN },
      params: { fileKey },
      responseType: "stream",
    });

    const ct = kRes.headers["content-type"] || "application/octet-stream";
    res.setHeader("Content-Type", ct);

    // なるべく名前を付ける（名前が無ければ fileKey）
    const filename = name || `${fileKey}`;
    res.setHeader("Content-Disposition", `inline; filename*=UTF-8''${encodeURIComponent(filename)}`);

    kRes.data.pipe(res);
  } catch (err) {
    console.error("===== kintone file proxy error =====");
    console.error("status:", err.response?.status);
    console.error("data  :", err.response?.data);
    console.error("msg   :", err.message);
    console.error("====================================");
    res.status(500).json({ error: "Failed to proxy kintone file", detail: err.message });
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
    // GAS direct notifications: always available regardless of kintone config
    const containers = [];
    for (const [id, ov] of stepOverridesMap.entries()) {
      containers.push({ id, ...ov });
    }

    // kintone polling: only when env vars are configured
    const ackTargets = [];
    if (SUBDOMAIN && CONTAINER_APP_ID && CONTAINER_API_TOKEN) {
      try {
        const query = '配車_更新2 in ("未") order by 更新日時 asc';
        const records = await kintoneGetRecords({
          appId: CONTAINER_APP_ID,
          apiToken: CONTAINER_API_TOKEN,
          query,
        });

        for (const r of records) {
          const step = parseStepValue(r);
          if (!step) continue;

          const dropoffOverride = (r["搬入_配車上書き"]?.value ?? "").toString().trim();
          const dropoffBase = (r["搬入"]?.value ?? "").toString().trim();
          const dropoffYard = dropoffOverride || dropoffBase;
          const worker4 = (r["作業者_4"]?.value ?? "").toString().trim();
          const rid = r.$id.value;

          const existing = containers.find(c => String(c.id) === rid);
          if (existing) {
            Object.assign(existing, { dropoffYard, step, worker4,
              no: (r["コンテナ番号_配送依頼"]?.value ?? "").toString() });
          } else {
            containers.push({
              id: rid,
              no: (r["コンテナ番号_配送依頼"]?.value ?? "").toString(),
              dropoffYard,
              step,
              worker4,
            });
          }

          if (step === 4) ackTargets.push(rid);
        }

        if (ALLOW_KINTONE_WRITE && ackTargets.length > 0) {
          const chunks = chunk(ackTargets, 100);
          for (const part of chunks) {
            await kintonePutRecords({
              appId: CONTAINER_APP_ID,
              apiToken: CONTAINER_API_TOKEN,
              records: part.map((id) => ({
                id,
                record: { 配車_更新2: { value: ["済"] } },
              })),
            });
          }
        }
      } catch (kErr) {
        console.error("[updates] kintone fetch error:", kErr.message);
      }
    }

    return res.json({ containers });
  } catch (err) {
    console.error("===== updates エラー =====", err.message);
    res.status(500).json({ error: "updates 取得失敗", detail: err.message });
  }
});

/** =========================
 *  GET /api/dispatch-sheet/drivers
 *  スプレッドシート「リスト」シートから作業者名を取得
 *  ========================= */
app.get("/api/dispatch-workers", async (req, res) => {
  const SHEET_ID = "18MKAWG5Ynl3HU2X60T_e3Z6zpJQn4ZDRwmaZMJkUiMM";
  const GID = "0"; // リストシート
  const csvUrl = `https://docs.google.com/spreadsheets/d/${SHEET_ID}/export?format=csv&gid=${GID}`;

  try {
    const response = await axios.get(csvUrl, { responseType: "text" });
    const lines = parseCSV(response.data);
    if (lines.length < 2) {
      return res.json({ drivers: [] });
    }

    const headers = lines[0];
    const nameIdx = headers.findIndex((h) => h.trim() === "作業者名");
    if (nameIdx < 0) {
      return res.status(500).json({ error: "作業者名カラムが見つかりません" });
    }

    const drivers = [];
    for (let i = 1; i < lines.length; i++) {
      const name = (lines[i][nameIdx] || "").trim();
      if (name) drivers.push(name);
    }

    res.json({ drivers });
  } catch (err) {
    console.error("dispatch-sheet/drivers エラー:", err.message);
    res.status(500).json({ error: "作業者名取得失敗", detail: err.message });
  }
});

/** =========================
 *  GET /api/dispatch-sheet
 *  スプレッドシートCSVから配車表データ取得
 *  ========================= */
app.get("/api/dispatch-sheet", async (req, res) => {
  const { date } = req.query; // YYYY-MM-DD
  if (!date) {
    return res.status(400).json({ error: "date パラメータが必要です" });
  }

  const SHEET_ID = "18MKAWG5Ynl3HU2X60T_e3Z6zpJQn4ZDRwmaZMJkUiMM";
  const GID = "1850964362";
  const csvUrl = `https://docs.google.com/spreadsheets/d/${SHEET_ID}/export?format=csv&gid=${GID}`;

  try {
    const response = await axios.get(csvUrl, { responseType: "text" });
    const csvText = response.data;

    // CSV パース（簡易: ダブルクォート対応）
    const lines = parseCSV(csvText);
    if (lines.length < 2) {
      return res.json({ rows: [] });
    }

    // ヘッダーからカラムインデックスを動的マッピング
    const headers = lines[0];
    const colMap = {};
    const targetHeaders = [
      "配送日", "着時間", "得意先", "コンテナ番号",
      "サイズ・種類", "搬出ヤード", "搬入ヤード", "作業先",
    ];
    for (const name of targetHeaders) {
      const idx = headers.findIndex(
        (h) => h.trim() === name
      );
      if (idx >= 0) colMap[name] = idx;
    }

    // クエリの date (YYYY-MM-DD) から月・日を取り出す
    const queryParts = date.split("-"); // ["2026","04","16"]
    const queryMonth = parseInt(queryParts[1], 10); // 4
    const queryDay = parseInt(queryParts[2], 10);   // 16

    // 配送日でフィルタ
    const dataRows = lines.slice(1);
    const filtered = [];
    let no = 1;

    for (const cols of dataRows) {
      const dateIdx = colMap["配送日"];
      if (dateIdx === undefined) continue;

      const rawDate = (cols[dateIdx] || "").trim();
      if (!rawDate) continue;

      // スプレッドシートの日付形式に対応:
      //   "4/16", "04/16", "2026/4/16", "2026-04-16" など
      let matched = false;
      const slashParts = rawDate.replace(/-/g, "/").split("/");
      if (slashParts.length === 2) {
        // "M/D" 形式（年なし）
        matched =
          parseInt(slashParts[0], 10) === queryMonth &&
          parseInt(slashParts[1], 10) === queryDay;
      } else if (slashParts.length === 3) {
        // "YYYY/M/D" 形式
        matched =
          parseInt(slashParts[0], 10) === parseInt(queryParts[0], 10) &&
          parseInt(slashParts[1], 10) === queryMonth &&
          parseInt(slashParts[2], 10) === queryDay;
      }
      if (!matched) continue;

      filtered.push({
        no: no++,
        time: (cols[colMap["着時間"]] || "").trim(),
        customer: (cols[colMap["得意先"]] || "").trim(),
        containerNumber: (cols[colMap["コンテナ番号"]] || "").trim(),
        sizeType: (cols[colMap["サイズ・種類"]] || "").trim(),
        yardOut: (cols[colMap["搬出ヤード"]] || "").trim(),
        yardIn: (cols[colMap["搬入ヤード"]] || "").trim(),
        workplace: (cols[colMap["作業先"]] || "").trim(),
      });
    }

    // 着時間でソート
    filtered.sort((a, b) => a.time.localeCompare(b.time));

    res.json({ rows: filtered });
  } catch (err) {
    console.error("dispatch-sheet エラー:", err.message);
    res.status(500).json({
      error: "配車表データ取得失敗",
      detail: err.message,
    });
  }
});

/** =========================
 *  貼付シートの「サイズ：種類」文字列を kindCode に変換
 *  例: "ドライ" → "D", "リーファー" → "R"
 *  ========================= */
function kindStrToCode(s) {
  const t = (s || "").trim();
  if (t.includes("ドライ")) return "D";
  if (t.includes("リーファー") || t.includes("リーファ")) return "R";
  if (t.includes("フラット")) return "F";
  if (t.includes("オープントップ") || t.includes("OT")) return "O";
  if (t.includes("タンク")) return "T";
  return t ? t.charAt(0) : "D";
}

/** =========================
 *  スプレッドシート「貼付シート」からコンテナを取得
 *  SHEET_CONTAINERS_GID が設定されている場合のみ動作
 *
 *  対応フォーマット（1件=2行、18行ごとにヘッダー繰り返し）:
 *  上段ヘッダー: No. | 時間 | 得意先略称 | コンテナ番号 | BL/BK | 搬出 | 作業先 | 作業先住所
 *  下段ヘッダー:               | サイズ：種類 | 本船 | 搬入 | 指示書備考
 *  ========================= */
async function fetchSheetContainers() {
  const GID = process.env.SHEET_CONTAINERS_GID;
  if (!GID) return [];

  const SHEET_ID = "18MKAWG5Ynl3HU2X60T_e3Z6zpJQn4ZDRwmaZMJkUiMM";
  const csvUrl = `https://docs.google.com/spreadsheets/d/${SHEET_ID}/export?format=csv&gid=${GID}`;

  try {
    const response = await axios.get(csvUrl, { responseType: "text" });
    const allLines = parseCSV(response.data);
    if (allLines.length < 2) return [];

    // ── 1. シート上部から日付を検出（"XX年XX月XX日"形式）──
    let sheetDate = "";
    for (const row of allLines) {
      for (const cell of row) {
        const m = cell.match(/(\d{2,4})年(\d{1,2})月(\d{1,2})日/);
        if (m) {
          sheetDate = `${m[2].padStart(2, "0")}/${m[3].padStart(2, "0")}`;
          break;
        }
      }
      if (sheetDate) break;
    }

    // ── 2. 上段ヘッダー行を検出（"No." を含む行）──
    let headerIdx = -1;
    for (let i = 0; i < allLines.length; i++) {
      if (allLines[i].some((c) => c.trim() === "No.")) {
        headerIdx = i;
        break;
      }
    }
    if (headerIdx < 0) return [];

    const h1 = allLines[headerIdx].map((c) => c.trim());            // 上段
    const h2 = (allLines[headerIdx + 1] || []).map((c) => c.trim()); // 下段

    // カラム位置を名前で動的検索（複数候補に対応）
    const findCol = (headers, ...names) => {
      for (const name of names) {
        const idx = headers.findIndex((c) => c === name);
        if (idx >= 0) return idx;
      }
      return -1;
    };

    // 上段ヘッダーから取る列
    const cNo     = findCol(h1, "No.");
    const cTime   = findCol(h1, "時間");
    const cCust   = findCol(h1, "得意先略称", "得意先");
    const cContNo = findCol(h1, "コンテナ番号");
    const cBLBK   = findCol(h1, "BL/BK", "BL・BK", "BL_BK");
    const cPickup = findCol(h1, "搬出");
    const cWork   = findCol(h1, "作業先");    // 上段にある場合
    const cAddr   = findCol(h1, "作業先住所");

    // 下段ヘッダーから取る列
    const cSizeType = findCol(h2, "サイズ：種類", "サイズ:種類");
    const cShip     = findCol(h2, "本船");
    const cDropoff  = findCol(h2, "搬入");
    const cWork2    = findCol(h2, "指示書備考", "作業先"); // 下段の作業先/指示書備考

    // ── 3. データ行を2行ずつ読む（ヘッダー繰り返しをスキップ）──
    const looksLikeHeader = (row) =>
      row.some((c) => c.trim() === "No.") ||
      row.some((c) => c.trim() === "コンテナ番号") ||
      row.some((c) => c.trim() === "サイズ：種類");

    const containers = [];
    let seqNo = 1;
    let i = headerIdx + 2; // 上段・下段ヘッダーをスキップ

    while (i < allLines.length) {
      const rowA = allLines[i] || [];
      const rowB = allLines[i + 1] || [];

      // 繰り返しヘッダー行をスキップ（2行分）
      if (looksLikeHeader(rowA)) { i += 2; continue; }

      // コンテナ番号が空 → 空行としてスキップ
      const contNo = cContNo >= 0 ? (rowA[cContNo] || "").trim() : "";
      if (!contNo) { i += 2; continue; }

      // サイズ：種類 パース（例: "40 9'6:ドライ" → size=40, sizeRaw="40 9'6", kindCode="D"）
      const sizeTypeStr = cSizeType >= 0 ? (rowB[cSizeType] || "").trim() : "";
      const colonPos = sizeTypeStr.indexOf(":");
      const sizeLeft = colonPos >= 0 ? sizeTypeStr.slice(0, colonPos).trim() : sizeTypeStr;
      const kindStr  = colonPos >= 0 ? sizeTypeStr.slice(colonPos + 1).trim() : "";
      const size     = sizeLeft.includes("40") ? "40" : "20";
      const kindCode = kindStrToCode(kindStr);

      const pickupYard  = cPickup  >= 0 ? (rowA[cPickup]  || "").trim() : "";
      const dropoffYard = cDropoff >= 0 ? (rowB[cDropoff] || "").trim() : "";

      // 作業先: 下段の指示書備考列 → 上段の作業先列 の順で優先
      const workVal = (cWork2 >= 0 ? (rowB[cWork2] || "").trim() : "") ||
                      (cWork  >= 0 ? (rowA[cWork]  || "").trim() : "");
      // destination は 作業先（配送先）を使用。なければ得意先略称
      const custVal = cCust >= 0 ? (rowA[cCust] || "").trim() : "";
      const destination = stripCompanyTokens(workVal || custVal);

      containers.push({
        id: `sheet_${String(seqNo).padStart(4, "0")}`,
        size,
        sizeRaw: sizeLeft,
        date: sheetDate,
        eta:     cTime  >= 0 ? (rowA[cTime]  || "").trim() : "",
        pickupYard,
        pickupYardGroup: resolvePickupYardGroup(pickupYard),
        dropoffYard,
        destination,
        destadd: cAddr  >= 0 ? (rowA[cAddr]  || "").trim() : "",
        desttel: "",
        no: contNo,
        ship:    cShip  >= 0 ? (rowB[cShip]  || "").trim() : "",
        booking: cBLBK  >= 0 ? (rowA[cBLBK]  || "").trim() : "",
        kindCode,
        handoverNo: "",
        receiptFiles: [],
        dispatchFiles: [],
        step: 0,
        worker4: "",
      });

      seqNo++;
      i += 2;
    }

    return containers;
  } catch (err) {
    console.error("シートコンテナ取得エラー:", err.message);
    return [];
  }
}

/** =========================
 *  POST /api/step-update
 *  GASアプリから工程完了を直接通知。kintoneポーリングより即時反映。
 *  Body: { kintoneId, no?, step, yardIn2? }
 *  ========================= */
app.post("/api/step-update", (req, res) => {
  const { kintoneId, no, step, yardIn2, dropoffYard, xray, nextDay } = req.body ?? {};
  if (step == null || (!kintoneId && !no)) {
    return res.status(400).json({ error: "step and (kintoneId or no) are required" });
  }
  const stepNum = Number(step);
  const override = { step: stepNum };
  if (yardIn2) override.yardIn2 = String(yardIn2).trim();
  if (dropoffYard) override.dropoffYard = String(dropoffYard).trim();

  if (kintoneId) {
    stepOverridesMap.set(String(kintoneId).trim(), override);
  }

  // sheet containers に同じコンテナ番号があれば直接更新
  if (no) {
    const noStr = String(no).trim().toUpperCase();
    const kidStr = kintoneId ? String(kintoneId).trim() : '';
    let matched = false;
    sheetContainerMemory = sheetContainerMemory.map(c => {
      // kintoneId が指定された場合はIDで一意に特定（noは同一番号が複数存在する可能性があるため）
      if (kidStr) {
        if (String(c.id) === kidStr) { matched = true; return { ...c, ...override }; }
      } else {
        if (c.no.toUpperCase() === noStr) { matched = true; return { ...c, ...override }; }
      }
      return c;
    });
    // xray=true: xray:CONTNOキーを使用（no:CONTNOは通常ドレー用に保持、step=4汚染を防ぐ）
    // nextDay=true: nextDay:CONTNOキーを使用（翌日配送完了、当日カードを配送完了へ）
    // step=4+kintoneId: no:CONTNOを登録しない（通常ドレーが誤って配送完了へ移動するのを防ぐ）
    if (nextDay) {
      stepOverridesMap.set(`nextDay:${noStr}`, override);
      stepOverridesMap.delete(`no:${noStr}`); // 翌日配送確定後は no: override を削除（翌日カードへの色変化汚染を防ぐ）
    } else if (xray) {
      stepOverridesMap.set(`xray:${noStr}`, override);
    } else if (!(kidStr && stepNum === 4)) {
      stepOverridesMap.set(`no:${noStr}`, override);
    }

    // ④配送完了: sheetContainerMemory から除去（GET /api/containers が再度追加しないよう）
    // kintoneId 指定時はIDで除去（同一コンテナ番号の別レコード＝通常ドレーは残す）
    // xray=true 時はdestinationで識別し、通常ドレーは残す
    // nextDay=true 時は当日分（コンテナ番号一致）を除去
    if (stepNum === 4) {
      const before = sheetContainerMemory.length;
      if (kidStr) {
        sheetContainerMemory = sheetContainerMemory.filter(c => String(c.id) !== kidStr);
      } else if (xray) {
        sheetContainerMemory = sheetContainerMemory.filter(c => {
          if (c.no.toUpperCase() !== noStr) return true;
          return !/(X線|税関)/i.test(c.destination || '');
        });
      } else {
        sheetContainerMemory = sheetContainerMemory.filter(c => c.no.toUpperCase() !== noStr);
      }
      console.log(`[step-update] step=4, removed ${before - sheetContainerMemory.length} container(s) no=${noStr} kid=${kidStr || '-'} xray=${!!xray} nextDay=${!!nextDay}`);
    }

    console.log(`[step-update] sheet match: ${matched}, no=${noStr}, kid=${kidStr || '-'}`);
  }

  const id = kintoneId ? String(kintoneId).trim() : `no:${String(no).trim().toUpperCase()}`;
  console.log(`[step-update] id=${id} step=${stepNum} dropoffYard=${dropoffYard || "-"} yardIn2=${yardIn2 || "-"} map_size=${stepOverridesMap.size}`);
  return res.json({ ok: true, id, step: stepNum });
});

/** GET /api/step-overrides — デバッグ用：現在のstepOverridesMapを確認 */
app.get("/api/step-overrides", (_req, res) => {
  const entries = Object.fromEntries(stepOverridesMap);
  res.json({ count: stepOverridesMap.size, entries });
});

/** =========================
 *  POST /api/load-sheet-containers
 *  GASボタンから呼び出すトリガー。
 *  貼付シートを読んでメモリに保存し、配車ボードに反映する。
 *  ========================= */
app.post("/api/load-sheet-containers", async (req, res) => {
  try {
    let containers;
    if (req.body && Array.isArray(req.body.containers)) {
      // GASから処理済みコンテナを受け取る（ヤード正規化・紐付けシート書込み済み）
      containers = req.body.containers;
      console.log(`[sheet] received ${containers.length} containers from GAS`);
    } else {
      // フォールバック: サーバーがシートを直接読む
      containers = await fetchSheetContainers();
      console.log(`[sheet] fetched ${containers.length} containers from sheet`);
    }
    sheetContainerMemory = containers;
    return res.json({ ok: true, loaded: containers.length });
  } catch (err) {
    console.error("load-sheet-containers エラー:", err.message);
    res.status(500).json({ error: "シートコンテナ読み込み失敗", detail: err.message });
  }
});

/**
 * CSV パーサ（ダブルクォート対応）
 */
function parseCSV(text) {
  const rows = [];
  let current = [];
  let field = "";
  let inQuotes = false;

  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    const next = text[i + 1];

    if (inQuotes) {
      if (ch === '"' && next === '"') {
        field += '"';
        i++; // skip escaped quote
      } else if (ch === '"') {
        inQuotes = false;
      } else {
        field += ch;
      }
    } else {
      if (ch === '"') {
        inQuotes = true;
      } else if (ch === ',') {
        current.push(field);
        field = "";
      } else if (ch === '\n' || (ch === '\r' && next === '\n')) {
        current.push(field);
        field = "";
        rows.push(current);
        current = [];
        if (ch === '\r') i++; // skip \n
      } else if (ch === '\r') {
        current.push(field);
        field = "";
        rows.push(current);
        current = [];
      } else {
        field += ch;
      }
    }
  }

  // 最終行
  if (field || current.length > 0) {
    current.push(field);
    rows.push(current);
  }

  return rows;
}

/** =========================
 *  Start
 *  ========================= */
const PORT = process.env.PORT || 3001;
app.listen(PORT, () => {
  console.log(`API server listening on ${PORT}`);
});
