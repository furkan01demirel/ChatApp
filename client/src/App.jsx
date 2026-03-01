import { useEffect, useState } from "react";
import { onAuthStateChanged } from "firebase/auth";
import { auth } from "./firebase/firebase"; // sende dosya adı neyse
import Login from "./Login";
import Chat from "./chat";
import "./App.css";

export default function App() {
  const [user, setUser] = useState(null);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    return onAuthStateChanged(auth, (u) => {
      setUser(u ?? null);
      setReady(true);
    });
  }, []);

  if (!ready) return <div style={{ padding: 24 }}>Yükleniyor...</div>;
  if (!user) return <Login />;

  return <Chat />;
}