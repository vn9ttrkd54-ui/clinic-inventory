begin;
create schema if not exists clinic_private;
revoke all on schema clinic_private from public, anon;
grant usage on schema clinic_private to authenticated;

create table if not exists clinic_private.settings (
  id boolean primary key default true check (id),
  api_secret_hash text not null check (length(api_secret_hash)=64)
);
create table if not exists clinic_private.staff (
  email text primary key check (email=lower(btrim(email)) and length(email)<=254),
  role text not null check (role in ('admin','staff')),
  active boolean not null default true,
  updated_at timestamptz not null default now()
);
create table if not exists clinic_private.documents (
  workspace text primary key check (workspace in ('clinic','demo')),
  version bigint not null default 0,
  snapshot jsonb not null check (jsonb_typeof(snapshot)='object'),
  updated_at timestamptz not null default now()
);
create table if not exists clinic_private.audit (
  id bigint generated always as identity primary key,
  actor_id uuid not null,
  actor_email text not null,
  workspace text not null,
  action text not null,
  created_at timestamptz not null default now()
);
alter table clinic_private.settings enable row level security;
alter table clinic_private.staff enable row level security;
alter table clinic_private.documents enable row level security;
alter table clinic_private.audit enable row level security;
revoke all on all tables in schema clinic_private from public,anon,authenticated;
revoke all on all sequences in schema clinic_private from public,anon,authenticated;

create or replace function clinic_private.authorize(p_secret text,p_admin boolean default false)
returns jsonb language plpgsql security definer set search_path='' as $$
declare v_id uuid:=auth.uid(); v_email text; v_role text; v_session text;
begin
  if v_id is null or p_secret is null or length(p_secret)<32 or
     not exists(select 1 from clinic_private.settings where id and api_secret_hash=encode(sha256(convert_to(p_secret,'UTF8')),'hex')) then
    raise exception using errcode='42501',message='Staff access required.';
  end if;
  select lower(email) into v_email from auth.users
    where id=v_id and email_confirmed_at is not null and deleted_at is null and not coalesce(is_anonymous,false);
  select role into v_role from clinic_private.staff where email=v_email and active;
  v_session:=auth.jwt()->>'session_id';
  if v_role is null or not exists(select 1 from auth.sessions where id::text=v_session and user_id=v_id and (not_after is null or not_after>now())) then
    raise exception using errcode='42501',message='This account does not have clinic access.';
  end if;
  if p_admin and v_role<>'admin' then
    raise exception using errcode='42501',message='Administrator access required.';
  end if;
  return jsonb_build_object('email',v_email,'role',v_role,'id',v_id);
end $$;

create or replace function clinic_private.read_inventory(p_secret text,p_workspace text)
returns jsonb language plpgsql security definer set search_path='' as $$
declare v_actor jsonb; v_result jsonb;
begin
  v_actor:=clinic_private.authorize(p_secret);
  select jsonb_build_object('version',version,'snapshot',snapshot,'email',v_actor->>'email','role',v_actor->>'role')
    into v_result from clinic_private.documents where workspace=p_workspace;
  if v_result is null then raise exception using errcode='22023',message='Workspace not found.'; end if;
  return v_result;
end $$;

create or replace function clinic_private.write_inventory(p_secret text,p_workspace text,p_version bigint,p_snapshot jsonb,p_action text)
returns boolean language plpgsql security definer set search_path='' as $$
declare v_actor jsonb; v_version bigint; v_table text;
begin
  v_actor:=clinic_private.authorize(p_secret);
  if p_snapshot->>'format' is distinct from '1' or jsonb_typeof(p_snapshot->'tables') is distinct from 'object' or octet_length(p_snapshot::text)>15000000 then
    raise exception using errcode='22023',message='Invalid inventory format.';
  end if;
  foreach v_table in array array['items','patients','usage','estimates','deliveries','suppliers','activity'] loop
    if jsonb_typeof(p_snapshot->'tables'->v_table) is distinct from 'array' then
      raise exception using errcode='22023',message='Invalid inventory tables.';
    end if;
  end loop;
  select version into v_version from clinic_private.documents where workspace=p_workspace for update;
  if v_version is null then raise exception using errcode='22023',message='Workspace not found.'; end if;
  if v_version<>p_version then return false; end if;
  update clinic_private.documents set snapshot=p_snapshot,version=version+1,updated_at=now() where workspace=p_workspace;
  insert into clinic_private.audit(actor_id,actor_email,workspace,action)
    values((v_actor->>'id')::uuid,v_actor->>'email',p_workspace,left(p_action,160));
  return true;
