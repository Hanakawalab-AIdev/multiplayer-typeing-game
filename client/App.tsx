import { useEffect, useRef, useState } from "react";
import type { RoomView } from "../shared/game";
import { playerId, socket } from "./socket";
import Home from "./components/Home";
import WaitingRoom from "./components/WaitingRoom";
import Race from "./components/Race";
import Results from "./components/Results";

export default function App() {
  const [room, setRoom] = useState<RoomView | null>(null);
  const [connected, setConnected] = useState(socket.connected);
  const [notice, setNotice] = useState<string | null>(null);
  const roomRef = useRef<RoomView | null>(null);
  roomRef.current = room;

  useEffect(() => {
    const onState = (r: RoomView) => setRoom(r);
    const onNone = () => {
      // We thought we were in a room but the server no longer has us (e.g. the
      // connection was down longer than the reconnect grace period).
      if (roomRef.current) setNotice("You were disconnected from the room for too long.");
      setRoom(null);
    };
    const onConnect = () => setConnected(true);
    const onDisconnect = () => setConnected(false);
    socket.on("room:state", onState);
    socket.on("room:none", onNone);
    socket.on("connect", onConnect);
    socket.on("disconnect", onDisconnect);
    return () => {
      socket.off("room:state", onState);
      socket.off("room:none", onNone);
      socket.off("connect", onConnect);
      socket.off("disconnect", onDisconnect);
    };
  }, []);

  const leave = () => {
    socket.emit("room:leave");
    setRoom(null);
  };

  let screen;
  if (!room) screen = <Home notice={notice} onDismissNotice={() => setNotice(null)} />;
  else if (room.status === "waiting") screen = <WaitingRoom room={room} meId={playerId} onLeave={leave} />;
  else if (room.status === "finished") screen = <Results room={room} meId={playerId} onLeave={leave} />;
  // key = raceId: a new race remounts the race screen with fresh local state.
  else screen = <Race key={room.raceId} room={room} meId={playerId} onLeave={leave} />;

  return (
    <div className="app">
      <header className="topbar">
        <h1>⌨️ Typing Race</h1>
        <span className={`conn ${connected ? "ok" : "bad"}`}>
          {connected ? "Connected" : "Reconnecting…"}
        </span>
      </header>
      {!connected && (
        <div className="banner warn" role="status">
          Lost connection to the server. Trying to reconnect — your seat is kept for 15 seconds.
        </div>
      )}
      <main>{screen}</main>
    </div>
  );
}
