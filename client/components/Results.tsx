import { formatMs, type RoomView } from "../../shared/game";
import { socket } from "../socket";

const MEDALS = ["🥇", "🥈", "🥉"];

interface Props {
  room: RoomView;
  meId: string;
  onLeave: () => void;
}

/** Final standings, computed by the server. Everyone votes for a rematch or leaves. */
export default function Results({ room, meId, onLeave }: Props) {
  const ranked = [...room.players].sort((a, b) => (a.place ?? 99) - (b.place ?? 99));
  const winner = ranked.find((p) => p.place === 1 && !p.dnf);
  const me = room.players.find((p) => p.id === meId);
  const voters = room.players.filter((p) => p.connected);
  const votes = voters.filter((p) => p.ready).length;

  return (
    <section className="card">
      <h2 className="winner">
        {winner ? (winner.id === meId ? "🏆 You win!" : `🏆 ${winner.name} wins!`) : "Nobody finished this time."}
      </h2>

      <div className="table-wrap">
        <table className="results">
          <thead>
            <tr><th>Place</th><th>Player</th><th>WPM</th><th>Accuracy</th><th>Time</th></tr>
          </thead>
          <tbody>
            {ranked.map((p) => (
              <tr key={p.id} className={p.id === meId ? "me" : ""}>
                <td>{p.dnf ? "—" : MEDALS[(p.place ?? 0) - 1] ?? `#${p.place}`}</td>
                <td>
                  {p.name}
                  {p.id === meId && <span className="you"> (you)</span>}
                  {!p.connected && <span className="tag warn">left</span>}
                </td>
                <td>{p.wpm}</td>
                <td>{p.accuracy}%</td>
                <td>{p.dnf ? "DNF" : p.finishMs !== null ? formatMs(p.finishMs) : "—"}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <p className="muted sentence-recap">“{room.sentence}”</p>

      <div className="actions">
        <button className="primary" onClick={() => socket.emit("race:rematch")} disabled={me?.ready}>
          {me?.ready ? "Waiting for others…" : "Rematch"}
        </button>
        <button className="ghost" onClick={onLeave}>Back to lobby</button>
      </div>
      <p className="muted">
        Rematch votes: {votes}/{voters.length}. A new race starts when everyone votes
        {voters.length < room.minPlayers ? " (you'll go back to the waiting room until someone joins)" : ""}.
      </p>
    </section>
  );
}
