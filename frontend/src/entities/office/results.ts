import { useQuery, useQueryClient, type QueryClient } from "@tanstack/react-query";
import { officeRequest, type OfficeJob, type OfficeResult } from "./api";

type TrackedJob = OfficeJob & { missedReads?: number };
type ResultsFeed = { results: OfficeResult[]; jobs: TrackedJob[] };

function resultsKey(formId: string) {
  return ["office-results", formId] as const;
}

export function isOfficeJobActive(job: OfficeJob) {
  return job.state === "queued" || job.state === "running";
}

export function getActiveOfficeJob(client: QueryClient, formId: string) {
  return client.getQueryData<ResultsFeed>(resultsKey(formId))?.jobs.find(isOfficeJobActive);
}

export function rememberOfficeJob(client: QueryClient, job: OfficeJob) {
  client.setQueryData<ResultsFeed>(resultsKey(job.form_id), previous => {
    if (previous?.results.some(result => result.id === job.id)) return previous;
    return {
      results: previous?.results ?? [],
      jobs: [job, ...(previous?.jobs.filter(current => current.id !== job.id) ?? [])],
    };
  });
}

export function useOfficeResults(formId: string) {
  const client = useQueryClient();
  const queryKey = resultsKey(formId);
  return useQuery({
    queryKey,
    queryFn: async ({ signal }): Promise<ResultsFeed> => {
      const data = await officeRequest<{ results: OfficeResult[]; jobs?: OfficeJob[] }>(`/forms/${formId}/results`, {
        cache: "no-store",
        signal: AbortSignal.any([signal, AbortSignal.timeout(15_000)]),
      });
      const jobs: TrackedJob[] = [...(data.jobs ?? [])];
      const visible = new Set([...jobs.map(job => job.id), ...data.results.map(result => result.id)]);
      // An older API can briefly omit both a finished job and its result.
      for (const job of client.getQueryData<ResultsFeed>(queryKey)?.jobs ?? []) {
        const missedReads = (job.missedReads ?? 0) + 1;
        if (isOfficeJobActive(job) && !visible.has(job.id) && missedReads < 3) jobs.push({ ...job, missedReads });
      }
      return { results: data.results, jobs };
    },
    staleTime: 0,
    refetchOnMount: "always",
    refetchInterval: query => query.state.data?.jobs.some(isOfficeJobActive) ? 2000 : false,
  });
}
