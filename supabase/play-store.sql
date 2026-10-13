-- ============================================================================
-- Requisiti di Google Play per "Canta con noi".
--
-- Come usarlo: Supabase → SQL Editor → New query → incolla TUTTO questo file
-- → Run. Va eseguito DOPO configurazione.sql e gruppi.sql. Basta farlo una volta.
--
-- Aggiunge:
--   - eliminazione del proprio account (con tutti i dati) dall'app
--   - segnalazioni dei canti condivisi nei gruppi (le leggi tu in Table Editor → segnalazioni)
--   - persone bloccate (non se ne vedono più i canti)
--   - chi ha creato un gruppo può moderarlo: togliere canti, rimuovere persone, cambiare il codice
-- ============================================================================

-- ---------- Segnalazioni ----------
-- Si salva anche una copia di ciò che è stato segnalato, così resta come prova
-- anche se poi il canto viene tolto dalla chat.
create table if not exists public.segnalazioni (
  id               uuid primary key default gen_random_uuid(),
  da_user_id       uuid default auth.uid() references auth.users (id) on delete set null,
  gruppo_id        uuid,
  condivisione_id  uuid,
  segnalato_user_id uuid,
  autore           text,
  titolo           text,
  messaggio        text,
  testo            text,
  motivo           text not null,
  creato           timestamptz not null default now(),
  gestita          boolean not null default false  -- la metti a "true" tu quando l'hai controllata
);

alter table public.segnalazioni enable row level security;
drop policy if exists "segnalo nei miei gruppi" on public.segnalazioni;
create policy "segnalo nei miei gruppi" on public.segnalazioni for insert to authenticated
  with check (da_user_id = (select auth.uid()) and public.sono_membro(gruppo_id));
-- (nessuno può leggerle dall'app: le vedi solo tu dal pannello di Supabase)

-- ---------- Persone bloccate ----------
create table if not exists public.bloccati (
  user_id      uuid not null default auth.uid() references auth.users (id) on delete cascade,
  bloccato_id  uuid not null references auth.users (id) on delete cascade,
  nome         text not null default '',
  creato       timestamptz not null default now(),
  primary key (user_id, bloccato_id)
);

alter table public.bloccati enable row level security;
drop policy if exists "gestisco chi ho bloccato" on public.bloccati;
create policy "gestisco chi ho bloccato" on public.bloccati for all to authenticated
  using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));

-- ---------- Moderazione dei gruppi (chi li ha creati) ----------
create or replace function public.sono_creatore(g uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.gruppi where id = g and creato_da = auth.uid());
$$;

drop policy if exists "esco da un gruppo" on public.membri;
create policy "esco da un gruppo" on public.membri for delete to authenticated
  using (user_id = (select auth.uid()) or public.sono_creatore(gruppo_id));

-- Ognuno vede sempre ciò che ha condiviso (anche se non è più nel gruppo):
-- serve per cancellarne i file quando elimina l'account.
drop policy if exists "vedo i canti che ho condiviso" on public.condivisioni;
create policy "vedo i canti che ho condiviso" on public.condivisioni for select to authenticated
  using (user_id = (select auth.uid()));

drop policy if exists "tolgo i canti che ho condiviso" on public.condivisioni;
create policy "tolgo i canti che ho condiviso" on public.condivisioni for delete to authenticated
  using (user_id = (select auth.uid()) or public.sono_creatore(gruppo_id));

drop policy if exists "condivisi: cancello i miei" on storage.objects;
create policy "condivisi: cancello i miei" on storage.objects for delete to authenticated
  using (bucket_id = 'condivisi' and (owner_id = (select auth.uid())::text
         or public.sono_creatore(((storage.foldername(name))[1])::uuid)));

-- Nuovo codice per un gruppo (così chi è stato rimosso non può rientrare col vecchio)
create or replace function public.nuovo_codice(gruppo uuid)
returns public.gruppi language plpgsql security definer set search_path = public as $$
declare
  g public.gruppi;
  codice_nuovo text;
  lettere text := 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
begin
  if not public.sono_creatore(gruppo) then raise exception 'Solo chi ha creato il gruppo può cambiare il codice'; end if;
  loop
    codice_nuovo := '';
    for i in 1..6 loop
      codice_nuovo := codice_nuovo || substr(lettere, 1 + floor(random() * length(lettere))::int, 1);
    end loop;
    exit when not exists (select 1 from public.gruppi where codice = codice_nuovo);
  end loop;
  update public.gruppi set codice = codice_nuovo where id = gruppo returning * into g;
  return g;
end;
$$;
revoke execute on function public.nuovo_codice(uuid) from anon;

-- ---------- Eliminare il proprio account ----------
-- Cancella l'account: grazie a "on delete cascade" spariscono anche i suoi canti,
-- cartelle, file elencati, condivisioni, gruppi creati e appartenenze ai gruppi.
-- (I file veri e propri li cancella l'app PRIMA di chiamare questa funzione.)
create or replace function public.elimina_il_mio_account()
returns void language plpgsql security definer set search_path = public, auth as $$
begin
  if auth.uid() is null then raise exception 'Serve l''accesso'; end if;
  delete from auth.users where id = auth.uid();
end;
$$;
revoke execute on function public.elimina_il_mio_account() from anon;
