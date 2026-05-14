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
                item.ket_qua ||
                item.result ||
                (tong >= 11 ? "tài" : "xỉu")
            ).toLowerCase();
            return {
                phien: item.phien || item.session || item.id || 0,
                x1: d1,
                x2: d2,
                x3: d3,
                xuc_xac_1: d1,
                xuc_xac_2: d2,
                xuc_xac_3: d3,
                tong: tong,
                ket_qua: ketQua === "tài" ? "tài" : "xỉu",
                result: ketQua === "tài" ? "Tài" : "Xỉu"
            };
        })
        .filter(item => item.phien > 0 && item.tong >= 3 && item.tong <= 18);
}

// ======================================================
// BO NHO CAU VINH VIEN
// ======================================================
let cauMemoryBank = {
    biet: {
        Tai: {},
        Xiu: {},
        stats: {
            maxTai: 0,
            maxXiu: 0,
            totalBietTai: 0,
            totalBietXiu: 0
        }
    },
    c11: { patterns: {}, stats: { total: 0 } },
    c22: { patterns: {}, stats: { total: 0 } },
    c33: { patterns: {}, stats: { total: 0 } },
    doiXung: { patterns: {}, stats: { total: 0 } },
    bacThang: { tang: {}, giam: {}, stats: { totalTang: 0, totalGiam: 0 } },
    tamGiac: { patterns: {}, stats: { total: 0 } },
    bietKep: { patterns: {}, stats: { total: 0 } },
    zigzag: { patterns: {}, stats: { total: 0 } }
};

// ======================================================
// BO NHO XUC XAC
// ======================================================
let diceMemoryBank = {
    x1: { 1: 0, 2: 0, 3: 0, 4: 0, 5: 0, 6: 0, stats: { hot: 0, cold: 0 } },
    x2: { 1: 0, 2: 0, 3: 0, 4: 0, 5: 0, 6: 0, stats: { hot: 0, cold: 0 } },
    x3: { 1: 0, 2: 0, 3: 0, 4: 0, 5: 0, 6: 0, stats: { hot: 0, cold: 0 } },
    tong: { 3: 0, 4: 0, 5: 0, 6: 0, 7: 0, 8: 0, 9: 0, 10: 0, 11: 0, 12: 0, 13: 0, 14: 0, 15: 0, 16: 0, 17: 0, 18: 0 },
    triple: { matrix: {}, stats: { total: 0 } },
    tripleTransition: {},
    transition: {
        x1: Array.from({ length: 7 }, () => ({ 1: 0, 2: 0, 3: 0, 4: 0, 5: 0, 6: 0 })),
        x2: Array.from({ length: 7 }, () => ({ 1: 0, 2: 0, 3: 0, 4: 0, 5: 0, 6: 0 })),
        x3: Array.from({ length: 7 }, () => ({ 1: 0, 2: 0, 3: 0, 4: 0, 5: 0, 6: 0 }))
    }
};

// ======================================================
// BO NHO PATTERN
// ======================================================
let patternMemoryBank = {
    p3: {}, p4: {}, p5: {}, p6: {}, p7: {},
    p8: {}, p9: {}, p10: {},
    patternNext: {}
};

// ======================================================
// BO NHO SCORE
// ======================================================
let scoreMemoryBank = {
    afterScore: {},
    afterScoreResult: {}
};

