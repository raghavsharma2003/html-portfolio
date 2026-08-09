// Settings sheet — Claude API key (added later by the owner), your name,
// what she remembers, and a fresh start.

import { useState } from "react";
import type { AppState } from "../state/store";
import { defaultState } from "../state/store";
import { HER_NAME } from "../engine/persona";

interface Props {
  state: AppState;
  setState: React.Dispatch<React.SetStateAction<AppState>>;
  onClose: () => void;
}

export default function Settings({ state, setState, onClose }: Props) {
  const [key, setKey] = useState(state.apiKey);
  const [name, setName] = useState(state.user.name);
  const [confirmReset, setConfirmReset] = useState(false);

  const save = () => {
    setState((s) => ({
      ...s,
      apiKey: key.trim(),
      user: { ...s.user, name: name.trim() || s.user.name },
    }));
    onClose();
  };

  const facts = Object.entries(state.user.facts);

  return (
    <>
      <div className="sheet-veil" onClick={onClose} />
      <div className="sheet">
        <div className="grab" />
        <h3>Settings</h3>
        <p className="hint">
          {HER_NAME} is an AI companion — she'll always be honest about that if you ask her.
        </p>

        <label>Your name</label>
        <input className="field" value={name} maxLength={24} onChange={(e) => setName(e.target.value)} />

        <label>Claude API key</label>
        <input
          className="field"
          type="password"
          placeholder="sk-ant-…  (optional — unlocks her full mind)"
          value={key}
          onChange={(e) => setKey(e.target.value)}
        />
        <p className="hint" style={{ marginTop: 8 }}>
          Without a key she runs on her built-in heart. With one, she thinks with
          Claude and gets dramatically deeper. Stored only on this device.
        </p>

        {facts.length > 0 && (
          <>
            <label>What she remembers about you</label>
            <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
              {facts.map(([k, v]) => (
                <span key={k} className="chip" style={{ fontSize: 13 }}>
                  {k}: {v}
                </span>
              ))}
            </div>
          </>
        )}

        <div style={{ height: 26 }} />
        <button className="btn-primary" onClick={save}>
          Save
        </button>
        <div style={{ height: 12 }} />
        {!confirmReset ? (
          <button className="btn-ghost" style={{ width: "100%" }} onClick={() => setConfirmReset(true)}>
            Start over…
          </button>
        ) : (
          <button
            className="btn-ghost"
            style={{ width: "100%", borderColor: "rgba(229,72,77,0.5)", color: "#f08a8e" }}
            onClick={() => {
              localStorage.clear();
              setState({ ...defaultState });
              onClose();
            }}
          >
            Erase everything — memories, chats, all of it
          </button>
        )}
      </div>
    </>
  );
}
