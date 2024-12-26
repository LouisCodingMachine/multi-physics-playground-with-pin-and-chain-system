import React from 'react';
import PhysicsCanvas from './components/PhysicsCanvas';
import VideoChat from './components/VideoChat';
import { SocketProvider } from './context/SocketContext';

function App() {
  return (
    <div className="min-h-screen bg-gray-100 flex items-center justify-center p-8">
      <SocketProvider>
        <PhysicsCanvas />
      </SocketProvider>
      {/* <VideoChat /> */}
    </div>
  );
}

export default App;