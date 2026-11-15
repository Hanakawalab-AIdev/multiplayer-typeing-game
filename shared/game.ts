// Code shared by the server and the client: rules, limits, typing logic and
// the shape of every Socket.IO message. The server is the source of truth;
// the client runs the same `applyKey` only to render its own text instantly.

export const MIN_PLAYERS = 2;
export const MAX_PLAYERS = 4;
export const COUNTDOWN_MS = 3000;
export const NAME_MAX_LENGTH = 16;
export const ROOM_CODE_LENGTH = 4;
/** How many wrong characters a player may type past their first mistake. */
export const MAX_ERROR_RUN = 5;

export type RoomStatus = "waiting" | "countdown" | "racing" | "finished";

export interface PlayerView {
  id: string;
  name: string;
  isHost: boolean;
  connected: boolean;
  /** In the waiting room: ready to start. After a race: voted for a rematch. */
  ready: boolean;
  /** Number of correctly typed characters from the start of the sentence. */
  progress: number;
  wpm: number;
  accuracy: number;
  /** Milliseconds from the start signal to finishing, or null if not finished. */
  finishMs: number | null;
  place: number | null;
  /** True when the race ended before this player finished. */
  dnf: boolean;
}

export interface RoomView {
  code: string;
  status: RoomStatus;
  /** Increments every race; the client uses it to reset its local state. */
  raceId: number;
  sentence: string | null;
  /** Milliseconds until the start signal (negative once the race has begun). */
  startsInMs: number | null;
  maxPlayers: number;
  minPlayers: number;
  players: PlayerView[];
}

export type Ack<T extends object = object> = ({ ok: true } & T) | { ok: false; error: string };

export interface ClientToServerEvents {
  "room:create": (payload: { name: string }, ack: (res: Ack<{ code: string }>) => void) => void;
  "room:join": (payload: { name: string; code: string }, ack: (res: Ack<{ code: string }>) => void) => void;
  "room:leave": () => void;
  "player:ready": (ready: boolean) => void;
  "race:start": (ack: (res: Ack) => void) => void;
  /** One keystroke: a single printable character or "Backspace". */
  "race:key": (key: string) => void;
  "race:rematch": () => void;
}

export interface ServerToClientEvents {
  "room:state": (room: RoomView) => void;
  /** Sent when this player is not (or no longer) in any room. */
  "room:none": (reason?: string) => void;
  /** Server and client disagreed about the typed text; the server's copy wins. */
  "race:resync": (typed: string) => void;
}

// ---------- validation ----------

export function normalizeName(raw: unknown): string | null {
  if (typeof raw !== "string") return null;
  const name = raw.replace(/\s+/g, " ").trim();
  if (name.length < 1 || name.length > NAME_MAX_LENGTH) return null;
  // Letters, digits, spaces and a few safe symbols in any language.
  if (!/^[\p{L}\p{N} _.\-]+$/u.test(name)) return null;
  return name;
}

export function normalizeRoomCode(raw: unknown): string | null {
  if (typeof raw !== "string") return null;
  const code = raw.trim().toUpperCase();
  return new RegExp(`^[A-Z]{${ROOM_CODE_LENGTH}}$`).test(code) ? code : null;
}

export function isValidKey(key: unknown): key is string {
  if (typeof key !== "string") return false;
  if (key === "Backspace") return true;
  return key.length === 1 && key.charCodeAt(0) >= 32 && key.charCodeAt(0) !== 127;
}

// ---------- typing logic ----------

/** Index of the first wrong character, or -1 if everything typed so far is correct. */
export function firstErrorIndex(typed: string, sentence: string): number {
  for (let i = 0; i < typed.length; i++) {
    if (typed[i] !== sentence[i]) return i;
  }
  return -1;
}

/** Correct characters from the start. Progress never moves past a mistake. */
export function correctProgress(typed: string, sentence: string): number {
  const err = firstErrorIndex(typed, sentence);
  return err === -1 ? typed.length : err;
}

export interface KeyResult {
  typed: string;
  /** False when the key was ignored (nothing to delete, too many errors, end of text). */
  changed: boolean;
  /** True for a character keystroke that counts toward accuracy. */
  counted: boolean;
  correct: boolean;
}

export function applyKey(typed: string, key: string, sentence: string): KeyResult {
  if (key === "Backspace") {
    if (typed.length === 0) return { typed, changed: false, counted: false, correct: false };
    return { typed: typed.slice(0, -1), changed: true, counted: false, correct: false };
  }
  if (typed.length >= sentence.length) return { typed, changed: false, counted: false, correct: false };

  const err = firstErrorIndex(typed, sentence);
  // Block typing too far past a mistake so the player has to go back and fix it.
  if (err !== -1 && typed.length - err >= MAX_ERROR_RUN) {
    return { typed, changed: false, counted: false, correct: false };
  }
  const correct = err === -1 && sentence[typed.length] === key;
  return { typed: typed + key, changed: true, counted: true, correct };
}

/** Standard words-per-minute: 5 characters = 1 word. */
export function calcWpm(correctChars: number, elapsedMs: number): number {
  if (elapsedMs <= 0) return 0;
  return Math.round(correctChars / 5 / (elapsedMs / 60000));
}

export function calcAccuracy(correctKeys: number, totalKeys: number): number {
  if (totalKeys === 0) return 100;
  return Math.round((correctKeys / totalKeys) * 1000) / 10;
}

export function formatMs(ms: number): string {
  return `${(ms / 1000).toFixed(2)}s`;
}
