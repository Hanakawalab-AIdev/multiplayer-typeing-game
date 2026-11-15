import type { PlayerView } from "../../shared/game";

const LANE_COLORS = ["#e5484d", "#3e63dd", "#30a46c", "#f5a524"];
const MEDALS = ["🥇", "🥈", "🥉"];

interface Props {
  players: PlayerView[];
  sentenceLength: number;
  meId: string;
}

/** One progress bar per player. Progress comes from the server, so everyone sees the same thing. */
export default function RaceTrack({ players, sentenceLength, meId }: Props) {
  return (
    <ul className="track">
      {players.map((p, i) => {
        const pct = sentenceLength ? Math.min(100, (p.progress / sentenceLength) * 100) : 0;
        return (
          <li key={p.id} className={`lane ${p.id === meId ? "me" : ""} ${p.connected ? "" : "offline"}`}>
            <div className="lane-head">
              <span className="name">
                {p.name}
                {p.id === meId && <span className="you"> (you)</span>}
                {!p.connected && <span className="tag warn">disconnected</span>}
              </span>
              <span className="lane-stats">
                {p.place && !p.dnf && <span className="place">{MEDALS[p.place - 1] ?? `#${p.place}`}</span>}
                {p.wpm} WPM
              </span>
            </div>
            <div className="bar" role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(pct)} aria-label={`${p.name} progress`}>
              <div className="fill" style={{ width: `${pct}%`, background: LANE_COLORS[i % LANE_COLORS.length] }} />
              <span className="runner" style={{ left: `${pct}%` }}>{p.finishMs !== null ? "🏁" : "🏃"}</span>
            </div>
          </li>
        );
      })}
    </ul>
  );
}
