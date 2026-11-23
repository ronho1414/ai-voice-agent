import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { listOrganizations, countAllConversations } from "../lib/platform/store";
import { listDocuments, listNotes, listClients, createNote } from "../lib/admin/store";

const saved = { ...process.env };
const savedFetch = globalThis.fetch;
before(() => { Object.assign(process.env, { NODE_ENV: "production" }); });
after(() => {
  globalThis.fetch = savedFetch;
  for (const key of Object.keys(process.env)) if (!(key in saved)) delete process.env[key];
  Object.assign(process.env, saved);
});

test("production with missing database settings cannot load local/example data", async () => {
  delete process.env.NEXT_PUBLIC_SUPABASE_URL;
  delete process.env.SUPABASE_SERVICE_ROLE_KEY;
  for (const read of [listOrganizations, () => listDocuments("test-org"), () => listNotes("test-org"), listClients]) {
    await assert.rejects(read(), /Production|database/);
  }
});

test("database errors cannot silently return local documents, notes or clients in production", async () => {
  process.env.NEXT_PUBLIC_SUPABASE_URL = "https://supabase.example.test";
  process.env.SUPABASE_SERVICE_ROLE_KEY = "test-key";
  globalThis.fetch = async () => Response.json({ message: "Database unavailable", code: "TEST_ERROR" }, { status: 400 });
  for (const read of [() => listDocuments("test-org"), () => listNotes("test-org"), listClients]) {
    await assert.rejects(read(), /local fallback is disabled/);
  }
});

test("failed writes are never acknowledged as locally saved in production", async () => {
  await assert.rejects(createNote({ site_id: "test-org", body: "Fictional test note" }), /local fallback is disabled/);
});

test("unavailable statistics are not reported as a genuine zero", async () => {
  await assert.rejects(countAllConversations(), /statistics are unavailable/);
});
