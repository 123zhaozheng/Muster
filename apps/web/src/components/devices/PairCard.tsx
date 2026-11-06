import { useEffect, useState } from "react";
import { Copy, RefreshCw } from "lucide-react";
import { Button, Card, IconButton, cn, toast } from "@muster/ui";
import { hubRequest } from "../../lib/hub";

interface Pairing {
  code: string;
  expiresAt: number;
}

function fmtCountdown(ms: number): string {
  const s = Math.max(0, Math.ceil(ms / 1000));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
}

const STEPS = ["在新电脑上安装并打开 Muster", "在“设备”里选择“输入配对码”", "输入上面的 6 位数字，等待连接"];

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
      setPairing({ code: r.code, expiresAt: new Date(r.expiresAt).getTime() });
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
    <Card id="pair-card" className="p-5">
      <h3 className="text-section font-semibold text-fg">配对新设备</h3>
      <p className="mt-0.5 text-sm text-fg-2">在新电脑上输入下面的代码，即可与 Muster 连接。</p>

      <div className="mt-4 flex items-center gap-2" aria-live="polite">
        <div
          {...(pairing ? { "aria-label": "配对码" } : { "aria-hidden": true })}
          className={cn("flex min-w-0 flex-1 gap-1.5 font-mono text-[22px] font-semibold leading-none", expired ? "text-fg-3 line-through" : pairing ? "text-fg" : "text-fg-3")}
        >
          {digits.map((c, i) => (
            <span key={i} className="grid h-11 min-w-0 flex-1 place-items-center rounded-control bg-surface-muted">
              {c}
            </span>
          ))}
        </div>
        {pairing && !expired && (
          <IconButton
            label="复制配对码"
            variant="secondary"
            onClick={() => {
              void navigator.clipboard?.writeText(pairing.code);
              toast.success("配对码已复制");
            }}
          >
            <Copy className="size-4" />
          </IconButton>
        )}
      </div>
      <p className="mt-2 text-sm text-fg-2">{!pairing ? "点击下方按钮生成一个 6 位配对码" : expired ? "配对码已过期，请重新生成" : `有效期剩余 ${fmtCountdown(remaining)}`}</p>
      {error && <p role="alert" className="mt-2 text-sm text-danger">{error}</p>}

      <Button variant="primary" className="mt-4 w-full" loading={loading} icon={<RefreshCw className="size-4" />} onClick={() => void generate()}>
        {pairing ? "重新生成配对码" : "配对新电脑"}
      </Button>
      <p className="mt-2 text-center text-xs text-fg-3">当前版本仅显示配对码，跨机配对即将推出</p>

      <ol className="mt-5 space-y-2.5 border-t border-border pt-4">
        {STEPS.map((s, i) => (
          <li key={s} className="flex items-start gap-3 text-sm text-fg-2">
            <span className="grid size-6 shrink-0 place-items-center rounded-full bg-surface-muted text-xs font-semibold text-fg-2">{i + 1}</span>
            <span className="pt-0.5">{s}</span>
          </li>
        ))}
      </ol>
    </Card>
  );
}
