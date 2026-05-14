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
    return data
        .map(item => {
            const d1 = item.xuc_xac_1 || item.x1 || 0;
            const d2 = item.xuc_xac_2 || item.x2 || 0;
            const d3 = item.xuc_xac_3 || item.x3 || 0;
            const tong = item.tong || item.total || (d1 + d2 + d3);
            const ketQua = (
                item.ket_qua || item.result || (tong >= 11 ? "tài" : "xỉu")
            ).toLowerCase();
            return {
                phien: item.phien || item.session || item.id || 0,
                x1: d1, x2: d2, x3: d3,
                xuc_xac_1: d1, xuc_xac_2: d2, xuc_xac_3: d3,
                tong: tong,
                ket_qua: ketQua === "tài" ? "tài" : "xỉu",
                result: ketQua === "tài" ? "Tài" : "Xỉu",
                dice: [d1, d2, d3]
            };
        })
        .filter(item => item.phien > 0 && item.tong >= 3 && item.tong <= 18);
}

// ======================================================
// 1. MARKOV ENGINE
// ======================================================
class MarkovEngine {
    predictMarkov(seq) {
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
                best = probTai > 0.5 ? "T" : "X";
            }
        }
        return best ? { prediction: best, confidence: Math.round(bestConf) } : null;
    }

    markov1(history) {
        if (history.length < 2) return null;
        const last = history[history.length - 1];
        const trans = { T: { T: 0, X: 0 }, X: { T: 0, X: 0 } };
        for (let i = 0; i < history.length - 1; i++) trans[history[i]][history[i + 1]]++;
        if (trans[last].T > trans[last].X) return 'T';
        if (trans[last].X > trans[last].T) return 'X';
        return null;
    }

    markov2(history) {
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

    markov3(history) {
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
}

// ======================================================
// 2. FREQUENCY ENGINE
// ======================================================
class FrequencyEngine {
    predictWeighted(history, window = 50) {
        const recent = history.slice(-Math.min(window, history.length));
        let wTai = 0, wXiu = 0;
        for (let i = 0; i < recent.length; i++) {
            const w = Math.pow(0.93, recent.length - 1 - i);
            if (recent[i] === 'T') wTai += w;
            else wXiu += w;
        }
        if (wTai + wXiu === 0) return null;
        const probTai = wTai / (wTai + wXiu);
        const pred = probTai > 0.5 ? "T" : "X";
        const conf = Math.abs(probTai - 0.5) * 2 * 100;
        return { prediction: pred, confidence: Math.min(95, Math.max(50, conf)) };
    }

    simpleMajority(history, window = 15) {
        if (history.length < window) return null;
        const recent = history.slice(-window);
        const t = recent.filter(r => r === 'T').length;
        const x = window - t;
        if (t > x + 2) return 'T';
        if (x > t + 2) return 'X';
        return null;
    }
}

// ======================================================
// 3. CYCLE ENGINE
// ======================================================
class CycleEngine {
    predictCycle(seq, maxCycle = 20) {
        for (let cycle = 3; cycle <= maxCycle; cycle++) {
            if (seq.length < cycle * 2) continue;
            const lastCycle = seq.slice(-cycle);
            let matches = [];
            for (let i = 0; i <= seq.length - cycle - 1; i++) {
                if (seq.slice(i, i + cycle) === lastCycle) matches.push(i);
            }
            if (matches.length >= 2) {
                const nextIdx = matches[matches.length - 1] + cycle;
                if (nextIdx < seq.length) {
                    const nextRes = seq[nextIdx];
                    let conf = 60 + Math.min(30, matches.length * 3);
                    return { prediction: nextRes, confidence: conf };
                }
            }
        }
        return null;
    }
}

// ======================================================
// 4. TREND ENGINE
// ======================================================
class TrendEngine {
    predictTrend(history) {
        if (history.length < 6) return null;
        const last6 = history.slice(-6);
        const last3 = last6.slice(-3);
        if (last3[0] === last3[1] && last3[1] === last3[2]) {
            return { prediction: last3[0] === "T" ? "X" : "T", confidence: 72 };
        }
        let alt = true;
        for (let i = 1; i < last6.length; i++) if (last6[i] === last6[i - 1]) alt = false;
        if (alt && last6.length >= 4) {
            return { prediction: last6[last6.length - 1] === "T" ? "X" : "T", confidence: 76 };
        }
        const tai = last6.filter(r => r === "T").length;
        if (tai !== 3) {
            const pred = tai > 3 ? "T" : "X";
            const conf = 55 + Math.abs(tai - 3) * 5;
            return { prediction: pred, confidence: Math.min(75, conf) };
        }
        return null;
    }
}

// ======================================================
// 5. STREAK ENGINE
// ======================================================
class StreakEngine {
    predictStreak(history) {
        if (history.length < 5) return null;
        let streakLen = 1;
        for (let i = history.length - 2; i >= 0; i--) {
            if (history[i] === history[history.length - 1]) streakLen++;
            else break;
        }
        if (streakLen >= 3) {
            const pred = history[history.length - 1] === "T" ? "X" : "T";
            let conf = 60 + Math.min(25, streakLen * 4);
            return { prediction: pred, confidence: Math.min(85, conf) };
        }
        if (streakLen <= 2) {
            const pred = history[history.length - 1];
            let conf = 55 + streakLen * 5;
            return { prediction: pred, confidence: Math.min(75, conf) };
        }
        return null;
    }
}

// ======================================================
// 6. BAYES ENGINE
// ======================================================
class BayesEngine {
    predictBayes(history) {
        if (history.length < 10) return null;
        const last3 = history.slice(-3).join('');
        let taiCount = 0, xiuCount = 0;
        for (let i = 0; i <= history.length - 4; i++) {
            const pattern = history.slice(i, i + 3).join('');
            if (pattern === last3) {
                const next = history[i + 3];
                if (next === 'T') taiCount++;
                else xiuCount++;
            }
        }
        if (taiCount + xiuCount < 3) return null;
        const pred = taiCount > xiuCount ? "T" : "X";
        const conf = 55 + Math.min(30, Math.abs(taiCount - xiuCount) * 4);
        return { prediction: pred, confidence: Math.min(90, conf) };
    }
}

// ======================================================
// 7. FIBONACCI ENGINE
// ======================================================
class FibonacciEngine {
    predictByTotal(totals) {
        if (totals.length < 12) return null;
        const diffs = [];
        for (let i = 1; i < totals.length; i++) diffs.push(totals[i] - totals[i - 1]);
        const avgDiff = diffs.reduce((a, b) => a + b, 0) / diffs.length;
        let nextTotal = totals[totals.length - 1] + avgDiff;
        nextTotal = Math.min(18, Math.max(3, Math.round(nextTotal)));
        const pred = nextTotal > 10 ? "T" : "X";
        const conf = 55 + Math.min(30, Math.abs(avgDiff) * 2.5);
        return { prediction: pred, confidence: Math.min(85, conf) };
    }
}

// ======================================================
// 8. TECHNICAL INDICATORS ENGINE
// ======================================================
class TechnicalEngine {
    rsiPredict(history, period = 7) {
        if (history.length < period) return null;
        const nums = history.slice(-period).map(c => c === 'T' ? 1 : 0);
        let gains = 0, losses = 0;
        for (let i = 1; i < nums.length; i++) {
            const diff = nums[i] - nums[i - 1];
            if (diff > 0) gains += diff;
            else losses -= diff;
        }
        const avgGain = gains / period;
        const avgLoss = losses / period;
        let rsi = 50;
        if (avgLoss === 0) rsi = 100;
        else rsi = 100 - (100 / (1 + avgGain / avgLoss));
        if (rsi > 75) return history[history.length - 1] === 'T' ? 'X' : 'T';
        if (rsi < 25) return history[history.length - 1] === 'T' ? 'X' : 'T';
        if (rsi > 65) return 'X';
        if (rsi < 35) return 'T';
        return null;
    }

    bollingerPredict(history, period = 12) {
        if (history.length < period) return null;
        const nums = history.slice(-period).map(c => c === 'T' ? 1 : 0);
        const mean = nums.reduce((a, b) => a + b, 0) / period;
        const variance = nums.reduce((sum, x) => sum + Math.pow(x - mean, 2), 0) / period;
        const std = Math.sqrt(variance);
        const upper = mean + 2 * std;
        const lower = mean - 2 * std;
        const last = nums[nums.length - 1];
        if (last > upper) return 'X';
        if (last < lower) return 'T';
        return null;
    }

    macdPredict(history, short = 6, long = 13, signal = 4) {
        if (history.length < long + signal) return null;
        const nums = history.map(c => c === 'T' ? 1 : 0);
        const emaShort = nums.slice(-short).reduce((a, b) => a + b, 0) / short;
        const emaLong = nums.slice(-long).reduce((a, b) => a + b, 0) / long;
        const macd = emaShort - emaLong;
        const macdHistory = [];
        for (let i = nums.length - signal; i < nums.length; i++) {
            const eShort = nums.slice(0, i + 1).slice(-short).reduce((a, b) => a + b, 0) / Math.min(short, i + 1);
            const eLong = nums.slice(0, i + 1).slice(-long).reduce((a, b) => a + b, 0) / Math.min(long, i + 1);
            macdHistory.push(eShort - eLong);
        }
        const signalLine = macdHistory.reduce((a, b) => a + b, 0) / macdHistory.length;
        if (macd > signalLine + 0.05) return 'T';
        if (macd < signalLine - 0.05) return 'X';
        return null;
    }
}

// ======================================================
// 9. MACHINE LEARNING ENGINE
// ======================================================
class MachineLearningEngine {
    knnPredict(history, k = 5, lookback = 10) {
        if (history.length < lookback + k) return null;
        const query = history.slice(-lookback);
        const distances = [];
        for (let i = 0; i < history.length - lookback - 1; i++) {
            const segment = history.slice(i, i + lookback);
            let distance = 0;
            for (let j = 0; j < lookback; j++) if (segment[j] !== query[j]) distance++;
            distances.push({ distance, next: history[i + lookback] });
        }
        distances.sort((a, b) => a.distance - b.distance);
        const neighbors = distances.slice(0, k).map(d => d.next);
        const tCount = neighbors.filter(n => n === 'T').length;
        return tCount > k - tCount ? 'T' : 'X';
    }

    decisionTree(history) {
        if (history.length < 10) return null;
        const last1 = history[history.length - 1];
        const last2 = history.length > 1 ? history[history.length - 2] : null;
        const last3 = history.length > 2 ? history[history.length - 3] : null;
        const t5 = history.slice(-5).filter(c => c === 'T').length;
        if (last1 === 'T' && last2 === 'T' && last3 === 'T') return 'X';
        if (last1 === 'X' && last2 === 'X' && last3 === 'X') return 'T';
        if (last1 === 'T' && last2 === 'X' && last3 === 'T') return 'X';
        if (last1 === 'X' && last2 === 'T' && last3 === 'X') return 'T';
        if (t5 >= 4) return 'X';
        if (t5 <= 1) return 'T';
        return last1;
    }

    meanReversion(history, window = 12) {
        if (history.length < window) return null;
        const recent = history.slice(-window);
        const mean = recent.filter(r => r === 'T').length / window;
        if (mean > 0.75) return 'X';
        if (mean < 0.25) return 'T';
        return null;
    }
}

// ======================================================
// 10. SUPER CAU DETECTION - 20 PHIEN GAN NHAT
// ======================================================
function detectAllCau(history) {
    const results = history.map(h => h.result === 'Tài' ? 'T' : 'X');
    const n = results.length;
    if (n < 5) return [];
    let caus = [];

    // 1. CAU BIET
    let streak = 1;
    for (let i = n - 2; i >= 0; i--) {
        if (results[i] === results[n - 1]) streak++;
        else break;
    }
    if (streak >= 3) {
        let maxStreak = 0;
        for (let i = 1; i < n; i++) {
            let s = 1;
            for (let j = i - 1; j >= 0 && results[j] === results[i]; j--) s++;
            if (s > maxStreak) maxStreak = s;
        }
        let breakProb = Math.min(0.9, 0.3 + streak * 0.05 + (streak >= maxStreak ? 0.1 : 0));
        caus.push({
            type: 'biet',
            name: 'Bệt ' + streak + ' ' + (results[n - 1] === 'T' ? 'Tài' : 'Xỉu'),
            predict: breakProb > 0.6 ? (results[n - 1] === 'T' ? 'X' : 'T') : results[n - 1],
            confidence: 55 + streak * 3,
            priority: 10
        });
    }

    // 2. CAU 1-1
    if (n >= 6) {
        let is11 = true;
        for (let i = n - 5; i < n; i++) {
            if (results[i] === results[i - 1]) { is11 = false; break; }
        }
        if (is11) {
            caus.push({
                type: '1-1',
                name: 'Cầu 1-1',
                predict: results[n - 1] === 'T' ? 'X' : 'T',
                confidence: 75,
                priority: 9
            });
        }
    }

    // 3. CAU 2-2
    if (n >= 8) {
        let last8 = results.slice(-8);
        let is22 = true;
        for (let i = 0; i < 8; i += 2) {
            if (last8[i] !== last8[i + 1]) { is22 = false; break; }
        }
        if (is22 && last8[0] !== last8[2]) {
            let phase = n % 2;
            caus.push({
                type: '2-2',
                name: 'Cầu 2-2',
                predict: phase === 0 ? last8[7] : (last8[7] === 'T' ? 'X' : 'T'),
                confidence: 78,
                priority: 8
            });
        }
    }

    // 4. CAU 3-3
    if (n >= 12) {
        let last12 = results.slice(-12);
        let is33 = true;
        for (let i = 0; i < 12; i += 3) {
            if (last12[i] !== last12[i + 1] || last12[i] !== last12[i + 2]) { is33 = false; break; }
        }
        if (is33 && last12[0] !== last12[3]) {
            let phase = n % 3;
            caus.push({
                type: '3-3',
                name: 'Cầu 3-3',
                predict: phase === 0 ? (last12[11] === 'T' ? 'X' : 'T') : last12[11],
                confidence: 80,
                priority: 7
            });
        }
    }

    // 5. CAU 1-2-3
    if (n >= 6) {
        let last6 = results.slice(-6).join('');
        if (last6 === "TXXTTT") caus.push({ type: '1-2-3', name: 'Cầu 1-2-3', predict: 'X', confidence: 77, priority: 6 });
        if (last6 === "XTTXXX") caus.push({ type: '1-2-3', name: 'Cầu 1-2-3', predict: 'T', confidence: 77, priority: 6 });
    }

    // 6. CAU 3-2-1
    if (n >= 6) {
        let last6 = results.slice(-6).join('');
        if (last6 === "TTTXXT") caus.push({ type: '3-2-1', name: 'Cầu 3-2-1', predict: 'X', confidence: 76, priority: 6 });
        if (last6 === "XXXTTX") caus.push({ type: '3-2-1', name: 'Cầu 3-2-1', predict: 'T', confidence: 76, priority: 6 });
    }

    // 7. RONG
    let tRun = 0;
    for (let i = n - 1; i >= 0 && results[i] === 'T'; i--) tRun++;
    if (tRun >= 6) caus.push({ type: 'rong', name: 'Rồng ' + tRun, predict: 'X', confidence: 82, priority: 8 });
    else if (tRun >= 4) caus.push({ type: 'rong', name: 'Rồng ' + tRun, predict: 'T', confidence: 70, priority: 6 });

    // 8. HO
    let xRun = 0;
    for (let i = n - 1; i >= 0 && results[i] === 'X'; i--) xRun++;
    if (xRun >= 6) caus.push({ type: 'ho', name: 'Hổ ' + xRun, predict: 'T', confidence: 82, priority: 8 });
    else if (xRun >= 4) caus.push({ type: 'ho', name: 'Hổ ' + xRun, predict: 'X', confidence: 70, priority: 6 });

    // 9. ZIGZAG
    if (n >= 7) {
        let last7 = results.slice(-7);
        let switches = 0;
        for (let i = 1; i < 7; i++) if (last7[i] !== last7[i - 1]) switches++;
        if (switches >= 5) {
            caus.push({
                type: 'zigzag',
                name: 'Zigzag',
                predict: results[n - 1] === 'T' ? 'X' : 'T',
                confidence: 70 + switches,
                priority: 5
            });
        }
    }

    // 10. DOI XUNG
    if (n >= 10) {
        let mid = Math.floor(n / 2);
        let left = results.slice(0, mid);
        let right = results.slice(mid).reverse();
        let matches = 0;
        for (let i = 0; i < Math.min(left.length, right.length); i++) {
            if (left[i] === right[i]) matches++;
        }
        if (matches / Math.min(left.length, right.length) >= 0.7) {
            let mirrorPos = mid - (n - mid);
            if (mirrorPos >= 0 && mirrorPos < n) {
                caus.push({
                    type: 'doi_xung',
                    name: 'Đối Xứng',
                    predict: results[mirrorPos],
                    confidence: 65,
                    priority: 4
                });
            }
        }
    }

    // 11. PATTERN 8
    if (n >= 8) {
        let last8 = results.slice(-8).join('');
        let patternNext = {
            'TTTTXXXX': 'X', 'XXXXTTTT': 'T',
            'TXTXTXTX': 'T', 'XTXTXTXT': 'X',
            'TTXXTTXX': 'T', 'XXTTXXTT': 'X',
            'TXXTTXXT': 'X', 'XTTXXTTX': 'T'
        };
        if (patternNext[last8]) {
            caus.push({
                type: 'pattern_8',
                name: 'Mẫu 8 phiên',
                predict: patternNext[last8],
                confidence: 75,
                priority: 7
            });
        }
    }

    caus.sort((a, b) => (b.priority * 10 + b.confidence) - (a.priority * 10 + a.confidence));
    return caus;
}

// ======================================================
// DICE ANALYSIS
// ======================================================
function analyzeDice(history) {
    if (history.length < 5) return null;
    let last = history[history.length - 1];
    let d1 = last.x1, d2 = last.x2, d3 = last.x3;
    let sum = d1 + d2 + d3;
    let predictions = [];

    // Phan tich tong
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
        for (let s = 3; s <= 18; s++) {
            if ((sumAfter[s] || 0) > bestCount) { bestCount = sumAfter[s]; bestSum = s; }
        }
        predictions.push({
            predict: bestSum >= 11 ? 'Tài' : 'Xỉu',
            confidence: 50 + (bestCount / totalAfter) * 30,
            source: 'dice_sum'
        });
    }

    // Phan tich cap
    let p12 = d1 + '' + d2, p23 = d2 + '' + d3, p13 = d1 + '' + d3;
    let pairCount = 0, pairTai = 0;
    for (let i = 0; i < history.length - 1; i++) {
        let hd1 = history[i].x1, hd2 = history[i].x2, hd3 = history[i].x3;
        let hp12 = hd1 + '' + hd2, hp23 = hd2 + '' + hd3, hp13 = hd1 + '' + hd3;
        if (hp12 === p12 || hp23 === p23 || hp13 === p13) {
            pairCount++;
            if (i + 1 < history.length && history[i + 1].result === 'Tài') pairTai++;
        }
    }
    if (pairCount >= 5) {
        let prob = pairTai / pairCount;
        predictions.push({
            predict: prob > 0.5 ? 'Tài' : 'Xỉu',
            confidence: 50 + Math.abs(prob - 0.5) * 60,
            source: 'dice_pair'
        });
    }

    // Phan tich triple
    let triple = d1 + '' + d2 + '' + d3;
    let tripleCount = 0, tripleTai = 0;
    for (let i = 0; i < history.length - 1; i++) {
        let hd1 = history[i].x1, hd2 = history[i].x2, hd3 = history[i].x3;
        let ht = hd1 + '' + hd2 + '' + hd3;
        if (ht === triple) {
            tripleCount++;
            if (i + 1 < history.length && history[i + 1].result === 'Tài') tripleTai++;
        }
    }
    if (tripleCount >= 3) {
        let prob = tripleTai / tripleCount;
        predictions.push({
            predict: prob > 0.5 ? 'Tài' : 'Xỉu',
            confidence: 50 + Math.abs(prob - 0.5) * 70,
            source: 'dice_triple'
        });
    }

    return predictions.length > 0 ? predictions : null;
}

