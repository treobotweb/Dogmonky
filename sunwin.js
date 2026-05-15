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
// DETECTION FUNCTIONS
// ======================================================
function checkStreak(history, min) {
    if (history.length < min) return null;
    let s = 1, last = history[history.length - 1];
    for (let i = history.length - 2; i >= 0; i--) {
        if (history[i] === last) s++; else break;
    }
    if (s >= min) {
        let bp = calcBreakProb(history, last, s);
        return { pred: bp > 0.55 ? (last === 'T' ? 'X' : 'T') : last, conf: Math.min(95, 55 + s * 4), bp };
    }
    return null;
}

function calcBreakProb(history, result, streak) {
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

function checkAlternate(history, min) {
    if (history.length < min) return null;
    let seg = history.slice(-min);
    for (let i = 1; i < seg.length; i++) if (seg[i] === seg[i - 1]) return null;
    return { pred: seg[seg.length - 1] === 'T' ? 'X' : 'T', conf: Math.min(92, 65 + min * 2) };
}

function checkBlock(history, size, min) {
    if (history.length < min) return null;
    let seg = history.slice(-min);
    for (let i = 0; i < seg.length; i += size) {
        let block = seg.slice(i, i + size);
        if (block.length === size && !block.every(v => v === block[0])) return null;
        if (i > 0 && seg[i] === seg[i - size]) return null;
    }
    let phase = history.length % size;
    return { pred: phase === 0 ? (seg[seg.length - 1] === 'T' ? 'X' : 'T') : seg[seg.length - 1], conf: Math.min(94, 70 + min) };
}

function checkZigzag(history, min) {
    if (history.length < min) return null;
    let seg = history.slice(-min), sw = 0;
    for (let i = 1; i < seg.length; i++) if (seg[i] !== seg[i - 1]) sw++;
    if (sw === seg.length - 1) return { pred: seg[seg.length - 1] === 'T' ? 'X' : 'T', conf: Math.min(90, 68 + sw * 2) };
    return null;
}

function detect123(history) {
    if (history.length < 6) return null;
    let s = history.slice(-6).join('');
    if (s === "TXXTTT") return { pred: 'X', conf: 77 };
    if (s === "XTTXXX") return { pred: 'T', conf: 77 };
    return null;
}
function detect321(history) {
    if (history.length < 6) return null;
    let s = history.slice(-6).join('');
    if (s === "TTTXXT") return { pred: 'X', conf: 76 };
    if (s === "XXXTTX") return { pred: 'T', conf: 76 };
    return null;
}
function detect1212(history) {
    if (history.length < 8) return null;
    let s = history.slice(-8).join('');
    if (s === "TXXTTXXT") return { pred: 'X', conf: 75 };
    if (s === "XTTXXTTX") return { pred: 'T', conf: 75 };
    return null;
}
function detect1122(history) {
    if (history.length < 8) return null;
    let s = history.slice(-8).join('');
    if (s === "TTXXTTXX") return { pred: 'T', conf: 74 };
    if (s === "XXTTXXTT") return { pred: 'X', conf: 74 };
    return null;
}
function detect2121(history) {
    if (history.length < 8) return null;
    let s = history.slice(-8).join('');
    if (s === "TTXTTXTT") return { pred: 'X', conf: 73 };
    if (s === "XXTXXTXX") return { pred: 'T', conf: 73 };
    return null;
}
function detect132(history) {
    if (history.length < 6) return null;
    let s = history.slice(-6).join('');
    if (s === "TXXXTT") return { pred: 'T', conf: 72 };
    if (s === "XTTTXX") return { pred: 'X', conf: 72 };
    return null;
}
function detect213(history) {
    if (history.length < 7) return null;
    let s = history.slice(-7).join('');
    if (s === "XXTXTTT") return { pred: 'X', conf: 71 };
    if (s === "TTXTXXX") return { pred: 'T', conf: 71 };
    return null;
}
function detect231(history) {
    if (history.length < 6) return null;
    let s = history.slice(-6).join('');
    if (s === "XXTTTX") return { pred: 'T', conf: 71 };
    if (s === "TTXXXT") return { pred: 'X', conf: 71 };
    return null;
}
function detect312(history) {
    if (history.length < 7) return null;
    let s = history.slice(-7).join('');
    if (s === "TTTXTXX") return { pred: 'X', conf: 70 };
    if (s === "XXXTXTT") return { pred: 'T', conf: 70 };
    return null;
}
function detectRong(history) {
    let r = 0;
    for (let i = history.length - 1; i >= 0 && history[i] === 'T'; i--) r++;
    if (r >= 6) return { pred: 'X', conf: Math.min(92, 78 + r) };
    if (r >= 4) return { pred: 'T', conf: 68 + r };
    return null;
}
function detectHo(history) {
    let r = 0;
    for (let i = history.length - 1; i >= 0 && history[i] === 'X'; i--) r++;
    if (r >= 6) return { pred: 'T', conf: Math.min(92, 78 + r) };
    if (r >= 4) return { pred: 'X', conf: 68 + r };
    return null;
}
function detectDoiXung(history) {
    if (history.length < 10) return null;
    let mid = Math.floor(history.length / 2);
    let left = history.slice(0, mid), right = history.slice(mid).reverse();
    let m = 0;
    for (let i = 0; i < Math.min(left.length, right.length); i++) if (left[i] === right[i]) m++;
    if (m / Math.min(left.length, right.length) >= 0.75) {
        let mp = mid - (history.length - mid);
        if (mp >= 0 && mp < history.length) return { pred: history[mp], conf: 65 };
    }
    return null;
}
function detectTamGiac(history) {
    if (history.length < 5) return null;
    let s = history.slice(-5).join('');
    if (s === "TXTXT") return { pred: 'X', conf: 80 };
    if (s === "XTXTX") return { pred: 'T', conf: 80 };
    return null;
}
function detectBacThang(history) {
    if (history.length < 15) return null;
    let streaks = [], cur = 1;
    for (let i = 1; i < history.length; i++) {
        if (history[i] === history[i - 1]) cur++;
        else { streaks.push(cur); cur = 1; }
    }
    streaks.push(cur);
    if (streaks.length >= 5) {
        let l5 = streaks.slice(-5);
        let inc = l5.every((v, i) => i === 0 || v >= l5[i - 1]) && l5[4] > l5[0];
        let dec = l5.every((v, i) => i === 0 || v <= l5[i - 1]) && l5[4] < l5[0];
        if (inc) return { pred: history[history.length - 1], conf: 62 };
        if (dec) return { pred: history[history.length - 1] === 'T' ? 'X' : 'T', conf: 65 };
    }
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
                return { pred: cl < avg ? history[history.length - 1] : (history[history.length - 1] === 'T' ? 'X' : 'T'), conf: 70 };
            }
        }
    }
    return null;
}
function detectNemTang(history) {
    if (history.length < 12) return null;
    let scores = history.slice(-12).map(h => h.tong || 0);
    let maxS = Math.max(...scores), minS = Math.min(...scores);
    if (maxS - minS <= 5 && maxS - minS >= 2) {
        let first = scores.slice(0, 6), second = scores.slice(6);
        if (second.reduce((a, b) => a + b, 0) / 6 > first.reduce((a, b) => a + b, 0) / 6 + 2) return { pred: 'T', conf: 62 };
    }
    return null;
}
function detectNemGiam(history) {
    if (history.length < 12) return null;
    let scores = history.slice(-12).map(h => h.tong || 0);
    let maxS = Math.max(...scores), minS = Math.min(...scores);
    if (maxS - minS <= 5 && maxS - minS >= 2) {
        let first = scores.slice(0, 6), second = scores.slice(6);
        if (second.reduce((a, b) => a + b, 0) / 6 < first.reduce((a, b) => a + b, 0) / 6 - 2) return { pred: 'X', conf: 62 };
    }
    return null;
}
function detectVaiDauVai(history) {
    if (history.length < 15) return null;
    let scores = history.slice(-15).map(h => h.tong || 0);
    let peaks = [];
    for (let i = 2; i < scores.length - 2; i++) {
        if (scores[i] > scores[i - 1] && scores[i] > scores[i - 2] && scores[i] > scores[i + 1] && scores[i] > scores[i + 2]) {
            peaks.push({ val: scores[i], idx: i });
        }
    }
    if (peaks.length >= 3) {
        let l3 = peaks.slice(-3);
        if (l3[0].val < l3[1].val && l3[2].val < l3[1].val && Math.abs(l3[0].val - l3[2].val) <= 2) return { pred: 'X', conf: 75 };
    }
    return null;
}
function detectHaiDinh(history) {
    if (history.length < 10) return null;
    let scores = history.slice(-10).map(h => h.tong || 0);
    let peaks = [];
    for (let i = 2; i < scores.length - 2; i++) {
        if (scores[i] > scores[i - 1] && scores[i] > scores[i + 1]) peaks.push({ val: scores[i], idx: i });
    }
    if (peaks.length >= 2) {
        let l2 = peaks.slice(-2);
        if (Math.abs(l2[0].val - l2[1].val) <= 1 && l2[1].idx - l2[0].idx >= 4) return { pred: 'X', conf: 70 };
    }
    return null;
}
function detectHaiDay(history) {
    if (history.length < 10) return null;
    let scores = history.slice(-10).map(h => h.tong || 0);
    let troughs = [];
    for (let i = 2; i < scores.length - 2; i++) {
        if (scores[i] < scores[i - 1] && scores[i] < scores[i + 1]) troughs.push({ val: scores[i], idx: i });
    }
    if (troughs.length >= 2) {
        let l2 = troughs.slice(-2);
        if (Math.abs(l2[0].val - l2[1].val) <= 1 && l2[1].idx - l2[0].idx >= 4) return { pred: 'T', conf: 70 };
    }
    return null;
}
function detectDiamond(history) {
    if (history.length < 15) return null;
    let scores = history.slice(-15).map(h => h.tong || 0);
    let mid = Math.floor(scores.length / 2);
    let fRange = Math.max(...scores.slice(0, mid)) - Math.min(...scores.slice(0, mid));
    let sRange = Math.max(...scores.slice(mid)) - Math.min(...scores.slice(mid));
    if (fRange > 4 && sRange < 3) return { pred: 'X', conf: 68 };
    return null;
}
function detectConSoi(history) {
    if (history.length < 8) return null;
    let s = history.slice(-8).join('');
    if (s === "TXTTXTTX") return { pred: 'T', conf: 72 };
    if (s === "XTXXTXXT") return { pred: 'X', conf: 72 };
    return null;
}

