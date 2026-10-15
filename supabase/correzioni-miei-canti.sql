-- ============================================================================
-- Correzioni sui miei canti — "Canta con noi"
--
-- Come usarlo: Supabase → SQL Editor → New query → incolla TUTTO → Run.
-- Si può eseguire anche più volte.
--
-- Ognuno può scrivere sopra i PDF e le foto dei propri canti (penna, evidenziatore,
-- parole). Il file originale non cambia: le correzioni sono salvate qui, insieme al
-- file, e arrivano su tutti i dispositivi dello stesso account.
-- ============================================================================

alter table public.allegati add column if not exists correzioni jsonb;
