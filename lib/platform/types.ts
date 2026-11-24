export type IndustryType = "beauty_salon" | "nail_studio" | "clinic" | "property" | "retail" | "other";

export type OrganizationStatus = "active" | "inactive" | "suspended";

export type SystemRole = "super_admin" | "user";

export type MemberRole = "customer_admin" | "staff" | "viewer";

export type AgentStatus = "active" | "inactive" | "draft";

export type LanguageMode = "trilingual" | "cantonese" | "english" | "mandarin";

export type SourceType = "pdf" | "note" | "faq" | "docx";

export type ChannelType = "web" | "phone" | "whatsapp";

export type ConversationStatus = "completed" | "in_progress" | "missed";

export type AppointmentStatus = "pending" | "confirmed" | "rejected" | "cancelled" | "completed";

export type OpeningHours = {
  mon_fri?: string;
  sat_sun?: string;
  notes?: string;
};

export type Organization = {
  id: string;
  name: string;
  slug: string;
  industry: IndustryType;
  status: OrganizationStatus;
  phone: string;
  email: string;
  address: string;
  opening_hours: OpeningHours;
  created_at: string;
  updated_at: string;
};

export type Profile = {
  id: string;
  email: string;
  full_name: string;
  phone: string;
  system_role: SystemRole;
  created_at: string;
  updated_at: string;
};

export type OrganizationMember = {
  id: string;
  organization_id: string;
  profile_id: string;
  role: MemberRole;
  is_active: boolean;
  created_at: string;
  updated_at: string;
};

export type Agent = {
  id: string;
  organization_id: string;
  elevenlabs_agent_id: string;
  name: string;
  voice_name: string;
  language_mode: LanguageMode;
  status: AgentStatus;
  config: Record<string, unknown>;
  created_at: string;
  updated_at: string;
};

export type KnowledgeSource = {
  id: string;
  organization_id: string;
  title: string;
  source_type: SourceType;
  content: string;
  file_size: number;
  is_active: boolean;
  created_at: string;
  updated_at: string;
};

export type Conversation = {
  transcript?: { role: string; message: string; time_in_call_secs?: number }[];
  analysis?: Record<string, unknown>;
  started_at?: string | null;
  ended_at?: string | null;
  id: string;
  organization_id: string;
  session_id: string;
  channel: ChannelType;
  caller_phone: string;
  caller_name: string;
  duration_seconds: number;
  user_transcript: string;
  ai_reply: string;
  summary: string;
  detected_intent: string;
  is_high_intent: boolean;
  status: ConversationStatus;
  created_at: string;
};

export type Appointment = {
  id: string;
  organization_id: string;
  conversation_id?: string | null;
  customer_name: string;
  customer_phone: string;
  service_name: string;
  appointment_time: string;
  preferred_time_window?: "morning" | "afternoon" | "evening" | null;
  source?: "admin" | "beauty_website" | "voice";
  notes: string;
  status: AppointmentStatus;
  created_at: string;
  updated_at: string;
};

export type UsageRecord = {
  id: string;
  organization_id: string;
  billing_period: string; // e.g. "2026-11"
  call_minutes: number;
  conversation_count: number;
  recorded_at: string;
  created_at: string;
};

export type PlatformSession = {
  userId: string;
  email: string;
  fullName: string;
  role: "super_admin" | "customer_admin";
  organizationId?: string | null;
  organizationName?: string | null;
  organizationSlug?: string | null;
};

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

export type CustomerOverview = {
  organization: Organization;
  monthlyConversations: number;
  totalCallMinutes: number;
  pendingAppointments: number;
  totalAppointments: number;
  agentStatus: AgentStatus;
  agentName: string;
};