// ======================================================
// ANALYZE CAU DETAIL
// ======================================================
function analyzeCauDetail(history) {
    if (history.length < 10) return "[Đang thu thập dữ liệu...]";
    let last20 = history.slice(-20).map(h => h.ket_qua === "tài" ? "t" : "x");
    let last10 = last20.slice(-10);
    let patternStr = last20.join("");
    let cauTypes = [];

    // Tim cau tu detectAllCau
    let caus = detectAllCau(history);
    for (let cau of caus.slice(0, 3)) {
        cauTypes.push(cau.name);
    }

    if (cauTypes.length === 0) {
        let taiCount = last10.filter(r => r === 't').length;
        if (taiCount >= 7) cauTypes.push("Tài mạnh");
        else if (taiCount <= 3) cauTypes.push("Xỉu mạnh");
        else if (taiCount >= 6) cauTypes.push("Nghiêng Tài");
        else if (taiCount <= 4) cauTypes.push("Nghiêng Xỉu");
        else cauTypes.push("Cân bằng");
    }

    return "[Cầu " + cauTypes.join(', ') + "] - " + patternStr;
}

// ======================================================
// SUPER ENSEMBLE
// ======================================================
class SuperEnsemble {
    constructor() {
        this.markov = new MarkovEngine();
        this.freq = new FrequencyEngine();
        this.cycle = new CycleEngine();
        this.trend = new TrendEngine();
        this.streak = new StreakEngine();
        this.bayes = new BayesEngine();
        this.fib = new FibonacciEngine();
        this.tech = new TechnicalEngine();
        this.ml = new MachineLearningEngine();
        this.weights = {
            markov: 0.12, freq: 0.1, cycle: 0.06, trend: 0.1,
            streak: 0.1, bayes: 0.08, fib: 0.05, tech: 0.12, ml: 0.1,
            cau: 0.17
        };
    }

