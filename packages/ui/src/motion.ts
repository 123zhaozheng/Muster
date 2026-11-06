import { useSyncExternalStore } from "react";

/** The one easing curve used across the product (docs/10: [0.22, 1, 0.36, 1]). */
export const EASE = [0.22, 1, 0.36, 1] as const;
/** Duration tokens in seconds (micro 120~200ms, transition 240~320ms). */
export const DURATION = { micro: 0.16, base: 0.28, slow: 0.45 } as const;

const QUERY = "(prefers-reduced-motion: reduce)";

function subscribe(cb: () => void) {
  if (typeof window === "undefined" || typeof window.matchMedia !== "function") return () => {};
  const mq = window.matchMedia(QUERY);
  mq.addEventListener?.("change", cb);
  return () => mq.removeEventListener?.("change", cb);
}
function snapshot() {
  return typeof window !== "undefined" && typeof window.matchMedia === "function" && window.matchMedia(QUERY).matches;
}

/** True when the user asked the OS for reduced motion. Safe in jsdom / SSR (returns false). */
export function usePrefersReducedMotion(): boolean {
  return useSyncExternalStore(subscribe, snapshot, () => false);
}
