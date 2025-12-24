// src/components/AuthBar.tsx
import React, { useEffect, useState } from "react";
import { supabase } from "../lib/supabase";

export default function AuthBar() {
  const [userEmail, setUserEmail] = useState<string>("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [msg, setMsg] = useState("");

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => {
      setUserEmail(data.session?.user?.email ?? "");
    });

    const { data: sub } = supabase.auth.onAuthStateChange((_event, session) => {
      setUserEmail(session?.user?.email ?? "");
    });

    return () => sub.subscription.unsubscribe();
  }, []);

  const signIn = async () => {
    setMsg("");
    const { error } = await supabase.auth.signInWithPassword({ email, password });
    if (error) setMsg(error.message);
  };

  const signOut = async () => {
    setMsg("");
    const { error } = await supabase.auth.signOut();
    if (error) setMsg(error.message);
  };

  return (
    <div className="authbar">
      {!userEmail ? (
        <>
          <span className="authbar-status">未ログイン</span>

          <input
            className="authbar-input"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="email"
          />

          <input
            className="authbar-input"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            placeholder="password"
            type="password"
          />

          <button className="btn-primary authbar-btn" onClick={signIn}>
            ログイン
          </button>

          {msg && <span className="authbar-msg">{msg}</span>}
        </>
      ) : (
        <>
          <span className="authbar-status">ログイン中: {userEmail}</span>

          <button className="btn-primary authbar-btn" onClick={signOut}>
            ログアウト
          </button>

          {msg && <span className="authbar-msg">{msg}</span>}
        </>
      )}
    </div>
  );
}
