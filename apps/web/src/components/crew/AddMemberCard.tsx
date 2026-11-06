import { Pebble } from "@muster/ui";
import { Plus } from "lucide-react";

/** 网格末尾的虚线“新建”卡片：点击打开新建成员向导。 */
export function AddMemberCard({ onClick }: { onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      data-testid="add-member"
      className="group flex min-h-[320px] cursor-pointer flex-col items-center justify-center gap-4 rounded-card border-2 border-dashed border-line bg-surface/50 p-6 text-center transition-[transform,border-color,background-color] duration-200 ease-muster hover:-translate-y-0.5 hover:border-coral/60 hover:bg-coral-soft/40 focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-coral/20"
    >
      <span className="relative grid size-24 place-items-center">
        <Pebble shape="blob" color="cream" status="sleeping" size={88} lite interactive={false} />
        <span className="absolute -bottom-1 -right-1 grid size-9 place-items-center rounded-full bg-coral text-white shadow-glow-coral transition-transform duration-200 group-hover:rotate-90 group-hover:scale-110">
          <Plus size={20} />
        </span>
      </span>
      <span>
        <span className="block text-lg font-semibold text-ink">再来一位新成员</span>
        <span className="mt-1 block max-w-[16rem] text-sm leading-relaxed text-ink-soft">创建会用你的模型的原生成员，或接入本机的 Codex / Claude Code</span>
      </span>
    </button>
  );
}
