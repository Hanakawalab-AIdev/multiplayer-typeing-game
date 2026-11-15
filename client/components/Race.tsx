import { useEffect, useRef, useState, type ChangeEvent } from "react";
import { applyKey, firstErrorIndex, formatMs, type RoomView } from "../../shared/game";
import { socket } from "../socket";
import RaceTrack from "./RaceTrack";

interface Props {
  room: RoomView;
  meId: string;
  onLeave: () => void;
}

/**
 * The race screen. Typing is applied locally right away (so it feels instant)
 * and every keystroke is also sent to the server, which runs the exact same
 * rules and decides progress, finish time and placement.
 */
export default function Race({ room, meId, onLeave }: Props) {
  const sentence = room.sentence ?? "";
  const me = room.players.find((p) => p.id === meId);
  const [typed, setTyped] = useState("");
  const typedRef = useRef("");
  const inputRef = useRef<HTMLInputElement>(null);

  // Convert the server's "starts in X ms" into a local timestamp once per race,
  // so the countdown does not depend on the two clocks agreeing.
  const startAtRef = useRef<number | null>(null);
  if (startAtRef.current === null && room.startsInMs !== null) {
    startAtRef.current = Date.now() + room.startsInMs;
  }
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 100);
    return () => clearInterval(t);
  }, []);

  const racing = room.status === "racing";
  const finished = me?.finishMs != null;
  const msToStart = (startAtRef.current ?? now) - now;

  useEffect(() => {
    if (racing) inputRef.current?.focus();
  }, [racing]);

  // The server overrides our text if it had to drop keys or after a reconnect.
  useEffect(() => {
    const onResync = (serverTyped: string) => {
      typedRef.current = serverTyped;
      setTyped(serverTyped);
    };
    socket.on("race:resync", onResync);
    return () => {
      socket.off("race:resync", onResync);
    };
  }, []);

  const onChange = (e: ChangeEvent<HTMLInputElement>) => {
    if (!racing || finished) return;
    const value = e.target.value;
    const prev = typedRef.current;
    // Turn the input change into keystrokes: characters added at the end, or Backspaces.
    const keys: string[] = [];
    if (value.startsWith(prev)) keys.push(...value.slice(prev.length));
    else if (prev.startsWith(value)) for (let i = value.length; i < prev.length; i++) keys.push("Backspace");
    else return; // edits in the middle of the text are not allowed

    let next = prev;
    for (const key of keys) {
      const r = applyKey(next, key, sentence);
      if (!r.changed) continue;
      next = r.typed;
      socket.emit("race:key", key);
    }
    typedRef.current = next;
    setTyped(next);
  };

  const errAt = firstErrorIndex(typed, sentence);
  const hasError = errAt !== -1;

  return (
    <section className="card race">
      {room.status === "countdown" && (
        <div className="countdown" aria-live="assertive">
          <span key={Math.ceil(msToStart / 1000)}>{Math.max(1, Math.ceil(msToStart / 1000))}</span>
          <p>Get ready…</p>
        </div>
      )}

      <div className="race-head">
        <span className="muted">Room {room.code}</span>
        <span className="timer">
          {racing ? formatMs(Math.max(0, now - (startAtRef.current ?? now))) : "0.00s"}
        </span>
      </div>

      <RaceTrack players={room.players} sentenceLength={sentence.length} meId={meId} />

      {/* The sentence, coloured as you type: green = correct, red = mistake. */}
      <p className={`sentence ${hasError ? "has-error" : ""}`} onClick={() => inputRef.current?.focus()} aria-label={sentence}>
        {[...sentence].map((ch, i) => {
          let cls = "todo";
          if (i < typed.length) cls = hasError && i >= errAt ? "wrong" : "done";
          else if (i === typed.length) cls = "cursor";
          return <span key={i} className={cls}>{ch}</span>;
        })}
      </p>

      <input
        ref={inputRef}
        className={`type-input ${hasError ? "error" : ""}`}
        value={typed}
        onChange={onChange}
        onPaste={(e) => e.preventDefault()}
        onDrop={(e) => e.preventDefault()}
        disabled={!racing || finished}
        placeholder={room.status === "countdown" ? "Wait for it…" : "Start typing here"}
        autoComplete="off"
        autoCorrect="off"
        autoCapitalize="off"
        spellCheck={false}
        aria-label="Type the sentence"
      />

      <div className="race-foot">
        {hasError ? (
          <span className="error">Typo! Press Backspace to fix it — progress stops at the first mistake.</span>
        ) : finished ? (
          <span className="ok">Finished in {formatMs(me!.finishMs!)} — place #{me!.place}. Waiting for the others…</span>
        ) : (
          <span className="muted">
            {me ? `${me.wpm} WPM · ${me.accuracy}% accuracy` : ""}
          </span>
        )}
        <button className="ghost small" onClick={onLeave}>Leave race</button>
      </div>
    </section>
  );
}
