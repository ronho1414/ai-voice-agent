-- VoicePilot AI admin schema.
-- Paste this whole file into the Supabase SQL Editor and run it once.
-- The Next.js server uses SUPABASE_SERVICE_ROLE_KEY. That role bypasses RLS.
-- Anonymous and logged-in Data API keys have no policies, so they cannot read these tables.

create extension if not exists pgcrypto;

create table if not exists public.documents (
  id uuid primary key default gen_random_uuid(),
  site_id text not null default 'voicepilot-hq',
  file_name text not null,
  file_size bigint not null default 0 check (file_size >= 0),
  extracted_text text not null default '',
  page_count integer not null default 0 check (page_count >= 0),
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  constraint documents_site_id_format check (site_id ~ '^[a-z0-9][a-z0-9-]{0,62}$')
);

create table if not exists public.knowledge_notes (
  id uuid primary key default gen_random_uuid(),
  site_id text not null default 'voicepilot-hq',
  body text not null,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  constraint knowledge_notes_site_id_format check (site_id ~ '^[a-z0-9][a-z0-9-]{0,62}$'),
  constraint knowledge_notes_body_not_blank check (length(btrim(body)) > 0)
);

create table if not exists public.conversation_logs (
  id uuid primary key default gen_random_uuid(),
  site_id text not null default 'voicepilot-hq',
  session_id text not null,
  current_page text not null default 'home',
  user_transcript text not null,
  detected_intent text not null default '',
  opener_clip_id text not null default '',
  ai_reply text not null default '',
  is_high_intent boolean not null default false,
  created_at timestamptz not null default now(),
  constraint conversation_logs_site_id_format check (site_id ~ '^[a-z0-9][a-z0-9-]{0,62}$')
);

create index if not exists documents_active_site_idx
  on public.documents (site_id, created_at desc)
  where is_active = true;

create index if not exists documents_site_created_idx
  on public.documents (site_id, created_at desc);

create index if not exists knowledge_notes_active_site_idx
  on public.knowledge_notes (site_id, created_at desc)
  where is_active = true;

create index if not exists knowledge_notes_site_created_idx
  on public.knowledge_notes (site_id, created_at desc);

create index if not exists conversation_logs_site_created_idx
  on public.conversation_logs (site_id, created_at desc);

create index if not exists conversation_logs_high_intent_idx
  on public.conversation_logs (site_id, created_at desc)
  where is_high_intent = true;

alter table public.documents enable row level security;
alter table public.knowledge_notes enable row level security;
alter table public.conversation_logs enable row level security;

revoke all on table public.documents from anon, authenticated;
revoke all on table public.knowledge_notes from anon, authenticated;
revoke all on table public.conversation_logs from anon, authenticated;

insert into storage.buckets (id, name, public)
values ('knowledge-documents', 'knowledge-documents', false)
on conflict (id) do nothing;
