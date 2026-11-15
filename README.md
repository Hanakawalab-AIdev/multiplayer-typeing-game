# Typing Race

A small real-time multiplayer typing race. Create a room, share the 4-letter code, and race 1–3 friends to type the same sentence first.

**Stack:** React + TypeScript (Vite) for the client, Node.js + Socket.IO for the server.

## Requirements

- Node.js 18 or newer (includes npm)

## Setup and run

```bash
npm install
npm run dev
```

`npm run dev` starts both parts:

- the game server on http://localhost:3001
- the web app on **http://localhost:5173**, which is the address to open

### Testing multiplayer locally with two browser windows

1. Run `npm run dev` and open http://localhost:5173.
2. Open a **second window** at the same address. Use a new window (Ctrl+N / Cmd+N), not "Duplicate tab": each window is its own player.
3. In window 1, enter a name and click **Create room**. Note the 4-letter code.
4. In window 2, enter a different name, type the code and click **Join**.
5. Either click **Start race** in the host's window, or click **I'm ready** in both windows.
6. After the 3-second countdown, type in each window. Both progress bars update live in both windows.

To test with other devices on your network, run `npx vite --host` in place of the client part, then open the "Network" address it prints.

### Automated checks

With `npm run dev` running, use a second terminal:

```bash
npm run smoke
```

This runs 21 multiplayer checks against the server: validation, full rooms, host handoff, joining during a race, rate limiting, winning, and disconnects. `npm run typecheck` type-checks the whole project.

### Production build

```bash
npm run build
npm start
```

This serves the built app and the game server together on http://localhost:3001. Set `PORT` to change the port.

## How to play

- 2–4 players per room. The race starts when the host clicks **Start race**, or automatically when every player is ready.
- Everyone gets the same random sentence after a 3-second countdown.
- Mistakes are shown in red. Your progress stops at the first mistake until you fix it with Backspace. After 5 wrong characters you can't type further.
- The first player to finish correctly wins. The others then have 30 seconds to finish before the race ends.
- Results show placement, WPM, accuracy and finish time. Click **Rematch** to race again (it starts once everyone has voted), or **Back to lobby** to leave.

## Project structure

```
shared/game.ts            Rules, limits, validation, typing logic, message types (used by both sides)
server/index.ts           HTTP + Socket.IO server, input validation, event handlers
server/roomManager.ts     Room codes, joining/leaving, disconnects and reconnects
server/room.ts            One room: lobby, countdown, scoring, race end, results
server/sentences.ts       Sentence list
client/App.tsx            Picks the screen for the current room state
client/socket.ts          Socket.IO connection and per-tab player id
client/components/        Home, WaitingRoom, Race, RaceTrack, Results
```

## Fairness and multiplayer design

- **The server is the source of truth.** Clients send individual keystrokes. The server keeps each player's typed text and computes progress, accuracy, WPM, finish time and placement. A client cannot report a fake result.
- The client runs the same `applyKey` function only to show its own typing instantly. If they ever disagree (for example, the server rejected keys that came in too fast), the server sends `race:resync` and the client adopts the server's text.
- **Same start for everyone.** The server fixes the start time and ignores keys sent before it. Clients turn "starts in N ms" into their own local time, so clock differences between computers don't matter.
- **Anti-cheat basics.** Paste is blocked, keystrokes are limited to 30 per second, and every input is validated: names, room codes, keys, and message size.
- **Disconnects.**
  - During a race, a disconnected player stays on the track marked "disconnected". If the connection comes back, Socket.IO reconnects automatically and they continue where they left off.
  - In the lobby or on the results screen, a player's seat is kept for 15 seconds.
  - If the host leaves, host rights pass to the next player.
  - The race ends early once every connected player has finished.
  - Players who never finish are listed as DNF.