// ======================================================
// FULL CAU DATABASE - 50+ LOAI CAU
// ======================================================
const FULL_CAU = {
    biet_3: { type: 'biet', len: 3, w: 8, detect: (h) => checkStreak(h, 3) },
    biet_4: { type: 'biet', len: 4, w: 9, detect: (h) => checkStreak(h, 4) },
    biet_5: { type: 'biet', len: 5, w: 10, detect: (h) => checkStreak(h, 5) },
    biet_6: { type: 'biet', len: 6, w: 10, detect: (h) => checkStreak(h, 6) },
    biet_7: { type: 'biet', len: 7, w: 10, detect: (h) => checkStreak(h, 7) },
    biet_8: { type: 'biet', len: 8, w: 10, detect: (h) => checkStreak(h, 8) },
    c11_6: { type: '1-1', len: 6, w: 9, detect: (h) => checkAlternate(h, 6) },
    c11_8: { type: '1-1', len: 8, w: 10, detect: (h) => checkAlternate(h, 8) },
    c11_10: { type: '1-1', len: 10, w: 10, detect: (h) => checkAlternate(h, 10) },
    c22_6: { type: '2-2', len: 6, w: 9, detect: (h) => checkBlock(h, 2, 6) },
    c22_8: { type: '2-2', len: 8, w: 10, detect: (h) => checkBlock(h, 2, 8) },
    c33_9: { type: '3-3', len: 9, w: 9, detect: (h) => checkBlock(h, 3, 9) },
    c33_12: { type: '3-3', len: 12, w: 10, detect: (h) => checkBlock(h, 3, 12) },
    c44_8: { type: '4-4', len: 8, w: 8, detect: (h) => checkBlock(h, 4, 8) },
    c55_10: { type: '5-5', len: 10, w: 7, detect: (h) => checkBlock(h, 5, 10) },
    c123: { type: '1-2-3', len: 6, w: 8, detect: detect123 },
    c321: { type: '3-2-1', len: 6, w: 8, detect: detect321 },
    c1212: { type: '1-2-1-2', len: 8, w: 7, detect: detect1212 },
    c1122: { type: '1-1-2-2', len: 8, w: 7, detect: detect1122 },
    c2121: { type: '2-1-2-1', len: 8, w: 7, detect: detect2121 },
    c132: { type: '1-3-2', len: 6, w: 6, detect: detect132 },
    c213: { type: '2-1-3', len: 7, w: 6, detect: detect213 },
    c231: { type: '2-3-1', len: 6, w: 6, detect: detect231 },
    c312: { type: '3-1-2', len: 7, w: 6, detect: detect312 },
    rong: { type: 'rong', len: 6, w: 10, detect: detectRong },
    ho: { type: 'ho', len: 6, w: 10, detect: detectHo },
    zigzag7: { type: 'zigzag', len: 7, w: 8, detect: (h) => checkZigzag(h, 7) },
    zigzag9: { type: 'zigzag', len: 9, w: 9, detect: (h) => checkZigzag(h, 9) },
    doi_xung: { type: 'doi_xung', len: 10, w: 6, detect: detectDoiXung },
    tam_giac: { type: 'tam_giac', len: 5, w: 7, detect: detectTamGiac },
    bac_thang: { type: 'bac_thang', len: 15, w: 5, detect: detectBacThang },
    biet_kep: { type: 'biet_kep', len: 20, w: 6, detect: detectBietKep },
    nem_tang: { type: 'nem', len: 12, w: 5, detect: detectNemTang },
    nem_giam: { type: 'nem', len: 12, w: 5, detect: detectNemGiam },
    vai_dau_vai: { type: 'vai_dau_vai', len: 15, w: 6, detect: detectVaiDauVai },
    hai_dinh: { type: 'hai_dinh', len: 10, w: 6, detect: detectHaiDinh },
    hai_day: { type: 'hai_day', len: 10, w: 6, detect: detectHaiDay },
    diamond: { type: 'diamond', len: 15, w: 5, detect: detectDiamond },
    con_soi: { type: 'con_soi', len: 8, w: 5, detect: detectConSoi }
};

