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
const API_URL = process.env.SOURCE_API_URL || "https://wtxmd52.tele68.com/v1/txmd5/sessions";
const DATA_FILE = process.env.DATA_FILE || path.join(__dirname, "data_lc79.json.gz");
const MAX_DATA = 100000;
// Lấy dữ liệu từ API gốc mỗi 1s liên tục
const POLL_MS = Math.max(1000, Number(process.env.POLL_MS) || 1000);
const SAVE_DELAY = Math.max(3000, Number(process.env.SAVE_DELAY) || 5000);
const REQUEST_TIMEOUT = 8000;
const VIETNAM_TZ = "Asia/Ho_Chi_Minh";
// Tên hiển thị ở cuối kết quả sau khi các thông tin khác đã hiển thị.
const CREDIT = " By Khôi";
// Chống dọn dữ liệu nhầm khi lỗi mạng thoáng qua:
// chỉ tự huỷ dữ liệu khi API lỗi liên tục nhiều lần poll liên tiếp.
const MAX_CONSECUTIVE_ERRORS = 60;
const CLEAR_SECRET = process.env.CLEAR_SECRET || "";

// ======================
// THỜI GIAN VIỆT NAM
// Lưu dạng: YYYY-MM-DD HH:mm:ss
// ======================
function vietnamNow() {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: VIETNAM_TZ,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hourCycle: "h23"
  }).formatToParts(new Date());

  const p = Object.fromEntries(parts.map(x => [x.type, x.value]));
  return `${p.year}-${p.month}-${p.day} ${p.hour}:${p.minute}:${p.second}`;
}

// ======================
// KẾT QUẢ
// API gốc trả "X" = Xỉu, "T" = Tài
// ======================
function mapKetQua(raw) {
  const k = String(raw ?? "").trim().toUpperCase();
  if (k === "XI" || k === "XỈU" || k === "X") return "Xỉu";
  if (k === "TAI" || k === "TÀI" || k === "T") return "Tài";
  return String(raw ?? "").trim();
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
  const dices = Array.isArray(d?.dices) ? d.dices : [];

  return {
    phien: Number(d?.id),
    xuc_xac_1: Number(dices[0]),
    xuc_xac_2: Number(dices[1]),
    xuc_xac_3: Number(dices[2]),
    tong: Number(d?.point),
    ket_qua: mapKetQua(d?.resultTruyenThong) + CREDIT,
    // API mới không có ngày/giờ: tự đóng dấu thời gian Việt Nam khi phiên được nhận.
    thoi_gian: d?.thoi_gian || vietnamNow()
  };
}

// ======================
// PARSE API GỐC
// Hỗ trợ cả dạng [{...}] trần và {code, data: [...]}
// ======================
function parseItems(raw) {
  let list = null;

  if (Array.isArray(raw)) {
    list = raw;
  } else if (raw && typeof raw === "object") {
    if (Array.isArray(raw.list)) list = raw.list;
    else if (Array.isArray(raw.sessions)) list = raw.sessions;
    else if (Array.isArray(raw.data)) list = raw.data;
    else if (Array.isArray(raw.items)) list = raw.items;
  }

  if (!list) return [];

  return list
    .map(normalizeRecord)
    // API mới: chỉ dùng id làm số phiên, tuyệt đối không dùng _id.
    .filter(r =>
      Number.isSafeInteger(r.phien) &&
      r.phien > 0 &&
      Number.isFinite(r.tong) &&
      Number.isFinite(r.xuc_xac_1) &&
      Number.isFinite(r.xuc_xac_2) &&
      Number.isFinite(r.xuc_xac_3)
    );
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
  while (database.length > MAX_DATA) {
    const removed = database.pop();
    if (removed) sessions.delete(removed.phien);
  }
  maxPhien = database[0]?.phien || 0;
  minPhien = database[database.length - 1]?.phien || 0;

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
      "User-Agent": "LC79-Collector/1.0"
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
      console.warn("[Init] API không trả phiên hợp lệ.");
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
// Poll 1s tuần tự, không tạo request chồng nhau.
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
      // API rỗng tạm thời không được phép xoá lịch sử.
      console.warn("[Collector] API không trả phiên hợp lệ; giữ nguyên database.");
    } else {
      let dirty = false;

      for (const rec of items) {
        if (addRecord(rec)) {
          dirty = true;
          console.log(`[+] Phiên ${rec.phien} | Xúc xắc: ${rec.xuc_xac_1},${rec.xuc_xac_2},${rec.xuc_xac_3} | Tổng: ${rec.tong} | ${rec.ket_qua}${CREDIT} | ${rec.thoi_gian} VN`);
        }
      }

      if (dirty) scheduleSave();
    }
  } catch (e) {
    consecutiveErrors++;
    console.error(`[Collector] API lỗi (${consecutiveErrors}/${MAX_CONSECUTIVE_ERRORS}):`, e.message);
    // Link chết thật (tunnel gỡ / nguồn tắt) thường lỗi liên tục.
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
    name: "Dữ Liệu LC79",
    status: "running",
    total: database.length,
    max_data: MAX_DATA,
    order: "phien giảm dần (lớn → nhỏ)",
    timezone: "Asia/Ho_Chi_Minh (UTC+7)"
  });
});

app.get("/data", (_req, res) => {
  res.json({
    name: "Dữ Liệu LC79",
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
    if (r.ket_qua.startsWith("Tài")) tai++;
    else if (r.ket_qua.startsWith("Xỉu")) xiu++;
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
  console.log("Dữ Liệu LC79");
  console.log("========================================");
  console.log(`[Server] Port: ${PORT}`);
  console.log(`[Server] Timezone: ${VIETNAM_TZ} (UTC+7)`);
  console.log(`[Server] Giữ toàn bộ số phiên API trả về`);
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
