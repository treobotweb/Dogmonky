const express = require("express");
const axios = require("axios");

const app = express();

const PORT = process.env.PORT || 3000;

const API_URL =
    "https://sunlol-zv7x.onrender.com/api/history";

// ======================================================
// FORMAT DATA
// ======================================================

function normalizeData(data) {

    return data.map(item => {

        const tong =
            item.tong ||
            item.total ||
            (
                (item.x1 || 0) +
                (item.x2 || 0) +
                (item.x3 || 0)
            );

        return {

            phien:
                item.phien ||
                item.session ||
                0,

            result:
                item.ket_qua ||
                item.result ||
                (tong >= 11 ? "Tài" : "Xỉu"),

            tong,

            dices: [
                item.x1 || 0,
                item.x2 || 0,
                item.x3 || 0
            ]
        };
    });
}

// ======================================================
// THUẬT TOÁN 1
// PHÂN TÍCH XU HƯỚNG + ĐIỂM CHUYỂN
// ======================================================

function predictTrendAndSwitch(history) {

    if (!history || history.length < 5) {

        return {
            prediction: 0,
            confidence: 0
        };
    }

    const recent =
        history
            .slice(-5)
            .map(h => h.result);

    let taiCount =
        recent.filter(
            r => r === "Tài"
        ).length;

    let xiuCount =
        recent.filter(
            r => r === "Xỉu"
        ).length;

    let prediction = 0;

    if (taiCount > xiuCount)
        prediction = 1;

    else if (xiuCount > taiCount)
        prediction = 2;

    return {

        prediction,

        confidence:
            Math.max(
                taiCount,
                xiuCount
            ) / 5
    };
}

// ======================================================
// THUẬT TOÁN 2
// STREAK + BREAK
// ======================================================

function detectStreakAndBreak(history) {

    if (
        !history ||
        history.length === 0
    ) {

        return {

            streak: 0,

            currentResult: null,

            breakProb: 0,

            prediction: 0
        };
    }

    let streak = 1;

    const currentResult =
        history[
            history.length - 1
        ].result;

    for (
        let i =
            history.length - 2;
        i >= 0;
        i--
    ) {

        if (
            history[i].result ===
            currentResult
        ) {
            streak++;
        } else {
            break;
        }
    }

    const last20 =
        history
            .slice(-20)
            .map(h => h.result);

    const switches =
        last20
            .slice(1)
            .reduce(
                (
                    count,
                    curr,
                    idx
                ) => {

                    return count +
                        (
                            curr !==
                            last20[idx]
                                ? 1
                                : 0
                        );
                },
                0
            );

    const taiCount =
        last20.filter(
            r => r === "Tài"
        ).length;

    const xiuCount =
        last20.filter(
            r => r === "Xỉu"
        ).length;

    const imbalance =
        Math.abs(
            taiCount - xiuCount
        ) / last20.length;

    let breakProb = 0;

    if (streak >= 8) {

        breakProb =
            Math.min(
                0.6 +
                    switches / 20 +
                    imbalance * 0.15,
                0.95
            );

    } else if (streak >= 4) {

        breakProb =
            Math.min(
                0.4 +
                    switches / 30 +
                    imbalance * 0.1,
                0.7
            );

    } else {

        breakProb = 0.2;
    }

    let prediction =
        currentResult === "Tài"
            ? 1
            : 2;

    if (breakProb > 0.5) {

        prediction =
            prediction === 1
                ? 2
                : 1;
    }

    return {

        streak,

        currentResult,

        breakProb,

        prediction
    };
}

// ======================================================
// THUẬT TOÁN 3
// PATTERN
// ======================================================

