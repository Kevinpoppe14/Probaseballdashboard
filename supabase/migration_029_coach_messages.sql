-- Coach messages: a short note a coach sends an athlete from Coach Mode ("Add 10 lb to your bench today"), shown at
-- the top of the athlete's app until they tap Got it.
--   coach_messages   one row per message: who it's for, the text, who sent it, when, and when the athlete saw it
-- Signed-in staff read and write the table (Coach Mode); the athlete's phone reaches their own messages only through
-- the two token-checked functions below.
-- Run once in the SQL Editor. Safe to run more than once.

create table if not exists coach_messages (
  id text primary key,
  athlete_id text not null,
  body text not null,
  sender text not null default '',
  created_at timestamptz not null default now(),
  seen_at timestamptz
);
create index if not exists coach_messages_athlete on coach_messages (athlete_id, created_at desc);

alter table coach_messages enable row level security;
drop policy if exists "authenticated read coach_messages" on coach_messages;
drop policy if exists "authenticated write coach_messages" on coach_messages;
drop policy if exists "authenticated update coach_messages" on coach_messages;
drop policy if exists "authenticated delete coach_messages" on coach_messages;
create policy "authenticated read coach_messages" on coach_messages for select using (auth.role() = 'authenticated');
create policy "authenticated write coach_messages" on coach_messages for insert with check (auth.role() = 'authenticated');
create policy "authenticated update coach_messages" on coach_messages for update using (auth.role() = 'authenticated');
create policy "authenticated delete coach_messages" on coach_messages for delete using (auth.role() = 'authenticated');

-- the athlete's messages from the last 30 days that they haven't marked seen, newest first
create or replace function athlete_portal_messages(p_token text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_id text;
begin
  if p_token is null or length(p_token) < 32 then return null; end if;
  select athlete_id into v_id from athlete_links where token = p_token;
  if v_id is null then return null; end if;
  return coalesce((
    select jsonb_agg(jsonb_build_object('id', m.id, 'body', m.body, 'sender', m.sender, 'at', m.created_at) order by m.created_at desc)
    from coach_messages m
    where m.athlete_id = v_id and m.seen_at is null and m.created_at > now() - interval '30 days'
  ), '[]'::jsonb);
end $$;

-- the athlete taps Got it: that message (theirs only) is marked seen
create or replace function athlete_portal_message_seen(p_token text, p_id text)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  v_id text;
begin
  if p_token is null or length(p_token) < 32 then return false; end if;
  select athlete_id into v_id from athlete_links where token = p_token;
  if v_id is null then return false; end if;
  update coach_messages set seen_at = now() where id = p_id and athlete_id = v_id and seen_at is null;
  return found;
end $$;

revoke all on function athlete_portal_messages(text) from public;
revoke all on function athlete_portal_message_seen(text, text) from public;
grant execute on function athlete_portal_messages(text) to anon, authenticated;
grant execute on function athlete_portal_message_seen(text, text) to anon, authenticated;
