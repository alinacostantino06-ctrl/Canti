-- ============================================================================
-- Versione Coro di "Canta con noi".
--
-- Come usarlo: Supabase → SQL Editor → New query → incolla TUTTO → Run.
-- Va eseguito DOPO configurazione.sql, gruppi.sql e play-store.sql. Basta una volta.
--
-- COME ATTIVI IL CORO A UNA PARROCCHIA CHE HA PAGATO:
--   Table Editor → gruppi → trova il gruppo (colonna "nome" / "codice")
--   → nella colonna "coro_fino_al" scrivi la data di scadenza, es. 2026-12-31
--   → Save. Fino a quella data il gruppo ha tutte le funzioni Coro.
--   Per il mese dopo, sposti in avanti la data.
--
-- Regole:
--   - ognuno può stare gratis in al massimo 2 gruppi NORMALI;
--     i gruppi Coro attivi non contano;
--   - chi crea un gruppo può provare la versione Coro gratis per 7 giorni
--     (una sola prova per persona);
--   - funzioni Coro: libretto condiviso, scalette, ruoli (direttore/corista),
--     voci, avvisi del direttore.
-- ============================================================================

-- ---------- Colonne nuove ----------
alter table public.gruppi add column if not exists coro_fino_al timestamptz;          -- la scrivi tu
alter table public.gruppi add column if not exists prova_usata boolean not null default false;
alter table public.membri add column if not exists ruolo text not null default 'corista';
alter table public.membri add column if not exists voce  text not null default '';

-- chi ha creato un gruppo ne è il direttore
update public.membri m set ruolo = 'direttore'
  from public.gruppi g where g.id = m.gruppo_id and g.creato_da = m.user_id and m.ruolo <> 'direttore';

-- ---------- Funzioni di controllo ----------
create or replace function public.coro_attivo(g uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.gruppi where id = g and coro_fino_al > now());
$$;

create or replace function public.sono_direttore(g uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.membri where gruppo_id = g and user_id = auth.uid() and ruolo = 'direttore')
      or exists (select 1 from public.gruppi where id = g and creato_da = auth.uid());
$$;

-- In quanti gruppi NORMALI (non Coro attivi) sono
create or replace function public.miei_gruppi_gratis()
returns integer language sql stable security definer set search_path = public as $$
  select count(*)::int from public.membri m join public.gruppi g on g.id = m.gruppo_id
   where m.user_id = auth.uid() and not coalesce(g.coro_fino_al > now(), false);
$$;

-- Ho già usato la prova gratuita?
create or replace function public.prova_gia_usata()
returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.gruppi where creato_da = auth.uid() and prova_usata);
$$;

-- Codice nuovo di 6 caratteri (senza 0/O e 1/I)
create or replace function public.genera_codice()
returns text language plpgsql volatile set search_path = public as $$
declare
  c text;
  lettere text := 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
begin
  loop
    c := '';
    for i in 1..6 loop
      c := c || substr(lettere, 1 + floor(random() * length(lettere))::int, 1);
    end loop;
    exit when not exists (select 1 from public.gruppi where codice = c);
  end loop;
  return c;
end;
$$;

-- ---------- Creare un gruppo (con il limite dei 2 gratuiti e la prova di 7 giorni) ----------
drop function if exists public.crea_gruppo(text, text);
create or replace function public.crea_gruppo(nome_gruppo text, mio_nome text, con_prova boolean default false)
returns public.gruppi language plpgsql security definer set search_path = public as $$
declare
  g public.gruppi;
