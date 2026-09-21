"use strict";

const express = require("express");
const axios = require("axios");
const fs = require("fs");
const path = require("path");
const zlib = require("zlib");

const app = express();

// ======================
// CẤU HÌNH
// ======================
const PORT = Number(process.env.PORT) || 3000;
const API_URL = process.env.SOURCE_API_URL || "https://kwinstore.com/hitclub/tx/history/149a0d217aba1a2c9fa900e946613b9cb8f36ccecefa000b";
const DATA_FILE = process.env.DATA_FILE || path.join(__dirname, "data_hitclub.json.gz");
const MAX_DATA = 100000;
const POLL_MS = Math.max(1000, Number(process.env.POLL_MS) || 2000);
const SAVE_DELAY = Math.max(3000, Number(process.env.SAVE_DELAY) || 5000);
const REQUEST_TIMEOUT = 8000;
const VIETNAM_TZ = "Asia/Ho_Chi_Minh";
// Chống dọn dữ liệu nhầm khi lỗi mạng thoáng qua:
// chỉ tự huỷ dữ liệu khi API lỗi liên tục nhiều lần poll liên tiếp.
const MAX_CONSECUTIVE_ERRORS = 30;
const CLEAR_SECRET = process.env.CLEAR_SECRET || "";

// ======================
// THỜI GIAN VIỆT NAM
// Lưu dạng: YYYY-MM-DD HH:mm:ss
// ======================
function vietnamTime(value) {
  if (value === null || value === undefined || value === "") return "";

  let date;
  if (typeof value === "number" || /^\d{10,13}$/.test(String(value))) {
    const n = Number(value);
    date = new Date(n < 1e12 ? n * 1000 : n);
  } else {
    const text = String(value).trim();
    date = new Date(text);
    // Nếu API gửi ISO không có timezone, coi dữ liệu nguồn là UTC để tránh
    // Render chạy UTC làm lệch giờ khi hiển thị tại Việt Nam.
    if (!/[zZ]|[+-]\d{2}:?\d{2}$/.test(text) && !Number.isNaN(date.getTime())) {
      date = new Date(text + "Z");
    }
  }

  if (Number.isNaN(date.getTime())) return String(value);

  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: VIETNAM_TZ,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hourCycle: "h23"
  }).formatToParts(date);

  const p = Object.fromEntries(parts.map(x => [x.type, x.value]));
  return `${p.year}-${p.month}-${p.day} ${p.hour}:${p.minute}:${p.second}`;
}

// ======================
// LOAD / SAVE - gzip JSON
// gzip level 9 + atomic rename: tối đa số phiên, tối thiểu dung lượng disk.
// ======================
function loadData() {
  try {
    if (!fs.existsSync(DATA_FILE)) return [];
    const raw = zlib.gunzipSync(fs.readFileSync(DATA_FILE)).toString("utf8");
    const data = JSON.parse(raw);
    if (!Array.isArray(data)) return [];
    return data
      .filter(r => Number.isFinite(Number(r.phien)))
      .map(normalizeRecord)
      .sort((a, b) => b.phien - a.phien)
      .slice(0, MAX_DATA);
  } catch (e) {
    console.error("[Load] Không đọc được database:", e.message);
    return [];
  }
}

let saveTimer = null;
let savePending = false;

function saveNow() {
  savePending = false;
  try {
    const payload = Buffer.from(JSON.stringify(database));
    const compressed = zlib.gzipSync(payload, { level: 9 });
    const temp = `${DATA_FILE}.tmp`;
    fs.writeFileSync(temp, compressed);
    fs.renameSync(temp, DATA_FILE);
  } catch (e) {
    console.error("[Save] Lỗi:", e.message);
  }
}

function scheduleSave() {
  savePending = true;
  clearTimeout(saveTimer);
  saveTimer = setTimeout(saveNow, SAVE_DELAY);
}

// ======================
// MEMORY
// Luôn giữ phiên lớn -> nhỏ: [0] là phiên mới nhất.
// ======================
let database = loadData();
let sessions = new Set(database.map(r => r.phien));
let maxPhien = database.length ? database[0].phien : 0;
let minPhien = database.length ? database[database.length - 1].phien : 0;

