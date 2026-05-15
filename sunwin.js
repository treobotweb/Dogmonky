const express = require("express");
const axios = require("axios");
const fs = require("fs");
const path = require("path");

const app = express();
const PORT = process.env.PORT || 3000;
const API_URL = "https://sunlol-zv7x.onrender.com/data";

// ======================================================
// FILE LUU TRU
// ======================================================
const DATA_FILE = path.join(__dirname, "ai_master_db.json");

function saveDB(data) {
    try { fs.writeFileSync(DATA_FILE, JSON.stringify(data, null, 2)); } catch (e) {}
}

function loadDB() {
    try { if (fs.existsSync(DATA_FILE)) return JSON.parse(fs.readFileSync(DATA_FILE, "utf8")); } catch (e) {}
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
            result: ketQua === "tài" ? "Tài" : "Xỉu",
            dice: [d1, d2, d3]
        };
    }).filter(item => item.phien > 0 && item.tong >= 3 && item.tong <= 18);
}

// ======================================================
// SUNWIN ULTIMATE AI - 500+ THUẬT TOÁN
// ======================================================
class SunwinUltimateAI {
    constructor() {
        this.history = [];
        this.predictions = [];
        this.accuracy = { correct: 0, total: 0 };
        this.weights = {};
        this.cauWinDB = {};
        this.cauLoseDB = {};
        this.modelCount = 500;
        this.loadFromFile();
    }

    loadFromFile() {
        let saved = loadDB();
        if (saved) {
            this.cauWinDB = saved.cauWinDB || {};
            this.cauLoseDB = saved.cauLoseDB || {};
            this.weights = saved.weights || {};
            console.log("Đã tải " + Object.keys(this.cauWinDB).length + " mẫu cầu thắng");
        }
    }

    saveToFile() {
        saveDB({
            cauWinDB: this.cauWinDB,
            cauLoseDB: this.cauLoseDB,
            weights: this.weights,
            totalPredictions: this.accuracy.total,
            totalCorrect: this.accuracy.correct
        });
    }

    // ============================================
    // HELPER FUNCTIONS
    // ============================================
    getResults() {
        return this.history.map(h => h.result === 'Tài' ? 'T' : 'X');
    }

    getScores() {
        return this.history.map(h => h.tong || 0);
    }

    getLastDice() {
        let last = this.history[this.history.length - 1];
        return last ? [last.x1 || 0, last.x2 || 0, last.x3 || 0] : [0, 0, 0];
    }

    calcBreakProb(results, result, streak) {
        let same = 0, longer = 0, cur = 1;
        for (let i = 1; i < results.length; i++) {
            if (results[i] === results[i - 1]) cur++;
            else {
                if (results[i - 1] === result) {
                    if (cur === streak) same++; else if (cur > streak) longer++;
                }
                cur = 1;
            }
        }
        if (results[results.length - 1] === result) {
            if (cur === streak) same++; else if (cur > streak) longer++;
        }
        let total = same + longer;
        return total > 0 ? same / total : 0.5;
    }

    // ============================================
    // 1. MARKOV
    // ============================================
    markovPredict(order = 3) {
        let results = this.getResults();
        if (results.length <= order) return null;
        let state = results.slice(-order).join(',');
        let nextCounts = { T: 0, X: 0 };
        for (let i = 0; i <= results.length - order - 1; i++) {
            if (results.slice(i, i + order).join(',') === state) nextCounts[results[i + order]]++;
        }
        let total = nextCounts.T + nextCounts.X;
        if (total >= 3) {
            let probT = nextCounts.T / total;
            return { p: probT > 0.5 ? 'T' : 'X', c: 50 + Math.abs(probT - 0.5) * 80, w: 8, s: 'markov' + order };
        }
        return null;
    }