// ======================================================
// ADVANCED CAU ENGINE
// ======================================================
let advancedCauEngine = {
    cauDatabase: {
        biet: { patterns: [], stats: {} },
        c11: { patterns: [] },
        c22: { patterns: [] },
        c33: { patterns: [] },
        c1212: { patterns: [] },
        c1122: { patterns: [] },
        c1221: { patterns: [] },
        c123: { patterns: [] },
        c321: { patterns: [] },
        doiXung: { patterns: [] },
        zigzag: { patterns: [] },
        bacThang: { patterns: [] },
        tamGiac: { patterns: [] },
        bietKep: { patterns: [] },
        vaiDauVai: { patterns: [] },
        haiDinh: { patterns: [] },
        haiDay: { patterns: [] }
    },

    analyzeCau(history) {
        let n = history.length;
        if (n < 5) return;
        let results = history.map(h => h.result === 'Tài' ? 'T' : 'X');
        let scores = history.map(h => h.tong);
        this.detectBiet(results, n);
        this.detectAlternating(results, n);
        this.detectComplex(results, n);
        this.detectSpecial(results, scores, n);
    },

    detectBiet(results, n) {
        let streak = 1;
        let currentResult = results[n - 1];
        for (let i = n - 2; i >= 0; i--) {
            if (results[i] === currentResult) streak++;
            else break;
        }
        if (streak >= 3) {
            this.cauDatabase.biet.patterns.push({
                type: currentResult === 'T' ? 'Tai' : 'Xiu',
                length: streak,
                strength: Math.min(1, streak / 10)
            });
        }
    },

    detectAlternating(results, n) {
        if (n >= 6) {
            let is11 = true;
            for (let i = n - 5; i < n; i++) {
                if (results[i] === results[i - 1]) { is11 = false; break; }
            }
            if (is11) {
                this.cauDatabase.c11.patterns.push({ length: 6, strength: 0.7 });
            }
        }
        if (n >= 8) {
            let last8 = results.slice(-8);
            let is22 = true;
            for (let i = 0; i < 8; i += 2) {
                if (last8[i] !== last8[i + 1]) { is22 = false; break; }
            }
            if (is22 && last8[0] !== last8[2]) {
                this.cauDatabase.c22.patterns.push({ strength: 0.75 });
            }
        }
    },

    detectComplex(results, n) {
        if (n >= 12) {
            let template123 = ['T', 'X', 'X', 'T', 'T', 'T'];
            let template321 = ['T', 'T', 'T', 'X', 'X', 'T'];
            for (let start = 0; start <= n - 6; start++) {
                let match123 = true;
                let match321 = true;
                for (let i = 0; i < 6; i++) {
                    if (results[start + i] !== template123[i]) match123 = false;
                    if (results[start + i] !== template321[i]) match321 = false;
                }
                if (match123) this.cauDatabase.c123.patterns.push({ confidence: 0.7 });
                if (match321) this.cauDatabase.c321.patterns.push({ confidence: 0.7 });
                if (match123 || match321) break;
            }
        }
    },

    detectSpecial(results, scores, n) {
        if (n >= 10) {
            let mid = Math.floor(n / 2);
            let left = results.slice(0, mid);
            let right = results.slice(mid).reverse();
            let matches = 0;
            for (let i = 0; i < Math.min(left.length, right.length); i++) {
                if (left[i] === right[i]) matches++;
            }
            let ratio = matches / Math.min(left.length, right.length);
            if (ratio >= 0.7) {
                this.cauDatabase.doiXung.patterns.push({ ratio, confidence: 0.6 + ratio * 0.2 });
            }
        }
        if (n >= 9) {
            let switches = 0;
            for (let i = n - 8; i < n; i++) {
                if (results[i] !== results[i - 1]) switches++;
            }
            if (switches >= 6) {
                this.cauDatabase.zigzag.patterns.push({ switches, confidence: 0.55 + switches * 0.04 });
            }
        }
    }
};

// ======================================================
// ADVANCED DICE ENGINE
// ======================================================
let advancedDiceEngine = {
    predict(history) {
        if (history.length < 3) return null;
        let last = history[history.length - 1];
        let ld1 = last.x1, ld2 = last.x2, ld3 = last.x3;
        let predD1 = this.predictDice(1, ld1);
        let predD2 = this.predictDice(2, ld2);
        let predD3 = this.predictDice(3, ld3);
        let sum = predD1.face + predD2.face + predD3.face;
        let confidence = (predD1.conf + predD2.conf + predD3.conf) / 3;
        return {
            dice: [predD1.face, predD2.face, predD3.face],
            sum: sum,
            predict: sum >= 11 ? 'Tài' : 'Xỉu',
            confidence: confidence
        };
    },

    predictDice(diceIndex, currentValue) {
        let key = 'x' + diceIndex;
        let trans = diceMemoryBank.transition[key][currentValue] || {};
        let total = Object.values(trans).reduce((a, b) => a + b, 0);
        let scores = [];
        for (let f = 1; f <= 6; f++) {
            let score = 0;
            if (total > 0) score += ((trans[f] || 0) / total) * 0.4;
            let freqTotal = Object.values(diceMemoryBank[key]).reduce((a, b) => a + b, 0);
            if (freqTotal > 0) score += ((diceMemoryBank[key][f] || 0) / freqTotal) * 0.3;
            score += Math.random() * 0.3;
            scores.push({ face: f, score: score });
        }
        scores.sort((a, b) => b.score - a.score);
        return {
            face: scores[0].face,
            conf: Math.min(0.85, scores[0].score * 0.8 + 0.2)
        };
    }
};

