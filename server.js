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
// SAVE DATA (debounce 1 giây)
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
    console.log("Đã lưu data thành công!");
  } catch (e) {
    console.log("Force save lỗi:", e.message);
  }
}

// ======================
// MEMORY
// ======================
let database = loadData();
let existingSessions = new Set(database.map((i) => i.phien).filter(p => p !== null));

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
// PARSE DATA - Xử lý mọi format API
// ======================
function parseData(rawData) {
  // Format 1: { success: true, data: { phien, ket_qua, ... } }
  if (rawData && rawData.success && rawData.data && rawData.data.phien) {
    return {
      ...rawData.data,
      source_format: "format_1"
    };
  }
  
  // Format 2: Trả thẳng { phien, ket_qua, ... }
  if (rawData && rawData.phien) {
    return {
      ...rawData,
      source_format: "format_2"
    };
  }
  
  // Format 3: { data: { phien, md5_hash } } - Format bạn đang thấy
  if (rawData && rawData.data) {
    const data = rawData.data;
    
    // Nếu có phien và md5_hash
    if (data.phien !== undefined || data.md5_hash !== undefined) {
      // Có thể API đang chờ phiên mới, trả về null
      if (data.phien === null) {
        return {
          phien: null,
          md5_hash: data.md5_hash || "",
          ket_qua: data.ket_qua || "",
          tong: data.tong || 0,
          xuc_xac_1: data.xuc_xac_1 || 0,
          xuc_xac_2: data.xuc_xac_2 || 0,
          xuc_xac_3: data.xuc_xac_3 || 0,
          thoi_gian: data.thoi_gian || "",
          source_format: "format_3"
        };
      }
      
      return {
        ...data,
        source_format: "format_3"
      };
    }
  }
  
  // Format 4: Object có ket_qua trực tiếp
  if (rawData && rawData.ket_qua) {
    return {
      ...rawData,
      source_format: "format_4"
    };
  }
  
  return null;
}

// ======================
// COLLECTOR
// ======================
async function collector() {
  console.log("╔════════════════════════════════════════╗");
  console.log("║     SUNWIN DATA COLLECTOR              ║");
  console.log("╠════════════════════════════════════════╣");
  console.log(`║  Fetch: mỗi ${FETCH_DELAY}ms (0.1 giây)      ║`);
  console.log(`║  Total hiện tại: ${database.length} records     ║`);
  console.log("╚════════════════════════════════════════╝");
  console.log("");

  while (true) {
    try {
      const rawResult = await fetchData();
      
      if (!rawResult) {
        await new Promise(r => setTimeout(r, FETCH_DELAY));
        continue;
      }
      
      // Parse data
      const d = parseData(rawResult);
      
      if (!d) {
        console.log("⚠️ Không parse được data:", JSON.stringify(rawResult).substring(0, 200));
        await new Promise(r => setTimeout(r, FETCH_DELAY));
        continue;
      }
      
      // Log format để debug
      if (database.length === 0) {
        console.log("📊 Format API:", d.source_format);
        console.log("📊 Data mẫu:", JSON.stringify(d));
      }
      
      const phien = d.phien;
      
      // Bỏ qua nếu phien là null (đang chờ phiên mới)
      if (phien === null || phien === undefined) {
        // Log mỗi 5 giây để tránh spam
        if (Math.floor(Date.now() / 5000) % 2 === 0) {
          console.log("⏳ Đang chờ phiên mới...");
        }
        await new Promise(r => setTimeout(r, FETCH_DELAY));
        continue;
      }
      
      const phienNum = Number(phien);
      
      // Kiểm tra phiên hợp lệ
      if (isNaN(phienNum)) {
        console.log("⚠️ Phiên không hợp lệ:", phien);
        await new Promise(r => setTimeout(r, FETCH_DELAY));
        continue;
      }
      
      // Chống trùng
      if (!existingSessions.has(phienNum)) {
        const newRecord = {
          phien: phienNum,
          md5_hash: d.md5_hash || "",
          ket_qua: d.ket_qua || "",
          thoi_gian: d.thoi_gian || new Date().toLocaleString("vi-VN", { timeZone: "Asia/Ho_Chi_Minh" }),
          tong: Number(d.tong) || 0,
          xuc_xac_1: Number(d.xuc_xac_1) || 0,
          xuc_xac_2: Number(d.xuc_xac_2) || 0,
          xuc_xac_3: Number(d.xuc_xac_3) || 0,
          timestamp: Date.now()
        };
        
        database.push(newRecord);
        existingSessions.add(phienNum);
        
        // Giới hạn data
        if (database.length > MAX_DATA) {
          const removed = database.shift();
          existingSessions.delete(removed.phien);
        }
        
        saveData(database);
        
        // Log đẹp
        const xucXac = [newRecord.xuc_xac_1, newRecord.xuc_xac_2, newRecord.xuc_xac_3]
          .filter(x => x > 0)
          .join(",");
        
        console.log(`✅ [${newRecord.thoi_gian}] Phiên: ${phienNum} | ${newRecord.ket_qua || 'N/A'} | Xúc xắc: [${xucXac || 'N/A'}] | Tổng: ${newRecord.tong || 'N/A'} | Total: ${database.length}`);
      }
      
    } catch (e) {
      console.log("❌ Collector lỗi:", e.message);
    }
    
    await new Promise(r => setTimeout(r, FETCH_DELAY));
  }
}

