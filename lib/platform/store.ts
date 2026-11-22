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
  OrganizationStatus
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
  if (!url || !key) return null;
  return createClient(url, key, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

function storePath(): string {
  return path.join(process.cwd(), "data", "platform-store.json");
}

let memoryCache: PlatformDataStore | null = null;

const INITIAL_SEED: PlatformDataStore = {
  organizations: [
    {
      id: "b1a2c3d4-0001-4000-8000-000000000001",
      name: "GLOW 專業美甲與日式美睫沙龍",
      slug: "glow-beauty",
      industry: "nail_studio",
      status: "active",
      phone: "+852 9876 5432",
      email: "booking@glowbeauty.hk",
      address: "香港尖沙咀廣東道海港城對面 3 樓",
      opening_hours: {
        mon_fri: "11:00 - 20:30",
        sat_sun: "10:30 - 19:30",
        notes: "敬請提前至少 1 天預約",
      },
      created_at: "2026-11-20T10:00:00.000Z",
      updated_at: "2026-11-20T10:00:00.000Z",
    },
  ],
  profiles: [
    {
      id: "c1a2c3d4-0001-4000-8000-000000000001",
      email: "booking@glowbeauty.hk",
      full_name: "GLOW 店長 Kelly",
      phone: "+852 9876 5432",
      system_role: "user",
      created_at: "2026-11-20T10:00:00.000Z",
      updated_at: "2026-11-20T10:00:00.000Z",
    },
  ],
  members: [
    {
      id: "d1a2c3d4-0001-4000-8000-000000000001",
      organization_id: "b1a2c3d4-0001-4000-8000-000000000001",
      profile_id: "c1a2c3d4-0001-4000-8000-000000000001",
      role: "customer_admin",
      is_active: true,
      created_at: "2026-11-20T10:00:00.000Z",
      updated_at: "2026-11-20T10:00:00.000Z",
    },
  ],
  agents: [
    {
      id: "e1a2c3d4-0001-4000-8000-000000000001",
      organization_id: "b1a2c3d4-0001-4000-8000-000000000001",
      elevenlabs_agent_id: "agent_8201m7sbetj3e36s1a2nv3fgcqna",
      name: "GLOW 智能美甲前台",
      voice_name: "Cantonese Female",
      language_mode: "trilingual",
      status: "active",
      config: {},
      created_at: "2026-11-20T10:00:00.000Z",
      updated_at: "2026-11-20T10:00:00.000Z",
    },
  ],
  knowledge_sources: [
    {
      id: "f1a2c3d4-0001-4000-8000-000000000001",
      organization_id: "b1a2c3d4-0001-4000-8000-000000000001",
      title: "2026_GLOW美甲與美睫試做價目表.pdf",
      source_type: "pdf",
      content:
        "日式單色凝膠新客試做價 HK$380，漸變暈染 HK$480。日式美睫單根嫁接 HK$580。卸甲服務舊客免費，非本店卸甲 HK$100。",
      file_size: 1843200,
      is_active: true,
      created_at: "2026-11-20T10:00:00.000Z",
      updated_at: "2026-11-20T10:00:00.000Z",
    },
  ],
  conversations: [
    {
      id: "a1b2c3d4-0001-4000-8000-000000000001",
      organization_id: "b1a2c3d4-0001-4000-8000-000000000001",
      session_id: "sess_20261122_01",
      channel: "web",
      caller_phone: "+852 9123 4567",
      caller_name: "Chloe Wong",
      duration_seconds: 84,
      user_transcript:
        "你好呀，我想問下日式單色美甲第一次試做幾多錢？星期六下晝有無位？",
      ai_reply:
        "你好 Chloe！第一次試做日式單色凝膠美甲優惠價係 HK$380 全包包基本修甲。今個星期六下午 3 點同 5 點仲有位，要唔要我幫你登記留位？",
      summary: "查詢新客單色美甲試做價及星期六下午預約",
      detected_intent: "預約時段查詢",
      is_high_intent: true,
      status: "completed",
      created_at: "2026-11-22T14:32:00.000Z",
    },
  ],
  appointments: [
    {
      id: "91a2c3d4-0001-4000-8000-000000000001",
      organization_id: "b1a2c3d4-0001-4000-8000-000000000001",
      conversation_id: "a1b2c3d4-0001-4000-8000-000000000001",
      customer_name: "Chloe Wong",
      customer_phone: "+852 9123 4567",
      service_name: "日式單色凝膠美甲（新客試做）",
      appointment_time: "2026-11-28T15:00:00.000Z",
      notes: "指明想做奶茶裸色，需卸舊甲",
      status: "pending",
      created_at: "2026-11-22T14:35:00.000Z",
      updated_at: "2026-11-22T14:35:00.000Z",
    },
  ],
  usage_records: [
    {
      id: "81a2c3d4-0001-4000-8000-000000000001",
      organization_id: "b1a2c3d4-0001-4000-8000-000000000001",
      billing_period: "2026-11",
      call_minutes: 18.5,
      conversation_count: 14,
      recorded_at: "2026-11-22T23:59:59.000Z",
      created_at: "2026-11-22T23:59:59.000Z",
    },
  ],
};

async function loadLocalStore(): Promise<PlatformDataStore> {
  if (memoryCache) return memoryCache;
  try {
    const raw = await readFile(storePath(), "utf8");
    memoryCache = JSON.parse(raw) as PlatformDataStore;
  } catch {
    memoryCache = JSON.parse(JSON.stringify(INITIAL_SEED)) as PlatformDataStore;
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
    status: "active",
    config: {},
    created_at: now,
    updated_at: now,
  };

  const sb = supabaseAdmin();
  if (sb) {
    const { data: orgData, error: orgErr } = await sb
      .from("organizations")
      .insert(newOrg)
      .select()
      .single();
    if (orgErr) throw new Error(orgErr.message);

    const { error: agentErr } = await sb.from("agents").insert(newAgent);
    if (agentErr) console.error("Error creating agent row:", agentErr);

    return orgData;
  }

  const store = await loadLocalStore();
  if (store.organizations.some((o) => o.slug === slug)) {
    throw new Error(`Slug「${slug}」已經被使用，請使用其他代稱。`);
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
        status: input.status || "active",
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
      status: input.status || "active",
      config: {},
      created_at: now,
      updated_at: now,
    };
    store.agents.push(newAgent);
    await saveLocalStore(store);
    return newAgent;
  }
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
    if (error) return 0;
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
    const { data, error } = await sb
      .from("appointments")
      .update({ status, updated_at: now })
      .eq("id", appointmentId)
      .eq("organization_id", organizationId)
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

  store.appointments[index] = {
    ...store.appointments[index],
    status,
    updated_at: now,
  };
  await saveLocalStore(store);
  return store.appointments[index];
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
export type SuperAdminOverview = {
  totalCustomers: number;
  activeCustomers: number;
  totalConversations: number;
  totalUsageMinutes: number;
  systemStatus: {
    database: "connected_supabase" | "local_store";
    elevenlabsApi: boolean;
    storage: boolean;
  };
};

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
      storage: true,
    },
  };
}

// -----------------------------------------------------------------------------
// Customer Overview Aggregations
// -----------------------------------------------------------------------------
export type CustomerOverview = {
  organization: Organization;
  monthlyConversations: number;
  totalCallMinutes: number;
  pendingAppointments: number;
  totalAppointments: number;
  agentStatus: Agent["status"];
  agentName: string;
};

export async function getCustomerOverview(organizationId: string): Promise<CustomerOverview | null> {
  const org = await getOrganizationById(organizationId);
  if (!org) return null;

  const convs = await listConversations(organizationId);
  const appts = await listAppointments(organizationId);
  const usage = await listUsageByOrg(organizationId);
  const agent = await getAgentByOrgId(organizationId);

  const currentPeriod = new Date().toISOString().slice(0, 7); // e.g. "2026-11"
  const currentUsage = usage.find((u) => u.billing_period === currentPeriod);

  const monthlyConversations = currentUsage?.conversation_count ?? convs.length;
  const totalCallMinutes = currentUsage?.call_minutes ?? 
    Math.round(convs.reduce((acc, c) => acc + c.duration_seconds, 0) / 60);

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
