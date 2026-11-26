import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { readAgentId, readClientName, readClientSlug, readRouteMap, safeRouteMap, type RouteMap } from "@/lib/admin/clients";
import { contentTypeFor, documentKind, storageExtension } from "@/lib/admin/extract";

export type StoreMode = "supabase" | "local";

export type DocumentRecord = {
  id: string;
  site_id: string;
  file_name: string;
  file_size: number;
  extracted_text: string;
  page_count: number;
  is_active: boolean;
  created_at: string;
};

export type DocumentSummary = Omit<DocumentRecord, "extracted_text"> & {
  char_count: number;
};

export type NoteRecord = {
  id: string;
  site_id: string;
  body: string;
  is_active: boolean;
  created_at: string;
};

export type ConversationRecord = {
  id: string;
  site_id: string;
  session_id: string;
  current_page: string;
  user_transcript: string;
  detected_intent: string;
  opener_clip_id: string;
  ai_reply: string;
  is_high_intent: boolean;
  created_at: string;
};

export type LogSummary = {
  total: number;
  highIntent: number;
  topPage: string | null;
};

export type ClientRecord = {
  id: string;
  client_slug: string;
  client_name: string;
  elevenlabs_agent_id: string;
  route_map: RouteMap;
  is_active: boolean;
  created_at: string;
};

export type PublicClientConfig = {
  elevenlabsAgentId: string;
  routeMap: RouteMap;
};

export class ClientConfigServiceError extends Error {
  constructor(message: string, public readonly status = 503) {
    super(message);
  }
}

type LocalStore = {
  documents: DocumentRecord[];
  notes: NoteRecord[];
  logs: ConversationRecord[];
  clients: ClientRecord[];
};

const EMPTY: LocalStore = { documents: [], notes: [], logs: [], clients: [] };
const STORAGE_EXTS = [".pdf", ".txt", ".md", ".markdown", ".docx", ".csv"];
const TEXT_LIMIT = 200_000;
const KNOWLEDGE_LIMIT = 16_000;
const QUERY_TIMEOUT_MS = 1_500;

let memory: LocalStore = EMPTY;
let hydrated = false;
let writeQueue: Promise<void> = Promise.resolve();

