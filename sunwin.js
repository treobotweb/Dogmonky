/**

- @Developer: Dev Anh Khôi (Chủ Tôn)
- @Description: SUNWIN - Dự đoán Tài Xỉu
- @API nguồn: https://sunlol-zv7x.onrender.com/api/history
- @Thuật toán: Bảng tra 304 mẫu chuỗi (1-8 ký tự) + Thống kê thắng/thua
  */

const express = require(‘express’);
const axios   = require(‘axios’);
const app     = express();
app.use(express.json());

// ─────────────────────────────────────────────────────────────────────────────
// BẢNG THUẬT TOÁN ĐẦY ĐỦ — 304 mẫu (từ file thuattoan8.txt, last-write-wins)
// T = Tài, X = Xỉu
// ─────────────────────────────────────────────────────────────────────────────
const PATTERN_TABLE = {
“TXXTTXTX”: “Xỉu”,
“XXTTXTXX”: “Xỉu”,
“XTTXTXXT”: “Xỉu”,
“TTXTXXTT”: “Xỉu”,
“TXTXXTTT”: “Xỉu”,
“XTXXTTTX”: “Tài”,
“TXXTTTXX”: “Xỉu”,
“XXTTTXXT”: “Tài”,
“XTTTXXTX”: “Tài”,
“TTTXXTXX”: “Xỉu”,
“TTXXTXXX”: “Xỉu”,
“TXXTXXXX”: “Xỉu”,
“XXTXXXXX”: “Xỉu”,
“XTXXXXXT”: “Tài”,
“TXXXXXTX”: “Tài”,
“XXXXXTXX”: “Xỉu”,
“XXXXTXXX”: “Tài”,
“XXXTXXXT”: “Tài”,
“XXTXXXTX”: “Xỉu”,
“XTXXXTXX”: “Tài”,
“TXXXTXXX”: “Tài”,
“XXXTXXXX”: “Xỉu”,
“XXTXXXXT”: “Xỉu”,
“XTXXXXTT”: “Xỉu”,
“TXXXXTTX”: “Xỉu”,
“XXXXTTXX”: “Xỉu”,
“XXXTTXXX”: “Tài”,
“XXTTXXXT”: “Tài”,
“XTTXXXTX”: “Tài”,
“TTXXXTXT”: “Tài”,
“TXXXTXTX”: “Tài”,
“XXXTXTXT”: “Xỉu”,
“XXTXTXTT”: “Tài”,
“XTXTXTTT”: “Xỉu”,
“TXTXTTTT”: “Tài”,
“XTXTTTTT”: “Xỉu”,
“TXTTTTTT”: “Xỉu”,
“XTTTTTTX”: “Xỉu”,
“TTTTTTXT”: “Xỉu”,
“TTTTTXTX”: “Xỉu”,
“TTTTXTXT”: “Xỉu”,
“TTTXTXTT”: “Xỉu”,
“TTXTXTTX”: “Xỉu”,
“TXTXTTXT”: “Xỉu”,
“XTXTTXTX”: “Tài”,
“TXTTXTXT”: “Tài”,
“XTTXTXTT”: “Xỉu”,
“TXTTXTXX”: “Xỉu”,
“XTTXTXXX”: “Xỉu”,
“TTXTXXXT”: “Tài”,
“TXTXXXTT”: “Xỉu”,
“XTXXXTTX”: “Tài”,
“TXXXTTXX”: “Tài”,
“XXXTTXXT”: “Xỉu”,
“XXTTXXTX”: “Tài”,
“XTTXXTXX”: “Xỉu”,
“TXXTXXXT”: “Xỉu”,
“XXTXXXTT”: “Tài”,
“XTXXXTTT”: “Tài”,
“TXXXTTTT”: “Xỉu”,
“XXXTTTTT”: “Tài”,
“XXTTTTTT”: “Xỉu”,
“TTTTTTXX”: “Xỉu”,
“TTTTTXXX”: “Tài”,
“TTTTXXXT”: “Xỉu”,
“TTTXXXTX”: “Xỉu”,
“TXXXTXTT”: “Xỉu”,
“XXXTXTTX”: “Xỉu”,
“XXTXTTXX”: “Tài”,
“XTXTTXXT”: “Tài”,
“TXTTXXTT”: “Tài”,
“XTTXXTTT”: “Xỉu”,
“TTXXTTTX”: “Tài”,
“TXXTTTXT”: “Xỉu”,
“XXTTTXTX”: “Tài”,
“XTTTXTXX”: “Xỉu”,
“TTTXTXXX”: “Xỉu”,
“XTXTTXXX”: “Xỉu”,
“TXTTXXXT”: “Xỉu”,
“TTXXXTXX”: “Xỉu”,
“TXXXTXXT”: “Tài”,
“XXXTXXTX”: “Xỉu”,
“XXTXXTXT”: “Xỉu”,
“XTXXTXTX”: “Tài”,
“TXXTXTXT”: “Xỉu”,
“XTXTXTTX”: “Xỉu”,
“XTXTTXTT”: “Tài”,
“TXTTXTTT”: “Tài”,
“XTTXTTTX”: “Xỉu”,
“TTXTTTXT”: “Xỉu”,
“TXTTTXTT”: “Xỉu”,
“XTTTXTTX”: “Tài”,
“TTTXTTXT”: “Xỉu”,
“TTXTTXTX”: “Tài”,
“TTXTXXTX”: “Tài”,
“TXTXXTXT”: “Xỉu”,
“XTXXTXTT”: “Tài”,
“TXXTXTTT”: “Tài”,
“XXTXTTTT”: “Xỉu”,
“TXTTTTTX”: “Tài”,
“XTTTTTXX”: “Tài”,
“TTTTXXXX”: “Tài”,
“TTTXXXXX”: “Xỉu”,
“TTXXXXXX”: “Xỉu”,
“TXXXXXXT”: “Tài”,
“XXXXXXTT”: “Xỉu”,
“XXXXXTTX”: “Xỉu”,
“XTTXXTXT”: “Xỉu”,
“TTXXTXTT”: “Tài”,
“XTXTTTTX”: “Tài”,
“TXTTTTXT”: “Xỉu”,
“XTTTTXTX”: “Tài”,
“TTTTXTXX”: “Xỉu”,
“TTTXTXXT”: “Tài”,
“TXTXTTTX”: “Tài”,
“XTXTTTXX”: “Tài”,
“TXTTTXXT”: “Tài”,
“XTTTXXTT”: “Tài”,
“TTTXXTTT”: “Tài”,
“TTXXTTTT”: “Xỉu”,
“TXXTTTTX”: “Tài”,
“XXTTTTXT”: “Xỉu”,
“TXTXTTXX”: “Xỉu”,
“TXTTXXXX”: “Tài”,
“XTTXXXXT”: “Xỉu”,
“TTXXXXTX”: “Xỉu”,
“TXXXXTXT”: “Xỉu”,
“XXXXTXTX”: “Tài”,
“TXTTTTXX”: “Tài”,
“XTTTTXXT”: “Tài”,
“TTTTXXTX”: “Tài”,
“XXXTXXTT”: “Tài”,
“XXTXXTTT”: “Xỉu”,
“XXTTTXTT”: “Xỉu”,
“TTTXTTXX”: “Tài”,
“TTXTTXXX”: “Xỉu”,
“XTTXXXXX”: “Tài”,
“TTXXXXXT”: “Tài”,
“TXXXXXTT”: “Tài”,
“XXXXXTTT”: “Xỉu”,
“XXXXTTTT”: “Tài”,
“XXXTTTTX”: “Tài”,
“XTTXTXTX”: “Tài”,
“TTXTXTXT”: “Xỉu”,
“TXTXTXTX”: “Xỉu”,
“XTXTXTXT”: “Xỉu”,
“XTXTXTXX”: “Xỉu”,
“TXTXTXXT”: “Xỉu”,
“XTXTXXTX”: “Tài”,
“XXTXTXTX”: “Xỉu”,
“TXTXTXTT”: “Xỉu”,
“TXTTTXXX”: “Tài”,
“XTTTXXXX”: “Xỉu”,
“TTTXXXXT”: “Xỉu”,
“TTXXXXTT”: “Xỉu”,
“XXXTXTXX”: “Tài”,
“XXTXTXXX”: “Xỉu”,
“XTXTXXXT”: “Xỉu”,
“XXTTXXTT”: “Tài”,
“TXXTTTTT”: “Xỉu”,
“TTTTTXTT”: “Xỉu”,
“TTTTXTTT”: “Tài”,
“TTTXTTTT”: “Xỉu”,
“TTXTTTTX”: “Xỉu”,
“XTXXTTTT”: “Tài”,
“XTTTTXTT”: “Tài”,
“XTTTTXXX”: “Xỉu”,
“TXXXXTTT”: “Xỉu”,
“XXXXTTTX”: “Tài”,
“XXXTTTXX”: “Xỉu”,
“TXTXTXXX”: “Xỉu”,
“XXTTTTXX”: “Xỉu”,
“TTTXXXTT”: “Tài”,
“TTXXXTTX”: “Tài”,
“TXXXTTXT”: “Xỉu”,
“XXXTTXTT”: “Tài”,
“XXTTXTTX”: “Xỉu”,
“XTTXTTXX”: “Xỉu”,
“TTXTTXXT”: “Tài”,
“TTTXXTXT”: “Xỉu”,
“TTXXTXTX”: “Xỉu”,
“TXTXXXTX”: “Xỉu”,
“TTTTXXTT”: “Tài”,
“XTTTTTTT”: “Tài”,
“TTTTTTTT”: “Xỉu”,
“TTTTTTTX”: “Tài”,
“TTTTTXXT”: “Tài”,
“TTTXXTTX”: “Tài”,
“TTXXTTXX”: “Tài”,
“TXXTTXXT”: “Xỉu”,
“TTXXTXXT”: “Tài”,
“TXXTXXTX”: “Tài”,
“XXTXXTXX”: “Xỉu”,
“XTXXTXXX”: “Xỉu”,
“XTXXXXTX”: “Tài”,
“XXXXTXTT”: “Tài”,
“XXXTXTTT”: “Xỉu”,
“TXXTXXTT”: “Tài”,
“XXXXXTXT”: “Tài”,
“XTTXXXTT”: “Tài”,
“XXTTXXXX”: “Xỉu”,
“TXTTXTTX”: “Tài”,
“XTTXTTXT”: “Xỉu”,
“TTXTTXTT”: “Tài”,
“XTTXTTTT”: “Xỉu”,
“TTXTTTTT”: “Xỉu”,
“TTTTXTTX”: “Xỉu”,
“TTXTXXXX”: “Tài”,
“TXTXXXXT”: “Tài”,
“XXTTTTTX”: “Xỉu”,
“XTTTTTXT”: “Tài”,
“TTTXTXTX”: “Xỉu”,
“TXTXXTXX”: “Xỉu”,
“XTXXTXXT”: “Tài”,
“XTXTXXXX”: “Tài”,
“TXXXXTXX”: “Tài”,
“TTXTXTXX”: “Xỉu”,
“XTXTXXTT”: “Tài”,
“TXXXTTTX”: “Xỉu”,
“XXXTTTXT”: “Xỉu”,
“XXTTTXXX”: “Tài”,
“XTTTXXXT”: “Xỉu”,
“TTXXXTTT”: “Xỉu”,
“TXXTXTTX”: “Tài”,
“TXTTXXTX”: “Xỉu”,
“XXTXTTTX”: “Xỉu”,
“XTXXXXXX”: “Tài”,
“TXXXXXXX”: “Xỉu”,
“XXXXXXXT”: “Xỉu”,
“XXXXTTXT”: “Tài”,
“XXXTTXTX”: “Xỉu”,
“TXTXXXXX”: “Xỉu”,
“XXXXTXXT”: “Xỉu”,
“TXXTXTXX”: “Tài”,
“XXTXTXXT”: “Tài”,
“TXTXXTTX”: “Xỉu”,
“XTXXTTXX”: “Xỉu”,
“TXXTTXXX”: “Xỉu”,
“XXTTXTTT”: “Tài”,
“TTXTTTXX”: “Tài”,
“XXXXXXTX”: “Xỉu”,
“TTTXTTTX”: “Xỉu”,
“XTTTXTTT”: “Tài”,
“TXTTTXTX”: “Xỉu”,
“XTXXXTXT”: “Xỉu”,
“XTTXXTTX”: “Tài”,
“TTXXTTXT”: “Xỉu”,
“XXTTXTXT”: “Xỉu”,
“XXTXXTTX”: “Xỉu”,
“T”:        “Xỉu”,
“TX”:       “Xỉu”,
“TXT”:      “Tài”,
“TXTT”:     “Xỉu”,
“TXTTT”:    “Xỉu”,
“TXTTTX”:   “Xỉu”,
“TXTTTXX”:  “Xỉu”,
“XXTXTTXT”: “Xỉu”,
“TTXTXTTT”: “Xỉu”,
“XTXTTTXT”: “Tài”,
“XTTTXTXT”: “Xỉu”,
“XTXXTTXT”: “Xỉu”,
“TXXTTXTT”: “Xỉu”,
“X”:        “Xỉu”,
“XX”:       “Tài”,
“XXT”:      “Xỉu”,
“XXTT”:     “Tài”,
“XXTTT”:    “Tài”,
“XXTTTT”:   “Xỉu”,
“XXTTTTX”:  “Xỉu”,
“XT”:       “Tài”,
“XTX”:      “Xỉu”,
“XTXX”:     “Tài”,
“XTXXT”:    “Tài”,
“XTXXTT”:   “Tài”,
“XTXXTTT”:  “Tài”,
“XXXXXXXX”: “Tài”,
“TXX”:      “Xỉu”,
“TXXT”:     “Tài”,
“TXXTT”:    “Tài”,
“TXXTTT”:   “Xỉu”,
“TXXTTTX”:  “Tài”,
“XTT”:      “Tài”,
“XTTT”:     “Xỉu”,
“XTTTX”:    “Xỉu”,
“XTTTXX”:   “Tài”,
“XTTTXXX”:  “Tài”,
“TT”:       “Xỉu”,
“TTX”:      “Tài”,
“TTXT”:     “Xỉu”,
“TTXTX”:    “Xỉu”,
“TTXTXX”:   “Xỉu”,
“TTXTXXX”:  “Xỉu”,
“XTTTXXT”:  “Tài”,
“TXTTX”:    “Tài”,
“TXTTXT”:   “Tài”,
“TXTTXTT”:  “Tài”,
“TXXX”:     “Tài”,
“TXXXT”:    “Tài”,
“TXXXTT”:   “Tài”,
“TXXXTTT”:  “Xỉu”,
“XXTX”:     “Tài”,
“XXTXT”:    “Xỉu”,
“XXTXTX”:   “Xỉu”,
“XXTXTXX”:  “Xỉu”
};

