-- ============================================================================
-- Configurazione dell'account online per l'app "Canta con noi".
--
-- Come usarlo: nel sito di Supabase apri il progetto → "SQL Editor" →
-- "New query", incolla TUTTO questo file e premi "Run". Basta farlo una volta.
-- (Se lo esegui di nuovo non succede niente di male.)
--
-- Crea:
--   - tre tabelle: cartelle, canti, allegati (audio e PDF)
--   - lo spazio "allegati" per i file
--   - le regole di sicurezza: ognuno vede e modifica SOLO i propri canti
-- ============================================================================

-- ---------- Tabelle ----------
-- "modificato": data e ora (in millisecondi) dell'ultima modifica, decisa dall'app.
--   Se lo stesso canto è cambiato su due dispositivi, vince il "modificato" più recente.
-- "aggiornato": quando la riga è arrivata qui; serve ai dispositivi per scaricare solo le novità.
-- "cancellato": la cosa è stata cancellata per sempre (dal cestino). La riga resta,
--   vuota, così anche gli altri dispositivi lo scoprono e la cancellano da sé.

create table if not exists public.cartelle (
  id          uuid primary key,
  user_id     uuid not null default auth.uid() references auth.users (id) on delete cascade,
  nome        text not null,
  sezione     text not null,
  eliminato   bigint,
  cancellato  boolean not null default false,
  modificato  bigint not null,
  aggiornato  timestamptz not null default clock_timestamp()
);

create table if not exists public.canti (
  id            uuid primary key,
  user_id       uuid not null default auth.uid() references auth.users (id) on delete cascade,
  titolo        text not null,
  sezione       text not null,
  cartella      uuid,
  testo         text not null default '',
  creato        bigint,
  eliminato     bigint,
  eliminato_con uuid,
  cancellato    boolean not null default false,
  modificato    bigint not null,
  aggiornato    timestamptz not null default clock_timestamp()
);

create table if not exists public.allegati (
  id          uuid primary key,
  user_id     uuid not null default auth.uid() references auth.users (id) on delete cascade,
  canto_id    uuid not null,
  nome        text not null,
  tipo        text not null,
  mime        text,
  eliminato   bigint,
  cancellato  boolean not null default false,
  modificato  bigint not null,
  aggiornato  timestamptz not null default clock_timestamp()
);

-- (se le tabelle esistevano già da una versione precedente di questo file)
alter table public.cartelle add column if not exists cancellato boolean not null default false;
alter table public.canti    add column if not exists cancellato boolean not null default false;
alter table public.allegati add column if not exists cancellato boolean not null default false;

create index if not exists cartelle_novita on public.cartelle (user_id, aggiornato);
create index if not exists canti_novita    on public.canti    (user_id, aggiornato);
create index if not exists allegati_novita on public.allegati (user_id, aggiornato);

-- Ogni volta che una riga viene scritta, "aggiornato" diventa l'ora attuale.
-- Se arriva una versione PIÙ VECCHIA di quella già salvata (es. da un telefono
-- rimasto a lungo senza internet), viene ignorata: vince la modifica più recente.
create or replace function public.segna_aggiornato()
returns trigger language plpgsql as $$
begin
  if tg_op = 'UPDATE' and new.modificato < old.modificato then
    return null; -- non cambio niente
  end if;
  new.aggiornato := clock_timestamp();
  return new;
end;
$$;

drop trigger if exists segna_aggiornato on public.cartelle;
drop trigger if exists segna_aggiornato on public.canti;
drop trigger if exists segna_aggiornato on public.allegati;
create trigger segna_aggiornato before insert or update on public.cartelle
  for each row execute function public.segna_aggiornato();
create trigger segna_aggiornato before insert or update on public.canti
  for each row execute function public.segna_aggiornato();
create trigger segna_aggiornato before insert or update on public.allegati
  for each row execute function public.segna_aggiornato();

-- ---------- Regole di sicurezza: ognuno solo i propri dati ----------
alter table public.cartelle enable row level security;
alter table public.canti    enable row level security;
alter table public.allegati enable row level security;

drop policy if exists "solo i miei" on public.cartelle;
drop policy if exists "solo i miei" on public.canti;
drop policy if exists "solo i miei" on public.allegati;
create policy "solo i miei" on public.cartelle for all to authenticated
  using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id);
create policy "solo i miei" on public.canti for all to authenticated
  using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id);
create policy "solo i miei" on public.allegati for all to authenticated
  using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id);

-- ---------- Spazio per i file (audio e PDF) ----------
-- Ogni file sta in una cartella col codice della persona: <id persona>/<id file>
insert into storage.buckets (id, name, public, file_size_limit)
values ('allegati', 'allegati', false, 52428800)  -- massimo 50 MB per file
on conflict (id) do nothing;

drop policy if exists "file: leggo i miei"    on storage.objects;
drop policy if exists "file: carico i miei"   on storage.objects;
drop policy if exists "file: cambio i miei"   on storage.objects;
drop policy if exists "file: cancello i miei" on storage.objects;

create policy "file: leggo i miei" on storage.objects for select to authenticated
  using (bucket_id = 'allegati' and (storage.foldername(name))[1] = (select auth.uid())::text);
create policy "file: carico i miei" on storage.objects for insert to authenticated
  with check (bucket_id = 'allegati' and (storage.foldername(name))[1] = (select auth.uid())::text);
create policy "file: cambio i miei" on storage.objects for update to authenticated
  using (bucket_id = 'allegati' and (storage.foldername(name))[1] = (select auth.uid())::text);
create policy "file: cancello i miei" on storage.objects for delete to authenticated
  using (bucket_id = 'allegati' and (storage.foldername(name))[1] = (select auth.uid())::text);
