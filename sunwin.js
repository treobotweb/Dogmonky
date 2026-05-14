const express = require("express");
const axios = require("axios");

const app = express();
const PORT = process.env.PORT || 3000;
const API_URL = "https://sunlol-zv7x.onrender.com/data";

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
            tong: tong,
            ket_qua: ketQua === "tài" ? "tài" : "xỉu",
            result: ketQua === "tài" ? "Tài" : "Xỉu",
            dice: [d1, d2, d3],
            total: tong
        };
    }).filter(item => item.phien > 0 && item.tong >= 3 && item.tong <= 18);
}

// ======================================================
// THUẬT TOÁN 1: DETECT STREAK AND BREAK
// ======================================================
let modelPredictions = {};

function detectStreakAndBreak(history) {
    if (!history || history.length === 0) return { streak: 0, currentResult: null, breakProb: 0.0 };
    let streak = 1;
    const currentResult = history[history.length - 1].result;
    for (let i = history.length - 2; i >= 0; i--) {
        if (history[i].result === currentResult) streak++;
        else break;
    }
    const last15 = history.slice(-15).map(h => h.result);
    if (!last15.length) return { streak, currentResult, breakProb: 0.0 };
    const switches = last15.slice(1).reduce((count, curr, idx) => count + (curr !== last15[idx] ? 1 : 0), 0);
    const taiCount = last15.filter(r => r === 'Tài').length;
    const xiuCount = last15.filter(r => r === 'Xỉu').length;
    const imbalance = Math.abs(taiCount - xiuCount) / last15.length;
    let breakProb = 0.0;
    if (streak >= 8) breakProb = Math.min(0.6 + (switches / 15) + imbalance * 0.15, 0.9);
    else if (streak >= 5) breakProb = Math.min(0.35 + (switches / 10) + imbalance * 0.25, 0.85);
    else if (streak >= 3 && switches >= 7) breakProb = 0.3;
    return { streak, currentResult, breakProb };
}

function evaluateModelPerformance(history, modelName, lookback = 10) {
    if (!modelPredictions[modelName] || history.length < 2) return 1.0;
    lookback = Math.min(lookback, history.length - 1);
    let correctCount = 0;
    for (let i = 0; i < lookback; i++) {
        const pred = modelPredictions[modelName][history[history.length - (i + 2)].phien] || 0;
        const actual = history[history.length - (i + 1)].result;
        if ((pred === 1 && actual === 'Tài') || (pred === 2 && actual === 'Xỉu')) correctCount++;
    }
    const performanceScore = lookback > 0 ? 1.0 + (correctCount - lookback / 2) / (lookback / 2) : 1.0;
    return Math.max(0.5, Math.min(1.5, performanceScore));
}

function smartBridgeBreak(history) {
    if (!history || history.length < 3) return { prediction: 0, breakProb: 0.0, reason: 'Không đủ dữ liệu' };
    const { streak, currentResult, breakProb } = detectStreakAndBreak(history);
    const last20 = history.slice(-20).map(h => h.result);
    const lastScores = history.slice(-20).map(h => h.total || 0);
    let breakProbability = breakProb;
    let reason = '';
    const avgScore = lastScores.reduce((sum, score) => sum + score, 0) / (lastScores.length || 1);
    const scoreDeviation = lastScores.reduce((sum, score) => sum + Math.abs(score - avgScore), 0) / (lastScores.length || 1);
    const last5 = last20.slice(-5);
    const patternCounts = {};
    for (let i = 0; i <= last20.length - 3; i++) {
        const pattern = last20.slice(i, i + 3).join(',');
        patternCounts[pattern] = (patternCounts[pattern] || 0) + 1;
    }
    const mostCommonPattern = Object.entries(patternCounts).sort((a, b) => b[1] - a[1])[0];
    const isStablePattern = mostCommonPattern && mostCommonPattern[1] >= 3;
    if (streak >= 6) {
        breakProbability = Math.min(breakProbability + 0.15, 0.9);
        reason = `[Bẻ Cầu] Chuỗi ${streak} ${currentResult} dài`;
    } else if (streak >= 4 && scoreDeviation > 3) {
        breakProbability = Math.min(breakProbability + 0.1, 0.85);
        reason = `[Bẻ Cầu] Biến động điểm số lớn (${scoreDeviation.toFixed(1)})`;
    } else if (isStablePattern && last5.every(r => r === currentResult)) {
        breakProbability = Math.min(breakProbability + 0.05, 0.8);
        reason = `[Bẻ Cầu] Mẫu lặp ${mostCommonPattern[0]}`;
    } else {
        breakProbability = Math.max(breakProbability - 0.15, 0.15);
        reason = `[Bẻ Cầu] Tiếp tục theo cầu`;
    }
    let prediction = breakProbability > 0.65 ? (currentResult === 'Tài' ? 2 : 1) : (currentResult === 'Tài' ? 1 : 2);
    return { prediction, breakProb: breakProbability, reason };
}

