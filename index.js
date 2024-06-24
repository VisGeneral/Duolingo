import { Worker, isMainThread, parentPort, workerData } from 'worker_threads';
import fetch from 'node-fetch';

const MAX_RETRIES = 5;
const RETRY_DELAY = 2000;

const fetchWithRetry = async (url, options, retries = MAX_RETRIES) => {
    try {
        const response = await fetch(url, options);
        if (!response.ok) {
            if (response.status === 429 && retries > 0) {
                console.log('Rate limit exceeded, retrying...');
                await new Promise(res => setTimeout(res, RETRY_DELAY));
                return fetchWithRetry(url, options, retries - 1);
            }
            throw new Error(`HTTP error! status: ${response.status}`);
        }
        return response.json();
    } catch (error) {
        if (retries > 0) {
            console.log(`Error encountered: ${error.message}. Retrying...`);
            await new Promise(res => setTimeout(res, RETRY_DELAY));
            return fetchWithRetry(url, options, retries - 1);
        }
        throw error;
    }
};

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
            return fetchWithRetry(
                `https://www.duolingo.com/2017-06-30/users/${sub}?fields=fromLanguage,learningLanguage`,
                { headers }
            );
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
                } else {
                    // Start a new worker for a new lesson since one completed successfully
                    const worker = new Worker(new URL(import.meta.url), {
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
            };

            for (let i = 0; i < process.env.LESSONS; i++) {
                const worker = new Worker(new URL(import.meta.url), {
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
        const session = await fetchWithRetry(
            "https://www.duolingo.com/2017-06-30/sessions",
            {
                body: JSON.stringify({
                    challengeTypes: [
        
                        "listen_tap",
                    ],
                    fromLanguage,
                    isFinalLevel: false,
                    isV2: true,
                    juicy: true,
                    learningLanguage,
                    smartTipsVersion: 2,
                    skillId:"110914d603cfcd2a7e3728947ddb7c6a",
                    type: "LISTENING_PRACTICE",
                }),
                headers,
                method: "POST",
            }
        );

        const response = await fetchWithRetry(
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
        );

        return response;
    };

    const attemptLesson = async () => {
        try {
            const response = await doLesson();
            parentPort.postMessage({ xpGain: response.xpGain });
        } catch (error) {
            console.error("❌ Worker error:", error.message);
            // Retry until success
            await new Promise(res => setTimeout(res, RETRY_DELAY));
            await attemptLesson();
        }
    };

    attemptLesson();
}
