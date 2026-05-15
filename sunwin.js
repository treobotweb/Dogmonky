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
const DATA_FILE = path.join(__dirname, "cau_master_db.json");
const LOG_FILE = path.join(__dirname, "prediction_master_log.json");

function saveData(data, file) {
    try { fs.writeFileSync(file, JSON.stringify(data, null, 2)); } catch (e) {}
}

function loadData(file) {
    try { if (fs.existsSync(file)) return JSON.parse(fs.readFileSync(file, "utf8")); } catch (e) {}
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
// HE THONG HOC & LUU TRU VINH VIEN
// ======================================================
class MasterLearningSystem {
    constructor() {
        this.cauDB = {};
        this.winDB = {};
        this.loseDB = {};
        this.minSessions = 5;
        this.totalLearned = 0;
        this.loadFromFile();
    }

    loadFromFile() {
        let saved = loadData(DATA_FILE);
        if (saved) {
            this.cauDB = saved.cauDB || {};
            this.winDB = saved.winDB || {};
            this.loseDB = saved.loseDB || {};
            this.totalLearned = saved.totalLearned || 0;
        }
    }

    saveToFile() {
        saveData({
            cauDB: this.cauDB,
            winDB: this.winDB,
            loseDB: this.loseDB,
            totalLearned: this.totalLearned,
            lastSaved: new Date().toISOString()
        }, DATA_FILE);
    }

    learn(history, lastCorrect) {
        let results = history.map(h => h.result === 'Tài' ? 'T' : 'X');
        let n = results.length;
        if (n < this.minSessions) return;

        // Học bệt
        let streak = 1, cur = results[n - 1];
        for (let i = n - 2; i >= 0; i--) { if (results[i] === cur) streak++; else break; }
        if (streak >= 2) {
            let key = 'biet_' + cur + '_' + streak;
            this.cauDB[key] = (this.cauDB[key] || 0) + 1;
            if (lastCorrect !== undefined) {
                if (lastCorrect) this.winDB[key] = (this.winDB[key] || 0) + 1;
                else this.loseDB[key] = (this.loseDB[key] || 0) + 1;
            }
        }

        // Học pattern 3-5
        for (let len of [3, 4, 5]) {
            if (n > len) {
                let pattern = results.slice(-len - 1, -1).join('');
                let next = results[n - 1];
                let key = 'p' + len + '_' + pattern + '_' + next;
                this.cauDB[key] = (this.cauDB[key] || 0) + 1;
                if (lastCorrect !== undefined) {
                    if (lastCorrect) this.winDB[key] = (this.winDB[key] || 0) + 1;
                    else this.loseDB[key] = (this.loseDB[key] || 0) + 1;
                }
            }
        }

        // Học Rồng/Hổ
        let tRun = 0, xRun = 0;
        for (let i = n - 1; i >= 0 && results[i] === 'T'; i--) tRun++;
        for (let i = n - 1; i >= 0 && results[i] === 'X'; i--) xRun++;
        if (tRun >= 4) this.cauDB['rong_' + tRun] = (this.cauDB['rong_' + tRun] || 0) + 1;
        if (xRun >= 4) this.cauDB['ho_' + xRun] = (this.cauDB['ho_' + xRun] || 0) + 1;

        // Học score diff
        let last = history[n - 1];
        if (last.tong && n >= 2) {
            let diff = last.tong - (history[n - 2].tong || 0);
            this.cauDB['score_diff_' + diff] = (this.cauDB['score_diff_' + diff] || 0) + 1;
        }

        this.totalLearned++;
        if (this.totalLearned % 10 === 0) this.saveToFile();
    }

    predict(history) {
        let results = history.map(h => h.result === 'Tài' ? 'T' : 'X');
        let n = results.length;
        if (n < this.minSessions) return [];
        let preds = [];

        // Pattern đã học
        for (let len of [3, 4, 5]) {
            if (n >= len) {
                let pattern = results.slice(-len).join('');
                let keyT = 'p' + len + '_' + pattern + '_T';
                let keyX = 'p' + len + '_' + pattern + '_X';
                let cntT = this.cauDB[keyT] || 0, cntX = this.cauDB[keyX] || 0;
                let total = cntT + cntX;
                if (total >= 2) {
                    let probT = cntT / total;
                    let winT = this.winDB[keyT] || 0, loseT = this.loseDB[keyT] || 0;
                    let bonus = (winT + loseT > 0) ? (winT / (winT + loseT) - 0.5) * 15 : 0;
                    preds.push({ p: probT > 0.5 ? 'T' : 'X', c: Math.min(95, 50 + Math.abs(probT - 0.5) * 80 + bonus), w: 8, s: 'learned_p' + len });
                }
            }
        }

        // Bệt đã học
        let streak = 1, cur = results[n - 1];
        for (let i = n - 2; i >= 0; i--) { if (results[i] === cur) streak++; else break; }
        if (streak >= 2) {
            let contKey = 'biet_' + cur + '_' + (streak + 1);
            let contCnt = this.cauDB[contKey] || 0;
            let breakCnt = 0;
            for (let s = streak; s <= 15; s++) breakCnt += (this.cauDB['biet_' + cur + '_' + s] || 0);
            breakCnt -= contCnt;
            let total = contCnt + breakCnt;
            if (total > 0) {
                let probCont = contCnt / total;
                let pred = probCont > 0.5 ? cur : (cur === 'T' ? 'X' : 'T');
                let winCnt = this.winDB[contKey] || 0, loseCnt = this.loseDB[contKey] || 0;
                let bonus = (winCnt + loseCnt > 0) ? (winCnt / (winCnt + loseCnt) - 0.5) * 20 : 0;
                preds.push({ p: pred, c: Math.min(95, 50 + Math.abs(probCont - 0.5) * 80 + bonus), w: 10, s: 'learned_biet' });
            }
        }

        return preds;
    }
}

// ======================================================
// DETECTION FUNCTIONS
// ======================================================
function calcBreakProb(results, result, streak) {
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

function streakDetect(history, last, minLen) {
    if (history.length < minLen) return null;
    let streak = 1;
    for (let i = history.length - 2; i >= 0; i--) { if (history[i] === last) streak++; else break; }
    if (streak >= minLen) {
        let bp = calcBreakProb(history, last, streak);
        return { predict: bp > 0.55 ? (last === 'T' ? 'X' : 'T') : last, confidence: Math.min(95, 50 + streak * 4), bp };
    }
    return null;
}

function alternateDetect(history, last, minLen) {
    if (history.length < minLen) return null;
    let seg = history.slice(-minLen);
    for (let i = 1; i < seg.length; i++) if (seg[i] === seg[i - 1]) return null;
    return { predict: last === 'T' ? 'X' : 'T', confidence: Math.min(92, 65 + minLen * 2) };
}

function blockDetect(history, last, size, minLen) {
    if (history.length < minLen) return null;
    let seg = history.slice(-minLen);
    for (let i = 0; i < seg.length; i += size) {
        let block = seg.slice(i, i + size);
        if (block.length === size && !block.every(v => v === block[0])) return null;
        if (i > 0 && seg[i] === seg[i - size]) return null;
    }
    let phase = history.length % size;
    return { predict: phase === 0 ? (last === 'T' ? 'X' : 'T') : last, confidence: Math.min(94, 70 + minLen) };
}

function zigzagDetect(history, last, minLen) {
    if (history.length < minLen) return null;
    let seg = history.slice(-minLen), sw = 0;
    for (let i = 1; i < seg.length; i++) if (seg[i] !== seg[i - 1]) sw++;
    if (sw === seg.length - 1) return { predict: last === 'T' ? 'X' : 'T', confidence: Math.min(90, 68 + sw * 2) };
    return null;
}

function detect123(history) {
    if (history.length < 6) return null;
    let l6 = history.slice(-6).join('');
    if (l6 === "TXXTTT") return { predict: 'X', confidence: 77 };
    if (l6 === "XTTXXX") return { predict: 'T', confidence: 77 };
    return null;
}

function detect321(history) {
    if (history.length < 6) return null;
    let l6 = history.slice(-6).join('');
    if (l6 === "TTTXXT") return { predict: 'X', confidence: 76 };
    if (l6 === "XXXTTX") return { predict: 'T', confidence: 76 };
    return null;
}

function detect1212(history) {
    if (history.length < 8) return null;
    let l8 = history.slice(-8).join('');
    if (l8 === "TXXTTXXT") return { predict: 'X', confidence: 75 };
    if (l8 === "XTTXXTTX") return { predict: 'T', confidence: 75 };
    return null;
}

function detect1122(history) {
    if (history.length < 8) return null;
    let l8 = history.slice(-8).join('');
    if (l8 === "TTXXTTXX") return { predict: 'T', confidence: 74 };
    if (l8 === "XXTTXXTT") return { predict: 'X', confidence: 74 };
    return null;
}

function detect2121(history) {
    if (history.length < 8) return null;
    let l8 = history.slice(-8).join('');
    if (l8 === "TTXTTXTT") return { predict: 'X', confidence: 73 };
    if (l8 === "XXTXXTXX") return { predict: 'T', confidence: 73 };
    return null;
}

function detectRongHo(type) {
    return function (history) {
        let r = 0;
        for (let i = history.length - 1; i >= 0 && history[i] === type; i--) r++;
        if (r >= 4) return { predict: r >= 6 ? (type === 'T' ? 'X' : 'T') : type, confidence: Math.min(95, 65 + r * 3) };
        return null;
    };
}

function detectDoiXung(history) {
    if (history.length < 10) return null;
    let mid = Math.floor(history.length / 2);
    let left = history.slice(0, mid), right = history.slice(mid).reverse();
    let m = 0;
    for (let i = 0; i < Math.min(left.length, right.length); i++) if (left[i] === right[i]) m++;
    let ratio = m / Math.min(left.length, right.length);
    if (ratio >= 0.75) {
        let mp = mid - (history.length - mid);
        if (mp >= 0 && mp < history.length) return { predict: history[mp], confidence: 60 + ratio * 15 };
    }
    return null;
}

function detectTamGiac(history) {
    if (history.length < 5) return null;
    let l5 = history.slice(-5).join('');
    if (l5 === "TXTXT") return { predict: 'X', confidence: 80 };
    if (l5 === "XTXTX") return { predict: 'T', confidence: 80 };
    return null;
}

function detectBietKep(history) {
    if (history.length < 20) return null;
    let list = [], cur = 1, ct = history[0];
    for (let i = 1; i < history.length; i++) {
        if (history[i] === ct) cur++;
        else { if (cur >= 3) list.push({ type: ct, length: cur }); ct = history[i]; cur = 1; }
    }
    if (cur >= 3) list.push({ type: ct, length: cur });
    if (list.length >= 2) {
        let l2 = list.slice(-2);
        if (l2[0].type !== l2[1].type) {
            let diff = Math.abs(l2[0].length - l2[1].length);
            if (diff <= Math.max(l2[0].length, l2[1].length) * 0.3) {
                let avg = (l2[0].length + l2[1].length) / 2;
                let cl = 1;
                for (let i = history.length - 2; i >= 0; i--) { if (history[i] === history[history.length - 1]) cl++; else break; }
                return { predict: cl < avg ? history[history.length - 1] : (history[history.length - 1] === 'T' ? 'X' : 'T'), confidence: 70 };
            }
        }
    }
    return null;
}

function detectVaiDauVai(history, last, scores) {
    if (!scores || scores.length < 15) return null;
    let recentScores = scores.slice(-15);
    let peaks = [];
    for (let i = 2; i < recentScores.length - 2; i++) {
        if (recentScores[i] > recentScores[i - 1] && recentScores[i] > recentScores[i - 2] &&
            recentScores[i] > recentScores[i + 1] && recentScores[i] > recentScores[i + 2]) {
            peaks.push({ val: recentScores[i] });
        }
    }
    if (peaks.length >= 3) {
        let l3 = peaks.slice(-3);
        if (l3[0].val < l3[1].val && l3[2].val < l3[1].val && Math.abs(l3[0].val - l3[2].val) <= 2) {
            return { predict: 'X', confidence: 75 };
        }
    }
    return null;
}

function detectHaiDinh(history, last, scores) {
    if (!scores || scores.length < 10) return null;
    let recentScores = scores.slice(-10);
    let peaks = [];
    for (let i = 2; i < recentScores.length - 2; i++) {
        if (recentScores[i] > recentScores[i - 1] && recentScores[i] > recentScores[i + 1]) {
            peaks.push({ val: recentScores[i], idx: i });
        }
    }
    if (peaks.length >= 2) {
        let l2 = peaks.slice(-2);
        if (Math.abs(l2[0].val - l2[1].val) <= 1 && l2[1].idx - l2[0].idx >= 4) return { predict: 'X', confidence: 70 };
    }
    return null;
}

function detectHaiDay(history, last, scores) {
    if (!scores || scores.length < 10) return null;
    let recentScores = scores.slice(-10);
    let troughs = [];
    for (let i = 2; i < recentScores.length - 2; i++) {
        if (recentScores[i] < recentScores[i - 1] && recentScores[i] < recentScores[i + 1]) {
            troughs.push({ val: recentScores[i], idx: i });
        }
    }
    if (troughs.length >= 2) {
        let l2 = troughs.slice(-2);
        if (Math.abs(l2[0].val - l2[1].val) <= 1 && l2[1].idx - l2[0].idx >= 4) return { predict: 'T', confidence: 70 };
    }
    return null;
}

// ======================================================
// FULL CAU DATABASE
// ======================================================
const FULL_CAU = {
    biet_3: { w: 8, detect: (h, l) => streakDetect(h, l, 3) },
    biet_4: { w: 9, detect: (h, l) => streakDetect(h, l, 4) },
    biet_5: { w: 10, detect: (h, l) => streakDetect(h, l, 5) },
    biet_6: { w: 11, detect: (h, l) => streakDetect(h, l, 6) },
    biet_7: { w: 12, detect: (h, l) => streakDetect(h, l, 7) },
    biet_8: { w: 12, detect: (h, l) => streakDetect(h, l, 8) },
    c11_6: { w: 9, detect: (h, l) => alternateDetect(h, l, 6) },
    c11_8: { w: 10, detect: (h, l) => alternateDetect(h, l, 8) },
    c11_10: { w: 10, detect: (h, l) => alternateDetect(h, l, 10) },
    c22_6: { w: 9, detect: (h, l) => blockDetect(h, l, 2, 6) },
    c22_8: { w: 10, detect: (h, l) => blockDetect(h, l, 2, 8) },
    c33_9: { w: 9, detect: (h, l) => blockDetect(h, l, 3, 9) },
    c33_12: { w: 10, detect: (h, l) => blockDetect(h, l, 3, 12) },
    c44_8: { w: 8, detect: (h, l) => blockDetect(h, l, 4, 8) },
    c55_10: { w: 7, detect: (h, l) => blockDetect(h, l, 5, 10) },
    c123: { w: 8, detect: detect123 },
    c321: { w: 8, detect: detect321 },
    c1212: { w: 7, detect: detect1212 },
    c1122: { w: 7, detect: detect1122 },
    c2121: { w: 7, detect: detect2121 },
    rong: { w: 12, detect: detectRongHo('T') },
    ho: { w: 12, detect: detectRongHo('X') },
    zigzag7: { w: 8, detect: (h, l) => zigzagDetect(h, l, 7) },
    zigzag9: { w: 9, detect: (h, l) => zigzagDetect(h, l, 9) },
    doi_xung: { w: 6, detect: detectDoiXung },
    tam_giac: { w: 7, detect: detectTamGiac },
    biet_kep: { w: 6, detect: detectBietKep },
    vai_dau_vai: { w: 6, detect: detectVaiDauVai },
    hai_dinh: { w: 6, detect: detectHaiDinh },
    hai_day: { w: 6, detect: detectHaiDay }
};

// ======================================================
// DICE ANALYSIS
// ======================================================
function diceTripleAnalysis(history) {
    if (history.length < 5) return null;
    let last = history[history.length - 1];
    let d1 = last.x1, d2 = last.x2, d3 = last.x3;
    let triple = d1 + '' + d2 + '' + d3;
    let tc = 0, tt = 0;
    for (let i = 0; i < history.length - 1; i++) {
        let ht = history[i].x1 + '' + history[i].x2 + '' + history[i].x3;
        if (ht === triple && i + 1 < history.length) { tc++; if (history[i + 1].result === 'Tài') tt++; }
    }
    if (tc >= 3) { let prob = tt / tc; return { p: prob > 0.5 ? 'T' : 'X', c: 50 + Math.abs(prob - 0.5) * 80, w: 9, s: 'dice_triple' }; }
    return null;
}

function diceSumAnalysis(history) {
    if (history.length < 5) return null;
    let last = history[history.length - 1];
    let sum = last.x1 + last.x2 + last.x3;
    let sumAfter = {};
    for (let i = 0; i < history.length - 1; i++) {
        let s = history[i].x1 + history[i].x2 + history[i].x3;
        if (s === sum && i + 1 < history.length) {
            let ns = history[i + 1].x1 + history[i + 1].x2 + history[i + 1].x3;
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

function dicePairAnalysis(history) {
    if (history.length < 5) return null;
    let last = history[history.length - 1];
    let d1 = last.x1, d2 = last.x2, d3 = last.x3;
    let p12 = d1 + '' + d2, p23 = d2 + '' + d3, p13 = d1 + '' + d3;
    let pc = 0, pt = 0;
    for (let i = 0; i < history.length - 1; i++) {
        let hp12 = history[i].x1 + '' + history[i].x2;
        let hp23 = history[i].x2 + '' + history[i].x3;
        let hp13 = history[i].x1 + '' + history[i].x3;
        if ((hp12 === p12 || hp23 === p23 || hp13 === p13) && i + 1 < history.length) {
            pc++; if (history[i + 1].result === 'Tài') pt++;
        }
    }
    if (pc >= 5) { let prob = pt / pc; return { p: prob > 0.5 ? 'T' : 'X', c: 50 + Math.abs(prob - 0.5) * 55, w: 7, s: 'dice_pair' }; }
    return null;
}

function diceHighLowAnalysis(history) {
    if (history.length < 5) return null;
    let last = history[history.length - 1];
    let d1 = last.x1, d2 = last.x2, d3 = last.x3;
    let hl = (d1 >= 4 ? 'H' : 'L') + (d2 >= 4 ? 'H' : 'L') + (d3 >= 4 ? 'H' : 'L');
    let hlc = 0, hlt = 0;
    for (let i = 0; i < history.length - 1; i++) {
        let hhl = (history[i].x1 >= 4 ? 'H' : 'L') + (history[i].x2 >= 4 ? 'H' : 'L') + (history[i].x3 >= 4 ? 'H' : 'L');
        if (hhl === hl && i + 1 < history.length) { hlc++; if (history[i + 1].result === 'Tài') hlt++; }
    }
    if (hlc >= 5) { let prob = hlt / hlc; return { p: prob > 0.5 ? 'T' : 'X', c: 50 + Math.abs(prob - 0.5) * 45, w: 6, s: 'dice_hl' }; }
    return null;
}

// ======================================================
// SCORE ANALYSIS
// ======================================================
function scoreExtremeAnalysis(history) {
    let lastScore = history[history.length - 1].tong || 0;
    if (lastScore >= 17) return { p: 'X', c: 90, w: 12, s: 'score_17' };
    if (lastScore >= 15) return { p: 'X', c: 75, w: 9, s: 'score_15' };
    if (lastScore <= 4) return { p: 'T', c: 90, w: 12, s: 'score_4' };
    if (lastScore <= 6) return { p: 'T', c: 70, w: 8, s: 'score_6' };
    return null;
}

// ======================================================
// TREND ANALYSIS
// ======================================================
function trendAnalysis(history, window) {
    let results = history.map(h => h.result === 'Tài' ? 'T' : 'X');
    if (results.length < window) return null;
    let seg = results.slice(-window);
    let tCount = seg.filter(r => r === 'T').length;
    let ratio = tCount / window;
    if (ratio >= 0.7) return { p: 'X', c: 60 + ratio * 20, w: 7, s: 'trend_over_' + window };
    if (ratio <= 0.3) return { p: 'T', c: 60 + (1 - ratio) * 20, w: 7, s: 'trend_under_' + window };
    return null;
}

function switchAnalysis(history) {
    let results = history.map(h => h.result === 'Tài' ? 'T' : 'X');
    let n = results.length;
    if (n < 10) return null;
    let sw = 0;
    for (let i = n - 9; i < n; i++) if (results[i] !== results[i - 1]) sw++;
    if (sw >= 7) return { p: results[n - 1] === 'T' ? 'X' : 'T', c: 68, w: 7, s: 'switch_high' };
    return null;
}

// ======================================================
// PATTERN ANALYSIS
// ======================================================
function patternAnalysis(history, len) {
    let results = history.map(h => h.result === 'Tài' ? 'T' : 'X');
    if (results.length < len + 1) return null;
    let pattern = results.slice(-len).join('');
    let nextCounts = { T: 0, X: 0 };
    for (let i = 0; i < results.length - len; i++) {
        if (results.slice(i, i + len).join('') === pattern) nextCounts[results[i + len]]++;
    }
    let total = nextCounts.T + nextCounts.X;
    if (total >= Math.max(3, 8 - len)) {
        let probT = nextCounts.T / total;
        return { p: probT > 0.5 ? 'T' : 'X', c: 50 + Math.abs(probT - 0.5) * (100 - len * 5), w: Math.max(4, 10 - len), s: 'pattern_' + len };
    }
    return null;
}

// ======================================================
// PREDICTION LOG
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
    }
}

function savePredictionLog() {
    saveData({ log: predictionLog.slice(-500), totalPredictions, totalCorrect, lastSaved: new Date().toISOString() }, LOG_FILE);
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

    let streak = 1, lastResult = last10[last10.length - 1];
    for (let i = last10.length - 2; i >= 0; i--) { if (last10[i] === lastResult) streak++; else break; }
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
const masterLearner = new MasterLearningSystem();

function predictMaster(history) {
    let n = history.length;
    if (n < 5) return { prediction: 'Cần thêm dữ liệu', confidence: 0 };

    let results = history.map(h => h.result === 'Tài' ? 'T' : 'X');
    let scores = history.map(h => h.tong || 0);
    let lastResult = results[n - 1];
    let lastScore = scores[n - 1];

    let allPredictions = [];

    // 1. LEARNED PREDICTIONS (ưu tiên cao nhất)
    let learnedPreds = masterLearner.predict(history);
    allPredictions.push(...learnedPreds);

    // 2. FULL CAU DATABASE
    for (let [key, cfg] of Object.entries(FULL_CAU)) {
        let res = cfg.detect(results, lastResult, scores, history);
        if (res && res.predict) {
            allPredictions.push({ p: res.predict, c: res.confidence, w: cfg.w, s: key });
        }
    }

    // 3. DICE ANALYSIS
    for (let fn of [diceTripleAnalysis, diceSumAnalysis, dicePairAnalysis, diceHighLowAnalysis]) {
        let res = fn(history);
        if (res) allPredictions.push(res);
    }

    // 4. SCORE ANALYSIS
    let scoreRes = scoreExtremeAnalysis(history);
    if (scoreRes) allPredictions.push(scoreRes);

    // 5. TREND ANALYSIS
    for (let w of [5, 8, 10, 15, 20]) {
        let res = trendAnalysis(history, w);
        if (res) allPredictions.push(res);
    }
    let switchRes = switchAnalysis(history);
    if (switchRes) allPredictions.push(switchRes);

    // 6. PATTERN MATCHING
    for (let len of [3, 4, 5, 6, 7, 8]) {
        let res = patternAnalysis(history, len);
        if (res) allPredictions.push(res);
    }

    // 7. EXTREME SIGNALS
    if (lastScore >= 17) allPredictions.push({ p: 'X', c: 92, w: 15, s: 'extreme_17' });
    if (lastScore <= 4) allPredictions.push({ p: 'T', c: 92, w: 15, s: 'extreme_4' });

    let tRun = 0, xRun = 0;
    for (let i = n - 1; i >= 0 && results[i] === 'T'; i--) tRun++;
    for (let i = n - 1; i >= 0 && results[i] === 'X'; i--) xRun++;
    if (tRun >= 8) allPredictions.push({ p: 'X', c: 95, w: 18, s: 'rong_extreme' });
    if (xRun >= 8) allPredictions.push({ p: 'T', c: 95, w: 18, s: 'ho_extreme' });

    let last5 = results.slice(-5);
    if (last5.every(r => r === 'T')) allPredictions.push({ p: 'X', c: 85, w: 12, s: 'all_tai_5' });
    if (last5.every(r => r === 'X')) allPredictions.push({ p: 'T', c: 85, w: 12, s: 'all_xiu_5' });

    if (allPredictions.length === 0) {
        return { prediction: lastResult === 'T' ? 'Xỉu' : 'Tài', confidence: 50 };
    }

    // SORT & ENSEMBLE
    allPredictions.sort((a, b) => (b.w * 100 + b.c) - (a.w * 100 + a.c));

    // ƯU TIÊN TÍN HIỆU MẠNH NHẤT
    let topSignal = allPredictions[0];
    let topPreds = allPredictions.slice(0, 25);

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

    // AGREEMENT BONUS
    let top3 = topPreds.slice(0, 3), top5 = topPreds.slice(0, 5), top10 = topPreds.slice(0, 10);
    if (top10.every(p => p.p === top10[0].p)) confidence = Math.min(98, confidence + 18);
    else if (top5.every(p => p.p === top5[0].p)) confidence = Math.min(98, confidence + 12);
    else if (top3.every(p => p.p === top3[0].p)) confidence = Math.min(98, confidence + 6);

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
    let result = predictMaster(history);
    if (!result || result.confidence === 0) return { duDoan: "tài", doTinCay: 52 };
    return { duDoan: result.prediction === 'Tài' ? 'tài' : 'xỉu', doTinCay: result.confidence };
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
                pattern: "[Đang học - cần 5 phiên...]",
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
                pattern: "[Đang học - cần 5 phiên...]",
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
    console.log("Master Learning System - Khóa 5 phiên đầu - 200+ thuật toán");
});
