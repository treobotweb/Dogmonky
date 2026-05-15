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
            xuc_xac_1: d1, xuc_xac_2: d2, xuc_xac_3: d3,
            tong: tong,
            ket_qua: ketQua === "tài" ? "tài" : "xỉu",
            result: ketQua === "tài" ? "Tài" : "Xỉu"
        };
    }).filter(item => item.phien > 0 && item.tong >= 3 && item.tong <= 18);
}

// ======================================================
// PHAN TICH LICH SU - TIM PATTERN TRUNG KHOP NHAT
// ======================================================
function analyzeHistoryStats(history) {
    let results = history.map(h => h.result === 'Tài' ? 'T' : 'X');
    let n = results.length;
    if (n < 10) return null;

    // Tim pattern 3 phien cuoi trong toan bo lich su
    let currentPattern = results.slice(-3).join('');
    let patternStats = {};

    for (let i = 0; i < n - 3; i++) {
        let pattern = results.slice(i, i + 3).join('');
        let next = results[i + 3];
        let key = pattern + '->' + next;
        patternStats[key] = (patternStats[key] || 0) + 1;
    }

    // Tim ket qua xuat hien nhieu nhat sau pattern hien tai
    let totalForPattern = 0;
    let bestNext = '';
    let bestCount = 0;

    for (let key in patternStats) {
        if (key.startsWith(currentPattern)) {
            totalForPattern += patternStats[key];
            let next = key.split('->')[1];
            if (patternStats[key] > bestCount) {
                bestCount = patternStats[key];
                bestNext = next;
            }
        }
    }

    // Tim cac pattern tuong tu (khop 2/3)
    let similarPatterns = {};
    for (let key in patternStats) {
        let pattern = key.split('->')[0];
        let next = key.split('->')[1];
        let matches = 0;
        for (let i = 0; i < 3; i++) {
            if (pattern[i] === currentPattern[i]) matches++;
        }
        if (matches >= 2) {
            let simKey = 'similar_' + next;
            similarPatterns[simKey] = (similarPatterns[simKey] || 0) + patternStats[key];
        }
    }

    return {
        currentPattern,
        bestNext,
        bestCount,
        totalForPattern,
        bestPatternAcc: totalForPattern > 0 ? bestCount / totalForPattern : 0,
        similarPatterns
    };
}

// ======================================================
// TINH XAC SUAT BE CAU
// ======================================================
function calcBreakProbReal(history, result, streak) {
    let same = 0, longer = 0, cur = 1;
    for (let i = 1; i < history.length; i++) {
        if (history[i] === history[i - 1]) cur++;
        else {
            if (history[i - 1] === result) {
                if (cur === streak) same++; else if (cur > streak) longer++;
            }
            cur = 1;
        }
    }
    if (history[history.length - 1] === result) {
        if (cur === streak) same++; else if (cur > streak) longer++;
    }
    let total = same + longer;
    return total > 0 ? same / total : 0.5;
}

