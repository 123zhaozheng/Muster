import { useState } from "react";
import { KeyRound, Pencil, Plus, Trash2 } from "lucide-react";
import type { ModelInfo, ModelProviderConfig, ProviderCatalogEntry } from "@muster/protocol";
import { Button, Card, Badge, ConfirmDialog, EmptyState, IconButton, Section, Switch, toast } from "@muster/ui";
import { hubRequest } from "../../lib/hub";
import { configToUpsert, KIND_LABEL } from "./modelMeta";
import { ProviderBadge, ProviderSheet } from "./ProviderSheet";

function ProviderRow({ p, entry, modelCount, onEdit, onToggle, onDelete }: {
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
    <li className="flex items-center gap-3 px-5 py-3.5" data-testid={`provider-${p.id}`} data-enabled={p.enabled}>
      <ProviderBadge name={p.name} />
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-2">
          <h3 className="truncate text-sm font-semibold text-fg">{p.name}</h3>
          <Badge tone="neutral">{KIND_LABEL[p.kind]}</Badge>
          {!p.enabled && <Badge tone="neutral">已停用</Badge>}
        </div>
        <div className="mt-0.5 truncate font-mono text-xs text-fg-3" title={p.baseUrl ?? entry?.baseUrl}>{p.baseUrl ?? entry?.baseUrl ?? "内置默认地址"}</div>
        <div className="mt-1.5 flex flex-wrap items-center gap-2">
          {p.hasApiKey ? (
            <Badge tone="success" icon={<KeyRound className="size-3" />}>API Key 已设置</Badge>
          ) : envKey ? (
            <Badge tone="accent" icon={<KeyRound className="size-3" />}>使用环境变量</Badge>
          ) : (
            <Badge tone="warning" icon={<KeyRound className="size-3" />}>API Key 未设置</Badge>
          )}
          <Badge>{modelCount} 个模型</Badge>
        </div>
      </div>
      <IconButton label={`编辑 ${p.name}`} size="sm" onClick={onEdit}><Pencil className="size-4" /></IconButton>
      <ConfirmDialog
        tone="danger"
        title={`删除 ${p.name}？`}
        description="会同时删除已保存的 API Key。正在使用它的默认模型需要重新选择。"
        confirmText="删除"
        onConfirm={onDelete}
        trigger={<IconButton label={`删除 ${p.name}`} size="sm" className="hover:text-danger"><Trash2 className="size-4" /></IconButton>}
      />
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
    </li>
  );
}

/** “模型服务”列表 + 添加 / 编辑抽屉。 */
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
        <Card>
          <EmptyState
            compact
            pebble={{ shape: "round", color: "lilac", status: "idle" }}
            title="还没有模型服务"
            description="添加一个服务并填入 API Key，Pip 和原生成员就能真正开口说话。"
            action={<Button variant="primary" icon={<Plus className="size-4" />} onClick={openAdd}>添加模型服务</Button>}
          />
        </Card>
      ) : (
        <Card className="p-0">
          <ul className="divide-y divide-border">
            {providers.map((p) => (
              <ProviderRow
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
          </ul>
        </Card>
      )}
      <ProviderSheet open={sheetOpen} onOpenChange={setSheetOpen} catalog={catalog} providers={providers} editing={editing} onSaved={onChanged} />
    </Section>
  );
}
