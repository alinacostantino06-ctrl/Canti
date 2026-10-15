-- ============================================================================
-- Versione Coro, parte 2 — "Canta con noi"
--
-- Come usarlo: Supabase → SQL Editor → New query → incolla TUTTO → Run.
-- Va eseguito DOPO gli altri file (configurazione, gruppi, play-store, coro, notifiche).
-- Si può eseguire anche più volte: non rovina niente.
--
-- Aggiunge, solo per i gruppi con la versione Coro attiva:
--   - i messaggi privati tra le persone del coro;
--   - le correzioni del direttore sugli spartiti (disegnate sopra il PDF: il file
--     originale non viene mai toccato);
--   - (i file per voce non hanno bisogno di niente qui: la voce di ogni file è
--     scritta nella colonna "allegati" del libretto).
-- ============================================================================

-- ---------- Messaggi privati ----------
create table if not exists public.messaggi_privati (
  id         uuid primary key default gen_random_uuid(),
  gruppo_id  uuid not null references public.gruppi (id) on delete cascade,
  da         uuid not null default auth.uid() references auth.users (id) on delete cascade,
  a          uuid not null references auth.users (id) on delete cascade,
  testo      text not null check (char_length(testo) between 1 and 2000),
  creato     timestamptz not null default now(),
  letto      timestamptz
);
create index if not exists messaggi_per_destinatario on public.messaggi_privati (a, letto);
create index if not exists messaggi_per_gruppo on public.messaggi_privati (gruppo_id, creato);

alter table public.messaggi_privati enable row level security;
drop policy if exists "leggo i miei messaggi" on public.messaggi_privati;
drop policy if exists "scrivo a chi è nel mio coro" on public.messaggi_privati;
drop policy if exists "tolgo i messaggi che ho scritto" on public.messaggi_privati;
create policy "leggo i miei messaggi" on public.messaggi_privati for select to authenticated
  using (da = (select auth.uid()) or a = (select auth.uid()));
create policy "scrivo a chi è nel mio coro" on public.messaggi_privati for insert to authenticated
  with check (
    da = (select auth.uid()) and a <> da
    and public.sono_membro(gruppo_id) and public.coro_attivo(gruppo_id)
    and exists (select 1 from public.membri m where m.gruppo_id = messaggi_privati.gruppo_id and m.user_id = messaggi_privati.a)
  );
create policy "tolgo i messaggi che ho scritto" on public.messaggi_privati for delete to authenticated
  using (da = (select auth.uid()));

-- Segna come letti i messaggi che una persona mi ha mandato in un gruppo
create or replace function public.segna_letti(gruppo uuid, persona uuid)
returns void language sql security definer set search_path = public as $$
  update public.messaggi_privati set letto = now()
   where gruppo_id = gruppo and da = persona and a = auth.uid() and letto is null;
$$;
revoke execute on function public.segna_letti(uuid, uuid) from anon;

-- ---------- Correzioni del direttore sugli spartiti del libretto ----------
-- Una riga per ogni PDF/foto di un canto del libretto: "segni" sono i tratti di penna
-- e le scritte, con le posizioni in proporzione alla pagina (da 0 a 1).
create table if not exists public.correzioni (
  libretto_id  uuid not null references public.libretto (id) on delete cascade,
  allegato_id  text not null,
  gruppo_id    uuid not null references public.gruppi (id) on delete cascade,
  segni        jsonb not null default '[]'::jsonb,
  aggiornato   timestamptz not null default now(),
  primary key (libretto_id, allegato_id)
);
create index if not exists correzioni_per_gruppo on public.correzioni (gruppo_id);

alter table public.correzioni enable row level security;
drop policy if exists "leggo le correzioni dei miei gruppi" on public.correzioni;
drop policy if exists "il direttore corregge gli spartiti" on public.correzioni;
create policy "leggo le correzioni dei miei gruppi" on public.correzioni for select to authenticated
  using (public.sono_membro(gruppo_id));
create policy "il direttore corregge gli spartiti" on public.correzioni for all to authenticated
  using (public.sono_direttore(gruppo_id) and public.coro_attivo(gruppo_id))
  with check (public.sono_direttore(gruppo_id) and public.coro_attivo(gruppo_id)
              and exists (select 1 from public.libretto l where l.id = libretto_id and l.gruppo_id = correzioni.gruppo_id));

drop trigger if exists tocca_aggiornato on public.correzioni;
create trigger tocca_aggiornato before update on public.correzioni for each row execute function public.tocca_aggiornato();

-- ---------- "In diretta": messaggi e correzioni arrivano subito ----------
do $$
begin
  if not exists (select 1 from pg_publication_tables
                 where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'messaggi_privati') then
    alter publication supabase_realtime add table public.messaggi_privati;
  end if;
  if not exists (select 1 from pg_publication_tables
                 where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'correzioni') then
    alter publication supabase_realtime add table public.correzioni;
  end if;
end;
$$;
