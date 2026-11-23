/// <reference lib="webworker" />

import { runOrganizationXlsxTask, type OrganizationXlsxRequest } from "./xlsxCodec";

const worker = self as unknown as DedicatedWorkerGlobalScope;

worker.addEventListener("message", async ({ data }: MessageEvent<OrganizationXlsxRequest>) => {
  const response = await runOrganizationXlsxTask(data);
  const transfer = response.ok && response.operation === "export" ? [response.bytes] : [];
  worker.postMessage(response, transfer);
});
