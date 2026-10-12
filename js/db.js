// Salvataggio locale con IndexedDB: i dati restano nel dispositivo e funzionano offline.
//
// Archivi ("store"):
//   canti     { id, titolo, sezione: "prove" | "chiesa", cartella: id | null, testo, creato }
//   cartelle  { id, nome, sezione }
//   allegati  { id, cantoId, nome, tipo: "audio" | "pdf", mime, dati: ArrayBuffer }
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
const DB_VERSIONE = 3;
const DURATA_CESTINO = 3 * 24 * 60 * 60 * 1000; // 3 giorni in millisecondi

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
        for (const nome of ['canti', 'cartelle', 'allegati']) {
          tx.objectStore(nome).createIndex('eliminato', 'eliminato');
        }
      }
    };

    richiesta.onsuccess = () => resolve(richiesta.result);
    richiesta.onerror = () => reject(richiesta.error);
  });
  return connessione;
}

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

const perNome = (campo) => (a, b) => a[campo].localeCompare(b[campo], 'it');
const attivi = (lista) => lista.filter((x) => !x.eliminato);

// Legge un record, ci applica "cambia" e lo riscrive
function modifica(archivio, id, cambia) {
  return operazione(archivio, 'readwrite', (tx) => {
    const s = tx.objectStore(archivio);
    s.get(id).onsuccess = (e) => {
      const record = e.target.result;
      if (record) s.put(cambia({ ...record }));
    };
  });
}

// Toglie i campi del cestino da un record (= lo ripristina)
function senzaCestino(record) {
  delete record.eliminato;
  delete record.eliminatoCon;
  return record;
}

// Dentro una transazione: cancella per sempre un canto e tutti i suoi file
function cancellaCantoDefinitivamente(tx, id) {
  const allegati = tx.objectStore('allegati');
  tx.objectStore('canti').delete(id);
  allegati.index('cantoId').getAllKeys(id).onsuccess = (e) => {
    e.target.result.forEach((chiave) => allegati.delete(chiave));
  };
}

const TUTTI = ['canti', 'cartelle', 'allegati'];

const Db = {
  // ---------- Canti ----------

  // Canti di una sezione che stanno in una certa cartella (null = fuori dalle cartelle)
  async canti(sezione, cartella = null) {
    const tutti = await operazione('canti', 'readonly', (tx) =>
      tx.objectStore('canti').index('sezione').getAll(sezione));
    return attivi(tutti).filter((c) => (c.cartella ?? null) === cartella).sort(perNome('titolo'));
  },

  canto: (id) => operazione('canti', 'readonly', (tx) => tx.objectStore('canti').get(id)),

  // Salva un nuovo canto e restituisce il suo id
  aggiungiCanto: (canto) =>
    operazione('canti', 'readwrite', (tx) =>
      tx.objectStore('canti').add({ cartella: null, ...canto, creato: Date.now() })),

  // Cambia alcuni campi di un canto (titolo, testo, sezione, cartella...)
  aggiornaCanto: (id, campi) => modifica('canti', id, (c) => ({ ...c, ...campi })),

  eliminaCanto: (id) => modifica('canti', id, (c) => ({ ...c, eliminato: Date.now() })),

  // ---------- Cartelle ----------

  async cartelle(sezione) {
    const tutte = await operazione('cartelle', 'readonly', (tx) =>
      tx.objectStore('cartelle').index('sezione').getAll(sezione));
    return attivi(tutte).sort(perNome('nome'));
  },

  cartella: (id) => operazione('cartelle', 'readonly', (tx) => tx.objectStore('cartelle').get(id)),

  aggiungiCartella: (nome, sezione) =>
    operazione('cartelle', 'readwrite', (tx) => tx.objectStore('cartelle').add({ nome, sezione })),

  rinominaCartella: (id, nome) => modifica('cartelle', id, (c) => ({ ...c, nome })),

  // Mette la cartella nel cestino.
  //   conContenuto = true  → anche i canti dentro vanno nel cestino (con i loro file)
  //   conContenuto = false → i canti tornano fuori dalle cartelle
  eliminaCartella: (id, conContenuto) =>
    operazione(['cartelle', 'canti'], 'readwrite', (tx) => {
      const ora = Date.now();
      tx.objectStore('canti').openCursor().onsuccess = (e) => {
        const cursore = e.target.result;
        if (!cursore) return;
        const canto = cursore.value;
        if (canto.cartella === id && !canto.eliminato) {
          cursore.update(conContenuto
            ? { ...canto, eliminato: ora, eliminatoCon: id }
            : { ...canto, cartella: null });
        }
        cursore.continue();
      };
      const cartelle = tx.objectStore('cartelle');
      cartelle.get(id).onsuccess = (e) => cartelle.put({ ...e.target.result, eliminato: ora });
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
    return operazione('allegati', 'readwrite', (tx) =>
      tx.objectStore('allegati').add({ cantoId, nome, tipo, mime: file.type, dati }));
  },

  rinominaAllegato: (id, nome) => modifica('allegati', id, (a) => ({ ...a, nome })),

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
    operazione(TUTTI, 'readwrite', (tx) => {
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
    operazione(TUTTI, 'readwrite', (tx) => {
      if (tipo === 'cartella') {
        tx.objectStore('cartelle').delete(id);
        tx.objectStore('canti').index('eliminato').getAll().onsuccess = (e) => {
          e.target.result.filter((c) => c.eliminatoCon === id)
            .forEach((c) => cancellaCantoDefinitivamente(tx, c.id));
        };
      } else if (tipo === 'canto') {
        cancellaCantoDefinitivamente(tx, id);
      } else {
        tx.objectStore('allegati').delete(id);
      }
    }),

  // Cancella per sempre ciò che è nel cestino da più di 3 giorni.
  // Con tutto = true svuota l'intero cestino.
  svuotaCestino: (tutto = false) =>
    operazione(TUTTI, 'readwrite', (tx) => {
      const limite = IDBKeyRange.upperBound(tutto ? Infinity : Date.now() - DURATA_CESTINO);
      tx.objectStore('canti').index('eliminato').getAllKeys(limite).onsuccess = (e) => {
        e.target.result.forEach((id) => cancellaCantoDefinitivamente(tx, id));
      };
      for (const nome of ['cartelle', 'allegati']) {
        const archivio = tx.objectStore(nome);
        archivio.index('eliminato').getAllKeys(limite).onsuccess = (e) => {
          e.target.result.forEach((id) => archivio.delete(id));
        };
      }
    }),
};
