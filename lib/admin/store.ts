import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";

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

type LocalStore = {
  documents: DocumentRecord[];
  logs: ConversationRecord[];
};

const EMPTY: LocalStore = { documents: [], logs: [] };
const TEXT_LIMIT = 200_000;
const KNOWLEDGE_LIMIT = 16_000;
const QUERY_TIMEOUT_MS = 1_500;

let memory: LocalStore = EMPTY;
let writeQueue: Promise<void> = Promise.resolve();

function supabaseAdmin(): SupabaseClient | null {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL?.trim();
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY?.trim();
  if (!url || !key) return null;
  return createClient(url, key, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

function storePath(): string {
  return path.join(process.cwd(), "data", "admin-store.json");
}

async function readLocal(): Promise<LocalStore> {
  try {
    const raw = await readFile(storePath(), "utf8");
    const parsed = JSON.parse(raw) as Partial<LocalStore>;
    memory = {
      documents: Array.isArray(parsed.documents) ? parsed.documents : [],
      logs: Array.isArray(parsed.logs) ? parsed.logs : [],
    };
  } catch {
    // A missing file means this process is still on the in-memory copy.
  }
  return memory;
}

function persist(next: LocalStore): Promise<void> {
  memory = next;
  writeQueue = writeQueue.then(async () => {
    try {
      const file = storePath();
      await mkdir(path.dirname(file), { recursive: true });
      await writeFile(file, JSON.stringify(next), "utf8");
    } catch {
      // The disk may be read-only. The in-memory copy still serves this process.
    }
  });
  return writeQueue;
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
    ...input,
    id: crypto.randomUUID(),
    created_at: new Date().toISOString(),
  });
  const supabase = supabaseAdmin();
  if (!supabase) {
    const store = await readLocal();
    await persist({ ...store, documents: [document, ...store.documents] });
    return { mode: "local", document: summarize(document) };
  }

  if (input.bytes) {
    const storagePath = `${document.site_id}/${document.id}.pdf`;
    await supabase.storage
      .from("knowledge-documents")
      .upload(storagePath, input.bytes, {
        contentType: "application/pdf",
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
    const store = await readLocal();
    await persist({ ...store, documents: [document, ...store.documents] });
    return { mode: "local", document: summarize(document) };
  }
  return { mode: "supabase", document: summarize(document) };
}

export async function setDocumentActive(siteId: string, id: string, isActive: boolean): Promise<StoreMode> {
  const supabase = supabaseAdmin();
  if (!supabase) {
    const store = await readLocal();
    const found = store.documents.some((item) => item.id === id && item.site_id === siteId);
    if (!found) throw new Error("Document was not found");
    await persist({
      ...store,
      documents: store.documents.map((item) =>
        item.id === id && item.site_id === siteId ? { ...item, is_active: isActive } : item,
      ),
    });
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
    const store = await readLocal();
    const found = store.documents.some((item) => item.id === id && item.site_id === siteId);
    if (!found) throw new Error("Document was not found");
    await persist({
      ...store,
      documents: store.documents.filter((item) => !(item.id === id && item.site_id === siteId)),
    });
    return "local";
  }

  await supabase.storage.from("knowledge-documents").remove([`${siteId}/${id}.pdf`]);
  const { data, error } = await supabase.from("documents").delete().eq("id", id).eq("site_id", siteId).select("id");
  if (error) throw new Error("Document delete failed");
  if (!data || data.length === 0) throw new Error("Document was not found");
  return "supabase";
}

export async function activeKnowledge(siteId: string): Promise<string | null> {
  const load = async (): Promise<string | null> => {
    const supabase = supabaseAdmin();
    const documents = supabase
      ? await activeFromSupabase(supabase, siteId)
      : (await readLocal()).documents.filter((item) => item.site_id === siteId && item.is_active);
    if (documents.length === 0) return null;
    let used = 0;
    const parts: string[] = [];
    for (const document of documents) {
      const block = `${document.file_name}\n${document.extracted_text}`.trim();
      if (!block) continue;
      if (used + block.length > KNOWLEDGE_LIMIT) {
        parts.push(block.slice(0, Math.max(0, KNOWLEDGE_LIMIT - used)));
        break;
      }
      parts.push(block);
      used += block.length;
    }
    const text = parts.join("\n\n").trim();
    return text || null;
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

async function activeFromSupabase(supabase: SupabaseClient, siteId: string): Promise<DocumentRecord[]> {
  const { data, error } = await supabase
    .from("documents")
    .select("id,site_id,file_name,file_size,extracted_text,page_count,is_active,created_at")
    .eq("site_id", siteId)
    .eq("is_active", true)
    .order("created_at", { ascending: false });
  if (error) throw new Error("Knowledge read failed");
  return (data ?? []) as DocumentRecord[];
}

export async function insertConversation(record: ConversationRecord): Promise<void> {
  const supabase = supabaseAdmin();
  if (!supabase) {
    const store = await readLocal();
    await persist({ ...store, logs: [record, ...store.logs].slice(0, 1000) });
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