// ======================================================
// SUPER CAU DETECTION
// ======================================================
function detectAllCauSuper(results, scores) {
    let n = results.length;
    if (n < 5) return [];
    let caus = [];

    // === BIET ===
    let streak = 1;
    let lastResult = results[n - 1];
    for (let i = n - 2; i >= 0; i--) {
        if (results[i] === lastResult) streak++;
        else break;
    }
    if (streak >= 2) {
        let bp = calcBreakProbReal(results, lastResult, streak);
        if (streak >= 7) {
            caus.push({ p: lastResult === 'T' ? 'X' : 'T', c: Math.min(95, 70 + streak * 2), w: 15, t: 'biet', n: 'Bệt dài ' + streak, bp });
        } else if (streak >= 5) {
            caus.push({ p: bp > 0.5 ? (lastResult === 'T' ? 'X' : 'T') : lastResult, c: Math.min(90, 60 + streak * 3), w: 12, t: 'biet', n: 'Bệt ' + streak, bp });
        } else if (streak >= 3) {
            caus.push({ p: lastResult, c: 55 + streak * 5, w: 8, t: 'biet', n: 'Bệt ' + streak, bp });
        }
    }

    // === 1-1 ===
    if (n >= 4) {
        let is11 = true;
        for (let i = n - 3; i < n; i++) {
            if (results[i] === results[i - 1]) { is11 = false; break; }
        }
        if (is11) {
            let len = 4;
            for (let i = n - 4; i >= 0; i--) {
                if (results[i] !== results[i + 1]) len++; else break;
            }
            caus.push({ p: results[n - 1] === 'T' ? 'X' : 'T', c: Math.min(90, 65 + len * 2), w: len >= 8 ? 12 : 8, t: '1-1', n: 'Cầu 1-1 (' + len + ')' });
        }
    }

    // === 2-2 ===
    if (n >= 8) {
        let last8 = results.slice(-8);
        let is22 = true;
        for (let i = 0; i < 8; i += 2) {
            if (last8[i] !== last8[i + 1]) { is22 = false; break; }
        }
        if (is22 && last8[0] !== last8[2]) {
            let phase = n % 2;
            caus.push({ p: phase === 0 ? last8[7] : (last8[7] === 'T' ? 'X' : 'T'), c: 80, w: 10, t: '2-2', n: 'Cầu 2-2' });
        }
    }

    // === RONG ===
    let tRun = 0;
    for (let i = n - 1; i >= 0 && results[i] === 'T'; i--) tRun++;
    if (tRun >= 6) caus.push({ p: 'X', c: Math.min(95, 78 + tRun), w: 14, t: 'rong', n: 'Rồng ' + tRun });
    else if (tRun >= 4) caus.push({ p: 'T', c: 68 + tRun, w: 8, t: 'rong', n: 'Rồng ' + tRun });

    // === HO ===
    let xRun = 0;
    for (let i = n - 1; i >= 0 && results[i] === 'X'; i--) xRun++;
    if (xRun >= 6) caus.push({ p: 'T', c: Math.min(95, 78 + xRun), w: 14, t: 'ho', n: 'Hổ ' + xRun });
    else if (xRun >= 4) caus.push({ p: 'X', c: 68 + xRun, w: 8, t: 'ho', n: 'Hổ ' + xRun });

    // === 1-2-3 ===
    if (n >= 6) {
        let l6 = results.slice(-6).join('');
        if (l6 === "TXXTTT") caus.push({ p: 'X', c: 77, w: 8, t: '1-2-3', n: 'Cầu 1-2-3' });
        if (l6 === "XTTXXX") caus.push({ p: 'T', c: 77, w: 8, t: '1-2-3', n: 'Cầu 1-2-3' });
    }

    // === 3-2-1 ===
    if (n >= 6) {
        let l6 = results.slice(-6).join('');
        if (l6 === "TTTXXT") caus.push({ p: 'X', c: 76, w: 8, t: '3-2-1', n: 'Cầu 3-2-1' });
        if (l6 === "XXXTTX") caus.push({ p: 'T', c: 76, w: 8, t: '3-2-1', n: 'Cầu 3-2-1' });
    }

    // === ZIGZAG ===
    if (n >= 7) {
        let l7 = results.slice(-7);
        let sw = 0;
        for (let i = 1; i < 7; i++) if (l7[i] !== l7[i - 1]) sw++;
        if (sw >= 5) caus.push({ p: results[n - 1] === 'T' ? 'X' : 'T', c: 68 + sw * 2, w: sw >= 7 ? 9 : 6, t: 'zigzag', n: 'Zigzag ' + sw });
    }

    // === SCORE ===
    if (scores && scores.length >= 3) {
        let last3 = scores.slice(-3);
        let avg = last3.reduce((a, b) => a + b, 0) / 3;
        if (avg > 13) caus.push({ p: 'X', c: 65, w: 7, t: 'score', n: 'Điểm cao TB' });
        if (avg < 7) caus.push({ p: 'T', c: 65, w: 7, t: 'score', n: 'Điểm thấp TB' });
    }

    // === SWITCH RATE ===
    if (n >= 10) {
        let sw10 = 0;
        for (let i = n - 9; i < n; i++) if (results[i] !== results[i - 1]) sw10++;
        if (sw10 >= 7) caus.push({ p: results[n - 1] === 'T' ? 'X' : 'T', c: 65 + sw10, w: 8, t: 'switch', n: 'Đảo liên tục' });
    }

    caus.sort((a, b) => (b.w * 100 + b.c) - (a.w * 100 + a.c));
    return caus;
}