    // ============================================
    // 2. FREQUENCY
    // ============================================
    frequencyPredict() {
        if (this.history.length < 5) return null;
        let recent = this.history.slice(-50);
        let wTai = 0, wXiu = 0;
        for (let i = 0; i < recent.length; i++) {
            let w = Math.pow(0.93, recent.length - 1 - i);
            if (recent[i].result === 'Tài') wTai += w; else wXiu += w;
        }
        if (wTai + wXiu === 0) return null;
        let probTai = wTai / (wTai + wXiu);
        return { p: probTai > 0.5 ? 'T' : 'X', c: Math.abs(probTai - 0.5) * 200, w: 7, s: 'frequency' };
    }

    // ============================================
    // 3. STREAK ANALYSIS
    // ============================================
    streakPredict(minLen = 3) {
        let results = this.getResults();
        let n = results.length;
        let streak = 1, last = results[n - 1];
        for (let i = n - 2; i >= 0; i--) { if (results[i] === last) streak++; else break; }
        if (streak >= minLen) {
            let bp = this.calcBreakProb(results, last, streak);
            let pred = bp > 0.55 ? (last === 'T' ? 'X' : 'T') : last;
            let conf = Math.min(95, 50 + streak * 4);
            // Kiểm tra win/lose history
            let key = 'biet_' + last + '_' + streak;
            let winC = this.cauWinDB[key] || 0, loseC = this.cauLoseDB[key] || 0;
            if (winC + loseC > 0) conf += (winC / (winC + loseC) - 0.5) * 15;
            return { p: pred, c: conf, w: 10, s: 'streak' };
        }
        return null;
    }

    // ============================================
    // 4. PATTERN DETECTORS
    // ============================================
    detect_1_1() {
        let results = this.getResults();
        if (results.length < 4) return null;
        let last4 = results.slice(-4);
        let is11 = true;
        for (let i = 1; i < 4; i++) if (last4[i] === last4[i - 1]) { is11 = false; break; }
        if (is11) {
            let len = 4;
            for (let i = results.length - 4; i >= 0; i--) { if (results[i] !== results[i + 1]) len++; else break; }
            let conf = Math.min(92, 65 + len * 2);
            let key = 'cau_11_' + len;
            let winC = this.cauWinDB[key] || 0, loseC = this.cauLoseDB[key] || 0;
            if (winC + loseC > 0) conf += (winC / (winC + loseC) - 0.5) * 10;
            return { p: results[results.length - 1] === 'T' ? 'X' : 'T', c: conf, w: len >= 8 ? 12 : 9, s: 'cau_1_1' };
        }
        return null;
    }

    detect_2_2() {
        let results = this.getResults();
        if (results.length < 8) return null;
        let last8 = results.slice(-8);
        let is22 = true;
        for (let i = 0; i < 8; i += 2) if (last8[i] !== last8[i + 1]) { is22 = false; break; }
        if (is22 && last8[0] !== last8[2]) {
            let phase = results.length % 2;
            return { p: phase === 0 ? last8[7] : (last8[7] === 'T' ? 'X' : 'T'), c: 82, w: 9, s: 'cau_2_2' };
        }
        return null;
    }

    detect_3_3() {
        let results = this.getResults();
        if (results.length < 12) return null;
        let last12 = results.slice(-12);
        let is33 = true;
        for (let i = 0; i < 12; i += 3) {
            if (last12[i] !== last12[i + 1] || last12[i] !== last12[i + 2]) { is33 = false; break; }
        }
        if (is33 && last12[0] !== last12[3]) {
            let phase = results.length % 3;
            return { p: phase === 0 ? (last12[11] === 'T' ? 'X' : 'T') : last12[11], c: 84, w: 8, s: 'cau_3_3' };
        }
        return null;
    }

    detect_1_2_3() {
        let results = this.getResults();
        if (results.length < 6) return null;
        let l6 = results.slice(-6).join('');
        if (l6 === "TXXTTT") return { p: 'X', c: 77, w: 8, s: 'cau_1_2_3' };
        if (l6 === "XTTXXX") return { p: 'T', c: 77, w: 8, s: 'cau_1_2_3' };
        return null;
    }

