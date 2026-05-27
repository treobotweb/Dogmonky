const express = require("express");
const axios = require("axios");
const fs = require("fs");

const app = express();

const PORT = process.env.PORT || 3000;

const API_URL =
  "http://103.249.117.201:49483/sunwin/tx?key=f7fe0e32f71684bd95ec94f59609801364193b297db4d60e";

const DATA_FILE = "data.json";

const FETCH_DELAY = 100; // 0.1 giây

const MAX_DATA = 10000;

let isFetching = false;
let fetchCount = 0;
let successCount = 0;

// ======================
// LOAD DATA
// ======================
function loadData() {
  try {
    if (fs.existsSync(DATA_FILE)) {
      const data = JSON.parse(fs.readFileSync(DATA_FILE, "utf8"));
      if (Array.isArray(data)) {
        console.log(`📂 Đã load ${data.length} records từ file`);
        return data;
      }
    }
  } catch (e) {
    console.log("Load data lỗi:", e.message);
  }
  return [];
}

// ======================
// SAVE DATA
// ======================
let saveTimeout = null;
function saveData(data) {
  if (saveTimeout) clearTimeout(saveTimeout);
  
  saveTimeout = setTimeout(() => {
    try {
      fs.writeFileSync(DATA_FILE, JSON.stringify(data, null, 2), "utf8");
    } catch (e) {
      console.log("Save data lỗi:", e.message);
    }
  }, 1000);
}

function forceSave() {
  if (saveTimeout) clearTimeout(saveTimeout);
  try {
    fs.writeFileSync(DATA_FILE, JSON.stringify(database, null, 2), "utf8");
    console.log("💾 Đã lưu data!");
  } catch (e) {
    console.log("Force save lỗi:", e.message);
  }
}

// ======================
// MEMORY
// ======================
let database = loadData();
let existingSessions = new Set(database.map((i) => i.phien));

// ======================
// FETCH API
// ======================
async function fetchData() {
  try {
    const res = await axios.get(API_URL, {
      timeout: 5000,
      headers: {
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
        "Accept": "application/json",
        "Cache-Control": "no-cache"
      }
    });
    
    fetchCount++;
    return res.data;
  } catch (e) {
    if (fetchCount % 50 === 0) {
      console.log("API lỗi:", e.message);
    }
    return null;
  }
}

// ======================
// COLLECTOR
// ======================
async function collector() {
  console.log("╔════════════════════════════════════════╗");
  console.log("║     SUNWIN DATA COLLECTOR v2.0         ║");
  console.log("╠════════════════════════════════════════╣");
  console.log(`║  Fetch: mỗi ${FETCH_DELAY}ms (0.1 giây)      ║`);
  console.log(`║  Total: ${database.length} records               ║`);
  console.log("╚════════════════════════════════════════╝\n");

  // Chạy liên tục
  while (true) {
    if (!isFetching) {
      isFetching = true;
      
      try {
        const result = await fetchData();
        
        // Kiểm tra đúng format API: { success: true, data: { phien, ket_qua, ... } }
        if (result && result.success === true && result.data && result.data.phien) {
          const d = result.data;
          const phien = Number(d.phien);
          
          // Chưa có trong database
          if (!existingSessions.has(phien)) {
            successCount++;
            
            const newRecord = {
              phien: phien,
              ket_qua: d.ket_qua,
              thoi_gian: d.thoi_gian,
              tong: Number(d.tong),
              xuc_xac_1: Number(d.xuc_xac_1),
              xuc_xac_2: Number(d.xuc_xac_2),
              xuc_xac_3: Number(d.xuc_xac_3),
              timestamp: Date.now()
            };
            
            // Thêm vào đầu mảng (mới nhất lên đầu)
            database.push(newRecord);
            existingSessions.add(phien);
            
            // Giới hạn data
            if (database.length > MAX_DATA) {
              const removed = database.shift();
              existingSessions.delete(removed.phien);
            }
            
            // Log mỗi phiên mới
            console.log(`✅ #${successCount} | Phiên: ${phien} | ${d.ket_qua} | [${d.xuc_xac_1},${d.xuc_xac_2},${d.xuc_xac_3}] | Tổng: ${d.tong} | Total: ${database.length}`);
            
            // Lưu data
            saveData(database);
          }
        }
      } catch (e) {
        console.log("❌ Collector lỗi:", e.message);
      }
      
      isFetching = false;
    }
    
    // Đợi 100ms trước khi fetch tiếp
    await new Promise(r => setTimeout(r, FETCH_DELAY));
  }
}

