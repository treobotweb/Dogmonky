const express = require("express");
const axios = require("axios");
const fs = require("fs");
const path = require("path");

const app = express();
const PORT = process.env.PORT || 3000;
const API_URL = "https://sunlol-zv7x.onrender.com/data";

// ======================================================
// FILE LUU TRU VINH VIEN
// ======================================================
const DATA_FILE = path.join(__dirname, "cau_database.json");
const LOG_FILE = path.join(__dirname, "prediction_log.json");

function saveData(data, file) {
    try {
        fs.writeFileSync(file, JSON.stringify(data, null, 2));
    } catch (e) {
        console.log("Lỗi lưu file:", e.message);
    }
}

function loadData(file) {
    try {
        if (fs.existsSync(file)) {
            return JSON.parse(fs.readFileSync(file, "utf8"));
        }
    } catch (e) {
        console.log("Lỗi đọc file:", e.message);
    }
    return null;
}

// ======================================================
// FORMAT DATA
// ======================================================
function normalizeData(data) {
    if (!Array.isArray(data)) data = [data];
    return data.map(item => {
        const d1 = item.xuc_xac_1 || item.x1 || 0;
        const d2 = item.xuc_xac_2 || item.x2 || 0;
        const d3 = item.xuc_xac_3 || item.x3 || 0;
        const tong = item.tong || item.total || (d1 + d2 + d3);
        const ketQua = (item.ket_qua || item.result || (tong >= 11 ? "tài" : "xỉu")).toLowerCase();
        return {
            phien: item.phien || item.session || item.id || 0,
            x1: d1, x2: d2, x3: d3,
            xuc_xac_1: d1, xuc_xac_2: d2, xuc_xac_3: d3,
            tong: tong,
            ket_qua: ketQua === "tài" ? "tài" : "xỉu",
            result: ketQua === "tài" ? "Tài" : "Xỉu"
        };
    }).filter(item => item.phien > 0 && item.tong >= 3 && item.tong <= 18);
}

// ======================================================
// HE THONG HOC CAU - LUU TRU VINH VIEN
// ======================================================
class CauLearningSystem {
    constructor() {
        this.cauDatabase = {};
        this.winCau = {};
        this.loseCau = {};
        this.learningHistory = [];
        this.totalLearned = 0;
        this.minSessions = 5;
        this.loadFromFile();
    }

    loadFromFile() {
        let saved = loadData(DATA_FILE);
        if (saved) {
            this.cauDatabase = saved.cauDatabase || {};
            this.winCau = saved.winCau || {};
            this.loseCau = saved.loseCau || {};
            this.learningHistory = saved.learningHistory || [];
            this.totalLearned = saved.totalLearned || 0;
            console.log("Đã tải " + Object.keys(this.cauDatabase).length + " mẫu cầu từ bộ nhớ");
        }
    }

    saveToFile() {
        saveData({
            cauDatabase: this.cauDatabase,
            winCau: this.winCau,
            loseCau: this.loseCau,
            learningHistory: this.learningHistory.slice(-500),
            totalLearned: this.totalLearned,
            lastSaved: new Date().toISOString()
        }, DATA_FILE);
    }