function predictAIHTDD(history) {

    if (
        !history ||
        history.length < 3
    ) {

        return {
            prediction: "Tài",
            confidence: 0
        };
    }

    const last3 =
        history
            .slice(-3)
            .map(h => h.result)
            .join("-");

    const patterns = {

        "Tài-Tài-Tài":
            "Xỉu",

        "Xỉu-Xỉu-Xỉu":
            "Tài",

        "Tài-Xỉu-Tài":
            "Xỉu",

        "Xỉu-Tài-Xỉu":
            "Tài",

        "Tài-Tài-Xỉu":
            "Xỉu",

        "Xỉu-Xỉu-Tài":
            "Tài"
    };

    return {

        prediction:
            patterns[last3] ||
            (
                Math.random() > 0.5
                    ? "Tài"
                    : "Xỉu"
            ),

        confidence: 0.6
    };
}

// ======================================================
// BAD PATTERN
// ======================================================

function isBadPattern(history) {

    if (history.length < 5)
        return false;

    const last5 =
        history
            .slice(-5)
            .map(h => h.result)
            .join("");

    return (
        last5 ===
            "TàiXỉuTàiXỉuTài" ||

        last5 ===
            "XỉuTàiXỉuTàiXỉu"
    );
}

// ======================================================
// MARKOV
// ======================================================

function predictMarkov(history) {

    const arr =
        history.map(h =>
            h.result === "Tài"
                ? "T"
                : "X"
        );

    const seq =
        arr.join("");

    if (seq.length < 4)
        return null;

    let best = null;

    let bestConf = 0;

    for (
        let order = 3;
        order <= 5;
        order++
    ) {

        const last =
            seq.slice(-order);

        const trans = {};

        for (
            let i = 0;
            i <=
            seq.length -
                order -
                1;
            i++
        ) {

            const pat =
                seq.slice(
                    i,
                    i + order
                );

            const next =
                seq[i + order];

            if (!trans[pat]) {

                trans[pat] = {
                    T: 0,
                    X: 0
                };
            }

            trans[pat][next]++;
        }

        const possible =
            trans[last];

        if (!possible)
            continue;

        const total =
            possible.T +
            possible.X;

        const conf =
            (
                Math.max(
                    possible.T,
                    possible.X
                ) / total
            ) * 100;

        if (conf > bestConf) {

            bestConf = conf;

            best =
                possible.T >
                possible.X
                    ? "Tài"
                    : "Xỉu";
        }
    }

    return best
        ? {
              prediction: best,
              confidence:
                  bestConf / 100
          }
        : null;
}

// ======================================================
// ENSEMBLE FULL
// ======================================================

function getEnsemblePrediction(history) {

    const trendPred =
        predictTrendAndSwitch(
            history
        );

    const bridgePred =
        detectStreakAndBreak(
            history
        );

    const aiPred =
        predictAIHTDD(
            history
        );

    const markovPred =
        predictMarkov(
            history
        );

    const weights = {

        trend: 0.25,

        bridge: 0.25,

        pattern: 0.2,

        markov: 0.3
    };

    let taiScore = 0;

    let xiuScore = 0;

    // TREND
    if (
        trendPred.prediction === 1
    ) {

        taiScore +=
            weights.trend *
            trendPred.confidence;

    } else if (
        trendPred.prediction === 2
    ) {

        xiuScore +=
            weights.trend *
            trendPred.confidence;
    }

    // BREAK
    if (
        bridgePred.prediction ===
        1
    ) {

        taiScore +=
            weights.bridge *
            (
                1 -
                bridgePred.breakProb
            );

    } else {

        xiuScore +=
            weights.bridge *
            (
                1 -
                bridgePred.breakProb
            );
    }

    // PATTERN
    if (
        aiPred.prediction ===
        "Tài"
    ) {

        taiScore +=
            weights.pattern *
            aiPred.confidence;

    } else {

        xiuScore +=
            weights.pattern *
            aiPred.confidence;
    }

    // MARKOV
    if (markovPred) {

        if (
            markovPred.prediction ===
            "Tài"
        ) {

            taiScore +=
                weights.markov *
                markovPred.confidence;

        } else {

            xiuScore +=
                weights.markov *
                markovPred.confidence;
        }
    }

    // BAD PATTERN
    if (
        isBadPattern(history)
    ) {

        taiScore *= 0.9;

        xiuScore *= 0.9;
    }

    // CÂN BẰNG
    const last10 =
        history
            .slice(-10)
            .map(h => h.result);

    const tai10 =
        last10.filter(
            r => r === "Tài"
        ).length;

    if (tai10 >= 7) {

        xiuScore += 0.15;

    } else if (tai10 <= 3) {

        taiScore += 0.15;
    }

    const total =
        taiScore + xiuScore;

    const finalPred =
        taiScore > xiuScore
            ? "Tài"
            : "Xỉu";

    const confidence =
        total > 0
            ? (
                  Math.max(
                      taiScore,
                      xiuScore
                  ) / total
              ) * 100
            : 50;

    return {

        prediction:
            finalPred,

        confidence:
            Math.round(
                confidence
            ),

        streak:
            bridgePred.streak
    };
}