function trendAndProb(history) {
    if (!history || history.length < 3) return 0;
    const { streak, currentResult, breakProb } = detectStreakAndBreak(history);
    if (streak >= 5) return breakProb > 0.75 ? (currentResult === 'Tài' ? 2 : 1) : (currentResult === 'Tài' ? 1 : 2);
    const last15 = history.slice(-15).map(h => h.result);
    if (!last15.length) return 0;
    const weights = last15.map((_, i) => Math.pow(1.2, i));
    const taiWeighted = weights.reduce((sum, w, i) => sum + (last15[i] === 'Tài' ? w : 0), 0);
    const xiuWeighted = weights.reduce((sum, w, i) => sum + (last15[i] === 'Xỉu' ? w : 0), 0);
    const totalWeight = taiWeighted + xiuWeighted;
    if (totalWeight > 0 && Math.abs(taiWeighted - xiuWeighted) / totalWeight >= 0.25) return taiWeighted > xiuWeighted ? 2 : 1;
    return last15[last15.length - 1] === 'Xỉu' ? 1 : 2;
}

function shortPattern(history) {
    if (!history || history.length < 3) return 0;
    const { streak, currentResult, breakProb } = detectStreakAndBreak(history);
    if (streak >= 4) return breakProb > 0.75 ? (currentResult === 'Tài' ? 2 : 1) : (currentResult === 'Tài' ? 1 : 2);
    const last8 = history.slice(-8).map(h => h.result);
    if (!last8.length) return 0;
    return last8[last8.length - 1] === 'Xỉu' ? 1 : 2;
}

function meanDeviation(history) {
    if (!history || history.length < 3) return 0;
    const { streak, currentResult, breakProb } = detectStreakAndBreak(history);
    if (streak >= 4) return breakProb > 0.75 ? (currentResult === 'Tài' ? 2 : 1) : (currentResult === 'Tài' ? 1 : 2);
    const last12 = history.slice(-12).map(h => h.result);
    if (!last12.length) return 0;
    const taiCount = last12.filter(r => r === 'Tài').length;
    const xiuCount = last12.length - taiCount;
    return xiuCount > taiCount ? 1 : 2;
}

function recentSwitch(history) {
    if (!history || history.length < 3) return 0;
    const { streak, currentResult, breakProb } = detectStreakAndBreak(history);
    if (streak >= 4) return breakProb > 0.75 ? (currentResult === 'Tài' ? 2 : 1) : (currentResult === 'Tài' ? 1 : 2);
    const last10 = history.slice(-10).map(h => h.result);
    if (!last10.length) return 0;
    return last10[last10.length - 1] === 'Xỉu' ? 1 : 2;
}

function isBadPattern(history) {
    if (!history || history.length < 3) return false;
    const last15 = history.slice(-15).map(h => h.result);
    if (!last15.length) return false;
    const switches = last15.slice(1).reduce((count, curr, idx) => count + (curr !== last15[idx] ? 1 : 0), 0);
    const { streak } = detectStreakAndBreak(history);
    return switches >= 9 || streak >= 10;
}