    learn(history, lastPredictionCorrect) {
        let results = history.map(h => h.result === 'Tài' ? 'T' : 'X');
        let n = results.length;
        if (n < this.minSessions) return;

        // Học cầu bệt
        let streak = 1;
        let currentResult = results[n - 1];
        for (let i = n - 2; i >= 0; i--) {
            if (results[i] === currentResult) streak++;
            else break;
        }
        if (streak >= 2) {
            let key = 'biet_' + currentResult + '_' + streak;
            this.cauDatabase[key] = (this.cauDatabase[key] || 0) + 1;
            if (lastPredictionCorrect !== undefined) {
                if (lastPredictionCorrect) this.winCau[key] = (this.winCau[key] || 0) + 1;
                else this.loseCau[key] = (this.loseCau[key] || 0) + 1;
            }
        }

        // Học cầu 1-1
        if (n >= 4) {
            let last4 = results.slice(-4);
            let is11 = true;
            for (let i = 1; i < 4; i++) {
                if (last4[i] === last4[i - 1]) { is11 = false; break; }
            }
            if (is11) {
                this.cauDatabase['cau_11'] = (this.cauDatabase['cau_11'] || 0) + 1;
                if (lastPredictionCorrect !== undefined) {
                    if (lastPredictionCorrect) this.winCau['cau_11'] = (this.winCau['cau_11'] || 0) + 1;
                    else this.loseCau['cau_11'] = (this.loseCau['cau_11'] || 0) + 1;
                }
            }
        }

        // Học cầu 2-2
        if (n >= 8) {
            let last8 = results.slice(-8);
            let is22 = true;
            for (let i = 0; i < 8; i += 2) {
                if (last8[i] !== last8[i + 1]) { is22 = false; break; }
            }
            if (is22 && last8[0] !== last8[2]) {
                this.cauDatabase['cau_22'] = (this.cauDatabase['cau_22'] || 0) + 1;
                if (lastPredictionCorrect !== undefined) {
                    if (lastPredictionCorrect) this.winCau['cau_22'] = (this.winCau['cau_22'] || 0) + 1;
                    else this.loseCau['cau_22'] = (this.loseCau['cau_22'] || 0) + 1;
                }
            }
        }

        // Học pattern 3-5 phiên
        for (let len of [3, 4, 5]) {
            if (n > len) {
                let pattern = results.slice(-len - 1, -1).join('');
                let next = results[n - 1];
                let key = 'p' + len + '_' + pattern + '_' + next;
                this.cauDatabase[key] = (this.cauDatabase[key] || 0) + 1;
                if (lastPredictionCorrect !== undefined) {
                    if (lastPredictionCorrect) this.winCau[key] = (this.winCau[key] || 0) + 1;
                    else this.loseCau[key] = (this.loseCau[key] || 0) + 1;
                }
            }
        }

        // Học Rồng/Hổ
        let tRun = 0;
        for (let i = n - 1; i >= 0 && results[i] === 'T'; i--) tRun++;
        if (tRun >= 4) {
            let key = 'rong_' + tRun;
            this.cauDatabase[key] = (this.cauDatabase[key] || 0) + 1;
        }

        let xRun = 0;
        for (let i = n - 1; i >= 0 && results[i] === 'X'; i--) xRun++;
        if (xRun >= 4) {
            let key = 'ho_' + xRun;
            this.cauDatabase[key] = (this.cauDatabase[key] || 0) + 1;
        }

        // Học theo tổng điểm
        let last = history[n - 1];
        if (last.tong && n >= 2) {
            let prevScore = history[n - 2].tong || 0;
            let currScore = last.tong || 0;
            let diff = currScore - prevScore;
            let key = 'score_diff_' + diff;
            this.cauDatabase[key] = (this.cauDatabase[key] || 0) + 1;
        }

        // Học theo xúc xắc
        if (last.x1) {
            let sum = last.x1 + last.x2 + last.x3;
            let key = 'dice_sum_' + sum + '_' + (sum >= 11 ? 'T' : 'X');
            this.cauDatabase[key] = (this.cauDatabase[key] || 0) + 1;
        }

        this.totalLearned++;
        this.learningHistory.push({
            timestamp: Date.now(),
            totalCau: Object.keys(this.cauDatabase).length
        });
        if (this.learningHistory.length > 500) this.learningHistory.shift();

        // Tự động lưu mỗi 10 phiên
        if (this.totalLearned % 10 === 0) {
            this.saveToFile();
        }
    }

