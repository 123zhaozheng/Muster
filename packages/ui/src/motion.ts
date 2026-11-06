import { useSyncExternalStore } from "react";

const QUERY = "(prefers-reduced-motion: reduce)";
const STORAGE_KEY = "muster.reduceMotion";
const hasWindow = typeof window !== "undefined";

function systemSubscribe(cb: () => void) {
  if (!hasWindow || typeof window.matchMedia !== "function") return () => {};
  const mq = window.matchMedia(QUERY);
  mq.addEventListener?.("change", cb);
  return () => mq.removeEventListener?.("change", cb);
}
function systemSnapshot() {
  return hasWindow && typeof window.matchMedia === "function" && window.matchMedia(QUERY).matches;
}

/** True when the user asked the OS for reduced motion. Safe in jsdom / SSR (returns false). */
function usePrefersReducedMotion(): boolean {
  return useSyncExternalStore(systemSubscribe, systemSnapshot, () => false);
}

function readStored(): boolean {
  try {
    return hasWindow && localStorage.getItem(STORAGE_KEY) === "1";
  } catch {
    return false;
  }
}

const appListeners = new Set<() => void>();
let appPref = readStored();

function applyAttribute() {
  if (hasWindow) document.documentElement.dataset.reduceMotion = String(appPref);
}
applyAttribute();

/** The in-app "减少动态效果" setting (settings -> general). Persisted in localStorage `muster.reduceMotion`. */
export function setReduceMotion(value: boolean): void {
  appPref = value;
  try {
    localStorage.setItem(STORAGE_KEY, value ? "1" : "0");
  } catch {
    /* private mode: in-memory only */
  }
  applyAttribute();
  appListeners.forEach((l) => l());
}

function appSubscribe(cb: () => void) {
  appListeners.add(cb);
  return () => void appListeners.delete(cb);
}

/** Just the in-app setting (what the settings switch shows). */
export function useReduceMotionSetting(): boolean {
  return useSyncExternalStore(appSubscribe, () => appPref, () => false);
}

/** Effective flag: in-app setting OR the system preference. Use this to gate any JS-driven animation. */
export function useReducedMotion(): boolean {
  const app = useReduceMotionSetting();
  const system = usePrefersReducedMotion();
  return app || system;
}
