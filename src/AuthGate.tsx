import React, { useEffect, useState } from "react";
import type { Session } from '@supabase/supabase-js';
import { supabase } from "./lib/supabase";

export function AuthGate(props: { children: (session: Session) => React.ReactNode }) {
  const [session, setSession] = useState<Session | null>(null);
  const [email, setEmail] = useState("");
  const [pass, setPass] = useState("");

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => setSession(data.session ?? null));
    const { data: sub } = supabase.auth.onAuthStateChange((_event, newSession) => {
      setSession(newSession);
    });
    return () => sub.subscription.unsubscribe();
  }, []);

  const signIn = async () => {
    const { error } = await supabase.auth.signInWithPassword({ email, password: pass });
    if (error) alert(error.message);
  };

  const signUp = async () => {
    const { error } = await supabase.auth.signUp({ email, password: pass });
    if (error) alert(error.message);
    else alert("登録できました。確認メールが来たら承認してください（設定次第）");
  };

  const signOut = async () => {
    await supabase.auth.signOut();
  };

  if (!session) {
    return (
      <div style={{ padding: 24, maxWidth: 420 }}>
        <h2>ログイン</h2>
        <div style={{ display: "grid", gap: 8 }}>
          <input value={email} onChange={(e) => setEmail(e.target.value)} placeholder="email" />
          <input value={pass} onChange={(e) => setPass(e.target.value)} placeholder="password" type="password" />
          <button onClick={signIn}>ログイン</button>
          <button onClick={signUp}>新規登録</button>
        </div>
      </div>
    );
  }

  return (
    <div>
      <div style={{ padding: 8, display: "flex", justifyContent: "flex-end" }}>
        <button onClick={signOut}>ログアウト</button>
      </div>
      {props.children(session)}
    </div>
  );
}
