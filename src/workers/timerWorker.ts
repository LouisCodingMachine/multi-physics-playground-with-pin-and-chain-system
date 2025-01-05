// src/workers/timerWorker.ts

let intervalId: NodeJS.Timeout | null = null;

self.onmessage = (e: MessageEvent) => {
  const { type, payload } = e.data;

  if (type === 'start') {
    const { duration } = payload;
    let remainingTime = duration;

    intervalId = setInterval(() => {
      remainingTime -= 1;

      if (remainingTime <= 0) {
        clearInterval(intervalId!);
        self.postMessage({ type: 'finish' }); // 타이머 완료 메시지 전송
      } else {
        self.postMessage({ type: 'tick', remainingTime }); // 남은 시간 전송
      }
    }, 1000);
  }

  if (type === 'stop') {
    if (intervalId) {
      clearInterval(intervalId);
      intervalId = null;
    }
  }
};