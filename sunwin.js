const express = require("express");
const axios = require("axios");

const app = express();

const PORT = process.env.PORT || 3000;

const API_URL = "https://sunlol-zv7x.onrender.com/data";

// ======================================================
// FORMAT DATA
// ======================================================

function normalizeData(data) {
    return data.map(item => {
        const tong =
            item.tong ||
            item.total ||
            (
                (item.xuc_xac_1 || item.x1 || 0) +
                (item.xuc_xac_2 || item.x2 || 0) +
                (item.xuc_xac_3 || item.x3 || 0)
            );

        return {
            phien:
                item.phien ||
                item.session ||
                item.id ||
                0,

            result:
                item.ket_qua ||
                item.result ||
                (tong >= 11 ? "Tài" : "Xỉu"),

            tong,

            dices: [
                item.xuc_xac_1 || item.x1 || 0,
                item.xuc_xac_2 || item.x2 || 0,
                item.xuc_xac_3 || item.x3 || 0
            ]
        };
    });
}

// =====================================================
// AI TÀI XỈU TỔNG HỢP - 50+ THUẬT TOÁN ĐỘC NHẤT
// =====================================================

// ==================== 1. MARKOV ====================

// 1.1 Markov đa bậc (3-5) kết hợp
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

// 1.2 Markov bậc 1
function markov1(history) {
    if (history.length < 2) return null;
    const last = history[history.length - 1];
    const trans = { T: { T: 0, X: 0 }, X: { T: 0, X: 0 } };
    for (let i = 0; i < history.length - 1; i++) {
        trans[history[i]][history[i + 1]]++;
    }
    if (trans[last].T > trans[last].X) return 'T';
    if (trans[last].X > trans[last].T) return 'X';
    return null;
}

// 1.3 Markov bậc 2
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

// 1.4 Markov bậc 3
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

// 1.5 Markov dự đoán từng viên xúc xắc (loại 1-2-3)
class MarkovXucXac123 {
    constructor(bac = 3) {
        this.bac = Math.min(4, Math.max(1, bac));
        this.transitions = new Map();
        this.history = [];
        this.maxHistory = 60;
    }

    static chuyenLoai(diem) {
        if (diem === 1 || diem === 2) return 1;
        if (diem === 3 || diem === 4) return 2;
        return 3;
    }

    themDuLieu(daySo) {
        const filtered = daySo.map(x => MarkovXucXac123.chuyenLoai(x));
        this.history.push(...filtered);
        if (this.history.length > this.maxHistory) {
            this.history = this.history.slice(-this.maxHistory);
        }
        this._xayDungMaTran();
    }

    _xayDungMaTran() {
        this.transitions.clear();
        const len = this.history.length;
        if (len < this.bac + 1) return;
        for (let i = this.bac; i < len; i++) {
            for (let b = 1; b <= this.bac; b++) {
                const state = [];
                for (let j = b - 1; j >= 0; j--) state.push(this.history[i - j]);
                const stateKey = state.join(',');
                const nextVal = this.history[i];
                if (!this.transitions.has(stateKey)) this.transitions.set(stateKey, new Map());
                const nextMap = this.transitions.get(stateKey);
                nextMap.set(nextVal, (nextMap.get(nextVal) || 0) + 1);
            }
        }
    }

    duDoan() {
        if (this.history.length < 2) return this._duDoanTheoXuatHuong();
        const states = this._layStateHienTai();
        const diem = { 1: 0, 2: 0, 3: 0 };
        let tongDiem = 0;
        for (let i = states.length - 1; i >= 0; i--) {
            const nextMap = this.transitions.get(states[i].key);
            if (nextMap && nextMap.size > 0) {
                const heSo = Math.pow(2, states[i].bac);
                for (let [val, count] of nextMap.entries()) {
                    diem[val] += count * heSo;
                    tongDiem += count * heSo;
                }
                break;
            }
        }
        if (tongDiem === 0) return this._duDoanTheoXuatHuong();
        let rand = Math.random() * tongDiem;
        let cum = 0;
        for (let val of [1, 2, 3]) {
            cum += diem[val];
            if (rand <= cum) return val;
        }
        return 2;
    }

