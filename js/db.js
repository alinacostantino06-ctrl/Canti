// Salvataggio locale con IndexedDB: i dati restano nel dispositivo e funzionano offline.
//
// Archivi ("store"):
//   canti        { id, titolo, sezione: "prove" | "chiesa", cartella: id | null, testo, creato }
//   cartelle     { id, nome, sezione }
//   allegati     { id, cantoId, nome, tipo: "audio" | "pdf" | "spartito", mime, dati: ArrayBuffer | null }
//                ("spartito" = PDF o immagine con le note, mostrato così com'è nella pagina del canto)
//   daEliminare  cose cancellate per sempre qui, da cancellare anche dall'account online
//   impostazioni { chiave, valore }  piccole informazioni (es. a chi appartengono i dati)
//
// Gli id sono codici unici (UUID, es. "3f2a…"): così lo stesso canto ha lo stesso id
// su telefono, PC e nell'account online.
//
// Sincronizzazione: ogni volta che qualcosa cambia qui, gli mettiamo
//   modificato: data e ora della modifica
//   daInviare:  1  → da copiare nell'account online (lo fa sync.js)
// Gli allegati scaricati dall'account hanno "senzaFile: 1" finché il file non è arrivato.
//
// Cestino: quando si elimina qualcosa non lo cancelliamo subito, ma gli mettiamo
// il campo "eliminato" con data e ora. Le cose con "eliminato" non compaiono più
// nell'app ma solo nel cestino; dopo 3 giorni vengono cancellate davvero.
// Se un canto è stato eliminato insieme alla sua cartella ha anche "eliminatoCon"
// (l'id della cartella), così ripristinando la cartella torna anche lui.
//
// I file sono salvati come ArrayBuffer (e non come Blob) perché è il formato
// che funziona su tutti i browser, anche i Safari più vecchi di iPhone/iPad.

const DB_NOME = 'canti-db';
const DB_VERSIONE = 4;
const DURATA_CESTINO = 3 * 24 * 60 * 60 * 1000; // 3 giorni in millisecondi
const ARCHIVI_DATI = ['canti', 'cartelle', 'allegati'];

