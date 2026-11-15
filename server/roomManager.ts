import { ROOM_CODE_LENGTH } from "../shared/game";
import { Room } from "./room";

/** How long a disconnected player keeps their seat in a lobby or results screen. */
const RECONNECT_GRACE_MS = 15_000;
const CODE_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ"; // no I or O (look like 1 and 0)

/** Keeps track of all rooms and which room each player is in. */
export class RoomManager {
  private rooms = new Map<string, Room>();
  private playerRoom = new Map<string, string>();
  private dropTimers = new Map<string, ReturnType<typeof setTimeout>>();

  constructor(private readonly onRoomChange: (room: Room) => void) {}

  roomOf(playerId: string): Room | null {
    const code = this.playerRoom.get(playerId);
    return code ? this.rooms.get(code) ?? null : null;
  }

  create(playerId: string, name: string, socketId: string): Room {
    this.leave(playerId);
    let code: string;
    do {
      code = Array.from({ length: ROOM_CODE_LENGTH }, () =>
        CODE_ALPHABET[Math.floor(Math.random() * CODE_ALPHABET.length)]).join("");
    } while (this.rooms.has(code));
    const room = new Room(code, playerId, this.onRoomChange);
    this.rooms.set(code, room);
    room.addPlayer(playerId, name, socketId);
    this.playerRoom.set(playerId, code);
    return room;
  }

  /** Returns the room, or an error message. */
  join(code: string, playerId: string, name: string, socketId: string): Room | string {
    const room = this.rooms.get(code);
    if (!room) return "No room with that code. Check the code and try again.";
    if (room.has(playerId)) return room;
    const error = room.addPlayer(playerId, name, socketId);
    if (error) return error;
    this.leave(playerId, room.code); // leave any previous room
    this.playerRoom.set(playerId, code);
    return room;
  }

  leave(playerId: string, exceptCode?: string) {
    const room = this.roomOf(playerId);
    if (!room || room.code === exceptCode) return;
    this.clearDropTimer(playerId);
    this.playerRoom.delete(playerId);
    room.removePlayer(playerId);
    if (room.size === 0) {
      room.dispose();
      this.rooms.delete(room.code);
    }
  }

  /** A player's socket came back (e.g. after a network blip). */
  reconnect(playerId: string, socketId: string): Room | null {
    const room = this.roomOf(playerId);
    if (!room) return null;
    if (!room.has(playerId)) {
      this.playerRoom.delete(playerId);
      return null;
    }
    this.clearDropTimer(playerId);
    room.setSocket(playerId, socketId);
    return room;
  }

  /**
   * A socket closed. The player keeps their seat for a while: during a race they
   * stay on the track as "disconnected" and can resume; in a lobby or on the results
   * screen they are removed if they don't return within the grace period.
   */
  disconnect(playerId: string, socketId: string) {
    const room = this.roomOf(playerId);
    // Ignore stale sockets: the player may already be connected through a newer one.
    if (!room || room.getSocketId(playerId) !== socketId) return;
    room.setSocket(playerId, null);
    this.scheduleDrop(playerId);
  }

  private scheduleDrop(playerId: string) {
    this.clearDropTimer(playerId);
    this.dropTimers.set(playerId, setTimeout(() => {
      this.dropTimers.delete(playerId);
      const room = this.roomOf(playerId);
      if (!room || room.isConnected(playerId)) return;
      const everyoneGone = room.connectedPlayers().length === 0;
      if (room.status === "countdown" || room.status === "racing") {
        if (everyoneGone) this.closeRoom(room);
        else this.scheduleDrop(playerId); // keep them on the track; check again later
      } else {
        this.leave(playerId);
      }
    }, RECONNECT_GRACE_MS));
  }

  private clearDropTimer(playerId: string) {
    const t = this.dropTimers.get(playerId);
    if (t) clearTimeout(t);
    this.dropTimers.delete(playerId);
  }

  private closeRoom(room: Room) {
    for (const [pid, code] of this.playerRoom) {
      if (code === room.code) {
        this.clearDropTimer(pid);
        this.playerRoom.delete(pid);
      }
    }
    room.dispose();
    this.rooms.delete(room.code);
  }
}