// ======================
// API ROUTES
// ======================

// Home
app.get("/", (req, res) => {
  const latest = database.length > 0 ? database[database.length - 1] : null;
  
  res.json({
    status: "running",
    total: database.length,
    max_data: MAX_DATA,
    fetch_delay_ms: FETCH_DELAY,
    total_fetches: fetchCount,
    total_new_records: successCount,
    latest_phien: latest ? latest.phien : null,
    latest_time: latest ? latest.thoi_gian : null
  });
});

// Tất cả data (mới nhất cuối)
app.get("/data", (req, res) => {
  res.json({
    total: database.length,
    data: database
  });
});

// Data mới nhất lên đầu
app.get("/data/reverse", (req, res) => {
  res.json({
    total: database.length,
    data: [...database].reverse()
  });
});

// Phiên mới nhất
app.get("/latest", (req, res) => {
  if (!database.length) {
    return res.status(404).json({ error: "Chưa có dữ liệu" });
  }
  res.json(database[database.length - 1]);
});

// Lấy n phiên gần nhất
app.get("/limit", (req, res) => {
  const limit = Math.min(
    Math.max(Number(req.query.n) || 10, 1),
    database.length
  );

  res.json({
    limit: limit,
    total: database.length,
    data: database.slice(-limit).reverse()
  });
});

// Tìm phiên cụ thể
app.get("/data/:phien", (req, res) => {
  const phien = Number(req.params.phien);

  if (isNaN(phien)) {
    return res.status(400).json({ error: "Số phiên không hợp lệ" });
  }

  const found = database.find((i) => i.phien === phien);

  if (!found) {
    return res.status(404).json({ error: `Không tìm thấy phiên ${phien}` });
  }

  res.json(found);
});

// Thống kê
app.get("/stats", (req, res) => {
  const total = database.length;
  
  if (total === 0) {
    return res.json({
      total: 0,
      tai: 0,
      xiu: 0,
      ti_le_tai: "0%",
      ti_le_xiu: "0%"
    });
  }

  const tai = database.filter((i) => i.ket_qua === "Tài").length;
  const xiu = database.filter((i) => i.ket_qua === "Xỉu").length;

  res.json({
    total: total,
    tai: tai,
    xiu: xiu,
    ti_le_tai: ((tai / total) * 100).toFixed(1) + "%",
    ti_le_xiu: ((xiu / total) * 100).toFixed(1) + "%",
    phien_moi_nhat: database[total - 1],
    phien_cu_nhat: database[0]
  });
});

// Xóa data
app.post("/clear", (req, res) => {
  const oldTotal = database.length;
  database = [];
  existingSessions.clear();
  successCount = 0;
  forceSave();
  
  res.json({
    success: true,
    message: `Đã xóa ${oldTotal} records`
  });
});

// Health check
app.get("/health", (req, res) => {
  res.json({
    status: "healthy",
    uptime: Math.floor(process.uptime()),
    memory_mb: (process.memoryUsage().heapUsed / 1024 / 1024).toFixed(2),
    total_records: database.length,
    total_fetches: fetchCount
  });
});

// ======================
// START SERVER
// ======================
const server = app.listen(PORT, "0.0.0.0", () => {
  console.log(`\n🚀 Server: http://0.0.0.0:${PORT}`);
  console.log(`📊 API: ${API_URL}\n`);
  collector();
});

// Graceful shutdown
process.on("SIGTERM", () => {
  console.log("\n🛑 Shutting down...");
  forceSave();
  server.close(() => process.exit(0));
});

process.on("SIGINT", () => {
  console.log("\n🛑 Shutting down...");
  forceSave();
  server.close(() => process.exit(0));
});