function aiHtddLogic(history) {
    if (!history || history.length < 3) {
        return { prediction: Math.random() < 0.5 ? 'Tài' : 'Xỉu', reason: '[AI] Không đủ lịch sử', source: 'AI HTDD' };
    }
    const recentHistory = history.slice(-5).map(h => h.result);
    const recentScores = history.slice(-5).map(h => h.total || 0);
    const taiCount = recentHistory.filter(r => r === 'Tài').length;
    const xiuCount = recentHistory.filter(r => r === 'Xỉu').length;
    if (history.length >= 3) {
        const last3 = history.slice(-3).map(h => h.result);
        if (last3.join(',') === 'Tài,Xỉu,Tài') return { prediction: 'Xỉu', reason: '[AI] Mẫu 1T1X → Xỉu', source: 'AI HTDD' };
        if (last3.join(',') === 'Xỉu,Tài,Xỉu') return { prediction: 'Tài', reason: '[AI] Mẫu 1X1T → Tài', source: 'AI HTDD' };
    }
    if (history.length >= 4) {
        const last4 = history.slice(-4).map(h => h.result);
        if (last4.join(',') === 'Tài,Tài,Xỉu,Xỉu') return { prediction: 'Tài', reason: '[AI] Mẫu 2T2X → Tài', source: 'AI HTDD' };
        if (last4.join(',') === 'Xỉu,Xỉu,Tài,Tài') return { prediction: 'Xỉu', reason: '[AI] Mẫu 2X2T → Xỉu', source: 'AI HTDD' };
    }
    if (history.length >= 9 && history.slice(-6).every(h => h.result === 'Tài')) return { prediction: 'Xỉu', reason: '[AI] Chuỗi Tài dài (6) → Xỉu', source: 'AI HTDD' };
    if (history.length >= 9 && history.slice(-6).every(h => h.result === 'Xỉu')) return { prediction: 'Tài', reason: '[AI] Chuỗi Xỉu dài (6) → Tài', source: 'AI HTDD' };
    const avgScore = recentScores.reduce((sum, score) => sum + score, 0) / (recentScores.length || 1);
    if (avgScore > 10) return { prediction: 'Tài', reason: `[AI] Điểm TB cao (${avgScore.toFixed(1)}) → Tài`, source: 'AI HTDD' };
    if (avgScore < 8) return { prediction: 'Xỉu', reason: `[AI] Điểm TB thấp (${avgScore.toFixed(1)}) → Xỉu`, source: 'AI HTDD' };
    if (taiCount > xiuCount + 1) return { prediction: 'Xỉu', reason: `[AI] Tài nhiều → Xỉu`, source: 'AI HTDD' };
    if (xiuCount > taiCount + 1) return { prediction: 'Tài', reason: `[AI] Xỉu nhiều → Tài`, source: 'AI HTDD' };
    const overallTai = history.filter(h => h.result === 'Tài').length;
    const overallXiu = history.filter(h => h.result === 'Xỉu').length;
    if (overallTai > overallXiu + 2) return { prediction: 'Xỉu', reason: '[AI] Tổng Tài nhiều → Xỉu', source: 'AI HTDD' };
    if (overallXiu > overallTai + 2) return { prediction: 'Tài', reason: '[AI] Tổng Xỉu nhiều → Tài', source: 'AI HTDD' };
    return { prediction: Math.random() < 0.5 ? 'Tài' : 'Xỉu', reason: '[AI] Cân bằng → ngẫu nhiên', source: 'AI HTDD' };
}