function supabaseAdmin(): SupabaseClient | null {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL?.trim();
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY?.trim();
  if (!url || !key) {
    assertLocalAllowed();
    return null;
  }
  return createClient(url, key, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

function storePath(): string {
  return path.join(process.cwd(), "data", "admin-store.json");
}

function enqueue<T>(task: () => Promise<T>): Promise<T> {
  const run = writeQueue.then(task, task);
  writeQueue = run.then(
    () => undefined,
    () => undefined,
  );
  return run;
}

async function hydrate(): Promise<void> {
  if (hydrated) return;
  hydrated = true;
  try {
    const raw = await readFile(storePath(), "utf8");
    const parsed = JSON.parse(raw) as Partial<LocalStore>;
    memory = {
      documents: Array.isArray(parsed.documents) ? parsed.documents : [],
      notes: Array.isArray(parsed.notes) ? parsed.notes : [],
      logs: Array.isArray(parsed.logs) ? parsed.logs : [],
      clients: Array.isArray(parsed.clients) ? parsed.clients.flatMap(storedClient) : [],
    };
  } catch {
    memory = { documents: [], notes: [], logs: [], clients: [] };
  }
}

async function readLocal(): Promise<LocalStore> {
  assertLocalAllowed();
  return enqueue(async () => {
    await hydrate();
    return {
      documents: memory.documents.slice(),
      notes: memory.notes.slice(),
      logs: memory.logs.slice(),
      clients: memory.clients.slice(),
    };
  });
}

async function changeLocal(change: (store: LocalStore) => LocalStore): Promise<void> {
  assertLocalAllowed();
  await enqueue(async () => {
    await hydrate();
    memory = change(memory);
    try {
      const file = storePath();
      await mkdir(path.dirname(file), { recursive: true });
      await writeFile(file, JSON.stringify(memory), "utf8");
    } catch {
      // The disk may be read-only. The in-memory copy still serves this process.
    }
  });
}

function assertLocalAllowed(): void {
  if (process.env.NODE_ENV === "production") {
    throw new Error("Production requires a working database; local fallback is disabled");
  }
}

function summarize(document: DocumentRecord): DocumentSummary {
  const { extracted_text: text, ...rest } = document;
  return { ...rest, char_count: text.length };
}

function cleanDocument(value: DocumentRecord): DocumentRecord {
  return {
    ...value,
    extracted_text: value.extracted_text.slice(0, TEXT_LIMIT),
    file_size: Math.max(0, value.file_size),
    page_count: Math.max(0, value.page_count),
  };
}

export async function listDocuments(siteId: string): Promise<{ mode: StoreMode; documents: DocumentSummary[] }> {
  const supabase = supabaseAdmin();
  if (!supabase) {
    const store = await readLocal();
    return {
      mode: "local",
      documents: store.documents.filter((item) => item.site_id === siteId).map(summarize),
    };
  }

  const { data, error } = await supabase
    .from("documents")
    .select("id,site_id,file_name,file_size,extracted_text,page_count,is_active,created_at")
    .eq("site_id", siteId)
    .order("created_at", { ascending: false });
  if (error) {
    const store = await readLocal();
    return {
      mode: "local",
      documents: store.documents.filter((item) => item.site_id === siteId).map(summarize),
    };
  }
  return { mode: "supabase", documents: ((data ?? []) as DocumentRecord[]).map(summarize) };
}

export async function createDocument(
  input: Omit<DocumentRecord, "id" | "created_at"> & { bytes?: Uint8Array },
): Promise<{ mode: StoreMode; document: DocumentSummary }> {
  const document = cleanDocument({
    id: crypto.randomUUID(),
    site_id: input.site_id,
    file_name: input.file_name,
    file_size: input.file_size,
    extracted_text: input.extracted_text,
    page_count: input.page_count,
    is_active: input.is_active,
    created_at: new Date().toISOString(),
  });
  const supabase = supabaseAdmin();
  if (!supabase) {
    await changeLocal((store) => ({ ...store, documents: [document, ...store.documents] }));
    return { mode: "local", document: summarize(document) };
  }

  if (input.bytes) {
    const kind = documentKind(document.file_name);
    const storagePath = `${document.site_id}/${document.id}${storageExtension(document.file_name)}`;
    await supabase.storage
      .from("knowledge-documents")
      .upload(storagePath, input.bytes, {
        contentType: kind ? contentTypeFor(kind) : "application/octet-stream",
        upsert: false,
      })
      .then(() => undefined, () => undefined);
  }

  const { error } = await supabase.from("documents").insert({
    id: document.id,
    site_id: document.site_id,
    file_name: document.file_name,
    file_size: document.file_size,
    extracted_text: document.extracted_text,
    page_count: document.page_count,
    is_active: document.is_active,
    created_at: document.created_at,
  });
  if (error) {
    await changeLocal((store) => ({ ...store, documents: [document, ...store.documents] }));
    return { mode: "local", document: summarize(document) };
  }
  return { mode: "supabase", document: summarize(document) };
}

export async function setDocumentActive(siteId: string, id: string, isActive: boolean): Promise<StoreMode> {
  const supabase = supabaseAdmin();
  if (!supabase) {
    let found = false;
    await changeLocal((store) => {
      found = store.documents.some((item) => item.id === id && item.site_id === siteId);
      if (!found) return store;
      return {
        ...store,
        documents: store.documents.map((item) =>
          item.id === id && item.site_id === siteId ? { ...item, is_active: isActive } : item,
        ),
      };
    });
    if (!found) throw new Error("Document was not found");
    return "local";
  }

  const { data, error } = await supabase
    .from("documents")
    .update({ is_active: isActive })
    .eq("id", id)
    .eq("site_id", siteId)
    .select("id");
  if (error) throw new Error("Document update failed");
  if (!data || data.length === 0) throw new Error("Document was not found");
  return "supabase";
}

export async function deleteDocument(siteId: string, id: string): Promise<StoreMode> {
  const supabase = supabaseAdmin();
  if (!supabase) {
    let found = false;
    await changeLocal((store) => {
      found = store.documents.some((item) => item.id === id && item.site_id === siteId);
      if (!found) return store;
      return {
        ...store,
        documents: store.documents.filter((item) => !(item.id === id && item.site_id === siteId)),
      };
    });
    if (!found) throw new Error("Document was not found");
    return "local";
  }

  await supabase.storage
    .from("knowledge-documents")
    .remove(STORAGE_EXTS.map((ext) => `${siteId}/${id}${ext}`));
  const { data, error } = await supabase.from("documents").delete().eq("id", id).eq("site_id", siteId).select("id");
  if (error) throw new Error("Document delete failed");
  if (!data || data.length === 0) throw new Error("Document was not found");
  return "supabase";
}

export async function listNotes(siteId: string): Promise<{ mode: StoreMode; notes: NoteRecord[] }> {
  const supabase = supabaseAdmin();
  if (!supabase) {
    const store = await readLocal();
    return { mode: "local", notes: store.notes.filter((item) => item.site_id === siteId) };
  }
  const { data, error } = await supabase
    .from("knowledge_notes")
    .select("id,site_id,body,is_active,created_at")
    .eq("site_id", siteId)
    .order("created_at", { ascending: false });
  if (error) {
    const store = await readLocal();
    return { mode: "local", notes: store.notes.filter((item) => item.site_id === siteId) };
  }
  return { mode: "supabase", notes: (data ?? []) as NoteRecord[] };
}

export async function createNote(input: { site_id: string; body: string }): Promise<{ mode: StoreMode; note: NoteRecord }> {
  const body = input.body.trim().slice(0, TEXT_LIMIT);
  if (!body) throw new Error("Text is required");
  const note: NoteRecord = {
    id: crypto.randomUUID(),
    site_id: input.site_id,
    body,
    is_active: true,
    created_at: new Date().toISOString(),
  };
  const supabase = supabaseAdmin();
  if (!supabase) {
    await changeLocal((store) => ({ ...store, notes: [note, ...store.notes] }));
    return { mode: "local", note };
  }
  const { error } = await supabase.from("knowledge_notes").insert(note);
  if (error) {
    await changeLocal((store) => ({ ...store, notes: [note, ...store.notes] }));
    return { mode: "local", note };
  }
  return { mode: "supabase", note };
}

export async function setNoteActive(siteId: string, id: string, isActive: boolean): Promise<StoreMode> {
  const supabase = supabaseAdmin();
  if (!supabase) {
    let found = false;
    await changeLocal((store) => {
      found = store.notes.some((item) => item.id === id && item.site_id === siteId);
      if (!found) return store;
      return {
        ...store,
        notes: store.notes.map((item) =>
          item.id === id && item.site_id === siteId ? { ...item, is_active: isActive } : item,
        ),
      };
    });
    if (!found) throw new Error("Note was not found");
    return "local";
  }
  const { data, error } = await supabase
    .from("knowledge_notes")
    .update({ is_active: isActive })
    .eq("id", id)
    .eq("site_id", siteId)
    .select("id");
  if (error) throw new Error("Note update failed");
  if (!data || data.length === 0) throw new Error("Note was not found");
  return "supabase";
}

export async function deleteNote(siteId: string, id: string): Promise<StoreMode> {
  const supabase = supabaseAdmin();
  if (!supabase) {
    let found = false;
    await changeLocal((store) => {
      found = store.notes.some((item) => item.id === id && item.site_id === siteId);
      if (!found) return store;
      return {
        ...store,
        notes: store.notes.filter((item) => !(item.id === id && item.site_id === siteId)),
      };
    });
    if (!found) throw new Error("Note was not found");
    return "local";
  }
  const { data, error } = await supabase.from("knowledge_notes").delete().eq("id", id).eq("site_id", siteId).select("id");
  if (error) throw new Error("Note delete failed");
  if (!data || data.length === 0) throw new Error("Note was not found");
  return "supabase";
}

export async function activeKnowledge(siteId: string): Promise<string | null> {
  const load = async (): Promise<string | null> => {
    const supabase = supabaseAdmin();
    const local = supabase ? null : await readLocal();
    const documents = local
      ? local.documents.filter((item) => item.site_id === siteId && item.is_active)
      : await activeDocuments(supabase!, siteId);
    const notes = local
      ? local.notes.filter((item) => item.site_id === siteId && item.is_active)
      : await activeNotes(supabase!, siteId);
    return packKnowledge(notes, documents);
  };

  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      load(),
      new Promise<null>((resolve) => {
        timer = setTimeout(() => resolve(null), QUERY_TIMEOUT_MS);
      }),
    ]);
  } catch {
    return null;
  } finally {
    if (timer) clearTimeout(timer);
  }
}

