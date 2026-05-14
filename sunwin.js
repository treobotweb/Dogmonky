const express = require("express");
const axios = require("axios");
const fs = require("fs");
const path = require("path");

const app = express();
const PORT = process.env.PORT || 3000;
const API_URL = "https://sunlol-zv7x.onrender.com/data";
const STORAGE_FILE = path.join(__dirname, "data_storage.json");
const HISTORY_FILE = path.join(__dirname, "game_history.json");

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
            x1: d1,
            x2: d2,
            x3: d3,
            tong: tong,
            ket_qua: ketQua === "tài" ? "tài" : "xỉu",
            result: ketQua === "tài" ? "Tài" : "Xỉu",
            dice: [d1, d2, d3],
            total: tong
        };
    }).filter(item => item.phien > 0 && item.tong >= 3 && item.tong <= 18);
}

// ======================================================
// HE THONG LUU TRU VINH VIEN
// ======================================================
let permanentStorage = {
    cauMemory: {},
    diceMemory: {},
    scoreMemory: {},
    patternMemory: {},
    statsMemory: {},
    lastSave: 0,
    totalSessions: 0
};

let cauMemoryBank = {
    biet: {
        Tai: {},
        Xiu: {},
        stats: {
            maxTai: 0,
            maxXiu: 0,
            avgTai: 0,
            avgXiu: 0,
            totalBietTai: 0,
            totalBietXiu: 0
        }
    },
    c11: {
        patterns: {},
        stats: {
            total: 0,
            maxLength: 0,
            breakRate: {}
        }
    },
    c22: {
        patterns: {},
        stats: {
            total: 0,
            maxLength: 0,
            phaseAccuracy: {}
        }
    },
    c33: {
        patterns: {},
        stats: {
            total: 0,
            maxLength: 0,
            phaseAccuracy: {}
        }
    }
};

let diceMemoryBank = {
    x1: {
        1: 0,
        2: 0,
        3: 0,
        4: 0,
        5: 0,
        6: 0,
        stats: {
            mean: 0,
            median: 0,
            mode: 0,
            std: 0,
            hot: 0,
            cold: 0
        }
    },
    x2: {
        1: 0,
        2: 0,
        3: 0,
        4: 0,
        5: 0,
        6: 0,
        stats: {
            mean: 0,
            median: 0,
            mode: 0,
            std: 0,
            hot: 0,
            cold: 0
        }
    },
    x3: {
        1: 0,
        2: 0,
        3: 0,
        4: 0,
        5: 0,
        6: 0,
        stats: {
            mean: 0,
            median: 0,
            mode: 0,
            std: 0,
            hot: 0,
            cold: 0
        }
    },
    tong: {
        3: 0,
        4: 0,
        5: 0,
        6: 0,
        7: 0,
        8: 0,
        9: 0,
        10: 0,
        11: 0,
        12: 0,
        13: 0,
        14: 0,
        15: 0,
        16: 0,
        17: 0,
        18: 0,
        stats: {
            mean: 0,
            median: 0,
            mode: 0
        }
    },
    cap12: {
        matrix: {},
        stats: {}
    },
    cap23: {
        matrix: {},
        stats: {}
    },
    cap13: {
        matrix: {},
        stats: {}
    },
    triple: {
        matrix: {},
        stats: {
            total: 0,
            uniqueTriples: 0
        }
    },
    highLow: {
        HHH: 0,
        HHL: 0,
        HLH: 0,
        HLL: 0,
        LHH: 0,
        LHL: 0,
        LLH: 0,
        LLL: 0
    },
    oddEven: {
        CCC: 0,
        CCL: 0,
        CLC: 0,
        CLL: 0,
        LCC: 0,
        LCL: 0,
        LLC: 0,
        LLL: 0
    },
    prime: {
        0: 0,
        1: 0,
        2: 0,
        3: 0
    },
    chenhLech: {
        0: 0,
        1: 0,
        2: 0,
        3: 0,
        4: 0,
        5: 0
    },
    tongCap: {
        x1x2: {
            2: 0,
            3: 0,
            4: 0,
            5: 0,
            6: 0,
            7: 0,
            8: 0,
            9: 0,
            10: 0,
            11: 0,
            12: 0
        },
        x2x3: {
            2: 0,
            3: 0,
            4: 0,
            5: 0,
            6: 0,
            7: 0,
            8: 0,
            9: 0,
            10: 0,
            11: 0,
            12: 0
        },
        x1x3: {
            2: 0,
            3: 0,
            4: 0,
            5: 0,
            6: 0,
            7: 0,
            8: 0,
            9: 0,
            10: 0,
            11: 0,
            12: 0
        }
    },
    transition: {
        x1: Array.from({
            length: 7
        }, (_, i) => i === 0 ? null : {
            1: 0,
            2: 0,
            3: 0,
            4: 0,
            5: 0,
            6: 0
        }),
        x2: Array.from({
            length: 7
        }, (_, i) => i === 0 ? null : {
            1: 0,
            2: 0,
            3: 0,
            4: 0,
            5: 0,
            6: 0
        }),
        x3: Array.from({
            length: 7
        }, (_, i) => i === 0 ? null : {
            1: 0,
            2: 0,
            3: 0,
            4: 0,
            5: 0,
            6: 0
        })
    },
    tripleTransition: {},
    diceStreaks: {
        x1: {},
        x2: {},
        x3: {}
    }
};