function generatePrediction(history) {
    if (!history || history.length === 0) return { prediction: Math.random() < 0.5 ? 'Tài' : 'Xỉu', confidence: 50 };
    if (!modelPredictions['trend']) {
        modelPredictions['trend'] = {};
        modelPredictions['short'] = {};
        modelPredictions['mean'] = {};
        modelPredictions['switch'] = {};
        modelPredictions['bridge'] = {};
    }
    const currentIndex = history[history.length - 1].phien;
    const trendPred = history.length < 5 ? (history[history.length - 1].result === 'Tài' ? 2 : 1) : trendAndProb(history);
    const shortPred = history.length < 5 ? (history[history.length - 1].result === 'Tài' ? 2 : 1) : shortPattern(history);
    const meanPred = history.length < 5 ? (history[history.length - 1].result === 'Tài' ? 2 : 1) : meanDeviation(history);
    const switchPred = history.length < 5 ? (history[history.length - 1].result === 'Tài' ? 2 : 1) : recentSwitch(history);
    const bridgePred = history.length < 5 ? { prediction: (history[history.length - 1].result === 'Tài' ? 2 : 1), breakProb: 0.0, reason: 'Lịch sử ngắn' } : smartBridgeBreak(history);
    const aiPred = aiHtddLogic(history);
    modelPredictions['trend'][currentIndex] = trendPred;
    modelPredictions['short'][currentIndex] = shortPred;
    modelPredictions['mean'][currentIndex] = meanPred;
    modelPredictions['switch'][currentIndex] = switchPred;
    modelPredictions['bridge'][currentIndex] = bridgePred.prediction;
    const modelScores = {
        trend: evaluateModelPerformance(history, 'trend'),
        short: evaluateModelPerformance(history, 'short'),
        mean: evaluateModelPerformance(history, 'mean'),
        switch: evaluateModelPerformance(history, 'switch'),
        bridge: evaluateModelPerformance(history, 'bridge')
    };
    const weights = {
        trend: 0.2 * modelScores.trend,
        short: 0.2 * modelScores.short,
        mean: 0.25 * modelScores.mean,
        switch: 0.2 * modelScores.switch,
        bridge: 0.15 * modelScores.bridge,
        aihtdd: 0.2
    };
    let taiScore = 0, xiuScore = 0;
    if (trendPred === 1) taiScore += weights.trend; else if (trendPred === 2) xiuScore += weights.trend;
    if (shortPred === 1) taiScore += weights.short; else if (shortPred === 2) xiuScore += weights.short;
    if (meanPred === 1) taiScore += weights.mean; else if (meanPred === 2) xiuScore += weights.mean;
    if (switchPred === 1) taiScore += weights.switch; else if (switchPred === 2) xiuScore += weights.switch;
    if (bridgePred.prediction === 1) taiScore += weights.bridge; else if (bridgePred.prediction === 2) xiuScore += weights.bridge;
    if (aiPred.prediction === 'Tài') taiScore += weights.aihtdd; else xiuScore += weights.aihtdd;
    if (isBadPattern(history)) { taiScore *= 0.8; xiuScore *= 0.8; }
    const last10Preds = history.slice(-10).map(h => h.result);
    const taiPredCount = last10Preds.filter(r => r === 'Tài').length;
    if (taiPredCount >= 7) xiuScore += 0.15;
    else if (taiPredCount <= 3) taiScore += 0.15;
    if (bridgePred.breakProb > 0.65) {
        if (bridgePred.prediction === 1) taiScore += 0.2; else xiuScore += 0.2;
    }
    const finalPrediction = taiScore > xiuScore ? 'Tài' : 'Xỉu';
    const totalScore = taiScore + xiuScore;
    let confidence = totalScore > 0 ? Math.round((Math.max(taiScore, xiuScore) / totalScore) * 100) : 50;
    confidence = Math.max(52, Math.min(96, confidence));
    return { prediction: finalPrediction, confidence };
}

// ======================================================
// THUẬT TOÁN 2: MARKOV ĐA BẬC
// ======================================================
function predictMarkov(seq) {
    if (seq.length < 4) return null;
    let best = null, bestConf = 0;
    for (let order = 3; order <= Math.min(5, seq.length - 1); order++) {
        const last = seq.slice(-order);
        const trans = {};
        for (let i = 0; i <= seq.length - order - 1; i++) {
            const pat = seq.slice(i, i + order);
            const next = seq[i + order];
            if (!trans[pat]) trans[pat] = { T: 0, X: 0 };
            trans[pat][next]++;
        }
        const possible = trans[last];
        if (!possible) continue;
        const total = possible.T + possible.X;
        const probTai = possible.T / total;
        const conf = (Math.max(possible.T, possible.X) / total) * 100;
        if (conf > bestConf) {
            bestConf = conf;
            best = probTai > 0.5 ? "Tài" : probTai < 0.5 ? "Xỉu" : (Math.random() < 0.5 ? "Tài" : "Xỉu");
        }
    }
    return best ? { prediction: best, confidence: Math.round(bestConf) } : null;
}

function markov1(history) {
    if (history.length < 2) return null;
    const last = history[history.length - 1];
    const trans = { T: { T: 0, X: 0 }, X: { T: 0, X: 0 } };
    for (let i = 0; i < history.length - 1; i++) trans[history[i]][history[i + 1]]++;
    if (trans[last].T > trans[last].X) return 'T';
    if (trans[last].X > trans[last].T) return 'X';
    return null;
}

function markov2(history) {
    if (history.length < 3) return null;
    const last2 = history.slice(-2);
    const trans = new Map();
    for (let i = 0; i < history.length - 2; i++) {
        const key = history[i] + ',' + history[i + 1];
        const next = history[i + 2];
        if (!trans.has(key)) trans.set(key, { T: 0, X: 0 });
        trans.get(key)[next]++;
    }
    const possible = trans.get(last2.join(','));
    if (!possible) return null;
    return possible.T > possible.X ? 'T' : (possible.X > possible.T ? 'X' : null);
}