function packKnowledge(notes: NoteRecord[], documents: DocumentRecord[]): string | null {
  const blocks = [
    ...notes.map((note) => ({ title: "手打備註", text: note.body })),
    ...documents.map((document) => ({ title: document.file_name, text: document.extracted_text })),
  ];
  let used = 0;
  const parts: string[] = [];
  for (const block of blocks) {
    const text = block.text.trim();
    if (!text) continue;
    const chunk = `${block.title}\n${text}`;
    const room = KNOWLEDGE_LIMIT - used;
    if (room <= 0) break;
    if (chunk.length > room) {
      parts.push(chunk.slice(0, room));
      break;
    }
    parts.push(chunk);
    used += chunk.length;
  }
  const text = parts.join("\n\n").trim();
  return text || null;
}

async function activeDocuments(supabase: SupabaseClient, siteId: string): Promise<DocumentRecord[]> {
  try {
    const { data, error } = await supabase
      .from("documents")
      .select("id,site_id,file_name,file_size,extracted_text,page_count,is_active,created_at")
      .eq("site_id", siteId)
      .eq("is_active", true)
      .order("created_at", { ascending: false });
    if (error) throw new Error("Knowledge read failed");
    return (data ?? []) as DocumentRecord[];
  } catch {
    const store = await readLocal();
    return store.documents.filter((item) => item.site_id === siteId && item.is_active);
  }
}