// ======================
// API ROUTES
// ======================

// Home - Thông tin server
app.get("/", (req, res) => {
  const latestRecord = database.length > 0 ? database[database.length - 1] : null;
  
  res.json({
    status: "running",
    total: database.length,
    max_data: MAX_DATA,
    fetch_delay_ms: FETCH_DELAY,
    last_update: latestRecord ? latestRecord.thoi_gian : null,
    last_phien: latestRecord ? latestRecord.phien : null,
    endpoints: {
      all_data: "/data",
      latest: "/latest",
      limit: "/limit?n=20",
      search: "/data/:phien",
      stats: "/stats",
      clear: "/clear (POST)",
      health: "/health",
      test_api: "/test-api"
    }
  });
});

// Tất cả dữ liệu
app.get("/data", (req, res) => {
  res.json({
    total: database.length,
    data: database
  });
});

// Phiên mới nhất
app.get("/latest", (req, res) => {
  if (!database.length) {
    return res.status(404).json({ error: "Không có dữ liệu" });
  }
  res.json(database[database.length - 1]);
});

// Lấy n phiên gần nhất
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

// Tìm theo số phiên
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

// Thống kê
app.get("/stats", (req, res) => {
  const total = database.length;
  
  if (total === 0) {
    return res.json({
      total: 0,
      tai: 0,
      xiu: 0,
      ti_le_tai: "0.00%",
      ti_le_xiu: "0.00%"
    });
  }

  const tai = database.filter((i) => i.ket_qua === "Tài").length;
  const xiu = database.filter((i) => i.ket_qua === "Xỉu").length;
  
  // Tính tổng điểm trung bình
  const tongTrungBinh = database.reduce((sum, i) => sum + (i.tong || 0), 0) / total;

  res.json({
    total: total,
    tai: tai,
    xiu: xiu,
    ti_le_tai: ((tai / total) * 100).toFixed(2) + "%",
    ti_le_xiu: ((xiu / total) * 100).toFixed(2) + "%",
    tong_trung_binh: tongTrungBinh.toFixed(2),
    phien_moi_nhat: database[total - 1],
    phien_cu_nhat: database[0]
  });
});

// Xóa dữ liệu
app.post("/clear", (req, res) => {
  const oldCount = database.length;
  database = [];
  existingSessions.clear();
  forceSave();
  
  res.json({
    success: true,
    message: `Đã xóa ${oldCount} records`,
    total: 0
  });
});

// Test API
app.get("/test-api", async (req, res) => {
  try {
    const result = await axios.get(API_URL, {
      timeout: 5000,
      headers: {
        "User-Agent": "Mozilla/5.0",
        "Accept": "application/json"
      }
    });
    
    const parsedData = parseData(result.data);
    
    res.json({
      status: "success",
      raw_response: result.data,
      parsed_data: parsedData,
      current_database_total: database.length
    });
  } catch (e) {
    res.json({ 
      error: e.message,
      current_database_total: database.length
    });
  }
});

// Health check
app.get("/health", (req, res) => {
  res.json({
    status: "healthy",
    uptime_seconds: Math.floor(process.uptime()),
    memory_mb: (process.memoryUsage().heapUsed / 1024 / 1024).toFixed(2),
    total_records: database.length
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
  console.log(`🚀 Server running at http://0.0.0.0:${PORT}`);
  collector();
});

// Graceful shutdown
process.on("SIGTERM", () => {
  console.log("\n🛑 Đang shutdown...");
  forceSave();
  server.close(() => {
    console.log("✅ Server đã đóng");
    process.exit(0);
  });
});

process.on("SIGINT", () => {
  console.log("\n🛑 Đang shutdown...");
  forceSave();
  server.close(() => {
    console.log("✅ Server đã đóng");
    process.exit(0);
  });
});
