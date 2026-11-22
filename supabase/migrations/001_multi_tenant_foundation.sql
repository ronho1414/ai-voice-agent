-- ==============================================================================
-- Orai Service — Multi-Tenant Platform Foundation
-- Migration: 001_multi_tenant_foundation.sql
-- Description: Core schema, organizations, profiles, members, agents, conversations,
--              appointments, usage records, and Row Level Security (RLS) policies.
-- ==============================================================================

create extension if not exists pgcrypto;

-- 1. Organizations (Business Customers: Beauty Salons, Nail Studios, Clinics, etc.)
create table if not exists public.organizations (
  id uuid primary key default gen_random_uuid(),
  name text not null check (length(btrim(name)) > 0),
  slug text not null unique check (slug ~ '^[a-z0-9][a-z0-9-]{0,62}$'),
  industry text not null default 'beauty_salon' check (industry in ('beauty_salon', 'nail_studio', 'clinic', 'property', 'retail', 'other')),
  status text not null default 'active' check (status in ('active', 'inactive', 'suspended')),
  phone text default '',
  email text default '',
  address text default '',
  opening_hours jsonb not null default '{"mon_fri": "10:00 - 20:00", "sat_sun": "11:00 - 19:00"}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- 2. User Profiles (Platform Super Admins and Customer Admins)
create table if not exists public.profiles (
  id uuid primary key default gen_random_uuid(),
  email text not null unique check (email ~* '^[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}$'),
  full_name text not null default '',
  phone text default '',
  system_role text not null default 'user' check (system_role in ('super_admin', 'user')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- 3. Organization Members (Tenant Membership Mapping)
create table if not exists public.organization_members (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  profile_id uuid not null references public.profiles(id) on delete cascade,
  role text not null default 'customer_admin' check (role in ('customer_admin', 'staff', 'viewer')),
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint uq_org_profile unique (organization_id, profile_id)
);

-- 4. Agents (ElevenLabs Voice Agent Configuration per Organization)
create table if not exists public.agents (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  elevenlabs_agent_id text not null default '' check (elevenlabs_agent_id ~ '^[A-Za-z0-9_-]{0,128}$'),
  name text not null default 'AI 智能前台',
  voice_name text not null default 'Cantonese Female',
  language_mode text not null default 'trilingual' check (language_mode in ('trilingual', 'cantonese', 'english', 'mandarin')),
  status text not null default 'active' check (status in ('active', 'inactive', 'draft')),
  config jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- 5. Knowledge Sources (Tenant Documents, Price Lists, FAQs, Service Notes)
create table if not exists public.knowledge_sources (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  title text not null check (length(btrim(title)) > 0),
  source_type text not null default 'pdf' check (source_type in ('pdf', 'note', 'faq', 'docx')),
  content text not null default '',
  file_size bigint not null default 0 check (file_size >= 0),
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- 6. Conversations (Call Records & Web Transcripts)
create table if not exists public.conversations (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  session_id text not null,
  channel text not null default 'web' check (channel in ('web', 'phone', 'whatsapp')),
  caller_phone text default '',
  caller_name text default '',
  duration_seconds integer not null default 0 check (duration_seconds >= 0),
  user_transcript text not null default '',
  ai_reply text not null default '',
  summary text not null default '',
  detected_intent text not null default '',
  is_high_intent boolean not null default false,
  status text not null default 'completed' check (status in ('completed', 'in_progress', 'missed')),
  created_at timestamptz not null default now()
);

-- 7. Appointments (Customer Booking Requests captured by AI)
create table if not exists public.appointments (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  conversation_id uuid references public.conversations(id) on delete set null,
  customer_name text not null check (length(btrim(customer_name)) > 0),
  customer_phone text not null check (length(btrim(customer_phone)) > 0),
  service_name text not null default '',
  appointment_time timestamptz not null,
  notes text default '',
  status text not null default 'pending' check (status in ('pending', 'confirmed', 'cancelled', 'completed')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- 8. Usage Records (Billing and Usage Tracking per Organization)
create table if not exists public.usage_records (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  billing_period text not null check (billing_period ~ '^\d{4}-\d{2}$'), -- e.g. '2026-11'
  call_minutes numeric(10,2) not null default 0.00 check (call_minutes >= 0),
  conversation_count integer not null default 0 check (conversation_count >= 0),
  recorded_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  constraint uq_org_billing_period unique (organization_id, billing_period)
);

-- ==============================================================================
-- Indexes for Performance & Tenant Isolation
-- ==============================================================================

create index if not exists idx_org_slug on public.organizations (slug);
create index if not exists idx_org_status on public.organizations (status);

create index if not exists idx_members_org on public.organization_members (organization_id);
create index if not exists idx_members_profile on public.organization_members (profile_id);

create index if not exists idx_agents_org on public.agents (organization_id);
create index if not exists idx_agents_elevenlabs on public.agents (elevenlabs_agent_id);

create index if not exists idx_knowledge_org_active on public.knowledge_sources (organization_id, is_active);

create index if not exists idx_conversations_org_created on public.conversations (organization_id, created_at desc);
create index if not exists idx_conversations_org_high_intent on public.conversations (organization_id, created_at desc) where is_high_intent = true;

create index if not exists idx_appointments_org_time on public.appointments (organization_id, appointment_time asc);
create index if not exists idx_appointments_status on public.appointments (organization_id, status);

create index if not exists idx_usage_org_period on public.usage_records (organization_id, billing_period);

-- ==============================================================================
-- Row Level Security (RLS) Policies
-- ==============================================================================

alter table public.organizations enable row level security;
alter table public.profiles enable row level security;
alter table public.organization_members enable row level security;
alter table public.agents enable row level security;
alter table public.knowledge_sources enable row level security;
alter table public.conversations enable row level security;
alter table public.appointments enable row level security;
alter table public.usage_records enable row level security;

-- Helper function: check if current authenticated user is super_admin
create or replace function public.is_super_admin()
returns boolean language sql stable security definer as $$
  select exists (
    select 1 from public.profiles
    where id = auth.uid() and system_role = 'super_admin'
  );
$$;

-- Helper function: get list of organization IDs user belongs to
create or replace function public.get_user_organization_ids()
returns setof uuid language sql stable security definer as $$
  select organization_id from public.organization_members
  where profile_id = auth.uid() and is_active = true;
$$;

-- 1. Organizations RLS
create policy "Super admin can do everything on organizations"
  on public.organizations for all
  using (public.is_super_admin())
  with check (public.is_super_admin());

create policy "Customer admin can view their own organization"
  on public.organizations for select
  using (id in (select public.get_user_organization_ids()));

create policy "Customer admin can update their own organization profile"
  on public.organizations for update
  using (id in (select public.get_user_organization_ids()))
  with check (id in (select public.get_user_organization_ids()));

-- 2. Profiles RLS
create policy "Super admin can manage all profiles"
  on public.profiles for all
  using (public.is_super_admin())
  with check (public.is_super_admin());

create policy "Users can view and edit their own profile"
  on public.profiles for all
  using (id = auth.uid())
  with check (id = auth.uid());

-- 3. Organization Members RLS
create policy "Super admin can manage all organization members"
  on public.organization_members for all
  using (public.is_super_admin())
  with check (public.is_super_admin());

create policy "Customer members can view members in their organization"
  on public.organization_members for select
  using (organization_id in (select public.get_user_organization_ids()));

-- 4. Agents RLS
create policy "Super admin can manage all agents"
  on public.agents for all
  using (public.is_super_admin())
  with check (public.is_super_admin());

create policy "Customer can view their organization agents"
  on public.agents for select
  using (organization_id in (select public.get_user_organization_ids()));

-- 5. Knowledge Sources RLS
create policy "Super admin can manage all knowledge sources"
  on public.knowledge_sources for all
  using (public.is_super_admin())
  with check (public.is_super_admin());

create policy "Customer can manage their own knowledge sources"
  on public.knowledge_sources for all
  using (organization_id in (select public.get_user_organization_ids()))
  with check (organization_id in (select public.get_user_organization_ids()));

-- 6. Conversations RLS
create policy "Super admin can manage all conversations"
  on public.conversations for all
  using (public.is_super_admin())
  with check (public.is_super_admin());

create policy "Customer can view their own organization conversations"
  on public.conversations for select
  using (organization_id in (select public.get_user_organization_ids()));

-- 7. Appointments RLS
create policy "Super admin can manage all appointments"
  on public.appointments for all
  using (public.is_super_admin())
  with check (public.is_super_admin());

create policy "Customer can manage appointments for their organization"
  on public.appointments for all
  using (organization_id in (select public.get_user_organization_ids()))
  with check (organization_id in (select public.get_user_organization_ids()));

-- 8. Usage Records RLS
create policy "Super admin can manage all usage records"
  on public.usage_records for all
  using (public.is_super_admin())
  with check (public.is_super_admin());

create policy "Customer can view their own usage records"
  on public.usage_records for select
  using (organization_id in (select public.get_user_organization_ids()));
