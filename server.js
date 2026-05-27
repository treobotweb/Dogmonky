const express = require("express");
const axios = require("axios");
const fs = require("fs");

const app = express();

const PORT = process.env.PORT || 3000;

const API_URL =
  "http://103.249.117.201:49483/sunwin/tx?key=f7fe0e32f71684bd95ec94f59609801364193b297db4d60e";

const DATA_FILE = "data.json";

const FETCH_DELAY = 100; // 0.1 giây

const MAX_DATA = 30000;

let isFetching = false;

// ======================
// LOAD DATA
// ======================
function loadData() {
  try {
    if (fs.existsSync(DATA_FILE)) {
      const data = JSON.parse(fs.readFileSync(DATA_FILE, "utf8"));
      if (Array.isArray(data)) {
        return data;
      }
    }
  } catch (e) {
    console.log("Load data lỗi:", e.message);
  }
  return [];
}

// ======================
// SAVE DATA (debounce)
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
async function fetchData(retries = 3) {
  for (let i = 0; i < retries; i++) {
    try {
      const res = await axios.get(API_URL, {
        timeout: 2000,
        headers: {
          "User-Agent": "Mozilla/5.0",
          "Accept": "application/json",
          "Cache-Control": "no-cache"
        }
      });
      return res.data;
    } catch (e) {
      if (i === retries - 1) {
        console.log("API lỗi sau", retries, "lần thử:", e.message);
        return null;
      }
      await new Promise(r => setTimeout(r, 50));
    }
  }
}

// ======================
// COLLECTOR
// ======================
async function collector() {
  console.log(`[Collector] Start với ${database.length} phiên - Fetch mỗi ${FETCH_DELAY}ms`);

  const interval = setInterval(async () => {
    if (isFetching) return;
    isFetching = true;

    try {
      const result = await fetchData();

      if (result && result.success && result.data) {
        const d = result.data;
        const phien = Number(d.phien);

        if (isNaN(phien)) {
          console.log("Phiên không hợp lệ:", d.phien);
          isFetching = false;
          return;
        }

        if (!existingSessions.has(phien)) {
          const newRecord = {
            phien: phien,
            xuc_xac_1: d.xuc_xac_1,
            xuc_xac_2: d.xuc_xac_2,
            xuc_xac_3: d.xuc_xac_3,
            tong: d.tong,
            ket_qua: d.ket_qua,
            timestamp: Date.now()
          };

          database.push(newRecord);
          existingSessions.add(phien);

          if (database.length > MAX_DATA) {
            const removed = database.shift();
            existingSessions.delete(removed.phien);
          }

          saveData(database);

          if (database.length % 10 === 0 || database.length <= 5) {
            console.log(`[Collector] + ${phien} | ${d.ket_qua} | Tổng: ${d.tong} | Total: ${database.length}`);
          }
        }
      }
    } catch (e) {
      console.log("Collector lỗi:", e.message);
    }

    isFetching = false;
  }, FETCH_DELAY);

  return interval;
}

// ======================
// API ROUTES
// ======================

// Home
app.get("/", (req, res) => {
  res.json({
    status: "running",
    total: database.length,
    max_data: MAX_DATA,
    fetch_delay_ms: FETCH_DELAY,
    last_update: database.length > 0 ? database[database.length - 1].timestamp : null
  });
});

// All data
app.get("/data", (req, res) => {
  res.json({
    total: database.length,
    data: database
  });
});

// Latest
app.get("/latest", (req, res) => {
  if (!database.length) {
    return res.status(404).json({ error: "Không có dữ liệu" });
  }
  res.json(database[database.length - 1]);
});

// FIX 1: Đổi route /data/limit thành /limit để tránh conflict với /data/:phien
app.get("/limit", (req, res) => {
  const limit = Math.min(
    Math.max(Number(req.query.n) || 10, 1),
    MAX_DATA
  );

  res.json({
    limit: limit,
    total: database.length,
    data: database.slice(-limit)
  });
});

// Search by phien
app.get("/data/:phien", (req, res) => {
  const phien = Number(req.params.phien);

  if (isNaN(phien)) {
    return res.status(400).json({ error: "Phiên không hợp lệ" });
  }

  const found = database.find((i) => i.phien === phien);

  if (!found) {
    return res.status(404).json({ error: "Không tìm thấy phiên " + phien });
  }

  res.json(found);
});

// Stats
app.get("/stats", (req, res) => {
  const total = database.length;
  
  if (total === 0) {
    return res.json({
      total: 0,
      tai: 0,
      xiu: 0,
      ti_le_tai: "0.00",
      ti_le_xiu: "0.00"
    });
  }

  const tai = database.filter((i) => i.ket_qua === "Tài").length;
  const xiu = database.filter((i) => i.ket_qua === "Xỉu").length;

  res.json({
    total: total,
    tai: tai,
    xiu: xiu,
    ti_le_tai: ((tai / total) * 100).toFixed(2),
    ti_le_xiu: ((xiu / total) * 100).toFixed(2)
  });
});

// Clear data
app.post("/clear", (req, res) => {
  database = [];
  existingSessions.clear();
  forceSave();
  
  res.json({
    success: true,
    message: "Đã xóa dữ liệu"
  });
});

// Health check
app.get("/health", (req, res) => {
  res.json({
    status: "healthy",
    uptime: process.uptime(),
    memory_mb: (process.memoryUsage().heapUsed / 1024 / 1024).toFixed(2)
  });
});

// ======================
// ERROR HANDLING
// ======================
app.use((err, req, res, next) => {
  console.error("Server error:", err.message);
  res.status(500).json({ error: "Internal server error" });
});

// ======================
// START SERVER
// ======================
const server = app.listen(PORT, "0.0.0.0", () => {
  console.log(`Server running at http://0.0.0.0:${PORT}`);
  console.log(`Fetch interval: ${FETCH_DELAY}ms (0.1 giây)`);
  collector();
});

// Graceful shutdown
process.on("SIGTERM", () => {
  console.log("Shutting down...");
  forceSave();
  server.close(() => process.exit(0));
});

process.on("SIGINT", () => {
  console.log("Shutting down...");
  forceSave();
  server.close(() => process.exit(0));
});