// ======================================================
// HE THONG HOC 50 PHIEN
// ======================================================
let learningSystem = {
    trainedAt: 0,
    totalTrained: 0,
    ready: false,
    trainingData: [],
    models: {},
    weights: {},

    learn(history) {
        if (history.length < 50) {
            this.ready = false;
            return;
        }
        this.trainingData = history.slice(-50);
        this.totalTrained = history.length;
        this.trainedAt = Date.now();
        this.trainMarkov();
        this.trainPattern();
        this.trainScore();
        this.trainStreak();
        this.trainCycle();
        this.optimizeWeights();
        this.ready = true;
    },

    trainMarkov() {
        let models = {};
        for (let order of [3, 5, 7, 10]) {
            let matrix = {};
            for (let i = 0; i < this.trainingData.length - order; i++) {
                let state = this.trainingData.slice(i, i + order).map(h => h.result).join(',');
                let next = this.trainingData[i + order].result;
                if (!matrix[state]) matrix[state] = { Tài: 0, Xỉu: 0 };
                matrix[state][next]++;
            }
            models['markov_' + order] = matrix;
        }
        this.models.markov = models;
    },

    trainPattern() {
        let patterns = {};
        let results = this.trainingData.map(h => h.result === 'Tài' ? 'T' : 'X');
        for (let len of [5, 7, 10]) {
            let table = {};
            for (let i = 0; i < results.length - len; i++) {
                let pattern = results.slice(i, i + len).join('');
                let next = results[i + len];
                let key = pattern + '->' + next;
                table[key] = (table[key] || 0) + 1;
            }
            patterns['p' + len] = table;
        }
        this.models.patterns = patterns;
    },

    trainScore() {
        let scoreModel = { afterResult: {} };
        for (let i = 0; i < this.trainingData.length - 1; i++) {
            let currScore = this.trainingData[i].tong;
            let nextResult = this.trainingData[i + 1].result;
            if (!scoreModel.afterResult[currScore]) {
                scoreModel.afterResult[currScore] = { Tài: 0, Xỉu: 0 };
            }
            scoreModel.afterResult[currScore][nextResult]++;
        }
        this.models.score = scoreModel;
    },

    trainStreak() {
        let streakModel = { tai: {}, xiu: {} };
        let results = this.trainingData.map(h => h.result);
        let streak = 1;
        for (let i = 1; i < results.length; i++) {
            if (results[i] === results[i - 1]) streak++;
            else {
                let type = results[i - 1] === 'Tài' ? 'tai' : 'xiu';
                streakModel[type][streak] = (streakModel[type][streak] || 0) + 1;
                streak = 1;
            }
        }
        let lastType = results[results.length - 1] === 'Tài' ? 'tai' : 'xiu';
        streakModel[lastType][streak] = (streakModel[lastType][streak] || 0) + 1;
        this.models.streak = streakModel;
    },

    trainCycle() {
        let cycleModel = { cycles: {} };
        let results = this.trainingData.map(h => h.result === 'Tài' ? 1 : 0);
        for (let lag = 2; lag <= 10; lag++) {
            let matches = 0;
            let total = 0;
            for (let i = lag; i < results.length; i++) {
                if (results[i] === results[i - lag]) matches++;
                total++;
            }
            if (total > 0) cycleModel.cycles[lag] = matches / total;
        }
        this.models.cycle = cycleModel;
    },

    optimizeWeights() {
        this.weights = {
            markov_5: 0.15,
            markov_7: 0.12,
            markov_10: 0.1,
            pattern_5: 0.08,
            pattern_7: 0.08,
            pattern_10: 0.06,
            score: 0.06,
            streak: 0.08,
            cycle: 0.07
        };
    },

    predictInternal(history) {
        if (history.length < 3) return null;
        let n = history.length;
        let last = history[n - 1];
        let predictions = [];

        for (let order of [5, 7, 10]) {
            let matrix = this.models.markov['markov_' + order];
            if (matrix && n >= order) {
                let state = history.slice(-order).map(h => h.result).join(',');
                if (matrix[state]) {
                    let counts = matrix[state];
                    let total = counts.Tài + counts.Xỉu;
                    if (total >= 2) {
                        let prob = counts.Tài / total;
                        predictions.push({
                            predict: prob > 0.5 ? 'Tài' : 'Xỉu',
                            confidence: Math.abs(prob - 0.5) * 2,
                            weight: this.weights['markov_' + order] || 0.1
                        });
                    }
                }
            }
        }

        let results = history.map(h => h.result === 'Tài' ? 'T' : 'X');
        for (let len of [5, 7, 10]) {
            if (n >= len && this.models.patterns['p' + len]) {
                let pattern = results.slice(-len).join('');
                let nextT = this.models.patterns['p' + len][pattern + '->T'] || 0;
                let nextX = this.models.patterns['p' + len][pattern + '->X'] || 0;
                let total = nextT + nextX;
                if (total >= 2) {
                    let prob = nextT / total;
                    predictions.push({
                        predict: prob > 0.5 ? 'Tài' : 'Xỉu',
                        confidence: Math.abs(prob - 0.5) * 2,
                        weight: this.weights['pattern_' + len] || 0.06
                    });
                }
            }
        }

        if (this.models.score && this.models.score.afterResult[last.tong]) {
            let counts = this.models.score.afterResult[last.tong];
            let total = counts.Tài + counts.Xỉu;
            if (total >= 2) {
                let prob = counts.Tài / total;
                predictions.push({
                    predict: prob > 0.5 ? 'Tài' : 'Xỉu',
                    confidence: Math.abs(prob - 0.5) * 2,
                    weight: this.weights.score || 0.06
                });
            }
        }

        let streak = 1;
        for (let i = n - 2; i >= 0; i--) {
            if (history[i].result === last.result) streak++;
            else break;
        }
        if (streak >= 3 && this.models.streak) {
            let type = last.result === 'Tài' ? 'tai' : 'xiu';
            let countThis = this.models.streak[type][streak] || 0;
            let countLonger = 0;
            for (let s = streak + 1; s <= 10; s++) countLonger += this.models.streak[type][s] || 0;
            let total = countThis + countLonger;
            if (total >= 2) {
                let probContinue = countLonger / total;
                predictions.push({
                    predict: probContinue > 0.5 ? last.result : (last.result === 'Tài' ? 'Xỉu' : 'Tài'),
                    confidence: Math.abs(probContinue - 0.5) * 2 + 0.2,
                    weight: this.weights.streak || 0.08
                });
            }
        }

        if (this.models.cycle) {
            let bestLag = 0, bestAcc = 0;
            for (let lag in this.models.cycle.cycles) {
                if (this.models.cycle.cycles[lag] > bestAcc) {
                    bestAcc = this.models.cycle.cycles[lag];
                    bestLag = parseInt(lag);
                }
            }
            if (bestLag > 0 && n > bestLag) {
                predictions.push({
                    predict: history[n - 1 - bestLag].result,
                    confidence: bestAcc * 0.7,
                    weight: this.weights.cycle || 0.04
                });
            }
        }

        return this.ensemble(predictions);
    },

    ensemble(predictions) {
        if (predictions.length === 0) return null;
        let weightedTai = 0, weightedXiu = 0, totalWeight = 0;
        for (let pred of predictions) {
            let w = pred.weight * pred.confidence;
            if (pred.predict === 'Tài') weightedTai += w;
            else if (pred.predict === 'Xỉu') weightedXiu += w;
            totalWeight += w;
        }
        if (totalWeight === 0) return null;
        let probTai = weightedTai / totalWeight;
        return {
            prediction: probTai > 0.5 ? 'Tài' : 'Xỉu',
            confidence: Math.abs(probTai - 0.5) * 2,
            probTai: probTai
        };
    }
};

