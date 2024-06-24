const { Worker, isMainThread, parentPort, workerData } = require('worker_threads');

if (isMainThread) {
    try {
        process.env.LESSONS = process.env.LESSONS ?? 1;

        const headers = {
            "Content-Type": "application/json",
            Authorization: `Bearer ${process.env.DUOLINGO_JWT}`,
            "user-agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/121.0.0.0 Safari/537.36",
        };

        const { sub } = JSON.parse(
            Buffer.from(process.env.DUOLINGO_JWT.split(".")[1], "base64").toString()
        );

        const getLanguages = async () => {
            const response = await fetch(
                `https://www.duolingo.com/2017-06-30/users/${sub}?fields=fromLanguage,learningLanguage`,
                { headers }
            );
            return response.json();
        };

        getLanguages().then(({ fromLanguage, learningLanguage }) => {
            let completed = 0;
            let totalXP = 0;

            const handleWorkerMessage = (message) => {
                totalXP += message.xpGain;
                completed += 1;
                console.log(`You won ${totalXP} XP so far!`);

                if (completed === Number(process.env.LESSONS)) {
                    console.log(`🎉 You won ${totalXP} XP`);
                }
            };

            for (let i = 0; i < process.env.LESSONS; i++) {
                const worker = new Worker(__filename, {
                    workerData: {
                        headers,
                        fromLanguage,
                        learningLanguage,
                    },
                });

                worker.on('message', handleWorkerMessage);
                worker.on('error', (error) => console.error("❌ Worker error:", error.message));
                worker.on('exit', (code) => {
                    if (code !== 0) {
                        console.error(`❌ Worker stopped with exit code ${code}`);
                    }
                });
            }
        }).catch((error) => {
            console.log("❌ Something went wrong");
            if (error instanceof Error) {
                console.log(error.message);
            }
        });

    } catch (error) {
        console.log("❌ Something went wrong");
        if (error instanceof Error) {
            console.log(error.message);
        }
    }
} else {
    const { headers, fromLanguage, learningLanguage } = workerData;

    const doLesson = async () => {
        const session = await fetch(
            "https://www.duolingo.com/2017-06-30/sessions",
            {
                body: JSON.stringify({
                    challengeTypes: [
                        "assist",
                        "characterIntro",
                        "characterMatch",
                        "characterPuzzle",
                        "characterSelect",
                        "characterTrace",
                        "characterWrite",
                        "completeReverseTranslation",
                        "definition",
                        "dialogue",
                        "extendedMatch",
                        "extendedListenMatch",
                        "form",
                        "freeResponse",
                        "gapFill",
                        "judge",
                        "listen",
                        "listenComplete",
                        "listenMatch",
                        "match",
                        "name",
                        "listenComprehension",
                        "listenIsolation",
                        "listenSpeak",
                        "listenTap",
                        "orderTapComplete",
                        "partialListen",
                        "partialReverseTranslate",
                        "patternTapComplete",
                        "radioBinary",
                        "radioImageSelect",
                        "radioListenMatch",
                        "radioListenRecognize",
                        "radioSelect",
                        "readComprehension",
                        "reverseAssist",
                        "sameDifferent",
                        "select",
                        "selectPronunciation",
                        "selectTranscription",
                        "svgPuzzle",
                        "syllableTap",
                        "syllableListenTap",
                        "speak",
                        "tapCloze",
                        "tapClozeTable",
                        "tapComplete",
                        "tapCompleteTable",
                        "tapDescribe",
                        "translate",
                        "transliterate",
                        "transliterationAssist",
                        "typeCloze",
                        "typeClozeTable",
                        "typeComplete",
                        "typeCompleteTable",
                        "writeComprehension",
                    ],
                    fromLanguage,
                    isFinalLevel: false,
                    isV2: true,
                    juicy: true,
                    learningLanguage,
                    smartTipsVersion: 2,
                    type: "GLOBAL_PRACTICE",
                }),
                headers,
                method: "POST",
            }
        ).then((response) => response.json());

        const response = await fetch(
            `https://www.duolingo.com/2017-06-30/sessions/${session.id}`,
            {
                body: JSON.stringify({
                    ...session,
                    heartsLeft: 0,
                    startTime: (+new Date() - 60000) / 1000,
                    enableBonusPoints: false,
                    endTime: +new Date() / 1000,
                    failed: false,
                    maxInLessonStreak: 9,
                    shouldLearnThings: true,
                }),
                headers,
                method: "PUT",
            }
        ).then((response) => response.json());

        return response;
    };

    doLesson().then((response) => {
        parentPort.postMessage({ xpGain: response.xpGain });
    }).catch((error) => {
        console.error("❌ Worker error:", error.message);
        parentPort.postMessage({ xpGain: 0 });
    });
}
