const express = require("express");
const axios = require("axios");
const fs = require("fs");

const app = express();
const PORT = process.env.PORT || 3000;

// API MỚI
const API_URL = "https://sunwin-ke-u8wn.onrender.com/sun";
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
    const parsed = JSON.parse(raw);
    if (Array.isArray(parsed)) {
      database = parsed;
      existingSessions = new Set(database.map(i => i.Phien));
      console.log(`📂 Loaded ${database.length} records`);
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

// Sort data hiện có
sortDatabase();

// ======================
// SAVE DATA
// ======================
function saveData() {
  try {
    sortDatabase(); // Sort trước khi lưu
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

    // API mới trả về mảng trực tiếp
    if (Array.isArray(data)) {
      let newCount = 0;
      
      for (const item of data) {
        const phien = Number(item.Phien);
        
        // Chưa có trong database
        if (phien && !existingSessions.has(phien)) {
          
          // Format mới với key viết hoa
          const record = {
            Phien: phien,
            Xuc_xac_1: Number(item.Xuc_xac_1),
            Xuc_xac_2: Number(item.Xuc_xac_2),
            Xuc_xac_3: Number(item.Xuc_xac_3),
            Tong: Number(item.Tong),
            Ket_qua: item.Ket_qua
          };

          database.push(record);
          existingSessions.add(phien);
          newCount++;
        }
      }
      
      if (newCount > 0) {
        // Sort lại: Phien lớn nhất lên đầu
        sortDatabase();
        
        // Xóa cũ nếu quá MAX_DATA
        while (database.length > MAX_DATA) {
          const removed = database.pop(); // Xóa cuối (nhỏ nhất)
          existingSessions.delete(removed.Phien);
        }
        
        console.log(`✅ Thêm ${newCount} phiên mới | Total: ${database.length} | Mới nhất: ${database[0].Phien}`);
      }
    }
  } catch (e) {
    if (Math.random() < 0.05) {
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
    latest_Phien: latest ? latest.Phien : null,
    latest_Ket_qua: latest ? latest.Ket_qua : null,
    api: API_URL,
    sorted_by: "Phien DESC (lớn nhất trên đầu)"
  });
});

// Tất cả data (đã sort Phien lớn nhất lên đầu)
app.get("/data", (req, res) => {
  res.json({
    total: database.length,
    sorted_by: "Phien DESC",
    data: database
  });
});

// Phiên mới nhất (đầu mảng)
app.get("/latest", (req, res) => {
  if (database.length === 0) {
    return res.json({ error: "Chưa có dữ liệu" });
  }
  res.json(database[0]);
});

// Lấy N phiên mới nhất
app.get("/limit", (req, res) => {
  const n = Math.min(Number(req.query.n) || 10, database.length);
  
  res.json({
    total: database.length,
    limit: n,
    data: database.slice(0, n) // Lấy từ đầu (mới nhất)
  });
});

// Tìm phiên cụ thể
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
  console.log(`🚀 Server chạy tại port ${PORT}`);
  console.log(`🔗 API: ${API_URL}`);
  console.log(`⏱️  Fetch mỗi ${FETCH_DELAY}ms`);
  console.log(`📊 Sắp xếp: Phien lớn nhất lên đầu\n`);
  
  // Chạy fetch liên tục mỗi 0.1 giây
  setInterval(fetchAndSave, FETCH_DELAY);
  
  // Fetch lần đầu ngay lập tức
  fetchAndSave();
});

// Graceful shutdown
process.on("SIGTERM", () => {
  saveData();
  process.exit(0);
});

process.on("SIGINT", () => {
  saveData();
  process.exit(0);
});
