import { Card, EmptyState, PageHeader, Tabs, TabsContent, TabsList, TabsTrigger } from "@muster/ui";
import { CostTotal, MemberCostTable, TaskCostTable, useCostTotal } from "../../components/costs/CostTables";
import { Page } from "../../components/layout";

export default function CostsPage() {
  const total = useCostTotal();
  return (
    <Page>
      <PageHeader title="成本" subtitle="模型与 Agent 的用量估算" />
      {total === null ? (
        <Card>
          <EmptyState title="还没有产生花费" description="成员开始工作并上报用量后，累计花费会显示在这里。" />
        </Card>
      ) : (
        <>
          <CostTotal total={total} />
          <Tabs defaultValue="members">
            <TabsList>
              <TabsTrigger value="members">按成员</TabsTrigger>
              <TabsTrigger value="tasks">按任务</TabsTrigger>
            </TabsList>
            <TabsContent value="members" className="mt-4 outline-none">
              <MemberCostTable total={total} />
            </TabsContent>
            <TabsContent value="tasks" className="mt-4 outline-none">
              <TaskCostTable />
            </TabsContent>
          </Tabs>
        </>
      )}
    </Page>
  );
}