let patternMemoryBank = {
    p3: {},
    p4: {},
    p5: {},
    p6: {},
    p7: {},
    p8: {},
    p9: {},
    p10: {},
    p12: {},
    p15: {},
    p20: {},
    patternNext: {},
    patternAfter: {},
    topPatterns: [],
    patternClusters: {},
    lastUpdate: 0
};

let scoreMemoryBank = {
    afterScore: {},
    afterScoreResult: {},
    scoreZones: {
        ratThap: 0,
        thap: 0,
        trungBinh: 0,
        cao: 0,
        ratCao: 0
    },
    zoneTransitions: {},
    movingAvg: {
        MA5: [],
        MA10: [],
        MA20: [],
        MA50: []
    },
    momentum: {
        strongUp: 0,
        weakUp: 0,
        flat: 0,
        weakDown: 0,
        strongDown: 0
    },
    volatility: {
        thap: 0,
        trungbinh: 0,
        cao: 0
    },
    specialScores: {
        tong3: 0,
        tong4: 0,
        tong17: 0,
        tong18: 0
    },
    scoreCycles: {}
};

let gameHistory = [];
let totalPredictions = 0;
let totalCorrect = 0;
let predictionLog = [];

// ======================================================
// LOAD/SAVE STORAGE
// ======================================================
function loadStorage() {
    try {
        if (fs.existsSync(STORAGE_FILE)) {
            const raw = fs.readFileSync(STORAGE_FILE, 'utf8');
            const data = JSON.parse(raw);
            permanentStorage = { ...permanentStorage, ...data };
            cauMemoryBank = { ...cauMemoryBank, ...data.cauMemory };
            diceMemoryBank = { ...diceMemoryBank, ...data.diceMemory };
            scoreMemoryBank = { ...scoreMemoryBank, ...data.scoreMemory };
            patternMemoryBank = { ...patternMemoryBank, ...data.patternMemory };
            console.log('Storage loaded successfully');
        }
        if (fs.existsSync(HISTORY_FILE)) {
            const raw = fs.readFileSync(HISTORY_FILE, 'utf8');
            gameHistory = JSON.parse(raw) || [];
            console.log('Game history loaded:', gameHistory.length, 'sessions');
        }
    } catch (e) {
        console.log('Error loading storage:', e.message);
    }
}

function saveStorage() {
    try {
        permanentStorage.cauMemory = cauMemoryBank;
        permanentStorage.diceMemory = diceMemoryBank;
        permanentStorage.scoreMemory = scoreMemoryBank;
        permanentStorage.patternMemory = patternMemoryBank;
        permanentStorage.lastSave = Date.now();
        permanentStorage.totalSessions = gameHistory.length;
        fs.writeFileSync(STORAGE_FILE, JSON.stringify(permanentStorage, null, 2));
        fs.writeFileSync(HISTORY_FILE, JSON.stringify(gameHistory.slice(-5000), null, 2));
    } catch (e) {
        console.log('Error saving storage:', e.message);
    }
}