// ======================================================
// CAP NHAT BO NHO
// ======================================================
function updateAllMemory(history) {
    let n = history.length;
    if (n < 2) return;
    let last = history[n - 1];
    let prev = history[n - 2];

    // Update dice
    diceMemoryBank.x1[last.x1] = (diceMemoryBank.x1[last.x1] || 0) + 1;
    diceMemoryBank.x2[last.x2] = (diceMemoryBank.x2[last.x2] || 0) + 1;
    diceMemoryBank.x3[last.x3] = (diceMemoryBank.x3[last.x3] || 0) + 1;
    diceMemoryBank.tong[last.tong] = (diceMemoryBank.tong[last.tong] || 0) + 1;

    let triple = last.x1 + '' + last.x2 + '' + last.x3;
    diceMemoryBank.triple.matrix[triple] = (diceMemoryBank.triple.matrix[triple] || 0) + 1;
    diceMemoryBank.triple.stats.total++;

    let prevTriple = prev.x1 + '' + prev.x2 + '' + prev.x3;
    let key = prevTriple + '_to_' + triple;
    diceMemoryBank.tripleTransition[key] = (diceMemoryBank.tripleTransition[key] || 0) + 1;

    if (diceMemoryBank.transition.x1[prev.x1]) diceMemoryBank.transition.x1[prev.x1][last.x1]++;
    if (diceMemoryBank.transition.x2[prev.x2]) diceMemoryBank.transition.x2[prev.x2][last.x2]++;
    if (diceMemoryBank.transition.x3[prev.x3]) diceMemoryBank.transition.x3[prev.x3][last.x3]++;

    // Update score
    if (!scoreMemoryBank.afterScore[prev.tong]) {
        scoreMemoryBank.afterScore[prev.tong] = {};
        scoreMemoryBank.afterScoreResult[prev.tong] = { Tài: 0, Xỉu: 0 };
    }
    scoreMemoryBank.afterScore[prev.tong][last.tong] = (scoreMemoryBank.afterScore[prev.tong][last.tong] || 0) + 1;
    scoreMemoryBank.afterScoreResult[prev.tong][last.result]++;

    // Update pattern
    let results = history.map(h => h.result === 'Tài' ? 'T' : 'X');
    let r = results[results.length - 1];
    for (let len of [3, 5, 7, 10]) {
        if (n >= len) {
            let pattern = results.slice(-len).join('');
            let pKey = 'p' + len;
            patternMemoryBank[pKey][pattern] = (patternMemoryBank[pKey][pattern] || 0) + 1;
        }
        if (n > len) {
            let pattern = results.slice(-len - 1, -1).join('');
            let nextKey = pattern + '->' + r;
            patternMemoryBank.patternNext[nextKey] = (patternMemoryBank.patternNext[nextKey] || 0) + 1;
        }
    }

    // Update cau memory
    let streak = 1;
    let lastResult = results[n - 1];
    for (let i = n - 2; i >= 0; i--) {
        if (results[i] === lastResult) streak++;
        else break;
    }
    if (streak >= 3) {
        if (lastResult === 'T') {
            cauMemoryBank.biet.Tai[streak] = (cauMemoryBank.biet.Tai[streak] || 0) + 1;
            cauMemoryBank.biet.stats.totalBietTai++;
            if (streak > cauMemoryBank.biet.stats.maxTai) cauMemoryBank.biet.stats.maxTai = streak;
        } else {
            cauMemoryBank.biet.Xiu[streak] = (cauMemoryBank.biet.Xiu[streak] || 0) + 1;
            cauMemoryBank.biet.stats.totalBietXiu++;
            if (streak > cauMemoryBank.biet.stats.maxXiu) cauMemoryBank.biet.stats.maxXiu = streak;
        }
    }
}

