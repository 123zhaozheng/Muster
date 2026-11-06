// 工作台 / 分支页共用的线条图标（无图标库依赖）。
import type { ReactNode, SVGProps } from "react";

function Svg({ children, size = 16, ...rest }: SVGProps<SVGSVGElement> & { size?: number; children: ReactNode }) {
  return (
    <svg viewBox="0 0 24 24" width={size} height={size} fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" {...rest}>
      {children}
    </svg>
  );
}

type P = { size?: number; className?: string };

export const IconBranch = (p: P) => (
  <Svg {...p}><circle cx="6" cy="5" r="2" /><circle cx="6" cy="19" r="2" /><circle cx="18" cy="8" r="2" /><path d="M6 7v10M18 10c0 4-6 3-12 7" /></Svg>
);
export const IconFile = (p: P) => (
  <Svg {...p}><path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8z" /><path d="M14 3v5h5M9 13h6M9 17h4" /></Svg>
);
export const IconFolder = (p: P) => (
  <Svg {...p}><path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z" /></Svg>
);
export const IconCheck = (p: P) => (
  <Svg {...p}><path d="M5 12.5l4.5 4.5L19 7.5" /></Svg>
);
export const IconCross = (p: P) => (
  <Svg {...p}><path d="M6 6l12 12M18 6L6 18" /></Svg>
);
export const IconAlert = (p: P) => (
  <Svg {...p}><circle cx="12" cy="12" r="9" /><path d="M12 7v6M12 16.5v.5" /></Svg>
);
export const IconPause = (p: P) => (
  <Svg {...p}><path d="M9 6v12M15 6v12" strokeWidth={2.6} /></Svg>
);
export const IconDots = (p: P) => (
  <Svg {...p}><circle cx="5" cy="12" r="1.4" fill="currentColor" /><circle cx="12" cy="12" r="1.4" fill="currentColor" /><circle cx="19" cy="12" r="1.4" fill="currentColor" /></Svg>
);
export const IconChevron = (p: P) => (
  <Svg {...p}><path d="M6 9l6 6 6-6" /></Svg>
);
export const IconSend = (p: P) => (
  <Svg {...p}><path d="M4 12l16-8-6 16-3-7z" fill="currentColor" /></Svg>
);
export const IconClock = (p: P) => (
  <Svg {...p}><circle cx="12" cy="12" r="9" /><path d="M12 7v5l3 2" /></Svg>
);
export const IconSpark = (p: P) => (
  <Svg {...p}><path d="M12 3l1.8 5.2L19 10l-5.2 1.8L12 17l-1.8-5.2L5 10l5.2-1.8zM19 16l.8 2.2L22 19l-2.2.8L19 22l-.8-2.2L16 19l2.2-.8z" /></Svg>
);
export const IconSearch = (p: P) => (
  <Svg {...p}><circle cx="11" cy="11" r="6.5" /><path d="M16 16l4.5 4.5" /></Svg>
);
export const IconCode = (p: P) => (
  <Svg {...p}><path d="M8 7l-5 5 5 5M16 7l5 5-5 5M14 5l-4 14" /></Svg>
);
export const IconPlay = (p: P) => (
  <Svg {...p}><path d="M7 5l12 7-12 7z" fill="currentColor" /></Svg>
);
export const IconUser = (p: P) => (
  <Svg {...p}><circle cx="12" cy="8" r="4" fill="currentColor" /><path d="M4 21c0-4.4 3.6-7 8-7s8 2.6 8 7z" fill="currentColor" /></Svg>
);
export const IconTerminal = (p: P) => (
  <Svg {...p}><path d="M4 6l6 6-6 6M12 19h8" /></Svg>
);
export const IconCoin = (p: P) => (
  <Svg {...p}><ellipse cx="12" cy="6" rx="7" ry="3" /><path d="M5 6v6c0 1.7 3.1 3 7 3s7-1.3 7-3V6M5 12v6c0 1.7 3.1 3 7 3s7-1.3 7-3v-6" /></Svg>
);
export const IconChat = (p: P) => (
  <Svg {...p}><path d="M4 5h16v11H9l-5 4z" /></Svg>
);
