/**
 * Socket.io client singleton — connects to the Node backend's WS hub
 * with the JWT for authentication, and exposes typed event subscriptions.
 */
import { io, Socket } from "socket.io-client";
import { tokenStore } from "./api";

export const SOCKET_URL = process.env.NEXT_PUBLIC_SOCKET_URL || "http://localhost:5000";

let socket: Socket | null = null;

export function getSocket(): Socket {
  if (socket) return socket;
  socket = io(SOCKET_URL, {
    auth: { token: tokenStore.getAccess() },
    transports: ["websocket", "polling"],
    autoConnect: false,
  });
  return socket;
}

export function connectSocket(): Socket {
  const s = getSocket();
  if (!s.connected) s.connect();
  return s;
}

export function disconnectSocket() {
  socket?.disconnect();
  socket = null;
}

export interface AlertPayload {
  id?: string;
  caseId?: string;
  type?: string;
  severity?: string;
  message?: string;
  createdAt?: string;
  [k: string]: unknown;
}

/** Subscribe to a typed socket event. Returns an unsubscribe fn. */
export function onSocketEvent<T = AlertPayload>(event: string, handler: (payload: T) => void): () => void {
  const s = getSocket();
  s.on(event, handler);
  return () => {
    s.off(event, handler);
  };
}