    predict(history) {
        let results = history.map(h => h.result === 'Tài' ? 'T' : 'X');
        let n = results.length;
        if (n < this.minSessions) return [];
        let predictions = [];

        // 1. Dự đoán từ bệt đã học
        let streak = 1;
        let currentResult = results[n - 1];
        for (let i = n - 2; i >= 0; i--) {
            if (results[i] === currentResult) streak++;
            else break;
        }
        if (streak >= 2) {
            let continueKey = 'biet_' + currentResult + '_' + (streak + 1);
            let continueCount = this.cauDatabase[continueKey] || 0;
            let breakCount = 0;
            for (let s = streak; s <= 15; s++) {
                breakCount += this.cauDatabase['biet_' + currentResult + '_' + s] || 0;
            }
            breakCount -= continueCount;
            let total = continueCount + breakCount;
            if (total > 0) {
                let probContinue = continueCount / total;
                let pred = probContinue > 0.5 ? currentResult : (currentResult === 'T' ? 'X' : 'T');
                // Lấy tỉ lệ win/lose của cầu này
                let winCount = this.winCau[continueKey] || 0;
                let loseCount = this.loseCau[continueKey] || 0;
                let bonusConf = (winCount + loseCount > 0) ? (winCount / (winCount + loseCount) - 0.5) * 20 : 0;
                predictions.push({
                    p: pred,
                    c: Math.min(95, 50 + Math.abs(probContinue - 0.5) * 80 + bonusConf),
                    w: 10,
                    s: 'learned_biet'
                });
            }
        }

        // 2. Dự đoán từ pattern đã học
        for (let len of [3, 4, 5]) {
            if (n >= len) {
                let pattern = results.slice(-len).join('');
                let keyT = 'p' + len + '_' + pattern + '_T';
                let keyX = 'p' + len + '_' + pattern + '_X';
                let nextT = this.cauDatabase[keyT] || 0;
                let nextX = this.cauDatabase[keyX] || 0;
                let total = nextT + nextX;
                if (total >= 3) {
                    let probT = nextT / total;
                    let winT = this.winCau[keyT] || 0;
                    let loseT = this.loseCau[keyT] || 0;
                    let winX = this.winCau[keyX] || 0;
                    let loseX = this.loseCau[keyX] || 0;
                    let bonusConf = 0;
                    if (probT > 0.5 && winT + loseT > 0) {
                        bonusConf = (winT / (winT + loseT) - 0.5) * 15;
                    } else if (probT < 0.5 && winX + loseX > 0) {
                        bonusConf = (winX / (winX + loseX) - 0.5) * 15;
                    }
                    predictions.push({
                        p: probT > 0.5 ? 'T' : 'X',
                        c: Math.min(95, 50 + Math.abs(probT - 0.5) * 80 + bonusConf),
                        w: 7,
                        s: 'learned_p' + len
                    });
                }
            }
        }

        // 3. Dự đoán từ Rồng/Hổ đã học
        let tRun = 0;
        for (let i = n - 1; i >= 0 && results[i] === 'T'; i--) tRun++;
        if (tRun >= 4) {
            let rongCount = this.cauDatabase['rong_' + tRun] || 0;
            if (rongCount >= 1) {
                predictions.push({
                    p: tRun >= 6 ? 'X' : 'T',
                    c: Math.min(95, 65 + tRun * 3 + rongCount * 2),
                    w: 12,
                    s: 'learned_rong'
                });
            }
        }

        let xRun = 0;
        for (let i = n - 1; i >= 0 && results[i] === 'X'; i--) xRun++;
        if (xRun >= 4) {
            let hoCount = this.cauDatabase['ho_' + xRun] || 0;
            if (hoCount >= 1) {
                predictions.push({
                    p: xRun >= 6 ? 'T' : 'X',
                    c: Math.min(95, 65 + xRun * 3 + hoCount * 2),
                    w: 12,
                    s: 'learned_ho'
                });
            }
        }

        // 4. Cầu 1-1 đã học
        let cau11Count = this.cauDatabase['cau_11'] || 0;
        if (cau11Count >= 2 && n >= 4) {
            let last4 = results.slice(-4);
            let is11 = true;
            for (let i = 1; i < 4; i++) {
                if (last4[i] === last4[i - 1]) { is11 = false; break; }
            }
            if (is11) {
                let winCount = this.winCau['cau_11'] || 0;
                let loseCount = this.loseCau['cau_11'] || 0;
                let bonusConf = (winCount + loseCount > 0) ? (winCount / (winCount + loseCount) - 0.5) * 20 : 0;
                predictions.push({
                    p: results[n - 1] === 'T' ? 'X' : 'T',
                    c: Math.min(90, 70 + cau11Count * 3 + bonusConf),
                    w: 9,
                    s: 'learned_11'
                });
            }
        }

        return predictions;
    }

    getStats() {
        return {
            totalCauLearned: Object.keys(this.cauDatabase).length,
            totalWinCau: Object.keys(this.winCau).length,
            totalLoseCau: Object.keys(this.loseCau).length,
            topWinCau: Object.entries(this.winCau)
                .sort((a, b) => b[1] - a[1])
                .slice(0, 5)
        };
    }
}

