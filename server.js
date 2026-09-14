// By Sunwin Anh Khôi
"use strict";

const express = require("express");
const axios   = require("axios");
const fs      = require("fs");

const app = express();

// ======================
// CONFIG
// ======================
const PORT        = process.env.PORT || 3000;
const API_URL     = "https://kwinstore.com/sunwin/tx/history/40a96e18be563af6deafeb77a7121433cd7754db0113d821";
const DATA_FILE   = "data.json";
const MAX_DATA    = 10000;      // giới hạn 10k phiên
const INIT_FETCH  = 200;        // tải sẵn 200 phiên khi khởi động
const POLL_DELAY  = 5000;       // 5s poll định kỳ
const INIT_DELAY  = 400;        // delay giữa mỗi lần fetch khi init
const SAVE_DEBOUNCE = 2000;     // debounce ghi file (ms)

// ======================
// STORAGE – compact JSON
// ======================
function loadData() {
  try {
    if (fs.existsSync(DATA_FILE)) {
      const raw = fs.readFileSync(DATA_FILE, "utf8");
      return JSON.parse(raw);
    }
  } catch (e) {
    console.error("[Load] lỗi:", e.message);
  }
  return [];
}

// Ghi compact (không space/indent) → tiết kiệm dung lượng tối đa
let _saveTimer = null;
function saveData(db) {
  clearTimeout(_saveTimer);
  _saveTimer = setTimeout(() => {
    try {
      fs.writeFileSync(DATA_FILE, JSON.stringify(db), "utf8");
    } catch (e) {
      console.error("[Save] lỗi:", e.message);
    }
  }, SAVE_DEBOUNCE);
}

// ======================
// MEMORY
// ======================
let database = loadData();
let sessions = new Set(database.map(r => r.phien));

// ======================
// PARSE API – định dạng mới
// ======================
// API trả về:
// { "success": true, "data": { "ket_qua":..., "phien":..., "thoi_gian":...,
//                              "tong":..., "xuc_xac_1":..., "xuc_xac_2":..., "xuc_xac_3":... } }
// Hỗ trợ cả trường hợp API trả mảng (history nhiều phiên)
function parseResponse(raw) {
  if (!raw) return [];

  // Trường hợp mảng (history endpoint trả nhiều phiên)
  if (raw.success && Array.isArray(raw.data)) {
    return raw.data.map(toRecord).filter(Boolean);
  }

  // Trường hợp object đơn
  if (raw.success && raw.data && typeof raw.data === "object") {
    const r = toRecord(raw.data);
    return r ? [r] : [];
  }

  return [];
}

function toRecord(d) {
  if (!d || d.phien == null) return null;
  return {
    phien:     Number(d.phien),
    xuc_xac_1: d.xuc_xac_1,
    xuc_xac_2: d.xuc_xac_2,
    xuc_xac_3: d.xuc_xac_3,
    tong:      d.tong,
    ket_qua:   d.ket_qua,
    thoi_gian: d.thoi_gian || ""
  };
}

// ======================
// FETCH API
// ======================
async function fetchAPI() {
  try {
    const res = await axios.get(API_URL, {
      timeout: 10000,
      headers: { "User-Agent": "Mozilla/5.0" }
    });
    return res.data;
  } catch (e) {
    console.error("[Fetch] lỗi:", e.message);
    return null;
  }
}

// ======================
// THÊM RECORD (dedup + limit)
// ======================
function addRecord(rec) {
  if (!rec || sessions.has(rec.phien)) return false;

  database.push(rec);
  sessions.add(rec.phien);

  // Giữ tối đa MAX_DATA phiên (xoá cũ nhất)
  if (database.length > MAX_DATA) {
    const old = database.shift();
    sessions.delete(old.phien);
  }

  return true;
}