// ======================================================
// UPDATE FUNCTIONS
// ======================================================
function getScoreZone(score) {
    if (score >= 14) return 'ratCao';
    if (score >= 11) return 'cao';
    if (score >= 8) return 'trungBinh';
    if (score >= 5) return 'thap';
    return 'ratThap';
}

function updateDiceStats() {
    const calcStats = (obj) => {
        let values = [];
        for (let key in obj) {
            if (key !== 'stats' && typeof obj[key] === 'number') {
                for (let i = 0; i < obj[key]; i++) values.push(parseInt(key));
            }
        }
        if (values.length === 0) return { mean: 0, median: 0, mode: 0, std: 0, hot: 0, cold: 0 };
        values.sort((a, b) => a - b);
        let mean = values.reduce((a, b) => a + b, 0) / values.length;
        let median = values[Math.floor(values.length / 2)];
        let freq = {};
        values.forEach(v => freq[v] = (freq[v] || 0) + 1);
        let mode = parseInt(Object.entries(freq).sort((a, b) => b[1] - a[1])[0][0]);
        let variance = values.reduce((a, b) => a + Math.pow(b - mean, 2), 0) / values.length;
        let std = Math.sqrt(variance);
        let hot = parseInt(Object.entries(freq).sort((a, b) => b[1] - a[1])[0][0]);
        let cold = parseInt(Object.entries(freq).sort((a, b) => a[1] - b[1])[0][0]);
        return { mean, median, mode, std, hot, cold };
    };
    diceMemoryBank.x1.stats = calcStats(diceMemoryBank.x1);
    diceMemoryBank.x2.stats = calcStats(diceMemoryBank.x2);
    diceMemoryBank.x3.stats = calcStats(diceMemoryBank.x3);
    let tongValues = [];
    for (let t = 3; t <= 18; t++) {
        for (let i = 0; i < diceMemoryBank.tong[t]; i++) tongValues.push(t);
    }
    if (tongValues.length > 0) {
        tongValues.sort((a, b) => a - b);
        diceMemoryBank.tong.stats.mean = tongValues.reduce((a, b) => a + b, 0) / tongValues.length;
        diceMemoryBank.tong.stats.median = tongValues[Math.floor(tongValues.length / 2)];
        let freq = {};
        tongValues.forEach(v => freq[v] = (freq[v] || 0) + 1);
        diceMemoryBank.tong.stats.mode = parseInt(Object.entries(freq).sort((a, b) => b[1] - a[1])[0][0]);
    }
}