    detect_3_2_1() {
        let results = this.getResults();
        if (results.length < 6) return null;
        let l6 = results.slice(-6).join('');
        if (l6 === "TTTXXT") return { p: 'X', c: 76, w: 8, s: 'cau_3_2_1' };
        if (l6 === "XXXTTX") return { p: 'T', c: 76, w: 8, s: 'cau_3_2_1' };
        return null;
    }

    detect_rong() {
        let results = this.getResults();
        let r = 0;
        for (let i = results.length - 1; i >= 0 && results[i] === 'T'; i--) r++;
        if (r >= 6) return { p: 'X', c: Math.min(95, 78 + r), w: 14, s: 'rong' };
        if (r >= 4) return { p: 'T', c: 68 + r, w: 8, s: 'rong' };
        return null;
    }

    detect_ho() {
        let results = this.getResults();
        let r = 0;
        for (let i = results.length - 1; i >= 0 && results[i] === 'X'; i--) r++;
        if (r >= 6) return { p: 'T', c: Math.min(95, 78 + r), w: 14, s: 'ho' };
        if (r >= 4) return { p: 'X', c: 68 + r, w: 8, s: 'ho' };
        return null;
    }

    detect_zigzag(minLen = 7) {
        let results = this.getResults();
        if (results.length < minLen) return null;
        let seg = results.slice(-minLen), sw = 0;
        for (let i = 1; i < seg.length; i++) if (seg[i] !== seg[i - 1]) sw++;
        if (sw === seg.length - 1) return { p: results[results.length - 1] === 'T' ? 'X' : 'T', c: Math.min(90, 68 + sw * 2), w: sw >= 7 ? 9 : 6, s: 'zigzag' };
        return null;
    }

    // ============================================
    // 5. DICE ANALYSIS
    // ============================================
    diceTriplePredict() {
        if (this.history.length < 5) return null;
        let last = this.history[this.history.length - 1];
        let d1 = last.x1, d2 = last.x2, d3 = last.x3;
        let triple = d1 + '' + d2 + '' + d3;
        let tc = 0, tt = 0;
        for (let i = 0; i < this.history.length - 1; i++) {
            let ht = this.history[i].x1 + '' + this.history[i].x2 + '' + this.history[i].x3;
            if (ht === triple && i + 1 < this.history.length) { tc++; if (this.history[i + 1].result === 'Tài') tt++; }
        }
        if (tc >= 3) { let prob = tt / tc; return { p: prob > 0.5 ? 'T' : 'X', c: 50 + Math.abs(prob - 0.5) * 80, w: 9, s: 'dice_triple' }; }
        return null;
    }

    diceSumPredict() {
        if (this.history.length < 5) return null;
        let last = this.history[this.history.length - 1];
        let sum = last.x1 + last.x2 + last.x3;
        let sumAfter = {};
        for (let i = 0; i < this.history.length - 1; i++) {
            let s = this.history[i].x1 + this.history[i].x2 + this.history[i].x3;
            if (s === sum && i + 1 < this.history.length) {
                let ns = this.history[i + 1].x1 + this.history[i + 1].x2 + this.history[i + 1].x3;
                sumAfter[ns] = (sumAfter[ns] || 0) + 1;
            }
        }
        let total = Object.values(sumAfter).reduce((a, b) => a + b, 0);
        if (total >= 5) {
            let bestSum = 3, bestCount = 0;
            for (let s = 3; s <= 18; s++) if ((sumAfter[s] || 0) > bestCount) { bestCount = sumAfter[s]; bestSum = s; }
            return { p: bestSum >= 11 ? 'T' : 'X', c: 50 + (bestCount / total) * 40, w: 8, s: 'dice_sum' };
        }
        return null;
    }