// ─────────────────────────────────────────────────────────────────────────────
// CACHE & STATE
// ─────────────────────────────────────────────────────────────────────────────
let cachedHistory = [];   // lịch sử chuẩn hoá
let predictionLog = [];   // [{ phien, duDoan, ketQuaThuc, dungSai }]
let lastFetchTime = 0;
const CACHE_TTL   = 10000; // ms

// ─────────────────────────────────────────────────────────────────────────────
// FETCH + CHUẨN HOÁ từ API SUNWIN
// ─────────────────────────────────────────────────────────────────────────────
async function fetchHistory() {
const now = Date.now();
if (now - lastFetchTime < CACHE_TTL && cachedHistory.length > 0) return cachedHistory;

try {
const resp = await axios.get(‘https://sunlol-zv7x.onrender.com/api/history’, { timeout: 10000 });
const raw  = resp.data;

```
let arr = [];
if (Array.isArray(raw))               arr = raw;
else if (Array.isArray(raw.data))     arr = raw.data;
else if (Array.isArray(raw.history))  arr = raw.history;
else if (Array.isArray(raw.result))   arr = raw.result;

const mapped = arr.map(item => {
  // Ưu tiên lấy ketQuaThuc (kết quả thực tế), sau đó mới đến các trường khác
  let result = item.ketQuaThuc || item.result || item.ketqua || item.ket_qua || '';
  if (!result) {
    const tong = Number(item.tong || item.total || 0);
    result = tong >= 11 ? 'Tài' : 'Xỉu';
  }
  const dices = item.dices || item.dice || [
    item.Xuc_xac_1 || item.xuc_xac_1 || 0,
    item.Xuc_xac_2 || item.xuc_xac_2 || 0,
    item.Xuc_xac_3 || item.xuc_xac_3 || 0
  ];
  const tong = Number(item.tong || item.total ||
    (Array.isArray(dices) && dices.length === 3 ? dices[0] + dices[1] + dices[2] : 0));
  return {
    phien:    Number(item.phien || item.session || item.id || 0),
    result,
    dices:    Array.isArray(dices) ? dices : [0, 0, 0],
    tong,
    thoiGian: item.thoiGian || item.time || ''
  };
}).filter(h => h.result === 'Tài' || h.result === 'Xỉu');

// Sắp xếp tăng dần theo phiên
mapped.sort((a, b) => a.phien - b.phien);
cachedHistory = mapped;
lastFetchTime = now;

// Cập nhật kết quả thực vào log dự đoán cũ
updatePredictionLog(mapped);

console.log(`[SUNWIN] Fetched ${mapped.length} phiên`);
return cachedHistory;
```

} catch (err) {
console.error(’[SUNWIN] Lỗi fetch:’, err.message);
return cachedHistory;
}
}

// ─────────────────────────────────────────────────────────────────────────────
// CẬP NHẬT LOG — đối chiếu dự đoán đã lưu với kết quả thực từ API
// ─────────────────────────────────────────────────────────────────────────────
function updatePredictionLog(history) {
predictionLog = predictionLog.map(entry => {
if (entry.dungSai) return entry; // đã có kết quả rồi, bỏ qua
const match = history.find(h => h.phien === entry.phien);
if (match) {
return {
…entry,
ketQuaThuc: match.result,
dungSai:    match.result === entry.duDoan ? ‘Đúng’ : ‘Sai’
};
}
return entry;
});
}

// ─────────────────────────────────────────────────────────────────────────────
// THUẬT TOÁN TRA BẢNG — khớp từ 8 ký tự xuống 1 ký tự
// ─────────────────────────────────────────────────────────────────────────────
function lookupPattern(history) {
if (!history || history.length === 0) return null;
const seq = history.map(h => h.result === ‘Tài’ ? ‘T’ : ‘X’);
// Thử từ 8 ký tự xuống 1
for (let len = Math.min(8, seq.length); len >= 1; len–) {
const key = seq.slice(-len).join(’’);
if (PATTERN_TABLE[key] !== undefined) {
return { prediction: PATTERN_TABLE[key], matchLen: len, key };
}
}
return null;
}

// ─────────────────────────────────────────────────────────────────────────────
// FALLBACK — xu hướng đơn giản khi không khớp pattern nào
// ─────────────────────────────────────────────────────────────────────────────
function fallbackPredict(history) {
if (!history || history.length < 2) return { prediction: ‘Tài’, confidence: 50 };
const last5    = history.slice(-5).map(h => h.result);
const taiCount = last5.filter(r => r === ‘Tài’).length;
const xiuCount = last5.length - taiCount;
if (taiCount > xiuCount) return { prediction: ‘Xỉu’, confidence: 55 };
if (xiuCount > taiCount) return { prediction: ‘Tài’, confidence: 55 };
return { prediction: ‘Tài’, confidence: 50 };
}

// ─────────────────────────────────────────────────────────────────────────────
// TÍNH % THẮNG/THUA
// ─────────────────────────────────────────────────────────────────────────────
function getAccuracyStats() {
const resolved = predictionLog.filter(e => e.dungSai);
const total    = resolved.length;
const wins     = resolved.filter(e => e.dungSai === ‘Đúng’).length;
const losses   = total - wins;
return {
tong_da_du_doan:  predictionLog.length,
da_co_ket_qua:    total,
thang:            wins,
thua:             losses,
ty_le_thang:      total > 0 ? ((wins   / total) * 100).toFixed(1) + ‘%’ : ‘N/A’,
ty_le_thua:       total > 0 ? ((losses / total) * 100).toFixed(1) + ‘%’ : ‘N/A’,
lich_su_20_phien: predictionLog.slice(-20).map(e => ({
phien:      e.phien,
du_doan:    e.duDoan,
ket_qua:    e.ketQuaThuc || ‘?’,
dung_sai:   e.dungSai    || ‘Chờ kết quả’
}))
};
}

// ─────────────────────────────────────────────────────────────────────────────
// API: GET /taixiu
// ─────────────────────────────────────────────────────────────────────────────
app.get(’/taixiu’, async (req, res) => {
try {
const history = await fetchHistory();

```
if (!history || history.length < 1) {
  return res.json({ error: 'Chưa có dữ liệu từ SUNWIN' });
}

const current   = history[history.length - 1]; // phiên mới nhất (đã có kết quả)
const nextPhien = current.phien + 1;            // +1 — phiên đang chờ dự đoán

// Tra bảng thuật toán với toàn bộ lịch sử
const patResult = lookupPattern(history);
let prediction, confidence, method;

if (patResult) {
  prediction = patResult.prediction;
  confidence = Math.min(55 + patResult.matchLen * 4, 92);
  method     = `pattern_${patResult.matchLen}_ky_tu`;
} else {
  const fb   = fallbackPredict(history);
  prediction = fb.prediction;
  confidence = fb.confidence;
  method     = 'xu_huong_fallback';
}

// Lưu dự đoán vào log (không ghi đè nếu đã có)
if (!predictionLog.find(e => e.phien === nextPhien)) {
  predictionLog.push({
    phien:      nextPhien,
    duDoan:     prediction,
    ketQuaThuc: null,
    dungSai:    null,
    thoiGian:   new Date().toISOString()
  });
}

// Streak hiện tại
let streak = 1;
for (let i = history.length - 2; i >= 0; i--) {
  if (history[i].result === current.result) streak++;
  else break;
}

// Thống kê 20 phiên gần nhất
const last20 = history.slice(-20);
const tai20  = last20.filter(h => h.result === 'Tài').length;
const xiu20  = last20.length - tai20;

// % thắng thua
const accuracy = getAccuracyStats();

res.json({
  // ── PHIÊN MỤC TIÊU (+1 ĐỒNG BỘ) ──────────────────
  phien_du_doan: nextPhien,

  // ── KẾT QUẢ PHIÊN VỪA XẢY RA ────────────────────
  phien_vua_xong: current.phien,
  Xuc_xac_1:      current.dices[0] || 0,
  Xuc_xac_2:      current.dices[1] || 0,
  Xuc_xac_3:      current.dices[2] || 0,
  Tong:           current.tong     || 0,
  Ket_qua:        current.result,

  // ── DỰ ĐOÁN ──────────────────────────────────────
  du_doan:    prediction,
  do_tin_cay: `${Math.round(confidence)}%`,

  // ── CẦU & PATTERN ────────────────────────────────
  cau_hien_tai: {
    streak,
    loai:        current.result,
    pattern_key: patResult ? patResult.key : null,
    do_dai_khop: patResult ? patResult.matchLen : 0,
    phuong_phap: method
  },

  // ── THỐNG KÊ 20 PHIÊN GẦN ────────────────────────
  thong_ke_20_phien: {
    tai:       tai20,
    xiu:       xiu20,
    ty_le_tai: ((tai20 / (last20.length || 1)) * 100).toFixed(1) + '%',
    ty_le_xiu: ((xiu20 / (last20.length || 1)) * 100).toFixed(1) + '%'
  },

  // ── % THẮNG / THUA DỰ ĐOÁN ───────────────────────
  thong_ke_du_doan: accuracy,

  // ── META ──────────────────────────────────────────
  tong_phien_lich_su: history.length,
  thoi_gian:          new Date().toISOString()
});
```

} catch (err) {
console.error(’[SUNWIN] /taixiu error:’, err);
res.status(500).json({ error: ‘Lỗi server nội bộ’, detail: err.message });
}
});

// ─────────────────────────────────────────────────────────────────────────────
// API: GET /history — 50 phiên gần nhất đã chuẩn hoá
// ─────────────────────────────────────────────────────────────────────────────
app.get(’/history’, async (req, res) => {
try {
const history = await fetchHistory();
res.json({ total: history.length, data: history.slice(-50) });
} catch (err) {
res.status(500).json({ error: err.message });
}
});

// ─────────────────────────────────────────────────────────────────────────────
// API: GET /stats — thống kê tổng hợp
// ─────────────────────────────────────────────────────────────────────────────
app.get(’/stats’, async (req, res) => {
try {
const history = await fetchHistory();
const last50  = history.slice(-50);
const tai50   = last50.filter(h => h.result === ‘Tài’).length;
res.json({
tong_phien:     history.length,
last50:         { tai: tai50, xiu: last50.length - tai50 },
phien_moi_nhat: history.length ? history[history.length - 1] : null,
du_doan_stats:  getAccuracyStats()
});
} catch (err) {
res.status(500).json({ error: err.message });
}
});

// ─────────────────────────────────────────────────────────────────────────────
// API: GET /log — lịch sử dự đoán chi tiết
// ─────────────────────────────────────────────────────────────────────────────
app.get(’/log’, (req, res) => {
res.json({ total: predictionLog.length, log: predictionLog.slice(-100) });
});

// ─────────────────────────────────────────────────────────────────────────────
// HEALTH CHECK
// ─────────────────────────────────────────────────────────────────────────────
app.get(’/’, (req, res) => {
res.json({
status:     ‘OK’,
app:        ‘SUNWIN Predictor’,
developer:  ‘Dev Anh Khôi (Chủ Tôn)’,
endpoints:  [’/taixiu’, ‘/history’, ‘/stats’, ‘/log’],
api_source: ‘https://sunlol-zv7x.onrender.com/api/history’,
patterns:   Object.keys(PATTERN_TABLE).length + ’ mẫu thuật toán’
});
});

// ─────────────────────────────────────────────────────────────────────────────
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
console.log(`[SUNWIN] Đang chạy tại port ${PORT}`);
console.log(`[SUNWIN] Patterns: ${Object.keys(PATTERN_TABLE).length} mẫu`);
});

module.exports = app;