// ======================================================
// STATS
// ======================================================

function calculateStats(history) {

    const arr =
        history.map(
            h => h.result
        );

    let currentWin = 1;

    let currentLose = 1;

    let maxWin = 1;

    let maxLose = 1;

    const last =
        arr[arr.length - 1];

    for (
        let i = arr.length - 2;
        i >= 0;
        i--
    ) {

        if (arr[i] === last)
            currentWin++;

        else
            break;
    }

    for (
        let i = arr.length - 2;
        i >= 0;
        i--
    ) {

        if (arr[i] !== last)
            currentLose++;

        else
            break;
    }

    let tempWin = 1;

    let tempLose = 1;

    for (
        let i = 1;
        i < arr.length;
        i++
    ) {

        if (
            arr[i] ===
            arr[i - 1]
        ) {

            tempWin++;

            maxWin =
                Math.max(
                    maxWin,
                    tempWin
                );

        } else {

            tempWin = 1;
        }

        if (
            arr[i] !==
            arr[i - 1]
        ) {

            tempLose++;

            maxLose =
                Math.max(
                    maxLose,
                    tempLose
                );

        } else {

            tempLose = 1;
        }
    }

    return {

        chuoi_thang_hien_tai:
            currentWin,

        chuoi_thang_max:
            maxWin,

        chuoi_thua_hien_tai:
            currentLose,

        chuoi_thua_max:
            maxLose
    };
}

// ======================================================
// API
// ======================================================

app.get("/taixiu", async (req, res) => {

    try {

        const response =
            await axios.get(
                API_URL
            );

        const rawData =
            response.data;

        const history =
            normalizeData(
                rawData
            );

        if (
            history.length < 10
        ) {

            return res.json({
                error:
                    "Không đủ dữ liệu"
            });
        }

        const latest =
            history[
                history.length - 1
            ];

        const predict =
            getEnsemblePrediction(
                history
            );

        const stats =
            calculateStats(
                history
            );

        res.json({

            phien:
                latest.phien + 1,

            du_doan:
                predict.prediction,

            do_tin_cay:
                predict.confidence +
                "%",

            phien_truoc: {

                phien:
                    latest.phien,

                xuc_xac:
                    latest.dices,

                ket_qua:
                    latest.result
            },

            chuoi_thang_hien_tai:
                stats.chuoi_thang_hien_tai,

            chuoi_thang_max:
                stats.chuoi_thang_max,

            chuoi_thua_hien_tai:
                stats.chuoi_thua_hien_tai,

            chuoi_thua_max:
                stats.chuoi_thua_max
        });

    } catch (err) {

        console.log(err);

        res.status(500).json({

            error:
                "Lỗi lấy dữ liệu"
        });
    }
});

// ======================================================

app.get("/", (req, res) => {

    res.send(
        "SERVER ONLINE"
    );
});

// ======================================================

app.listen(PORT, () => {

    console.log(
        "Server running:",
        PORT
    );
});