// ======================================================
// DICE SUPER ANALYSIS
// ======================================================
function diceSuperAnalysis(history) {
    if (history.length < 5) return [];
    let preds = [];
    let last = history[history.length - 1];
    let d1 = last.x1, d2 = last.x2, d3 = last.x3;
    let sum = d1 + d2 + d3;

    // SUM AFTER
    let sumAfter = {};
    for (let i = 0; i < history.length - 1; i++) {
        let s = history[i].x1 + history[i].x2 + history[i].x3;
        if (s === sum && i + 1 < history.length) {
            let ns = history[i + 1].x1 + history[i + 1].x2 + history[i + 1].x3;
            sumAfter[ns] = (sumAfter[ns] || 0) + 1;
        }
    }
    let totalAfter = Object.values(sumAfter).reduce((a, b) => a + b, 0);
    if (totalAfter >= 5) {
        let bestSum = 3, bestCount = 0;
        for (let s = 3; s <= 18; s++) if ((sumAfter[s] || 0) > bestCount) { bestCount = sumAfter[s]; bestSum = s; }
        preds.push({ p: bestSum >= 11 ? 'T' : 'X', c: 50 + (bestCount / totalAfter) * 35, s: 'sum', w: 8 });
    }

    // TRIPLE
    let triple = d1 + '' + d2 + '' + d3;
    let tc = 0, tt = 0;
    for (let i = 0; i < history.length - 1; i++) {
        let ht = history[i].x1 + '' + history[i].x2 + '' + history[i].x3;
        if (ht === triple && i + 1 < history.length) { tc++; if (history[i + 1].result === 'Tài') tt++; }
    }
    if (tc >= 3) { let prob = tt / tc; preds.push({ p: prob > 0.5 ? 'T' : 'X', c: 50 + Math.abs(prob - 0.5) * 70, s: 'triple', w: 9 }); }

    // PAIR
    let p12 = d1 + '' + d2, p23 = d2 + '' + d3, p13 = d1 + '' + d3;
    let pc = 0, pt = 0;
    for (let i = 0; i < history.length - 1; i++) {
        let hp12 = history[i].x1 + '' + history[i].x2;
        let hp23 = history[i].x2 + '' + history[i].x3;
        let hp13 = history[i].x1 + '' + history[i].x3;
        if ((hp12 === p12 || hp23 === p23 || hp13 === p13) && i + 1 < history.length) { pc++; if (history[i + 1].result === 'Tài') pt++; }
    }
    if (pc >= 5) { let prob = pt / pc; preds.push({ p: prob > 0.5 ? 'T' : 'X', c: 50 + Math.abs(prob - 0.5) * 50, s: 'pair', w: 7 }); }

    // HIGH/LOW
    let hl = (d1 >= 4 ? 'H' : 'L') + (d2 >= 4 ? 'H' : 'L') + (d3 >= 4 ? 'H' : 'L');
    let hlc = 0, hlt = 0;
    for (let i = 0; i < history.length - 1; i++) {
        let hhl = (history[i].x1 >= 4 ? 'H' : 'L') + (history[i].x2 >= 4 ? 'H' : 'L') + (history[i].x3 >= 4 ? 'H' : 'L');
        if (hhl === hl && i + 1 < history.length) { hlc++; if (history[i + 1].result === 'Tài') hlt++; }
    }
    if (hlc >= 5) { let prob = hlt / hlc; preds.push({ p: prob > 0.5 ? 'T' : 'X', c: 50 + Math.abs(prob - 0.5) * 40, s: 'hl', w: 6 }); }

    return preds;
}

