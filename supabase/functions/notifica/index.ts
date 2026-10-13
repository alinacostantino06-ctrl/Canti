// Edge Function "notifica" di "Canta con noi".
//
// La chiama l'app quando in un gruppo succede qualcosa (avviso in bacheca, canto condiviso,
// scaletta nuova, canto aggiunto al libretto): manda una notifica a tutti gli altri
// membri del gruppo che hanno attivato le notifiche sul loro dispositivo.
//
// Come metterla in Supabase: Edge Functions → Deploy a new function → Via Editor →
// nome "notifica" → incolla TUTTO questo file → Deploy.
// Servono 3 "Secrets" (Edge Functions → Secrets): VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY,
// VAPID_SUBJECT (sono nel file CHIAVE-SEGRETA-notifiche-Canta-con-noi.txt).

import { createClient } from 'npm:@supabase/supabase-js@2.45.4';
import webpush from 'npm:web-push@3.6.7';

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

const TITOLI: Record<string, string> = {
  avviso: '📣',
  canto: '♪ Nuovo canto condiviso:',
  scaletta: '📅 Nuova scaletta:',
  libretto: '📖 Nel libretto:',
};
// In quale scheda del gruppo si apre l'app toccando la notifica
const SCHEDE: Record<string, string> = { avviso: 'bacheca', canto: 'chat', scaletta: 'scalette', libretto: 'libretto' };

function risposta(dati: unknown, stato = 200) {
  return new Response(JSON.stringify(dati), { status: stato, headers: { ...CORS, 'Content-Type': 'application/json' } });
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS });
  try {
    const chiaveServizio = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? Deno.env.get('SERVICE_ROLE_KEY') ?? '';
    const admin = createClient(Deno.env.get('SUPABASE_URL')!, chiaveServizio);

    // Chi sta mandando?
    const token = (req.headers.get('Authorization') ?? '').replace(/^Bearer\s+/i, '');
    const { data: { user } } = await admin.auth.getUser(token);
    if (!user) return risposta({ errore: "Serve l'accesso" }, 401);

    const { gruppo_id, tipo, testo } = await req.json();
    if (!gruppo_id || !TITOLI[tipo]) return risposta({ errore: 'Richiesta non valida' }, 400);

    // Deve essere nel gruppo; per gli avvisi deve essere direttore
    const { data: gruppo } = await admin.from('gruppi').select('nome, creato_da').eq('id', gruppo_id).single();
    const { data: io } = await admin.from('membri').select('ruolo').eq('gruppo_id', gruppo_id).eq('user_id', user.id).maybeSingle();
    if (!gruppo || !io) return risposta({ errore: 'Non fai parte del gruppo' }, 403);
    if (tipo === 'avviso' && io.ruolo !== 'direttore' && gruppo.creato_da !== user.id) {
      return risposta({ errore: 'Solo i direttori scrivono in bacheca' }, 403);
    }

    // Destinatari: gli altri membri, tranne chi ha bloccato chi manda
    const { data: membri } = await admin.from('membri').select('user_id').eq('gruppo_id', gruppo_id).neq('user_id', user.id);
    const { data: bloccanti } = await admin.from('bloccati').select('user_id').eq('bloccato_id', user.id);
    const esclusi = new Set((bloccanti ?? []).map((b) => b.user_id));
    const destinatari = (membri ?? []).map((m) => m.user_id).filter((id) => !esclusi.has(id));
    if (!destinatari.length) return risposta({ inviate: 0 });

    const { data: iscrizioni } = await admin.from('iscrizioni_notifiche').select('*').in('user_id', destinatari);
    if (!iscrizioni || !iscrizioni.length) return risposta({ inviate: 0 });

    webpush.setVapidDetails(Deno.env.get('VAPID_SUBJECT')!, Deno.env.get('VAPID_PUBLIC_KEY')!, Deno.env.get('VAPID_PRIVATE_KEY')!);
    const messaggio = JSON.stringify({
      titolo: gruppo.nome,
      testo: TITOLI[tipo] + ' ' + String(testo ?? '').slice(0, 200),
      gruppo: gruppo_id,
      scheda: SCHEDE[tipo],
    });

    let inviate = 0;
    await Promise.all(iscrizioni.map(async (s) => {
      try {
        await webpush.sendNotification({ endpoint: s.endpoint, keys: { p256dh: s.p256dh, auth: s.auth } }, messaggio, { TTL: 86400 });
        inviate++;
      } catch (err) {
        // il dispositivo non esiste più (app disinstallata, permesso tolto): lo dimentico
        const stato = (err as { statusCode?: number }).statusCode;
        if (stato === 404 || stato === 410) await admin.from('iscrizioni_notifiche').delete().eq('endpoint', s.endpoint);
      }
    }));
    return risposta({ inviate });
  } catch (err) {
    return risposta({ errore: String(err) }, 500);
  }
});