function addSession(session, result, totalScore, d1, d2, d3) {
    gameHistory.push({
        session,
        result,
        totalScore,
        d1,
        d2,
        d3,
        timestamp: Date.now()
    });
    // Update dice memory
    diceMemoryBank.x1[d1]++;
    diceMemoryBank.x2[d2]++;
    diceMemoryBank.x3[d3]++;
    diceMemoryBank.tong[totalScore]++;
    let p12 = d1 + '' + d2;
    let p23 = d2 + '' + d3;
    let p13 = d1 + '' + d3;
    diceMemoryBank.cap12.matrix[p12] = (diceMemoryBank.cap12.matrix[p12] || 0) + 1;
    diceMemoryBank.cap23.matrix[p23] = (diceMemoryBank.cap23.matrix[p23] || 0) + 1;
    diceMemoryBank.cap13.matrix[p13] = (diceMemoryBank.cap13.matrix[p13] || 0) + 1;
    let triple = d1 + '' + d2 + '' + d3;
    diceMemoryBank.triple.matrix[triple] = (diceMemoryBank.triple.matrix[triple] || 0) + 1;
    diceMemoryBank.triple.stats.total++;
    diceMemoryBank.triple.stats.uniqueTriples = Object.keys(diceMemoryBank.triple.matrix).length;
    let hl = (d1 >= 4 ? 'H' : 'L') + (d2 >= 4 ? 'H' : 'L') + (d3 >= 4 ? 'H' : 'L');
    diceMemoryBank.highLow[hl] = (diceMemoryBank.highLow[hl] || 0) + 1;
    let oe = (d1 % 2 === 0 ? 'C' : 'L') + (d2 % 2 === 0 ? 'C' : 'L') + (d3 % 2 === 0 ? 'C' : 'L');
    diceMemoryBank.oddEven[oe] = (diceMemoryBank.oddEven[oe] || 0) + 1;
    let primeCount = [d1, d2, d3].filter(x => [2, 3, 5].includes(x)).length;
    diceMemoryBank.prime[primeCount]++;
    let chenh = Math.max(d1, d2, d3) - Math.min(d1, d2, d3);
    diceMemoryBank.chenhLech[chenh]++;
    diceMemoryBank.tongCap.x1x2[d1 + d2]++;
    diceMemoryBank.tongCap.x2x3[d2 + d3]++;
    diceMemoryBank.tongCap.x1x3[d1 + d3]++;
    // Update transitions
    let n = gameHistory.length;
    if (n >= 2) {
        let prev = gameHistory[n - 2];
        if (diceMemoryBank.transition.x1[prev.d1]) diceMemoryBank.transition.x1[prev.d1][d1]++;
        if (diceMemoryBank.transition.x2[prev.d2]) diceMemoryBank.transition.x2[prev.d2][d2]++;
        if (diceMemoryBank.transition.x3[prev.d3]) diceMemoryBank.transition.x3[prev.d3][d3]++;
        let prevTriple = prev.d1 + '' + prev.d2 + '' + prev.d3;
        let key = prevTriple + '_to_' + triple;
        diceMemoryBank.tripleTransition[key] = (diceMemoryBank.tripleTransition[key] || 0) + 1;
    }
    // Update score memory
    if (n >= 2) {
        let prevScore = gameHistory[n - 2].totalScore;
        if (!scoreMemoryBank.afterScore[prevScore]) {
            scoreMemoryBank.afterScore[prevScore] = {};
            for (let i = 3; i <= 18; i++) scoreMemoryBank.afterScore[prevScore][i] = 0;
        }
        scoreMemoryBank.afterScore[prevScore][totalScore]++;
        if (!scoreMemoryBank.afterScoreResult[prevScore]) {
            scoreMemoryBank.afterScoreResult[prevScore] = { Tai: 0, Xiu: 0 };
        }
        scoreMemoryBank.afterScoreResult[prevScore][result]++;
        let prevZone = getScoreZone(prevScore);
        let currZone = getScoreZone(totalScore);
        let zoneKey = prevZone + '_' + currZone;
        scoreMemoryBank.zoneTransitions[zoneKey] = (scoreMemoryBank.zoneTransitions[zoneKey] || 0) + 1;
    }
    if (totalScore >= 14) scoreMemoryBank.scoreZones.ratCao++;
    else if (totalScore >= 11) scoreMemoryBank.scoreZones.cao++;
    else if (totalScore >= 8) scoreMemoryBank.scoreZones.trungBinh++;
    else if (totalScore >= 5) scoreMemoryBank.scoreZones.thap++;
    else scoreMemoryBank.scoreZones.ratThap++;
    if (totalScore === 3) scoreMemoryBank.specialScores.tong3++;
    if (totalScore === 4) scoreMemoryBank.specialScores.tong4++;
    if (totalScore === 17) scoreMemoryBank.specialScores.tong17++;
    if (totalScore === 18) scoreMemoryBank.specialScores.tong18++;
    // Update moving averages
    if (n >= 5) {
        let avg5 = gameHistory.slice(-5).map(h => h.totalScore).reduce((a, b) => a + b, 0) / 5;
        scoreMemoryBank.movingAvg.MA5.push(avg5);
        if (scoreMemoryBank.movingAvg.MA5.length > 5000) scoreMemoryBank.movingAvg.MA5.shift();
    }
    if (n >= 10) {
        let avg10 = gameHistory.slice(-10).map(h => h.totalScore).reduce((a, b) => a + b, 0) / 10;
        scoreMemoryBank.movingAvg.MA10.push(avg10);
        if (scoreMemoryBank.movingAvg.MA10.length > 5000) scoreMemoryBank.movingAvg.MA10.shift();
    }
    if (n >= 20) {
        let avg20 = gameHistory.slice(-20).map(h => h.totalScore).reduce((a, b) => a + b, 0) / 20;
        scoreMemoryBank.movingAvg.MA20.push(avg20);
        if (scoreMemoryBank.movingAvg.MA20.length > 5000) scoreMemoryBank.movingAvg.MA20.shift();
    }
    // Update cau memory
    let results = gameHistory.map(h => h.result);
    let streak = 1;
    for (let i = n - 2; i >= 0; i--) {
        if (results[i] === result) streak++;
        else break;
    }
    if (streak >= 3) {
        if (result === 'Tài') {
            cauMemoryBank.biet.Tai[streak] = (cauMemoryBank.biet.Tai[streak] || 0) + 1;
            cauMemoryBank.biet.stats.totalBietTai++;
            if (streak > cauMemoryBank.biet.stats.maxTai) cauMemoryBank.biet.stats.maxTai = streak;
        } else {
            cauMemoryBank.biet.Xiu[streak] = (cauMemoryBank.biet.Xiu[streak] || 0) + 1;
            cauMemoryBank.biet.stats.totalBietXiu++;
            if (streak > cauMemoryBank.biet.stats.maxXiu) cauMemoryBank.biet.stats.maxXiu = streak;
        }
    }
    // Update pattern memory
    let r = result === 'Tài' ? 'T' : 'X';
    for (let len of [3, 4, 5, 6, 7, 8, 9, 10]) {
        if (n >= len) {
            let pattern = results.slice(-len).join('');
            let key = 'p' + len;
            patternMemoryBank[key][pattern] = (patternMemoryBank[key][pattern] || 0) + 1;
        }
    }
    for (let len of [3, 4, 5, 6, 7, 8, 9, 10]) {
        if (n > len) {
            let pattern = results.slice(-len - 1, -1).join('');
            let nextKey = pattern + '->' + r;
            patternMemoryBank.patternNext[nextKey] = (patternMemoryBank.patternNext[nextKey] || 0) + 1;
        }
    }
    if (gameHistory.length % 100 === 0) updateDiceStats();
    if (gameHistory.length % 500 === 0) saveStorage();
}

