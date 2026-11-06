import { MAIN_BOT_ID } from "@muster/protocol";
import { Badge, Card, EmptyState, PageHeader } from "@muster/ui";
import { Page } from "../../components/layout";
import { useHub } from "../../lib/hub";

export default function MemoryPage() {
  const pip = useHub((s) => s.model.bots[MAIN_BOT_ID]);
  return (
    <Page>
      <PageHeader title="记忆" subtitle="这里将显示 Pip 记住的内容" meta={<Badge>尚未开放</Badge>} />
      <Card>
        <EmptyState
          pebble={{ shape: pip?.shape, color: pip?.color, status: "sleeping" }}
          title="记忆功能尚未开放"
          description="目前没有任何跨对话的记忆被保存。具体怎么记、由谁确认，等功能开放时再说明。"
        />
      </Card>
    </Page>
  );
}
