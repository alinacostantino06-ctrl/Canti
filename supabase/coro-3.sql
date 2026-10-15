-- ============================================================================
-- Versione Coro, parte 3 — "Canta con noi"
--
-- Come usarlo: Supabase → SQL Editor → New query → incolla TUTTO → Run.
-- Va eseguito DOPO coro-2.sql. Si può eseguire anche più volte.
--
-- Aggiunge:
--   - i canti (con i loro file) mandati nei messaggi privati;
--   - le correzioni sugli spartiti anche per i canti condivisi nel gruppo e per
--     quelli mandati in privato (il PDF originale non viene mai toccato).
-- ============================================================================

-- ---------- Un canto dentro un messaggio privato ----------
alter table public.messaggi_privati add column if not exists canto jsonb;  -- { titolo, testo, allegati: [...] }
alter table public.messaggi_privati drop constraint if exists messaggi_privati_testo_check;
alter table public.messaggi_privati drop constraint if exists messaggio_o_canto;
alter table public.messaggi_privati add constraint messaggio_o_canto
  check (char_length(testo) <= 2000 and (char_length(testo) >= 1 or canto is not null));

-- I file dei canti mandati in privato stanno nello spazio di chi li manda
-- (allegati/<chi manda>/privati/<messaggio>/<file>): li può leggere anche chi li riceve.
drop policy if exists "file: leggo quelli mandati a me" on storage.objects;
create policy "file: leggo quelli mandati a me" on storage.objects for select to authenticated
  using (
    bucket_id = 'allegati'
    and (storage.foldername(name))[2] = 'privati'
    and exists (select 1 from public.messaggi_privati m
                 where m.id::text = (storage.foldername(name))[3]
                   and m.da::text = (storage.foldername(name))[1]
                   and m.a = (select auth.uid()))
  );

-- ---------- Correzioni sui canti condivisi e su quelli mandati in privato ----------
-- tipo 'condivisione': un canto della chat del gruppo (corregge chi l'ha condiviso o un direttore)
-- tipo 'privato':      un canto mandato in un messaggio privato (corregge una delle due persone)
create table if not exists public.correzioni_canti (
  tipo         text not null check (tipo in ('condivisione', 'privato')),
  rif          uuid not null,
  allegato_id  text not null,
  gruppo_id    uuid not null references public.gruppi (id) on delete cascade,
  segni        jsonb not null default '[]'::jsonb,
  aggiornato   timestamptz not null default now(),
  primary key (tipo, rif, allegato_id)
);
create index if not exists correzioni_canti_per_gruppo on public.correzioni_canti (gruppo_id);

create or replace function public.vedo_correzione(t text, r uuid, g uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select case t
    when 'condivisione' then exists (select 1 from public.condivisioni c
                                      where c.id = r and c.gruppo_id = g and public.sono_membro(g))
    when 'privato' then exists (select 1 from public.messaggi_privati m
                                 where m.id = r and m.gruppo_id = g
                                   and (m.da = auth.uid() or m.a = auth.uid()))
    else false end;
$$;

create or replace function public.posso_correggere(t text, r uuid, g uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select public.coro_attivo(g) and case t
    when 'condivisione' then exists (select 1 from public.condivisioni c
                                      where c.id = r and c.gruppo_id = g
                                        and (c.user_id = auth.uid() or public.sono_direttore(g)))
    when 'privato' then exists (select 1 from public.messaggi_privati m
                                 where m.id = r and m.gruppo_id = g
                                   and (m.da = auth.uid() or m.a = auth.uid()))
    else false end;
$$;

alter table public.correzioni_canti enable row level security;
drop policy if exists "leggo le correzioni che posso vedere" on public.correzioni_canti;
drop policy if exists "correggo dove posso" on public.correzioni_canti;
create policy "leggo le correzioni che posso vedere" on public.correzioni_canti for select to authenticated
  using (public.vedo_correzione(tipo, rif, gruppo_id));
create policy "correggo dove posso" on public.correzioni_canti for all to authenticated
  using (public.posso_correggere(tipo, rif, gruppo_id))
  with check (public.posso_correggere(tipo, rif, gruppo_id));

drop trigger if exists tocca_aggiornato on public.correzioni_canti;
create trigger tocca_aggiornato before update on public.correzioni_canti for each row execute function public.tocca_aggiornato();

-- Quando un canto condiviso o un messaggio privato viene tolto, vanno via anche le sue correzioni
create or replace function public.togli_correzioni_canto()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  delete from public.correzioni_canti
   where rif = old.id and tipo = case when tg_table_name = 'condivisioni' then 'condivisione' else 'privato' end;
  return old;
end;
$$;
drop trigger if exists togli_correzioni on public.condivisioni;
drop trigger if exists togli_correzioni on public.messaggi_privati;
create trigger togli_correzioni after delete on public.condivisioni for each row execute function public.togli_correzioni_canto();
create trigger togli_correzioni after delete on public.messaggi_privati for each row execute function public.togli_correzioni_canto();

-- "In diretta"
do $$
begin
  if not exists (select 1 from pg_publication_tables
                 where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'correzioni_canti') then
    alter publication supabase_realtime add table public.correzioni_canti;
  end if;
end;
$$;