// ======================================================
// PREDICTION LOG - LUU TRU VINH VIEN
// ======================================================
let predictionLog = [];
let totalPredictions = 0;
let totalCorrect = 0;

function loadPredictionLog() {
    let saved = loadData(LOG_FILE);
    if (saved) {
        predictionLog = saved.log || [];
        totalPredictions = saved.totalPredictions || 0;
        totalCorrect = saved.totalCorrect || 0;
        console.log("Đã tải " + predictionLog.length + " lịch sử dự đoán");
    }
}

function savePredictionLog() {
    saveData({
        log: predictionLog.slice(-500),
        totalPredictions,
        totalCorrect,
        lastSaved: new Date().toISOString()
    }, LOG_FILE);
}

// ======================================================
// ANALYZE CAU DETAIL
// ======================================================
function analyzeCauDetail(history) {
    if (history.length < 10) return "[Đang thu thập dữ liệu...]";
    let results = history.map(h => h.result === 'Tài' ? 'T' : 'X');
    let last10 = results.slice(-10);
    let patternStr = last10.join("");
    let cauTypes = [];

    let streak = 1;
    let lastResult = last10[last10.length - 1];
    for (let i = last10.length - 2; i >= 0; i--) {
        if (last10[i] === lastResult) streak++;
        else break;
    }
    if (streak >= 3) cauTypes.push("Bệt " + streak + " " + (lastResult === 't' ? 'Tài' : 'Xỉu'));

    let is11 = true;
    for (let i = 1; i < last10.length; i++) if (last10[i] === last10[i - 1]) { is11 = false; break; }
    if (is11) cauTypes.push("Cầu 1-1");

    let tCount = last10.filter(r => r === 't').length;
    if (cauTypes.length === 0) {
        if (tCount >= 7) cauTypes.push("Tài mạnh");
        else if (tCount <= 3) cauTypes.push("Xỉu mạnh");
        else if (tCount >= 6) cauTypes.push("Nghiêng Tài");
        else if (tCount <= 4) cauTypes.push("Nghiêng Xỉu");
        else cauTypes.push("Cân bằng");
    }

    return "[Cầu " + cauTypes.join(', ') + "] - " + patternStr;
}

// ======================================================
// MAIN PREDICTOR
// ======================================================
const cauLearner = new CauLearningSystem();

