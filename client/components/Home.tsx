import { useState, type FormEvent } from "react";
import { NAME_MAX_LENGTH, ROOM_CODE_LENGTH, normalizeName, normalizeRoomCode } from "../../shared/game";
import { socket } from "../socket";

const NAME_KEY = "typing-race-name";

function loadName() {
  try {
    return localStorage.getItem(NAME_KEY) ?? "";
  } catch {
    return "";
  }
}

function saveName(name: string) {
  try {
    localStorage.setItem(NAME_KEY, name);
  } catch {
    /* storage unavailable: ignore */
  }
}

interface Props {
  notice: string | null;
  onDismissNotice: () => void;
}

/** Start screen: choose a name, then create a room or join one with a code. */
export default function Home({ notice, onDismissNotice }: Props) {
  const [name, setName] = useState(loadName);
  const [code, setCode] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const validName = () => {
    const n = normalizeName(name);
    if (!n) setError(`Enter a name: 1–${NAME_MAX_LENGTH} letters, numbers or spaces.`);
    else saveName(n);
    return n;
  };

  const create = () => {
    const n = validName();
    if (!n) return;
    setBusy(true);
    setError(null);
    socket.emit("room:create", { name: n }, (res) => {
      setBusy(false);
      if (!res.ok) setError(res.error);
    });
  };

  const join = (e: FormEvent) => {
    e.preventDefault();
    const n = validName();
    if (!n) return;
    const c = normalizeRoomCode(code);
    if (!c) return setError(`Room codes are ${ROOM_CODE_LENGTH} letters.`);
    setBusy(true);
    setError(null);
    socket.emit("room:join", { name: n, code: c }, (res) => {
      setBusy(false);
      if (!res.ok) setError(res.error);
    });
  };

  return (
    <section className="card home">
      <p className="lead">Race up to 3 friends to type a sentence first. 2–4 players per room.</p>

      {notice && (
        <div className="banner warn">
          {notice} <button className="link" onClick={onDismissNotice}>Dismiss</button>
        </div>
      )}

      <label className="field">
        <span>Your name</span>
        <input
          value={name}
          maxLength={NAME_MAX_LENGTH}
          onChange={(e) => setName(e.target.value)}
          placeholder="e.g. Sam"
          autoFocus
        />
      </label>

      <div className="home-actions">
        <div className="home-box">
          <h2>New room</h2>
          <p className="muted">Get a code to share with friends.</p>
          <button className="primary" onClick={create} disabled={busy || !socket.connected}>
            Create room
          </button>
        </div>

        <form className="home-box" onSubmit={join}>
          <h2>Join a room</h2>
          <label className="field">
            <span>Room code</span>
            <input
              className="code-input"
              value={code}
              maxLength={ROOM_CODE_LENGTH}
              onChange={(e) => setCode(e.target.value.toUpperCase().replace(/[^A-Z]/g, ""))}
              placeholder="ABCD"
              autoCapitalize="characters"
            />
          </label>
          <button type="submit" disabled={busy || !socket.connected}>Join</button>
        </form>
      </div>

      {error && <p className="error" role="alert">{error}</p>}
    </section>
  );
}
