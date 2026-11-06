import { useState } from "react";
import { KeyRound, Pencil, Plus, Trash2 } from "lucide-react";
import type { ModelInfo, ModelProviderConfig, ProviderCatalogEntry } from "@muster/protocol";
import { Button, Card, Chip, ConfirmDialog, Empty, IconButton, Section, Switch, toast } from "@muster/ui";
import { hubRequest } from "../../lib/hub";
import { configToUpsert, KIND_LABEL } from "./modelMeta";
import { ProviderBadge, ProviderSheet } from "./ProviderSheet";

function ProviderCard({ p, entry, modelCount, onEdit, onToggle, onDelete }: {
  p: ModelProviderConfig;
  entry?: ProviderCatalogEntry;
  modelCount: number;
  onEdit: () => void;
  onToggle: (enabled: boolean) => Promise<void>;
  onDelete: () => Promise<void>;
}) {
  const [busy, setBusy] = useState(false);
  const envKey = !p.hasApiKey && entry?.envConfigured;
  return (
    <Card hoverable className="flex flex-col gap-4 p-5" data-testid={`provider-${p.id}`} data-enabled={p.enabled}>
      <div className="flex items-start gap-3">
        <ProviderBadge name={p.name} seed={p.builtinId ?? p.id} />
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <h3 className="truncate text-[15px] font-semibold text-ink">{p.name}</h3>
            <Chip tone={p.kind === "builtin" ? "lavender" : "sky"}>{KIND_LABEL[p.kind]}</Chip>
          </div>
          <div className="mt-0.5 truncate font-mono text-xs text-ink-faint" title={p.baseUrl ?? entry?.baseUrl}>{p.baseUrl ?? entry?.baseUrl ?? "内置默认地址"}</div>
        </div>
        <Switch
          aria-label={`启用 ${p.name}`}
          checked={p.enabled}
          disabled={busy}
          onCheckedChange={async (v) => {
            setBusy(true);
            try {
              await onToggle(v);
            } finally {
              setBusy(false);
            }
          }}
        />
      </div>
      <div className="flex flex-wrap items-center gap-2 text-xs">
        {p.hasApiKey ? (
          <Chip tone="mint" icon={<KeyRound className="size-3" />}>API Key 已设置</Chip>
        ) : envKey ? (
          <Chip tone="sky" icon={<KeyRound className="size-3" />}>使用环境变量</Chip>
        ) : (
          <Chip tone="amber" icon={<KeyRound className="size-3" />}>API Key 未设置</Chip>
        )}
        <Chip>{modelCount} 个模型</Chip>
        {!p.enabled && <Chip tone="neutral">已停用</Chip>}
        <span className="flex-1" />
        <IconButton label={`编辑 ${p.name}`} size="sm" onClick={onEdit}><Pencil className="size-4" /></IconButton>
        <ConfirmDialog
          tone="danger"
          title={`删除 ${p.name}？`}
          description="会同时删除已保存的 API Key。正在使用它的默认模型需要重新选择。"
          confirmText="删除"
          onConfirm={onDelete}
          trigger={<IconButton label={`删除 ${p.name}`} size="sm" className="hover:text-danger"><Trash2 className="size-4" /></IconButton>}
        />
      </div>
    </Card>
  );
}

/** “模型服务”列表 + 添加 / 编辑 Sheet。 */
export function ProviderList({ providers, catalog, models, onChanged }: {
  providers: ModelProviderConfig[];
  catalog: ProviderCatalogEntry[];
  models: ModelInfo[];
  onChanged: () => void | Promise<void>;
}) {
  const [sheetOpen, setSheetOpen] = useState(false);
  const [editing, setEditing] = useState<ModelProviderConfig | null>(null);

  const openAdd = () => {
    setEditing(null);
    setSheetOpen(true);
  };
  const countOf = (p: ModelProviderConfig) => {
    const n = models.filter((m) => m.provider === p.id).length;
    return n > 0 || !p.enabled ? n : (p.modelIds?.length ?? 0);
  };

  return (
    <Section
      title="模型服务"
      description="你配置过的模型服务商。Key 只保存在本机，不会显示出来。"
      actions={<Button variant="primary" icon={<Plus className="size-4" />} onClick={openAdd}>添加模型服务</Button>}
    >
      {providers.length === 0 ? (
        <Card className="p-2">
          <Empty
            compact
            pebble={{ shape: "round", color: "lilac", status: "idle" }}
            title="还没有模型服务"
            description="添加一个服务并填入 API Key，Pip 和原生成员就能真正开口说话。"
            action={<Button variant="primary" icon={<Plus className="size-4" />} onClick={openAdd}>添加模型服务</Button>}
          />
        </Card>
      ) : (
        <div className="muster-stagger grid gap-5" style={{ gridTemplateColumns: "repeat(auto-fill, minmax(min(100%, 340px), 1fr))" }}>
          {providers.map((p) => (
            <ProviderCard
              key={p.id}
              p={p}
              entry={catalog.find((c) => c.id === (p.builtinId ?? p.id))}
              modelCount={countOf(p)}
              onEdit={() => {
                setEditing(p);
                setSheetOpen(true);
              }}
              onToggle={async (enabled) => {
                try {
                  await hubRequest("model.providerUpsert", configToUpsert(p, { enabled }));
                  await onChanged();
                  toast.success(enabled ? `已启用 ${p.name}` : `已停用 ${p.name}`);
                } catch (e) {
                  toast.error({ title: "操作失败", description: e instanceof Error ? e.message : String(e) });
                }
              }}
              onDelete={async () => {
                try {
                  await hubRequest("model.providerDelete", { providerId: p.id });
                  await onChanged();
                  toast.success(`已删除 ${p.name}`);
                } catch (e) {
                  toast.error({ title: "删除失败", description: e instanceof Error ? e.message : String(e) });
                  throw e;
                }
              }}
            />
          ))}
        </div>
      )}
      <ProviderSheet open={sheetOpen} onOpenChange={setSheetOpen} catalog={catalog} providers={providers} editing={editing} onSaved={onChanged} />
    </Section>
  );
}
