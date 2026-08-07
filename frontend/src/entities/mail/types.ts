export type SmtpSslMode = "tls" | "starttls" | "none";

export type SmtpSettings = {
  enabled: boolean;
  host: string;
  port: number;
  sslMode: SmtpSslMode;
  username: string;
  fromEmail: string;
  fromName: string;
  replyTo: string;
  hasPassword: boolean;
  updatedAt: string;
};

export type SmtpSettingsDraft = Omit<SmtpSettings, "hasPassword" | "updatedAt"> & {
  password: string;
};

export type MailDeliveryStatus = "queued" | "processing" | "sent" | "failed";

export type MailBatch = {
  id: string;
  kind: "reminder" | "test";
  form_id: string | null;
  created_by: string;
  total_count: number;
  created_at: string;
};

export type MailJob = {
  id: string;
  batch_id: string;
  form_id: string | null;
  organization_id: string | null;
  recipient_email: string;
  recipient_name: string;
  status: MailDeliveryStatus;
  attempts: number;
  max_attempts: number;
  last_error: string | null;
  sent_at: string | null;
  created_at: string;
  updated_at: string;
};

export type MailActivity = {
  batches: MailBatch[];
  jobs: MailJob[];
};

export type QueueMailResult = {
  batchId: string | null;
  queuedCount: number;
};