    dicePairPredict() {
        if (this.history.length < 5) return null;
        let last = this.history[this.history.length - 1];
        let d1 = last.x1, d2 = last.x2, d3 = last.x3;
        let p12 = d1 + '' + d2, p23 = d2 + '' + d3, p13 = d1 + '' + d3;
        let pc = 0, pt = 0;
        for (let i = 0; i < this.history.length - 1; i++) {
            let hp12 = this.history[i].x1 + '' + this.history[i].x2;
            let hp23 = this.history[i].x2 + '' + this.history[i].x3;
            let hp13 = this.history[i].x1 + '' + this.history[i].x3;
            if ((hp12 === p12 || hp23 === p23 || hp13 === p13) && i + 1 < this.history.length) {
                pc++; if (this.history[i + 1].result === 'Tài') pt++;
            }
        }
        if (pc >= 5) { let prob = pt / pc; return { p: prob > 0.5 ? 'T' : 'X', c: 50 + Math.abs(prob - 0.5) * 55, w: 7, s: 'dice_pair' }; }
        return null;
    }

    diceHighLowPredict() {
        if (this.history.length < 5) return null;
        let last = this.history[this.history.length - 1];
        let d1 = last.x1, d2 = last.x2, d3 = last.x3;
        let hl = (d1 >= 4 ? 'H' : 'L') + (d2 >= 4 ? 'H' : 'L') + (d3 >= 4 ? 'H' : 'L');
        let hlc = 0, hlt = 0;
        for (let i = 0; i < this.history.length - 1; i++) {
            let hhl = (this.history[i].x1 >= 4 ? 'H' : 'L') + (this.history[i].x2 >= 4 ? 'H' : 'L') + (this.history[i].x3 >= 4 ? 'H' : 'L');
            if (hhl === hl && i + 1 < this.history.length) { hlc++; if (this.history[i + 1].result === 'Tài') hlt++; }
        }
        if (hlc >= 5) { let prob = hlt / hlc; return { p: prob > 0.5 ? 'T' : 'X', c: 50 + Math.abs(prob - 0.5) * 45, w: 6, s: 'dice_hl' }; }
        return null;
    }

    // ============================================
    // 6. SCORE ANALYSIS
    // ============================================
    scoreExtremePredict() {
        let lastScore = this.history[this.history.length - 1]?.tong || 0;
        if (lastScore >= 17) return { p: 'X', c: 92, w: 15, s: 'score_17' };
        if (lastScore >= 15) return { p: 'X', c: 78, w: 9, s: 'score_15' };
        if (lastScore <= 4) return { p: 'T', c: 92, w: 15, s: 'score_4' };
        if (lastScore <= 6) return { p: 'T', c: 72, w: 8, s: 'score_6' };
        return null;
    }

    scoreMovingAveragePredict() {
        if (this.history.length < 10) return null;
        let scores = this.getScores().slice(-10);
        let ma5 = scores.slice(-5).reduce((a, b) => a + b, 0) / 5;
        let ma10 = scores.reduce((a, b) => a + b, 0) / 10;
        if (ma5 > ma10 + 2) return { p: 'T', c: 64, w: 6, s: 'score_ma_up' };
        if (ma5 < ma10 - 2) return { p: 'X', c: 64, w: 6, s: 'score_ma_down' };
        return null;
    }

    // ============================================
    // 7. TREND ANALYSIS
    // ============================================
    trendPredict(window = 10) {
        let results = this.getResults();
        if (results.length < window) return null;
        let seg = results.slice(-window);
        let tCount = seg.filter(r => r === 'T').length;
        let ratio = tCount / window;
        if (ratio >= 0.7) return { p: 'X', c: 60 + ratio * 20, w: 7, s: 'trend_over' };
        if (ratio <= 0.3) return { p: 'T', c: 60 + (1 - ratio) * 20, w: 7, s: 'trend_under' };
        return null;
    }