    predict(history, totals, dicePreds, caus) {
        if (history.length < 10) return null;
        const historyArray = history.map(r => r === "Tài" || r === "T" ? "T" : "X");
        const seq = historyArray.join('');
        let allPredictions = [];

        // Markov
        const markovPred = this.markov.predictMarkov(seq);
        if (markovPred) allPredictions.push({ pred: markovPred.prediction, weight: this.weights.markov, conf: markovPred.confidence / 100 });

        // Frequency
        const freqPred = this.freq.predictWeighted(historyArray);
        if (freqPred) allPredictions.push({ pred: freqPred.prediction, weight: this.weights.freq, conf: freqPred.confidence / 100 });

        // Cycle
        const cyclePred = this.cycle.predictCycle(seq);
        if (cyclePred) allPredictions.push({ pred: cyclePred.prediction, weight: this.weights.cycle, conf: cyclePred.confidence / 100 });

        // Trend
        const trendPred = this.trend.predictTrend(historyArray);
        if (trendPred) allPredictions.push({ pred: trendPred.prediction, weight: this.weights.trend, conf: trendPred.confidence / 100 });

        // Streak
        const streakPred = this.streak.predictStreak(historyArray);
        if (streakPred) allPredictions.push({ pred: streakPred.prediction, weight: this.weights.streak, conf: streakPred.confidence / 100 });

        // Bayes
        const bayesPred = this.bayes.predictBayes(historyArray);
        if (bayesPred) allPredictions.push({ pred: bayesPred.prediction, weight: this.weights.bayes, conf: bayesPred.confidence / 100 });

        // Fibonacci
        if (totals && totals.length >= 12) {
            const fibPred = this.fib.predictByTotal(totals);
            if (fibPred) allPredictions.push({ pred: fibPred.prediction, weight: this.weights.fib, conf: fibPred.confidence / 100 });
        }

        // Technical
        const rsi = this.tech.rsiPredict(historyArray);
        if (rsi) allPredictions.push({ pred: rsi, weight: 0.03, conf: 0.7 });

        const macd = this.tech.macdPredict(historyArray);
        if (macd) allPredictions.push({ pred: macd, weight: 0.03, conf: 0.68 });

        const bb = this.tech.bollingerPredict(historyArray);
        if (bb) allPredictions.push({ pred: bb, weight: 0.02, conf: 0.66 });

        // Machine Learning
        const knn = this.ml.knnPredict(historyArray);
        if (knn) allPredictions.push({ pred: knn, weight: 0.04, conf: 0.65 });

        const dt = this.ml.decisionTree(historyArray);
        if (dt) allPredictions.push({ pred: dt, weight: 0.04, conf: 0.67 });

        const mr = this.ml.meanReversion(historyArray);
        if (mr) allPredictions.push({ pred: mr, weight: 0.03, conf: 0.6 });

        // CAU predictions
        for (let cau of caus.slice(0, 3)) {
            let pred = cau.predict === 'T' ? 'T' : (cau.predict === 'X' ? 'X' : (cau.predict === 'Tài' ? 'T' : 'X'));
            allPredictions.push({ pred: pred, weight: this.weights.cau / 3, conf: cau.confidence / 100 });
        }

        // DICE predictions
        if (dicePreds) {
            for (let dp of dicePreds) {
                let pred = dp.predict === 'Tài' ? 'T' : 'X';
                allPredictions.push({ pred: pred, weight: 0.04, conf: dp.confidence / 100 });
            }
        }

        // Score-based
        let lastScore = totals[totals.length - 1];
        if (lastScore >= 15) allPredictions.push({ pred: 'X', weight: 0.05, conf: 0.65 });
        else if (lastScore <= 5) allPredictions.push({ pred: 'T', weight: 0.05, conf: 0.65 });

        // Streak dài
        let streak = 1;
        for (let i = historyArray.length - 2; i >= 0; i--) {
            if (historyArray[i] === historyArray[historyArray.length - 1]) streak++;
            else break;
        }
        if (streak >= 7) {
            allPredictions.push({
                pred: historyArray[historyArray.length - 1] === 'T' ? 'X' : 'T',
                weight: 0.1,
                conf: 0.7 + Math.min(0.2, (streak - 7) * 0.02)
            });
        }

        // ENSEMBLE
        let scoreT = 0, scoreX = 0, totalWeight = 0;
        for (const p of allPredictions) {
            const wc = p.weight * p.conf;
            if (p.pred === 'T') scoreT += wc;
            else if (p.pred === 'X') scoreX += wc;
            totalWeight += p.weight;
        }

        if (totalWeight === 0) return null;
        let finalPred = scoreT > scoreX ? "T" : "X";
        let confidence = Math.round((Math.max(scoreT, scoreX) / totalWeight) * 100);

        // Dieu chinh do tin cay theo cau
        if (caus.length >= 2 && caus[0].confidence >= 75) {
            confidence = Math.min(98, confidence + 5);
        }
        if (caus.length === 0) {
            confidence = Math.max(52, confidence - 5);
        }
        confidence = Math.max(52, Math.min(98, confidence));

        return { prediction: finalPred === "T" ? "Tài" : "Xỉu", confidence };
    }
}

