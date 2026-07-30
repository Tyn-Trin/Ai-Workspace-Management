import { io, Socket } from 'socket.io-client';

const WS_URL = process.env.NEXT_PUBLIC_WS_URL ?? 'ws://localhost:3001';

let socket: Socket | null = null;

/** socket เดียวใช้ร่วมกันทั้งแอป — เปิดครั้งแรกที่ hook ไหนเรียกก่อน */
export function getSocket(): Socket {
  if (!socket) {
    socket = io(WS_URL, {
      withCredentials: true, // ส่ง session cookie ไปด้วยตอน handshake (PLAN-V2.md §6.3)
      reconnection: true,
    });
  }
  return socket;
}
