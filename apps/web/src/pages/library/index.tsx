import { FolderOpen } from "lucide-react";
import { Badge, Card, EmptyState, PageHeader } from "@muster/ui";
import { Page } from "../../components/layout";

export default function Library() {
  return (
    <Page>
      <PageHeader title="资源库" subtitle="任务产出的文档、图片会集中放在这里" meta={<Badge>即将推出</Badge>} />
      <Card>
        <EmptyState icon={<FolderOpen />} title="任务产出的文档、图片会出现在这里" description="这个功能还在开发中，目前没有可展示的文件。" />
      </Card>
    </Page>
  );
}
