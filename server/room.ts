import {
  COUNTDOWN_MS,
  MAX_PLAYERS,
  MIN_PLAYERS,
  applyKey,
  calcAccuracy,
  calcWpm,
  correctProgress,
  type RoomStatus,
  type RoomView,
} from "../shared/game";
import { pickSentence } from "./sentences";

/** After the winner finishes, everyone else gets this long before the race ends. */
const FINISH_GRACE_MS = 30_000;
/** Hard limit on a race, in case nobody finishes. */
const MAX_RACE_MS = 180_000;
/** Anti-cheat: more keystrokes than this per second are rejected. */
const MAX_KEYS_PER_SECOND = 30;

interface Player {
  id: string;
  name: string;
  socketId: string | null;
  connected: boolean;
  ready: boolean;
  // ----- race state (all tracked on the server, never trusted from the client) -----
  typed: string;
  correctKeys: number;
  totalKeys: number;
  finishMs: number | null;
  place: number | null;
  dnf: boolean;
  rateWindowStart: number;
  rateCount: number;
}

export type KeyOutcome = "ok" | "ignored" | "rate-limited";

/**
 * One game room. All rules live here: who may start, when the countdown
 * runs, how keystrokes are scored, and how the race ends. Every change calls
 * `onChange`, which broadcasts the new state to everyone in the room.
 */
export class Room {
  status: RoomStatus = "waiting";
  hostId: string;
  raceId = 0;
  sentence: string | null = null;
  private players = new Map<string, Player>(); // insertion order = join order
  private startAt = 0;
  private endAt = 0;
  private finishCount = 0;
  private timers: ReturnType<typeof setTimeout>[] = [];
  private ticker: ReturnType<typeof setInterval> | null = null;

  constructor(
    public readonly code: string,
    hostId: string,
    private readonly onChange: (room: Room) => void,
  ) {
    this.hostId = hostId;
  }

  // ---------- membership ----------

  get size() {
    return this.players.size;
  }

  has(playerId: string) {
    return this.players.has(playerId);
  }

  connectedPlayers() {
    return [...this.players.values()].filter((p) => p.connected);
  }

  getSocketId(playerId: string) {
    return this.players.get(playerId)?.socketId ?? null;
  }

  isConnected(playerId: string) {
    return this.players.get(playerId)?.connected ?? false;
  }

  /** Returns an error message, or null on success. */
  addPlayer(id: string, name: string, socketId: string): string | null {
    if (this.status !== "waiting") return "A race is in progress in this room. Try again when it ends.";
    if (this.players.size >= MAX_PLAYERS) return `This room is full (${MAX_PLAYERS}/${MAX_PLAYERS}).`;
    const lower = name.toLowerCase();
    if ([...this.players.values()].some((p) => p.name.toLowerCase() === lower)) {
      return "Someone in this room already uses that name.";
    }
    this.players.set(id, {
      id, name, socketId, connected: true, ready: false,
      typed: "", correctKeys: 0, totalKeys: 0, finishMs: null, place: null, dnf: false,
      rateWindowStart: 0, rateCount: 0,
    });
    this.onChange(this);
    return null;
  }

  removePlayer(id: string) {
    if (!this.players.delete(id)) return;
    this.ensureHost();
    this.afterMembershipChange();
    this.onChange(this);
  }

  /** Socket connected (null = disconnected). Players stay in the room while away. */
  setSocket(id: string, socketId: string | null) {
    const p = this.players.get(id);
    if (!p) return;
    p.socketId = socketId;
    p.connected = socketId !== null;
    this.ensureHost();
    this.afterMembershipChange();
    this.onChange(this);
  }

  /** Hand host rights to the first connected player if the host is gone. */
  private ensureHost() {
    const host = this.players.get(this.hostId);
    if (host?.connected) return;
    const next = this.connectedPlayers()[0] ?? [...this.players.values()][0];
    if (next) this.hostId = next.id;
  }

  /** Someone joined, left, or (dis)connected: re-check start and end conditions. */
  private afterMembershipChange() {
    if (this.status === "racing") this.checkRaceEnd();
    else if (this.status === "waiting" || this.status === "finished") this.checkAutoStart();
    else if (this.status === "countdown" && this.connectedPlayers().length === 0) this.endRace();
  }

  // ---------- lobby ----------

  setReady(id: string, ready: boolean) {
    const p = this.players.get(id);
    if (!p || this.status !== "waiting") return;
    p.ready = ready;
    this.onChange(this);
    this.checkAutoStart();
  }

  /** Host pressed Start. Returns an error message, or null on success. */
  hostStart(id: string): string | null {
    if (id !== this.hostId) return "Only the host can start the race.";
    if (this.status !== "waiting") return "The race has already started.";
    if (this.connectedPlayers().length < MIN_PLAYERS) return `At least ${MIN_PLAYERS} players are needed.`;
    this.startCountdown();
    return null;
  }

  /** Rematch vote after a race. The next race starts once every connected player has voted. */
  voteRematch(id: string) {
    const p = this.players.get(id);
    if (!p) return;
    if (this.status === "finished" || this.status === "waiting") {
      p.ready = true;
      this.onChange(this);
      this.checkAutoStart();
    }
  }

