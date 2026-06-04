const express = require("express");
const axios = require("axios");
const fs = require("fs");

const app = express();
const PORT = process.env.PORT || 3000;

// API MỚI
const API_URL = "https://refresh-petite-upc-indication.trycloudflare.com";
const DATA_FILE = "data.json";
const FETCH_DELAY = 100; // 0.1 giây
const MAX_DATA = 100; // 100 phiên

let database = [];
let existingSessions = new Set();
let isFetching = false;

// ======================
// CONVERT: Tai -> Tài, Xiu -> Xỉu
// ======================
function convertKetQua(value) {
  if (!value) return "";
  
  const clean = String(value).trim().toLowerCase();
  
  if (clean === "tai" || clean === "tài") return "Tài";
  if (clean === "xiu" || clean === "xỉu") return "Xỉu";
  
  return value;
}

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
      console.log(`📂 Loaded ${database.length}/${MAX_DATA} records`);
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

    // API trả về 1 object: { Phien, Xuc_xac_1, Xuc_xac_2, Xuc_xac_3, Tong, Ket_qua }
    if (data && data.Phien) {
      const phien = Number(data.Phien);
      
      // Chưa có trong database
      if (phien && !existingSessions.has(phien)) {
        
        const record = {
          Phien: phien,
          Xuc_xac_1: Number(data.Xuc_xac_1),
          Xuc_xac_2: Number(data.Xuc_xac_2),
          Xuc_xac_3: Number(data.Xuc_xac_3),
          Tong: Number(data.Tong),
          Ket_qua: convertKetQua(data.Ket_qua), // Tai -> Tài, Xiu -> Xỉu
          id: "@anhkhoidzai102",
          timestamp: Date.now()
        };

        database.push(record);
        existingSessions.add(phien);
        
        // Sort: Phien lớn nhất lên đầu
        sortDatabase();
        
        // Giới hạn 100 phiên
        while (database.length > MAX_DATA) {
          const removed = database.pop();
          existingSessions.delete(removed.Phien);
        }
        
        console.log(`✅ Phiên: ${phien} | ${record.Ket_qua} | [${record.Xuc_xac_1},${record.Xuc_xac_2},${record.Xuc_xac_3}] | Tổng: ${record.Tong} | id:${record.id} | DB: ${database.length}/${MAX_DATA}`);
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
    api: API_URL,
    sorted_by: "Phien DESC (lớn nhất trên đầu)",
    id: "@anhkhoidzai102"
  });
});

// Tất cả 100 phiên (đã sort Phien DESC)
app.get("/data", (req, res) => {
  res.json({
    total: database.length,
    max_data: MAX_DATA,
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
    max_data: MAX_DATA,
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
    max_data: MAX_DATA,
    uptime_seconds: Math.floor(process.uptime())
  });
});

// ======================
// START SERVER
// ======================
app.listen(PORT, "0.0.0.0", () => {
  console.log("╔══════════════════════════════════════╗");
  console.log("║   SUNWIN COLLECTOR - 100 PHIÊN      ║");
  console.log("╠══════════════════════════════════════╣");
  console.log(`║  Port: ${PORT}                        ║`);
  console.log(`║  API: trycloudflare.com             ║`);
  console.log(`║  Fetch: ${FETCH_DELAY}ms (0.1 giây)      ║`);
  console.log(`║  Max: ${MAX_DATA} phiên                    ║`);
  console.log(`║  id: @anhkhoidzai102                ║`);
  console.log(`║  Tai/Xiu -> Tài/Xỉu                 ║`);
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