// ======================================================
// PHAN TICH CAU
// ======================================================
function analyzeCauDetail(history) {
    if (history.length < 10) return "[Đang thu thập dữ liệu...]";
    let last10 = history.slice(-10).map(h => h.ket_qua === "tài" ? "t" : "x");
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
    for (let i = 1; i < last10.length; i++) {
        if (last10[i] === last10[i - 1]) { is11 = false; break; }
    }
    if (is11) cauTypes.push("Cầu 1-1");
    let is22 = true;
    for (let i = 0; i < last10.length - 1; i += 2) {
        if (last10[i] !== last10[i + 1]) { is22 = false; break; }
    }
    if (is22 && last10[0] !== last10[2]) cauTypes.push("Cầu 2-2");
    let taiCount = last10.filter(r => r === 't').length;
    let xiuCount = 10 - taiCount;
    if (cauTypes.length === 0) {
        if (taiCount >= 7) cauTypes.push("Xu hướng Tài mạnh");
        else if (xiuCount >= 7) cauTypes.push("Xu hướng Xỉu mạnh");
        else if (taiCount >= 6) cauTypes.push("Nghiêng Tài");
        else if (xiuCount >= 6) cauTypes.push("Nghiêng Xỉu");
        else cauTypes.push("Cân bằng");
    }
    return "[Cầu " + cauTypes.join(', ') + "] - " + patternStr;
}