    _duDoanTheoXuatHuong() {
        if (this.history.length === 0) return 2;
        const dem = { 1: 0, 2: 0, 3: 0 };
        this.history.forEach(v => dem[v]++);
        let maxVal = 2, maxCount = 0;
        for (let val of [1, 2, 3]) {
            if (dem[val] > maxCount) { maxCount = dem[val]; maxVal = val; }
        }
        return maxVal;
    }

    _layStateHienTai() {
        if (this.history.length < 1) return null;
        const results = [];
        for (let b = 1; b <= this.bac; b++) {
            if (this.history.length >= b) {
                const state = [];
                for (let j = b - 1; j >= 0; j--) state.push(this.history[this.history.length - 1 - j]);
                results.push({ bac: b, key: state.join(',') });
            }
        }
        return results;
    }

    phanTich() {
        const duDoanSo = this.duDoan();
        const prediction = (duDoanSo === 1 || duDoanSo === 3) ? "TÀI" : "XỈU";
        let confidence = 65;
        if (this.history.length > 30) confidence += 10;
        return { prediction, confidence: Math.min(95, confidence), duDoanSo };
    }
}

// ==================== 2. TẦN SUẤT ====================

// 2.1 Tần suất có trọng số mũ
function predictWeightedFrequency(history, window = 50) {
    const recent = history.slice(-window);
    let wTai = 0, wXiu = 0;
    for (let i = 0; i < recent.length; i++) {
        const w = Math.pow(0.93, recent.length - 1 - i);
        if (recent[i].result === "Tài") wTai += w;
        else wXiu += w;
    }
    if (wTai + wXiu === 0) return null;
    const probTai = wTai / (wTai + wXiu);
    const pred = probTai > 0.5 ? "Tài" : "Xỉu";
    const conf = Math.abs(probTai - 0.5) * 2 * 100;
    return { prediction: pred, confidence: Math.min(95, Math.max(50, conf)) };
}

// 2.2 Simple Majority
function simpleMajority(history, window = 15) {
    if (history.length < window) return null;
    const recent = history.slice(-window);
    const t = recent.filter(r => r === 'T').length;
    const x = window - t;
    if (t > x) return 'T';
    if (x > t) return 'X';
    return null;
}

// 2.3 Cumulative Imbalance
function cumulativeImbalance(history, window = 25) {
    if (history.length < window) return null;
    const recent = history.slice(-window);
    const imbalance = recent.filter(r => r === 'T').length - recent.filter(r => r === 'X').length;
    if (imbalance > 7) return 'X';
    if (imbalance < -7) return 'T';
    return null;
}

// ==================== 3. CHU KỲ ====================

// 3.1 Chu kỳ tìm kiếm linh hoạt
function predictCycle(seq, maxCycle = 20) {
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
                const pred = nextRes === "T" ? "Tài" : "Xỉu";
                let conf = 60 + Math.min(30, matches.length * 3);
                return { prediction: pred, confidence: conf };
            }
        }
    }
    return null;
}

// ==================== 4. XU HƯỚNG ====================

// 4.1 Xu hướng tổng hợp
function predictTrend(history) {
    if (history.length < 6) return null;
    const last6 = history.slice(-6).map(h => h.result);
    const last3 = last6.slice(-3);
    if (last3[0] === last3[1] && last3[1] === last3[2]) {
        return { prediction: last3[0] === "Tài" ? "Xỉu" : "Tài", confidence: 72 };
    }
    let alt = true;
    for (let i = 1; i < last6.length; i++) if (last6[i] === last6[i - 1]) alt = false;
    if (alt && last6.length >= 4) {
        return { prediction: last6[last6.length - 1] === "Tài" ? "Xỉu" : "Tài", confidence: 76 };
    }
    if (last6.length >= 5 && last6[0] === last6[1] && last6[2] === last6[3] && last6[1] !== last6[2]) {
        return { prediction: last6[3] === "Tài" ? "Xỉu" : "Tài", confidence: 68 };
    }
    const tai = last6.filter(r => r === "Tài").length;
    const xiu = 6 - tai;
    if (tai !== xiu) {
        const pred = tai > xiu ? "Tài" : "Xỉu";
        const conf = 55 + Math.abs(tai - xiu) * 3;
        return { prediction: pred, confidence: Math.min(75, conf) };
    }
    return null;
}

