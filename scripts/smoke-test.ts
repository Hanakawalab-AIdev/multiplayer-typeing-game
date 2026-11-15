// Automated multiplayer checks against a running server.
// Usage: start the server (`npm run dev`), then `npm run smoke`.
import { io, type Socket } from "socket.io-client";
import type { Ack, ClientToServerEvents, RoomView, ServerToClientEvents } from "../shared/game";

const URL = process.env.SERVER_URL ?? "http://localhost:3001";
type Client = Socket<ServerToClientEvents, ClientToServerEvents> & { last?: RoomView; id2: string };

let failures = 0;
function check(name: string, ok: boolean, detail = "") {
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? `  (${detail})` : ""}`);
  if (!ok) failures++;
}
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function connect(tag: string): Promise<Client> {
  const id2 = `smoke-${tag}-${Math.random().toString(36).slice(2, 10)}`;
  const s = io(URL, { auth: { playerId: id2 }, forceNew: true }) as Client;
  s.id2 = id2;
  s.on("room:state", (r) => (s.last = r));
  await new Promise<void>((res, rej) => {
    s.once("connect", () => res());
    s.once("connect_error", rej);
  });
  return s;
}
const create = (s: Client, name: string) =>
  new Promise<Ack<{ code: string }>>((r) => s.emit("room:create", { name }, r));
const join = (s: Client, name: string, code: string) =>
  new Promise<Ack<{ code: string }>>((r) => s.emit("room:join", { name, code }, r));

async function main() {
  // --- validation ---
  const a = await connect("a");
  const bad = await create(a, "   ");
  check("rejects empty name", !bad.ok);
  const bad2 = await create(a, "<script>");
  check("rejects unsafe name", !bad2.ok);
  const badCode = await join(a, "Ann", "12");
  check("rejects malformed room code", !badCode.ok);

  // --- create + join, full room ---
  const made = await create(a, "Ann");
  check("creates room", made.ok);
  const code = made.ok ? made.code : "";
  const others = await Promise.all(["b", "c", "d", "e"].map(connect));
  const [b, c, d, e] = others;
  const dup = await join(b, "ann", code);
  check("rejects duplicate name in room", !dup.ok);
  check("player 2 joins", (await join(b, "Ben", code)).ok);
  check("player 3 joins", (await join(c, "Cat", code)).ok);
  check("player 4 joins", (await join(d, "Dan", code)).ok);
  const full = await join(e, "Eve", code);
  check("5th player gets 'room full'", !full.ok && /full/i.test(full.error), full.ok ? "" : full.error);

  // --- only host may start ---
  const notHost = await new Promise<Ack>((r) => b.emit("race:start", r));
  check("non-host cannot start", !notHost.ok);

  // --- host leaves: host passes on ---
  d.emit("room:leave");
  a.emit("room:leave");
  await sleep(200);
  const hostNow = b.last?.players.find((p) => p.isHost)?.name;
  check("host rights pass to next player", hostNow === "Ben", `host=${hostNow}`);

  // --- start race, keys before GO are ignored ---
  const started = await new Promise<Ack>((r) => b.emit("race:start", r));
  check("host starts race", started.ok);
  await sleep(100);
  b.emit("race:key", "x");
  const joinDuring = await join(e, "Eve", code);
  check("cannot join during a race", !joinDuring.ok);
  await sleep(3200);
  const sentence = b.last!.sentence!;
  check("everyone gets the same sentence", !!sentence && c.last?.sentence === sentence);
  check("keys before GO ignored", b.last!.players.find((p) => p.name === "Ben")!.progress === 0);

  // --- invalid keys are ignored ---
  (b.emit as (ev: string, ...args: unknown[]) => void)("race:key", "abc");
  (b.emit as (ev: string, ...args: unknown[]) => void)("race:key", { evil: true });
  await sleep(100);
  check("multi-char / non-string keys ignored", b.last!.players.find((p) => p.name === "Ben")!.progress === 0);

  // --- cheating: sending the whole sentence instantly gets rate-limited ---
  let resynced = false;
  c.once("race:resync", () => (resynced = true));
  for (const ch of sentence) c.emit("race:key", ch);
  await sleep(300);
  const catProgress = c.last!.players.find((p) => p.name === "Cat")!.progress;
  check("instant full-sentence burst is rate-limited", catProgress < sentence.length && resynced, `progress ${catProgress}/${sentence.length}`);

  // --- Ben types correctly at a human-ish pace and wins ---
  for (let i = 0; i < sentence.length; i++) {
    b.emit("race:key", sentence[i]);
    if (i % 20 === 19) await sleep(1000);
  }
  await sleep(300);
  const ben = b.last!.players.find((p) => p.name === "Ben")!;
  check("Ben finishes in 1st place", ben.place === 1 && ben.finishMs !== null, `place=${ben.place}`);
  check("WPM and accuracy computed", ben.wpm > 0 && ben.accuracy === 100, `wpm=${ben.wpm} acc=${ben.accuracy}`);

  // --- disconnect during race ends it when everyone left has finished ---
  c.disconnect();
  await sleep(300);
  check("race ends after the last unfinished player disconnects", b.last!.status === "finished");
  const cat = b.last!.players.find((p) => p.name === "Cat")!;
  check("disconnected player is DNF", cat.dnf && !cat.connected);

  for (const s of [a, b, d, e]) s.disconnect();
  console.log(failures ? `\n${failures} check(s) failed` : "\nAll checks passed");
  process.exit(failures ? 1 : 0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
