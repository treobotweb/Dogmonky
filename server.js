const express = require("express");
const axios = require("axios");
const fs = require("fs");

const app = express();

const PORT = process.env.PORT || 3000;

const API_URL =
  "https://era-technology-particular-domestic.trycloudflare.com/api/tx";

const DATA_FILE = "data.json";

const FETCH_DELAY = 200; // ✅ 0.2s

const MAX_DATA = 300000;

// ======================
// LOAD DATA
// ======================
function loadData() {
  try {
    if (fs.existsSync(DATA_FILE)) {
      return JSON.parse(
        fs.readFileSync(DATA_FILE, "utf8")
      );
    }
  } catch (e) {
    console.log("Load data lỗi:", e.message);
  }
  return [];
}

// ======================
// SAVE DATA
// ======================
function saveData(data) {
  try {
    fs.writeFileSync(
      DATA_FILE,
      JSON.stringify(data, null, 2),
      "utf8"
    );
  } catch (e) {
    console.log("Save data lỗi:", e.message);
  }
}

// ======================
// MEMORY
// ======================
let database = loadData();

let existingSessions = new Set(
  database.map((i) => i.phien)
);

// ======================
// FETCH API
// ======================
async function fetchData() {
  try {
    const res = await axios.get(API_URL, {
      timeout: 10000,
      headers: {
        "User-Agent": "Mozilla/5.0"
      }
    });

    return res.data; // ✅ API trả thẳng object, không có wrapper

  } catch (e) {
    console.log("API lỗi:", e.message);
    return null;
  }
}

// ======================
// COLLECTOR
// ======================
async function collector() {
  console.log(
    `[Collector] Start với ${database.length} phiên`
  );

  while (true) {
    try {
      const d = await fetchData();

      // ✅ Kiểm tra trực tiếp fields của object
      if (d && d.phien !== undefined) {

        const phien = Number(d.phien);

        if (!existingSessions.has(phien)) {

          const newRecord = {
            phien:     phien,
            thoi_gian: d.thoi_gian,   // ✅ thêm thời gian
            xuc_xac_1: d.xuc_xac_1,
            xuc_xac_2: d.xuc_xac_2,
            xuc_xac_3: d.xuc_xac_3,
            tong:      d.tong,
            ket_qua:   d.ket_qua      // "Tài" hoặc "Xỉu"
          };

          database.push(newRecord);
          existingSessions.add(phien);

          if (database.length > MAX_DATA) {
            const removed = database.shift();
            existingSessions.delete(removed.phien);
          }

          saveData(database);

          console.log(
            `[Collector] + Phiên ${phien} | ${d.ket_qua} | Tổng: ${d.tong} | DB: ${database.length}`
          );

        } else {
          console.log(`[Collector] Trùng phiên ${phien}`);
        }

      } else {
        console.log("[Collector] Dữ liệu không hợp lệ:", d);
      }

    } catch (e) {
      console.log("Collector lỗi:", e.message);
    }

    await new Promise((r) => setTimeout(r, FETCH_DELAY));
  }
}

// ======================
// API ROUTES
// ======================

app.get("/", (req, res) => {
  res.json({
    status: "running",
    total: database.length,
    max_data: MAX_DATA
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
    return res.status(404).json({ error: "Không có dữ liệu" });
  }
  res.json(database[database.length - 1]);
});

app.get("/data/limit", (req, res) => {
  const limit = Number(req.query.n) || 10;
  res.json({
    total: Math.min(limit, database.length),
    data: database.slice(-limit)
  });
});

app.get("/data/:phien", (req, res) => {
  const phien = Number(req.params.phien);
  const found = database.find((i) => i.phien === phien);
  if (!found) {
    return res.status(404).json({ error: "Không tìm thấy" });
  }
  res.json(found);
});

app.get("/stats", (req, res) => {
  // ✅ "Tài" / "Xỉu" đúng chính tả
  const tai = database.filter((i) => i.ket_qua === "Tài").length;
  const xiu = database.filter((i) => i.ket_qua === "Xỉu").length;

  res.json({
    total: database.length,
    tai,
    xiu,
    ti_le_tai: database.length > 0
      ? ((tai / database.length) * 100).toFixed(2)
      : 0,
    ti_le_xiu: database.length > 0
      ? ((xiu / database.length) * 100).toFixed(2)
      : 0
  });
});

app.post("/clear", (req, res) => {
  database = [];
  existingSessions.clear();
  saveData(database);
  res.json({ success: true, message: "Đã xóa dữ liệu" });
});

// ======================
// START
// ======================
app.listen(PORT, "0.0.0.0", () => {
  console.log(`Server running at http://0.0.0.0:${PORT}`);
  collector();
});
