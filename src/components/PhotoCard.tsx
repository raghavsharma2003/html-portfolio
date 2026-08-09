// "Photos" Meera sends — generated aesthetic scene cards (work fully offline,
// swap for real image generation later without touching the chat code).

interface Props {
  seed: string;
}

type Scene = "sunset" | "coffee" | "night" | "rain" | "lights";

function sceneFor(seed: string): Scene {
  const s = seed.toLowerCase();
  if (/(sunset|sky|evening|cloud)/.test(s)) return "sunset";
  if (/(coffee|chai|tea|cozy|maggi|food|breakfast)/.test(s)) return "coffee";
  if (/(night|moon|star)/.test(s)) return "night";
  if (/(rain|monsoon|window)/.test(s)) return "rain";
  const all: Scene[] = ["sunset", "coffee", "night", "rain", "lights"];
  let h = 0;
  for (const c of seed) h = (h * 31 + c.charCodeAt(0)) >>> 0;
  return all[h % all.length];
}

export default function PhotoCard({ seed }: Props) {
  const scene = sceneFor(seed);

  if (scene === "sunset")
    return (
      <svg viewBox="0 0 320 240">
        <defs>
          <linearGradient id={`sk${seed}`} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="#3d2a5c" />
            <stop offset="45%" stopColor="#b4527a" />
            <stop offset="75%" stopColor="#f0906b" />
            <stop offset="100%" stopColor="#f8c882" />
          </linearGradient>
        </defs>
        <rect width="320" height="240" fill={`url(#sk${seed})`} />
        <circle cx="160" cy="178" r="34" fill="#ffe4b0" opacity="0.95" />
        <ellipse cx="90" cy="90" rx="60" ry="12" fill="rgba(255,255,255,0.14)" />
        <ellipse cx="230" cy="60" rx="70" ry="10" fill="rgba(255,255,255,0.1)" />
        <rect y="196" width="320" height="44" fill="#231226" />
        <path d="M0 196 L40 196 L40 176 L58 176 L58 196 L92 196 L92 160 L116 160 L116 196 L150 196 L150 170 L172 170 L172 196 L210 196 L210 152 L238 152 L238 196 L272 196 L272 168 L294 168 L294 196 L320 196 L320 240 L0 240 Z" fill="#2c1730" />
        {[52, 100, 126, 220, 248, 284].map((x, i) => (
          <rect key={i} x={x} y={170 + (i % 3) * 8} width="4" height="4" fill="#ffd98c" opacity="0.85" />
        ))}
      </svg>
    );

  if (scene === "coffee")
    return (
      <svg viewBox="0 0 320 240">
        <defs>
          <linearGradient id={`cf${seed}`} x1="0" y1="0" x2="1" y2="1">
            <stop offset="0%" stopColor="#4a3040" />
            <stop offset="100%" stopColor="#2a1a26" />
          </linearGradient>
        </defs>
        <rect width="320" height="240" fill={`url(#cf${seed})`} />
        <ellipse cx="160" cy="196" rx="120" ry="22" fill="#5c4050" />
        <ellipse cx="160" cy="150" rx="58" ry="14" fill="#f2e5d8" />
        <path d="M102 150 Q102 208 160 208 Q218 208 218 150 Z" fill="#f8f0e6" />
        <ellipse cx="160" cy="151" rx="48" ry="10" fill="#6b4530" />
        <path d="M218 158 Q244 160 240 178 Q236 194 214 190" fill="none" stroke="#f8f0e6" strokeWidth="9" />
        <path d="M140 120 Q136 104 146 96 M162 118 Q158 100 168 92 M184 122 Q180 106 190 98" fill="none" stroke="rgba(255,255,255,0.35)" strokeWidth="4" strokeLinecap="round" />
        <circle cx="60" cy="60" r="26" fill="rgba(240,177,149,0.2)" />
        <circle cx="272" cy="46" r="16" fill="rgba(180,140,224,0.2)" />
      </svg>
    );

  if (scene === "night")
    return (
      <svg viewBox="0 0 320 240">
        <defs>
          <linearGradient id={`nt${seed}`} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="#0d0b24" />
            <stop offset="100%" stopColor="#2a1c4a" />
          </linearGradient>
        </defs>
        <rect width="320" height="240" fill={`url(#nt${seed})`} />
        {Array.from({ length: 40 }).map((_, i) => {
          const x = ((i * 73) % 320) + 4;
          const y = ((i * 47) % 170) + 6;
          return <circle key={i} cx={x} cy={y} r={i % 5 === 0 ? 1.8 : 1} fill="#fff" opacity={0.4 + ((i * 13) % 60) / 100} />;
        })}
        <circle cx="240" cy="64" r="30" fill="#f4ead2" />
        <circle cx="230" cy="56" r="30" fill={`url(#nt${seed})`} />
        <path d="M0 200 Q80 168 160 196 Q240 224 320 188 L320 240 L0 240 Z" fill="#191233" />
      </svg>
    );

  if (scene === "rain")
    return (
      <svg viewBox="0 0 320 240">
        <defs>
          <linearGradient id={`rn${seed}`} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="#2c3450" />
            <stop offset="100%" stopColor="#1a2036" />
          </linearGradient>
        </defs>
        <rect width="320" height="240" fill={`url(#rn${seed})`} />
        {Array.from({ length: 26 }).map((_, i) => {
          const x = ((i * 41) % 320) + 3;
          const y = ((i * 67) % 200) + 6;
          return <line key={i} x1={x} y1={y} x2={x - 6} y2={y + 22} stroke="rgba(190,210,255,0.4)" strokeWidth="2" strokeLinecap="round" />;
        })}
        <circle cx="82" cy="180" r="30" fill="rgba(250,220,140,0.5)" filter="blur(2px)" />
        <circle cx="236" cy="160" r="22" fill="rgba(240,150,170,0.45)" filter="blur(2px)" />
        <rect y="210" width="320" height="30" fill="#10131f" />
      </svg>
    );

  return (
    <svg viewBox="0 0 320 240">
      <defs>
        <linearGradient id={`lt${seed}`} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="#1c1024" />
          <stop offset="100%" stopColor="#33182e" />
        </linearGradient>
      </defs>
      <rect width="320" height="240" fill={`url(#lt${seed})`} />
      <path d="M0 60 Q80 100 160 66 Q240 32 320 76" fill="none" stroke="#3a2438" strokeWidth="3" />
      <path d="M0 130 Q80 170 160 136 Q240 102 320 146" fill="none" stroke="#3a2438" strokeWidth="3" />
      {Array.from({ length: 18 }).map((_, i) => {
        const x = i * 18 + 8;
        const y1 = 60 + Math.sin((x / 320) * Math.PI * 2) * 24 + (i % 2) * 10;
        const y2 = 130 + Math.sin((x / 320) * Math.PI * 2) * 24 + (i % 2) * 10;
        const warm = i % 3 !== 0;
        return (
          <g key={i}>
            <circle cx={x} cy={y1 + 8} r="4" fill={warm ? "#ffd98c" : "#f0a0b8"} opacity="0.9" />
            <circle cx={x} cy={y1 + 8} r="9" fill={warm ? "#ffd98c" : "#f0a0b8"} opacity="0.2" />
            <circle cx={x + 9} cy={y2 + 8} r="4" fill={warm ? "#f0a0b8" : "#ffd98c"} opacity="0.9" />
            <circle cx={x + 9} cy={y2 + 8} r="9" fill={warm ? "#f0a0b8" : "#ffd98c"} opacity="0.2" />
          </g>
        );
      })}
    </svg>
  );
}
