export type StorageCleanupTrigger = "scheduled" | "manual";
export type StorageCleanupStatus = "running" | "succeeded" | "failed";

export type StorageCleanupRun = {
  id: string;
  triggerType: StorageCleanupTrigger;
  status: StorageCleanupStatus;
  retentionHours: number;
  removedFiles: number;
  removedAssets: number;
  error: string | null;
  startedAt: string;
  finishedAt: string | null;
};

export type StorageCleanupOverview = {
  retentionHours: number;
  lastRun: StorageCleanupRun | null;
};