// 4.2 Moving Average Cross
function movingAverageCross(history, short = 5, long = 13) {
    if (history.length < long) return null;
    const shortT = history.slice(-short).filter(r => r === 'T').length / short;
    const longT = history.slice(-long).filter(r => r === 'T').length / long;
    if (shortT > longT + 0.12) return 'T';
    if (longT > shortT + 0.12) return 'X';
    return null;
}

// ==================== 5. STREAK (Bệt) ====================

// 5.1 Streak analysis
function predictStreak(history) {
    if (history.length < 5) return null;
    let streakLen = 1;
    for (let i = history.length - 2; i >= 0; i--) {
        if (history[i].result === history[history.length - 1].result) streakLen++;
        else break;
    }
    if (streakLen >= 3) {
        const pred = history[history.length - 1].result === "Tài" ? "Xỉu" : "Tài";
        let conf = 60 + Math.min(25, streakLen * 4);
        return { prediction: pred, confidence: Math.min(85, conf) };
    }
    if (streakLen <= 2) {
        const pred = history[history.length - 1].result;
        let conf = 55 + streakLen * 5;
        return { prediction: pred, confidence: Math.min(75, conf) };
    }
    return null;
}

// ==================== 6. BAYES ====================

// 6.1 Bayes với mẫu 3 phiên
function predictBayes(history) {
    if (history.length < 10) return null;
    const seq = history.map(h => h.result === "Tài" ? "T" : "X").join('');
    const last3 = seq.slice(-3);
    let taiCount = 0, xiuCount = 0;
    for (let i = 0; i <= seq.length - 4; i++) {
        const pattern = seq.slice(i, i + 3);
        if (pattern === last3) {
            const next = seq[i + 3];
            if (next === 'T') taiCount++;
            else xiuCount++;
        }
    }
    if (taiCount + xiuCount < 3) return null;
    const pred = taiCount > xiuCount ? "Tài" : "Xỉu";
    const conf = 55 + Math.min(30, Math.abs(taiCount - xiuCount) * 4);
    return { prediction: pred, confidence: Math.min(90, conf) };
}

// 6.2 Naive Bayes
function naiveBayes(history, window = 15) {
    if (history.length < window) return null;
    const p_t = history.filter(r => r === 'T').length / history.length;
    const p_x = 1 - p_t;
    const last5 = history.slice(-5);
    let cond_t = 0, cond_x = 0;
    let tCount = 0, xCount = 0;
    for (let i = 0; i < history.length - 5; i++) {
        if (history.slice(i, i + 5).join('') === last5.join('')) {
            const next = history[i + 5];
            if (next === 'T') { cond_t++; tCount++; }
            else { cond_x++; xCount++; }
        }
    }
    cond_t = cond_t / Math.max(1, tCount);
    cond_x = cond_x / Math.max(1, xCount);
    const post_t = p_t * cond_t;
    const post_x = p_x * cond_x;
    return post_t > post_x ? 'T' : 'X';
}

// ==================== 7. FIBONACCI ====================

// 7.1 Fibonacci dựa trên tổng điểm
function predictFibonacciByTotal(history) {
    if (history.length < 12) return null;
    const totals = history.slice(-12).map(h => h.tong);
    const diffs = [];
    for (let i = 1; i < totals.length; i++) diffs.push(totals[i] - totals[i - 1]);
    const avgDiff = diffs.reduce((a, b) => a + b, 0) / diffs.length;
    let nextTotal = totals[totals.length - 1] + avgDiff;
    nextTotal = Math.min(18, Math.max(3, Math.round(nextTotal)));
    const pred = nextTotal > 10 ? "Tài" : "Xỉu";
    const conf = 55 + Math.min(30, Math.abs(avgDiff) * 2.5);
    return { prediction: pred, confidence: Math.min(85, conf) };
}

// 7.2 Fibonacci Fractal
function fibonacciFractal(history) {
    const fibs = [1, 1, 2, 3, 5, 8, 13];
    let countMatch = 0;
    for (let f of fibs) {
        if (history.length > f && history[history.length - f] === history[history.length - 1]) countMatch++;
    }
    if (countMatch >= Math.floor(fibs.length / 2)) return history[history.length - 1];
    return history[history.length - 1] === 'T' ? 'X' : 'T';
}

