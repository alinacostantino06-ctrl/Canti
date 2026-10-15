// Accesso all'account e sincronizzazione con Supabase.
//
// Come funziona:
//   - i canti restano sempre salvati nel dispositivo (db.js): l'app funziona offline;
//   - quando c'è internet, le modifiche fatte qui vengono inviate all'account online
//     e quelle fatte su altri dispositivi vengono scaricate qui;
//   - se lo stesso canto è stato cambiato in due posti, vince la modifica più recente;
//   - l'accesso viene ricordato: non serve rifarlo ogni volta.
//
// Online ci sono tre tabelle (cartelle, canti, allegati) e uno spazio per i file
// ("allegati"): vedi supabase/configurazione.sql.

const BUCKET_FILE = 'allegati';
const ORDINE = ['cartelle', 'canti', 'allegati'];
const RIGHE_PER_VOLTA = 500;

// Come si traducono i record tra il dispositivo (nomi in italiano "camelCase")
// e le tabelle online (nomi con il trattino basso)
const CAMPI = {
  cartelle: {
    online: (r) => ({ id: r.id, nome: r.nome, sezione: r.sezione,
      eliminato: r.eliminato ?? null, modificato: r.modificato }),
    locale: (r) => ({ id: r.id, cancellato: !!r.cancellato, nome: r.nome, sezione: r.sezione,
      eliminato: r.eliminato == null ? null : Number(r.eliminato), modificato: Number(r.modificato) }),
  },
  canti: {
    online: (r) => ({ id: r.id, titolo: r.titolo, sezione: r.sezione, cartella: r.cartella ?? null,
      testo: r.testo ?? '', creato: r.creato ?? null, eliminato: r.eliminato ?? null,
      eliminato_con: r.eliminatoCon ?? null, modificato: r.modificato }),
    locale: (r) => ({ id: r.id, cancellato: !!r.cancellato, titolo: r.titolo, sezione: r.sezione, cartella: r.cartella,
      testo: r.testo, creato: r.creato == null ? undefined : Number(r.creato),
      eliminato: r.eliminato == null ? null : Number(r.eliminato),
      eliminatoCon: r.eliminato_con, modificato: Number(r.modificato) }),
  },
  allegati: {
    online: (r) => ({ id: r.id, canto_id: r.cantoId, nome: r.nome, tipo: r.tipo, mime: r.mime ?? null,
      eliminato: r.eliminato ?? null, modificato: r.modificato }),
    locale: (r) => ({ id: r.id, cancellato: !!r.cancellato, cantoId: r.canto_id, nome: r.nome, tipo: r.tipo, mime: r.mime,
      eliminato: r.eliminato == null ? null : Number(r.eliminato), modificato: Number(r.modificato) }),
  },
};

// Messaggi d'errore comprensibili
function spiegaErrore(err) {
  const m = String((err && (err.message || err.error_description || err.error)) || err || '');
  const soluzioneEmail = ' Si risolve in Supabase: Authentication → Sign In / Providers → Email → ' +
    'disattiva «Confirm email» e salva.';
  if (/not authorized|email_address_not_authorized/i.test(m))
    return 'Supabase non può mandare l’email di conferma a questo indirizzo.' + soluzioneEmail;
  if (/error sending|sending .*email|confirmation email/i.test(m))
    return 'Supabase non è riuscito a mandare l’email di conferma.' + soluzioneEmail;
  if (/email rate limit|over_email_send_rate_limit/i.test(m))
    return 'Supabase ha già mandato troppe email in quest’ora.' + soluzioneEmail;
  if (/invalid login credentials/i.test(m)) return 'Email o password sbagliate.';
  if (/email not confirmed/i.test(m)) return "Devi prima confermare l'email: apri il link che ti abbiamo mandato.";
  if (/already registered|already been registered|user already exists/i.test(m))
    return 'Esiste già un account con questa email: usa «Accedi».';
  if (/password should be at least|password.*(short|characters)/i.test(m))
    return 'La password deve avere almeno 6 caratteri.';
  if (/valid email|invalid email|unable to validate email/i.test(m)) return "L'email non sembra scritta bene.";
  if (/rate limit|too many/i.test(m)) return 'Troppi tentativi: riprova tra qualche minuto.';
  if (/failed to fetch|network|load failed|fetch/i.test(m)) return 'Non c’è connessione a internet.';
  return m || 'Errore sconosciuto.';
}