async function activeNotes(supabase: SupabaseClient, siteId: string): Promise<NoteRecord[]> {
  try {
    const { data, error } = await supabase
      .from("knowledge_notes")
      .select("id,site_id,body,is_active,created_at")
      .eq("site_id", siteId)
      .eq("is_active", true)
      .order("created_at", { ascending: false });
    if (error) throw new Error("Knowledge read failed");
    return (data ?? []) as NoteRecord[];
  } catch {
    const store = await readLocal();
    return store.notes.filter((item) => item.site_id === siteId && item.is_active);
  }
}

export async function insertConversation(record: ConversationRecord): Promise<void> {
  const supabase = supabaseAdmin();
  if (!supabase) {
    await changeLocal((store) => ({ ...store, logs: [record, ...store.logs].slice(0, 1000) }));
    return;
  }
  const { error } = await supabase.from("conversation_logs").insert(record);
  if (error) throw new Error("Conversation log failed");
}

export async function conversationReport(
  siteId: string,
  highIntentOnly: boolean,
): Promise<{ mode: StoreMode; summary: LogSummary; logs: ConversationRecord[] }> {
  const supabase = supabaseAdmin();
  if (!supabase) {
    const store = await readLocal();
    const rows = store.logs.filter((item) => item.site_id === siteId);
    return { mode: "local", summary: summarizeLogs(rows), logs: filterLogs(rows, highIntentOnly).slice(0, 100) };
  }

  try {
    const listed = supabase
      .from("conversation_logs")
      .select(
        "id,site_id,session_id,current_page,user_transcript,detected_intent,opener_clip_id,ai_reply,is_high_intent,created_at",
      )
      .eq("site_id", siteId)
      .order("created_at", { ascending: false })
      .limit(100);
    const query = highIntentOnly ? listed.eq("is_high_intent", true) : listed;
    const [{ count: total }, { count: highIntent }, { data, error }] = await Promise.all([
      supabase.from("conversation_logs").select("id", { count: "exact", head: true }).eq("site_id", siteId),
      supabase
        .from("conversation_logs")
        .select("id", { count: "exact", head: true })
        .eq("site_id", siteId)
        .eq("is_high_intent", true),
      query,
    ]);
    if (error) {
      const store = await readLocal();
      const rows = store.logs.filter((item) => item.site_id === siteId);
      return { mode: "local", summary: summarizeLogs(rows), logs: filterLogs(rows, highIntentOnly).slice(0, 100) };
    }
    const logs = (data ?? []) as ConversationRecord[];
    const pages = await pageCounts(supabase, siteId);
    return {
      mode: "supabase",
      summary: {
        total: total ?? logs.length,
        highIntent: highIntent ?? logs.filter((item) => item.is_high_intent).length,
        topPage: topPage(pages),
      },
      logs,
    };
  } catch {
    const store = await readLocal();
    const rows = store.logs.filter((item) => item.site_id === siteId);
    return { mode: "local", summary: summarizeLogs(rows), logs: filterLogs(rows, highIntentOnly).slice(0, 100) };
  }
}