// ==================== 8. PHÂN TÍCH CẶP XÚC XẮC ====================

// 8.1 Phân tích cặp
function predictPair(history) {
    if (history.length < 15) return null;
    const recent = history.slice(-15);
    const last = history[history.length - 1];
    const lastPairs = {
        p12: `${last.dices[0]},${last.dices[1]}`,
        p23: `${last.dices[1]},${last.dices[2]}`,
        p13: `${last.dices[0]},${last.dices[2]}`
    };
    let tai = 0, xiu = 0;
    for (const item of recent) {
        const p12 = `${item.dices[0]},${item.dices[1]}`;
        const p23 = `${item.dices[1]},${item.dices[2]}`;
        const p13 = `${item.dices[0]},${item.dices[2]}`;
        if (p12 === lastPairs.p12 || p23 === lastPairs.p23 || p13 === lastPairs.p13) {
            if (item.result === "Tài") tai++;
            else xiu++;
        }
    }
    if (tai + xiu < 4) return null;
    const pred = tai > xiu ? "Tài" : "Xỉu";
    const conf = 55 + Math.min(30, Math.abs(tai - xiu) * 2);
    return { prediction: pred, confidence: Math.min(85, conf) };
}

// ==================== 9. CHỈ BÁO KỸ THUẬT ====================

