// Minimal inline icon set (stroke style, consistent 24px grid).

const S = {
  fill: "none",
  stroke: "currentColor",
  strokeWidth: 1.8,
  strokeLinecap: "round" as const,
  strokeLinejoin: "round" as const,
};

export const PhoneIcon = ({ size = 20 }: { size?: number }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" {...S}>
    <path d="M5 4h4l2 5-2.5 1.5a11 11 0 0 0 5 5L15 13l5 2v4a2 2 0 0 1-2 2A16 16 0 0 1 3 6a2 2 0 0 1 2-2" />
  </svg>
);

export const VideoIcon = ({ size = 20 }: { size?: number }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" {...S}>
    <rect x="2.5" y="6" width="13" height="12" rx="3" />
    <path d="M15.5 10.5 21 7v10l-5.5-3.5" />
  </svg>
);

export const SendIcon = ({ size = 20 }: { size?: number }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" {...S}>
    <path d="M4 12 20 4l-4 16-4.5-6.5L4 12Z" />
    <path d="M11.5 13.5 20 4" />
  </svg>
);

export const EndCallIcon = ({ size = 24 }: { size?: number }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" {...S} strokeWidth={2}>
    <path d="M3 15c5-5.5 13-5.5 18 0l-2.5 3-4-1.5v-2.8a9.5 9.5 0 0 0-5 0v2.8L5.5 18 3 15Z" fill="currentColor" stroke="none" />
  </svg>
);

export const MicIcon = ({ size = 22, off = false }: { size?: number; off?: boolean }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" {...S}>
    <rect x="9" y="3" width="6" height="11" rx="3" />
    <path d="M5.5 11a6.5 6.5 0 0 0 13 0M12 17.5V21" />
    {off && <path d="M4 4l16 16" />}
  </svg>
);

export const SettingsIcon = ({ size = 20 }: { size?: number }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" {...S}>
    <circle cx="12" cy="12" r="3" />
    <path d="M12 2.8v2.4M12 18.8v2.4M2.8 12h2.4M18.8 12h2.4M5.5 5.5l1.7 1.7M16.8 16.8l1.7 1.7M18.5 5.5l-1.7 1.7M7.2 16.8l-1.7 1.7" />
  </svg>
);

// WhatsApp-style delivery ticks: ✓ sent, ✓✓ delivered, cyan ✓✓ read.
// The second stroke carries a class so the read state can DRAW it once
// (see .tickicon.read .tick2) instead of simply recolouring in place —
// this is the smallest and most-watched piece of state in the product.
export const TickIcon = ({ status }: { status: "sent" | "delivered" | "read" }) => (
  <svg
    width={15}
    height={11}
    viewBox="0 0 18 12"
    fill="none"
    stroke="currentColor"
    strokeWidth={1.9}
    strokeLinecap="round"
    strokeLinejoin="round"
    className={`tickicon ${status === "read" ? "read" : ""}`}
    style={{ verticalAlign: "-1px" }}
    aria-hidden="true"
  >
    <path d="M1.5 6.5 5 10 11 2.5" />
    {status !== "sent" && <path className="tick2" d="M7.5 8.8 8.5 10 14.5 2.5" />}
  </svg>
);

export const BroomIcon = ({ size = 20 }: { size?: number }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" {...S}>
    <path d="M14 3l7 7" />
    <path d="M11.5 5.5 18.5 12.5 13 18a7 7 0 0 1-9.9.1L11.5 5.5Z" />
    <path d="M7 13l4 4" />
  </svg>
);

export const KeyboardIcon = ({ size = 22 }: { size?: number }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" {...S}>
    <rect x="2.5" y="6.5" width="19" height="11" rx="2.5" />
    <path d="M6 10h.01M10 10h.01M14 10h.01M18 10h.01M6 14h.01M18 14h.01M9 14h6" />
  </svg>
);

export const CameraIcon = ({ size = 20 }: { size?: number }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" {...S}>
    <path d="M4 7.5h2.2l1.4-2h8.8l1.4 2H20a1.5 1.5 0 0 1 1.5 1.5v9A1.5 1.5 0 0 1 20 19.5H4A1.5 1.5 0 0 1 2.5 18V9A1.5 1.5 0 0 1 4 7.5Z" />
    <circle cx="12" cy="13" r="3.6" />
  </svg>
);

export const MoreIcon = ({ size = 20 }: { size?: number }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
    <circle cx="5" cy="12" r="1.9" />
    <circle cx="12" cy="12" r="1.9" />
    <circle cx="19" cy="12" r="1.9" />
  </svg>
);

export const ChevronIcon = ({ size = 17 }: { size?: number }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" {...S} aria-hidden="true">
    <path d="m9 5 7 7-7 7" />
  </svg>
);

export const ArrowDownIcon = ({ size = 16 }: { size?: number }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" {...S} strokeWidth={2.1} aria-hidden="true">
    <path d="M12 4.5v15M5.5 13l6.5 6.5 6.5-6.5" />
  </svg>
);

export const CloseIcon = ({ size = 16 }: { size?: number }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" {...S} strokeWidth={2.1} aria-hidden="true">
    <path d="M6 6l12 12M18 6 6 18" />
  </svg>
);

export const PersonIcon = ({ size = 19 }: { size?: number }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" {...S} aria-hidden="true">
    <circle cx="12" cy="8" r="3.7" />
    <path d="M4.8 20a7.2 7.2 0 0 1 14.4 0" />
  </svg>
);

export const CloudIcon = ({ size = 19 }: { size?: number }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" {...S} aria-hidden="true">
    <path d="M7 18.5a4 4 0 0 1-.3-8A5.5 5.5 0 0 1 17.4 10a3.8 3.8 0 0 1-.4 8.5H7Z" />
  </svg>
);

export const TrashIcon = ({ size = 19 }: { size?: number }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" {...S} aria-hidden="true">
    <path d="M4.5 6.5h15M9.5 6.5V4.8a1.3 1.3 0 0 1 1.3-1.3h2.4a1.3 1.3 0 0 1 1.3 1.3v1.7" />
    <path d="M6.5 6.5 7.4 19a1.6 1.6 0 0 0 1.6 1.5h6a1.6 1.6 0 0 0 1.6-1.5l.9-12.5" />
    <path d="M10.5 10v7M13.5 10v7" />
  </svg>
);

export const HeartIcon = ({ size = 19 }: { size?: number }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" {...S} aria-hidden="true">
    <path d="M12 20s-7.5-4.6-7.5-9.5A4.2 4.2 0 0 1 12 7.6a4.2 4.2 0 0 1 7.5 2.9C19.5 15.4 12 20 12 20Z" />
  </svg>
);

export const OfflineIcon = ({ size = 14 }: { size?: number }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" {...S} aria-hidden="true">
    <path d="M2.5 8.6a15 15 0 0 1 6-3.4M15.4 5.2a15 15 0 0 1 6.1 3.4M6 12.4a10 10 0 0 1 3.4-2M14.6 10.4a10 10 0 0 1 3.4 2M9.6 16.1a5 5 0 0 1 4.8 0M12 20h.01M3 3l18 18" />
  </svg>
);
