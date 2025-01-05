// import React, { useState, useEffect } from 'react';
// import { setInterval, clearInterval } from 'worker-timers';

// interface TimerProps {
//   startTimer: boolean;
//   onFinish: () => void;
// }

// const Timer: React.FC<TimerProps> = ({ startTimer, onFinish }) => {
//   const [timeLeft, setTimeLeft] = useState<number>(20 * 60); // 20분
//   let timerId: number | null = null;

//   useEffect(() => {
//     if (startTimer) {
//       timerId = setInterval(() => {
//         setTimeLeft((prev) => {
//           if (prev <= 1) {
//             onFinish();
//             return 0;
//           }
//           return prev - 1;
//         });
//       }, 1000);
//     }

//     return () => {
//       if (timerId) {
//         clearInterval(timerId);
//       }
//     };
//   }, [startTimer, onFinish]);

//   const formatTime = (seconds: number): string => {
//     const minutes = Math.floor(seconds / 60);
//     const secs = seconds % 60;
//     return `${minutes}:${secs.toString().padStart(2, '0')}`;
//   };

//   return (
//     <div className="absolute top-4 left-4 bg-gray-800 text-white p-2 rounded shadow-lg">
//       {formatTime(timeLeft)}
//     </div>
//   );
// };

// export default Timer;