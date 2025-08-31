import React, { createContext, useContext, useEffect, useState } from 'react';
import type { ReactNode } from 'react';
import { io, Socket } from 'socket.io-client';
import { toast } from 'react-toastify';

// Types
import { useAuth } from './AuthContext';

// Socket Context Interface
interface SocketContextType {
  socket: Socket | null;
  isConnected: boolean;
  connect: () => void;
  disconnect: () => void;
  emit: (event: string, data: any) => void;
  on: (event: string, callback: (data: any) => void) => void;
  off: (event: string) => void;
}

// Create Context
const SocketContext = createContext<SocketContextType | undefined>(undefined);

// Socket Provider Props
interface SocketProviderProps {
  children: ReactNode;
}

// Socket Provider Component
export const SocketProvider: React.FC<SocketProviderProps> = ({ children }) => {
  const [socket, setSocket] = useState<Socket | null>(null);
  const [isConnected, setIsConnected] = useState(false);
  const { user, token } = useAuth();

  // Socket server URL
  const SOCKET_URL = import.meta.env.VITE_SOCKET_URL || 'http://localhost:7000';

  // Connect to socket server
  const connect = () => {
    if (!token || !user) {
      console.warn('Cannot connect to socket: No token or user');
      return;
    }

    if (socket?.connected) {
      console.log('Socket already connected');
      return;
    }

    try {
      const newSocket = io(SOCKET_URL, {
        auth: {
          token: token,
        },
        transports: ['websocket', 'polling'],
        autoConnect: true,
        reconnection: true,
        reconnectionAttempts: 5,
        reconnectionDelay: 1000,
      });

      // Connection events
      newSocket.on('connect', () => {
        console.log('Socket connected:', newSocket.id);
        setIsConnected(true);
        
        // Join user-specific room
        newSocket.emit('user:join', {
          userId: user.id,
          role: user.role,
        });
      });

      newSocket.on('disconnect', (reason) => {
        console.log('Socket disconnected:', reason);
        setIsConnected(false);
        
        if (reason === 'io server disconnect') {
          // Server disconnected us, try to reconnect
          newSocket.connect();
        }
      });

      newSocket.on('connect_error', (error) => {
        console.error('Socket connection error:', error);
        setIsConnected(false);
        toast.error('Connection error. Trying to reconnect...');
      });

      newSocket.on('reconnect', (attemptNumber) => {
        console.log('Socket reconnected after', attemptNumber, 'attempts');
        setIsConnected(true);
        toast.success('Reconnected to server');
      });

      newSocket.on('reconnect_error', (error) => {
        console.error('Socket reconnection error:', error);
        toast.error('Failed to reconnect');
      });

      // Exam-specific events
      newSocket.on('exam:time_warning', (data) => {
        const { remainingTime } = data;
        if (remainingTime <= 300) { // 5 minutes warning
          toast.warning(`Exam will end in ${Math.floor(remainingTime / 60)} minutes!`);
        }
      });

      newSocket.on('exam:force_submit', () => {
        toast.error('Exam time has expired. Your exam has been automatically submitted.');
        // Redirect to results page or handle accordingly
      });

      // Admin-specific events
      if (user.role === 'admin') {
        newSocket.on('admin:exam_monitor', (data) => {
          console.log('Exam monitoring update:', data);
          // Handle exam monitoring updates
        });

        newSocket.on('admin:student_activity', (data) => {
          console.log('Student activity:', data);
          // Handle student activity updates
        });
      }

      // Student-specific events
      if (user.role === 'student') {
        newSocket.on('student:exam_update', (data) => {
          console.log('Exam update:', data);
          // Handle exam updates for students
        });
      }

      setSocket(newSocket);
    } catch (error) {
      console.error('Failed to create socket connection:', error);
      toast.error('Failed to connect to server');
    }
  };

  // Disconnect from socket server
  const disconnect = () => {
    if (socket) {
      socket.disconnect();
      setSocket(null);
      setIsConnected(false);
    }
  };

  // Emit event
  const emit = (event: string, data: any) => {
    if (socket?.connected) {
      socket.emit(event, data);
    } else {
      console.warn('Socket not connected, cannot emit event:', event);
    }
  };

  // Listen to event
  const on = (event: string, callback: (data: any) => void) => {
    if (socket) {
      socket.on(event, callback);
    }
  };

  // Remove event listener
  const off = (event: string) => {
    if (socket) {
      socket.off(event);
    }
  };

  // Connect on mount if user is authenticated
  useEffect(() => {
    if (user && token) {
      connect();
    }

    // Cleanup on unmount
    return () => {
      disconnect();
    };
  }, [user, token]);

  // Reconnect when token changes
  useEffect(() => {
    if (token && user) {
      if (socket) {
        disconnect();
      }
      connect();
    }
  }, [token]);

  const contextValue: SocketContextType = {
    socket,
    isConnected,
    connect,
    disconnect,
    emit,
    on,
    off,
  };

  return (
    <SocketContext.Provider value={contextValue}>
      {children}
    </SocketContext.Provider>
  );
};

// Custom hook to use socket context
export const useSocket = (): SocketContextType => {
  const context = useContext(SocketContext);
  
  if (context === undefined) {
    throw new Error('useSocket must be used within a SocketProvider');
  }
  
  return context;
};