// ======================================================
// DU DOAN TONG HOP
// ======================================================
function finalPredict(history) {
    if (history.length < 5) {
        return { duDoan: "tài", doTinCay: 52 };
    }

    // Train learning system if needed
    if (history.length >= 50 && (!learningSystem.ready || history.length - learningSystem.totalTrained >= 20)) {
        learningSystem.learn(history);
    }

    // Analyze cau
    advancedCauEngine.analyzeCau(history);

    let allPredictions = [];

    // Learning system prediction
    if (learningSystem.ready) {
        let lsResult = learningSystem.predictInternal(history);
        if (lsResult) {
            allPredictions.push({
                predict: lsResult.prediction === 'Tài' ? 'tài' : 'xỉu',
                confidence: lsResult.confidence,
                weight: 0.35
            });
        }
    }

    // Dice prediction
    let diceResult = advancedDiceEngine.predict(history);
    if (diceResult) {
        allPredictions.push({
            predict: diceResult.predict === 'Tài' ? 'tài' : 'xỉu',
            confidence: diceResult.confidence,
            weight: 0.25
        });
    }

    // Cau prediction
    let last10 = history.slice(-10).map(h => h.ket_qua === "tài" ? "t" : "x");
    let taiCount = last10.filter(r => r === 't').length;
    let xiuCount = 10 - taiCount;

    if (taiCount >= 7) {
        allPredictions.push({ predict: 'xỉu', confidence: 0.7, weight: 0.2 });
    } else if (xiuCount >= 7) {
        allPredictions.push({ predict: 'tài', confidence: 0.7, weight: 0.2 });
    } else if (taiCount >= 6) {
        allPredictions.push({ predict: 'tài', confidence: 0.55, weight: 0.1 });
    } else if (xiuCount >= 6) {
        allPredictions.push({ predict: 'xỉu', confidence: 0.55, weight: 0.1 });
    }

    // Streak prediction
    let lastResult = history[history.length - 1].result;
    let streak = 1;
    for (let i = history.length - 2; i >= 0; i--) {
        if (history[i].result === lastResult) streak++;
        else break;
    }
    if (streak >= 5) {
        allPredictions.push({
            predict: lastResult === 'Tài' ? 'xỉu' : 'tài',
            confidence: 0.75,
            weight: 0.2
        });
    } else if (streak >= 3) {
        allPredictions.push({
            predict: lastResult === 'Tài' ? 'xỉu' : 'tài',
            confidence: 0.6,
            weight: 0.15
        });
    }

    // Ensemble
    let weightedTai = 0, weightedXiu = 0, totalWeight = 0;
    for (let pred of allPredictions) {
        let w = pred.weight * pred.confidence;
        if (pred.predict === 'tài') weightedTai += w;
        else weightedXiu += w;
        totalWeight += w;
    }

    if (totalWeight === 0) return { duDoan: "tài", doTinCay: 52 };

    let duDoan = weightedTai > weightedXiu ? "tài" : "xỉu";
    let doTinCay = Math.round((Math.max(weightedTai, weightedXiu) / totalWeight) * 100);
    doTinCay = Math.max(52, Math.min(96, doTinCay));

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
        let history = normalizeData(Array.isArray(dataArray) ? dataArray : [dataArray]);

        if (history.length < 3) {
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

        updateAllMemory(history);
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
        let history = normalizeData(Array.isArray(dataArray) ? dataArray : [dataArray]);

        if (history.length < 3) {
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

        updateAllMemory(history);
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
    console.log("Server chạy tại port " + PORT);
});