function normalizeRecord(d) {
  return {
    phien: Number(d["phiên"] ?? d.phien),
    xuc_xac_1: Number(d.d1 ?? d.xuc_xac_1),
    xuc_xac_2: Number(d.d2 ?? d.xuc_xac_2),
    xuc_xac_3: Number(d.d3 ?? d.xuc_xac_3),
    tong: Number(d["tổng"] ?? d.tong),
    ket_qua: String(d["kết quả"] ?? d.ket_qua ?? ""),
    thoi_gian: vietnamTime(d.updatedAt ?? d.thoi_gian)
  };
}

// ======================
// PARSE API GỐC
// ======================
function parseItems(raw) {
  if (!raw || raw.code !== 200 || !Array.isArray(raw.data)) return [];
  return raw.data
    .map(normalizeRecord)
    .filter(r => Number.isSafeInteger(r.phien) && r.phien > 0);
}

// ======================
// THÊM RECORD
// ======================
function addRecord(rec) {
  if (sessions.has(rec.phien)) return false;

  // API thường trả phiên mới nhất trước. Trường hợp bình thường O(1).
  if (!database.length || rec.phien > maxPhien) {
    database.unshift(rec);
  } else if (rec.phien < minPhien) {
    // Đã đủ số phiên tối đa thì phiên cũ hơn không cần giữ.
    if (database.length >= MAX_DATA) return false;
    database.push(rec);
  } else {
    // Chèn đúng vị trí để vẫn giữ giảm dần nếu API trả dữ liệu lệch thứ tự.
    let lo = 0;
    let hi = database.length;
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      if (database[mid].phien > rec.phien) lo = mid + 1;
      else hi = mid;
    }
    database.splice(lo, 0, rec);
  }

  sessions.add(rec.phien);
  maxPhien = database[0]?.phien || 0;
  minPhien = database[database.length - 1]?.phien || 0;

  if (database.length > MAX_DATA) {
    const removed = database.pop();
    if (removed) sessions.delete(removed.phien);
    minPhien = database[database.length - 1]?.phien || 0;
  }

  return true;
}

// ======================
// TỰ HUỶ DỮ LIỆU
// Khi nguồn API chết / không còn trả dữ liệu: xoá sạch để service
// về trạng thái trống như chưa từng hoạt động.
// ======================
function wipeData(reason) {
  database = [];
  sessions.clear();
  maxPhien = 0;
  minPhien = 0;
  console.error(`[Wipe] Nguồn dữ liệu không còn hoạt động (${reason}) - đã tự huỷ toàn bộ dữ liệu.`);
  saveNow();
}

// ======================
// FETCH API GỐC
// ======================
async function fetchAPI() {
  const res = await axios.get(API_URL, {
    timeout: REQUEST_TIMEOUT,
    headers: {
      Accept: "application/json",
      "User-Agent": "Hitclub-Collector/1.0"
    },
    validateStatus: status => status >= 200 && status < 300
  });
  return res.data;
}

// ======================
// INIT - nạp lịch sử API
// ======================
async function initFetch() {
  console.log("[Init] Đang lấy dữ liệu lịch sử từ API gốc...");
  try {
    const items = parseItems(await fetchAPI());
    if (!items.length) {
      // Nguồn trả về rỗng ngay từ đầu -> coi như không hoạt động.
      if (database.length) wipeData("API trả danh sách rỗng");
      return;
    }
    let added = 0;
    for (const rec of items) {
      if (addRecord(rec)) added++;
    }
    if (added) scheduleSave();
    console.log(`[Init] Nạp ${added} phiên | Đang giữ ${database.length}/${MAX_DATA.toLocaleString("vi-VN")} phiên`);
  } catch (e) {
    console.error("[Init] API lỗi:", e.message);
  }
}

// ======================
// COLLECTOR
// Poll tuần tự, không tạo request chồng nhau.
// ======================
let collectorBusy = false;
let collectorTimer = null;
let consecutiveErrors = 0;

