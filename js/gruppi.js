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

  // ---- Avvisi del direttore ----
  async avvisi(gruppoId) {
    const { data, error } = await Sync.client.from('avvisi').select('*')
      .eq('gruppo_id', gruppoId).order('creato', { ascending: false }).limit(5);
    return error ? [] : data;
  },
  async pubblicaAvviso(gruppoId, testo) {
    await conMessaggio(Sync.client.from('avvisi').insert({
      gruppo_id: gruppoId, user_id: Sync.utente.id, autore: (await this.mioNome()) || 'Il direttore', testo,
    }));
  },
  eliminaAvviso: (id) => conMessaggio(Sync.client.from('avvisi').delete().eq('id', id)),

  // ---- Carico i file di un canto in uno spazio del gruppo ----
  async _caricaFile(cartella, files, avanzamento) {
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
      caricati.push({ id, nome: a.nome, tipo: a.tipo, mime: a.mime || null, percorso });
    }
    return caricati;
  },

  // ---- Libretto del coro ----
  async libretto(gruppoId) {
    const righe = await conMessaggio(Sync.client.from('libretto').select('*').eq('gruppo_id', gruppoId));
    return righe.sort((a, b) => a.titolo.localeCompare(b.titolo, 'it'));
  },

  // Aggiunge al libretto uno dei miei canti (con i suoi file)
  async aggiungiAlLibretto(gruppoId, cantoId, avanzamento = () => {}) {
    const canto = await Db.canto(cantoId);
    const files = (await Db.allegati(cantoId)).filter((a) => a.dati);
    const id = nuovoId();
    const allegati = await this._caricaFile(gruppoId + '/libretto/' + id, files, avanzamento);
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
  },

  // Rimette nel libretto la versione attuale del canto del direttore da cui viene
  async aggiornaNelLibretto(voce, avanzamento = () => {}) {
    const canto = voce.canto_origine && (await Db.canto(voce.canto_origine));
    if (!canto || canto.eliminato) throw new Error('Il canto originale non è più tra i tuoi canti: non si può aggiornare.');
    const files = (await Db.allegati(canto.id)).filter((a) => a.dati);
    const allegati = await this._caricaFile(voce.gruppo_id + '/libretto/' + voce.id, files, avanzamento);
    await conMessaggio(Sync.client.from('libretto').update({
      titolo: canto.titolo, sezione: canto.sezione, testo: canto.testo || '', allegati,
    }).eq('id', voce.id));
    const vecchi = (voce.allegati || []).map((f) => f.percorso);
    if (vecchi.length) await Sync.client.storage.from(BUCKET_CONDIVISI).remove(vecchi);
  },

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
    else await conMessaggio(Sync.client.from('scalette').insert({ id: nuovoId(), ...riga, creato_da: Sync.utente.id }));
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
      await Db.salvaImpostazione('coro:' + g.id, {
        nome: g.nome, attivo, fino: g.coro_fino_al,
        ruolo: g.creato_da === Sync.utente.id ? 'direttore' : posto.ruolo, voce: posto.voce,
      });
      if (!attivo) continue; // scaduto: tengo la copia che c'è, ma non la aggiorno

      const remoti = await this.libretto(g.id);
      const locali = new Map((await Db.librettoInCache(g.id)).map((c) => [c.id, c]));
      for (const voce of remoti) {
        const locale = locali.get(voce.id);
        if (locale && locale.libretto.aggiornato === voce.aggiornato && locale.libretto.nomeGruppo === g.nome &&
            locale.cartella === Db.idCartellaLibretto(g.id)) continue;
        avanzamento('Scarico il libretto: «' + voce.titolo + '»…');
        const files = [];
        for (const f of voce.allegati || []) {
          const { data, error } = await Sync.client.storage.from(BUCKET_CONDIVISI).download(f.percorso);
          if (!error) files.push({ ...f, dati: await data.arrayBuffer() });
        }
        await Db.salvaCantoLibretto(g, voce, files);
        cambiato = true;
      }
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
      .subscribe();
    return () => Sync.client.removeChannel(canale);
  },

  // Quando ho guardato per l'ultima volta la chat di un gruppo
  segnaVisto: (gruppoId, quando) => Db.salvaImpostazione('visto:' + gruppoId, quando),

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
    const conteggi = {};
    for (const r of righe) {
      if (nascosti.persone.has(r.user_id) || nascosti.canti.has(r.id)) continue;
      if (visti[r.gruppo_id] && new Date(r.creato) > new Date(visti[r.gruppo_id])) {
        conteggi[r.gruppo_id] = (conteggi[r.gruppo_id] || 0) + 1;
      }
    }
    return conteggi;
  },
};
