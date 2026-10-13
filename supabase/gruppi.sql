-- ============================================================================
-- Gruppi per condividere i canti ("Canta con noi").
--
-- Come usarlo: Supabase → SQL Editor → New query → incolla TUTTO questo file
-- → Run. Basta farlo una volta (se lo esegui di nuovo non succede niente di male).
--
-- Crea:
--   - gruppi:        ogni gruppo ha un nome e un codice di 6 lettere per entrare
--   - membri:        chi fa parte di quale gruppo (con il nome che vedono gli altri)
--   - condivisioni:  i canti mandati nella chat del gruppo (testo + elenco dei file)
--   - lo spazio "condivisi" per i file dei canti condivisi (audio, spartiti, PDF)
--   - le regole di sicurezza: si vede SOLO ciò che riguarda i propri gruppi
-- ============================================================================

-- ---------- Tabelle ----------
create table if not exists public.gruppi (
  id         uuid primary key default gen_random_uuid(),
  nome       text not null,
  codice     text not null unique,
  creato_da  uuid not null default auth.uid() references auth.users (id) on delete cascade,
  creato     timestamptz not null default now()
);

create table if not exists public.membri (
  gruppo_id  uuid not null references public.gruppi (id) on delete cascade,
  user_id    uuid not null default auth.uid() references auth.users (id) on delete cascade,
  nome       text not null,
  entrato    timestamptz not null default now(),
  primary key (gruppo_id, user_id)
);

create table if not exists public.condivisioni (
  id         uuid primary key default gen_random_uuid(),
  gruppo_id  uuid not null references public.gruppi (id) on delete cascade,
  user_id    uuid not null default auth.uid() references auth.users (id) on delete cascade,
  autore     text not null,
  messaggio  text not null default '',
  titolo     text not null,
  sezione    text not null default 'prove',
  testo      text not null default '',
  allegati   jsonb not null default '[]'::jsonb,  -- [{ nome, tipo, mime, percorso }]
  creato     timestamptz not null default now()
);

create index if not exists condivisioni_per_gruppo on public.condivisioni (gruppo_id, creato);
create index if not exists membri_per_persona on public.membri (user_id);

-- ---------- "Sono nel gruppo?" (usata dalle regole qui sotto) ----------
create or replace function public.sono_membro(g uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.membri where gruppo_id = g and user_id = auth.uid());
$$;

-- ---------- Creare un gruppo (con un codice nuovo) ----------
create or replace function public.crea_gruppo(nome_gruppo text, mio_nome text)
returns public.gruppi language plpgsql security definer set search_path = public as $$
declare
  g       public.gruppi;
  codice_nuovo text;
  lettere text := 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; -- senza 0/O e 1/I, che si confondono
begin
  if auth.uid() is null then raise exception 'Serve l''accesso'; end if;
  if coalesce(trim(nome_gruppo), '') = '' then raise exception 'Manca il nome del gruppo'; end if;
  loop
    codice_nuovo := '';
    for i in 1..6 loop
      codice_nuovo := codice_nuovo || substr(lettere, 1 + floor(random() * length(lettere))::int, 1);
    end loop;
    exit when not exists (select 1 from public.gruppi where codice = codice_nuovo);
  end loop;
  insert into public.gruppi (nome, codice, creato_da)
    values (trim(nome_gruppo), codice_nuovo, auth.uid()) returning * into g;
  insert into public.membri (gruppo_id, user_id, nome)
    values (g.id, auth.uid(), coalesce(nullif(trim(mio_nome), ''), 'Senza nome'));
  return g;
end;
$$;

-- ---------- Entrare in un gruppo con il codice ----------
create or replace function public.entra_nel_gruppo(codice_gruppo text, mio_nome text)
returns public.gruppi language plpgsql security definer set search_path = public as $$
declare
  g public.gruppi;
begin
  if auth.uid() is null then raise exception 'Serve l''accesso'; end if;
  select * into g from public.gruppi where codice = upper(trim(codice_gruppo));
  if not found then raise exception 'Codice non valido'; end if;
  insert into public.membri (gruppo_id, user_id, nome)
    values (g.id, auth.uid(), coalesce(nullif(trim(mio_nome), ''), 'Senza nome'))
    on conflict (gruppo_id, user_id) do update set nome = excluded.nome;
  return g;
end;
$$;

revoke execute on function public.crea_gruppo(text, text) from anon;
revoke execute on function public.entra_nel_gruppo(text, text) from anon;

-- ---------- Regole di sicurezza ----------
alter table public.gruppi       enable row level security;
alter table public.membri       enable row level security;
alter table public.condivisioni enable row level security;

drop policy if exists "vedo i miei gruppi" on public.gruppi;
create policy "vedo i miei gruppi" on public.gruppi for select to authenticated
  using (public.sono_membro(id));

drop policy if exists "vedo chi c'è nei miei gruppi" on public.membri;
drop policy if exists "esco da un gruppo" on public.membri;
create policy "vedo chi c'è nei miei gruppi" on public.membri for select to authenticated
  using (public.sono_membro(gruppo_id));
create policy "esco da un gruppo" on public.membri for delete to authenticated
  using (user_id = (select auth.uid()));

drop policy if exists "leggo i canti dei miei gruppi" on public.condivisioni;
drop policy if exists "condivido nei miei gruppi" on public.condivisioni;
drop policy if exists "tolgo i canti che ho condiviso" on public.condivisioni;
create policy "leggo i canti dei miei gruppi" on public.condivisioni for select to authenticated
  using (public.sono_membro(gruppo_id));
create policy "condivido nei miei gruppi" on public.condivisioni for insert to authenticated
  with check (user_id = (select auth.uid()) and public.sono_membro(gruppo_id));
create policy "tolgo i canti che ho condiviso" on public.condivisioni for delete to authenticated
  using (user_id = (select auth.uid()));

-- ---------- Chat "in diretta": avvisa l'app quando arriva un canto nuovo ----------
do $$
begin
  if not exists (select 1 from pg_publication_tables
                 where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'condivisioni') then
    alter publication supabase_realtime add table public.condivisioni;
  end if;
end;
$$;

-- ---------- Spazio per i file dei canti condivisi ----------
-- Percorso dei file: <id gruppo>/<id condivisione>/<id file>
insert into storage.buckets (id, name, public, file_size_limit)
values ('condivisi', 'condivisi', false, 52428800)  -- massimo 50 MB per file
on conflict (id) do nothing;

drop policy if exists "condivisi: leggo nei miei gruppi"   on storage.objects;
drop policy if exists "condivisi: carico nei miei gruppi"  on storage.objects;
drop policy if exists "condivisi: cancello i miei"         on storage.objects;

create policy "condivisi: leggo nei miei gruppi" on storage.objects for select to authenticated
  using (bucket_id = 'condivisi' and public.sono_membro(((storage.foldername(name))[1])::uuid));
create policy "condivisi: carico nei miei gruppi" on storage.objects for insert to authenticated
  with check (bucket_id = 'condivisi' and public.sono_membro(((storage.foldername(name))[1])::uuid));
create policy "condivisi: cancello i miei" on storage.objects for delete to authenticated
  using (bucket_id = 'condivisi' and owner_id = (select auth.uid())::text);