function markov3(history) {
    if (history.length < 4) return null;
    const last3 = history.slice(-3);
    const trans = new Map();
    for (let i = 0; i < history.length - 3; i++) {
        const key = history.slice(i, i + 3).join(',');
        const next = history[i + 3];
        if (!trans.has(key)) trans.set(key, { T: 0, X: 0 });
        trans.get(key)[next]++;
    }
    const possible = trans.get(last3.join(','));
    if (!possible) return null;
    return possible.T > possible.X ? 'T' : (possible.X > possible.T ? 'X' : null);
}

// ======================================================
// PHÂN TÍCH CẦU TỰ NHIÊN
// ======================================================
function analyzeCauDetail(history) {
    if (history.length < 10) return "[Đang thu thập dữ liệu...]";
    const last10 = history.slice(-10).map(h => h.ket_qua === "tài" ? "t" : "x");
    const patternStr = last10.join("");
    let cauTypes = [];
    let streak = 1;
    const lastResult = last10[last10.length - 1];
    for (let i = last10.length - 2; i >= 0; i--) {
        if (last10[i] === lastResult) streak++;
        else break;
    }
    if (streak >= 3) cauTypes.push(`Bệt ${streak} ${lastResult === 't' ? 'Tài' : 'Xỉu'}`);
    let is11 = true;
    for (let i = 1; i < last10.length; i++) if (last10[i] === last10[i-1]) { is11 = false; break; }
    if (is11) cauTypes.push("Cầu 1-1");
    let is22 = true;
    for (let i = 0; i < last10.length - 1; i += 2) if (last10[i] !== last10[i+1]) { is22 = false; break; }
    if (is22 && last10[0] !== last10[2]) cauTypes.push("Cầu 2-2");
    const taiCount = last10.filter(r => r === 't').length;
    const xiuCount = 10 - taiCount;
    if (cauTypes.length === 0) {
        if (taiCount >= 7) cauTypes.push("Xu hướng Tài mạnh");
        else if (xiuCount >= 7) cauTypes.push("Xu hướng Xỉu mạnh");
        else if (taiCount >= 6) cauTypes.push("Nghiêng Tài");
        else if (xiuCount >= 6) cauTypes.push("Nghiêng Xỉu");
        else cauTypes.push("Cân bằng");
    }
    return `[Cầu ${cauTypes.join(', ')}] - ${patternStr}`;
}

// ======================================================
// DỰ ĐOÁN TỔNG HỢP
// ======================================================
function finalPredict(history) {
    if (history.length < 10) {
        return { duDoan: "tài", doTinCay: 52 };
    }
    const pred1 = generatePrediction(history);
    const seq = history.map(h => h.ket_qua === "tài" ? "T" : "X").join("");
    const pred2 = predictMarkov(seq);
    const last10 = history.slice(-10).map(h => h.ket_qua === "tài" ? "t" : "x");
    const taiCount = last10.filter(r => r === 't').length;
    const xiuCount = 10 - taiCount;
    let taiScore = 0, xiuScore = 0;
    if (pred1.prediction === 'Tài') taiScore += pred1.confidence / 100;
    else xiuScore += pred1.confidence / 100;
    if (pred2 && pred2.prediction === 'Tài') taiScore += pred2.confidence / 200;
    else if (pred2) xiuScore += pred2.confidence / 200;
    if (taiCount >= 6) taiScore += 0.1;
    else if (xiuCount >= 6) xiuScore += 0.1;
    let duDoan = taiScore > xiuScore ? "tài" : "xỉu";
    let doTinCay = Math.round((Math.max(taiScore, xiuScore) / (taiScore + xiuScore || 1)) * 100);
    doTinCay = Math.max(52, Math.min(96, doTinCay));
    if (taiCount >= 8) { duDoan = "xỉu"; doTinCay = Math.min(96, doTinCay + 5); }
    if (xiuCount >= 8) { duDoan = "tài"; doTinCay = Math.min(96, doTinCay + 5); }
    return { duDoan, doTinCay };
}

