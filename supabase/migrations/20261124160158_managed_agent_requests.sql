-- Managed service requests never change provider configuration or legacy instructions.
create unique index if not exists agents_org_identity on public.agents(organization_id,id);
create function public.valid_agent_preferences(p jsonb) returns boolean language plpgsql immutable set search_path='' as $$
declare k text; allowed jsonb := '{"voice_gender":["female","male","none"],"voice_character":["natural","gentle","calm","energetic"],"speaking_speed":["slow","medium","fast"],"response_style":["friendly","professional","proactive","caring"],"response_detail":["brief","balanced","detailed"],"preferred_language":["auto","cantonese","english","mandarin"]}';
begin
 if jsonb_typeof(p) is distinct from 'object' or (select count(*) from jsonb_object_keys(p))<>7 then return false; end if;
 for k in select jsonb_object_keys(allowed) loop
  if not (p ? k) or (p->k <> 'null'::jsonb and not (allowed->k @> jsonb_build_array(p->k))) then return false; end if;
 end loop;
 return coalesce(jsonb_typeof(p->'greeting')='string' and char_length(p->>'greeting')<=300,false);
end $$;
create table public.agent_preferences (
 organization_id uuid primary key references public.organizations(id),
 agent_id uuid not null,
 settings jsonb not null default '{"voice_gender":null,"voice_character":null,"speaking_speed":null,"response_style":null,"response_detail":null,"preferred_language":null,"greeting":""}' check(public.valid_agent_preferences(settings)),
 version integer not null default 0 check(version>=0),
 curated_voice_id text, -- Reserved for future Orai-curated catalogue; not customer-writable.
 updated_by uuid references public.profiles(id), updated_at timestamptz not null default now(),
 foreign key(organization_id,agent_id) references public.agents(organization_id,id)
);
create table public.agent_change_requests (
 id uuid primary key default gen_random_uuid(),
 request_no bigint generated always as identity unique,
 reference text generated always as ('REQ-'||lpad(request_no::text,6,'0')) stored,
 organization_id uuid not null references public.organizations(id),
 agent_id uuid not null, submitted_by uuid not null references public.profiles(id),
 previous_settings jsonb not null check(public.valid_agent_preferences(previous_settings)),
 requested_settings jsonb not null check(public.valid_agent_preferences(requested_settings)),
 changed_fields jsonb not null check(jsonb_typeof(changed_fields)='array'),
 additional_notes text not null default '' check(char_length(additional_notes)<=2000),
 status text not null default 'pending' check(status in ('pending','in_progress','needs_information','completed','rejected','cancelled')),
 assigned_admin_id uuid references public.profiles(id), customer_visible_response text not null default '' check(char_length(customer_visible_response)<=2000),
 final_applied_settings jsonb check(final_applied_settings is null or public.valid_agent_preferences(final_applied_settings)),
 base_version integer not null, version integer not null default 1,
 idempotency_key uuid not null, created_at timestamptz not null default now(),updated_at timestamptz not null default now(),completed_at timestamptz,
 foreign key(organization_id,agent_id) references public.agents(organization_id,id),
 unique(organization_id,idempotency_key), unique(organization_id,id),
 check((status='completed')=(completed_at is not null)),
 check(status<>'completed' or final_applied_settings is not null)
);
create index agent_requests_tenant_date on public.agent_change_requests(organization_id,created_at desc);
create index agent_requests_status_date on public.agent_change_requests(status,created_at);
create table public.agent_change_request_events (
 id uuid primary key default gen_random_uuid(), request_id uuid not null, organization_id uuid not null,
 actor_id uuid not null references public.profiles(id),kind text not null,message text not null default '' check(char_length(message)<=2000),
 created_at timestamptz not null default now(), foreign key(organization_id,request_id) references public.agent_change_requests(organization_id,id)
);
create table public.agent_change_request_internal_notes (
 id uuid primary key default gen_random_uuid(), request_id uuid not null,organization_id uuid not null,
 actor_id uuid not null references public.profiles(id),kind text not null default 'internal_note',message text not null check(char_length(message) between 1 and 2000),
 created_at timestamptz not null default now(),foreign key(organization_id,request_id) references public.agent_change_requests(organization_id,id)
);
create table public.notifications (
 id uuid primary key default gen_random_uuid(),recipient_id uuid not null references public.profiles(id),
 request_id uuid not null,organization_id uuid not null,title text not null,event_key text not null,
 created_at timestamptz not null default now(),read_at timestamptz,
 unique(recipient_id,event_key),foreign key(organization_id,request_id) references public.agent_change_requests(organization_id,id)
);
create index notifications_recipient_date on public.notifications(recipient_id,created_at desc);
create index request_events_request on public.agent_change_request_events(request_id,created_at);
create index request_notes_request on public.agent_change_request_internal_notes(request_id,created_at);