// ======================================================
// MAIN PREDICTOR
// ======================================================
const ensemble = new SuperEnsemble();

function finalPredict(history) {
    if (history.length < 10) return { duDoan: "tài", doTinCay: 52 };

    const historyResults = history.map(h => h.result);
    const totals = history.map(h => h.tong);
    const caus = detectAllCau(history);
    const dicePreds = analyzeDice(history);

    let result = ensemble.predict(historyResults, totals, dicePreds, caus);

    if (!result) {
        let last20 = history.slice(-20).map(h => h.ket_qua === "tài" ? "t" : "x");
        let taiCount = last20.filter(r => r === 't').length;
        return {
            duDoan: taiCount >= 12 ? "xỉu" : taiCount <= 8 ? "tài" : "tài",
            doTinCay: 55
        };
    }

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

        console.log("JSON:", JSON.stringify(result, null, 2));
        res.json(result);

    } catch (err) {
        res.json({
            id: "AnhKhoidzai Sunwin",
            phien_truoc: 0, xuc_xac1: 0, xuc_xac2: 0, xuc_xac3: 0, tong: 0,
            ket_qua: "tài", pattern: "[Đang kết nối...]", phien_hien_tai: 0,
            du_doan: "tài", do_tin_cay: "52%"
        });
    }
});

app.listen(PORT, () => console.log("Server chạy tại port " + PORT));