// ======================================================
// MAIN PREDICT - SUPER ACCURACY
// ======================================================
function predictSuper(history) {
    let n = history.length;
    if (n < 5) return { prediction: 'Chờ thêm dữ liệu', confidence: 0 };

    let results = history.map(h => (h.result === 'Tài' || h.result === 'T') ? 'T' : 'X');
    let scores = history.map(h => h.tong || 0);
    let lastScore = scores[n - 1];
    let lastResult = results[n - 1];
    let allPreds = [];

    // 1. CAU detection
    let caus = detectAllCauSuper(results, scores);
    for (let c of caus.slice(0, 15)) {
        allPreds.push({ p: c.p, c: c.c, w: c.w, t: c.t, n: c.n });
    }

    // 2. DICE analysis
    let dicePreds = diceSuperAnalysis(history);
    for (let dp of dicePreds) {
        allPreds.push({ p: dp.p, c: dp.c, w: dp.w, t: 'dice', n: 'dice_' + dp.s });
    }

    // 3. HISTORY STATS - PATTERN TRUNG KHOP NHAT
    let stats = analyzeHistoryStats(history);
    if (stats) {
        if (stats.bestNext && stats.totalForPattern >= 3) {
            allPreds.push({ p: stats.bestNext, c: Math.min(90, stats.bestPatternAcc * 100 + 40), w: 12, t: 'pattern', n: 'Pattern khớp ' + stats.currentPattern });
        }
        // Similar patterns
        if (stats.similarPatterns) {
            for (let key in stats.similarPatterns) {
                let next = key.split('_')[1];
                let count = stats.similarPatterns[key];
                if (count >= 5) {
                    allPreds.push({ p: next, c: 55 + Math.min(30, count * 2), w: 6, t: 'similar', n: 'Tương tự pattern' });
                }
            }
        }
    }

    // 4. SCORE EXTREMES
    if (lastScore >= 17) allPreds.push({ p: 'X', c: 85, w: 10, t: 'score', n: 'score_vhigh' });
    else if (lastScore >= 15) allPreds.push({ p: 'X', c: 72, w: 8, t: 'score', n: 'score_high' });
    if (lastScore <= 4) allPreds.push({ p: 'T', c: 85, w: 10, t: 'score', n: 'score_vlow' });
    else if (lastScore <= 6) allPreds.push({ p: 'T', c: 68, w: 7, t: 'score', n: 'score_low' });

    // 5. TREND 10 phien
    let last10 = results.slice(-10);
    let tCount = last10.filter(r => r === 'T').length;
    if (tCount >= 8) allPreds.push({ p: 'X', c: 72, w: 8, t: 'trend', n: 'overbought' });
    else if (tCount >= 7) allPreds.push({ p: 'X', c: 64, w: 6, t: 'trend', n: 'overbought_w' });
    if (tCount <= 2) allPreds.push({ p: 'T', c: 72, w: 8, t: 'trend', n: 'oversold' });
    else if (tCount <= 3) allPreds.push({ p: 'T', c: 64, w: 6, t: 'trend', n: 'oversold_w' });

    // 6. RECENT 5
    let last5 = results.slice(-5);
    let l5t = last5.filter(r => r === 'T').length;
    if (l5t === 5) allPreds.push({ p: 'X', c: 78, w: 9, t: 'recent', n: 'all_tai' });
    if (l5t === 0) allPreds.push({ p: 'T', c: 78, w: 9, t: 'recent', n: 'all_xiu' });

    if (allPreds.length === 0) return { prediction: lastResult === 'T' ? 'Xỉu' : 'Tài', confidence: 50 };

    // SORT
    allPreds.sort((a, b) => (b.w * 100 + b.c) - (a.w * 100 + a.c));

    // ENSEMBLE TOP 20
    let topPreds = allPreds.slice(0, 20);
    let voteT = 0, voteX = 0, totalW = 0;
    for (let p of topPreds) {
        let w = p.w * (p.c / 100);
        if (p.p === 'T') voteT += w;
        else voteX += w;
        totalW += w;
    }

    if (totalW === 0) return { prediction: lastResult === 'T' ? 'Xỉu' : 'Tài', confidence: 50 };

    let probT = voteT / totalW;
    let finalPred = probT > 0.5 ? 'T' : 'X';
    let confidence = Math.round(Math.abs(probT - 0.5) * 2 * 100);
    confidence = Math.max(52, Math.min(98, confidence));

    // AGREEMENT BONUS
    let top3Agree = topPreds.slice(0, 3).every(p => p.p === topPreds[0].p);
    let top5Agree = topPreds.slice(0, 5).every(p => p.p === topPreds[0].p);
    let top10Agree = topPreds.slice(0, 10).every(p => p.p === topPreds[0].p);
    if (top10Agree) confidence = Math.min(98, confidence + 15);
    else if (top5Agree) confidence = Math.min(98, confidence + 10);
    else if (top3Agree) confidence = Math.min(98, confidence + 5);

    return {
        prediction: finalPred === 'T' ? 'Tài' : 'Xỉu',
        confidence,
        topCau: topPreds.slice(0, 5).map(p => ({ type: p.t, name: p.n, predict: p.p === 'T' ? 'Tài' : 'Xỉu', confidence: p.c })),
        totalSignals: allPreds.length
    };
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
    let caus = detectAllCauSuper(results, history.map(h => h.tong || 0));
    for (let c of caus.slice(0, 3)) cauTypes.push(c.n);
    if (cauTypes.length === 0) {
        let tCount = last10.filter(r => r === 'T').length;
        if (tCount >= 7) cauTypes.push("Tài mạnh");
        else if (tCount <= 3) cauTypes.push("Xỉu mạnh");
        else if (tCount >= 6) cauTypes.push("Nghiêng Tài");
        else if (tCount <= 4) cauTypes.push("Nghiêng Xỉu");
        else cauTypes.push("Cân bằng");
    }
    return "[Cầu " + cauTypes.join(', ') + "] - " + patternStr;
}

// ======================================================
// FINAL PREDICT
// ======================================================
function finalPredict(history) {
    if (history.length < 10) return { duDoan: "tài", doTinCay: 52 };
    let result = predictSuper(history);
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

app.listen(PORT, () => console.log("Server chạy tại port " + PORT));
