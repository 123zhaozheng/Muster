import { useMemo, useState } from "react";
import { Brain, Eye, Search } from "lucide-react";
import type { ModelInfo, ModelProviderConfig } from "@muster/protocol";
import { Button, Card, Badge, EmptyState, Input, Section } from "@muster/ui";
import { formatContext, formatPrice } from "./modelMeta";

const PAGE = 40;

/** 可用模型预览表（model.list）：名称、上下文、价格、能力。 */
export function ModelTable({ models, providers }: { models: ModelInfo[]; providers: ModelProviderConfig[] }) {
  const [q, setQ] = useState("");
  const [shown, setShown] = useState(PAGE);
  const nameOf = (id: string) => providers.find((p) => p.id === id)?.name ?? id;

  const rows = useMemo(() => {
    const t = q.trim().toLowerCase();
    if (!t) return models;
    return models.filter((m) => `${m.name} ${m.id} ${nameOf(m.provider)}`.toLowerCase().includes(t));
    // eslint-disable-next-line react-hooks/exhaustive-deps -- nameOf 只依赖 providers
  }, [models, providers, q]);

  return (
    <Section
      title="可用模型"
      description={`来自已启用的模型服务，共 ${models.length} 个。价格为每百万 tokens 的美元价（输入 / 输出）。`}
      actions={
        models.length > 0 ? (
          <div className="relative w-56">
            <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-fg-3" />
            <Input aria-label="搜索模型" className="h-9 pl-9" placeholder="搜索模型或服务" value={q} onChange={(e) => { setQ(e.target.value); setShown(PAGE); }} />
          </div>
        ) : undefined
      }
    >
      {models.length === 0 ? (
        <Card>
          <EmptyState compact pebble={{ shape: "egg", color: "sky", status: "sleeping" }} title="暂时没有可用的模型" description="添加并启用一个模型服务后，这里会列出它提供的模型。" />
        </Card>
      ) : (
        <Card className="overflow-hidden p-0">
          <div className="overflow-x-auto">
            <table className="w-full min-w-[640px] text-left text-sm">
              <thead className="bg-surface-muted text-xs text-fg-2">
                <tr>
                  <th className="px-5 py-3 font-medium">模型</th>
                  <th className="px-3 py-3 font-medium">服务</th>
                  <th className="px-3 py-3 text-right font-medium">上下文</th>
                  <th className="px-3 py-3 text-right font-medium">价格 / 百万</th>
                  <th className="px-5 py-3 font-medium">能力</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {rows.slice(0, shown).map((m) => (
                  <tr key={`${m.provider}::${m.id}`} className="hover:bg-surface-muted/60">
                    <td className="px-5 py-3">
                      <div className="font-medium text-fg">{m.name || m.id}</div>
                      {m.name && m.name !== m.id && <div className="font-mono text-xs text-fg-3">{m.id}</div>}
                    </td>
                    <td className="px-3 py-3 text-fg-2">{nameOf(m.provider)}</td>
                    <td className="px-3 py-3 text-right tabular-nums">{formatContext(m.contextWindow)}</td>
                    <td className="px-3 py-3 text-right font-mono text-xs tabular-nums text-fg-2">{formatPrice(m)}</td>
                    <td className="px-5 py-3">
                      <div className="flex flex-wrap gap-1.5">
                        {m.reasoning && <Badge tone="neutral" icon={<Brain className="size-3" />}>推理</Badge>}
                        {m.vision && <Badge tone="accent" icon={<Eye className="size-3" />}>视觉</Badge>}
                        {!m.reasoning && !m.vision && <span className="text-fg-3">—</span>}
                      </div>
                    </td>
                  </tr>
                ))}
                {rows.length === 0 && (
                  <tr>
                    <td colSpan={5} className="px-5 py-10 text-center text-sm text-fg-3">没有匹配“{q}”的模型</td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
          {rows.length > shown && (
            <div className="border-t border-border p-3 text-center">
              <Button size="sm" variant="ghost" onClick={() => setShown((n) => n + PAGE)}>显示更多（还有 {rows.length - shown} 个）</Button>
            </div>
          )}
        </Card>
      )}
    </Section>
  );
}
