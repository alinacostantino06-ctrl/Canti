// Gruppi per condividere i canti (con Supabase, vedi supabase/gruppi.sql).
//
//   - si crea un gruppo e si ottiene un codice di 6 lettere da dare agli altri;
//   - chi ha il codice entra nel gruppo e ne vede la "chat";
//   - nella chat ogni messaggio è un canto completo (testo, audio, spartiti, PDF)
//     con un breve messaggio facoltativo;
//   - chi lo riceve può salvarlo tra i propri canti, nella cartella che preferisce.
//
// I gruppi funzionano solo con internet e con l'accesso fatto (usano Sync.client).

const BUCKET_CONDIVISI = 'condivisi';
const CONDIVISIONI_DA_MOSTRARE = 200;

function spiegaErroreGruppi(err) {
  const m = String((err && (err.message || err.error_description)) || err || '');
  if (/codice non valido/i.test(m)) return 'Codice non valido: controlla le lettere e riprova.';
  if (/manca il nome/i.test(m)) return 'Scrivi un nome per il gruppo.';
  if (/solo chi ha creato/i.test(m)) return 'Solo chi ha creato il gruppo può farlo.';
  if (/limite gruppi gratuiti/i.test(m))
    return 'Puoi stare al massimo in 2 gruppi gratuiti. Esci da uno dei tuoi gruppi per entrare in un altro (i gruppi Coro non contano).';
  if (/prova già usata/i.test(m)) return 'Hai già usato la prova gratuita della versione Coro.';
  if (/resta direttore/i.test(m)) return 'Chi ha creato il gruppo resta sempre direttore.';
  if (/row-level security|violates/i.test(m))
    return 'Non è possibile: solo il direttore può farlo, e serve la versione Coro attiva nel gruppo.';
  if (/does not exist|could not find the function|schema cache/i.test(m))
    return 'I gruppi non sono ancora attivi: in Supabase va eseguito il file supabase/gruppi.sql.';
  return spiegaErrore(err);
}

// Se qualcosa va storto, l'errore ha già un messaggio comprensibile
async function conMessaggio(promessa) {
  const { data, error } = await promessa;
  if (error) throw new Error(spiegaErroreGruppi(error));
  return data;
}