// ======================
// INIT – tải sẵn 200 phiên
// ======================
async function initFetch() {
  const needed = Math.max(0, INIT_FETCH - database.length);
  if (needed === 0) {
    console.log(`[Init] Đã có ${database.length} phiên, bỏ qua init`);
    return;
  }

  console.log(`[Init] Bắt đầu tải ${needed} phiên...`);
  let added = 0;
  let tries = 0;
  const maxTries = needed * 3; // tránh loop vô tận khi API trùng

  while (added < needed && tries < maxTries) {
    tries++;
    const raw = await fetchAPI();
    const records = parseResponse(raw);

    for (const rec of records) {
      if (addRecord(rec)) {
        added++;
        console.log(`[Init] +${rec.phien} (${added}/${needed})`);
      }
    }

    if (added < needed) {
      await sleep(INIT_DELAY);
    }
  }

  saveData(database);
  console.log(`[Init] Hoàn thành – tổng ${database.length} phiên`);
}

// ======================
// COLLECTOR – poll định kỳ
// ======================
async function collector() {
  console.log(`[Collector] Bắt đầu poll mỗi ${POLL_DELAY / 1000}s`);

  while (true) {
    try {
      const raw     = await fetchAPI();
      const records = parseResponse(raw);
      let   dirty   = false;

      for (const rec of records) {
        if (addRecord(rec)) {
          dirty = true;
          console.log(`[Collector] +${rec.phien} | Total: ${database.length}`);
        } else {
          console.log(`[Collector] Trùng ${rec.phien}`);
        }
      }

      if (dirty) saveData(database);

    } catch (e) {
      console.error("[Collector] lỗi:", e.message);
    }

    await sleep(POLL_DELAY);
  }
}

// ======================
// HELPERS
// ======================
function sleep(ms) {
  return new Promise(r => setTimeout(r, ms));
}

function normalize(str = "") {
  return str.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "");
}

// ======================
// ROUTES
// ======================

// home
app.get("/", (_req, res) => {
  res.json({
    status:   "running",
    total:    database.length,
    max_data: MAX_DATA,
    by:       "By Sunwin Anh Khôi"
  });
});

// toàn bộ data
app.get("/data", (_req, res) => {
  res.json({ total: database.length, data: database });
});

// phiên mới nhất
app.get("/latest", (_req, res) => {
  if (!database.length) {
    return res.status(404).json({ error: "Không có dữ liệu" });
  }
  res.json(database[database.length - 1]);
});

// n phiên gần nhất  (?n=200)
app.get("/data/limit", (req, res) => {
  const limit = Math.max(1, Number(req.query.n) || 10);
  res.json({
    total: Math.min(limit, database.length),
    data:  database.slice(-limit)
  });
});

// tìm theo phiên
app.get("/data/:phien", (req, res) => {
  const phien = Number(req.params.phien);
  const found = database.find(i => i.phien === phien);
  if (!found) {
    return res.status(404).json({ error: "Không tìm thấy" });
  }
  res.json(found);
});

// thống kê Tài / Xỉu (hỗ trợ cả chữ hoa/thường)
app.get("/stats", (_req, res) => {
  let tai = 0, xiu = 0;

  for (const i of database) {
    const kq = normalize(i.ket_qua);
    if (kq.includes("tai"))  tai++;
    else if (kq.includes("xiu") || kq.includes("xỉu") || kq.includes("xu")) xiu++;
  }

  const total = database.length;
  res.json({
    total,
    tai,
    xiu,
    ti_le_tai:  total ? ((tai / total) * 100).toFixed(2) : 0,
    ti_le_xiu:  total ? ((xiu / total) * 100).toFixed(2) : 0
  });
});

// xoá dữ liệu
app.post("/clear", (_req, res) => {
  database = [];
  sessions.clear();
  saveData(database);
  res.json({ success: true, message: "Đã xóa dữ liệu" });
});

// ======================
// START
// ======================
app.listen(PORT, "0.0.0.0", async () => {
  console.log(`[Server] http://0.0.0.0:${PORT} | By Sunwin Anh Khôi`);
  await initFetch();   // tải 200 phiên trước
  collector();          // rồi poll liên tục
});