async function collectOnce() {
  if (collectorBusy) return;
  collectorBusy = true;
  try {
    const items = parseItems(await fetchAPI());
    consecutiveErrors = 0;

    if (!items.length) {
      // API còn phản hồi HTTP 200 nhưng không còn dữ liệu -> nguồn đã chết.
      if (database.length) wipeData("API 200 nhưng data rỗng");
    } else {
      let dirty = false;

      for (const rec of items) {
        if (addRecord(rec)) {
          dirty = true;
          console.log(`[+] Phiên ${rec.phien} | ${rec.ket_qua} | ${rec.thoi_gian} VN`);
        }
      }

      if (dirty) scheduleSave();
    }
  } catch (e) {
    consecutiveErrors++;
    console.error(`[Collector] API lỗi (${consecutiveErrors}/${MAX_CONSECUTIVE_ERRORS}):`, e.message);
    // Link chết thật (token thu hồi / nguồn gỡ) thường lỗi liên tục.
    // Chỉ tự huỷ sau nhiều lần lỗi liên tiếp để tránh dọn nhầm do lỗi mạng thoáng.
    if (consecutiveErrors >= MAX_CONSECUTIVE_ERRORS && database.length) {
      wipeData(`API lỗi liên tục ${MAX_CONSECUTIVE_ERRORS} lần`);
      consecutiveErrors = 0;
    }
  } finally {
    collectorBusy = false;
    collectorTimer = setTimeout(collectOnce, POLL_MS);
  }
}

// ======================
// ROUTES
// ======================
app.get("/", (_req, res) => {
  res.json({
    name: "Dữ Liệu Hitclub",
    status: "running",
    total: database.length,
    max_data: MAX_DATA,
    order: "phien giảm dần (lớn → nhỏ)",
    timezone: "Asia/Ho_Chi_Minh (UTC+7)",
    source: API_URL
  });
});

app.get("/data", (_req, res) => {
  res.json({
    name: "Dữ Liệu Hitclub",
    total: database.length,
    data: database
  });
});

app.get("/latest", (_req, res) => {
  if (!database.length) return res.status(404).json({ error: "Không có dữ liệu" });
  res.json(database[0]);
});

app.get("/data/limit", (req, res) => {
  const n = Math.min(MAX_DATA, Math.max(1, Number(req.query.n) || 10));
  const slice = database.slice(0, n);
  res.json({ total: slice.length, data: slice });
});

app.get("/data/:phien", (req, res) => {
  const p = Number(req.params.phien);
  const r = database.find(i => i.phien === p);
  if (!r) return res.status(404).json({ error: "Không tìm thấy" });
  res.json(r);
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

app.post("/clear", (req, res) => {
  // Nếu đặt CLEAR_SECRET thì bắt buộc phải đúng key mới được xoá.
  if (CLEAR_SECRET && req.query.key !== CLEAR_SECRET) {
    return res.status(403).json({ error: "Forbidden" });
  }
  database = [];
  sessions.clear();
  maxPhien = 0;
  minPhien = 0;
  scheduleSave();
  res.json({ success: true, message: "Đã xóa dữ liệu" });
});

// ======================
// START
// ======================
app.listen(PORT, "0.0.0.0", async () => {
  console.log("========================================");
  console.log("Dữ Liệu Hitclub");
  console.log("========================================");
  console.log(`[Server] Port: ${PORT}`);
  console.log(`[Server] Timezone: ${VIETNAM_TZ} (UTC+7)`);
  console.log(`[Server] Giữ tối đa: ${MAX_DATA.toLocaleString("vi-VN")} phiên`);
  console.log(`[Server] Poll: ${POLL_MS}ms`);
  console.log(`[Server] Database: ${DATA_FILE}`);
  console.log("========================================");

  await initFetch();
  collectOnce();
});

process.on("SIGTERM", () => {
  clearTimeout(collectorTimer);
  clearTimeout(saveTimer);
  if (savePending) saveNow();
  process.exit(0);
});

process.on("SIGINT", () => {
  clearTimeout(collectorTimer);
  clearTimeout(saveTimer);
  if (savePending) saveNow();
  process.exit(0);
});
