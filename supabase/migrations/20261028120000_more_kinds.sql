-- Five new kinds: orange, tomato, banana, carrot, cake.
-- Deploy together with the submit-cut function and the web client that know
-- them; an older client cannot generate a kind it does not have.

alter table public.rounds drop constraint rounds_kind_check;
alter table public.rounds add constraint rounds_kind_check
  check (kind in ('apple', 'cucumber', 'bread', 'orange', 'tomato', 'banana', 'carrot', 'cake'));

create or replace function public.start_round(p_room uuid)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_room public.rooms;
  v_round uuid;
  v_kinds text[] := array['apple', 'cucumber', 'bread', 'orange', 'tomato', 'banana', 'carrot', 'cake'];
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
      v_kinds[1 + floor(random() * array_length(v_kinds, 1))::int],
      replace(gen_random_uuid()::text, '-', ''),
      -- A little slack for network latency on the last cut.
      now() + make_interval(secs => v_room.round_seconds + 2)
    )
    returning id into v_round;

  update public.rooms set status = 'playing', current_round = current_round + 1 where id = p_room;
  return v_round;
end;
$$;
