// Sunwin collector — fetch trực tiếp từ API nguồn được cấu hình
"use strict";

const express = require("express");
const axios = require("axios");
const fs = require("fs");
const path = require("path");

const app = express();

const PORT = Number(process.env.PORT || 3000);

// QUAN TRỌNG:
// Có thể đổi API nguồn mà không sửa code:
// SOURCE_API_URL="https://.../sunwin/tx/history/..."
const SOURCE_API_URL =
  process.env.SOURCE_API_URL ||
  "https://kwinstore.com/sunwin/tx/history/40a96e18be563af6deafeb77a7121433cd7754db0113d821";

const DATA_FILE = path.resolve(process.env.DATA_FILE || "./data.json");
const MAX_DATA = Math.max(100, Number(process.env.MAX_DATA || 10000));
const POLL_MS = Math.max(500, Number(process.env.POLL_MS || 1000));
const REQUEST_TIMEOUT_MS = Math.max(2000, Number(process.env.REQUEST_TIMEOUT_MS || 8000));
const SAVE_DELAY = Math.max(250, Number(process.env.SAVE_DELAY || 3000));

const http = axios.create({
  timeout: REQUEST_TIMEOUT_MS,
  headers: {
    "User-Agent": "SunwinCollector/2.0",
    Accept: "application/json, text/plain, */*"
  },
  validateStatus: status => status >= 200 && status < 300
});

// ------------------------------------------------------------
// DATABASE
// ------------------------------------------------------------
function loadData() {
  try {
    if (!fs.existsSync(DATA_FILE)) return [];
    const parsed = JSON.parse(fs.readFileSync(DATA_FILE, "utf8"));
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(r => Number.isFinite(Number(r?.phien)) && Number(r.phien) > 0);
  } catch (err) {
    console.error("[Load] Không đọc được data.json:", err.message);
    return [];
  }
}

let database = loadData();
const sessions = new Set(database.map(r => Number(r.phien)));

let saveTimer = null;

function scheduleSave() {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => {
    try {
      const tmp = `${DATA_FILE}.tmp`;
      fs.writeFileSync(tmp, JSON.stringify(database), "utf8");
      fs.renameSync(tmp, DATA_FILE);
    } catch (err) {
      console.error("[Save] Lỗi ghi dữ liệu:", err.message);
    }
  }, SAVE_DELAY);
}

// ------------------------------------------------------------
// NORMALIZE API RESPONSE
// Hỗ trợ:
//   { code: 200, data: [...] }
//   { status: "OK", data: [...] }
//   { data: { data: [...] } }
//   [...] 
// ------------------------------------------------------------
function extractItems(raw) {
  if (Array.isArray(raw)) return raw;
  if (!raw || typeof raw !== "object") return [];

  if (Array.isArray(raw.data)) return raw.data;
  if (raw.data && Array.isArray(raw.data.data)) return raw.data.data;
  if (Array.isArray(raw.result)) return raw.result;
  if (raw.result && Array.isArray(raw.result.data)) return raw.result.data;

  return [];
}

function firstDefined(obj, keys) {
  for (const key of keys) {
    if (obj && obj[key] !== undefined && obj[key] !== null && obj[key] !== "") {
      return obj[key];
    }
  }
  return undefined;
}

function normalizeResult(value) {
  if (value === undefined || value === null) return "";
  const s = String(value).trim();
  if (/^tai$/i.test(s)) return "Tài";
  if (/^xiu$/i.test(s) || /^xỉu$/i.test(s)) return "Xỉu";
  return s;
}

function parseItems(raw) {
  const items = extractItems(raw);
  if (!items.length) return [];

  const output = [];

  for (const d of items) {
    if (!d || typeof d !== "object") continue;

    const phienRaw = firstDefined(d, [
      "phiên", "phien", "session", "sessionId", "gameId", "id"
    ]);

    const phien = Number(phienRaw);
    if (!Number.isSafeInteger(phien) || phien <= 0) continue;

    const d1 = firstDefined(d, ["d1", "dice1", "xuc_xac_1", "xucXac1"]);
    const d2 = firstDefined(d, ["d2", "dice2", "xuc_xac_2", "xucXac2"]);
    const d3 = firstDefined(d, ["d3", "dice3", "xuc_xac_3", "xucXac3"]);

    const totalRaw = firstDefined(d, ["tổng", "tong", "total", "sum"]);
    const resultRaw = firstDefined(d, [
      "kết quả", "ket_qua", "ketQua", "result", "outcome"
    ]);
    const timeRaw = firstDefined(d, [
      "updatedAt", "updated_at", "thoi_gian", "thoiGian", "time", "createdAt"
    ]);

    const total = Number(totalRaw);
    const dice = [d1, d2, d3].map(Number);
    const validDice = dice.every(n => Number.isInteger(n) && n >= 1 && n <= 6);

    output.push({
      phien,
      xuc_xac_1: validDice ? dice[0] : d1,
      xuc_xac_2: validDice ? dice[1] : d2,
      xuc_xac_3: validDice ? dice[2] : d3,
      tong: Number.isFinite(total) ? total : totalRaw,
      ket_qua: normalizeResult(resultRaw),
      thoi_gian: timeRaw == null ? "" : String(timeRaw)
    });
  }

  // Một phiên chỉ giữ 1 record. Nếu API trả trùng, lấy record cuối.
  const unique = new Map();
  for (const rec of output) unique.set(rec.phien, rec);

  return [...unique.values()].sort((a, b) => a.phien - b.phien);
}

