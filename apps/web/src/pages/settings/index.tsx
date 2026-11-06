import { useMemo } from "react";
import { useSearchParams } from "react-router";
import { Cpu, Info, LayoutGrid, Palette, ShieldCheck, SlidersHorizontal } from "lucide-react";
import type { ReactNode } from "react";
import { Pebble, cn } from "@muster/ui";
import { Page, PageHeader } from "../../components/layout";
import { ModelsTab } from "../../components/settings/ModelsTab";
import { AboutSection, AppearanceSection, GallerySection, GeneralSection, SafetySection } from "../../components/settings/SettingsSections";

const TABS = [
  { id: "models", label: "模型", icon: Cpu, render: () => <ModelsTab /> },
  { id: "safety", label: "审批与安全", icon: ShieldCheck, render: () => <SafetySection /> },
  { id: "general", label: "通用", icon: SlidersHorizontal, render: () => <GeneralSection /> },
  { id: "appearance", label: "外观", icon: Palette, render: () => <AppearanceSection /> },
  { id: "about", label: "关于", icon: Info, render: () => <AboutSection /> },
  { id: "gallery", label: "组件展示", icon: LayoutGrid, render: () => <GallerySection /> },
] as const satisfies ReadonlyArray<{ id: string; label: string; icon: unknown; render: () => ReactNode }>;

type TabId = (typeof TABS)[number]["id"];
const DEFAULT_TAB: TabId = "models";

export default function SettingsPage() {
  const [params, setParams] = useSearchParams();
  const raw = params.get("tab");
  const tab = useMemo(() => TABS.find((t) => t.id === raw) ?? TABS.find((t) => t.id === DEFAULT_TAB)!, [raw]);

  return (
    <Page>
      <PageHeader
        title="设置"
        subtitle="模型、审批与外观，都在这里。"
        leading={<Pebble shape="blob" color="lilac" status="idle" size={56} halo />}
      />
      <div className="grid items-start gap-6 lg:grid-cols-[220px_minmax(0,1fr)]">
        <nav aria-label="设置分区" role="tablist" aria-orientation="vertical" className="muster-glass-1 flex gap-1 overflow-x-auto rounded-card p-2 lg:sticky lg:top-4 lg:flex-col lg:overflow-visible">
          {TABS.map((t) => {
            const active = t.id === tab.id;
            const Icon = t.icon;
            return (
              <button
                key={t.id}
                type="button"
                role="tab"
                id={`settings-tab-${t.id}`}
                aria-selected={active}
                aria-controls="settings-panel"
                onClick={() => setParams(t.id === DEFAULT_TAB ? {} : { tab: t.id }, { replace: true })}
                className={cn(
                  "relative flex shrink-0 cursor-pointer items-center gap-2.5 whitespace-nowrap rounded-2xl px-3.5 py-2.5 text-sm font-medium transition-colors duration-200 outline-none focus-visible:ring-4 focus-visible:ring-coral/15",
                  active ? "bg-coral-soft text-coral-deep" : "text-ink-soft hover:bg-canvas-deep hover:text-ink",
                )}
              >
                {active && <span aria-hidden className="absolute left-0 top-1/2 hidden h-5 w-1 -translate-y-1/2 rounded-full bg-coral lg:block" />}
                <Icon className="size-[18px]" />
                {t.label}
              </button>
            );
          })}
        </nav>
        <div key={tab.id} id="settings-panel" role="tabpanel" aria-labelledby={`settings-tab-${tab.id}`} className="muster-page-enter min-w-0">
          {tab.render()}
        </div>
      </div>
    </Page>
  );
}
