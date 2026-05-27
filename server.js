const express = require("express");
const axios = require("axios");
const fs = require("fs");

const app = express();
const PORT = process.env.PORT || 3000;

const API_URL = "http://103.249.117.201:49483/sunwin/tx?key=f7fe0e32f71684bd95ec94f59609801364193b297db4d60e";
const DATA_FILE = "data.json";
const FETCH_DELAY = 100; // 0.1 giây
const MAX_DATA = 10000;

let database = [];
let existingSessions = new Set();
let isFetching = false;

// ======================
// LOAD DATA TỪ FILE
// ======================
try {
  if (fs.existsSync(DATA_FILE)) {
    const raw = fs.readFileSync(DATA_FILE, "utf8");
    database = JSON.parse(raw);
    if (Array.isArray(database)) {
      existingSessions = new Set(database.map(i => i.phien));
      console.log(`📂 Loaded ${database.length} records`);
    }
  }
} catch (e) {
  console.log("Load error:", e.message);
  database = [];
}

// ======================
// SAVE DATA
// ======================
function saveData() {
  try {
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

    // Kiểm tra đúng format: {"success":true,"data":{...}}
    if (data && data.success === true && data.data && data.data.phien) {
      const d = data.data;
      const phien = Number(d.phien);

      // Chưa có trong database
      if (!existingSessions.has(phien)) {
        
        // Tạo record đúng format
        const record = {
          ket_qua: d.ket_qua,
          phien: phien,
          thoi_gian: d.thoi_gian,
          tong: Number(d.tong),
          xuc_xac_1: Number(d.xuc_xac_1),
          xuc_xac_2: Number(d.xuc_xac_2),
          xuc_xac_3: Number(d.xuc_xac_3)
        };

        database.push(record);
        existingSessions.add(phien);

        // Xóa cũ nếu quá MAX_DATA
        while (database.length > MAX_DATA) {
          const removed = database.shift();
          existingSessions.delete(removed.phien);
        }

        console.log(`✅ Phiên: ${phien} | ${d.ket_qua} | [${d.xuc_xac_1},${d.xuc_xac_2},${d.xuc_xac_3}] | Tổng: ${d.tong} | DB: ${database.length}`);
      }
    }
  } catch (e) {
    // Chỉ log lỗi mỗi 100 lần để tránh spam
    if (Math.random() < 0.01) {
      console.log("❌ Fetch error:", e.message);
    }
  }

  isFetching = false;
}

// ======================
// ROUTES
// ======================

// Home - Kiểm tra trạng thái
app.get("/", (req, res) => {
  const latest = database.length > 0 ? database[database.length - 1] : null;
  
  res.json({
    status: "running",
    total: database.length,
    latest_phien: latest ? latest.phien : null,
    latest_ket_qua: latest ? latest.ket_qua : null,
    latest_time: latest ? latest.thoi_gian : null
  });
});

// Tất cả data
app.get("/data", (req, res) => {
  res.json({
    total: database.length,
    data: database
  });
});

// Phiên mới nhất
app.get("/latest", (req, res) => {
  if (database.length === 0) {
    return res.json({ error: "Chưa có dữ liệu" });
  }
  res.json(database[database.length - 1]);
});

// Lấy N phiên gần nhất
app.get("/limit", (req, res) => {
  const n = Math.min(Number(req.query.n) || 10, database.length);
  
  res.json({
    total: database.length,
    limit: n,
    data: database.slice(-n).reverse()
  });
});

// Tìm phiên cụ thể
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
    ti_le_xiu: ((xiu / total) * 100).toFixed(1) + "%"
  });
});

// Xóa data
app.post("/clear", (req, res) => {
  database = [];
  existingSessions.clear();
  saveData();
  
  res.json({ success: true, message: "Đã xóa tất cả dữ liệu" });
});

// ======================
// START SERVER
// ======================
app.listen(PORT, "0.0.0.0", () => {
  console.log(`🚀 Server chạy tại port ${PORT}`);
  console.log(`🔗 API: ${API_URL}`);
  console.log(`⏱️  Fetch mỗi ${FETCH_DELAY}ms\n`);
  
  // Chạy fetch liên tục mỗi 0.1 giây
  setInterval(fetchAndSave, FETCH_DELAY);
  
  // Fetch lần đầu ngay lập tức
  fetchAndSave();
});