function predict(history) {
    let n = history.length;
    if (n < 5) return { prediction: 'Cần ít nhất 5 phiên', confidence: 0 };

    let results = history.map(h => h.result === 'Tài' ? 'T' : 'X');
    let scores = history.map(h => h.tong || 0);
    let lastResult = results[n - 1];
    let lastScore = scores[n - 1];

    let allPredictions = [];

    // Học cầu
    let learnedPreds = cauLearner.predict(history);
    allPredictions.push(...learnedPreds);

    // Phân tích bệt
    let streak = 1;
    for (let i = n - 2; i >= 0; i--) {
        if (results[i] === lastResult) streak++;
        else break;
    }
    if (streak >= 10) allPredictions.push({ p: lastResult === 'T' ? 'X' : 'T', c: 95, w: 15, s: 'biet_super_long' });
    else if (streak >= 7) allPredictions.push({ p: lastResult === 'T' ? 'X' : 'T', c: 85, w: 14, s: 'biet_long' });
    else if (streak >= 5) allPredictions.push({ p: lastResult === 'T' ? 'X' : 'T', c: Math.min(90, 55 + streak * 4), w: 12, s: 'biet_medium' });
    else if (streak >= 3) allPredictions.push({ p: lastResult, c: 55 + streak * 5, w: 8, s: 'biet_short' });

    // Score extremes
    if (lastScore >= 17) allPredictions.push({ p: 'X', c: 92, w: 12, s: 'score_17' });
    else if (lastScore >= 15) allPredictions.push({ p: 'X', c: 78, w: 9, s: 'score_15' });
    if (lastScore <= 4) allPredictions.push({ p: 'T', c: 92, w: 12, s: 'score_4' });
    else if (lastScore <= 6) allPredictions.push({ p: 'T', c: 72, w: 8, s: 'score_6' });

    // Rồng/Hổ
    let tRun = 0;
    for (let i = n - 1; i >= 0 && results[i] === 'T'; i--) tRun++;
    if (tRun >= 6) allPredictions.push({ p: 'X', c: Math.min(95, 78 + tRun), w: 14, s: 'rong' });
    else if (tRun >= 4) allPredictions.push({ p: 'T', c: 68 + tRun, w: 8, s: 'rong' });

    let xRun = 0;
    for (let i = n - 1; i >= 0 && results[i] === 'X'; i--) xRun++;
    if (xRun >= 6) allPredictions.push({ p: 'T', c: Math.min(95, 78 + xRun), w: 14, s: 'ho' });
    else if (xRun >= 4) allPredictions.push({ p: 'X', c: 68 + xRun, w: 8, s: 'ho' });

    // Trend
    let last10 = results.slice(-10);
    let tCount = last10.filter(r => r === 'T').length;
    if (tCount >= 8) allPredictions.push({ p: 'X', c: 75, w: 9, s: 'trend_overbought' });
    if (tCount <= 2) allPredictions.push({ p: 'T', c: 75, w: 9, s: 'trend_oversold' });

    // Pattern 3-5
    for (let len of [3, 4, 5]) {
        if (n > len) {
            let pattern = results.slice(-len).join('');
            let nextCounts = { T: 0, X: 0 };
            for (let i = 0; i < n - len; i++) {
                if (results.slice(i, i + len).join('') === pattern) {
                    nextCounts[results[i + len]]++;
                }
            }
            let total = nextCounts.T + nextCounts.X;
            if (total >= Math.max(3, 8 - len)) {
                let probT = nextCounts.T / total;
                allPredictions.push({ p: probT > 0.5 ? 'T' : 'X', c: 50 + Math.abs(probT - 0.5) * 80, w: Math.max(5, 10 - len), s: 'pattern_' + len });
            }
        }
    }

    // Ensemble
    if (allPredictions.length === 0) {
        return { prediction: lastResult === 'T' ? 'Xỉu' : 'Tài', confidence: 50 };
    }

    allPredictions.sort((a, b) => (b.w * 100 + b.c) - (a.w * 100 + a.c));
    let topPreds = allPredictions.slice(0, 20);
    let voteT = 0, voteX = 0, totalW = 0;
    for (let pred of topPreds) {
        let w = pred.w * (pred.c / 100);
        if (pred.p === 'T') voteT += w;
        else voteX += w;
        totalW += w;
    }

    if (totalW === 0) {
        return { prediction: lastResult === 'T' ? 'Xỉu' : 'Tài', confidence: 50 };
    }

    let probT = voteT / totalW;
    let finalPred = probT > 0.5 ? 'T' : 'X';
    let confidence = Math.round(Math.abs(probT - 0.5) * 2 * 100);
    confidence = Math.max(52, Math.min(98, confidence));

    let top3Agree = topPreds.slice(0, 3).every(p => p.p === topPreds[0].p);
    let top5Agree = topPreds.slice(0, 5).every(p => p.p === topPreds[0].p);
    let top10Agree = topPreds.slice(0, 10).every(p => p.p === topPreds[0].p);

    if (top10Agree) confidence = Math.min(98, confidence + 18);
    else if (top5Agree) confidence = Math.min(98, confidence + 12);
    else if (top3Agree) confidence = Math.min(98, confidence + 6);

    return {
        prediction: finalPred === 'T' ? 'Tài' : 'Xỉu',
        confidence,
        totalSignals: allPredictions.length
    };
}

// ======================================================
// FINAL PREDICT
// ======================================================
function finalPredict(history) {
    if (history.length < 5) return { duDoan: "tài", doTinCay: 52 };
    let result = predict(history);
    if (!result || result.confidence === 0) return { duDoan: "tài", doTinCay: 52 };
    return {
        duDoan: result.prediction === 'Tài' ? 'tài' : 'xỉu',
        doTinCay: result.confidence
    };
}