begin
  if auth.uid() is null then raise exception 'Serve l''accesso'; end if;
  if coalesce(trim(nome_gruppo), '') = '' then raise exception 'Manca il nome del gruppo'; end if;
  if con_prova then
    if public.prova_gia_usata() then raise exception 'Prova già usata'; end if;
  elsif public.miei_gruppi_gratis() >= 2 then
    raise exception 'Limite gruppi gratuiti';
  end if;
  insert into public.gruppi (nome, codice, creato_da, coro_fino_al, prova_usata)
    values (trim(nome_gruppo), public.genera_codice(), auth.uid(),
            case when con_prova then now() + interval '7 days' end, con_prova)
    returning * into g;
  insert into public.membri (gruppo_id, user_id, nome, ruolo)
    values (g.id, auth.uid(), coalesce(nullif(trim(mio_nome), ''), 'Senza nome'), 'direttore');
  return g;
end;
$$;

-- ---------- Entrare in un gruppo (con il limite dei 2 gratuiti) ----------
create or replace function public.entra_nel_gruppo(codice_gruppo text, mio_nome text)
returns public.gruppi language plpgsql security definer set search_path = public as $$
declare
  g public.gruppi;
begin
  if auth.uid() is null then raise exception 'Serve l''accesso'; end if;
  select * into g from public.gruppi where codice = upper(trim(codice_gruppo));
  if not found then raise exception 'Codice non valido'; end if;
  if not exists (select 1 from public.membri where gruppo_id = g.id and user_id = auth.uid())
     and not public.coro_attivo(g.id)
     and public.miei_gruppi_gratis() >= 2 then
    raise exception 'Limite gruppi gratuiti';
  end if;
  insert into public.membri (gruppo_id, user_id, nome)
    values (g.id, auth.uid(), coalesce(nullif(trim(mio_nome), ''), 'Senza nome'))
    on conflict (gruppo_id, user_id) do update set nome = excluded.nome;
  return g;
end;
$$;

-- ---------- Prova gratuita di 7 giorni su un gruppo già creato ----------
create or replace function public.inizia_prova_coro(gruppo uuid)
returns public.gruppi language plpgsql security definer set search_path = public as $$
declare
  g public.gruppi;
begin
  if not public.sono_creatore(gruppo) then raise exception 'Solo chi ha creato il gruppo può farlo'; end if;
  if public.prova_gia_usata() then raise exception 'Prova già usata'; end if;
  update public.gruppi set coro_fino_al = now() + interval '7 days', prova_usata = true
    where id = gruppo returning * into g;
  return g;
end;
$$;

-- ---------- Ruoli e voci ----------
create or replace function public.imposta_mia_voce(gruppo uuid, nuova_voce text)
returns void language plpgsql security definer set search_path = public as $$
begin
  if nuova_voce not in ('', 'soprano', 'contralto', 'tenore', 'basso') then raise exception 'Voce non valida'; end if;
  update public.membri set voce = nuova_voce where gruppo_id = gruppo and user_id = auth.uid();
end;
$$;

create or replace function public.imposta_ruolo(gruppo uuid, persona uuid, nuovo_ruolo text)
returns void language plpgsql security definer set search_path = public as $$
begin
  if not public.sono_creatore(gruppo) then raise exception 'Solo chi ha creato il gruppo può farlo'; end if;
  if nuovo_ruolo not in ('direttore', 'corista') then raise exception 'Ruolo non valido'; end if;
  if persona = auth.uid() then raise exception 'Chi ha creato il gruppo resta direttore'; end if;
  update public.membri set ruolo = nuovo_ruolo where gruppo_id = gruppo and user_id = persona;
end;
$$;

revoke execute on function public.crea_gruppo(text, text, boolean) from anon;
revoke execute on function public.inizia_prova_coro(uuid) from anon;
revoke execute on function public.imposta_mia_voce(uuid, text) from anon;
revoke execute on function public.imposta_ruolo(uuid, uuid, text) from anon;

