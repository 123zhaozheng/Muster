// 校正后的“现在”。daemon 可能跑在别的机器上，时钟与浏览器有偏差；用 snapshot 的 serverTime 与收到它时的本地时间
// 算出偏移量，所有“已用多久 / 几分钟前”都基于校正后的时间。
import { useEffect, useState } from "react";
import { useHub } from "../../lib/hub";

/** 小于该阈值的偏差视为网络/加载延迟而不是时钟偏差，不校正。 */
const IGNORE_SKEW_MS = 30_000;

let offset = 0;
let seen = "";

function sync(serverTime: string): void {
  const t = Date.parse(serverTime);
  if (!Number.isFinite(t) || t <= 86_400_000) {
    seen = ""; // 还没有真实的 snapshot（emptyModel 是 epoch 0）
    offset = 0;
    return;
  }
  if (serverTime === seen) return;
  seen = serverTime;
  const skew = t - Date.now();
  offset = Math.abs(skew) < IGNORE_SKEW_MS ? 0 : skew;
}

sync(useHub.getState().model.serverTime);
useHub.subscribe((s) => sync(s.model.serverTime));

/** 以 daemon 的时钟为准的当前时间戳（ms）。 */
export function serverNow(): number {
  return Date.now() + offset;
}

/** 每 `intervalMs` 刷新一次的校正时间；`intervalMs` 为 0 时不计时（冻结在挂载时刻）。 */
export function useServerNow(intervalMs = 30_000): number {
  const [now, setNow] = useState(serverNow);
  useEffect(() => {
    setNow(serverNow());
    if (intervalMs <= 0) return;
    const id = setInterval(() => setNow(serverNow()), intervalMs);
    return () => clearInterval(id);
  }, [intervalMs]);
  return now;
}