async function pageCounts(supabase: SupabaseClient, siteId: string): Promise<string[]> {
  const { data } = await supabase
    .from("conversation_logs")
    .select("current_page")
    .eq("site_id", siteId)
    .order("created_at", { ascending: false })
    .limit(1000);
  return (data ?? []).map((item) => {
    const page = (item as { current_page?: unknown }).current_page;
    return typeof page === "string" ? page : "";
  });
}

function filterLogs(rows: ConversationRecord[], highIntentOnly: boolean): ConversationRecord[] {
  return highIntentOnly ? rows.filter((item) => item.is_high_intent) : rows;
}

function summarizeLogs(rows: ConversationRecord[]): LogSummary {
  return {
    total: rows.length,
    highIntent: rows.filter((item) => item.is_high_intent).length,
    topPage: topPage(rows.map((item) => item.current_page)),
  };
}

function storedClient(value: unknown): ClientRecord[] {
  if (!value || typeof value !== "object") return [];
  const row = value as Partial<ClientRecord>;
  try {
    return [
      {
        id: typeof row.id === "string" && row.id ? row.id : crypto.randomUUID(),
        client_slug: readClientSlug(row.client_slug),
        client_name: readClientName(row.client_name),
        elevenlabs_agent_id: readAgentId(row.elevenlabs_agent_id),
        route_map: readRouteMap(row.route_map),
        is_active: row.is_active !== false,
        created_at: typeof row.created_at === "string" ? row.created_at : new Date().toISOString(),
      },
    ];
  } catch {
    return [];
  }
}

function publicConfig(client: ClientRecord): PublicClientConfig | null {
  if (!client.is_active) return null;
  return {
    elevenlabsAgentId: client.elevenlabs_agent_id,
    routeMap: safeRouteMap(client.route_map),
  };
}

export async function listClients(): Promise<{ mode: StoreMode; clients: ClientRecord[] }> {
  const supabase = supabaseAdmin();
  if (!supabase) {
    const store = await readLocal();
    return { mode: "local", clients: store.clients };
  }
  const { data, error } = await supabase
    .from("embed_clients")
    .select("id,client_slug,client_name,elevenlabs_agent_id,route_map,is_active,created_at")
    .order("created_at", { ascending: false });
  if (error) {
    const store = await readLocal();
    return { mode: "local", clients: store.clients };
  }
  return { mode: "supabase", clients: (data ?? []).flatMap(storedClient) };
}