// ======================================================
// API ROUTES
// ======================================================
app.get("/taixiu", async (req, res) => {
    try {
        const response = await axios.get(API_URL, { timeout: 10000 });
        const rawData = response.data;
        const dataArray = rawData.data || rawData || [];
        const history = normalizeData(Array.isArray(dataArray) ? dataArray : [dataArray]);
        if (history.length < 10) {
            return res.json({
                id: "AnhKhoidzai Sunwin",
                phien_truoc: history.length > 0 ? history[history.length - 1].phien : 0,
                xuc_xac1: history.length > 0 ? history[history.length - 1].x1 : 0,
                xuc_xac2: history.length > 0 ? history[history.length - 1].x2 : 0,
                xuc_xac3: history.length > 0 ? history[history.length - 1].x3 : 0,
                tong: history.length > 0 ? history[history.length - 1].tong : 0,
                ket_qua: history.length > 0 ? history[history.length - 1].ket_qua : "tài",
                pattern: "[Đang thu thập dữ liệu...]",
                phien_hien_tai: history.length > 0 ? history[history.length - 1].phien + 1 : 0,
                du_doan: "tài",
                do_tin_cay: "52%"
            });
        }
        const latest = history[history.length - 1];
        const pattern = analyzeCauDetail(history);
        const predict = finalPredict(history);
        res.json({
            id: "AnhKhoidzai Sunwin",
            phien_truoc: latest.phien,
            xuc_xac1: latest.x1,
            xuc_xac2: latest.x2,
            xuc_xac3: latest.x3,
            tong: latest.tong,
            ket_qua: latest.ket_qua,
            pattern: pattern,
            phien_hien_tai: latest.phien + 1,
            du_doan: predict.duDoan,
            do_tin_cay: predict.doTinCay + "%"
        });
    } catch (err) {
        console.log("Lỗi:", err.message);
        res.json({
            id: "AnhKhoidzai Sunwin",
            phien_truoc: 0, xuc_xac1: 0, xuc_xac2: 0, xuc_xac3: 0, tong: 0,
            ket_qua: "tài", pattern: "[Đang kết nối...]", phien_hien_tai: 0,
            du_doan: "tài", do_tin_cay: "52%"
        });
    }
});

app.get("/", async (req, res) => {
    try {
        const response = await axios.get(API_URL, { timeout: 10000 });
        const rawData = response.data;
        const dataArray = rawData.data || rawData || [];
        const history = normalizeData(Array.isArray(dataArray) ? dataArray : [dataArray]);
        if (history.length < 10) {
            return res.json({
                id: "AnhKhoidzai Sunwin",
                phien_truoc: history.length > 0 ? history[history.length - 1].phien : 0,
                xuc_xac1: history.length > 0 ? history[history.length - 1].x1 : 0,
                xuc_xac2: history.length > 0 ? history[history.length - 1].x2 : 0,
                xuc_xac3: history.length > 0 ? history[history.length - 1].x3 : 0,
                tong: history.length > 0 ? history[history.length - 1].tong : 0,
                ket_qua: history.length > 0 ? history[history.length - 1].ket_qua : "tài",
                pattern: "[Đang thu thập dữ liệu...]",
                phien_hien_tai: history.length > 0 ? history[history.length - 1].phien + 1 : 0,
                du_doan: "tài",
                do_tin_cay: "52%"
            });
        }
        const latest = history[history.length - 1];
        const pattern = analyzeCauDetail(history);
        const predict = finalPredict(history);
        const result = {
            id: "AnhKhoidzai Sunwin",
            phien_truoc: latest.phien,
            xuc_xac1: latest.x1,
            xuc_xac2: latest.x2,
            xuc_xac3: latest.x3,
            tong: latest.tong,
            ket_qua: latest.ket_qua,
            pattern: pattern,
            phien_hien_tai: latest.phien + 1,
            du_doan: predict.duDoan,
            do_tin_cay: predict.doTinCay + "%"
        };
        console.log("JSON:", JSON.stringify(result));
        res.json(result);
    } catch (err) {
        console.log("Lỗi:", err.message);
        res.json({
            id: "AnhKhoidzai Sunwin",
            phien_truoc: 0, xuc_xac1: 0, xuc_xac2: 0, xuc_xac3: 0, tong: 0,
            ket_qua: "tài", pattern: "[Đang kết nối...]", phien_hien_tai: 0,
            du_doan: "tài", do_tin_cay: "52%"
        });
    }
});

app.listen(PORT, () => {
    console.log(`Server chạy tại port ${PORT}`);
});
