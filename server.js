const express = require("express");
const axios = require("axios");
const fs = require("fs");

const app = express();
const PORT = process.env.PORT || 3000;

// API MỚI
const API_URL = "https://apigocsun.onrender.com/api/ditmemaysun";
const DATA_FILE = "data.json";
const FETCH_DELAY = 100; // 0.1 giây
const MAX_DATA = 10000;

let database = [];
let existingSessions = new Set();
let isFetching = false;
let lastUpdateCount = 0;

// ======================
// LOAD DATA
// ======================
try {
  if (fs.existsSync(DATA_FILE)) {
    const raw = fs.readFileSync(DATA_FILE, "utf8");
    const parsed = JSON.parse(raw);
    if (Array.isArray(parsed)) {
      database = parsed;
      existingSessions = new Set(database.map(i => i.Phien));
      console.log(`📂 Đã load ${database.length} records`);
    }
  }
} catch (e) {
  console.log("Load error:", e.message);
  database = [];
}

// ======================
// SORT: Phien lớn nhất lên đầu
// ======================
function sortDatabase() {
  database.sort((a, b) => b.Phien - a.Phien);
}

sortDatabase();

// ======================
// SAVE DATA
// ======================
function saveData() {
  try {
    sortDatabase();
    fs.writeFileSync(DATA_FILE, JSON.stringify(database, null, 2), "utf8");
  } catch (e) {
    console.log("Save error:", e.message);
  }
}

// Lưu mỗi 5 giây
setInterval(() => {
  if (database.length > 0) {
    saveData();
  }
}, 5000);

// ======================
// FETCH & SAVE
// ======================
async function fetchAndSave() {
  if (isFetching) return;
  isFetching = true;

  try {
    const response = await axios.get(API_URL, {
      timeout: 10000,
      headers: {
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
        "Accept": "application/json"
      }
    });

    const data = response.data;

    // API mới trả về 1 object
    if (data && data.Phien) {
      const phien = Number(data.Phien);
      
      // Kiểm tra update_count để biết có phiên mới không
      const currentUpdateCount = Number(data.update_count || 0);
      
      // Chưa có trong database
      if (phien && !existingSessions.has(phien)) {
        
        const record = {
          Phien: phien,
          Xuc_xac_1: Number(data.Xuc_xac_1),
          Xuc_xac_2: Number(data.Xuc_xac_2),
          Xuc_xac_3: Number(data.Xuc_xac_3),
          Tong: Number(data.Tong),
          Ket_qua: data.Ket_qua,
          id: data.id || "",
          server_time: data.server_time || new Date().toISOString(),
          update_count: currentUpdateCount
        };

        database.push(record);
        existingSessions.add(phien);
        
        // Sort: Phien lớn nhất lên đầu
        sortDatabase();
        
        // Xóa cũ nếu quá MAX_DATA
        while (database.length > MAX_DATA) {
          const removed = database.pop();
          existingSessions.delete(removed.Phien);
        }
        
        console.log(`✅ MỚI! Phiên: ${phien} | ${data.Ket_qua} | [${data.Xuc_xac_1},${data.Xuc_xac_2},${data.Xuc_xac_3}] | Tổng: ${data.Tong} | DB: ${database.length}`);
        lastUpdateCount = currentUpdateCount;
      }
    }
  } catch (e) {
    if (Math.random() < 0.02) {
      console.log("❌ Fetch error:", e.message);
    }
  }

  isFetching = false;
}

// ======================
// ROUTES
// ======================

// Home
app.get("/", (req, res) => {
  const latest = database.length > 0 ? database[0] : null;
  
  res.json({
    status: "running",
    total: database.length,
    max_data: MAX_DATA,
    latest_Phien: latest ? latest.Phien : null,
    latest_Ket_qua: latest ? latest.Ket_qua : null,
    latest_time: latest ? latest.server_time : null,
    api: API_URL,
    sorted_by: "Phien DESC (lớn nhất trên đầu)"
  });
});

// Tất cả data (đã sort)
app.get("/data", (req, res) => {
  res.json({
    total: database.length,
    sorted_by: "Phien DESC",
    data: database
  });
});

// Phiên mới nhất
app.get("/latest", (req, res) => {
  if (database.length === 0) {
    return res.json({ error: "Chưa có dữ liệu" });
  }
  res.json(database[0]);
});

// N phiên mới nhất
app.get("/limit", (req, res) => {
  const n = Math.min(Number(req.query.n) || 10, database.length);
  
  res.json({
    total: database.length,
    limit: n,
    data: database.slice(0, n)
  });
});

// Tìm phiên
app.get("/data/:phien", (req, res) => {
  const phien = Number(req.params.phien);
  const found = database.find(i => i.Phien === phien);
  
  if (!found) {
    return res.status(404).json({ error: "Không tìm thấy phiên " + phien });
  }
  
  res.json(found);
});

// Thống kê
app.get("/stats", (req, res) => {
  const total = database.length;
  
  if (total === 0) {
    return res.json({ total: 0, Tai: 0, Xiu: 0 });
  }
  
  const tai = database.filter(i => i.Ket_qua === "Tài").length;
  const xiu = database.filter(i => i.Ket_qua === "Xỉu").length;
  
  res.json({
    total: total,
    Tai: tai,
    Xiu: xiu,
    ti_le_Tai: ((tai / total) * 100).toFixed(1) + "%",
    ti_le_Xiu: ((xiu / total) * 100).toFixed(1) + "%",
    Phien_moi_nhat: database[0],
    Phien_cu_nhat: database[database.length - 1]
  });
});

// Xóa data
app.post("/clear", (req, res) => {
  database = [];
  existingSessions.clear();
  saveData();
  
  res.json({ success: true, message: "Đã xóa tất cả dữ liệu" });
});

// Health check
app.get("/health", (req, res) => {
  res.json({
    status: "healthy",
    total_records: database.length,
    uptime: Math.floor(process.uptime())
  });
});

// ======================
// START SERVER
// ======================
app.listen(PORT, "0.0.0.0", () => {
  console.log("╔══════════════════════════════════════╗");
  console.log("║   SUNWIN COLLECTOR V3               ║");
  console.log("╠══════════════════════════════════════╣");
  console.log(`║  Port: ${PORT}                        ║`);
  console.log(`║  API: apigocsun.onrender.com        ║`);
  console.log(`║  Fetch: ${FETCH_DELAY}ms                     ║`);
  console.log(`║  Sort: Phien DESC                   ║`);
  console.log("╚══════════════════════════════════════╝\n");
  
  // Fetch liên tục
  setInterval(fetchAndSave, FETCH_DELAY);
  fetchAndSave(); // Fetch ngay lần đầu
});

// Shutdown
process.on("SIGTERM", () => { saveData(); process.exit(0); });
process.on("SIGINT", () => { saveData(); process.exit(0); });
