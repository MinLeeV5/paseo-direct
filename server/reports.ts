import type { PluginServerContext } from "@getpaseo/plugin/server";
import { reportRpc, reportsRpc, type ClientReport } from "../shared/contracts";

export function registerReports(server: PluginServerContext): void {
  const reports = new Map<string, ClientReport>();
  server.handle(reportRpc, async (report, context) => {
    const { self } = await context.paseo.hosts.list();
    if (self.serverId !== report.serverId) throw new Error("诊断报告的 PC 身份不匹配。");
    const previous = reports.get(report.deviceId);
    reports.delete(report.deviceId);
    reports.set(report.deviceId, report);
    while (reports.size > 12) reports.delete(reports.keys().next().value!);
    if (!previous || previous.activeType !== report.activeType || previous.stage !== report.stage ||
      previous.persisted !== report.persisted || previous.relayReturns !== report.relayReturns) {
      console.log(JSON.stringify({ event: "direct.client", report }));
    }
    return { received: true as const };
  });
  server.handle(reportsRpc, () => [...reports.values()]);
}
