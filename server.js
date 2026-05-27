const express = require("express");
const axios = require("axios");
const fs = require("fs");

const app = express();

const PORT = process.env.PORT || 3000;

const API_URL =
  "http://103.249.117.201:49483/sunwin/tx?key=f7fe0e32f71684bd95ec94f59609801364193b297db4d60e";

const DATA_FILE = "data.json";
const FETCH_DELAY = 100;
const MAX_DATA = 10000;

let isFetching = false;
let fetchCount = 0;
let successCount = 0;
let lastApiResponse = null;

// ======================
// LOAD DATA
// ======================
function loadData() {
  try {
    if (fs.existsSync(DATA_FILE)) {
      const data = JSON.parse(fs.readFileSync(DATA_FILE, "utf8"));
      if (Array.isArray(data)) {
        console.log(`📂 Loaded ${data.length} records`);
        return data;
      }
    }
  } catch (e) {
    console.log("Load error:", e.message);
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
      console.log("Save error:", e.message);
    }
  }, 1000);
}

function forceSave() {
  if (saveTimeout) clearTimeout(saveTimeout);
  try {
    fs.writeFileSync(DATA_FILE, JSON.stringify(database, null, 2), "utf8");
  } catch (e) {
    console.log("Force save error:", e.message);
  }
}

// ======================
// MEMORY
// ======================
let database = loadData();
let existingSessions = new Set(database.map((i) => i.phien));

// ======================
// FETCH API - ĐƠN GIẢN NHẤT
// ======================
async function fetchData() {
  try {
    const res = await axios.get(API_URL, {
      timeout: 10000,
      headers: {
        "User-Agent": "Mozilla/5.0"
      }
    });
    
    fetchCount++;
    
    // Lưu response để debug
    lastApiResponse = {
      time: new Date().toISOString(),
      data: res.data
    };
    
    return res.data;
  } catch (e) {
    console.log(`❌ Fetch error (${fetchCount}):`, e.message);
    lastApiResponse = {
      time: new Date().toISOString(),
      error: e.message
    };
    return null;
  }
}

// ======================
// COLLECTOR - ĐƠN GIẢN
// ======================
async function collector() {
  console.log("🚀 Collector started");
  console.log(`📊 Current records: ${database.length}`);
  console.log(`⏱️  Fetch every: ${FETCH_DELAY}ms\n`);

  // Fetch ngay lần đầu
  await processFetch();
  
  // Sau đó fetch liên tục
  setInterval(async () => {
    await processFetch();
  }, FETCH_DELAY);
}

async function processFetch() {
  if (isFetching) return;
  isFetching = true;
  
  try {
    const result = await fetchData();
    
    // Log response mỗi 10 lần fetch
    if (fetchCount <= 3 || fetchCount % 10 === 0) {
      console.log(`\n📡 Fetch #${fetchCount}:`);
      console.log(JSON.stringify(result, null, 2));
    }
    
    // Kiểm tra và parse data
    if (result && result.success && result.data) {
      const d = result.data;
      
      if (d.phien) {
        const phien = Number(d.phien);
        
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
          
          database.push(newRecord);
          existingSessions.add(phien);
          
          if (database.length > MAX_DATA) {
            const removed = database.shift();
            existingSessions.delete(removed.phien);
          }
          
          saveData(database);
          
          console.log(`✅ NEW! Phiên: ${phien} | ${d.ket_qua} | [${d.xuc_xac_1},${d.xuc_xac_2},${d.xuc_xac_3}] | Tổng: ${d.tong} | DB: ${database.length}`);
        }
      }
    }
  } catch (e) {
    console.log("❌ Process error:", e.message);
  }
  
  isFetching = false;
}

// ======================
// API ROUTES
// ======================

app.get("/", (req, res) => {
  const latest = database.length > 0 ? database[database.length - 1] : null;
  
  res.json({
    status: "running",
    total: database.length,
    max_data: MAX_DATA,
    fetch_count: fetchCount,
    success_count: successCount,
    last_phien: latest ? latest.phien : null,
    last_result: latest ? latest.ket_qua : null,
    last_time: latest ? latest.thoi_gian : null
  });
});

// DEBUG: Xem API response mới nhất
app.get("/debug", (req, res) => {
  res.json({
    total_records: database.length,
    fetch_count: fetchCount,
    last_api_response: lastApiResponse,
    latest_records: database.slice(-3).reverse()
  });
});

app.get("/data", (req, res) => {
  res.json({
    total: database.length,
    data: database
  });
});

app.get("/latest", (req, res) => {
  if (!database.length) {
    return res.status(404).json({ error: "No data yet" });
  }
  res.json(database[database.length - 1]);
});

app.get("/limit", (req, res) => {
  const n = Number(req.query.n) || 10;
  res.json({
    total: database.length,
    data: database.slice(-n).reverse()
  });
});

app.get("/data/:phien", (req, res) => {
  const phien = Number(req.params.phien);
  const found = database.find(i => i.phien === phien);
  
  if (!found) {
    return res.status(404).json({ error: "Not found" });
  }
  
  res.json(found);
});

app.get("/stats", (req, res) => {
  const total = database.length;
  const tai = database.filter(i => i.ket_qua === "Tài").length;
  const xiu = database.filter(i => i.ket_qua === "Xỉu").length;
  
  res.json({
    total,
    tai,
    xiu,
    ti_le_tai: total > 0 ? ((tai/total)*100).toFixed(1) + "%" : "0%",
    ti_le_xiu: total > 0 ? ((xiu/total)*100).toFixed(1) + "%" : "0%"
  });
});

app.post("/clear", (req, res) => {
  database = [];
  existingSessions.clear();
  successCount = 0;
  forceSave();
  res.json({ success: true, message: "Cleared" });
});

// ======================
// START
// ======================
const server = app.listen(PORT, "0.0.0.0", () => {
  console.log(`\n🌐 Server: http://0.0.0.0:${PORT}`);
  console.log(`🔗 API: ${API_URL}\n`);
  
  // Test API ngay khi start
  axios.get(API_URL, { timeout: 10000 })
    .then(res => {
      console.log("✅ API TEST OK:");
      console.log(JSON.stringify(res.data, null, 2));
    })
    .catch(err => {
      console.log("❌ API TEST FAILED:", err.message);
    })
    .finally(() => {
      collector();
    });
});

process.on("SIGTERM", () => {
  forceSave();
  server.close(() => process.exit(0));
});

process.on("SIGINT", () => {
  forceSave();
  server.close(() => process.exit(0));
});