// ======================================================
// ANALYZE CAU PATTERN
// ======================================================
function analyzeCauPattern(history) {
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
    for (let i = 1; i < last10.length; i++) {
        if (last10[i] === last10[i - 1]) {
            is11 = false;
            break;
        }
    }
    if (is11) cauTypes.push("Cầu 1-1");
    let is22 = true;
    for (let i = 0; i < last10.length - 1; i += 2) {
        if (last10[i] !== last10[i + 1]) {
            is22 = false;
            break;
        }
    }
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
// SUPER PREDICTION
// ======================================================
function predictSuper(history) {
    let n = history.length;
    if (n < 5) return {
        prediction: Math.random() < 0.5 ? 'Tài' : 'Xỉu',
        confidence: 50,
        reason: 'Chưa đủ dữ liệu'
    };
    let predictions = [];
    let results = history.map(h => h.result === 'Tài' ? 'T' : 'X');
    let lastResult = history[n - 1].result;
    let lastD1 = history[n - 1].x1 || history[n - 1].dice1 || history[n - 1].dices?.[0] || 0;
    let lastD2 = history[n - 1].x2 || history[n - 1].dice2 || history[n - 1].dices?.[1] || 0;
    let lastD3 = history[n - 1].x3 || history[n - 1].dice3 || history[n - 1].dices?.[2] || 0;
    let lastTriple = lastD1 + '' + lastD2 + '' + lastD3;
    let lastScore = history[n - 1].total || history[n - 1].tong || 0;
    // Pattern matching
    for (let len of [3, 4, 5, 6, 7, 8, 9, 10]) {
        if (n >= len) {
            let pattern = results.slice(-len).join('');
            let nextT = patternMemoryBank.patternNext[pattern + '->T'] || 0;
            let nextX = patternMemoryBank.patternNext[pattern + '->X'] || 0;
            let total = nextT + nextX;
            if (total >= 5) {
                let probT = nextT / total;
                predictions.push({
                    predict: probT > 0.5 ? 'Tài' : 'Xỉu',
                    confidence: Math.abs(probT - 0.5) * 2,
                    weight: 0.02 * len
                });
            }
        }
    }
    // Streak analysis
    let streak = 1;
    for (let i = n - 2; i >= 0; i--) {
        if (history[i].result === lastResult) streak++;
        else break;
    }
    if (streak >= 3) {
        let countLonger = 0,
            countThis = 0;
        for (let s = streak + 1; s <= Math.min(50, cauMemoryBank.biet.stats['max' + lastResult] || 50); s++) {
            countLonger += lastResult === 'Tài' ? (cauMemoryBank.biet.Tai[s] || 0) : (cauMemoryBank.biet.Xiu[s] || 0);
        }
        countThis = lastResult === 'Tài' ? (cauMemoryBank.biet.Tai[streak] || 0) : (cauMemoryBank.biet.Xiu[streak] || 0);
        let total = countThis + countLonger;
        if (total > 0) {
            let probContinue = countLonger / total;
            predictions.push({
                predict: probContinue > 0.5 ? lastResult : (lastResult === 'Tài' ? 'Xỉu' : 'Tài'),
                confidence: Math.abs(probContinue - 0.5) * 2 + 0.3,
                weight: 0.15
            });
        }
    }
    // Score analysis
    if (n >= 2 && scoreMemoryBank.afterScore[lastScore]) {
        let after = scoreMemoryBank.afterScore[lastScore];
        let totalAfter = 0,
            taiAfter = 0;
        for (let s = 3; s <= 18; s++) {
            totalAfter += after[s] || 0;
            if (s >= 11) taiAfter += after[s] || 0;
        }
        if (totalAfter >= 5) {
            let probT = taiAfter / totalAfter;
            predictions.push({
                predict: probT > 0.5 ? 'Tài' : 'Xỉu',
                confidence: Math.abs(probT - 0.5) + 0.3,
                weight: 0.1
            });
        }
    }
    // Triple transition
    let afterTriples = {};
    for (let key in diceMemoryBank.tripleTransition) {
        if (key.startsWith(lastTriple + '_to_')) {
            let nextT = key.split('_to_')[1];
            afterTriples[nextT] = diceMemoryBank.tripleTransition[key];
        }
    }
    if (Object.keys(afterTriples).length > 0) {
        let totalAfter = Object.values(afterTriples).reduce((a, b) => a + b, 0);
        let taiAfter = 0;
        for (let triple in afterTriples) {
            let sum = triple.split('').map(Number).reduce((a, b) => a + b, 0);
            if (sum >= 11) taiAfter += afterTriples[triple];
        }
        if (totalAfter >= 3) {
            let probT = taiAfter / totalAfter;
            predictions.push({
                predict: probT > 0.5 ? 'Tài' : 'Xỉu',
                confidence: Math.abs(probT - 0.5) + 0.4,
                weight: 0.08
            });
        }
    }
    // Dice transition
    let trans1 = diceMemoryBank.transition.x1[lastD1] || {};
    let trans2 = diceMemoryBank.transition.x2[lastD2] || {};
    let trans3 = diceMemoryBank.transition.x3[lastD3] || {};
    let maxD1 = 1,
        maxD2 = 1,
        maxD3 = 1,
        maxC1 = 0,
        maxC2 = 0,
        maxC3 = 0;
    for (let f = 1; f <= 6; f++) {
        if ((trans1[f] || 0) > maxC1) { maxC1 = trans1[f] || 0;
            maxD1 = f; }
        if ((trans2[f] || 0) > maxC2) { maxC2 = trans2[f] || 0;
            maxD2 = f; }
        if ((trans3[f] || 0) > maxC3) { maxC3 = trans3[f] || 0;
            maxD3 = f; }
    }
    let predTotal = maxD1 + maxD2 + maxD3;
    predictions.push({
        predict: predTotal >= 11 ? 'Tài' : 'Xỉu',
        confidence: 0.55,
        weight: 0.06
    });
    // Streak break
    if (streak >= 7) {
        predictions.push({
            predict: lastResult === 'Tài' ? 'Xỉu' : 'Tài',
            confidence: 0.7 + Math.min(0.2, (streak - 7) * 0.03),
            weight: 0.12
        });
    }
    // Moving average
    if (scoreMemoryBank.movingAvg.MA5.length >= 2) {
        let lastMA5 = scoreMemoryBank.movingAvg.MA5[scoreMemoryBank.movingAvg.MA5.length - 1];
        if (lastMA5 > 13) predictions.push({
            predict: 'Xỉu',
            confidence: 0.6,
            weight: 0.05
        });
        if (lastMA5 < 7) predictions.push({
            predict: 'Tài',
            confidence: 0.6,
            weight: 0.05
        });
    }
    // Weighted voting
    let weightedTai = 0,
        weightedXiu = 0,
        totalWeight = 0;
    for (let pred of predictions) {
        let w = pred.weight * pred.confidence;
        if (pred.predict === 'Tài') weightedTai += w;
        else if (pred.predict === 'Xỉu') weightedXiu += w;
        totalWeight += w;
    }
    if (totalWeight === 0) return {
        prediction: Math.random() < 0.5 ? 'Tài' : 'Xỉu',
        confidence: 50,
        reason: 'Không đủ tín hiệu'
    };
    let probTai = weightedTai / totalWeight;
    if (Math.abs(probTai - 0.5) < 0.04) return {
        prediction: 'CHO',
        confidence: 0,
        reason: 'Tín hiệu quá yếu'
    };
    let finalPrediction = probTai > 0.5 ? 'Tài' : 'Xỉu';
    let confidence = Math.round(Math.abs(probTai - 0.5) * 2 * 100);
    confidence = Math.max(52, Math.min(96, confidence));
    let topSources = predictions.sort((a, b) => b.weight * b.confidence - a.weight * a.confidence).slice(0, 5);
    let reason = topSources.map(s => s.source || 'model').join(', ');
    predictionLog.push({
        prediction: finalPrediction,
        actual: null,
        confidence,
        timestamp: Date.now()
    });
    if (predictionLog.length > 200) predictionLog.shift();
    saveStorage();
    return {
        prediction: finalPrediction,
        confidence,
        reason,
        totalSources: predictions.length
    };
}

// ======================================================
// MAIN PREDICT FUNCTION
// ======================================================
function getPrediction(history) {
    const latest = history[history.length - 1];
    const pattern = analyzeCauPattern(history);
    const predict = predictSuper(history);
    let duDoan = predict.prediction === 'Tài' ? 'tài' : 'xỉu';
    if (predict.prediction === 'CHO') duDoan = latest.ket_qua === 'tài' ? 'xỉu' : 'tài';
    return {
        id: "AnhKhoidzai Sunwin",
        phien_truoc: latest.phien,
        xuc_xac1: latest.x1 || latest.dice?.[0] || 0,
        xuc_xac2: latest.x2 || latest.dice?.[1] || 0,
        xuc_xac3: latest.x3 || latest.dice?.[2] || 0,
        tong: latest.tong || latest.total || 0,
        ket_qua: latest.ket_qua,
        pattern: pattern,
        phien_hien_tai: latest.phien + 1,
        du_doan: duDoan,
        do_tin_cay: predict.confidence + "%"
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
        // Feed into storage system
        const reversedHistory = [...history].reverse();
        for (let item of reversedHistory) {
            let exists = gameHistory.find(g => g.session === item.phien);
            if (!exists) {
                addSession(
                    item.phien,
                    item.result,
                    item.tong || item.total || (item.x1 + item.x2 + item.x3),
                    item.x1 || item.dice?.[0] || 0,
                    item.x2 || item.dice?.[1] || 0,
                    item.x3 || item.dice?.[2] || 0
                );
            }
        }
        if (history.length < 10) {
            return res.json({
                id: "AnhKhoidzai Sunwin",
                phien_truoc: history.length > 0 ? history[history.length - 1].phien : 0,
                xuc_xac1: history.length > 0 ? (history[history.length - 1].x1 || 0) : 0,
                xuc_xac2: history.length > 0 ? (history[history.length - 1].x2 || 0) : 0,
                xuc_xac3: history.length > 0 ? (history[history.length - 1].x3 || 0) : 0,
                tong: history.length > 0 ? (history[history.length - 1].tong || 0) : 0,
                ket_qua: history.length > 0 ? history[history.length - 1].ket_qua : "tài",
                pattern: "[Đang thu thập dữ liệu...]",
                phien_hien_tai: history.length > 0 ? history[history.length - 1].phien + 1 : 0,
                du_doan: "tài",
                do_tin_cay: "52%"
            });
        }
        const result = getPrediction(history);
        res.json(result);
    } catch (err) {
        console.log("Lỗi:", err.message);
        res.json({
            id: "AnhKhoidzai Sunwin",
            phien_truoc: 0,
            xuc_xac1: 0,
            xuc_xac2: 0,
            xuc_xac3: 0,
            tong: 0,
            ket_qua: "tài",
            pattern: "[Đang kết nối...]",
            phien_hien_tai: 0,
            du_doan: "tài",
            do_tin_cay: "52%"
        });
    }
});