do $$ declare t text; begin
 foreach t in array array['agent_preferences','agent_change_requests','agent_change_request_events','agent_change_request_internal_notes','notifications'] loop
  execute format('alter table public.%I enable row level security',t);
  execute format('revoke all on public.%I from public,anon,authenticated',t);
  execute format('grant select on public.%I to authenticated',t);
  execute format('grant all on public.%I to service_role',t);
 end loop;
end $$;
grant usage,select on sequence public.agent_change_requests_request_no_seq to service_role;
create policy preferences_read on public.agent_preferences for select to authenticated using(private.is_super_admin() or organization_id in(select private.get_user_organization_ids()));
create policy request_read on public.agent_change_requests for select to authenticated using(private.is_super_admin() or organization_id in(select private.get_user_organization_ids()));
create policy events_read on public.agent_change_request_events for select to authenticated using(private.is_super_admin() or organization_id in(select private.get_user_organization_ids()));
create policy notes_read on public.agent_change_request_internal_notes for select to authenticated using(private.is_super_admin());
create policy notifications_read on public.notifications for select to authenticated using(private.current_session_is_active() and recipient_id=auth.uid() and (private.is_super_admin() or organization_id in(select private.get_user_organization_ids())));

-- Service-only RPC, called after the existing server session/tenant checks.
-- No client Data API writes can bypass atomicity, notifications or transition rules.
create function public.managed_agent_command(actor_id uuid,tenant_id uuid,operation text,payload jsonb) returns jsonb
language plpgsql security invoker set search_path='' as $$
declare admin boolean; pref public.agent_preferences; req public.agent_change_requests; existing public.agent_change_requests;
 agent uuid; requested jsonb; delta jsonb; msg text; next_status text; event_id uuid; title text; notify_admin boolean:=false; notify_customer boolean:=false; rid uuid;