const Sync = {
  client: null,
  utente: null,      // { id, email } quando si è dentro l'account
  stato: 'spento',   // spento | fuori | offline | inCorso | ok | errore
  errore: '',
  ultimaVolta: null, // data e ora dell'ultima sincronizzazione riuscita
  _inCorso: false,
  _ancora: false,
  _timer: null,
  _suStato: [],
  _suDati: [],
  _suNuovaPassword: [],

  // Per essere avvisati: quando cambia lo stato / quando arrivano canti da altri dispositivi
  quandoCambiaStato(fn) { this._suStato.push(fn); },
  quandoArrivanoDati(fn) { this._suDati.push(fn); },
  // Quando si apre l'app dal link "password dimenticata" ricevuto per email
  quandoServeNuovaPassword(fn) { this._suNuovaPassword.push(fn); },

  _imposta(stato, errore = '') {
    this.stato = stato;
    this.errore = errore;
    this._suStato.forEach((fn) => fn(stato));
  },
  _datiArrivati() { this._suDati.forEach((fn) => fn()); },

  // C'è un progetto Supabase configurato in js/config.js?
  configurato() {
    return typeof CONFIG_CLOUD !== 'undefined' && !!(CONFIG_CLOUD.url && CONFIG_CLOUD.chiave && window.supabase);
  },

  // Da chiamare all'avvio dell'app. "clientDiProva" serve solo per i test.
  async avvia(clientDiProva) {
    if (!clientDiProva && !this.configurato()) return this._imposta('spento');

    this.client = clientDiProva || supabase.createClient(CONFIG_CLOUD.url, CONFIG_CLOUD.chiave, {
      auth: {
        persistSession: true,      // l'accesso resta salvato nel dispositivo
        autoRefreshToken: true,    // e si rinnova da solo
        detectSessionInUrl: true,  // per i link ricevuti per email (conferma, nuova password)
        storageKey: 'canti-accesso',
      },
    });

    this.client.auth.onAuthStateChange((evento, sessione) => {
      // (le chiamate a Supabase dentro questo avviso vanno rimandate di un attimo)
      setTimeout(async () => {
        if (evento === 'PASSWORD_RECOVERY') this._suNuovaPassword.forEach((fn) => fn());
        if (evento === 'SIGNED_IN' && sessione && (!this.utente || this.utente.id !== sessione.user.id)) {
          await this._entra(sessione.user);
          this.sincronizza();
        }
      }, 0);
    });

    // Accesso ricordato: se c'è una sessione salvata si entra subito
    const salvato = await Db.impostazione('utente');
    let sessione = null;
    let errore = null;
    try {
      const risposta = await this.client.auth.getSession();
      sessione = risposta.data.session;
      errore = risposta.error;
    } catch (e) {
      errore = e;
    }
    if (sessione) {
      await this._entra(sessione.user);
    } else if (salvato && (errore || !navigator.onLine)) {
      // Senza internet non si può rinnovare l'accesso: intanto si resta dentro con i canti salvati
      this.utente = salvato;
    }

    if (!this.utente) this._imposta('fuori');
    else this._imposta(navigator.onLine ? 'ok' : 'offline');

    // Quando sincronizzare
    Db.quandoCambia(() => this.programma());
    window.addEventListener('online', () => this.sincronizza());
    window.addEventListener('offline', () => this.utente && this._imposta('offline'));
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'visible') this.sincronizza();
    });
    setInterval(() => this.sincronizza(), 5 * 60 * 1000);

    this.sincronizza();
  },

  // Dopo l'accesso: se in questo dispositivo c'erano i canti di un altro account li tolgo,
  // se erano senza account (o dello stesso account) restano e vengono uniti all'account.
  async _entra(user) {
    const proprietario = await Db.impostazione('proprietario');
    if (proprietario && proprietario !== user.id) {
      await Db.svuotaTutto();
      this._datiArrivati();
    }
    this.utente = { id: user.id, email: user.email };
    await Db.salvaImpostazione('proprietario', user.id);
    await Db.salvaImpostazione('utente', this.utente);
  },

  async accedi(email, password) {
    const { data, error } = await this.client.auth.signInWithPassword({ email, password });
    if (error) throw new Error(spiegaErrore(error));
    await this._entra(data.user);
    this._imposta('ok');
    await this.sincronizza();
  },

  // Restituisce "dentro" se l'account è pronto, "confermaEmail" se bisogna aprire il link nell'email
  async registrati(email, password) {
    const { data, error } = await this.client.auth.signUp({
      email, password, options: { emailRedirectTo: location.origin + location.pathname },
    });
    if (error) throw new Error(spiegaErrore(error));
    // Supabase non dà errore se l'email esiste già, ma restituisce un account senza "identità"
    if (data.user && data.user.identities && data.user.identities.length === 0) {
      throw new Error(spiegaErrore('already registered'));
    }
    if (!data.session) return 'confermaEmail';
    await this._entra(data.user);
    this._imposta('ok');
    await this.sincronizza();
    return 'dentro';
  },

  async recuperaPassword(email) {
    const { error } = await this.client.auth.resetPasswordForEmail(email, {
      redirectTo: location.origin + location.pathname,
    });
    if (error) throw new Error(spiegaErrore(error));
  },

  async cambiaPassword(password) {
    const { error } = await this.client.auth.updateUser({ password });
    if (error) throw new Error(spiegaErrore(error));
  },

  // Elimina per sempre l'account e tutti i suoi dati (canti, file, condivisioni, gruppi creati).
  // Per sicurezza chiede di nuovo la password.
  async eliminaAccount(password) {
    if (!navigator.onLine) throw new Error('Per eliminare l’account serve internet.');
    const { error: errPassword } = await this.client.auth.signInWithPassword({ email: this.utente.email, password });
    if (errPassword) throw new Error(spiegaErrore(errPassword));
    clearTimeout(this._timer);
    const uid = this.utente.id;

    // 1. i file dei canti che ho mandato in privato, poi quelli dei miei canti
    const { data: privati } = await this.client.storage.from(BUCKET_FILE).list(uid + '/privati', { limit: 1000 });
    for (const cartella of privati || []) await this._svuotaCartella(BUCKET_FILE, uid + '/privati/' + cartella.name);
    await this._svuotaCartella(BUCKET_FILE, uid);

    // 2. i file che ho condiviso nei gruppi, e tutti quelli dei gruppi che ho creato
    //    (i gruppi creati da me vengono eliminati insieme all'account)
    const percorsi = [];
    const { data: mie } = await this.client.from('condivisioni').select('allegati').eq('user_id', uid);
    const { data: creati } = await this.client.from('gruppi').select('id').eq('creato_da', uid);
    const idCreati = (creati || []).map((g) => g.id);
    const { data: neiMieiGruppi } = idCreati.length
      ? await this.client.from('condivisioni').select('allegati').in('gruppo_id', idCreati)
      : { data: [] };
    const { data: librettiMiei } = idCreati.length
      ? await this.client.from('libretto').select('allegati').in('gruppo_id', idCreati)
      : { data: [] };
    for (const c of [...(mie || []), ...(neiMieiGruppi || []), ...(librettiMiei || [])]) {
      for (const f of c.allegati || []) percorsi.push(f.percorso);
    }
    for (let i = 0; i < percorsi.length; i += 100) {
      await this.client.storage.from('condivisi').remove(percorsi.slice(i, i + 100));
    }

    // 3. l'account con tutti i dati online
    const { error } = await this.client.rpc('elimina_il_mio_account');
    if (error) {
      throw new Error(/could not find the function|schema cache/i.test(error.message)
        ? 'L’eliminazione dell’account non è ancora attiva: in Supabase va eseguito il file supabase/play-store.sql.'
        : spiegaErrore(error));
    }

    // 4. questo dispositivo
    await this.client.auth.signOut({ scope: 'local' });
    await Db.svuotaTutto();
    this.utente = null;
    this.ultimaVolta = null;
    this._imposta('fuori');
    this._datiArrivati();
  },

  // Cancella tutti i file di una cartella dello spazio file (a gruppi di 100)
  async _svuotaCartella(bucket, cartella) {
    for (let giro = 0; giro < 100; giro++) {
      const { data, error } = await this.client.storage.from(bucket).list(cartella, { limit: 100 });
      if (error) throw error;
      const files = (data || []).filter((f) => f.id); // (le sottocartelle non hanno id)
      if (!files.length) return;
      const { error: errTogli } = await this.client.storage.from(bucket).remove(files.map((f) => `${cartella}/${f.name}`));
      if (errTogli) throw errTogli;
    }
  },

  // Esce dall'account e toglie i canti da questo dispositivo (restano nell'account)
  async esci() {
    clearTimeout(this._timer);
    await this.client.auth.signOut({ scope: 'local' });
    await Db.svuotaTutto();
    this.utente = null;
    this.ultimaVolta = null;
    this._imposta('fuori');
    this._datiArrivati();
  },

  // Dopo una modifica aspetto 2 secondi (così più modifiche vicine partono insieme)
  programma() {
    if (!this.utente) return;
    clearTimeout(this._timer);
    this._timer = setTimeout(() => this.sincronizza(), 2000);
  },

  // Invia le modifiche fatte qui e scarica quelle fatte altrove
  async sincronizza() {
    if (!this.client || !this.utente) return;
    if (this._inCorso) { this._ancora = true; return; }
    if (!navigator.onLine) return this._imposta('offline');

    this._inCorso = true;
    this._imposta('inCorso');
    let arrivato = false;
    try {
      const { data } = await this.client.auth.getSession();
      if (!data.session) {
        // L'accesso è scaduto (es. password cambiata altrove): bisogna rifarlo.
        // I canti restano nel dispositivo e verranno inviati dopo il nuovo accesso.
        this.utente = null;
        this._imposta('fuori', 'Accedi di nuovo per continuare a salvare i canti online.');
        return;
      }
      if (data.session.user.id !== this.utente.id) await this._entra(data.session.user);

      // Prima scarico le novità e poi invio le mie: così, se lo stesso canto è stato
      // cambiato anche altrove, confronto le date e tengo la versione più recente.
      await this._inviaEliminazioni();
      arrivato = await this._ricevi();
      await this._inviaModifiche();
      if (await this._scaricaFile()) arrivato = true;

      this.ultimaVolta = Date.now();
      this._imposta('ok');
    } catch (err) {
      console.warn('Sincronizzazione non riuscita:', err);
      this._imposta(navigator.onLine ? 'errore' : 'offline', spiegaErrore(err));
    } finally {
      this._inCorso = false;
      if (arrivato) this._datiArrivati();
      if (this._ancora) {
        this._ancora = false;
        this.programma();
      }
    }
  },

  _percorso(id) { return `${this.utente.id}/${id}`; },

  // 1. Ciò che qui è stato cancellato per sempre, lo cancello anche online.
  //    La riga resta, vuota e con il segno "cancellato": così anche gli altri
  //    dispositivi lo scoprono e lo cancellano da sé.
  async _inviaEliminazioni() {
    for (const e of await Db.eliminazioniInCoda()) {
      const segno = { cancellato: true, modificato: Date.now() };
      if (e.tabella === 'canti') segno.testo = '';
      const { error } = await this.client.from(e.tabella).update(segno).eq('id', e.id);
      if (error) throw error;
      if (e.tabella === 'allegati') {
        const risposta = await this.client.storage.from(BUCKET_FILE).remove([this._percorso(e.id)]);
        if (risposta.error) throw risposta.error;
      }
      await Db.togliDallaCoda(e.chiave);
    }
  },

  // 2. Invio i record modificati qui (prima le cartelle, poi i canti, poi i file)
  async _inviaModifiche() {
    for (const nome of ORDINE) {
      const righe = await Db.daInviare(nome);
      if (!righe.length) continue;

      if (nome === 'allegati') {
        // prima carico i file che non sono ancora online
        for (const r of righe) {
          if (!r.dati || r.fileInviato) continue;
          const tipo = r.mime || 'application/octet-stream';
          const { error } = await this.client.storage.from(BUCKET_FILE)
            .upload(this._percorso(r.id), new Blob([r.dati], { type: tipo }), { upsert: true, contentType: tipo });
          if (error) throw error;
          // segno solo che il file è online (con -1 il record resta "da inviare")
          await Db.segnaInviato('allegati', r.id, -1, { fileInviato: true });
        }
      }

      for (let i = 0; i < righe.length; i += RIGHE_PER_VOLTA) {
        const gruppo = righe.slice(i, i + RIGHE_PER_VOLTA);
        const { error } = await this.client.from(nome).upsert(gruppo.map(CAMPI[nome].online));
        if (error) throw error;
        for (const r of gruppo) await Db.segnaInviato(nome, r.id, r.modificato);
      }
    }
  },

  // 3. Scarico ciò che è cambiato online dall'ultima volta
  async _ricevi() {
    let cambiato = false;
    for (const nome of ORDINE) {
      const chiave = 'ultimoArrivo:' + nome;
      const ultimo = await Db.impostazione(chiave);
      // riparto da 10 secondi prima, per non perdere modifiche arrivate quasi insieme
      let da = ultimo ? new Date(new Date(ultimo).getTime() - 10000).toISOString() : '1970-01-01T00:00:00Z';

      for (;;) {
        const { data, error } = await this.client.from(nome).select('*')
          .gt('aggiornato', da).order('aggiornato', { ascending: true }).limit(RIGHE_PER_VOLTA);
        if (error) throw error;
        for (const riga of data) {
          if (await Db.applicaRemoto(nome, CAMPI[nome].locale(riga))) cambiato = true;
        }
        if (data.length) {
          da = data[data.length - 1].aggiornato;
          if (!ultimo || new Date(da) > new Date(ultimo)) await Db.salvaImpostazione(chiave, da);
        }
        if (data.length < RIGHE_PER_VOLTA) break;
      }
    }
    return cambiato;
  },

  // 4. Scarico i file (audio e PDF) dei canti arrivati da altri dispositivi
  async _scaricaFile() {
    let cambiato = false;
    for (const a of await Db.allegatiSenzaFile()) {
      if (a.eliminato) continue; // quelli nel cestino li scarico solo se vengono ripristinati
      const { data, error } = await this.client.storage.from(BUCKET_FILE).download(this._percorso(a.id));
      if (error) {
        console.warn('File non ancora disponibile:', a.nome, error);
        continue;
      }
      await Db.salvaFile(a.id, await data.arrayBuffer());
      cambiato = true;
    }
    return cambiato;
  },
};
