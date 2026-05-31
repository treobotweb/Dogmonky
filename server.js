const express = require("express");
const axios = require("axios");
const fs = require("fs");

const app = express();
const PORT = process.env.PORT || 3000;

// API MỚI
const API_URL = "https://farm-indicator-rocky-undergraduate.trycloudflare.com/api/tx";
const DATA_FILE = "data.json";
const FETCH_DELAY = 100; // 0.1 giây
const MAX_DATA = 10000;

let database = [];
let existingSessions = new Set();
let isFetching = false;

// ======================
// LOAD DATA
// ======================
try {
  if (fs.existsSync(DATA_FILE)) {
    const raw = fs.readFileSync(DATA_FILE, "utf8");
    const parsed = JSON.parse(raw);
    if (Array.isArray(parsed)) {
      database = parsed;
      existingSessions = new Set(database.map(i => i.phien));
      console.log(`📂 Loaded ${database.length} records`);
    }
  }
} catch (e) {
  console.log("Load error:", e.message);
  database = [];
}

// ======================
// CONVERT KET QUA: T -> Tài, X -> Xỉu
// ======================
function convertKetQua(value) {
  if (!value) return "";
  
  // Chuẩn hóa Unicode
  const clean = value.normalize("NFD").replace(/[\u0300-\u036f]/g, "");
  
  if (clean === "T" || clean === "Tài" || clean === "Tai" || clean === "tài" || clean === "tai") {
    return "Tài";
  }
  if (clean === "X" || clean === "Xỉu" || clean === "Xiu" || clean === "xỉu" || clean === "xiu") {
    return "Xỉu";
  }
  
  return value; // Trả về nguyên bản nếu không khớp
}

// ======================
// SORT: phien lớn nhất lên đầu
// ======================
function sortDatabase() {
  database.sort((a, b) => b.phien - a.phien);
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

    // API trả về 1 object: { ket_qua, phien, thoi_gian, tong, xuc_xac_1, xuc_xac_2, xuc_xac_3 }
    if (data && data.phien) {
      const phien = Number(data.phien);
      
      // Chưa có trong database
      if (phien && !existingSessions.has(phien)) {
        
        const record = {
          ket_qua: convertKetQua(data.ket_qua), // T -> Tài, X -> Xỉu
          phien: phien,
          tong: Number(data.tong),
          xuc_xac_1: Number(data.xuc_xac_1),
          xuc_xac_2: Number(data.xuc_xac_2),
          xuc_xac_3: Number(data.xuc_xac_3),
          timestamp: Date.now()
        };

        database.push(record);
        existingSessions.add(phien);
        
        // Sort: phien lớn nhất lên đầu
        sortDatabase();
        
        // Giới hạn MAX_DATA
        while (database.length > MAX_DATA) {
          const removed = database.pop();
          existingSessions.delete(removed.phien);
        }
        
        console.log(`✅ Phiên: ${phien} | ${record.ket_qua} | [${record.xuc_xac_1},${record.xuc_xac_2},${record.xuc_xac_3}] | Tổng: ${record.tong} | DB: ${database.length}`);
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
    latest_phien: latest ? latest.phien : null,
    latest_ket_qua: latest ? latest.ket_qua : null,
    api: API_URL,
    sorted_by: "phien DESC (lớn nhất trên đầu)",
    note: "ket_qua: T -> Tài, X -> Xỉu"
  });
});

// Tất cả data (đã sort phien DESC, bỏ thoi_gian)
app.get("/data", (req, res) => {
  res.json({
    total: database.length,
    sorted_by: "phien DESC",
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
  const found = database.find(i => i.phien === phien);
  
  if (!found) {
    return res.status(404).json({ error: "Không tìm thấy phiên " + phien });
  }
  
  res.json(found);
});

// Thống kê
app.get("/stats", (req, res) => {
  const total = database.length;
  
  if (total === 0) {
    return res.json({ total: 0, tai: 0, xiu: 0 });
  }
  
  const tai = database.filter(i => i.ket_qua === "Tài").length;
  const xiu = database.filter(i => i.ket_qua === "Xỉu").length;
  
  res.json({
    total: total,
    tai: tai,
    xiu: xiu,
    ti_le_tai: ((tai / total) * 100).toFixed(1) + "%",
    ti_le_xiu: ((xiu / total) * 100).toFixed(1) + "%",
    phien_moi_nhat: database[0],
    phien_cu_nhat: database[database.length - 1]
  });
});

// Xóa data
app.post("/clear", (req, res) => {
  const oldTotal = database.length;
  database = [];
  existingSessions.clear();
  saveData();
  
  res.json({ 
    success: true, 
    message: `Đã xóa ${oldTotal} records` 
  });
});

// Health check
app.get("/health", (req, res) => {
  res.json({
    status: "healthy",
    total_records: database.length,
    uptime_seconds: Math.floor(process.uptime())
  });
});

// ======================
// START SERVER
// ======================
app.listen(PORT, "0.0.0.0", () => {
  console.log("╔══════════════════════════════════════╗");
  console.log("║   SUNWIN COLLECTOR V5               ║");
  console.log("╠══════════════════════════════════════╣");
  console.log(`║  Port: ${PORT}                        ║`);
  console.log(`║  API: trycloudflare.com/api/tx      ║`);
  console.log(`║  Fetch: ${FETCH_DELAY}ms (0.1 giây)      ║`);
  console.log(`║  Max: ${MAX_DATA} records                ║`);
  console.log(`║  T/X -> Tài/Xỉu                     ║`);
  console.log("╚══════════════════════════════════════╝\n");
  
  // Fetch liên tục mỗi 0.1 giây
  setInterval(fetchAndSave, FETCH_DELAY);
  
  // Fetch lần đầu ngay lập tức
  fetchAndSave();
});

// Graceful shutdown
process.on("SIGTERM", () => { 
  console.log("\n🛑 Shutting down...");
  saveData(); 
  process.exit(0); 
});

process.on("SIGINT", () => { 
  console.log("\n🛑 Shutting down...");
  saveData(); 
  process.exit(0); 
});