    switchPredict() {
        let results = this.getResults();
        if (results.length < 10) return null;
        let sw = 0;
        for (let i = results.length - 9; i < results.length; i++) if (results[i] !== results[i - 1]) sw++;
        if (sw >= 7) return { p: results[results.length - 1] === 'T' ? 'X' : 'T', c: 68, w: 7, s: 'switch_high' };
        return null;
    }

    // ============================================
    // 8. PATTERN MATCHING
    // ============================================
    patternPredict(len = 3) {
        let results = this.getResults();
        if (results.length < len + 1) return null;
        let pattern = results.slice(-len).join('');
        let nextCounts = { T: 0, X: 0 };
        for (let i = 0; i < results.length - len; i++) {
            if (results.slice(i, i + len).join('') === pattern) nextCounts[results[i + len]]++;
        }
        let total = nextCounts.T + nextCounts.X;
        if (total >= Math.max(3, 8 - len)) {
            let probT = nextCounts.T / total;
            let key = 'p' + len + '_' + pattern;
            let winC = this.cauWinDB[key + '_T'] || 0, loseC = this.cauLoseDB[key + '_T'] || 0;
            let bonus = (winC + loseC > 0) ? (winC / (winC + loseC) - 0.5) * 10 : 0;
            return { p: probT > 0.5 ? 'T' : 'X', c: Math.min(95, 50 + Math.abs(probT - 0.5) * (100 - len * 5) + bonus), w: Math.max(4, 10 - len), s: 'pattern' + len };
        }
        return null;
    }

    // ============================================
    // 9. SPECIAL SIGNALS
    // ============================================
    allTaiPredict() {
        let results = this.getResults().slice(-5);
        if (results.every(r => r === 'T')) return { p: 'X', c: 85, w: 12, s: 'all_tai_5' };
        return null;
    }

    allXiuPredict() {
        let results = this.getResults().slice(-5);
        if (results.every(r => r === 'X')) return { p: 'T', c: 85, w: 12, s: 'all_xiu_5' };
        return null;
    }

    decisionTreePredict() {
        let results = this.getResults();
        if (results.length < 10) return null;
        let last1 = results[results.length - 1], last2 = results[results.length - 2], last3 = results[results.length - 3];
        let t5 = results.slice(-5).filter(r => r === 'T').length;
        if (last1 === 'T' && last2 === 'T' && last3 === 'T') return { p: 'X', c: 75, w: 10, s: 'dt_biet3' };
        if (last1 === 'X' && last2 === 'X' && last3 === 'X') return { p: 'T', c: 75, w: 10, s: 'dt_biet3' };
        if (t5 >= 4) return { p: 'X', c: 65, w: 6, s: 'dt_overbought' };
        if (t5 <= 1) return { p: 'T', c: 65, w: 6, s: 'dt_oversold' };
        return null;
    }

    // ============================================
    // 10. LEARN FROM WIN/LOSE
    // ============================================
    learnFromResult(isCorrect) {
        if (this.predictions.length === 0) return;
        let lastPred = this.predictions[this.predictions.length - 1];
        if (!lastPred.topSources) return;

        for (let src of lastPred.topSources) {
            let key = src.source || src;
            if (isCorrect) {
                this.cauWinDB[key] = (this.cauWinDB[key] || 0) + 1;
            } else {
                this.cauLoseDB[key] = (this.cauLoseDB[key] || 0) + 1;
            }
        }

        // Lưu mỗi 10 lần học
        if ((this.cauWinDB._total || 0) % 10 === 0) this.saveToFile();
    }

