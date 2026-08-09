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
