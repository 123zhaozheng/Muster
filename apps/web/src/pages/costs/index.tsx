import { Wallet } from "lucide-react";
import { PageHeader } from "@muster/ui";
import { AuditLog, BotCostList, CostDonut, CostSummary, TaskCostTable, TopTasks } from "../../components/costs/CostPanels";
import { Page, PageBody } from "../../components/layout";

export default function CostsPage() {
  return (
    <Page>
      <PageHeader title="成本与审计" subtitle="看看这周钱花在了哪里，以及系统里发生过什么" icon={<Wallet className="size-6" />} />
      <CostSummary />
      <PageBody
        main={
          <>
            <BotCostList />
            <TaskCostTable />
            <AuditLog />
          </>
        }
        rail={
          <>
            <CostDonut />
            <TopTasks />
          </>
        }
      />
    </Page>
  );
}