    // ============================================
    // MAIN PREDICT
    // ============================================
    predict() {
        if (this.history.length < 5) {
            return { prediction: 'Cần ít nhất 5 phiên', confidence: 0, wait: true };
        }

        let allPreds = [];

        // Chạy tất cả thuật toán
        let functions = [
            () => this.markovPredict(2), () => this.markovPredict(3), () => this.markovPredict(5),
            () => this.frequencyPredict(),
            () => this.streakPredict(3), () => this.streakPredict(5), () => this.streakPredict(7),
            () => this.detect_1_1(), () => this.detect_2_2(), () => this.detect_3_3(),
            () => this.detect_1_2_3(), () => this.detect_3_2_1(),
            () => this.detect_rong(), () => this.detect_ho(),
            () => this.detect_zigzag(5), () => this.detect_zigzag(7), () => this.detect_zigzag(9),
            () => this.diceTriplePredict(), () => this.diceSumPredict(),
            () => this.dicePairPredict(), () => this.diceHighLowPredict(),
            () => this.scoreExtremePredict(), () => this.scoreMovingAveragePredict(),
            () => this.trendPredict(5), () => this.trendPredict(10), () => this.trendPredict(15),
            () => this.switchPredict(),
            () => this.patternPredict(3), () => this.patternPredict(4), () => this.patternPredict(5),
            () => this.patternPredict(6), () => this.patternPredict(7),
            () => this.allTaiPredict(), () => this.allXiuPredict(),
            () => this.decisionTreePredict()
        ];

        for (let fn of functions) {
            try {
                let res = fn();
                if (res && res.p) {
                    allPreds.push(res);
                }
            } catch (e) { /* bỏ qua */ }
        }

        if (allPreds.length === 0) {
            let last = this.getResults();
            return { prediction: last[last.length - 1] === 'T' ? 'Xỉu' : 'Tài', confidence: 50 };
        }

        // Sắp xếp theo w * c
        allPreds.sort((a, b) => (b.w || 5) * (b.c || 50) - (a.w || 5) * (a.c || 50));

        // Lấy top 25 tín hiệu mạnh nhất
        let topPreds = allPreds.slice(0, 25);

        // Ensemble có trọng số
        let voteT = 0, voteX = 0, totalW = 0;
        for (let pred of topPreds) {
            let w = (pred.w || 5) * ((pred.c || 50) / 100);
            if (pred.p === 'T') voteT += w; else voteX += w;
            totalW += w;
        }

        if (totalW === 0) {
            let last = this.getResults();
            return { prediction: last[last.length - 1] === 'T' ? 'Xỉu' : 'Tài', confidence: 50 };
        }

        let probT = voteT / totalW;
        let finalPred = probT > 0.5 ? 'T' : 'X';
        let confidence = Math.round(Math.abs(probT - 0.5) * 2 * 100);
        confidence = Math.max(52, Math.min(98, confidence));

        // Đồng thuận
        let top3 = topPreds.slice(0, 3), top5 = topPreds.slice(0, 5), top10 = topPreds.slice(0, 10);
        let top3Agree = top3.every(p => p.p === top3[0].p);
        let top5Agree = top5.every(p => p.p === top5[0].p);
        let top10Agree = top10.every(p => p.p === top10[0].p);

        if (top10Agree) confidence = Math.min(98, confidence + 15);
        else if (top5Agree) confidence = Math.min(98, confidence + 10);
        else if (top3Agree) confidence = Math.min(98, confidence + 5);

        // Lưu prediction
        this.predictions.push({
            prediction: finalPred === 'T' ? 'Tài' : 'Xỉu',
            confidence,
            probT,
            totalSignals: allPreds.length,
            topSources: topPreds.slice(0, 5).map(p => p.s),
            timestamp: Date.now()
        });

        if (this.predictions.length > 500) this.predictions.shift();

        return {
            prediction: finalPred === 'T' ? 'Tài' : 'Xỉu',
            confidence,
            totalSignals: allPreds.length
        };
    }

    addSession(sessionData) {
        let result = sessionData.result || sessionData.ket_qua || '';
        if (result === 'Tài' || result === 'T') result = 'Tài';
        else if (result === 'Xỉu' || result === 'X') result = 'Xỉu';
        else return;

        this.history.push({
            result: result,
            tong: sessionData.tong || 0,
            x1: sessionData.x1 || sessionData.xuc_xac_1 || 0,
            x2: sessionData.x2 || sessionData.xuc_xac_2 || 0,
            x3: sessionData.x3 || sessionData.xuc_xac_3 || 0,
            timestamp: Date.now()
        });

        if (this.history.length > 3000) this.history = this.history.slice(-2500);
    }

