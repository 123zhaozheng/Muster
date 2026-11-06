import type { ReactNode } from "react";
import { useSearchParams } from "react-router";
import { Cpu, Info, ShieldCheck, SlidersHorizontal, Users, type LucideIcon } from "lucide-react";
import { PageHeader, cn } from "@muster/ui";
import { Page } from "../../components/layout";
import { AboutSection } from "../../components/settings/AboutSection";
import { CrewSection } from "../../components/settings/CrewSection";
import { GeneralSection } from "../../components/settings/GeneralSection";
import { ModelsTab } from "../../components/settings/ModelsTab";
import { SafetySection } from "../../components/settings/SafetySection";

const CATEGORIES: ReadonlyArray<{ id: string; label: string; icon: LucideIcon; render: () => ReactNode }> = [
  { id: "general", label: "通用", icon: SlidersHorizontal, render: () => <GeneralSection /> },
  { id: "crew", label: "Pip 与成员", icon: Users, render: () => <CrewSection /> },
  { id: "models", label: "模型与连接", icon: Cpu, render: () => <ModelsTab /> },
  { id: "safety", label: "权限与安全", icon: ShieldCheck, render: () => <SafetySection /> },
  { id: "about", label: "关于", icon: Info, render: () => <AboutSection /> },
];

export default function SettingsPage() {
  const [params, setParams] = useSearchParams();
  const current = CATEGORIES.find((c) => c.id === params.get("tab")) ?? CATEGORIES[0]!;

  return (
    <Page>
      <PageHeader title="设置" subtitle="外观、成员、模型与安全。" />
      <div className="mt-6 grid items-start gap-6 md:grid-cols-[200px_minmax(0,1fr)] md:gap-10">
        <nav aria-label="设置分类" className="flex gap-1 overflow-x-auto md:sticky md:top-4 md:flex-col md:overflow-visible">
          {CATEGORIES.map((c) => {
            const active = c.id === current.id;
            return (
              <button
                key={c.id}
                type="button"
                aria-current={active ? "page" : undefined}
                onClick={() => setParams(c.id === CATEGORIES[0]!.id ? {} : { tab: c.id }, { replace: true })}
                className={cn(
                  "flex h-10 shrink-0 cursor-pointer items-center gap-2.5 whitespace-nowrap rounded-control px-3 text-sm transition-colors duration-150 outline-none focus-visible:ring-2 focus-visible:ring-accent",
                  active ? "bg-accent-surface font-medium text-accent" : "text-fg-2 hover:bg-surface-muted hover:text-fg",
                )}
              >
                <c.icon className="size-[18px]" aria-hidden />
                {c.label}
              </button>
            );
          })}
        </nav>
        <div key={current.id} className="min-w-0 max-w-[760px]">
          {current.render()}
        </div>
      </div>
    </Page>
  );
}
