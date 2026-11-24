import { readFile, writeFile, mkdir } from "node:fs/promises";
import path from "node:path";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import type {
  Organization,
  Profile,
  OrganizationMember,
  Agent,
  KnowledgeSource,
  Conversation,
  Appointment,
  UsageRecord,
  AppointmentStatus,
  SuperAdminOverview,
  CustomerOverview
} from "./types";

export type PlatformDataStore = {
  organizations: Organization[];
  profiles: Profile[];
  members: OrganizationMember[];
  agents: Agent[];
  knowledge_sources: KnowledgeSource[];
  conversations: Conversation[];
  appointments: Appointment[];
  usage_records: UsageRecord[];
};

function supabaseAdmin(): SupabaseClient | null {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL?.trim();
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY?.trim();
  if (!url || !key) { if (process.env.NODE_ENV === "production") throw new Error("Platform database is not configured"); return null; }
  return createClient(url, key, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

function storePath(): string {
  return path.join(process.cwd(), "data", "platform-store.json");
}

let memoryCache: PlatformDataStore | null = null;

const EMPTY_STORE: PlatformDataStore = {
  organizations: [], profiles: [], members: [], agents: [], knowledge_sources: [],
  conversations: [], appointments: [], usage_records: [],
};

async function loadLocalStore(): Promise<PlatformDataStore> {
  if (process.env.NODE_ENV === "production") throw new Error("Production local fallback is disabled");
  if (memoryCache) return memoryCache;
  try {
    const raw = await readFile(storePath(), "utf8");
    memoryCache = JSON.parse(raw) as PlatformDataStore;
  } catch {
    memoryCache = EMPTY_STORE;
    await saveLocalStore(memoryCache);
  }
  return memoryCache;
}

async function saveLocalStore(data: PlatformDataStore): Promise<void> {
  memoryCache = data;
  try {
    await mkdir(path.dirname(storePath()), { recursive: true });
    await writeFile(storePath(), JSON.stringify(data, null, 2), "utf8");
  } catch (err) {
    console.error("Failed to persist local platform store:", err);
  }
}

// -----------------------------------------------------------------------------
// Organizations
// -----------------------------------------------------------------------------
export async function listOrganizations(): Promise<Organization[]> {
  const sb = supabaseAdmin();
  if (sb) {
    const { data, error } = await sb
      .from("organizations")
      .select("*")
      .order("created_at", { ascending: false });
    if (error) throw new Error(error.message);
    return data ?? [];
  }
  const store = await loadLocalStore();
  return [...store.organizations].sort(
    (a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime()
  );
}

export async function getOrganizationById(id: string): Promise<Organization | null> {
  const sb = supabaseAdmin();
  if (sb) {
    const { data, error } = await sb
      .from("organizations")
      .select("*")
      .eq("id", id)
      .maybeSingle();
    if (error) throw new Error(error.message);
    return data;
  }
  const store = await loadLocalStore();
  return store.organizations.find((o) => o.id === id) ?? null;
}

export async function getCustomerAccountByUserId(userId: string) {
  const sb = supabaseAdmin();
  if (!sb) return null;
  const { data: profile, error: profileError } = await sb
    .from("profiles").select("id,email,full_name").eq("id", userId).maybeSingle();
  if (profileError) throw new Error(profileError.message);
  if (!profile) return null;
  const { data: member, error: memberError } = await sb
    .from("organization_members")
    .select("organization_id,role,is_active,organizations(id,name,slug,status)")
    .eq("profile_id", userId).eq("is_active", true).eq("role", "customer_admin")
    .maybeSingle();
  if (memberError) throw new Error(memberError.message);
  const org = Array.isArray(member?.organizations) ? member.organizations[0] : member?.organizations;
  if (!member || !org || org.status !== "active") return null;
  return {
    userId: profile.id,
    email: profile.email,
    fullName: profile.full_name,
    role: "customer_admin" as const,
    organizationId: member.organization_id,
    organizationName: org.name,
    organizationSlug: org.slug,
  };
}

export async function isActiveCustomerMember(userId: string, organizationId: string): Promise<boolean> {
  const sb = supabaseAdmin();
  if (!sb) return false;
  const { data, error } = await sb.from("organization_members")
    .select("organization_id,organizations(status)")
    .eq("profile_id", userId).eq("organization_id", organizationId)
    .eq("role", "customer_admin").eq("is_active", true).maybeSingle();
  if (error) throw new Error(error.message);
  const org = Array.isArray(data?.organizations) ? data.organizations[0] : data?.organizations;
  return Boolean(data && org?.status === "active");
}

export async function getOrganizationBySlug(slug: string): Promise<Organization | null> {
  const sb = supabaseAdmin();
  if (sb) {
    const { data, error } = await sb
      .from("organizations")
      .select("*")
      .eq("slug", slug.toLowerCase().trim())
      .maybeSingle();
    if (error) throw new Error(error.message);
    return data;
  }
  const store = await loadLocalStore();
  return store.organizations.find((o) => o.slug === slug.toLowerCase().trim()) ?? null;
}

export async function createOrganization(input: {
  name: string;
  slug: string;
  industry?: Organization["industry"];
  phone?: string;
  email?: string;
  address?: string;
  elevenlabsAgentId?: string;
}): Promise<Organization> {
  const now = new Date().toISOString();
  const slug = input.slug.toLowerCase().trim();
  const id = crypto.randomUUID();

  const newOrg: Organization = {
    id,
    name: input.name.trim(),
    slug,
    industry: input.industry || "beauty_salon",
    status: "active",
    phone: input.phone?.trim() || "",
    email: input.email?.trim() || "",
    address: input.address?.trim() || "",
    opening_hours: {
      mon_fri: "10:00 - 20:00",
      sat_sun: "11:00 - 19:00",
      notes: "敬請提前預約"
    },
    created_at: now,
    updated_at: now,
  };

  const newAgent: Agent = {
    id: crypto.randomUUID(),
    organization_id: id,
    elevenlabs_agent_id: input.elevenlabsAgentId?.trim() || "",
    name: `${newOrg.name} 語音專員`,
    voice_name: "Cantonese Female",
    language_mode: "trilingual",
    status: input.elevenlabsAgentId?.trim() ? "active" : "draft",
    config: {},
    created_at: now,
    updated_at: now,
  };

  const sb = supabaseAdmin();
  if (sb) {
    const { data, error } = await sb.rpc("create_organization_with_agent", {
      organization_payload: newOrg, agent_payload: newAgent,
    });
    if (error || !data) throw new Error("商戶建立失敗，請確認代稱及 ElevenLabs Agent ID 未被使用。");
    return data as Organization;
  }

  const store = await loadLocalStore();
  if (store.organizations.some((o) => o.slug === slug)) {
    throw new Error(`Slug「${slug}」已經被使用，請使用其他代稱。`);
  }
  if (newAgent.elevenlabs_agent_id && store.agents.some((a) => a.elevenlabs_agent_id === newAgent.elevenlabs_agent_id)) {
    throw new Error("ElevenLabs Agent ID 已被使用。");
  }
  store.organizations.push(newOrg);
  store.agents.push(newAgent);
  await saveLocalStore(store);
  return newOrg;
}

export async function updateOrganization(
  id: string,
  updates: Partial<Omit<Organization, "id" | "created_at">>
): Promise<Organization> {
  const now = new Date().toISOString();
  const sb = supabaseAdmin();
  if (sb) {
    const { data, error } = await sb
      .from("organizations")
      .update({ ...updates, updated_at: now })
      .eq("id", id)
      .select()
      .single();
    if (error) throw new Error(error.message);
    return data;
  }

  const store = await loadLocalStore();
  const index = store.organizations.findIndex((o) => o.id === id);
  if (index === -1) throw new Error("Organization not found");

  store.organizations[index] = {
    ...store.organizations[index],
    ...updates,
    updated_at: now,
  };
  await saveLocalStore(store);
  return store.organizations[index];
}

// -----------------------------------------------------------------------------
// Agents
// -----------------------------------------------------------------------------
export async function getAgentByOrgId(organizationId: string): Promise<Agent | null> {
  const sb = supabaseAdmin();
  if (sb) {
    const { data, error } = await sb
      .from("agents")
      .select("*")
      .eq("organization_id", organizationId)
      .maybeSingle();
    if (error) throw new Error(error.message);
    return data;
  }
  const store = await loadLocalStore();
  return store.agents.find((a) => a.organization_id === organizationId) ?? null;
}

export async function upsertAgent(
  organizationId: string,
  input: { elevenlabsAgentId: string; name?: string; status?: Agent["status"] }
): Promise<Agent> {
  const now = new Date().toISOString();
  const sb = supabaseAdmin();
  if (sb) {
    const existing = await getAgentByOrgId(organizationId);
    if (existing) {
      const { data, error } = await sb
        .from("agents")
        .update({
          elevenlabs_agent_id: input.elevenlabsAgentId.trim(),
          name: input.name?.trim() || existing.name,
          status: input.status || existing.status,
          updated_at: now,
        })
        .eq("id", existing.id)
        .select()
        .single();
      if (error) throw new Error(error.message);
      return data;
    } else {
      const newAgent: Agent = {
        id: crypto.randomUUID(),
        organization_id: organizationId,
        elevenlabs_agent_id: input.elevenlabsAgentId.trim(),
        name: input.name?.trim() || "AI 專員",
        voice_name: "Cantonese Female",
        language_mode: "trilingual",
        status: input.status || (input.elevenlabsAgentId.trim() ? "active" : "draft"),
        config: {},
        created_at: now,
        updated_at: now,
      };
      const { data, error } = await sb.from("agents").insert(newAgent).select().single();
      if (error) throw new Error(error.message);
      return data;
    }
  }

  const store = await loadLocalStore();
  const index = store.agents.findIndex((a) => a.organization_id === organizationId);
  if (index >= 0) {
    store.agents[index] = {
      ...store.agents[index],
      elevenlabs_agent_id: input.elevenlabsAgentId.trim(),
      name: input.name?.trim() || store.agents[index].name,
      status: input.status || store.agents[index].status,
      updated_at: now,
    };
    await saveLocalStore(store);
    return store.agents[index];
  } else {
    const newAgent: Agent = {
      id: crypto.randomUUID(),
      organization_id: organizationId,
      elevenlabs_agent_id: input.elevenlabsAgentId.trim(),
      name: input.name?.trim() || "AI 專員",
      voice_name: "Cantonese Female",
      language_mode: "trilingual",
      status: input.status || (input.elevenlabsAgentId.trim() ? "active" : "draft"),
      config: {},
      created_at: now,
      updated_at: now,
    };
    store.agents.push(newAgent);
    await saveLocalStore(store);
    return newAgent;
  }
}

export async function updateAgentInstructions(
  organizationId: string,
  instructions: string
): Promise<Agent> {
  const existing = await getAgentByOrgId(organizationId);
  const now = new Date().toISOString();
  if (!existing) {
    await upsertAgent(organizationId, { elevenlabsAgentId: "", status: "draft" });
    return updateAgentInstructions(organizationId, instructions);
  }

  const config = { ...(existing.config || {}), customer_instructions: instructions };
  const sb = supabaseAdmin();
  if (sb) {
    const { data, error } = await sb
      .from("agents")
      .update({ config, updated_at: now })
      .eq("id", existing.id)
      .eq("organization_id", organizationId)
      .select()
      .single();
    if (error) throw new Error(error.message);
    return data;
  }

  const store = await loadLocalStore();
  const index = store.agents.findIndex((agent) => agent.id === existing.id && agent.organization_id === organizationId);
  if (index < 0) throw new Error("Agent not found");
  store.agents[index] = { ...store.agents[index], config, updated_at: now };
  await saveLocalStore(store);
  return store.agents[index];
}

// -----------------------------------------------------------------------------
// Knowledge Sources
// -----------------------------------------------------------------------------
export async function listKnowledgeSources(organizationId: string): Promise<KnowledgeSource[]> {
  const sb = supabaseAdmin();
  if (sb) {
    const { data, error } = await sb
      .from("knowledge_sources")
      .select("*")
      .eq("organization_id", organizationId)
      .order("updated_at", { ascending: false });
    if (error) throw new Error(error.message);
    return data ?? [];
  }
  const store = await loadLocalStore();
  return store.knowledge_sources
    .filter((source) => source.organization_id === organizationId)
    .sort((a, b) => new Date(b.updated_at).getTime() - new Date(a.updated_at).getTime());
}

export async function createKnowledgeSource(input: {
  organizationId: string;
  title: string;
  content: string;
  sourceType: KnowledgeSource["source_type"];
  fileSize?: number;
}): Promise<KnowledgeSource> {
  const now = new Date().toISOString();
  const source: KnowledgeSource = {
    id: crypto.randomUUID(),
    organization_id: input.organizationId,
    title: input.title.trim(),
    content: input.content,
    source_type: input.sourceType,
    file_size: input.fileSize ?? new TextEncoder().encode(input.content).length,
    is_active: true,
    created_at: now,
    updated_at: now,
  };
  const sb = supabaseAdmin();
  if (sb) {
    const { data, error } = await sb.from("knowledge_sources").insert(source).select().single();
    if (error) throw new Error(error.message);
    return data;
  }
  const store = await loadLocalStore();
  store.knowledge_sources.push(source);
  await saveLocalStore(store);
  return source;
}

export async function updateKnowledgeSource(
  organizationId: string,
  id: string,
  updates: Partial<Pick<KnowledgeSource, "title" | "content" | "source_type" | "is_active">>
): Promise<KnowledgeSource> {
  const now = new Date().toISOString();
  const values = {
    ...updates,
    ...(updates.content !== undefined ? { file_size: new TextEncoder().encode(updates.content).length } : {}),
    updated_at: now,
  };
  const sb = supabaseAdmin();
  if (sb) {
    const { data, error } = await sb
      .from("knowledge_sources")
      .update(values)
      .eq("id", id)
      .eq("organization_id", organizationId)
      .select()
      .single();
    if (error) throw new Error(error.message);
    return data;
  }
  const store = await loadLocalStore();
  const index = store.knowledge_sources.findIndex((source) => source.id === id && source.organization_id === organizationId);
  if (index < 0) throw new Error("Knowledge source not found");
  store.knowledge_sources[index] = { ...store.knowledge_sources[index], ...values };
  await saveLocalStore(store);
  return store.knowledge_sources[index];
}

export async function deleteKnowledgeSource(organizationId: string, id: string): Promise<void> {
  const sb = supabaseAdmin();
  if (sb) {
    const { error } = await sb
      .from("knowledge_sources")
      .delete()
      .eq("id", id)
      .eq("organization_id", organizationId);
    if (error) throw new Error(error.message);
    return;
  }
  const store = await loadLocalStore();
  store.knowledge_sources = store.knowledge_sources.filter(
    (source) => !(source.id === id && source.organization_id === organizationId)
  );
  await saveLocalStore(store);
}

// -----------------------------------------------------------------------------
// Conversations
// -----------------------------------------------------------------------------
export async function listConversations(organizationId: string): Promise<Conversation[]> {
  const sb = supabaseAdmin();
  if (sb) {
    const { data, error } = await sb
      .from("conversations")
      .select("*")
      .eq("organization_id", organizationId)
      .order("created_at", { ascending: false });
    if (error) throw new Error(error.message);
    return data ?? [];
  }
  const store = await loadLocalStore();
  return store.conversations
    .filter((c) => c.organization_id === organizationId)
    .sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime());
}

export async function countAllConversations(): Promise<number> {
  const sb = supabaseAdmin();
  if (sb) {
    const { count, error } = await sb
      .from("conversations")
      .select("*", { count: "exact", head: true });
    if (error) throw new Error("Conversation statistics are unavailable");
    return count ?? 0;
  }
  const store = await loadLocalStore();
  return store.conversations.length;
}

// -----------------------------------------------------------------------------
// Appointments
// -----------------------------------------------------------------------------
export async function listAppointments(organizationId: string): Promise<Appointment[]> {
  const sb = supabaseAdmin();
  if (sb) {
    const { data, error } = await sb
      .from("appointments")
      .select("*")
      .eq("organization_id", organizationId)
      .order("appointment_time", { ascending: true });
    if (error) throw new Error(error.message);
    return data ?? [];
  }
  const store = await loadLocalStore();
  return store.appointments
    .filter((a) => a.organization_id === organizationId)
    .sort((a, b) => new Date(a.appointment_time).getTime() - new Date(b.appointment_time).getTime());
}

export async function updateAppointmentStatus(
  organizationId: string,
  appointmentId: string,
  status: AppointmentStatus
): Promise<Appointment> {
  const now = new Date().toISOString();
  const sb = supabaseAdmin();
  if (sb) {
    const { data: current, error: currentError } = await sb.from("appointments")
      .select("status").eq("id", appointmentId).eq("organization_id", organizationId).maybeSingle();
    if (currentError || !current) throw new Error("找不到預約或沒有操作權限");
    assertAppointmentTransition(current.status, status);
    const { data, error } = await sb
      .from("appointments")
      .update({ status, updated_at: now })
      .eq("id", appointmentId)
      .eq("organization_id", organizationId)
      .eq("status", current.status)
      .select()
      .single();
    if (error) throw new Error(error.message);
    return data;
  }

  const store = await loadLocalStore();
  const index = store.appointments.findIndex(
    (a) => a.id === appointmentId && a.organization_id === organizationId
  );
  if (index === -1) throw new Error("Appointment not found");
  assertAppointmentTransition(store.appointments[index].status, status);

  store.appointments[index] = {
    ...store.appointments[index],
    status,
    updated_at: now,
  };
  await saveLocalStore(store);
  return store.appointments[index];
}

function assertAppointmentTransition(current: AppointmentStatus, next: AppointmentStatus): void {
  const transitions: Record<AppointmentStatus, AppointmentStatus[]> = {
    pending: ["confirmed", "rejected", "cancelled"],
    confirmed: ["completed", "rejected", "cancelled", "pending"],
    completed: ["confirmed", "rejected", "cancelled", "pending"],
    rejected: ["confirmed", "pending", "cancelled"],
    cancelled: ["confirmed", "pending", "rejected"],
  };
  if (current !== next && !transitions[current]?.includes(next)) throw new Error("此預約不能轉換至所選狀態");
}

export async function deleteAppointment(
  organizationId: string,
  appointmentId: string
): Promise<void> {
  const sb = supabaseAdmin();
  if (sb) {
    const { error } = await sb
      .from("appointments")
      .delete()
      .eq("id", appointmentId)
      .eq("organization_id", organizationId);
    if (error) throw new Error(error.message);
    return;
  }

  const store = await loadLocalStore();
  const index = store.appointments.findIndex(
    (a) => a.id === appointmentId && a.organization_id === organizationId
  );
  if (index !== -1) {
    store.appointments.splice(index, 1);
    await saveLocalStore(store);
  }
}

// -----------------------------------------------------------------------------
// Usage Records
// -----------------------------------------------------------------------------
export async function listUsageByOrg(organizationId: string): Promise<UsageRecord[]> {
  const sb = supabaseAdmin();
  if (sb) {
    const { data, error } = await sb
      .from("usage_records")
      .select("*")
      .eq("organization_id", organizationId)
      .order("billing_period", { ascending: false });
    if (error) throw new Error(error.message);
    return data ?? [];
  }
  const store = await loadLocalStore();
  return store.usage_records
    .filter((u) => u.organization_id === organizationId)
    .sort((a, b) => b.billing_period.localeCompare(a.billing_period));
}

export async function listAllUsageRecords(): Promise<UsageRecord[]> {
  const sb = supabaseAdmin();
  if (sb) {
    const { data, error } = await sb
      .from("usage_records")
      .select("*")
      .order("billing_period", { ascending: false });
    if (error) throw new Error(error.message);
    return data ?? [];
  }
  const store = await loadLocalStore();
  return [...store.usage_records];
}

// -----------------------------------------------------------------------------
// Super Admin Overview Aggregations
// -----------------------------------------------------------------------------
export async function getSuperAdminOverview(): Promise<SuperAdminOverview> {
  const orgs = await listOrganizations();
  const totalConversations = await countAllConversations();
  const allUsage = await listAllUsageRecords();

  const totalMinutes = allUsage.reduce((acc, cur) => acc + Number(cur.call_minutes || 0), 0);

  const hasSupabase = Boolean(
    process.env.NEXT_PUBLIC_SUPABASE_URL?.trim() &&
    process.env.SUPABASE_SERVICE_ROLE_KEY?.trim()
  );

  return {
    totalCustomers: orgs.length,
    activeCustomers: orgs.filter((o) => o.status === "active").length,
    totalConversations,
    totalUsageMinutes: Math.round(totalMinutes * 10) / 10,
    systemStatus: {
      database: hasSupabase ? "connected_supabase" : "local_store",
      elevenlabsApi: Boolean(process.env.ELEVENLABS_API_KEY?.trim()),
      storage: false,
    },
  };
}

// -----------------------------------------------------------------------------
// Customer Overview Aggregations
// -----------------------------------------------------------------------------
export async function getCustomerOverview(organizationId: string): Promise<CustomerOverview | null> {
  const org = await getOrganizationById(organizationId);
  if (!org) return null;

  const convs = await listConversations(organizationId);
  const appts = await listAppointments(organizationId);
  const usage = await listUsageByOrg(organizationId);
  const agent = await getAgentByOrgId(organizationId);

  const currentPeriod = new Date().toISOString().slice(0, 7); // e.g. "2026-11"
  const currentUsage = usage.find((u) => u.billing_period === currentPeriod);

  const currentMonthConversations = convs.filter((conversation) =>
    conversation.created_at.startsWith(currentPeriod)
  );
  const monthlyConversations = currentUsage?.conversation_count ?? currentMonthConversations.length;
  const totalCallMinutes = currentUsage?.call_minutes ??
    Math.round(currentMonthConversations.reduce((acc, c) => acc + c.duration_seconds, 0) / 60);

  return {
    organization: org,
    monthlyConversations,
    totalCallMinutes,
    pendingAppointments: appts.filter((a) => a.status === "pending").length,
    totalAppointments: appts.length,
    agentStatus: agent?.status ?? "draft",
    agentName: agent?.name ?? "AI 專員",
  };
}
