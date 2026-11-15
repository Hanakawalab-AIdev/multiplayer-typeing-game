import { io, type Socket } from "socket.io-client";
import type { ClientToServerEvents, ServerToClientEvents } from "../shared/game";

function randomId() {
  // crypto.randomUUID only exists on secure origins (localhost/https); fall back for LAN IPs.
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) return crypto.randomUUID();
  return Array.from({ length: 24 }, () => Math.floor(Math.random() * 36).toString(36)).join("");
}

/**
 * Identifies this browser tab for its lifetime. Socket.IO sends it again when it
 * reconnects after a network drop, which lets the server give the player their
 * seat back. Reloading the page creates a new player.
 */
export const playerId = randomId();

export const socket: Socket<ServerToClientEvents, ClientToServerEvents> = io({
  auth: { playerId },
});
