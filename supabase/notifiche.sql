-- ============================================================================
-- Notifiche sul telefono per "Canta con noi".
--
-- Come usarlo: Supabase → SQL Editor → New query → incolla TUTTO → Run.
-- Va eseguito DOPO gli altri file (configurazione, gruppi, play-store, coro).
--
-- Crea la tabella in cui ogni dispositivo che ha attivato le notifiche lascia il suo
-- "indirizzo" per riceverle. Le notifiche le manda la Edge Function "notifica"
-- (supabase/functions/notifica/index.ts).
-- ============================================================================

create table if not exists public.iscrizioni_notifiche (
  endpoint  text primary key,                 -- indirizzo del dispositivo (dato dal browser)
  user_id   uuid not null default auth.uid() references auth.users (id) on delete cascade,
  p256dh    text not null,
  auth      text not null,
  creato    timestamptz not null default now()
);
create index if not exists iscrizioni_per_persona on public.iscrizioni_notifiche (user_id);

alter table public.iscrizioni_notifiche enable row level security;
drop policy if exists "gestisco le mie iscrizioni" on public.iscrizioni_notifiche;
create policy "gestisco le mie iscrizioni" on public.iscrizioni_notifiche for all to authenticated
  using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));

-- La bacheca si aggiorna "in diretta" quando il direttore scrive
do $$
begin
  if not exists (select 1 from pg_publication_tables
                 where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'avvisi') then
    alter publication supabase_realtime add table public.avvisi;
  end if;
end;
$$;