-- ---------- Avvisi del direttore ----------
create table if not exists public.avvisi (
  id         uuid primary key default gen_random_uuid(),
  gruppo_id  uuid not null references public.gruppi (id) on delete cascade,
  user_id    uuid not null default auth.uid() references auth.users (id) on delete cascade,
  autore     text not null,
  testo      text not null,
  creato     timestamptz not null default now()
);
create index if not exists avvisi_per_gruppo on public.avvisi (gruppo_id, creato);
alter table public.avvisi enable row level security;
drop policy if exists "leggo gli avvisi dei miei gruppi" on public.avvisi;
drop policy if exists "il direttore scrive avvisi" on public.avvisi;
drop policy if exists "il direttore toglie avvisi" on public.avvisi;
create policy "leggo gli avvisi dei miei gruppi" on public.avvisi for select to authenticated
  using (public.sono_membro(gruppo_id));
create policy "il direttore scrive avvisi" on public.avvisi for insert to authenticated
  with check (user_id = (select auth.uid()) and public.sono_direttore(gruppo_id) and public.coro_attivo(gruppo_id));
create policy "il direttore toglie avvisi" on public.avvisi for delete to authenticated
  using (public.sono_direttore(gruppo_id));

-- ---------- Libretto del coro ----------
create table if not exists public.libretto (
  id             uuid primary key default gen_random_uuid(),
  gruppo_id      uuid not null references public.gruppi (id) on delete cascade,
  titolo         text not null,
  sezione        text not null default 'chiesa',
  testo          text not null default '',
  allegati       jsonb not null default '[]'::jsonb,  -- [{ id, nome, tipo, mime, percorso }]
  canto_origine  uuid,                                -- il canto del direttore da cui viene
  creato_da      uuid default auth.uid() references auth.users (id) on delete set null,
  aggiornato     timestamptz not null default now()
);
create index if not exists libretto_per_gruppo on public.libretto (gruppo_id);
alter table public.libretto enable row level security;
drop policy if exists "leggo il libretto dei miei gruppi" on public.libretto;
drop policy if exists "il direttore cura il libretto" on public.libretto;
create policy "leggo il libretto dei miei gruppi" on public.libretto for select to authenticated
  using (public.sono_membro(gruppo_id));
create policy "il direttore cura il libretto" on public.libretto for all to authenticated
  using (public.sono_direttore(gruppo_id) and public.coro_attivo(gruppo_id))
  with check (public.sono_direttore(gruppo_id) and public.coro_attivo(gruppo_id));

-- ---------- Scalette ----------
create table if not exists public.scalette (
  id          uuid primary key default gen_random_uuid(),
  gruppo_id   uuid not null references public.gruppi (id) on delete cascade,
  titolo      text not null,
  data        date,
  voci        jsonb not null default '[]'::jsonb,  -- [{ momento, libretto_id, titolo }]
  creato_da   uuid default auth.uid() references auth.users (id) on delete set null,
  aggiornato  timestamptz not null default now()
);
create index if not exists scalette_per_gruppo on public.scalette (gruppo_id);
alter table public.scalette enable row level security;
drop policy if exists "leggo le scalette dei miei gruppi" on public.scalette;
drop policy if exists "il direttore cura le scalette" on public.scalette;
create policy "leggo le scalette dei miei gruppi" on public.scalette for select to authenticated
  using (public.sono_membro(gruppo_id));
create policy "il direttore cura le scalette" on public.scalette for all to authenticated
  using (public.sono_direttore(gruppo_id) and public.coro_attivo(gruppo_id))
  with check (public.sono_direttore(gruppo_id) and public.coro_attivo(gruppo_id));

-- "aggiornato" diventa l'ora della modifica
create or replace function public.tocca_aggiornato()
returns trigger language plpgsql as $$
begin
  new.aggiornato := now();
  return new;
end;
$$;
drop trigger if exists tocca_aggiornato on public.libretto;
drop trigger if exists tocca_aggiornato on public.scalette;
create trigger tocca_aggiornato before update on public.libretto for each row execute function public.tocca_aggiornato();
create trigger tocca_aggiornato before update on public.scalette for each row execute function public.tocca_aggiornato();
