// Settings sheet — Claude API key (added later by the owner), your name,
// what she remembers, and a fresh start.

import { useEffect, useState } from "react";
import type { AppState } from "../state/store";
import { defaultState } from "../state/store";
import { HER_NAME } from "../engine/persona";
import { listDeviceVoices, speak, type DeviceVoice } from "../voice/speech";

interface Props {
  state: AppState;
  setState: React.Dispatch<React.SetStateAction<AppState>>;
  onClose: () => void;
}

export default function Settings({ state, setState, onClose }: Props) {
  const [key, setKey] = useState(state.apiKey);
  const [elevenKey, setElevenKey] = useState(state.elevenKey);
  const [sarvamKey, setSarvamKey] = useState(state.sarvamKey);
  const [elevenVoiceId, setElevenVoiceId] = useState(state.elevenVoiceId);
  const [name, setName] = useState(state.user.name);
  const [confirmReset, setConfirmReset] = useState(false);
  const [deviceVoice, setDeviceVoice] = useState(state.deviceVoice);
  const [voices, setVoices] = useState<DeviceVoice[]>([]);

  useEffect(() => {
    listDeviceVoices().then(setVoices);
  }, []);

  const save = () => {
    setState((s) => ({
      ...s,
      apiKey: key.trim(),
      elevenKey: elevenKey.trim(),
      elevenVoiceId: elevenVoiceId.trim(),
      sarvamKey: sarvamKey.trim(),
      deviceVoice,
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

        <label>Sarvam AI key (best Hinglish voice)</label>
        <input
          className="field"
          type="password"
          placeholder="sarvam key — Indian voices, made for Hinglish"
          value={sarvamKey}
          onChange={(e) => setSarvamKey(e.target.value)}
        />

        <label>ElevenLabs API key</label>
        <input
          className="field"
          type="password"
          placeholder="xi-…  (optional — unlocks her human voice)"
          value={elevenKey}
          onChange={(e) => setElevenKey(e.target.value)}
        />
        <label>ElevenLabs voice ID</label>
        <input
          className="field"
          placeholder="pick an Indian female voice in the ElevenLabs library"
          value={elevenVoiceId}
          onChange={(e) => setElevenVoiceId(e.target.value)}
        />
        <p className="hint" style={{ marginTop: 8 }}>
          With ElevenLabs she truly <em>speaks</em> — laughs, pauses, whispers,
          Hinglish with real emotion. Without it, calls use your phone's voice
          with humanised pacing.
        </p>

        {voices.length > 0 && (
          <>
            <label>Phone voice (fallback)</label>
            <select
              className="field"
              value={deviceVoice}
              onChange={(e) => {
                setDeviceVoice(e.target.value);
                speak(
                  "Hii... main Meera. Acha lag raha hai na?",
                  undefined,
                  undefined,
                  { deviceVoice: e.target.value },
                );
              }}
              style={{ appearance: "none", WebkitAppearance: "none" }}
            >
              <option value="">Auto (best available)</option>
              {voices.map((v) => (
                <option key={v.id} value={v.id}>
                  {v.label}
                </option>
              ))}
            </select>
            <p className="hint" style={{ marginTop: 8 }}>
              Phones often hide much better neural voices — try a few, she'll
              say hi in each.
            </p>
          </>
        )}

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