// ======================================================
// DICE ANALYSIS
// ======================================================
function analyzeDice(history) {
    if (history.length < 5) return [];
    let preds = [];
    let last = history[history.length - 1];
    let d1 = last.x1, d2 = last.x2, d3 = last.x3;
    let sum = d1 + d2 + d3;

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
        preds.push({ pred: bestSum >= 11 ? 'T' : 'X', conf: 50 + (bestCount / totalAfter) * 35, src: 'sum', w: 8 });
    }

    let triple = d1 + '' + d2 + '' + d3;
    let tc = 0, tt = 0;
    for (let i = 0; i < history.length - 1; i++) {
        let ht = history[i].x1 + '' + history[i].x2 + '' + history[i].x3;
        if (ht === triple && i + 1 < history.length) { tc++; if (history[i + 1].result === 'Tài') tt++; }
    }
    if (tc >= 3) { let prob = tt / tc; preds.push({ pred: prob > 0.5 ? 'T' : 'X', conf: 50 + Math.abs(prob - 0.5) * 70, src: 'triple', w: 9 }); }

    let p12 = d1 + '' + d2, p23 = d2 + '' + d3, p13 = d1 + '' + d3;
    let pc = 0, pt = 0;
    for (let i = 0; i < history.length - 1; i++) {
        let hp12 = history[i].x1 + '' + history[i].x2;
        let hp23 = history[i].x2 + '' + history[i].x3;
        let hp13 = history[i].x1 + '' + history[i].x3;
        if ((hp12 === p12 || hp23 === p23 || hp13 === p13) && i + 1 < history.length) { pc++; if (history[i + 1].result === 'Tài') pt++; }
    }
    if (pc >= 5) { let prob = pt / pc; preds.push({ pred: prob > 0.5 ? 'T' : 'X', conf: 50 + Math.abs(prob - 0.5) * 50, src: 'pair', w: 7 }); }

    let hl = (d1 >= 4 ? 'H' : 'L') + (d2 >= 4 ? 'H' : 'L') + (d3 >= 4 ? 'H' : 'L');
    let hlc = 0, hlt = 0;
    for (let i = 0; i < history.length - 1; i++) {
        let hhl = (history[i].x1 >= 4 ? 'H' : 'L') + (history[i].x2 >= 4 ? 'H' : 'L') + (history[i].x3 >= 4 ? 'H' : 'L');
        if (hhl === hl && i + 1 < history.length) { hlc++; if (history[i + 1].result === 'Tài') hlt++; }
    }
    if (hlc >= 5) { let prob = hlt / hlc; preds.push({ pred: prob > 0.5 ? 'T' : 'X', conf: 50 + Math.abs(prob - 0.5) * 40, src: 'hl', w: 6 }); }

    return preds;
}

