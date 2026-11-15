import { useState } from "react";
import type { RoomView } from "../../shared/game";
import { socket } from "../socket";

interface Props {
  room: RoomView;
  meId: string;
  onLeave: () => void;
}

/** Lobby for one room: share the code, ready up, and (as host) start the race. */
export default function WaitingRoom({ room, meId, onLeave }: Props) {
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const me = room.players.find((p) => p.id === meId);
  const connected = room.players.filter((p) => p.connected);
  const enough = connected.length >= room.minPlayers;
  const full = room.players.length >= room.maxPlayers;
  const emptySlots = Math.max(0, room.maxPlayers - room.players.length);

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(room.code);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      /* clipboard blocked: the code is visible anyway */
    }
  };

  const start = () => {
    setError(null);
    socket.emit("race:start", (res) => {
      if (!res.ok) setError(res.error);
    });
  };

  return (
    <section className="card">
      <div className="room-code">
        <span className="muted">Room code</span>
        <strong>{room.code}</strong>
        <button className="small" onClick={copy}>{copied ? "Copied!" : "Copy"}</button>
      </div>

      <h2>
        Players {room.players.length}/{room.maxPlayers}
        {full && <span className="tag">Room full</span>}
      </h2>
      <ul className="player-list">
        {room.players.map((p) => (
          <li key={p.id} className={p.connected ? "" : "offline"}>
            <span className="name">
              {p.name}
              {p.id === meId && <span className="you"> (you)</span>}
              {p.isHost && <span className="tag">Host</span>}
            </span>
            {!p.connected ? (
              <span className="status offline">Disconnected…</span>
            ) : p.ready ? (
              <span className="status ready">✔ Ready</span>
            ) : (
              <span className="status">Not ready</span>
            )}
          </li>
        ))}
        {Array.from({ length: emptySlots }, (_, i) => (
          <li key={`empty-${i}`} className="empty">Waiting for a player…</li>
        ))}
      </ul>

      <p className="muted">
        {enough
          ? "The race starts when the host presses Start or when everyone is ready."
          : `Waiting for at least ${room.minPlayers} players. Share the room code above.`}
      </p>

      <div className="actions">
        <button
          className={me?.ready ? "" : "primary"}
          onClick={() => socket.emit("player:ready", !me?.ready)}
        >
          {me?.ready ? "Not ready" : "I'm ready"}
        </button>
        {me?.isHost && (
          <button className="primary" onClick={start} disabled={!enough}>
            Start race
          </button>
        )}
        <button className="ghost" onClick={onLeave}>Leave room</button>
      </div>
      {error && <p className="error" role="alert">{error}</p>}
    </section>
  );
}
