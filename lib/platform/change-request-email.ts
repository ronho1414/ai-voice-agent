// Optional delivery boundary. No email provider is configured by this feature.
// In-app notifications are created in the database transaction independently.
export type ChangeRequestEmail = { recipient: string; requestReference: string; kind: "new" | "completed" | "rejected" };
export interface ChangeRequestEmailAdapter { send(message: ChangeRequestEmail): Promise<{ delivered: boolean; reason?: string }>; }
export const changeRequestEmailAdapter: ChangeRequestEmailAdapter = {
  async send() { return { delivered: false, reason: "email_provider_not_configured" }; },
};
