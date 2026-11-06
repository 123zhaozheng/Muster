import type { ReactNode } from "react";
import { Pebble, type PebbleProps } from "@muster/ui";

/** Gradient tile with a living Pebble, used as the `leading` slot of PageHeader. */
export function HeaderTile({ shape = "round", color = "cream", status = "idle", children }: Pick<PebbleProps, "shape" | "color" | "status"> & { children?: ReactNode }) {
  return (
    <div className="muster-gradient-brand-soft relative grid size-[68px] shrink-0 place-items-center rounded-[22px] border border-white/70 shadow-soft">
      <Pebble shape={shape} color={color} status={status} size={48} halo />
      {children}
    </div>
  );
}