// ------------------------------------------------------------
// DATABASE INSERT
// ------------------------------------------------------------
function addRecord(rec) {
  if (sessions.has(rec.phien)) return false;

  database.push(rec);
  sessions.add(rec.phien);

  if (database.length > MAX_DATA) {
    database.sort((a, b) => a.phien - b.phien);
    while (database.length > MAX_DATA) {
      const old = database.shift();
      if (old) sessions.delete(old.phien);
    }
  }

  return true;
}

// ------------------------------------------------------------
// FETCH SOURCE API
// ------------------------------------------------------------
async function fetchSourceAPI() {
  const response = await http.get(SOURCE_API_URL);
  return response.data;
}

// ------------------------------------------------------------
// INITIAL SYNC
// ------------------------------------------------------------
async function initFetch() {
  console.log("[Init] Fetch API nguồn...");
  console.log(`[Init] SOURCE_API_URL=${SOURCE_API_URL}`);

  try {
    const raw = await fetchSourceAPI();
    const items = parseItems(raw);

    if (!items.length) {
      console.error("[Init] API trả response nhưng không tìm thấy record hợp lệ.");
      return;
    }

    let added = 0;

    for (const rec of items) {
      if (addRecord(rec)) added++;
    }

    database.sort((a, b) => a.phien - b.phien);

    if (added > 0) scheduleSave();

    console.log(
      `[Init] API records=${items.length} | added=${added} | total=${database.length}`
    );
  } catch (err) {
    console.error(
      `[Init] Không fetch được API nguồn: ${err.response?.status || err.code || err.message}`
    );
  }
}

// ------------------------------------------------------------
// COLLECTOR
// Không tạo request chồng nhau.
// ------------------------------------------------------------
let collecting = false;
let lastPhien = database.length
  ? database[database.length - 1].phien
  : 0;

async function collectorTick() {
  if (collecting) return;
  collecting = true;

  try {
    const raw = await fetchSourceAPI();
    const items = parseItems(raw);

    let added = 0;

    for (const rec of items) {
      if (addRecord(rec)) {
        added++;

        if (rec.phien > lastPhien) {
          lastPhien = rec.phien;
          console.log(
            `[+] Phiên ${rec.phien} | ${rec.ket_qua || "?"} | Tổng DB ${database.length}`
          );
        }
      }
    }

    if (added > 0) {
      database.sort((a, b) => a.phien - b.phien);
      scheduleSave();
    }
  } catch (err) {
    const status = err.response?.status;
    console.error(
      `[Collector] API error: ${status || err.code || err.message}`
    );
  } finally {
    collecting = false;
  }
}

async function collector() {
  console.log(`[Collector] Poll mỗi ${POLL_MS}ms`);
  while (true) {
    await collectorTick();
    await new Promise(resolve => setTimeout(resolve, POLL_MS));
  }
}

// ------------------------------------------------------------
// ROUTES
// ------------------------------------------------------------
app.get("/", (_req, res) => {
  res.json({
    status: "running",
    source: SOURCE_API_URL,
    total: database.length,
    max_data: MAX_DATA,
    collector_interval_ms: POLL_MS
  });
});

app.get("/data", (_req, res) => {
  res.json({
    total: database.length,
    data: database
  });
});

app.get("/latest", (_req, res) => {
  if (!database.length) {
    return res.status(404).json({ error: "Không có dữ liệu" });
  }

  res.json(database[database.length - 1]);
});

app.get("/data/limit", (req, res) => {
  const requested = Number(req.query.n);
  const n = Number.isFinite(requested)
    ? Math.min(MAX_DATA, Math.max(1, Math.floor(requested)))
    : 10;

  const slice = database.slice(-n);

  res.json({
    total: slice.length,
    data: slice
  });
});

app.get("/data/:phien", (req, res) => {
  const phien = Number(req.params.phien);

  if (!Number.isSafeInteger(phien) || phien <= 0) {
    return res.status(400).json({ error: "Phiên không hợp lệ" });
  }

  const record = database.find(item => item.phien === phien);

  if (!record) {
    return res.status(404).json({ error: "Không tìm thấy" });
  }

  res.json(record);
});

app.get("/stats", (_req, res) => {
  let tai = 0;
  let xiu = 0;

  for (const r of database) {
    if (r.ket_qua === "Tài") tai++;
    else if (r.ket_qua === "Xỉu") xiu++;
  }

  const total = database.length;

  res.json({
    total,
    tai,
    xiu,
    ti_le_tai: total ? `${((tai / total) * 100).toFixed(2)}%` : "0%",
    ti_le_xiu: total ? `${((xiu / total) * 100).toFixed(2)}%` : "0%"
  });
});

app.post("/clear", (_req, res) => {
  database = [];
  sessions.clear();
  lastPhien = 0;
  scheduleSave();

  res.json({
    success: true,
    message: "Đã xóa dữ liệu local"
  });
});

// ------------------------------------------------------------
// START
// ------------------------------------------------------------
app.listen(PORT, "0.0.0.0", async () => {
  console.log(`[Server] listening on 0.0.0.0:${PORT}`);
  await initFetch();
  collector().catch(err => {
    console.error("[Collector] Fatal:", err);
    process.exit(1);
  });
});
