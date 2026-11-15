import { createServer } from "node:http";
import { existsSync, readFileSync, statSync } from "node:fs";
import { extname, join, normalize } from "node:path";
import { fileURLToPath } from "node:url";
import { Server } from "socket.io";
import {
  isValidKey,
  normalizeName,
  normalizeRoomCode,
  type ClientToServerEvents,
  type ServerToClientEvents,
} from "../shared/game";
import { RoomManager } from "./roomManager";

// `--port N` wins (the dev script pins 3001 to match the Vite proxy, even if a
// tool has set PORT for Vite); otherwise PORT, otherwise 3001.
const portArg = process.argv.indexOf("--port");
const PORT = Number(portArg !== -1 ? process.argv[portArg + 1] : process.env.PORT) || 3001;
const DIST = fileURLToPath(new URL("../dist", import.meta.url));
const MIME: Record<string, string> = {
  ".html": "text/html; charset=utf-8", ".js": "text/javascript", ".css": "text/css",
  ".svg": "image/svg+xml", ".png": "image/png", ".ico": "image/x-icon", ".json": "application/json",
};

// In production (`npm run build` then `npm start`) this server also serves the built client.
const httpServer = createServer((req, res) => {
  if (!existsSync(DIST)) {
    res.writeHead(200, { "Content-Type": "text/plain; charset=utf-8" });
    res.end("Typing Race server is running. In development, open http://localhost:5173");
    return;
  }
  const urlPath = decodeURIComponent((req.url ?? "/").split("?")[0]);
  let file = normalize(join(DIST, urlPath));
  if (!file.startsWith(DIST) || !existsSync(file) || statSync(file).isDirectory()) {
    file = join(DIST, "index.html"); // SPA fallback (also blocks path traversal)
  }
  res.writeHead(200, { "Content-Type": MIME[extname(file)] ?? "application/octet-stream" });
  res.end(readFileSync(file));
});

const io = new Server<ClientToServerEvents, ServerToClientEvents>(httpServer, {
  maxHttpBufferSize: 10_000, // messages are tiny; reject anything large
});

// Every state change in a room is pushed to everyone in it as a full snapshot.
// Snapshots are small (max 4 players), and they keep clients simple and in sync.
const manager = new RoomManager((room) => {
  io.to(room.code).emit("room:state", room.view());
});

/** Player ids are random strings made by the client for this page load. */
function readPlayerId(auth: unknown): string | null {
  const id = (auth as { playerId?: unknown } | undefined)?.playerId;
  return typeof id === "string" && /^[A-Za-z0-9-]{8,64}$/.test(id) ? id : null;
}

io.on("connection", (socket) => {
  const playerId = readPlayerId(socket.handshake.auth);
  if (!playerId) {
    socket.disconnect(true);
    return;
  }

  // Reconnection: Socket.IO reconnects automatically after a network blip with
  // the same playerId, so the player gets their seat (and race progress) back.
  const previous = manager.roomOf(playerId);
  const oldSocketId = previous?.getSocketId(playerId);
  // Same player on a newer socket (e.g. a duplicated tab): close the old one.
  if (oldSocketId && oldSocketId !== socket.id) io.sockets.sockets.get(oldSocketId)?.disconnect(true);
  const room = previous ? manager.reconnect(playerId, socket.id) : null;
  if (room) {
    socket.join(room.code);
    socket.emit("room:state", room.view());
    if (room.status === "racing") socket.emit("race:resync", room.typedBy(playerId));
  } else {
    socket.emit("room:none");
  }

  const safeAck = <T>(ack: unknown): ((res: T) => void) =>
    typeof ack === "function" ? (ack as (res: T) => void) : () => {};

  socket.on("room:create", (payload, ackRaw) => {
    const ack = safeAck<Parameters<typeof ackRaw>[0]>(ackRaw);
    const name = normalizeName(payload?.name);
    if (!name) return ack({ ok: false, error: "Enter a name (1-16 letters, numbers or spaces)." });
    const old = manager.roomOf(playerId);
    if (old) socket.leave(old.code);
    const room = manager.create(playerId, name, socket.id);
    socket.join(room.code);
    ack({ ok: true, code: room.code });
    socket.emit("room:state", room.view());
  });

  socket.on("room:join", (payload, ackRaw) => {
    const ack = safeAck<Parameters<typeof ackRaw>[0]>(ackRaw);
    const name = normalizeName(payload?.name);
    if (!name) return ack({ ok: false, error: "Enter a name (1-16 letters, numbers or spaces)." });
    const code = normalizeRoomCode(payload?.code);
    if (!code) return ack({ ok: false, error: "Room codes are 4 letters." });
    const old = manager.roomOf(playerId);
    const result = manager.join(code, playerId, name, socket.id);
    if (typeof result === "string") return ack({ ok: false, error: result });
    if (old && old.code !== result.code) socket.leave(old.code);
    socket.join(result.code);
    ack({ ok: true, code: result.code });
    socket.emit("room:state", result.view());
  });

  socket.on("room:leave", () => {
    const room = manager.roomOf(playerId);
    if (!room) return;
    socket.leave(room.code);
    manager.leave(playerId);
  });

  socket.on("player:ready", (ready) => {
    if (typeof ready !== "boolean") return;
    manager.roomOf(playerId)?.setReady(playerId, ready);
  });

  socket.on("race:start", (ackRaw) => {
    const ack = safeAck<Parameters<typeof ackRaw>[0]>(ackRaw);
    const room = manager.roomOf(playerId);
    if (!room) return ack({ ok: false, error: "You are not in a room." });
    const error = room.hostStart(playerId);
    ack(error ? { ok: false, error } : { ok: true });
  });

  socket.on("race:key", (key) => {
    if (!isValidKey(key)) return;
    const room = manager.roomOf(playerId);
    if (!room) return;
    // If the server had to drop keys, tell the client what was actually counted.
    if (room.handleKey(playerId, key) === "rate-limited") {
      socket.emit("race:resync", room.typedBy(playerId));
    }
  });

  socket.on("race:rematch", () => {
    manager.roomOf(playerId)?.voteRematch(playerId);
  });

  socket.on("disconnect", () => {
    manager.disconnect(playerId, socket.id);
  });
});

httpServer.listen(PORT, () => {
  console.log(`Typing Race server listening on http://localhost:${PORT}`);
});
