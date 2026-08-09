// Meera's animated avatar — a layered SVG illustration that breathes,
// blinks, sways, and lip-syncs while she speaks.

import { useEffect, useRef, useState } from "react";

interface Props {
  size?: number;
  speaking?: boolean;
  listening?: boolean;
}

type MouthState = "rest" | "small" | "open" | "wide";

const MOUTHS: Record<MouthState, string> = {
  rest: "M172 258 Q200 274 228 258 Q200 268 172 258 Z",
  small: "M178 258 Q200 272 222 258 Q200 278 178 258 Z",
  open: "M176 254 Q200 262 224 254 Q222 284 200 286 Q178 284 176 254 Z",
  wide: "M170 252 Q200 262 230 252 Q228 292 200 296 Q172 292 170 252 Z",
};

export default function Avatar({ size = 280, speaking = false, listening = false }: Props) {
  const [blink, setBlink] = useState(false);
  const [mouth, setMouth] = useState<MouthState>("rest");
  const mouthTimer = useRef<ReturnType<typeof setInterval> | null>(null);

  // natural blinking
  useEffect(() => {
    let alive = true;
    const loop = () => {
      if (!alive) return;
      setTimeout(() => {
        if (!alive) return;
        setBlink(true);
        setTimeout(() => {
          setBlink(false);
          loop();
        }, 130);
      }, 2200 + Math.random() * 3200);
    };
    loop();
    return () => {
      alive = false;
    };
  }, []);

  // lip sync
  useEffect(() => {
    if (speaking) {
      const states: MouthState[] = ["small", "open", "rest", "wide", "small", "open"];
      mouthTimer.current = setInterval(() => {
        setMouth(states[Math.floor(Math.random() * states.length)]);
      }, 110);
    } else {
      setMouth("rest");
    }
    return () => {
      if (mouthTimer.current) clearInterval(mouthTimer.current);
    };
  }, [speaking]);

  const eyeScaleY = blink ? 0.08 : listening ? 1.08 : 1;

  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 400 400"
      style={{ display: "block" }}
    >
      <defs>
        <radialGradient id="av-bg" cx="50%" cy="38%" r="75%">
          <stop offset="0%" stopColor="#2a1b35" />
          <stop offset="100%" stopColor="#170e1f" />
        </radialGradient>
        <linearGradient id="av-skin" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="#f2c19c" />
          <stop offset="100%" stopColor="#e0a37e" />
        </linearGradient>
        <linearGradient id="av-hair" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0%" stopColor="#3b2333" />
          <stop offset="55%" stopColor="#2a1626" />
          <stop offset="100%" stopColor="#4a2b3d" />
        </linearGradient>
        <linearGradient id="av-top" x1="0" y1="0" x2="1" y2="0">
          <stop offset="0%" stopColor="#e4849f" />
          <stop offset="100%" stopColor="#b48ce0" />
        </linearGradient>
        <radialGradient id="av-blush" cx="50%" cy="50%" r="50%">
          <stop offset="0%" stopColor="rgba(232,120,140,0.5)" />
          <stop offset="100%" stopColor="rgba(232,120,140,0)" />
        </radialGradient>
      </defs>

      <rect width="400" height="400" fill="url(#av-bg)" />

      {/* whole figure: gentle breathing + sway */}
      <g style={{ animation: "av-breathe 4.6s ease-in-out infinite", transformOrigin: "200px 400px" }}>
        {/* hair — back */}
        <path
          d="M200 52 C118 52 84 118 86 190 C88 252 74 300 64 336 C110 356 140 348 156 332 L244 332 C260 348 290 356 336 336 C326 300 312 252 314 190 C316 118 282 52 200 52 Z"
          fill="url(#av-hair)"
        />
        {/* neck */}
        <rect x="178" y="288" width="44" height="52" rx="18" fill="#daa079" />
        {/* shoulders / top */}
        <path
          d="M96 400 C102 352 142 330 200 330 C258 330 298 352 304 400 Z"
          fill="url(#av-top)"
        />
        {/* head group: subtle tilt sway */}
        <g style={{ animation: "av-sway 7s ease-in-out infinite", transformOrigin: "200px 260px" }}>
          {/* ears */}
          <ellipse cx="118" cy="212" rx="14" ry="20" fill="#e6a982" />
          <ellipse cx="282" cy="212" rx="14" ry="20" fill="#e6a982" />
          {/* earrings */}
          <circle cx="118" cy="236" r="6" fill="none" stroke="#f0c987" strokeWidth="2.5" />
          <circle cx="282" cy="236" r="6" fill="none" stroke="#f0c987" strokeWidth="2.5" />

          {/* face */}
          <path
            d="M200 84 C142 84 116 132 118 194 C120 258 156 302 200 302 C244 302 280 258 282 194 C284 132 258 84 200 84 Z"
            fill="url(#av-skin)"
          />

          {/* blush */}
          <ellipse cx="146" cy="238" rx="22" ry="13" fill="url(#av-blush)" />
          <ellipse cx="254" cy="238" rx="22" ry="13" fill="url(#av-blush)" />

          {/* brows */}
          <path d="M136 172 Q156 160 178 168" fill="none" stroke="#402638" strokeWidth="5" strokeLinecap="round" />
          <path d="M222 168 Q244 160 264 172" fill="none" stroke="#402638" strokeWidth="5" strokeLinecap="round" />

          {/* eyes */}
          <g style={{ transform: `scaleY(${eyeScaleY})`, transformOrigin: "200px 198px", transition: "transform 90ms ease" }}>
            <ellipse cx="158" cy="198" rx="17" ry="12.5" fill="#fdf6ef" />
            <ellipse cx="242" cy="198" rx="17" ry="12.5" fill="#fdf6ef" />
            <circle cx="160" cy="199" r="8.5" fill="#4a2c22" />
            <circle cx="244" cy="199" r="8.5" fill="#4a2c22" />
            <circle cx="160" cy="199" r="4" fill="#180d0a" />
            <circle cx="244" cy="199" r="4" fill="#180d0a" />
            <circle cx="163" cy="195.5" r="2.4" fill="#fff" opacity="0.95" />
            <circle cx="247" cy="195.5" r="2.4" fill="#fff" opacity="0.95" />
          </g>
          {/* lash lines */}
          <path d="M141 193 Q158 184 175 192" fill="none" stroke="#33202c" strokeWidth="3.4" strokeLinecap="round" />
          <path d="M225 192 Q242 184 259 193" fill="none" stroke="#33202c" strokeWidth="3.4" strokeLinecap="round" />

          {/* nose */}
          <path d="M198 214 Q194 232 200 238 Q205 240 208 236" fill="none" stroke="#c98d68" strokeWidth="3" strokeLinecap="round" />

          {/* mouth (lip-synced) */}
          <path d={MOUTHS[mouth]} fill="#b0475d" style={{ transition: "d 80ms ease" }} />
          {mouth === "rest" && (
            <path d="M180 257 Q200 270 220 257" fill="none" stroke="#8e3549" strokeWidth="2" strokeLinecap="round" opacity="0.6" />
          )}

          {/* hair — front strands */}
          <path
            d="M200 52 C130 54 106 106 112 168 C118 130 138 108 158 104 C150 130 148 152 152 168 C168 128 196 108 200 92 C204 108 232 128 248 168 C252 152 250 130 242 104 C262 108 282 130 288 168 C294 106 270 54 200 52 Z"
            fill="url(#av-hair)"
          />
          {/* hair shine */}
          <path d="M150 78 Q186 62 232 74" fill="none" stroke="rgba(255,210,225,0.28)" strokeWidth="5" strokeLinecap="round" />
        </g>
      </g>

      <style>{`
        @keyframes av-breathe {
          0%, 100% { transform: translateY(0) scale(1); }
          50% { transform: translateY(-4px) scale(1.006); }
        }
        @keyframes av-sway {
          0%, 100% { transform: rotate(-1.2deg); }
          50% { transform: rotate(1.2deg); }
        }
      `}</style>
    </svg>
  );
}