// ======================================================
// MAIN PREDICT
// ======================================================
function predictMax(history) {
    let n = history.length;
    if (n < 5) return { prediction: 'Chờ thêm dữ liệu', confidence: 0 };
    let results = history.map(h => (h.result === 'Tài' || h.result === 'T') ? 'T' : 'X');
    let allPreds = [];

    for (let [key, cfg] of Object.entries(FULL_CAU)) {
        let res = cfg.detect(results);
        if (res && res.pred) allPreds.push({ pred: res.pred, conf: res.conf, w: cfg.w, type: cfg.type, key });
    }

    let dicePreds = analyzeDice(history);
    for (let dp of dicePreds) allPreds.push({ pred: dp.pred, conf: dp.conf, w: dp.w, type: 'dice', key: dp.src });

    let lastScore = history[n - 1].tong || 0;
    if (lastScore >= 17) allPreds.push({ pred: 'X', conf: 82, w: 9, type: 'score', key: 'score_vhigh' });
    else if (lastScore >= 15) allPreds.push({ pred: 'X', conf: 72, w: 7, type: 'score', key: 'score_high' });
    if (lastScore <= 4) allPreds.push({ pred: 'T', conf: 82, w: 9, type: 'score', key: 'score_vlow' });
    else if (lastScore <= 6) allPreds.push({ pred: 'T', conf: 68, w: 6, type: 'score', key: 'score_low' });

    let last10 = results.slice(-10);
    let tCount = last10.filter(r => r === 'T').length;
    if (tCount >= 8) allPreds.push({ pred: 'X', conf: 72, w: 7, type: 'trend', key: 'overbought' });
    else if (tCount >= 7) allPreds.push({ pred: 'X', conf: 64, w: 5, type: 'trend', key: 'overbought_w' });
    if (tCount <= 2) allPreds.push({ pred: 'T', conf: 72, w: 7, type: 'trend', key: 'oversold' });
    else if (tCount <= 3) allPreds.push({ pred: 'T', conf: 64, w: 5, type: 'trend', key: 'oversold_w' });

    let switches = 0;
    for (let i = n - 9; i < n; i++) if (results[i] !== results[i - 1]) switches++;
    if (switches >= 7) allPreds.push({ pred: results[n - 1] === 'T' ? 'X' : 'T', conf: 68, w: 6, type: 'switch', key: 'high_switch' });

    let last5 = results.slice(-5);
    let l5t = last5.filter(r => r === 'T').length;
    if (l5t === 5) allPreds.push({ pred: 'X', conf: 75, w: 8, type: 'recent', key: 'all_tai' });
    if (l5t === 0) allPreds.push({ pred: 'T', conf: 75, w: 8, type: 'recent', key: 'all_xiu' });

    if (allPreds.length === 0) return { prediction: results[n - 1] === 'T' ? 'Xỉu' : 'Tài', confidence: 50 };

    allPreds.sort((a, b) => (b.w * 100 + b.conf) - (a.w * 100 + a.conf));
    let topPreds = allPreds.slice(0, 20);
    let voteT = 0, voteX = 0, totalW = 0;
    for (let p of topPreds) {
        let w = p.w * (p.conf / 100);
        if (p.pred === 'T') voteT += w;
        else voteX += w;
        totalW += w;
    }

    if (totalW === 0) return { prediction: results[n - 1] === 'T' ? 'Xỉu' : 'Tài', confidence: 50 };

    let probT = voteT / totalW;
    let finalPred = probT > 0.5 ? 'T' : 'X';
    let confidence = Math.round(Math.abs(probT - 0.5) * 2 * 100);
    confidence = Math.max(52, Math.min(98, confidence));

    let top3Agree = topPreds.slice(0, 3).every(p => p.pred === topPreds[0].pred);
    let top5Agree = topPreds.slice(0, 5).every(p => p.pred === topPreds[0].pred);
    let top10Agree = topPreds.slice(0, 10).every(p => p.pred === topPreds[0].pred);
    if (top10Agree) confidence = Math.min(98, confidence + 12);
    else if (top5Agree) confidence = Math.min(98, confidence + 8);
    else if (top3Agree) confidence = Math.min(98, confidence + 4);

    return {
        prediction: finalPred === 'T' ? 'Tài' : 'Xỉu',
        confidence,
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
    for (let [key, cfg] of Object.entries(FULL_CAU)) {
        let res = cfg.detect(results);
        if (res) cauTypes.push(key.replace(/_/g, ' '));
    }
    if (cauTypes.length === 0) {
        let tCount = last10.filter(r => r === 'T').length;
        if (tCount >= 7) cauTypes.push("Tài mạnh");
        else if (tCount <= 3) cauTypes.push("Xỉu mạnh");
        else if (tCount >= 6) cauTypes.push("Nghiêng Tài");
        else if (tCount <= 4) cauTypes.push("Nghiêng Xỉu");
        else cauTypes.push("Cân bằng");
    }
    return "[Cầu " + cauTypes.slice(0, 3).join(', ') + "] - " + patternStr;
}

// ======================================================
// FINAL PREDICT
// ======================================================
function finalPredict(history) {
    if (history.length < 10) return { duDoan: "tài", doTinCay: 52 };
    let result = predictMax(history);
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