// ======================================================
// API ROUTES
// ======================================================
app.get("/taixiu", async (req, res) => {
    try {
        const response = await axios.get(API_URL, { timeout: 10000 });
        const rawData = response.data;
        const dataArray = rawData.data || rawData || [];
        let history = normalizeData(Array.isArray(dataArray) ? dataArray : [dataArray]);

        if (history.length < 5) {
            return res.json({
                id: "AnhKhoidzai Sunwin",
                phien_truoc: history.length > 0 ? history[history.length - 1].phien : 0,
                xuc_xac1: history.length > 0 ? history[history.length - 1].x1 : 0,
                xuc_xac2: history.length > 0 ? history[history.length - 1].x2 : 0,
                xuc_xac3: history.length > 0 ? history[history.length - 1].x3 : 0,
                tong: history.length > 0 ? history[history.length - 1].tong : 0,
                ket_qua: history.length > 0 ? history[history.length - 1].ket_qua : "tài",
                pattern: "[Đang thu thập dữ liệu - cần 5 phiên...]",
                phien_hien_tai: history.length > 0 ? history[history.length - 1].phien + 1 : 0,
                du_doan: "tài",
                do_tin_cay: "52%"
            });
        }

        let latest = history[history.length - 1];
        let pattern = analyzeCauDetail(history);
        let predict = finalPredict(history);

        res.json({
            id: "AnhKhoidzai Sunwin",
            phien_truoc: latest.phien,
            xuc_xac1: latest.x1, xuc_xac2: latest.x2, xuc_xac3: latest.x3,
            tong: latest.tong, ket_qua: latest.ket_qua,
            pattern: pattern,
            phien_hien_tai: latest.phien + 1,
            du_doan: predict.duDoan,
            do_tin_cay: predict.doTinCay + "%"
        });

    } catch (err) {
        res.json({ id: "AnhKhoidzai Sunwin", phien_truoc: 0, xuc_xac1: 0, xuc_xac2: 0, xuc_xac3: 0, tong: 0, ket_qua: "tài", pattern: "[Đang kết nối...]", phien_hien_tai: 0, du_doan: "tài", do_tin_cay: "52%" });
    }
});

app.get("/", async (req, res) => {
    try {
        const response = await axios.get(API_URL, { timeout: 10000 });
        const rawData = response.data;
        const dataArray = rawData.data || rawData || [];
        let history = normalizeData(Array.isArray(dataArray) ? dataArray : [dataArray]);

        if (history.length < 5) {
            return res.json({
                id: "AnhKhoidzai Sunwin",
                phien_truoc: history.length > 0 ? history[history.length - 1].phien : 0,
                xuc_xac1: history.length > 0 ? history[history.length - 1].x1 : 0,
                xuc_xac2: history.length > 0 ? history[history.length - 1].x2 : 0,
                xuc_xac3: history.length > 0 ? history[history.length - 1].x3 : 0,
                tong: history.length > 0 ? history[history.length - 1].tong : 0,
                ket_qua: history.length > 0 ? history[history.length - 1].ket_qua : "tài",
                pattern: "[Đang thu thập dữ liệu - cần 5 phiên...]",
                phien_hien_tai: history.length > 0 ? history[history.length - 1].phien + 1 : 0,
                du_doan: "tài",
                do_tin_cay: "52%"
            });
        }

        let latest = history[history.length - 1];
        let pattern = analyzeCauDetail(history);
        let predict = finalPredict(history);

        let result = {
            id: "AnhKhoidzai Sunwin",
            phien_truoc: latest.phien,
            xuc_xac1: latest.x1, xuc_xac2: latest.x2, xuc_xac3: latest.x3,
            tong: latest.tong, ket_qua: latest.ket_qua,
            pattern: pattern,
            phien_hien_tai: latest.phien + 1,
            du_doan: predict.duDoan,
            do_tin_cay: predict.doTinCay + "%"
        };

        console.log("JSON:", JSON.stringify(result, null, 2));
        res.json(result);

    } catch (err) {
        res.json({ id: "AnhKhoidzai Sunwin", phien_truoc: 0, xuc_xac1: 0, xuc_xac2: 0, xuc_xac3: 0, tong: 0, ket_qua: "tài", pattern: "[Đang kết nối...]", phien_hien_tai: 0, du_doan: "tài", do_tin_cay: "52%" });
    }
});

app.listen(PORT, () => {
    loadPredictionLog();
    console.log("Server chạy tại port " + PORT);
    console.log("Học cầu từ 5 phiên - Lưu trữ vĩnh viễn");
});