  /**
   * Waiting room: start when every connected player is ready (and there are enough).
   * Results screen: when everyone voted rematch, start again, or fall back to the
   * waiting room if too few players are left.
   */
  private checkAutoStart() {
    const active = this.connectedPlayers();
    if (active.length === 0 || !active.every((p) => p.ready)) return;
    if (active.length >= MIN_PLAYERS) {
      this.startCountdown();
    } else if (this.status === "finished") {
      this.status = "waiting";
      this.onChange(this);
    }
  }

  // ---------- race ----------

  private startCountdown() {
    // Players who are disconnected right now still get a lane: if they reconnect
    // in time they can race, otherwise the RoomManager removes them later.
    this.clearTimers();
    this.raceId++;
    this.sentence = pickSentence(this.sentence);
    this.finishCount = 0;
    for (const p of this.players.values()) {
      Object.assign(p, { ready: false, typed: "", correctKeys: 0, totalKeys: 0, finishMs: null, place: null, dnf: false, rateCount: 0 });
    }
    // The start time is fixed on the server, so everyone starts at the same moment
    // and keys sent before it are rejected.
    this.status = "countdown";
    this.startAt = Date.now() + COUNTDOWN_MS;
    this.timers.push(setTimeout(() => {
      this.status = "racing";
      // Re-broadcast once a second so live WPM keeps updating even for idle players.
      this.ticker = setInterval(() => this.onChange(this), 1000);
      this.onChange(this);
      this.checkRaceEnd();
    }, COUNTDOWN_MS));
    this.timers.push(setTimeout(() => this.endRace(), COUNTDOWN_MS + MAX_RACE_MS));
    this.onChange(this);
  }

  /** Apply one keystroke. Progress, accuracy and finish time are all computed here. */
  handleKey(id: string, key: string): KeyOutcome {
    const p = this.players.get(id);
    if (!p || this.status !== "racing" || p.finishMs !== null || !this.sentence) return "ignored";
    const now = Date.now();
    if (now < this.startAt) return "ignored";

    if (now - p.rateWindowStart >= 1000) {
      p.rateWindowStart = now;
      p.rateCount = 0;
    }
    if (++p.rateCount > MAX_KEYS_PER_SECOND) return "rate-limited";

    const result = applyKey(p.typed, key, this.sentence);
    if (!result.changed) return "ignored";
    p.typed = result.typed;
    if (result.counted) {
      p.totalKeys++;
      if (result.correct) p.correctKeys++;
    }

    if (p.typed === this.sentence) {
      p.finishMs = now - this.startAt;
      p.place = ++this.finishCount;
      // The first finisher wins; the others get a short grace period to finish.
      if (p.place === 1) this.timers.push(setTimeout(() => this.endRace(), FINISH_GRACE_MS));
    }
    this.onChange(this);
    this.checkRaceEnd();
    return "ok";
  }

  typedBy(id: string) {
    return this.players.get(id)?.typed ?? "";
  }

  /** The race ends early once every connected player has finished. */
  private checkRaceEnd() {
    if (this.status !== "racing") return;
    const active = this.connectedPlayers();
    if (active.every((p) => p.finishMs !== null)) this.endRace();
  }

  private endRace() {
    if (this.status !== "racing" && this.status !== "countdown") return;
    this.clearTimers();
    this.status = "finished";
    this.endAt = Date.now();
    // Players who did not finish are ranked after the finishers, by progress.
    const unfinished = [...this.players.values()]
      .filter((p) => p.finishMs === null)
      .sort((a, b) => correctProgress(b.typed, this.sentence!) - correctProgress(a.typed, this.sentence!));
    unfinished.forEach((p, i) => {
      p.place = this.finishCount + i + 1;
      p.dnf = true;
    });
    this.onChange(this);
  }

  private clearTimers() {
    this.timers.forEach(clearTimeout);
    this.timers = [];
    if (this.ticker) clearInterval(this.ticker);
    this.ticker = null;
  }

  dispose() {
    this.clearTimers();
  }

  // ---------- view sent to clients ----------

  view(): RoomView {
    const now = Date.now();
    const inRace = this.status !== "waiting";
    const sentence = inRace ? this.sentence : null;
    return {
      code: this.code,
      status: this.status,
      raceId: this.raceId,
      sentence,
      startsInMs: inRace && this.status !== "finished" ? this.startAt - now : null,
      maxPlayers: MAX_PLAYERS,
      minPlayers: MIN_PLAYERS,
      players: [...this.players.values()].map((p) => {
        const progress = sentence ? correctProgress(p.typed, sentence) : 0;
        // WPM uses the finish time, the end of the race, or "now" while racing.
        const elapsed = p.finishMs ?? ((this.status === "finished" ? this.endAt : now) - this.startAt);
        return {
          id: p.id,
          name: p.name,
          isHost: p.id === this.hostId,
          connected: p.connected,
          ready: p.ready,
          progress,
          wpm: inRace && this.status !== "countdown" ? calcWpm(progress, elapsed) : 0,
          accuracy: calcAccuracy(p.correctKeys, p.totalKeys),
          finishMs: p.finishMs,
          place: p.place,
          dnf: p.dnf,
        };
      }),
    };
  }
}