// Codice unico per un nuovo canto/cartella/file
function nuovoId() {
  if (crypto.randomUUID) return crypto.randomUUID();
  // per i browser più vecchi
  const b = crypto.getRandomValues(new Uint8Array(16));
  b[6] = (b[6] & 15) | 64;
  b[8] = (b[8] & 63) | 128;
  const h = [...b].map((x) => x.toString(16).padStart(2, '0')).join('');
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`;
}

let connessione = null;

// Apre (o crea/aggiorna) il database. La connessione viene riusata.
function apriDb() {
  if (connessione) return connessione;
  connessione = new Promise((resolve, reject) => {
    const richiesta = indexedDB.open(DB_NOME, DB_VERSIONE);

    // Eseguito alla creazione o quando sale DB_VERSIONE: ogni "if" aggiunge
    // ciò che manca, così chi aveva già dei canti salvati non perde nulla.
    richiesta.onupgradeneeded = (evento) => {
      const db = richiesta.result;
      const tx = richiesta.transaction;
      if (evento.oldVersion < 1) {
        db.createObjectStore('canti', { keyPath: 'id', autoIncrement: true })
          .createIndex('sezione', 'sezione');
      }
      if (evento.oldVersion < 2) {
        db.createObjectStore('cartelle', { keyPath: 'id', autoIncrement: true })
          .createIndex('sezione', 'sezione');
        db.createObjectStore('allegati', { keyPath: 'id', autoIncrement: true })
          .createIndex('cantoId', 'cantoId');
      }
      if (evento.oldVersion < 3) {
        // Indice per trovare subito ciò che è nel cestino (solo i record con "eliminato")
        for (const nome of ARCHIVI_DATI) {
          tx.objectStore(nome).createIndex('eliminato', 'eliminato');
        }
      }
      if (evento.oldVersion < 4) {
        // Sincronizzazione con l'account online
        for (const nome of ARCHIVI_DATI) tx.objectStore(nome).createIndex('daInviare', 'daInviare');
        tx.objectStore('allegati').createIndex('senzaFile', 'senzaFile');
        db.createObjectStore('daEliminare', { keyPath: 'chiave' });
        db.createObjectStore('impostazioni', { keyPath: 'chiave' });
        if (evento.oldVersion >= 1) convertiInCodiciUnici(tx);
      }
    };

    richiesta.onsuccess = () => {
      const db = richiesta.result;
      // Se un'altra finestra dell'app (più nuova) deve aggiornare il database,
      // chiudo il mio collegamento per non bloccarla; alla prossima operazione lo riapro.
      db.onversionchange = () => {
        db.close();
        connessione = null;
      };
      resolve(db);
    };
    richiesta.onerror = () => reject(richiesta.error);
    // Un'altra finestra dell'app, rimasta aperta con la versione vecchia, blocca l'aggiornamento
    richiesta.onblocked = () => {
      if (typeof avviso === 'function') {
        avviso("Chiudi le altre finestre di questa app per completare l'aggiornamento.");
      }
    };
  });
  return connessione;
}

// Aggiornamento alla versione 4: i vecchi id erano numeri (1, 2, 3…) validi solo
// su questo dispositivo. Li sostituisco con codici unici, aggiornando anche i
// collegamenti (canto → cartella, file → canto). Niente viene perso.
function convertiInCodiciUnici(tx) {
  const dati = {};
  let letti = 0;
  for (const nome of ARCHIVI_DATI) {
    tx.objectStore(nome).getAll().onsuccess = (e) => {
      dati[nome] = e.target.result;
      if (++letti === ARCHIVI_DATI.length) riscrivi();
    };
  }

  function riscrivi() {
    const nuovi = new Map();
    const codice = (archivio, vecchio) => {
      const k = archivio + ':' + vecchio;
      if (!nuovi.has(k)) nuovi.set(k, typeof vecchio === 'string' ? vecchio : nuovoId());
      return nuovi.get(k);
    };
    const cartelleEsistenti = new Set(dati.cartelle.map((c) => c.id));
    const ora = Date.now();

    for (const nome of ARCHIVI_DATI) {
      const archivio = tx.objectStore(nome);
      for (const vecchio of dati[nome]) {
        const r = { ...vecchio, id: codice(nome, vecchio.id), modificato: vecchio.creato || ora, daInviare: 1 };
        if (nome === 'canti') {
          r.cartella = cartelleEsistenti.has(vecchio.cartella) ? codice('cartelle', vecchio.cartella) : null;
          if (vecchio.eliminatoCon != null) r.eliminatoCon = codice('cartelle', vecchio.eliminatoCon);
        }
        if (nome === 'allegati') r.cantoId = codice('canti', vecchio.cantoId);
        if (r.id !== vecchio.id) archivio.delete(vecchio.id);
        archivio.put(r);
      }
    }
  }
}

// Chi vuole sapere quando i dati cambiano qui (sync.js, per inviarli online)
const ascoltatoriCambio = [];
const avvisaCambio = () => ascoltatoriCambio.forEach((fn) => fn());

// Esegue un'operazione su uno o più archivi e, a lavoro finito, restituisce
// il risultato della richiesta fatta da fn (se fn ne restituisce una).
async function operazione(archivi, modo, fn) {
  const db = await apriDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(archivi, modo);
    const richiesta = fn(tx);
    tx.oncomplete = () => resolve(richiesta ? richiesta.result : undefined);
    tx.onerror = () => reject(tx.error);
  });
}

// Come "operazione", ma per le modifiche fatte da chi usa l'app: alla fine
// avvisa sync.js che c'è qualcosa da inviare online.
async function modificaLocale(archivi, fn) {
  const risultato = await operazione(archivi, 'readwrite', fn);
  avvisaCambio();
  return risultato;
}

// Segna un record come appena modificato qui (da inviare online)
const segnato = (record) => ({ ...record, modificato: Date.now(), daInviare: 1 });

// Ordine alfabetico "umano": senza badare a maiuscole/accenti, e "Canto 2" prima di "Canto 10"
const perNome = (campo) => (a, b) => a[campo].localeCompare(b[campo], 'it', { numeric: true, sensitivity: 'base' });
const attivi = (lista) => lista.filter((x) => !x.eliminato);

// Legge un record, ci applica "cambia" e lo riscrive (segnandolo come modificato)
function modifica(archivio, id, cambia) {
  return modificaLocale(archivio, (tx) => {
    const s = tx.objectStore(archivio);
    s.get(id).onsuccess = (e) => {
      const record = e.target.result;
      if (record) s.put(segnato(cambia({ ...record })));
    };
  });
}

// Toglie i campi del cestino da un record (= lo ripristina)
function senzaCestino(record) {
  delete record.eliminato;
  delete record.eliminatoCon;
  return segnato(record);
}

// Dentro una transazione: ricorda di cancellare qualcosa anche dall'account online
function mettiInCodaEliminazione(tx, tabella, id) {
  tx.objectStore('daEliminare').put({ chiave: tabella + ':' + id, tabella, id });
}

// Dentro una transazione: cancella per sempre un canto e tutti i suoi file
function cancellaCantoDefinitivamente(tx, id) {
  const allegati = tx.objectStore('allegati');
  tx.objectStore('canti').delete(id);
  mettiInCodaEliminazione(tx, 'canti', id);
  allegati.index('cantoId').getAllKeys(id).onsuccess = (e) => {
    e.target.result.forEach((chiave) => {
      allegati.delete(chiave);
      mettiInCodaEliminazione(tx, 'allegati', chiave);
    });
  };
}

const CON_CODA = [...ARCHIVI_DATI, 'daEliminare'];

const Db = {
  // Per essere avvisati quando i dati cambiano su questo dispositivo
  quandoCambia: (fn) => ascoltatoriCambio.push(fn),

  // ---------- Canti ----------

  // Canti che stanno in una certa cartella (null = fuori dalle cartelle).
  // (Una volta c'erano due sezioni, "prove" e "chiesa": ora è un elenco unico.)
  async canti(cartella = null) {
    const tutti = await operazione('canti', 'readonly', (tx) => tx.objectStore('canti').getAll());
    return attivi(tutti).filter((c) => (c.cartella ?? null) === cartella).sort(perNome('titolo'));
  },

  canto: (id) => operazione('canti', 'readonly', (tx) => tx.objectStore('canti').get(id)),

  // Tutti i canti, compresi quelli dei libretti dei cori (per la ricerca)
  async tuttiPerRicerca() {
    const tutti = await operazione('canti', 'readonly', (tx) => tx.objectStore('canti').getAll());
    return attivi(tutti).sort(perNome('titolo'));
  },

  // Tutti i miei canti (di tutte le sezioni e cartelle), in ordine alfabetico.
  // Le copie dei libretti dei cori non sono "mie": le escludo.
  async tuttiICanti() {
    const tutti = await operazione('canti', 'readonly', (tx) => tx.objectStore('canti').getAll());
    return attivi(tutti).filter((c) => !c.libretto).sort(perNome('titolo'));
  },

  // Salva un nuovo canto e restituisce il suo id
  async aggiungiCanto(canto) {
    const id = nuovoId();
    await modificaLocale('canti', (tx) =>
      tx.objectStore('canti').add(segnato({ cartella: null, ...canto, id, creato: Date.now() })));
    return id;
  },

  // Cambia alcuni campi di un canto (titolo, testo, sezione, cartella...)
  aggiornaCanto: (id, campi) => modifica('canti', id, (c) => ({ ...c, ...campi })),

  eliminaCanto: (id) => modifica('canti', id, (c) => ({ ...c, eliminato: Date.now() })),

  // ---------- Cartelle ----------

  // Tutte le cartelle, in ordine alfabetico
  async cartelle() {
    const tutte = await operazione('cartelle', 'readonly', (tx) => tx.objectStore('cartelle').getAll());
    return attivi(tutte).sort(perNome('nome'));
  },

  cartella: (id) => operazione('cartelle', 'readonly', (tx) => tx.objectStore('cartelle').get(id)),

  async aggiungiCartella(nome, sezione = 'canti') {
    const id = nuovoId();
    await modificaLocale('cartelle', (tx) => tx.objectStore('cartelle').add(segnato({ id, nome, sezione })));
    return id;
  },

  rinominaCartella: (id, nome) => modifica('cartelle', id, (c) => ({ ...c, nome })),

  // Mette la cartella nel cestino.
  //   conContenuto = true  → anche i canti dentro vanno nel cestino (con i loro file)
  //   conContenuto = false → i canti tornano fuori dalle cartelle
  eliminaCartella: (id, conContenuto) =>
    modificaLocale(['cartelle', 'canti'], (tx) => {
      const ora = Date.now();
      tx.objectStore('canti').openCursor().onsuccess = (e) => {
        const cursore = e.target.result;
        if (!cursore) return;
        const canto = cursore.value;
        if (canto.cartella === id && !canto.eliminato) {
          cursore.update(segnato(conContenuto
            ? { ...canto, eliminato: ora, eliminatoCon: id }
            : { ...canto, cartella: null }));
        }
        cursore.continue();
      };
      const cartelle = tx.objectStore('cartelle');
      cartelle.get(id).onsuccess = (e) => cartelle.put(segnato({ ...e.target.result, eliminato: ora }));
    }),

  // ---------- Allegati (audio e PDF) ----------

  async allegati(cantoId) {
    const tutti = await operazione('allegati', 'readonly', (tx) =>
      tx.objectStore('allegati').index('cantoId').getAll(cantoId));
    return attivi(tutti).sort(perNome('nome'));
  },

  // file: il File scelto dall'utente; tipo: "audio" o "pdf"
  async aggiungiAllegato(cantoId, nome, tipo, file) {
    const dati = await file.arrayBuffer(); // va letto PRIMA di aprire la transazione
    const id = nuovoId();
    await modificaLocale('allegati', (tx) =>
      tx.objectStore('allegati').add(segnato({ id, cantoId, nome, tipo, mime: file.type, dati })));
    return id;
  },

  rinominaAllegato: (id, nome) => modifica('allegati', id, (a) => ({ ...a, nome })),

  // Cambia alcuni campi di un allegato (es. tipo "pdf" → "spartito")
  aggiornaAllegato: (id, campi) => modifica('allegati', id, (a) => ({ ...a, ...campi })),

  eliminaAllegato: (id) => modifica('allegati', id, (a) => ({ ...a, eliminato: Date.now() })),

  // ---------- Cestino ----------

  // Tutto ciò che è nel cestino, già pronto per essere mostrato
  async cestino() {
    const [cartelle, canti, allegati] = await Promise.all(
      ['cartelle', 'canti', 'allegati'].map((nome) =>
        operazione(nome, 'readonly', (tx) => tx.objectStore(nome).index('eliminato').getAll()))
    );

    const elementi = [];
    for (const c of cartelle) {
      const contenuto = canti.filter((canto) => canto.eliminatoCon === c.id);
      elementi.push({ tipo: 'cartella', id: c.id, nome: c.nome, sezione: c.sezione,
        eliminato: c.eliminato, quantiCanti: contenuto.length });
    }
    // I canti eliminati insieme a una cartella si vedono dentro la cartella, non da soli
    for (const c of canti.filter((canto) => !canto.eliminatoCon)) {
      elementi.push({ tipo: 'canto', id: c.id, nome: c.titolo, sezione: c.sezione,
        eliminato: c.eliminato });
    }
    for (const a of allegati) {
      const canto = await Db.canto(a.cantoId);
      elementi.push({ tipo: 'allegato', id: a.id, nome: a.nome, tipoFile: a.tipo,
        canto: canto ? canto.titolo : '', eliminato: a.eliminato });
    }
    return elementi.sort((a, b) => b.eliminato - a.eliminato); // i più recenti in alto
  },

  // Rimette al suo posto un elemento del cestino
  ripristina: (tipo, id) =>
    modificaLocale(ARCHIVI_DATI, (tx) => {
      const canti = tx.objectStore('canti');

      if (tipo === 'cartella') {
        const cartelle = tx.objectStore('cartelle');
        cartelle.get(id).onsuccess = (e) => cartelle.put(senzaCestino(e.target.result));
        // tornano anche i canti eliminati insieme alla cartella
        canti.index('eliminato').getAll().onsuccess = (e) => {
          e.target.result.filter((c) => c.eliminatoCon === id)
            .forEach((c) => canti.put(senzaCestino(c)));
        };
      } else if (tipo === 'canto') {
        canti.get(id).onsuccess = (e) => {
          const canto = senzaCestino(e.target.result);
          if (canto.cartella === null) return canti.put(canto);
          // Se la sua cartella non c'è più (o è nel cestino), il canto torna fuori dalle cartelle
          tx.objectStore('cartelle').get(canto.cartella).onsuccess = (ev) => {
            const cartella = ev.target.result;
            if (!cartella || cartella.eliminato) canto.cartella = null;
            canti.put(canto);
          };
        };
      } else {
        const allegati = tx.objectStore('allegati');
        allegati.get(id).onsuccess = (e) => allegati.put(senzaCestino(e.target.result));
      }
    }),

  // Cancella per sempre un elemento del cestino
  cancellaDefinitivamente: (tipo, id) =>
    modificaLocale(CON_CODA, (tx) => {
      if (tipo === 'cartella') {
        tx.objectStore('cartelle').delete(id);
        mettiInCodaEliminazione(tx, 'cartelle', id);
        tx.objectStore('canti').index('eliminato').getAll().onsuccess = (e) => {
          e.target.result.filter((c) => c.eliminatoCon === id)
            .forEach((c) => cancellaCantoDefinitivamente(tx, c.id));
        };
      } else if (tipo === 'canto') {
        cancellaCantoDefinitivamente(tx, id);
      } else {
        tx.objectStore('allegati').delete(id);
        mettiInCodaEliminazione(tx, 'allegati', id);
      }
    }),

  // Cancella per sempre ciò che è nel cestino da più di 3 giorni.
  // Con tutto = true svuota l'intero cestino.
  svuotaCestino: (tutto = false) =>
    modificaLocale(CON_CODA, (tx) => {
      const limite = IDBKeyRange.upperBound(tutto ? Infinity : Date.now() - DURATA_CESTINO);
      tx.objectStore('canti').index('eliminato').getAllKeys(limite).onsuccess = (e) => {
        e.target.result.forEach((id) => cancellaCantoDefinitivamente(tx, id));
      };
      for (const nome of ['cartelle', 'allegati']) {
        const archivio = tx.objectStore(nome);
        archivio.index('eliminato').getAllKeys(limite).onsuccess = (e) => {
          e.target.result.forEach((id) => {
            archivio.delete(id);
            mettiInCodaEliminazione(tx, nome, id);
          });
        };
      }
    }),

  // ---------- Per la sincronizzazione (usate da sync.js) ----------

  // Record modificati qui e non ancora inviati online
  daInviare: (nome) =>
    operazione(nome, 'readonly', (tx) => tx.objectStore(nome).index('daInviare').getAll()),

  // Il record è stato inviato: tolgo il segno, ma solo se nel frattempo non è cambiato ancora
  segnaInviato: (nome, id, modificato, campiExtra = {}) =>
    operazione(nome, 'readwrite', (tx) => {
      const s = tx.objectStore(nome);
      s.get(id).onsuccess = (e) => {
        const r = e.target.result;
        if (!r) return;
        Object.assign(r, campiExtra);
        if (r.modificato === modificato) delete r.daInviare;
        s.put(r);
      };
    }),

  eliminazioniInCoda: () =>
    operazione('daEliminare', 'readonly', (tx) => tx.objectStore('daEliminare').getAll()),

  togliDallaCoda: (chiave) =>
    operazione('daEliminare', 'readwrite', (tx) => tx.objectStore('daEliminare').delete(chiave)),

  // Scrive qui un record arrivato dall'account online.
  // Vince la versione modificata più di recente; restituisce true se qualcosa è cambiato.
  async applicaRemoto(nome, remoto) {
    let cambiato = false;
    await operazione(ARCHIVI_DATI, 'readwrite', (tx) => {
      const s = tx.objectStore(nome);
      s.get(remoto.id).onsuccess = (e) => {
        const locale = e.target.result;

        // Cancellato per sempre su un altro dispositivo: lo cancello anche qui
        if (remoto.cancellato) {
          if (!locale) return;
          if (nome === 'canti') {
            const allegati = tx.objectStore('allegati');
            allegati.index('cantoId').getAllKeys(remoto.id).onsuccess = (ev) =>
              ev.target.result.forEach((k) => allegati.delete(k));
          }
          s.delete(remoto.id);
          cambiato = true;
          return;
        }

        if (locale && locale.modificato >= remoto.modificato) return; // qui è uguale o più recente
        const r = { ...remoto };
        delete r.cancellato;
        // i campi vuoti non vanno salvati (gli indici del cestino funzionano così)
        for (const campo of ['eliminato', 'eliminatoCon']) if (r[campo] == null) delete r[campo];
        if (nome === 'allegati') {
          r.fileInviato = true; // se è online, il file è già nell'account
          if (locale && locale.dati) r.dati = locale.dati;
          else { r.dati = null; r.senzaFile = 1; }
        }
        s.put(r);
        cambiato = true;
      };
    });
    return cambiato;
  },

  // File da scaricare dall'account (allegati arrivati senza il file)
  allegatiSenzaFile: () =>
    operazione('allegati', 'readonly', (tx) => tx.objectStore('allegati').index('senzaFile').getAll()),

  salvaFile: (id, dati) =>
    operazione('allegati', 'readwrite', (tx) => {
      const s = tx.objectStore('allegati');
      s.get(id).onsuccess = (e) => {
        const r = e.target.result;
        if (!r) return;
        r.dati = dati;
        delete r.senzaFile;
        s.put(r);
      };
    }),

  async impostazione(chiave) {
    const r = await operazione('impostazioni', 'readonly', (tx) => tx.objectStore('impostazioni').get(chiave));
    return r ? r.valore : undefined;
  },

  salvaImpostazione: (chiave, valore) =>
    operazione('impostazioni', 'readwrite', (tx) => tx.objectStore('impostazioni').put({ chiave, valore })),

  // Quante modifiche non sono ancora arrivate online
  async quanteDaInviare() {
    let totale = (await Db.eliminazioniInCoda()).length;
    for (const nome of ARCHIVI_DATI) {
      totale += await operazione(nome, 'readonly', (tx) => tx.objectStore(nome).index('daInviare').count());
    }
    return totale;
  },

  // ---------- Libretti dei cori (copie solo su questo dispositivo) ----------
  // I canti del libretto di un coro vengono copiati qui per usarli offline, in una cartella
  // "📖 Nome del coro" per ogni sezione. Hanno il campo "libretto" e NON vengono inviati
  // all'account (non hanno "daInviare"): li aggiorna solo il direttore del coro.

  async librettoInCache(gruppoId) {
    const tutti = await operazione('canti', 'readonly', (tx) => tx.objectStore('canti').getAll());
    return tutti.filter((c) => c.libretto && c.libretto.gruppo === gruppoId);
  },

  async gruppiConLibretto() {
    const cartelle = await operazione('cartelle', 'readonly', (tx) => tx.objectStore('cartelle').getAll());
    return [...new Set(cartelle.filter((c) => c.libretto).map((c) => c.libretto.gruppo))];
  },

  // La cartella 📖 del libretto di un coro (una sola per coro)
  idCartellaLibretto: (gruppoId) => 'libretto:' + gruppoId,

  // gruppo: { id, nome }; voce: riga del libretto; files: [{ id, nome, tipo, mime, dati, voce }]
  // filtro: la voce per cui sono stati scelti i file ('' = tutti i file)
  salvaCantoLibretto: (gruppo, voce, files, filtro = '') =>
    operazione(['canti', 'cartelle', 'allegati'], 'readwrite', (tx) => {
      const idCartella = Db.idCartellaLibretto(gruppo.id);
      tx.objectStore('cartelle').put({ id: idCartella, nome: '📖 ' + gruppo.nome, sezione: 'canti',
        libretto: { gruppo: gruppo.id }, modificato: Date.now() });
      tx.objectStore('canti').put({
        id: voce.id, titolo: voce.titolo, sezione: 'canti', cartella: idCartella, testo: voce.testo,
        creato: Date.parse(voce.aggiornato) || Date.now(), modificato: Date.now(),
        libretto: { gruppo: gruppo.id, nomeGruppo: gruppo.nome, aggiornato: voce.aggiornato, filtro },
      });
      const allegati = tx.objectStore('allegati');
      allegati.index('cantoId').getAllKeys(voce.id).onsuccess = (e) => {
        e.target.result.forEach((k) => allegati.delete(k));
        for (const f of files) {
          allegati.put({ id: f.id, cantoId: voce.id, nome: f.nome, tipo: f.tipo, mime: f.mime, voce: f.voce || '',
            dati: f.dati, fileInviato: true, modificato: Date.now(), libretto: true });
        }
      };
    }),

  // Le vecchie cartelle del libretto (una per sezione) non servono più: ora è una sola
  async togliCartelleLibrettoVecchie(gruppoId) {
    let tolte = 0;
    await operazione('cartelle', 'readwrite', (tx) => {
      const s = tx.objectStore('cartelle');
      s.getAll().onsuccess = (e) => e.target.result
        .filter((c) => c.libretto && c.libretto.gruppo === gruppoId && c.id !== Db.idCartellaLibretto(gruppoId))
        .forEach((c) => { s.delete(c.id); tolte++; });
    });
    return tolte > 0;
  },

  togliCantoLibretto: (id) =>
    operazione(['canti', 'allegati'], 'readwrite', (tx) => {
      tx.objectStore('canti').delete(id);
      const allegati = tx.objectStore('allegati');
      allegati.index('cantoId').getAllKeys(id).onsuccess = (e) => e.target.result.forEach((k) => allegati.delete(k));
    }),

  async togliLibretto(gruppoId) {
    for (const c of await Db.librettoInCache(gruppoId)) await Db.togliCantoLibretto(c.id);
    await operazione('cartelle', 'readwrite', (tx) => {
      const s = tx.objectStore('cartelle');
      s.getAll().onsuccess = (e) => e.target.result
        .filter((c) => c.libretto && c.libretto.gruppo === gruppoId).forEach((c) => s.delete(c.id));
    });
  },

  // Toglie tutti i canti da questo dispositivo (quando si esce dall'account)
  svuotaTutto: () =>
    operazione([...CON_CODA, 'impostazioni'], 'readwrite', (tx) => {
      for (const nome of [...CON_CODA, 'impostazioni']) tx.objectStore(nome).clear();
    }),
};
