import React, { createContext, useContext, useEffect } from 'react';
import { socket } from '../socket'; // 위에서 만든 socket.ts에서 가져옴
import { Socket } from 'socket.io-client';

// Context 생성
const SocketContext = createContext<Socket | null>(null);

export const SocketProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  useEffect(() => {
    // Socket 연결 상태 로그
    socket.on('connect', () => console.log('Socket connected'));
    socket.on('disconnect', () => console.log('Socket disconnected'));

    // Clean up
    return () => {
      socket.off('connect');
      socket.off('disconnect');
    };
  }, []);

  return <SocketContext.Provider value={socket}>{children}</SocketContext.Provider>;
};

// Hook 생성
export const useSocket = () => {
  const context = useContext(SocketContext);
  if (!context) {
    throw new Error('useSocket must be used within a SocketProvider');
  }
  return context;
};