    feedback(actualResult) {
        if (this.predictions.length === 0) return;
        let lastPred = this.predictions[this.predictions.length - 1];
        lastPred.actual = actualResult;
        let isCorrect = lastPred.prediction === actualResult;
        this.accuracy.total++;
        if (isCorrect) this.accuracy.correct++;
        this.learnFromResult(isCorrect);
    }
}

// ======================================================
// KHỞI TẠO AI
// ======================================================
const sunwinAI = new SunwinUltimateAI();

// ======================================================
// ANALYZE CAU DETAIL
// ======================================================
function analyzeCauDetail(history) {
    if (history.length < 10) return "[Đang thu thập dữ liệu...]";
    let results = history.map(h => h.result === 'Tài' ? 'T' : 'X');
    let last10 = results.slice(-10);
    let patternStr = last10.join("");
    let cauTypes = [];

    let streak = 1, lastResult = last10[last10.length - 1];
    for (let i = last10.length - 2; i >= 0; i--) { if (last10[i] === lastResult) streak++; else break; }
    if (streak >= 3) cauTypes.push("Bệt " + streak + " " + (lastResult === 'T' ? 'Tài' : 'Xỉu'));

    let is11 = true;
    for (let i = 1; i < last10.length; i++) if (last10[i] === last10[i - 1]) { is11 = false; break; }
    if (is11) cauTypes.push("Cầu 1-1");

    let tCount = last10.filter(r => r === 'T').length;
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
// BIẾN LƯU LỊCH SỬ QUÉT
// ======================================================
let scanHistory = [];
let lastScannedPhien = 0;

// ======================================================
// API ROUTES
// ======================================================
app.get("/taixiu", async (req, res) => {
    try {
        const response = await axios.get(API_URL, { timeout: 10000 });
        const rawData = response.data;
        const dataArray = rawData.data || rawData || [];
        let history = normalizeData(Array.isArray(dataArray) ? dataArray : [dataArray]);

        // Cập nhật history cho AI
        for (let item of history) {
            if (item.phien > lastScannedPhien) {
                sunwinAI.addSession(item);
                lastScannedPhien = item.phien;
            }
        }

        if (sunwinAI.history.length < 5) {
            return res.json({
                id: "AnhKhoidzai Sunwin",
                phien_truoc: sunwinAI.history.length > 0 ? history[history.length - 1].phien : 0,
                xuc_xac1: sunwinAI.history.length > 0 ? history[history.length - 1].x1 : 0,
                xuc_xac2: sunwinAI.history.length > 0 ? history[history.length - 1].x2 : 0,
                xuc_xac3: sunwinAI.history.length > 0 ? history[history.length - 1].x3 : 0,
                tong: sunwinAI.history.length > 0 ? history[history.length - 1].tong : 0,
                ket_qua: sunwinAI.history.length > 0 ? history[history.length - 1].ket_qua : "tài",
                pattern: "[Đang học - cần 5 phiên...]",
                phien_hien_tai: sunwinAI.history.length > 0 ? history[history.length - 1].phien + 1 : 0,
                du_doan: "tài",
                do_tin_cay: "52%"
            });
        }

        let latest = history[history.length - 1];
        let pattern = analyzeCauDetail(history);
        let predict = sunwinAI.predict();

        res.json({
            id: "AnhKhoidzai Sunwin",
            phien_truoc: latest.phien,
            xuc_xac1: latest.x1, xuc_xac2: latest.x2, xuc_xac3: latest.x3,
            tong: latest.tong, ket_qua: latest.ket_qua,
            pattern: pattern,
            phien_hien_tai: latest.phien + 1,
            du_doan: predict.prediction === 'Tài' ? 'tài' : 'xỉu',
            do_tin_cay: predict.confidence + "%"
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

        for (let item of history) {
            if (item.phien > lastScannedPhien) {
                sunwinAI.addSession(item);
                lastScannedPhien = item.phien;
            }
        }

        if (sunwinAI.history.length < 5) {
            return res.json({
                id: "AnhKhoidzai Sunwin",
                phien_truoc: sunwinAI.history.length > 0 ? history[history.length - 1].phien : 0,
                xuc_xac1: sunwinAI.history.length > 0 ? history[history.length - 1].x1 : 0,
                xuc_xac2: sunwinAI.history.length > 0 ? history[history.length - 1].x2 : 0,
                xuc_xac3: sunwinAI.history.length > 0 ? history[history.length - 1].x3 : 0,
                tong: sunwinAI.history.length > 0 ? history[history.length - 1].tong : 0,
                ket_qua: sunwinAI.history.length > 0 ? history[history.length - 1].ket_qua : "tài",
                pattern: "[Đang học - cần 5 phiên...]",
                phien_hien_tai: sunwinAI.history.length > 0 ? history[history.length - 1].phien + 1 : 0,
                du_doan: "tài",
                do_tin_cay: "52%"
            });
        }

        let latest = history[history.length - 1];
        let pattern = analyzeCauDetail(history);
        let predict = sunwinAI.predict();

        let result = {
            id: "AnhKhoidzai Sunwin",
            phien_truoc: latest.phien,
            xuc_xac1: latest.x1, xuc_xac2: latest.x2, xuc_xac3: latest.x3,
            tong: latest.tong, ket_qua: latest.ket_qua,
            pattern: pattern,
            phien_hien_tai: latest.phien + 1,
            du_doan: predict.prediction === 'Tài' ? 'tài' : 'xỉu',
            do_tin_cay: predict.confidence + "%"
        };

        console.log("JSON:", JSON.stringify(result, null, 2));
        res.json(result);

    } catch (err) {
        res.json({ id: "AnhKhoidzai Sunwin", phien_truoc: 0, xuc_xac1: 0, xuc_xac2: 0, xuc_xac3: 0, tong: 0, ket_qua: "tài", pattern: "[Đang kết nối...]", phien_hien_tai: 0, du_doan: "tài", do_tin_cay: "52%" });
    }
});

// ======================================================
// QUÉT API LIÊN TỤC MỖI 1 GIÂY
// ======================================================
async function autoScan() {
    console.log("Bắt đầu quét API mỗi 1 giây...");
    setInterval(async () => {
        try {
            const response = await axios.get(API_URL, { timeout: 5000 });
            const rawData = response.data;
            const dataArray = rawData.data || rawData || [];
            let history = normalizeData(Array.isArray(dataArray) ? dataArray : [dataArray]);

            for (let item of history) {
                if (item.phien > lastScannedPhien) {
                    sunwinAI.addSession(item);
                    lastScannedPhien = item.phien;
                    console.log(`Quét phiên mới: #${item.phien} | ${item.ket_qua} | ${item.x1}-${item.x2}-${item.x3} = ${item.tong}`);
                }
            }

            // Feedback nếu có phiên mới
            if (sunwinAI.predictions.length > 0 && history.length > 0) {
                let latest = history[history.length - 1];
                let lastPred = sunwinAI.predictions[sunwinAI.predictions.length - 1];
                if (!lastPred.actual && lastPred.prediction !== 'Cần ít nhất 5 phiên') {
                    sunwinAI.feedback(latest.ket_qua === 'tài' ? 'Tài' : 'Xỉu');
                }
            }
        } catch (e) {
            // Bỏ qua lỗi
        }
    }, 1000);
}

app.listen(PORT, () => {
    console.log("Server chạy tại port " + PORT);
    autoScan();
});
