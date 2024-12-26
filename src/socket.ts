// socket.ts
import { io, Socket } from 'socket.io-client';

const SOCKET_URL = 'http://localhost:3001';

// Singleton 패턴으로 소켓 인스턴스 생성
export const socket: Socket = io(SOCKET_URL, {
  autoConnect: true,
});

// 필요하면 초기화 코드 추가
socket.on('connect', () => {
  console.log('Connected to WebSocket server');
});

socket.on('disconnect', () => {
  console.log('Disconnected from WebSocket server');
});