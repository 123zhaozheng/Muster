import { useEffect, useState } from "react";
import { motion } from "motion/react";
import { Copy, RefreshCw } from "lucide-react";
import { Button, Card, EASE, IconButton, Pebble, cn, toast } from "@muster/ui";
import { hubRequest } from "../../lib/hub";

interface Pairing {
  code: string;
  expiresAt: number;
  /** Lifetime of the code in ms, taken when it was issued (drives the ring). */
  ttl: number;
}

function fmtCountdown(ms: number): string {
  const s = Math.max(0, Math.ceil(ms / 1000));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
}

const STEPS = ["在新电脑上安装并打开 Muster", "在“设备”里选择“输入配对码”", "输入上面的 6 位数字，等待连接"];
const R = 26;
const CIRC = 2 * Math.PI * R;

function Ring({ fraction, label, urgent }: { fraction: number; label: string; urgent: boolean }) {
  return (
    <div className="relative grid size-16 shrink-0 place-items-center" aria-hidden>
      <svg viewBox="0 0 64 64" className="-rotate-90 size-16">
        <circle cx="32" cy="32" r={R} fill="none" stroke="var(--color-line)" strokeWidth="5" />
        <circle
          cx="32"
          cy="32"
          r={R}
          fill="none"
          strokeWidth="5"
          strokeLinecap="round"
          stroke={urgent ? "var(--color-amber)" : "var(--color-coral)"}
          strokeDasharray={CIRC}
          strokeDashoffset={CIRC * (1 - Math.min(1, Math.max(0, fraction)))}
          style={{ transition: "stroke-dashoffset 1s linear, stroke 300ms" }}
        />
      </svg>
      <span className="absolute text-xs font-semibold tabular-nums text-ink">{label}</span>
    </div>
  );
}

export function PairCard() {
  const [pairing, setPairing] = useState<Pairing | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [now, setNow] = useState(() => Date.now());

  // Tick once per second only while a code is on screen.
  useEffect(() => {
    if (!pairing) return;
    setNow(Date.now());
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, [pairing]);

  async function generate() {
    setLoading(true);
    setError(null);
    try {
      const r = await hubRequest("device.pairCode", {});
      const expiresAt = new Date(r.expiresAt).getTime();
      setPairing({ code: r.code, expiresAt, ttl: Math.max(1000, expiresAt - Date.now()) });
    } catch (e) {
      const text = e instanceof Error ? e.message : String(e);
      setError(text);
      toast.error("生成配对码失败", { description: text });
    } finally {
      setLoading(false);
    }
  }

  const remaining = pairing ? pairing.expiresAt - now : 0;
  const expired = pairing !== null && remaining <= 0;
  const digits = pairing ? pairing.code.split("") : Array.from({ length: 6 }, () => "·");

  return (
    <Card frosted id="pair-card" className="relative overflow-hidden p-6">
      <span aria-hidden className="muster-halo pointer-events-none absolute -left-10 -top-10 size-40 rounded-full" style={{ ["--halo" as string]: "#5aa9f5" }} />
      <div className="relative flex items-center gap-4">
        <Pebble shape="egg" color="sky" status={pairing && !expired ? "thinking" : "idle"} size={56} halo title="小探" />
        <div className="min-w-0">
          <h3 className="text-lg font-semibold text-ink">配对新设备</h3>
          <p className="text-sm text-ink-soft">在新电脑上输入下面的代码，即可与 Muster 连接</p>
        </div>
      </div>

      <div className="relative mt-5 flex items-center gap-4 rounded-card bg-canvas-deep/60 p-4" aria-live="polite">
        <div className="min-w-0 flex-1">
          <div
            {...(pairing ? { "aria-label": "配对码" } : { "aria-hidden": true })}
            className={cn("flex gap-1.5 font-mono text-[28px] font-bold leading-none", expired ? "text-ink-faint line-through" : pairing ? "text-ink" : "text-ink-faint/60")}
          >
            {digits.map((c, i) => (
              <motion.span
                key={`${pairing?.code ?? "x"}-${i}`}
                initial={pairing ? { opacity: 0, y: 10, scale: 0.85 } : false}
                animate={{ opacity: 1, y: 0, scale: 1 }}
                transition={{ delay: i * 0.05, duration: 0.35, ease: EASE as unknown as [number, number, number, number] }}
                className={cn("grid h-12 w-9 place-items-center rounded-xl bg-surface shadow-soft", i === 2 && "mr-3")}
              >
                {c}
              </motion.span>
            ))}
          </div>
          <div className="mt-3 text-sm text-ink-soft">
            {!pairing ? "点击下方按钮生成一个 6 位配对码" : expired ? "配对码已过期，请重新生成" : `有效期剩余 ${fmtCountdown(remaining)}`}
          </div>
        </div>
        {pairing && !expired && <Ring fraction={remaining / pairing.ttl} label={fmtCountdown(remaining)} urgent={remaining < 60_000} />}
        {pairing && !expired && (
          <IconButton
            label="复制配对码"
            variant="soft"
            onClick={() => {
              void navigator.clipboard?.writeText(pairing.code);
              toast.success("配对码已复制");
            }}
          >
            <Copy className="size-4" />
          </IconButton>
        )}
      </div>
      {error && <p role="alert" className="relative mt-3 text-sm text-danger">{error}</p>}

      <Button variant="primary" size="lg" className="relative mt-4 w-full" loading={loading} icon={<RefreshCw className="size-4" />} onClick={() => void generate()}>
        {pairing ? "重新生成配对码" : "配对新电脑"}
      </Button>
      <p className="relative mt-2 text-center text-xs text-ink-faint">当前版本仅显示配对码，跨机配对即将推出</p>

      <ol className="relative mt-5 space-y-3 border-t border-line/80 pt-5">
        {STEPS.map((s, i) => (
          <li key={s} className="flex items-start gap-3 text-sm text-ink-soft">
            <span className="muster-gradient-brand grid size-6 shrink-0 place-items-center rounded-full text-xs font-semibold text-white shadow-soft">{i + 1}</span>
            <span className="pt-0.5">{s}</span>
          </li>
        ))}
      </ol>
    </Card>
  );
}
