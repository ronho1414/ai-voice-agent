import assert from "node:assert/strict";
import { test } from "node:test";
import { GET as webhookGet, POST as webhookPost } from "../app/api/webhooks/whatsapp/route";
import { POST as handoffPost } from "../app/api/tools/elevenlabs/whatsapp-handoff/route";
import {
  handleAdminWhatsAppSend,
  handleAdminWhatsAppStatus,
  handleWhatsAppWebhookGet,
  handleWhatsAppWebhookPost,
} from "../lib/platform/whatsapp";
import {
  dispatchMetaWhatsAppMessage,
  handleCustomerWhatsAppGet,
  handleCustomerWhatsAppPost,
  handleCustomerWhatsAppStream,
  handleElevenLabsWhatsAppHandoff,
  processPendingWhatsAppJobs,
} from "../lib/platform/whatsapp-inbox";
import { isWhatsAppTextInboxEnabled } from "../lib/platform/whatsapp-flag";
import type { PlatformSession } from "../lib/platform/types";

const session: PlatformSession = {
  userId: "00000000-0000-4000-8000-000000000001",
  email: "merchant@example.com",
  fullName: "Merchant",
  role: "customer_admin",
  organizationId: "00000000-0000-4000-8000-000000000002",
};

async function withEnv<T>(
  next: { NODE_ENV?: string; VERCEL_ENV?: string; WHATSAPP_TEXT_INBOX_ENABLED?: string },
  run: () => Promise<T>,
): Promise<T> {
  const env = process.env as Record<string, string | undefined>;
  const keys = ["NODE_ENV", "VERCEL_ENV", "WHATSAPP_TEXT_INBOX_ENABLED"] as const;
  const previous = Object.fromEntries(keys.map((key) => [key, env[key]]));
  for (const key of keys) {
    const value = next[key];
    if (value === undefined) delete env[key];
    else env[key] = value;
  }
  try {
    return await run();
  } finally {
    for (const key of keys) {
      const value = previous[key];
      if (value === undefined) delete env[key];
      else env[key] = value;
    }
  }
}

test("WhatsApp text inbox stays off in production unless explicitly enabled", async () => {
  await withEnv({ NODE_ENV: "production", VERCEL_ENV: "production" }, async () => {
    assert.equal(isWhatsAppTextInboxEnabled(), false);
    const bodies = [
      await handleWhatsAppWebhookGet(new Request("https://oraiservice.com/api/webhooks/whatsapp")),
      await handleWhatsAppWebhookPost(new Request("https://oraiservice.com/api/webhooks/whatsapp", { method: "POST", body: "{}" })),
      await webhookGet(new Request("https://oraiservice.com/api/webhooks/whatsapp")),
      await webhookPost(new Request("https://oraiservice.com/api/webhooks/whatsapp", { method: "POST", body: "{}" })),
      await handleCustomerWhatsAppGet(new Request("https://oraiservice.com/api/platform/customer/whatsapp"), session),
      await handleCustomerWhatsAppPost(new Request("https://oraiservice.com/api/platform/customer/whatsapp", { method: "POST", body: "{}" }), session),
      handleCustomerWhatsAppStream(new Request("https://oraiservice.com/api/platform/customer/whatsapp/stream"), session),
      await handleAdminWhatsAppStatus(),
      await handleAdminWhatsAppSend(new Request("https://oraiservice.com/api/platform/admin/whatsapp/send", { method: "POST", body: "{}" })),
      await handleElevenLabsWhatsAppHandoff(new Request("https://oraiservice.com/api/tools/elevenlabs/whatsapp-handoff", { method: "POST", body: "{}" })),
      await handoffPost(new Request("https://oraiservice.com/api/tools/elevenlabs/whatsapp-handoff", { method: "POST", body: "{}" })),
    ];
    for (const response of bodies) assert.equal(response.status, 404);
    const jobs = await processPendingWhatsAppJobs({
      claimJob: async () => {
        throw new Error("background job must not claim");
      },
    });
    assert.deepEqual(jobs, { processed: 0, sent: 0, abortedByTakeover: 0, failed: 0 });
    let fetched = false;
    const outbound = await dispatchMetaWhatsAppMessage({
      phoneNumberId: "123456",
      accessToken: "not-a-real-token",
      payload: { messaging_product: "whatsapp", to: "85290000000", type: "text", text: { body: "no" } },
      fetchImpl: async () => {
        fetched = true;
        throw new Error("outbound must not reach the network");
      },
    });
    assert.equal(fetched, false);
    assert.equal(outbound.ok, false);
    if (!outbound.ok) assert.equal(outbound.errorCode, "disabled");
  });
});

test("an explicit true opens the gate and an explicit false closes it outside production", async () => {
  await withEnv({ NODE_ENV: "test", WHATSAPP_TEXT_INBOX_ENABLED: "true" }, async () => {
    assert.equal(isWhatsAppTextInboxEnabled(), true);
    const open = await handleWhatsAppWebhookGet(new Request("https://example.com/api/webhooks/whatsapp"));
    assert.equal(open.status, 503);
  });
  await withEnv({ NODE_ENV: "development", WHATSAPP_TEXT_INBOX_ENABLED: "false" }, async () => {
    assert.equal(isWhatsAppTextInboxEnabled(), false);
    const closed = await handleWhatsAppWebhookGet(new Request("https://example.com/api/webhooks/whatsapp"));
    assert.equal(closed.status, 404);
  });
});
