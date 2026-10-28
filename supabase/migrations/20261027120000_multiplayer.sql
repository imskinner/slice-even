-- Multiplayer rooms for Slice Even.
--
-- Clients never write tables directly. They read through RLS (members of a
-- room see that room) and change state through the security-definer RPCs
-- below. Cuts are only written by the submit-cut Edge Function, which scores
-- them with the same core code as the client.

create table public.rooms (
  id uuid primary key default gen_random_uuid(),
  code text not null unique,
  host_id uuid not null references auth.users (id) on delete cascade,
  status text not null default 'lobby' check (status in ('lobby', 'playing', 'finished')),
  total_rounds int not null default 5 check (total_rounds between 1 and 20),
  round_seconds int not null default 45 check (round_seconds between 10 and 300),
  current_round int not null default 0,
  created_at timestamptz not null default now()
);

create table public.room_players (
  room_id uuid not null references public.rooms (id) on delete cascade,
  user_id uuid not null references auth.users (id) on delete cascade,
  name text not null check (char_length(name) between 1 and 24),
  wins int not null default 0,
  -- Round number of this player's latest cut, so others see who is done
  -- without seeing the cut itself before the round is scored.
  last_cut_round int not null default 0,
  joined_at timestamptz not null default now(),
  primary key (room_id, user_id)
);
create index room_players_user_id_idx on public.room_players (user_id);

create table public.rounds (
  id uuid primary key default gen_random_uuid(),
  room_id uuid not null references public.rooms (id) on delete cascade,
  number int not null,
  kind text not null check (kind in ('apple', 'cucumber', 'bread')),
  -- Each player's object comes from playerSeed(seed, user_id) in core.
  seed text not null,
  status text not null default 'cutting' check (status in ('cutting', 'scored')),
  started_at timestamptz not null default now(),
  deadline timestamptz not null,
  winner_id uuid references auth.users (id) on delete set null,
  unique (room_id, number)
);

create table public.cuts (
  round_id uuid not null references public.rounds (id) on delete cascade,
  -- Denormalized so Realtime can filter by room.
  room_id uuid not null references public.rooms (id) on delete cascade,
  user_id uuid not null references auth.users (id) on delete cascade,
  plane jsonb not null,
  mass_front double precision not null,
  mass_back double precision not null,
  -- |front - back| / total; lower is better.
  error double precision not null,
  submitted_at timestamptz not null default now(),
  primary key (round_id, user_id)
);
create index cuts_room_id_idx on public.cuts (room_id);
create index cuts_user_id_idx on public.cuts (user_id);
create index rounds_winner_id_idx on public.rounds (winner_id);
create index rooms_host_id_idx on public.rooms (host_id);

-- ---------------------------------------------------------------- access

-- Security definer so policies on room_players can use it without recursing.
create function public.is_room_member(p_room uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.room_players
    where room_id = p_room and user_id = (select auth.uid())
  );
$$;

alter table public.rooms enable row level security;
alter table public.room_players enable row level security;
alter table public.rounds enable row level security;
alter table public.cuts enable row level security;

create policy "members read their room" on public.rooms
  for select to authenticated using ((select public.is_room_member(id)));

create policy "members read players" on public.room_players
  for select to authenticated using ((select public.is_room_member(room_id)));

create policy "members read rounds" on public.rounds
  for select to authenticated using ((select public.is_room_member(room_id)));

-- Your own cut right away; everyone's once the round is scored.
create policy "members read cuts" on public.cuts
  for select to authenticated using (
    user_id = (select auth.uid())
    or (
      (select public.is_room_member(room_id))
      and exists (select 1 from public.rounds r where r.id = round_id and r.status = 'scored')
    )
  );

-- ---------------------------------------------------------------- RPCs

create function public.create_room(p_name text, p_total_rounds int default 5)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user uuid := auth.uid();
  v_room uuid;
  v_code text;
  -- No 0/O, 1/I/L: codes are read aloud.
  v_alphabet text := 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
begin
  if v_user is null then
    raise exception 'not signed in';
  end if;

  loop
    select string_agg(substr(v_alphabet, 1 + floor(random() * length(v_alphabet))::int, 1), '')
      into v_code
      from generate_series(1, 5);
    exit when not exists (select 1 from public.rooms where code = v_code);
  end loop;

  insert into public.rooms (code, host_id, total_rounds)
    values (v_code, v_user, p_total_rounds)
    returning id into v_room;
  insert into public.room_players (room_id, user_id, name)
    values (v_room, v_user, btrim(p_name));
  return v_room;
