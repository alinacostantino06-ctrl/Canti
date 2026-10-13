// Service worker: tiene una copia di tutti i file dell'app nel dispositivo,
// così l'app si apre e funziona anche senza internet.
//
// Strategia "prima la rete":
//   - se c'è internet (e risponde entro 3 secondi) si usa il file aggiornato
//     e se ne salva la copia;
//   - se non c'è internet si usa la copia salvata.
// Così le modifiche ai file si vedono subito, e offline funziona comunque.
//
// Se aggiungi un NUOVO file all'app (es. un altro .js), aggiungilo a FILE_APP
// e cambia il numero di VERSIONE.

const VERSIONE = 'canti-v5';

const FILE_APP = [
  './',
  'index.html',
  'manifest.webmanifest',
  'privacy.html',
  'termini.html',
  'css/style.css',
  'js/config.js',
  'js/db.js',
  'js/sync.js',
  'js/gruppi.js',
  'js/pdf-import.js',
  'js/app.js',
  'lib/pdf.min.js',
  'lib/pdf.worker.min.js',
  'lib/supabase.min.js',
  'icons/icon-192.png',
  'icons/icon-512.png',
  'icons/apple-touch-icon.png',
  'icons/favicon-32.png',
];

// Installazione: scarico e salvo tutti i file dell'app
self.addEventListener('install', (evento) => {
  evento.waitUntil(
    caches.open(VERSIONE)
      // "reload": prendo i file freschi da internet, non le copie vecchie del browser
      .then((cache) => cache.addAll(FILE_APP.map((file) => new Request(file, { cache: 'reload' }))))
      .then(() => self.skipWaiting())
  );
});

// Attivazione: cancello le copie delle versioni vecchie
self.addEventListener('activate', (evento) => {
  evento.waitUntil(
    caches.keys()
      .then((nomi) => Promise.all(nomi.filter((n) => n !== VERSIONE).map((n) => caches.delete(n))))
      .then(() => self.clients.claim())
  );
});

// Ogni richiesta di un file passa da qui
self.addEventListener('fetch', (evento) => {
  const richiesta = evento.request;
  // Solo letture di file di questa app (non altri siti)
  if (richiesta.method !== 'GET' || new URL(richiesta.url).origin !== self.location.origin) return;

  evento.respondWith(primaLaRete(richiesta));
});

async function primaLaRete(richiesta) {
  const cache = await caches.open(VERSIONE);
  try {
    // "no-cache": chiedo sempre al sito se il file è cambiato (se non è cambiato la risposta è
    // velocissima). Senza, il browser userebbe per 10 minuti la sua copia e gli aggiornamenti tarderebbero.
    const risposta = await conLimiteDiTempo(
      fetch(richiesta.url, { cache: 'no-cache', credentials: 'same-origin' }), 3000);
    if (risposta.ok) cache.put(richiesta, risposta.clone());
    return risposta;
  } catch (e) {
    // Niente internet (o troppo lento): uso la copia salvata
    const copia = await cache.match(richiesta, { ignoreSearch: true });
    if (copia) return copia;
    // Per le pagine, in mancanza d'altro, apro l'app
    if (richiesta.mode === 'navigate') return cache.match('index.html');
    throw e;
  }
}

function conLimiteDiTempo(promessa, millisecondi) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('troppo lento')), millisecondi);
    promessa.then(
      (r) => { clearTimeout(timer); resolve(r); },
      (e) => { clearTimeout(timer); reject(e); }
    );
  });
}