export async function saveClient(input: {
  client_slug: string;
  client_name: string;
  elevenlabs_agent_id: string;
  route_map: RouteMap;
}): Promise<{ mode: StoreMode; client: ClientRecord }> {
  const slug = readClientSlug(input.client_slug);
  const name = readClientName(input.client_name);
  const agentId = readAgentId(input.elevenlabs_agent_id);
  const routeMap = readRouteMap(input.route_map);
  const supabase = supabaseAdmin();
  if (!supabase) {
    let saved: ClientRecord | null = null;
    await changeLocal((store) => {
      const current = store.clients.find((item) => item.client_slug === slug);
      saved = current
        ? { ...current, client_name: name, elevenlabs_agent_id: agentId, route_map: routeMap }
        : {
            id: crypto.randomUUID(),
            client_slug: slug,
            client_name: name,
            elevenlabs_agent_id: agentId,
            route_map: routeMap,
            is_active: true,
            created_at: new Date().toISOString(),
          };
      const rest = store.clients.filter((item) => item.client_slug !== slug);
      return { ...store, clients: [saved!, ...rest] };
    });
    return { mode: "local", client: saved! };
  }

  const existing = await supabase
    .from("embed_clients")
    .select("id,client_slug,client_name,elevenlabs_agent_id,route_map,is_active,created_at")
    .eq("client_slug", slug)
    .maybeSingle();
  if (existing.error) {
    let saved: ClientRecord | null = null;
    await changeLocal((store) => {
      const current = store.clients.find((item) => item.client_slug === slug);
      saved = current
        ? { ...current, client_name: name, elevenlabs_agent_id: agentId, route_map: routeMap }
        : {
            id: crypto.randomUUID(),
            client_slug: slug,
            client_name: name,
            elevenlabs_agent_id: agentId,
            route_map: routeMap,
            is_active: true,
            created_at: new Date().toISOString(),
          };
      return { ...store, clients: [saved!, ...store.clients.filter((item) => item.client_slug !== slug)] };
    });
    return { mode: "local", client: saved! };
  }
  const prior = existing.data ? storedClient(existing.data)[0] : undefined;
  const client: ClientRecord = {
    id: prior?.id ?? crypto.randomUUID(),
    client_slug: slug,
    client_name: name,
    elevenlabs_agent_id: agentId,
    route_map: routeMap,
    is_active: prior?.is_active ?? true,
    created_at: prior?.created_at ?? new Date().toISOString(),
  };
  const { error } = prior
    ? await supabase
        .from("embed_clients")
        .update({
          client_name: client.client_name,
          elevenlabs_agent_id: client.elevenlabs_agent_id,
          route_map: client.route_map,
        })
        .eq("client_slug", slug)
    : await supabase.from("embed_clients").insert(client);
  if (error) throw new Error("Client save failed");
  return { mode: "supabase", client };
}

export async function setClientActive(slugInput: string, isActive: boolean): Promise<StoreMode> {
  const slug = readClientSlug(slugInput);
  const supabase = supabaseAdmin();
  if (!supabase) {
    let found = false;
    await changeLocal((store) => {
      found = store.clients.some((item) => item.client_slug === slug);
      if (!found) return store;
      return {
        ...store,
        clients: store.clients.map((item) => (item.client_slug === slug ? { ...item, is_active: isActive } : item)),
      };
    });
    if (!found) throw new Error("Client was not found");
    return "local";
  }
  const { data, error } = await supabase
    .from("embed_clients")
    .update({ is_active: isActive })
    .eq("client_slug", slug)
    .select("id");
  if (error) throw new Error("Client update failed");
  if (!data || data.length === 0) throw new Error("Client was not found");
  return "supabase";
}

export async function publicClientConfig(slugInput: string): Promise<PublicClientConfig | null> {
  let slug = "";
  try {
    slug = readClientSlug(slugInput);
  } catch {
    return null;
  }
  let supabase: SupabaseClient | null = null;
  try {
    supabase = supabaseAdmin();
  } catch (err) {
    throw new ClientConfigServiceError(
      err instanceof Error ? err.message : "Database configuration unavailable",
      503,
    );
  }
  if (!supabase) {
    const store = await readLocal();
    const client = store.clients.find((item) => item.client_slug === slug);
    return client ? publicConfig(client) : null;
  }
  const { data, error } = await supabase
    .from("embed_clients")
    .select("id,client_slug,client_name,elevenlabs_agent_id,route_map,is_active,created_at")
    .eq("client_slug", slug)
    .maybeSingle();
  if (error) {
    throw new ClientConfigServiceError("Client config database unavailable", 503);
  }
  if (!data) {
    return null;
  }
  const client = storedClient(data)[0];
  return client ? publicConfig(client) : null;
}

function topPage(pages: string[]): string | null {
  const counts = new Map<string, number>();
  for (const page of pages) {
    if (!page) continue;
    counts.set(page, (counts.get(page) ?? 0) + 1);
  }
  let best: string | null = null;
  let score = 0;
  for (const [page, count] of counts) {
    if (count > score) {
      best = page;
      score = count;
    }
  }
  return best;
}