// 9.1 RSI
function rsiPredict(history, period = 7) {
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

// 9.2 Bollinger Bands
function bollingerPredict(history, period = 12) {
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

// 9.3 MACD
function macdPredict(history, short = 6, long = 13, signal = 4) {
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

// 9.4 Stochastic
function stochasticPredict(history, period = 7) {
    if (history.length < period) return null;
    const nums = history.slice(-period).map(c => c === 'T' ? 1 : 0);
    const highest = Math.max(...nums);
    const lowest = Math.min(...nums);
    if (highest === lowest) return null;
    const k = (nums[nums.length - 1] - lowest) / (highest - lowest) * 100;
    if (k > 80) return 'X';
    if (k < 20) return 'T';
    return null;
}

// 9.5 Williams %R
function williamsR(history, period = 7) {
    if (history.length < period) return null;
    const nums = history.slice(-period).map(c => c === 'T' ? 1 : 0);
    const highest = Math.max(...nums);
    const lowest = Math.min(...nums);
    if (highest === lowest) return null;
    const wr = (highest - nums[nums.length - 1]) / (highest - lowest) * -100;
    if (wr < -80) return 'T';
    if (wr > -20) return 'X';
    return null;
}

// 9.6 CCI
function cciPredict(history, period = 10) {
    if (history.length < period) return null;
    const nums = history.slice(-period).map(c => c === 'T' ? 1 : 0);
    const mean = nums.reduce((a, b) => a + b, 0) / period;
    const mad = nums.reduce((sum, x) => sum + Math.abs(x - mean), 0) / period;
    if (mad === 0) return null;
    const cci = (nums[nums.length - 1] - mean) / (0.015 * mad);
    if (cci > 100) return 'X';
    if (cci < -100) return 'T';
    return null;
}

// 9.7 Entropy
function entropyPrediction(history, window = 12) {
    if (history.length < window) return null;
    const recent = history.slice(-window);
    const p_t = recent.filter(r => r === 'T').length / window;
    if (p_t === 0 || p_t === 1) return recent[recent.length - 1];
    const entropy = -p_t * Math.log2(p_t) - (1 - p_t) * Math.log2(1 - p_t);
    if (entropy > 0.95) return recent[recent.length - 1] === 'T' ? 'X' : 'T';
    return recent[recent.length - 1];
}

// ==================== 10. MACHINE LEARNING ====================

// 10.1 Linear Regression
function linearRegression(history, window = 12) {
    if (history.length < window) return null;
    const y = history.slice(-window).map(c => c === 'T' ? 1 : 0);
    const x = Array.from({ length: window }, (_, i) => i);
    const n = window;
    const sumX = x.reduce((a, b) => a + b, 0);
    const sumY = y.reduce((a, b) => a + b, 0);
    const sumXY = x.reduce((sum, xi, i) => sum + xi * y[i], 0);
    const sumX2 = x.reduce((sum, xi) => sum + xi * xi, 0);
    const denom = n * sumX2 - sumX * sumX;
    if (denom === 0) return null;
    const slope = (n * sumXY - sumX * sumY) / denom;
    const intercept = (sumY - slope * sumX) / n;
    const pred = slope * window + intercept;
    return pred > 0.5 ? 'T' : 'X';
}

// 10.2 KNN
function knnPredict(history, k = 5, lookback = 10) {
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

// 10.3 Decision Tree
function decisionTree(history) {
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

// 10.4 Ensemble Voting
function ensembleVoting(history) {
    const algos = [markov3, simpleMajority, rsiPredict, meanReversion, patternMatching];
    const votes = [];
    for (let algo of algos) {
        const pred = algo(history);
        if (pred) votes.push(pred);
    }
    if (votes.length === 0) return null;
    const tCount = votes.filter(v => v === 'T').length;
    return tCount > votes.length - tCount ? 'T' : 'X';
}

// 10.5 Mean Reversion
function meanReversion(history, window = 12) {
    if (history.length < window) return null;
    const recent = history.slice(-window);
    const mean = recent.filter(r => r === 'T').length / window;
    if (mean > 0.75) return 'X';
    if (mean < 0.25) return 'T';
    return null;
}

// 10.6 Pattern Matching
function patternMatching(history, lookback = 25) {
    if (history.length < lookback) return null;
    const query = history.slice(-lookback);
    let bestMatch = -1, bestScore = -1;
    for (let i = 0; i < history.length - lookback; i++) {
        const segment = history.slice(i, i + lookback);
        let score = 0;
        for (let j = 0; j < lookback; j++) if (segment[j] === query[j]) score++;
        if (score > bestScore) {
            bestScore = score;
            bestMatch = i;
        }
    }
    if (bestMatch !== -1 && bestMatch + lookback < history.length) {
        return history[bestMatch + lookback];
    }
    return null;
}

// 10.7 Zigzag
function zigzagPredict(history) {
    if (history.length < 5) return null;
    let changes = 0;
    for (let i = 1; i < Math.min(5, history.length); i++) {
        if (history[history.length - i] !== history[history.length - i - 1]) changes++;
    }
    if (changes >= 4) return history[history.length - 1] === 'T' ? 'X' : 'T';
    if (changes >= 3) return history[history.length - 1];
    return null;
}

// ==================== 11. CÁC PATTERN CẦU ĐẶC BIỆT ====================

const PatternDetectors = {
    detect_1_1: (history) => {
        if (history.length >= 4 && history.slice(-4).join('') === "TXTX") return { pred: 'X', conf: 88, name: "Cầu 1-1" };
        if (history.length >= 4 && history.slice(-4).join('') === "XTXT") return { pred: 'T', conf: 88, name: "Cầu 1-1" };
        return null;
    },
    detect_2_2: (history) => {
        if (history.length >= 4 && history.slice(-4).join('') === "TTXX") return { pred: 'X', conf: 82, name: "Cầu 2-2" };
        if (history.length >= 4 && history.slice(-4).join('') === "XXTT") return { pred: 'T', conf: 82, name: "Cầu 2-2" };
        return null;
    },
    detect_3_3: (history) => {
        if (history.length >= 6 && history.slice(-6).join('') === "TTTXXX") return { pred: 'X', conf: 78, name: "Cầu 3-3" };
        if (history.length >= 6 && history.slice(-6).join('') === "XXXTTT") return { pred: 'T', conf: 78, name: "Cầu 3-3" };
        return null;
    },
    detect_1_2_3: (history) => {
        if (history.length >= 6 && history.slice(-6).join('') === "TXXTTT") return { pred: 'X', conf: 77, name: "Cầu 1-2-3" };
        if (history.length >= 6 && history.slice(-6).join('') === "XTTXXX") return { pred: 'T', conf: 77, name: "Cầu 1-2-3" };
        return null;
    },
    detect_triangle: (history) => {
        const last5 = history.slice(-5).join('');
        if (last5 === "TXTXT") return { pred: 'X', conf: 80, name: "Cầu tam giác" };
        if (last5 === "XTXTX") return { pred: 'T', conf: 80, name: "Cầu tam giác" };
        return null;
    },
    detect_zigzag: (history) => {
        if (history.length >= 5 && history.slice(-5).join('') === "TXTXT") return { pred: 'X', conf: 80, name: "Cầu Zigzag 5" };
        if (history.length >= 5 && history.slice(-5).join('') === "XTXTX") return { pred: 'T', conf: 80, name: "Cầu Zigzag 5" };
        if (history.length >= 7 && history.slice(-7).join('') === "TXTXTXT") return { pred: 'X', conf: 84, name: "Cầu Zigzag 7" };
        if (history.length >= 7 && history.slice(-7).join('') === "XTXTXTX") return { pred: 'T', conf: 84, name: "Cầu Zigzag 7" };
        return null;
    },
    detect_dragon: (history) => {
        let tRun = 0;
        for (let i = history.length - 1; i >= 0; i--) {
            if (history[i] === 'T') tRun++;
            else break;
        }
        if (tRun >= 6) return { pred: 'X', conf: 82, name: `Cầu Rồng ${tRun}` };
        if (tRun >= 4) return { pred: 'T', conf: 72, name: `Cầu Rồng ${tRun}` };
        return null;
    },
    detect_tiger: (history) => {
        let xRun = 0;
        for (let i = history.length - 1; i >= 0; i--) {
            if (history[i] === 'X') xRun++;
            else break;
        }
        if (xRun >= 6) return { pred: 'T', conf: 82, name: `Cầu Hổ ${xRun}` };
        if (xRun >= 4) return { pred: 'X', conf: 72, name: `Cầu Hổ ${xRun}` };
        return null;
    },
    detect_4_4: (history) => {
        if (history.length >= 8 && history.slice(-8).join('') === "TTTTXXXX") return { pred: 'X', conf: 79, name: "Cầu 4-4" };
        if (history.length >= 8 && history.slice(-8).join('') === "XXXXTTTT") return { pred: 'T', conf: 79, name: "Cầu 4-4" };
        return null;
    },
    detect_5_5: (history) => {
        if (history.length >= 10 && history.slice(-10).join('') === "TTTTTXXXXX") return { pred: 'X', conf: 77, name: "Cầu 5-5" };
        if (history.length >= 10 && history.slice(-10).join('') === "XXXXXTTTTT") return { pred: 'T', conf: 77, name: "Cầu 5-5" };
        return null;
    }
};

// ==================== 12. TÍN HIỆU BẺ CẦU ====================

const BreakSignalDetectors = [
    (history) => { const pred = rsiPredict(history, 7); return pred && pred !== history[history.length - 1]; },
    (history) => { const pred = bollingerPredict(history, 10); return pred && pred !== history[history.length - 1]; },
    (history) => { const pred = macdPredict(history, 5, 12, 3); return pred && pred !== history[history.length - 1]; },
    (history) => { const pred = stochasticPredict(history, 7); return pred && pred !== history[history.length - 1]; },
    (history) => { const pred = williamsR(history, 7); return pred && pred !== history[history.length - 1]; },
    (history) => { const pred = cciPredict(history, 10); return pred && pred !== history[history.length - 1]; },
    (history) => {
        if (history.length < 10) return false;
        const nums = history.slice(-10).map(c => c === 'T' ? 1 : 0);
        const priceTrend = nums[nums.length - 1] - nums[0];
        let rsiValues = [];
        for (let i = 7; i < nums.length; i++) {
            const sub = nums.slice(i - 6, i + 1);
            let gains = 0, losses = 0;
            for (let j = 1; j < sub.length; j++) {
                const diff = sub[j] - sub[j - 1];
                if (diff > 0) gains += diff;
                else losses -= diff;
            }
            const rsi = losses === 0 ? 100 : 100 - (100 / (1 + gains / losses));
            rsiValues.push(rsi);
        }
        if (rsiValues.length >= 2) {
            const rsiTrend = rsiValues[rsiValues.length - 1] - rsiValues[0];
            return (priceTrend > 0 && rsiTrend < 0) || (priceTrend < 0 && rsiTrend > 0);
        }
        return false;
    },
    (history) => {
        if (history.length < 10) return false;
        let changes = 0;
        for (let i = 1; i < Math.min(10, history.length); i++) {
            if (history[history.length - i] !== history[history.length - i - 1]) changes++;
        }
        return changes >= 7;
    }
];

function countBreakSignals(history) {
    let count = 0;
    for (let detector of BreakSignalDetectors) {
        if (detector(history)) count++;
    }
    return count;
}

// ==================== 13. KẾT HỢP TỔNG THỂ ====================

function getResultSequence(history) {
    return history.map(item => {
        const result = item.result || item;
        return (result === "Tài" || result === "T") ? "T" : "X";
    }).join('');
}

function combinedPredict(history) {
    const historyArray = history.map(item => item.result === "Tài" || item.result === "T" ? "T" : "X");

    // Nếu không đủ 10 phiên, dùng thuật toán nhẹ
    if (history.length < 10) {
        // Thử Markov bậc 1
        let pred = markov1(historyArray);
        if (pred) {
            return {
                prediction: pred === 'T' ? "TAI" : "XIU",
                confidence: 55,
                breakSignals: 0,
                totalAlgorithms: 1
            };
        }
        // Thử Majority với cửa sổ phù hợp
        pred = simpleMajority(historyArray, Math.min(historyArray.length, 15));
        if (pred) {
            return {
                prediction: pred === 'T' ? "TAI" : "XIU",
                confidence: 54,
                breakSignals: 0,
                totalAlgorithms: 1
            };
        }
        // Nếu không được thì dựa vào phiên cuối
        const last = historyArray[historyArray.length - 1];
        return {
            prediction: last === 'T' ? "TAI" : "XIU",
            confidence: 52,
            breakSignals: 0,
            totalAlgorithms: 1
        };
    }

    const seq = getResultSequence(history);

    const predictions = [];

    const markovResult = predictMarkov(seq);
    if (markovResult) predictions.push({ pred: markovResult.prediction === "Tài" ? "T" : "X", weight: 0.15, conf: markovResult.confidence / 100 });

    const freqResult = predictWeightedFrequency(history);
    if (freqResult) predictions.push({ pred: freqResult.prediction === "Tài" ? "T" : "X", weight: 0.15, conf: freqResult.confidence / 100 });

    const cycleResult = predictCycle(seq);
    if (cycleResult) predictions.push({ pred: cycleResult.prediction === "Tài" ? "T" : "X", weight: 0.12, conf: cycleResult.confidence / 100 });

    const trendResult = predictTrend(history);
    if (trendResult) predictions.push({ pred: trendResult.prediction === "Tài" ? "T" : "X", weight: 0.12, conf: trendResult.confidence / 100 });

    const fibResult = predictFibonacciByTotal(history);
    if (fibResult) predictions.push({ pred: fibResult.prediction === "Tài" ? "T" : "X", weight: 0.12, conf: fibResult.confidence / 100 });

    const pairResult = predictPair(history);
    if (pairResult) predictions.push({ pred: pairResult.prediction === "Tài" ? "T" : "X", weight: 0.12, conf: pairResult.confidence / 100 });

    const streakResult = predictStreak(history);
    if (streakResult) predictions.push({ pred: streakResult.prediction === "Tài" ? "T" : "X", weight: 0.11, conf: streakResult.confidence / 100 });

    const bayesResult = predictBayes(history);
    if (bayesResult) predictions.push({ pred: bayesResult.prediction === "Tài" ? "T" : "X", weight: 0.11, conf: bayesResult.confidence / 100 });

    for (const [name, detector] of Object.entries(PatternDetectors)) {
        const result = detector(historyArray);
        if (result) predictions.push({ pred: result.pred, weight: 0.08, conf: result.conf / 100, pattern: name });
    }

    const rsi = rsiPredict(historyArray);
    if (rsi) predictions.push({ pred: rsi, weight: 0.1, conf: 0.7 });

    const macd = macdPredict(historyArray);
    if (macd) predictions.push({ pred: macd, weight: 0.1, conf: 0.68 });

    const knn = knnPredict(historyArray);
    if (knn) predictions.push({ pred: knn, weight: 0.1, conf: 0.65 });

    const nb = naiveBayes(historyArray);
    if (nb) predictions.push({ pred: nb, weight: 0.1, conf: 0.66 });

    const dt = decisionTree(historyArray);
    if (dt) predictions.push({ pred: dt, weight: 0.1, conf: 0.67 });

    let scoreT = 0, scoreX = 0, totalWeight = 0;
    for (const p of predictions) {
        const weightedConf = p.weight * p.conf;
        if (p.pred === 'T') scoreT += weightedConf;
        else scoreX += weightedConf;
        totalWeight += p.weight;
    }

    const breakCount = countBreakSignals(historyArray);
    let finalPred = scoreT > scoreX ? "T" : "X";
    if (breakCount >= 3) {
        finalPred = finalPred === "T" ? "X" : "T";
    }

    let confidence = totalWeight > 0 ? Math.round((Math.max(scoreT, scoreX) / totalWeight) * 100) : 50;
    confidence = Math.min(96, Math.max(52, confidence + breakCount * 2));

    return {
        prediction: finalPred === "T" ? "TAI" : "XIU",
        confidence: confidence,
        breakSignals: breakCount,
        totalAlgorithms: predictions.length
    };
}

// ======================================================
// STATS
// ======================================================

function calculateStats(history) {
    const arr = history.map(h => h.result);
    let currentStreak = 1;
    const last = arr[arr.length - 1];
    for (let i = arr.length - 2; i >= 0; i--) {
        if (arr[i] === last) currentStreak++;
        else break;
    }
    return { currentStreak };
}

// ======================================================
// API
// ======================================================

app.get("/taixiu", async (req, res) => {
    try {
        const response = await axios.get(API_URL);
        const rawData = response.data;
        const dataArray = rawData.data || rawData;
        const history = normalizeData(Array.isArray(dataArray) ? dataArray : [dataArray]);

        let latest, predict;

        if (history.length === 0) {
            // Không có dữ liệu, trả về mặc định
            latest = { phien: 0, dices: [0, 0, 0], result: "Tài" };
            predict = { prediction: "TAI", confidence: 52 };
        } else {
            latest = history[history.length - 1];
            predict = combinedPredict(history);
        }

        res.json({
            id: "AnhKhoi",
            Phien_truoc: latest.phien,
            Xuc_xac: latest.dices.join(" "),
            Ket_qua: latest.result === "Tài" ? "TAI" : "XIU",
            Phien_nay: latest.phien + 1,
            Du_doan: predict.prediction,
            Do_tin_cay: predict.confidence
        });

    } catch (err) {
        console.log(err);
        res.json({
            id: "AnhKhoi",
            Phien_truoc: 0,
            Xuc_xac: "0 0 0",
            Ket_qua: "TAI",
            Phien_nay: 1,
            Du_doan: "TAI",
            Do_tin_cay: 52
        });
    }
});

// ======================================================
// Route gốc trả về JSON (không còn "SERVER ONLINE")
// ======================================================
app.get("/", async (req, res) => {
    try {
        const response = await axios.get(API_URL);
        const rawData = response.data;
        const dataArray = rawData.data || rawData;
        const history = normalizeData(Array.isArray(dataArray) ? dataArray : [dataArray]);

        let latest, predict;

        if (history.length === 0) {
            latest = { phien: 0, dices: [0, 0, 0], result: "Tài" };
            predict = { prediction: "TAI", confidence: 52 };
        } else {
            latest = history[history.length - 1];
            predict = combinedPredict(history);
        }

        const jsonData = {
            id: "AnhKhoi",
            Phien_truoc: latest.phien,
            Xuc_xac: latest.dices.join(" "),
            Ket_qua: latest.result === "Tài" ? "TAI" : "XIU",
            Phien_nay: latest.phien + 1,
            Du_doan: predict.prediction,
            Do_tin_cay: predict.confidence
        };

        console.log("JSON hiển thị ra link render:", JSON.stringify(jsonData, null, 2));
        res.json(jsonData);

    } catch (err) {
        console.log(err);
        res.json({
            id: "AnhKhoi",
            Phien_truoc: 0,
            Xuc_xac: "0 0 0",
            Ket_qua: "TAI",
            Phien_nay: 1,
            Du_doan: "TAI",
            Do_tin_cay: 52
        });
    }
});

// ======================================================

app.listen(PORT, () => {
    console.log("Server running:", PORT);
});