const Gruppi = {
  // Si possono usare i gruppi adesso?
  disponibili() { return !!(Sync.client && Sync.utente); },
  online() { return navigator.onLine; },

  // Il nome con cui gli altri ti vedono nei gruppi (salvato nel dispositivo)
  async mioNome() { return (await Db.impostazione('mioNome')) || ''; },
  async salvaMioNome(nome) { await Db.salvaImpostazione('mioNome', nome); },

  async miei() {
    const righe = await conMessaggio(Sync.client.from('gruppi').select('*'));
    return righe.sort((a, b) => a.nome.localeCompare(b.nome, 'it'));
  },

  // conProva = true: il gruppo nasce come Coro con 7 giorni di prova gratuita
  crea: (nome, mioNome, conProva = false) =>
    conMessaggio(Sync.client.rpc('crea_gruppo', conProva
      ? { nome_gruppo: nome, mio_nome: mioNome, con_prova: true }
      : { nome_gruppo: nome, mio_nome: mioNome })),

  entra: (codice, mioNome) =>
    conMessaggio(Sync.client.rpc('entra_nel_gruppo', { codice_gruppo: codice, mio_nome: mioNome })),

  esci: (gruppoId) =>
    conMessaggio(Sync.client.from('membri').delete().eq('gruppo_id', gruppoId).eq('user_id', Sync.utente.id)),

  async membri(gruppoId) {
    const righe = await conMessaggio(Sync.client.from('membri').select('*').eq('gruppo_id', gruppoId));
    return righe.sort((a, b) => a.nome.localeCompare(b.nome, 'it'));
  },

  // Gli ultimi canti condivisi nel gruppo, dal più vecchio al più recente (come in una chat).
  // Non mostro quelli delle persone che ho bloccato né quelli che ho segnalato.
  async condivisioni(gruppoId) {
    const [righe, nascosti] = await Promise.all([
      conMessaggio(Sync.client.from('condivisioni').select('*')
        .eq('gruppo_id', gruppoId).order('creato', { ascending: false }).limit(CONDIVISIONI_DA_MOSTRARE)),
      this._daNascondere(),
    ]);
    return righe.filter((c) => !nascosti.persone.has(c.user_id) && !nascosti.canti.has(c.id)).reverse();
  },

  async _daNascondere() {
    const bloccati = await this.bloccati();
    return {
      persone: new Set(bloccati.map((b) => b.bloccato_id)),
      canti: new Set((await Db.impostazione('segnalatiDaMe')) || []),
    };
  },

  // ---------- Sicurezza: segnalazioni, blocchi, moderazione ----------

  // Chi ha creato il gruppo ne è il moderatore
  sonoCreatore(gruppo) { return !!(gruppo && Sync.utente && gruppo.creato_da === Sync.utente.id); },

  // Segnala un canto condiviso (ne viene salvata una copia per chi controlla le segnalazioni)
  async segnala(c, motivo) {
    await conMessaggio(Sync.client.from('segnalazioni').insert({
      gruppo_id: c.gruppo_id, condivisione_id: c.id, segnalato_user_id: c.user_id,
      autore: c.autore, titolo: c.titolo, messaggio: c.messaggio, testo: c.testo, motivo,
    }));
    const segnalati = (await Db.impostazione('segnalatiDaMe')) || [];
    await Db.salvaImpostazione('segnalatiDaMe', [...segnalati, c.id]);
  },

  // Persone bloccate (se la tabella non c'è ancora, nessuna)
  async bloccati() {
    const { data, error } = await Sync.client.from('bloccati').select('bloccato_id,nome');
    return error ? [] : data;
  },
  blocca: (userId, nome) =>
    conMessaggio(Sync.client.from('bloccati').upsert({ user_id: Sync.utente.id, bloccato_id: userId, nome })),
  sblocca: (userId) =>
    conMessaggio(Sync.client.from('bloccati').delete().eq('user_id', Sync.utente.id).eq('bloccato_id', userId)),

  // Solo per chi ha creato il gruppo
  rimuoviMembro: (gruppoId, userId) =>
    conMessaggio(Sync.client.from('membri').delete().eq('gruppo_id', gruppoId).eq('user_id', userId)),
  nuovoCodice: (gruppoId) => conMessaggio(Sync.client.rpc('nuovo_codice', { gruppo: gruppoId })),

  // ======================= Versione Coro =======================

  // Il gruppo ha la versione Coro attiva?
  coroAttivo(g) { return !!(g && g.coro_fino_al && new Date(g.coro_fino_al) > new Date()); },

  async provaGiaUsata() {
    const { data, error } = await Sync.client.rpc('prova_gia_usata');
    return error ? true : !!data;
  },
  iniziaProva: (gruppoId) => conMessaggio(Sync.client.rpc('inizia_prova_coro', { gruppo: gruppoId })),

  // Il mio ruolo e la mia voce in un gruppo
  async mioPosto(gruppoId) {
    const { data } = await Sync.client.from('membri').select('*').eq('gruppo_id', gruppoId).eq('user_id', Sync.utente.id);
    const io = (data && data[0]) || {};
    return { ruolo: io.ruolo || 'corista', voce: io.voce || '' };
  },
  sonoDirettore(g) { return !!g && (g.creato_da === Sync.utente.id || g.mioRuolo === 'direttore'); },

  impostaVoce: (gruppoId, voce) => conMessaggio(Sync.client.rpc('imposta_mia_voce', { gruppo: gruppoId, nuova_voce: voce })),
  impostaRuolo: (gruppoId, persona, ruolo) =>
    conMessaggio(Sync.client.rpc('imposta_ruolo', { gruppo: gruppoId, persona, nuovo_ruolo: ruolo })),

  // ---- Bacheca: avvisi del direttore (gli ultimi 100, dal più vecchio al più nuovo) ----
  async avvisi(gruppoId) {
    const { data, error } = await Sync.client.from('avvisi').select('*')
      .eq('gruppo_id', gruppoId).order('creato', { ascending: false }).limit(100);
    return error ? [] : data.reverse();
  },
  async pubblicaAvviso(gruppoId, testo) {
    await conMessaggio(Sync.client.from('avvisi').insert({
      gruppo_id: gruppoId, user_id: Sync.utente.id, autore: (await this.mioNome()) || 'Il direttore', testo,
    }));
    Notifiche.invia(gruppoId, 'avviso', testo);
  },
  eliminaAvviso: (id) => conMessaggio(Sync.client.from('avvisi').delete().eq('id', id)),

  // ---- Carico i file di un canto in uno spazio del gruppo ----
  // vociFile: { [id del file sul mio dispositivo]: 'soprano' | 'contralto' | 'tenore' | 'basso' | '' (per tutti) }
  async _caricaFile(cartella, files, avanzamento, vociFile = {}) {
    const caricati = [];
    for (let i = 0; i < files.length; i++) {
      const a = files[i];
      avanzamento('Invio dei file: ' + (i + 1) + ' di ' + files.length + '…');
      const id = nuovoId();
      const percorso = cartella + '/' + id;
      const tipo = a.mime || 'application/octet-stream';
      const { error } = await Sync.client.storage.from(BUCKET_CONDIVISI)
        .upload(percorso, new Blob([a.dati], { type: tipo }), { contentType: tipo });
      if (error) {
        if (caricati.length) await Sync.client.storage.from(BUCKET_CONDIVISI).remove(caricati.map((f) => f.percorso));
        throw new Error(spiegaErroreGruppi(error));
      }
      caricati.push({ id, nome: a.nome, tipo: a.tipo, mime: a.mime || null, percorso, voce: vociFile[a.id] || '' });
    }
    return caricati;
  },

  // ---- Libretto del coro ----
  async libretto(gruppoId) {
    const righe = await conMessaggio(Sync.client.from('libretto').select('*').eq('gruppo_id', gruppoId));
    return righe.sort((a, b) => a.titolo.localeCompare(b.titolo, 'it'));
  },

  // Aggiunge al libretto uno dei miei canti (con i suoi file)
  async aggiungiAlLibretto(gruppoId, cantoId, avanzamento = () => {}, vociFile = {}) {
    const canto = await Db.canto(cantoId);
    const files = (await Db.allegati(cantoId)).filter((a) => a.dati);
    const id = nuovoId();
    const allegati = await this._caricaFile(gruppoId + '/libretto/' + id, files, avanzamento, vociFile);
    avanzamento('Aggiungo il canto al libretto…');
    try {
      await conMessaggio(Sync.client.from('libretto').insert({
        id, gruppo_id: gruppoId, titolo: canto.titolo, sezione: canto.sezione, testo: canto.testo || '',
        allegati, canto_origine: cantoId,
      }));
    } catch (err) {
      if (allegati.length) await Sync.client.storage.from(BUCKET_CONDIVISI).remove(allegati.map((f) => f.percorso));
      throw err;
    }
    Notifiche.invia(gruppoId, 'libretto', canto.titolo);
  },

  // Rimette nel libretto la versione attuale del canto del direttore da cui viene
  async aggiornaNelLibretto(voce, avanzamento = () => {}, vociFile = {}) {
    const canto = voce.canto_origine && (await Db.canto(voce.canto_origine));
    if (!canto || canto.eliminato) throw new Error('Il canto originale non è più tra i tuoi canti: non si può aggiornare.');
    const files = (await Db.allegati(canto.id)).filter((a) => a.dati);
    const allegati = await this._caricaFile(voce.gruppo_id + '/libretto/' + voce.id, files, avanzamento, vociFile);
    await conMessaggio(Sync.client.from('libretto').update({
      titolo: canto.titolo, sezione: canto.sezione, testo: canto.testo || '', allegati,
    }).eq('id', voce.id));
    // i file sono nuovi: le correzioni fatte sui vecchi non valgono più
    await Sync.client.from('correzioni').delete().eq('libretto_id', voce.id);
    const vecchi = (voce.allegati || []).map((f) => f.percorso);
    if (vecchi.length) await Sync.client.storage.from(BUCKET_CONDIVISI).remove(vecchi);
  },

  // Cambia per quale voce è ogni file di un canto del libretto (i file restano gli stessi)
  // vociPerFile: { [id del file nel libretto]: voce }
  impostaVociLibretto: (voce, vociPerFile) =>
    conMessaggio(Sync.client.from('libretto').update({
      allegati: (voce.allegati || []).map((f) => ({ ...f, voce: vociPerFile[f.id] || '' })),
    }).eq('id', voce.id)),

  async rimuoviDalLibretto(voce) {
    await conMessaggio(Sync.client.from('libretto').delete().eq('id', voce.id));
    const percorsi = (voce.allegati || []).map((f) => f.percorso);
    if (percorsi.length) await Sync.client.storage.from(BUCKET_CONDIVISI).remove(percorsi);
  },

  // ---- Scalette ----
  async scalette(gruppoId) {
    const { data, error } = await Sync.client.from('scalette').select('*').eq('gruppo_id', gruppoId);
    if (error) return [];
    return data.sort((a, b) => String(b.data || '').localeCompare(String(a.data || '')) || a.titolo.localeCompare(b.titolo, 'it'));
  },
  async salvaScaletta(gruppoId, scaletta) {
    const riga = { gruppo_id: gruppoId, titolo: scaletta.titolo, data: scaletta.data || null, voci: scaletta.voci };
    if (scaletta.id) await conMessaggio(Sync.client.from('scalette').update(riga).eq('id', scaletta.id));
    else {
      await conMessaggio(Sync.client.from('scalette').insert({ id: nuovoId(), ...riga, creato_da: Sync.utente.id }));
      Notifiche.invia(gruppoId, 'scaletta', scaletta.titolo);
    }
  },
  eliminaScaletta: (id) => conMessaggio(Sync.client.from('scalette').delete().eq('id', id)),

  // ---- Copia dei libretti su questo dispositivo (per usarli offline) ----
  // Scarica i canti nuovi o cambiati del libretto di ogni gruppo Coro attivo, toglie quelli
  // rimossi, e salva le scalette e il mio posto nel coro. Restituisce true se è cambiato qualcosa.
  async aggiornaLibretti(avanzamento = () => {}) {
    if (!this.disponibili() || !navigator.onLine) return false;
    const gruppi = await this.miei();
    const idGruppi = new Set(gruppi.map((g) => g.id));
    let cambiato = false;

    // libretti dei gruppi da cui sono uscito (o che non esistono più): via
    for (const gid of await Db.gruppiConLibretto()) {
      if (!idGruppi.has(gid)) {
        await Db.togliLibretto(gid);
        await Db.salvaImpostazione('coro:' + gid, null);
        cambiato = true;
      }
    }

    for (const g of gruppi) {
      const attivo = this.coroAttivo(g);
      const posto = await this.mioPosto(g.id);
      const ruolo = g.creato_da === Sync.utente.id ? 'direttore' : posto.ruolo;
      await Db.salvaImpostazione('coro:' + g.id, {
        nome: g.nome, attivo, fino: g.coro_fino_al, ruolo, voce: posto.voce,
      });
      if (!attivo) continue; // scaduto: tengo la copia che c'è, ma non la aggiorno

      // I direttori ricevono tutti i file; gli altri, se hanno scelto la loro voce,
      // solo quelli della loro voce e quelli per tutti
      const filtro = ruolo === 'direttore' ? '' : posto.voce || '';
      const perMe = (f) => !filtro || !f.voce || f.voce === filtro;

      const remoti = await this.libretto(g.id);
      const locali = new Map((await Db.librettoInCache(g.id)).map((c) => [c.id, c]));
      for (const voce of remoti) {
        const locale = locali.get(voce.id);
        if (locale && locale.libretto.aggiornato === voce.aggiornato && locale.libretto.nomeGruppo === g.nome &&
            (locale.libretto.filtro || '') === filtro && locale.cartella === Db.idCartellaLibretto(g.id)) continue;
        avanzamento('Scarico il libretto: «' + voce.titolo + '»…');
        // i file che ho già (stesso id) non li riscarico
        const giaQui = new Map((await Db.allegati(voce.id)).filter((a) => a.dati).map((a) => [a.id, a.dati]));
        const files = [];
        for (const f of (voce.allegati || []).filter(perMe)) {
          if (giaQui.has(f.id)) {
            files.push({ ...f, dati: giaQui.get(f.id) });
            continue;
          }
          const { data, error } = await Sync.client.storage.from(BUCKET_CONDIVISI).download(f.percorso);
          if (!error) files.push({ ...f, dati: await data.arrayBuffer() });
        }
        await Db.salvaCantoLibretto(g, voce, files, filtro);
        cambiato = true;
      }
      // le correzioni del direttore sugli spartiti (anche per usarle senza internet)
      const correzioni = {};
      for (const c of await this.correzioni(g.id)) {
        (correzioni[c.libretto_id] = correzioni[c.libretto_id] || {})[c.allegato_id] = c.segni || [];
      }
      await Db.salvaImpostazione('correzioni:' + g.id, correzioni);
      const daTenere = new Set(remoti.map((v) => v.id));
      for (const id of locali.keys()) {
        if (!daTenere.has(id)) {
          await Db.togliCantoLibretto(id);
          cambiato = true;
        }
      }
      if (await Db.togliCartelleLibrettoVecchie(g.id)) cambiato = true;
      await Db.salvaImpostazione('scalette:' + g.id, await this.scalette(g.id));
    }
    return cambiato;
  },

  // ---- Messaggi privati (versione Coro): li vedono solo chi scrive e chi riceve ----
  async messaggiPrivati(gruppoId) {
    const [righe, nascosti] = await Promise.all([
      conMessaggio(Sync.client.from('messaggi_privati').select('*')
        .eq('gruppo_id', gruppoId).order('creato', { ascending: false }).limit(500)),
      this._daNascondere(),
    ]);
    return righe.filter((m) => !nascosti.persone.has(m.da) && !nascosti.canti.has(m.id)).reverse();
  },
  async scriviPrivato(gruppoId, a, testo) {
    await conMessaggio(Sync.client.from('messaggi_privati').insert({ gruppo_id: gruppoId, da: Sync.utente.id, a, testo }));
    Notifiche.invia(gruppoId, 'privato', testo, a);
  },
  eliminaPrivato: (id) => conMessaggio(Sync.client.from('messaggi_privati').delete().eq('id', id)),
  segnaLetti: (gruppoId, persona) => Sync.client.rpc('segna_letti', { gruppo: gruppoId, persona }),
  // Segnala un messaggio privato (se ne salva una copia per chi controlla le segnalazioni)
  async segnalaPrivato(m, autore, motivo) {
    await conMessaggio(Sync.client.from('segnalazioni').insert({
      gruppo_id: m.gruppo_id, segnalato_user_id: m.da, autore, titolo: 'Messaggio privato', messaggio: m.testo, motivo,
    }));
    const segnalati = (await Db.impostazione('segnalatiDaMe')) || [];
    await Db.salvaImpostazione('segnalatiDaMe', [...segnalati, m.id]);
  },
  // Quanti messaggi privati non ho ancora letto, per gruppo
  async privatiNonLetti() {
    const { data, error } = await Sync.client.from('messaggi_privati').select('id,gruppo_id,da')
      .eq('a', Sync.utente.id).is('letto', null);
    if (error) return {};
    const nascosti = await this._daNascondere();
    const conteggi = {};
    for (const m of data) {
      if (nascosti.persone.has(m.da) || nascosti.canti.has(m.id)) continue;
      conteggi[m.gruppo_id] = (conteggi[m.gruppo_id] || 0) + 1;
    }
    return conteggi;
  },

  // ---- Correzioni del direttore sugli spartiti del libretto (il PDF originale non cambia) ----
  async correzioni(gruppoId) {
    const { data, error } = await Sync.client.from('correzioni').select('libretto_id,allegato_id,segni').eq('gruppo_id', gruppoId);
    return error ? [] : data;
  },
  async correzioniDi(librettoId) {
    const { data, error } = await Sync.client.from('correzioni').select('allegato_id,segni').eq('libretto_id', librettoId);
    if (error) return null;
    return Object.fromEntries(data.map((c) => [c.allegato_id, c.segni || []]));
  },
  salvaCorrezioni: (gruppoId, librettoId, allegatoId, segni) =>
    conMessaggio(Sync.client.from('correzioni').upsert({ gruppo_id: gruppoId, libretto_id: librettoId, allegato_id: allegatoId, segni })),
  // Le correzioni "in diretta" mentre si guarda un canto: quandoCambia(riga) a ogni modifica
  ascoltaCorrezioni(librettoId, quandoCambia) {
    const canale = Sync.client.channel('correzioni-' + librettoId)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'correzioni', filter: `libretto_id=eq.${librettoId}` },
        (cambio) => quandoCambia(cambio.new && cambio.new.allegato_id ? cambio.new : null))
      .subscribe();
    return () => Sync.client.removeChannel(canale);
  },

  // Manda un canto nel gruppo: prima carico i file, poi il messaggio.
  // "avanzamento" riceve un testo da mostrare mentre si caricano i file.
  async condividi(gruppoId, cantoId, messaggio, avanzamento = () => {}) {
    const canto = await Db.canto(cantoId);
    const files = (await Db.allegati(cantoId)).filter((a) => a.dati); // quelli ancora "in arrivo" no
    const id = nuovoId();
    const caricati = [];
    try {
      for (let i = 0; i < files.length; i++) {
        const a = files[i];
        avanzamento(`Invio dei file: ${i + 1} di ${files.length}…`);
        const percorso = `${gruppoId}/${id}/${a.id}`;
        const tipo = a.mime || 'application/octet-stream';
        const { error } = await Sync.client.storage.from(BUCKET_CONDIVISI)
          .upload(percorso, new Blob([a.dati], { type: tipo }), { contentType: tipo });
        if (error) throw new Error(spiegaErroreGruppi(error));
        caricati.push({ nome: a.nome, tipo: a.tipo, mime: a.mime || null, percorso });
      }
      avanzamento('Invio del canto…');
      // Il nome da mostrare: quello salvato qui o, se manca (es. nuovo dispositivo), quello
      // con cui si è entrati nel gruppo. Mai l'email, che deve restare privata.
      let autore = await this.mioNome();
      if (!autore) {
        const { data } = await Sync.client.from('membri').select('nome')
          .eq('gruppo_id', gruppoId).eq('user_id', Sync.utente.id);
        autore = (data && data[0] && data[0].nome) || 'Senza nome';
      }
      await conMessaggio(Sync.client.from('condivisioni').insert({
        id, gruppo_id: gruppoId, autore,
        messaggio: messaggio || '', titolo: canto.titolo, sezione: canto.sezione,
        testo: canto.testo || '', allegati: caricati,
      }));
      Notifiche.invia(gruppoId, 'canto', canto.titolo + (messaggio ? ' — ' + messaggio : ''));
    } catch (err) {
      // se non è andata, tolgo i file già caricati
      if (caricati.length) await Sync.client.storage.from(BUCKET_CONDIVISI).remove(caricati.map((f) => f.percorso));
      throw err;
    }
  },

  // Toglie dalla chat un canto che ho condiviso io
  async elimina(condivisione) {
    await conMessaggio(Sync.client.from('condivisioni').delete().eq('id', condivisione.id));
    const percorsi = (condivisione.allegati || []).map((f) => f.percorso);
    if (percorsi.length) await Sync.client.storage.from(BUCKET_CONDIVISI).remove(percorsi);
  },

  // Salva tra i miei canti un canto ricevuto, nella sezione/cartella scelta.
  // Restituisce l'id del nuovo canto.
  async salva(condivisione, dove, avanzamento = () => {}) {
    const lista = condivisione.allegati || [];
    // prima scarico tutti i file: se manca internet non salvo un canto a metà
    const files = [];
    for (let i = 0; i < lista.length; i++) {
      const f = lista[i];
      avanzamento(`Scarico i file: ${i + 1} di ${lista.length}…`);
      const { data, error } = await Sync.client.storage.from(BUCKET_CONDIVISI).download(f.percorso);
      if (error) throw new Error(spiegaErroreGruppi(error));
      files.push({ ...f, file: new File([data], f.nome, { type: f.mime || data.type || '' }) });
    }
    const cantoId = await Db.aggiungiCanto({
      titolo: condivisione.titolo, sezione: dove.sezione, cartella: dove.cartella, testo: condivisione.testo,
    });
    for (const f of files) await Db.aggiungiAllegato(cantoId, f.nome, f.tipo, f.file);

    const salvati = (await Db.impostazione('salvatiDaiGruppi')) || [];
    await Db.salvaImpostazione('salvatiDaiGruppi', [...salvati, condivisione.id]);
    return cantoId;
  },

  async giaSalvati() { return new Set((await Db.impostazione('salvatiDaiGruppi')) || []); },

  // Chat "in diretta": avvisa quando nel gruppo arriva (o viene tolto) un canto.
  // Restituisce una funzione per smettere di ascoltare.
  ascolta(gruppoId, quandoCambia) {
    const canale = Sync.client.channel('gruppo-' + gruppoId)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'condivisioni', filter: `gruppo_id=eq.${gruppoId}` },
        () => quandoCambia())
      .on('postgres_changes', { event: '*', schema: 'public', table: 'avvisi', filter: `gruppo_id=eq.${gruppoId}` },
        () => quandoCambia())
      .on('postgres_changes', { event: '*', schema: 'public', table: 'messaggi_privati', filter: `a=eq.${Sync.utente.id}` },
        () => quandoCambia())
      .subscribe();
    return () => Sync.client.removeChannel(canale);
  },

  // Quando ho guardato per l'ultima volta la chat di un gruppo
  // (chat e bacheca lo aggiornano entrambe: tengo sempre il momento più recente)
  async segnaVisto(gruppoId, quando) {
    const prima = await Db.impostazione('visto:' + gruppoId);
    if (!prima || new Date(quando) > new Date(prima)) await Db.salvaImpostazione('visto:' + gruppoId, quando);
  },

  // Quanti canti nuovi (mandati da altri e non ancora visti) ci sono in ogni gruppo
  async novita(gruppi) {
    if (!gruppi.length) return {};
    const visti = {};
    for (const g of gruppi) visti[g.id] = (await Db.impostazione('visto:' + g.id)) || g.creato;
    const piuVecchio = new Date(Math.min(...Object.values(visti).map((v) => new Date(v).getTime()))).toISOString();
    const righe = await conMessaggio(Sync.client.from('condivisioni').select('id,gruppo_id,user_id,creato')
      .neq('user_id', Sync.utente.id).gt('creato', piuVecchio));
    const nascosti = await this._daNascondere();
    const { data: avvisi } = await Sync.client.from('avvisi').select('id,gruppo_id,user_id,creato')
      .neq('user_id', Sync.utente.id).gt('creato', piuVecchio);
    righe.push(...(avvisi || []));
    const conteggi = await this.privatiNonLetti();
    for (const r of righe) {
      if (nascosti.persone.has(r.user_id) || nascosti.canti.has(r.id)) continue;
      if (visti[r.gruppo_id] && new Date(r.creato) > new Date(visti[r.gruppo_id])) {
        conteggi[r.gruppo_id] = (conteggi[r.gruppo_id] || 0) + 1;
      }
    }
    return conteggi;
  },
};