app.get("/", async (req, res) => {
    try {
        const response = await axios.get(API_URL, { timeout: 10000 });
        const rawData = response.data;
        const dataArray = rawData.data || rawData || [];
        let history = normalizeData(Array.isArray(dataArray) ? dataArray : [dataArray]);
        const reversedHistory = [...history].reverse();
        for (let item of reversedHistory) {
            let exists = gameHistory.find(g => g.session === item.phien);
            if (!exists) {
                addSession(
                    item.phien,
                    item.result,
                    item.tong || item.total || (item.x1 + item.x2 + item.x3),
                    item.x1 || item.dice?.[0] || 0,
                    item.x2 || item.dice?.[1] || 0,
                    item.x3 || item.dice?.[2] || 0
                );
            }
        }
        if (history.length < 10) {
            return res.json({
                id: "AnhKhoidzai Sunwin",
                phien_truoc: history.length > 0 ? history[history.length - 1].phien : 0,
                xuc_xac1: history.length > 0 ? (history[history.length - 1].x1 || 0) : 0,
                xuc_xac2: history.length > 0 ? (history[history.length - 1].x2 || 0) : 0,
                xuc_xac3: history.length > 0 ? (history[history.length - 1].x3 || 0) : 0,
                tong: history.length > 0 ? (history[history.length - 1].tong || 0) : 0,
                ket_qua: history.length > 0 ? history[history.length - 1].ket_qua : "tài",
                pattern: "[Đang thu thập dữ liệu...]",
                phien_hien_tai: history.length > 0 ? history[history.length - 1].phien + 1 : 0,
                du_doan: "tài",
                do_tin_cay: "52%"
            });
        }
        const result = getPrediction(history);
        console.log(JSON.stringify(result, null, 2));
        res.json(result);
    } catch (err) {
        console.log("Lỗi:", err.message);
        res.json({
            id: "AnhKhoidzai Sunwin",
            phien_truoc: 0,
            xuc_xac1: 0,
            xuc_xac2: 0,
            xuc_xac3: 0,
            tong: 0,
            ket_qua: "tài",
            pattern: "[Đang kết nối...]",
            phien_hien_tai: 0,
            du_doan: "tài",
            do_tin_cay: "52%"
        });
    }
});

// ======================================================
// INIT
// ======================================================
loadStorage();
updateDiceStats();

app.listen(PORT, () => {
    console.log("========================================");
    console.log("  ULTIMATE TAI XIU PREDICTION SYSTEM");
    console.log(`  Server: http://localhost:${PORT}`);
    console.log("  Storage: FILE JSON (không reset)");
    console.log("  Pattern: [Cầu Tự Nhiên] hiển thị");
    console.log("  Độ tin cậy: 52% - 96%");
    console.log("========================================");
});