begin
 if jsonb_typeof(payload) is distinct from 'object' then raise exception 'Invalid payload'; end if;
 select (p.system_role='super_admin') into admin from public.profiles p where p.id=actor_id;
 if admin is null then raise exception using errcode='42501',message='Not authorized'; end if;
 if operation='mark_read' then
  if payload->>'all'='true' then update public.notifications set read_at=coalesce(read_at,now()) where recipient_id=actor_id;
  else update public.notifications set read_at=coalesce(read_at,now()) where recipient_id=actor_id and id=(payload->>'id')::uuid; end if;
  return jsonb_build_object('success',true);
 end if;
 if not admin and not exists(select 1 from public.organization_members m join public.organizations o on o.id=m.organization_id
  where m.profile_id=actor_id and m.organization_id=tenant_id and m.role='customer_admin' and m.is_active and o.status='active') then
  raise exception using errcode='42501',message='Not authorized';
 end if;
 if operation='submit' then
  if admin then raise exception using errcode='42501',message='Customer submission required'; end if;
  requested=payload->'preferences';msg=btrim(coalesce(payload->>'additional_notes',''));
  if not public.valid_agent_preferences(requested) or char_length(msg)>2000 then raise exception 'Invalid preferences'; end if;
  select * into existing from public.agent_change_requests where organization_id=tenant_id and idempotency_key=(payload->>'idempotency_key')::uuid;
  if found then
   if existing.requested_settings<>requested or existing.additional_notes<>msg or existing.base_version<>(payload->>'base_version')::integer then raise exception using errcode='P0001',message='conflict: idempotency key reused'; end if;
   return to_jsonb(existing);
  end if;
  select id into agent from public.agents where organization_id=tenant_id order by created_at,id limit 1;
  if agent is null then raise exception 'Agent not provisioned'; end if;
  insert into public.agent_preferences(organization_id,agent_id) values(tenant_id,agent) on conflict do nothing;
  select * into pref from public.agent_preferences where organization_id=tenant_id for update;
  -- Recheck after tenant lock to serialize same-token concurrent submissions.
  select * into existing from public.agent_change_requests where organization_id=tenant_id and idempotency_key=(payload->>'idempotency_key')::uuid;
  if found then
   if existing.requested_settings<>requested or existing.additional_notes<>msg or existing.base_version<>(payload->>'base_version')::integer then raise exception 'conflict: idempotency key reused'; end if;
   return to_jsonb(existing);
  end if;
  if (payload->>'base_version')::integer is distinct from pref.version then raise exception 'conflict: active preferences changed; refresh first'; end if;
  select coalesce(jsonb_agg(k order by k),'[]'::jsonb) into delta from jsonb_object_keys(requested) k where requested->k is distinct from pref.settings->k;
  if delta='[]' and msg='' then raise exception 'No changes submitted'; end if;
  if exists(select 1 from public.agent_change_requests where organization_id=tenant_id and status in ('pending','in_progress','needs_information') and requested_settings=requested and additional_notes=msg) then raise exception 'conflict: identical open request exists'; end if;
  insert into public.agent_change_requests(organization_id,agent_id,submitted_by,previous_settings,requested_settings,changed_fields,additional_notes,base_version,idempotency_key)
   values(tenant_id,agent,actor_id,pref.settings,requested,delta,msg,pref.version,(payload->>'idempotency_key')::uuid) returning * into req;
  next_status='pending';title='已收到 AI 專員調整要求';notify_admin=true;notify_customer=true;operation='submitted';
 else
  rid=(payload->>'id')::uuid;
  if admin then select organization_id into tenant_id from public.agent_change_requests where id=rid; end if;
  select * into pref from public.agent_preferences where organization_id=tenant_id for update;
  select * into req from public.agent_change_requests where id=rid and organization_id=tenant_id for update;
  if not found then raise exception using errcode='42501',message='Request unavailable'; end if;
  if (payload->>'expected_version')::integer is distinct from req.version then raise exception 'conflict: request changed; refresh first'; end if;
  msg=btrim(coalesce(payload->>'message',''));
  if char_length(msg)>2000 then raise exception 'Message too long'; end if;
  if operation='cancel' then
   if admin or req.status<>'pending' then raise exception 'Invalid cancellation'; end if;
   next_status='cancelled';title='調整要求已取消';notify_admin=true;
  elsif operation='provide_information' then
   if admin or req.status<>'needs_information' or msg='' then raise exception 'Additional information required'; end if;
   next_status='pending';title='商戶已補充調整資料';notify_admin=true;
  else
   if not admin then raise exception using errcode='42501',message='Admin required'; end if;
   if operation='add_note' then
    if msg='' then raise exception 'Note required'; end if;
    insert into public.agent_change_request_internal_notes(request_id,organization_id,actor_id,message) values(req.id,req.organization_id,actor_id,msg);
    return to_jsonb(req);
   elsif operation='start' and req.status='pending' then next_status='in_progress';title='Orai 正在處理你的調整要求';
   elsif operation='needs_information' and req.status='in_progress' and msg<>'' then next_status='needs_information';title='調整要求需要補充資料';
   elsif operation='reject' and req.status in ('pending','in_progress','needs_information') and msg<>'' then next_status='rejected';title='調整要求未能採納';
   elsif operation='complete' and req.status='in_progress' then
    if (payload->>'expected_active_version')::integer is distinct from pref.version then raise exception 'conflict: active settings changed since administrator review'; end if;
    if payload->'manual_update_confirmed' is distinct from 'true'::jsonb then raise exception 'Manual provider update and test confirmation required'; end if;
    if pref.version<>req.base_version and payload->'review_stale' is distinct from 'true'::jsonb then raise exception 'conflict: stale snapshot requires explicit administrator review'; end if;
    if not public.valid_agent_preferences(payload->'final_preferences') then raise exception 'Invalid final preferences'; end if;
    update public.agent_preferences set settings=payload->'final_preferences',version=version+1,updated_by=actor_id,updated_at=now() where organization_id=req.organization_id;
    next_status='completed';title='AI 專員調整已生效';
   else raise exception 'Invalid status transition or missing customer-visible reason'; end if;
   notify_customer=true;
  end if;
  update public.agent_change_requests set status=next_status,version=version+1,updated_at=now(),
   assigned_admin_id=case when admin then actor_id else assigned_admin_id end,
   customer_visible_response=case when admin then msg else customer_visible_response end,
   final_applied_settings=case when next_status='completed' then payload->'final_preferences' else final_applied_settings end,
   completed_at=case when next_status='completed' then now() else completed_at end
   where id=req.id returning * into req;
 end if;
 insert into public.agent_change_request_events(request_id,organization_id,actor_id,kind,message)
  values(req.id,req.organization_id,actor_id,operation,msg) returning id into event_id;
 if notify_admin then
  insert into public.notifications(recipient_id,request_id,organization_id,title,event_key)
  select id,req.id,req.organization_id,title,event_id::text from public.profiles where system_role='super_admin' on conflict do nothing;
 end if;
 if notify_customer then
  insert into public.notifications(recipient_id,request_id,organization_id,title,event_key)
  select m.profile_id,req.id,req.organization_id,title,event_id::text from public.organization_members m
   where m.organization_id=req.organization_id and m.is_active on conflict do nothing;
 end if;
 return to_jsonb(req);
end $$;
revoke all on function public.managed_agent_command(uuid,uuid,text,jsonb) from public,anon,authenticated;
grant execute on function public.managed_agent_command(uuid,uuid,text,jsonb) to service_role;

-- Keep legacy system instructions and provider IDs readable only by trusted code.
revoke select on public.agents from authenticated;
grant select(id,organization_id,name,voice_name,language_mode,status,created_at,updated_at) on public.agents to authenticated;