end;
$$;

create function public.join_room(p_code text, p_name text)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user uuid := auth.uid();
  v_room public.rooms;
begin
  if v_user is null then
    raise exception 'not signed in';
  end if;

  select * into v_room from public.rooms where code = upper(btrim(p_code));
  if not found then
    raise exception 'room not found';
  end if;

  if exists (select 1 from public.room_players where room_id = v_room.id and user_id = v_user) then
    update public.room_players set name = btrim(p_name)
      where room_id = v_room.id and user_id = v_user;
    return v_room.id;
  end if;

  if v_room.status <> 'lobby' then
    raise exception 'game already started';
  end if;
  if (select count(*) from public.room_players where room_id = v_room.id) >= 8 then
    raise exception 'room is full';
  end if;

  insert into public.room_players (room_id, user_id, name) values (v_room.id, v_user, btrim(p_name));
  return v_room.id;
end;
$$;

create function public.start_round(p_room uuid)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_room public.rooms;
  v_round uuid;
begin
  select * into v_room from public.rooms where id = p_room for update;
  if not found or v_room.host_id <> auth.uid() then
    raise exception 'only the host can start a round';
  end if;
  if v_room.status = 'finished' or v_room.current_round >= v_room.total_rounds then
    raise exception 'game is over';
  end if;
  if exists (select 1 from public.rounds where room_id = p_room and status = 'cutting') then
    raise exception 'current round is still running';
  end if;

  insert into public.rounds (room_id, number, kind, seed, deadline)
    values (
      p_room,
      v_room.current_round + 1,
      (array['apple', 'cucumber', 'bread'])[1 + floor(random() * 3)::int],
      replace(gen_random_uuid()::text, '-', ''),
      -- A little slack for network latency on the last cut.
      now() + make_interval(secs => v_room.round_seconds + 2)
    )
    returning id into v_round;

  update public.rooms set status = 'playing', current_round = current_round + 1 where id = p_room;
  return v_round;
end;
$$;

-- Ranks a round. Internal: callable by the Edge Function (service role) and
-- through finalize_round, which checks the caller.
create function public._finalize_round(p_round uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_round public.rounds;
  v_winner uuid;
begin
  select * into v_round from public.rounds where id = p_round for update;
  if not found or v_round.status = 'scored' then
    return;
  end if;

  select user_id into v_winner from public.cuts
    where round_id = p_round
    order by error asc, submitted_at asc
    limit 1;

  update public.rounds set status = 'scored', winner_id = v_winner where id = p_round;
  if v_winner is not null then
    update public.room_players set wins = wins + 1
      where room_id = v_round.room_id and user_id = v_winner;
  end if;
  update public.rooms set status = 'finished'
    where id = v_round.room_id and current_round >= total_rounds;
end;
$$;

revoke execute on function public._finalize_round(uuid) from public, anon, authenticated;

-- Any member may close a round once everyone cut or time ran out.
create function public.finalize_round(p_round uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_round public.rounds;
begin
  select * into v_round from public.rounds where id = p_round;
  if not found or not public.is_room_member(v_round.room_id) then
    raise exception 'not a member of this room';
  end if;
  if v_round.status = 'scored' then
    return;
  end if;
  if now() < v_round.deadline
    and (select count(*) from public.cuts where round_id = p_round)
      < (select count(*) from public.room_players where room_id = v_round.room_id) then
    raise exception 'round still running';
  end if;
  perform public._finalize_round(p_round);
end;
$$;

revoke execute on function public.create_room(text, int) from public, anon;
revoke execute on function public.join_room(text, text) from public, anon;
revoke execute on function public.start_round(uuid) from public, anon;
revoke execute on function public.finalize_round(uuid) from public, anon;
revoke execute on function public.is_room_member(uuid) from public, anon;
grant execute on function public.create_room(text, int) to authenticated;
grant execute on function public.join_room(text, text) to authenticated;
grant execute on function public.start_round(uuid) to authenticated;
grant execute on function public.finalize_round(uuid) to authenticated;
grant execute on function public.is_room_member(uuid) to authenticated;

-- ---------------------------------------------------------------- realtime

alter publication supabase_realtime add table public.rooms, public.room_players, public.rounds, public.cuts;