end $$;

create or replace function clinic_private.list_staff(p_secret text)
returns jsonb language plpgsql security definer set search_path='' as $$
begin
  perform clinic_private.authorize(p_secret,true);
  return (select coalesce(jsonb_agg(jsonb_build_object('email',email,'role',role,'active',active) order by email),'[]'::jsonb) from clinic_private.staff);
end $$;

create or replace function clinic_private.set_staff(p_secret text,p_email text,p_role text,p_active boolean)
returns jsonb language plpgsql security definer set search_path='' as $$
declare v_actor jsonb; v_email text:=lower(btrim(p_email));
begin
  v_actor:=clinic_private.authorize(p_secret,true);
  if v_email is null or length(v_email)>254 or v_email !~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$' or p_role is null or p_role not in ('admin','staff') or p_active is null then
    raise exception using errcode='22023',message='Enter a valid email address and staff role.';
  end if;
  lock table clinic_private.staff in share row exclusive mode;
  if exists(select 1 from clinic_private.staff where email=v_email and active and role='admin')
    and (not p_active or p_role<>'admin') and (select count(*) from clinic_private.staff where active and role='admin')<=1 then
    raise exception using errcode='22023',message='Keep at least one active administrator.';
  end if;
  insert into clinic_private.staff(email,role,active) values(v_email,p_role,p_active)
    on conflict(email) do update set role=excluded.role,active=excluded.active,updated_at=now();
  insert into clinic_private.audit(actor_id,actor_email,workspace,action)
    values((v_actor->>'id')::uuid,v_actor->>'email','clinic','Staff access updated: '||v_email);
  return jsonb_build_object('ok',true);
end $$;

create or replace function public.ci_read(p_secret text,p_workspace text)
returns jsonb language sql security invoker set search_path='' as $$ select clinic_private.read_inventory(p_secret,p_workspace); $$;
create or replace function public.ci_write(p_secret text,p_workspace text,p_version bigint,p_snapshot jsonb,p_action text)
returns boolean language sql security invoker set search_path='' as $$ select clinic_private.write_inventory(p_secret,p_workspace,p_version,p_snapshot,p_action); $$;
create or replace function public.ci_staff_list(p_secret text)
returns jsonb language sql security invoker set search_path='' as $$ select clinic_private.list_staff(p_secret); $$;
create or replace function public.ci_staff_set(p_secret text,p_email text,p_role text,p_active boolean)
returns jsonb language sql security invoker set search_path='' as $$ select clinic_private.set_staff(p_secret,p_email,p_role,p_active); $$;

revoke all on all functions in schema clinic_private from public,anon,authenticated;
grant execute on function clinic_private.read_inventory(text,text),clinic_private.write_inventory(text,text,bigint,jsonb,text),clinic_private.list_staff(text),clinic_private.set_staff(text,text,text,boolean) to authenticated;
revoke all on function public.ci_read(text,text),public.ci_write(text,text,bigint,jsonb,text),public.ci_staff_list(text),public.ci_staff_set(text,text,text,boolean) from public,anon;
grant execute on function public.ci_read(text,text),public.ci_write(text,text,bigint,jsonb,text),public.ci_staff_list(text),public.ci_staff_set(text,text,text,boolean) to authenticated;
-- Trusted server-only account provisioning. End-user roles cannot execute this function.
create or replace function clinic_private.service_target(p_secret text,p_email text)
returns jsonb language plpgsql security definer set search_path='' as $$
declare v_target jsonb;
begin
  if auth.uid() is not null or auth.jwt()->>'role' is distinct from 'service_role' or p_secret is null or length(p_secret)<32 or
     not exists(select 1 from clinic_private.settings where id and api_secret_hash=encode(sha256(convert_to(p_secret,'UTF8')),'hex')) then
    raise exception using errcode='42501',message='Access denied.';
  end if;
  select jsonb_build_object('email',email) into v_target from clinic_private.staff where email=lower(btrim(p_email)) and active;
  if v_target is null then raise exception using errcode='42501',message='Access denied.'; end if;
  return v_target;
end $$;
create or replace function public.ci_service_target(p_secret text,p_email text)
returns jsonb language sql security invoker set search_path='' as $$ select clinic_private.service_target(p_secret,p_email); $$;
revoke all on function clinic_private.service_target(text,text),public.ci_service_target(text,text) from public,anon,authenticated;
grant usage on schema clinic_private to service_role;
grant execute on function clinic_private.service_target(text,text),public.ci_service_target(text,text) to service_role;
commit;
