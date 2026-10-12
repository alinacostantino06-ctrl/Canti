// Logica dell'interfaccia: sezioni, cartelle, canti e file allegati.

const NOMI_SEZIONI = { prove: 'Canti prove', chiesa: 'Canti chiesa' };

// Stato dell'app: dove ci troviamo
let sezioneCorrente = 'prove';
let cartellaCorrente = null; // id della cartella aperta, null = fuori dalle cartelle
let cantoCorrente = null;    // id del canto aperto

// Riferimenti agli elementi della pagina
const $ = (id) => document.getElementById(id);
const titolo = $('titolo');
const btnIndietro = $('btn-indietro');
const btnAggiungi = $('btn-aggiungi');
const elenco = $('elenco');
const elencoCartelle = $('elenco-cartelle');
const elencoVuoto = $('elenco-vuoto');
const comandiCartella = $('comandi-cartella');
const btnNuovaCartella = $('btn-nuova-cartella');
const modulo = $('modulo');
const testoCanto = $('testo-canto');
const titoloCanto = $('titolo-canto');
const allegatiCanto = $('allegati-canto');
const filePdf = $('file-pdf');
const statoPdf = $('stato-pdf');
const fileInAttesa = $('file-in-attesa');
const schermate = {
  elenco: $('schermata-elenco'),
  modulo: $('schermata-modulo'),
  canto: $('schermata-canto'),
  cestino: $('schermata-cestino'),
};

// Chiede al browser di non cancellare mai i dati salvati (utile per gli audio,
// che occupano spazio). Se il browser non lo supporta, non succede nulla.
if (navigator.storage && navigator.storage.persist) navigator.storage.persist();

// Mostra una sola schermata alla volta
function mostra(nome, titoloBarra, conIndietro) {
  for (const [chiave, el] of Object.entries(schermate)) el.hidden = chiave !== nome;
  titolo.textContent = titoloBarra;
  btnIndietro.hidden = !conIndietro;
  btnAggiungi.hidden = nome !== 'elenco';
  window.scrollTo(0, 0);
}

// Crea un elemento con classe e testo, per scrivere meno codice
function crea(tag, classe, testo) {
  const el = document.createElement(tag);
  if (classe) el.className = classe;
  if (testo !== undefined) el.textContent = testo;
  return el;
}

// ---------- Finestrella per chiedere un nome ----------
// Restituisce il nome scritto, oppure null se si preme "Annulla".
function chiediNome(domanda, valoreIniziale = '') {
  const dialogo = $('dialogo-nome');
  const campo = $('dialogo-valore');
  $('dialogo-domanda').textContent = domanda;
  campo.value = valoreIniziale;
  dialogo.showModal();
  campo.select();

  return new Promise((resolve) => {
    const form = dialogo.querySelector('form');
    const fine = (valore) => {
      form.onsubmit = null;
      dialogo.oncancel = null;
      dialogo.close();
      resolve(valore);
    };
    // Pulsante premuto (o tasto Invio, che vale come "OK")
    form.onsubmit = (e) => {
      e.preventDefault();
      const ok = !e.submitter || e.submitter.value === 'ok';
      const nome = campo.value.trim();
      fine(ok && nome !== '' ? nome : null);
    };
    // Tasto Esc o gesto "indietro"
    dialogo.oncancel = (e) => {
      e.preventDefault();
      fine(null);
    };
  });
}

// ---------- Finestrella con più scelte ----------
// opzioni: [{ valore, testo, pericolo? }]. Restituisce il valore scelto, o null per "Annulla".
// testoAnnulla permette di cambiare la scritta dell'ultimo pulsante (es. "Ho capito").
function chiediScelta(domanda, opzioni, testoAnnulla = 'Annulla') {
  const dialogo = $('dialogo-scelta');
  const contenitore = $('scelta-opzioni');
  $('scelta-domanda').textContent = domanda;
  contenitore.innerHTML = '';

  return new Promise((resolve) => {
    const fine = (valore) => {
      dialogo.oncancel = null;
      dialogo.close();
      resolve(valore);
    };
    for (const o of [...opzioni, { valore: null, testo: testoAnnulla }]) {
      const btn = crea('button', o.valore === null ? 'btn-piccolo' : 'btn-grande', o.testo);
      if (o.pericolo) btn.classList.add('pericolo');
      btn.addEventListener('click', () => fine(o.valore));
      contenitore.append(btn);
    }
    dialogo.oncancel = (e) => {
      e.preventDefault();
      fine(null);
    };
    dialogo.showModal();
  });
}

// ---------- Avviso a comparsa ----------
let timerAvviso = null;
function avviso(testo) {
  const el = $('avviso');
  el.textContent = testo;
  el.hidden = false;
  clearTimeout(timerAvviso);
  timerAvviso = setTimeout(() => (el.hidden = true), 3500);
}

// Nome di un file senza estensione: "Santo - soprano.mp3" → "Santo - soprano"
const senzaEstensione = (nomeFile) => nomeFile.replace(/\.[^.]+$/, '');

// ---------- Elenco (cartelle + canti) ----------
async function mostraElenco() {
  cantoCorrente = null;
  const cartella = cartellaCorrente !== null ? await Db.cartella(cartellaCorrente) : null;
  if (cartellaCorrente !== null && !cartella) cartellaCorrente = null; // cartella eliminata

  mostra('elenco', cartella ? cartella.nome : NOMI_SEZIONI[sezioneCorrente], !!cartella);
  comandiCartella.hidden = !cartella;
  btnNuovaCartella.hidden = !!cartella;

  // Le cartelle si vedono solo nella "radice" della sezione
  const cartelle = cartella ? [] : await Db.cartelle(sezioneCorrente);
  elencoCartelle.innerHTML = '';
  for (const c of cartelle) {
    const btn = crea('button', 'voce-cartella', c.nome);
    btn.addEventListener('click', () => {
      cartellaCorrente = c.id;
      mostraElenco();
    });
    const li = crea('li');
    li.append(btn);
    elencoCartelle.append(li);
  }

  const canti = await Db.canti(sezioneCorrente, cartellaCorrente);
  elenco.innerHTML = '';
  let letteraPrecedente = '';
  for (const canto of canti) {
    // Intestazione con l'iniziale, come nell'indice di un libretto.
    // Se il titolo non comincia con una lettera (es. "...Qual fiore", "1. Santo")
    // al posto del simbolo si mostra il nome della sezione.
    const iniziale = canto.titolo.trim().charAt(0).toUpperCase();
    const lettera = /\p{L}/u.test(iniziale) ? iniziale : NOMI_SEZIONI[sezioneCorrente];
    if (lettera !== letteraPrecedente) {
      elenco.append(crea('li', 'lettera', lettera));
      letteraPrecedente = lettera;
    }
    const btn = crea('button', '', canto.titolo);
    btn.addEventListener('click', () => mostraCanto(canto.id));
    const li = crea('li');
    li.append(btn);
    elenco.append(li);
  }
  elencoVuoto.hidden = canti.length > 0 || cartelle.length > 0;
}

// ---------- Cartelle ----------
btnNuovaCartella.addEventListener('click', async () => {
  const nome = await chiediNome('Nome della nuova cartella');
  if (!nome) return;
  await Db.aggiungiCartella(nome, sezioneCorrente);
  mostraElenco();
});

$('btn-rinomina-cartella').addEventListener('click', async () => {
  const cartella = await Db.cartella(cartellaCorrente);
  const nome = await chiediNome('Nuovo nome della cartella', cartella.nome);
  if (!nome) return;
  await Db.rinominaCartella(cartellaCorrente, nome);
  mostraElenco();
});

$('btn-elimina-cartella').addEventListener('click', async () => {
  const cartella = await Db.cartella(cartellaCorrente);
  const scelta = await chiediScelta(`Eliminare la cartella «${cartella.nome}»?`, [
    { valore: 'tutto', testo: '🗑 Elimina la cartella e tutto quello che contiene', pericolo: true },
    { valore: 'solo', testo: 'Elimina solo la cartella (i canti restano nella sezione)' },
  ]);
  if (!scelta) return;
  await Db.eliminaCartella(cartellaCorrente, scelta === 'tutto');
  cartellaCorrente = null;
  mostraElenco();
  avviso('Cartella spostata nel cestino: puoi recuperarla per 3 giorni.');
});

// ---------- Visualizzazione canto ----------

// ---------- Riconoscimento degli accordi ----------

// Un accordo: nota (DO, Re, SOL, oppure A-G) + eventuale # o b + eventuali
// m, 7, sus4, maj7, dim, -, ecc. + eventuale basso (/MI). Le note italiane vanno
// scritte MAIUSCOLE (SOL) o con l'iniziale maiuscola (Sol): così parole come
// "la", "mi", "re" dentro il testo non vengono scambiate per accordi.
const NOTA = '(?:DO|RE|MI|FA|SOL|LA|SI|Do|Re|Mi|Fa|Sol|La|Si|[A-G])(?:#|b|♯|♭)?';
const ACCORDO = new RegExp(
  `^\\(?${NOTA}(?:maj|min|dim|aug|sus|add|m|M|\\+|-|°|ø|\\d)*(?:/${NOTA})?\\)?$`
);
// Segni che possono stare in una riga di accordi senza essere accordi: | - x2 (x2) %
const SEGNO = /^(\||-|–|%|\(?x\d+\)?|N\.?C\.?)$/i;

// Una riga è "di accordi" se contiene almeno un accordo e nient'altro che accordi o segni
function eRigaDiAccordi(riga) {
  const parole = riga.trim().split(/\s+/).filter(Boolean);
  return parole.some((p) => ACCORDO.test(p)) && parole.every((p) => ACCORDO.test(p) || SEGNO.test(p));
}

// Accordi scritti dentro il testo tra parentesi quadre: "[DO]Alle[SOL]luia"
// diventano due righe, accordi sopra e testo sotto. "[Rit.]" e simili restano testo.
function separaAccordiInLinea(riga) {
  const pezzi = riga.split(/(\[[^\]]+\])/);
  const conAccordi = pezzi.some((p) => /^\[.+\]$/.test(p) && ACCORDO.test(p.slice(1, -1)));
  if (!conAccordi) return [riga];

  let accordi = '';
  let testo = '';
  for (const pezzo of pezzi) {
    const accordo = /^\[.+\]$/.test(pezzo) && ACCORDO.test(pezzo.slice(1, -1)) ? pezzo.slice(1, -1) : null;
    if (accordo) {
      // se l'accordo precedente era lungo, sposto un po' il testo per non sovrapporli
      if (accordi.length > testo.length) testo = testo.padEnd(accordi.length, ' ');
      accordi = accordi.padEnd(testo.length, ' ') + accordo + ' ';
    } else {
      testo += pezzo;
    }
  }
  return [accordi.trimEnd(), testo];
}

// Prepara il testo: separa gli accordi in linea e dice se il canto ha accordi
function analizzaTesto(testo) {
  const righe = testo.replace(/\r/g, '').split('\n').flatMap(separaAccordiInLinea);
  return { righe, conAccordi: righe.some(eRigaDiAccordi) };
}

// Disegna il testo del canto nella pagina
function disegnaTesto(testo) {
  const { righe, conAccordi } = analizzaTesto(testo);
  testoCanto.className = 'testo-canto ' + (conAccordi ? 'con-accordi' : 'senza-accordi');
  testoCanto.innerHTML = '';

  // tolgo le righe vuote all'inizio e alla fine
  while (righe.length && righe[0].trim() === '') righe.shift();
  while (righe.length && righe[righe.length - 1].trim() === '') righe.pop();

  for (let i = 0; i < righe.length; i++) {
    const riga = righe[i];
    if (riga.trim() === '') {
      testoCanto.append(crea('div', 'stacco')); // fine strofa
    } else if (conAccordi && eRigaDiAccordi(riga)) {
      // coppia: riga di accordi + la riga di testo sotto (se c'è)
      const coppia = crea('div', 'coppia');
      coppia.append(crea('div', 'riga riga-accordi', riga));
      const dopo = righe[i + 1];
      if (dopo !== undefined && dopo.trim() !== '' && !eRigaDiAccordi(dopo)) {
        coppia.append(crea('div', 'riga', dopo));
        i++;
      }
      testoCanto.append(coppia);
    } else {
      testoCanto.append(crea('div', 'riga', conAccordi ? riga : riga.trim()));
    }
  }
  adattaLarghezza();
}

// ---------- Grandezza del testo ----------
// Scelta con i pulsanti A− / A+: vale per tutti i canti ed è ricordata nel dispositivo.
const SCALA_MIN = 0.7;
const SCALA_MAX = 2.5;
let scalaTesto = 1;
try { scalaTesto = Number(localStorage.getItem('scalaTesto')) || 1; } catch (e) { /* va bene 1 */ }

function cambiaScala(passo) {
  scalaTesto = Math.min(SCALA_MAX, Math.max(SCALA_MIN, Math.round((scalaTesto + passo) * 10) / 10));
  try { localStorage.setItem('scalaTesto', scalaTesto); } catch (e) { /* va bene lo stesso */ }
  adattaLarghezza();
}
$('btn-testo-meno').addEventListener('click', () => cambiaScala(-0.1));
$('btn-testo-piu').addEventListener('click', () => cambiaScala(+0.1));

// Calcola la grandezza del testo del canto.
// Con gli accordi le righe non vanno a capo: se la più lunga non entra nello
// schermo, parto da un carattere più piccolo che la faccia stare (non sotto
// gli 11px). Poi applico la grandezza scelta con A− / A+: se si ingrandisce
// molto, le righe con accordi si scorrono di lato.
function adattaLarghezza() {
  testoCanto.style.fontSize = '';
  let base = parseFloat(getComputedStyle(testoCanto).fontSize);
  if (testoCanto.classList.contains('con-accordi') && testoCanto.scrollWidth > 0) {
    const proporzione = testoCanto.clientWidth / testoCanto.scrollWidth;
    if (proporzione < 1) base = Math.max(11, base * proporzione);
  }
  testoCanto.style.fontSize = Math.floor(base * scalaTesto * 10) / 10 + 'px';
  $('valore-zoom').textContent = Math.round(scalaTesto * 100) + '%';
  $('btn-testo-meno').disabled = scalaTesto <= SCALA_MIN;
  $('btn-testo-piu').disabled = scalaTesto >= SCALA_MAX;
}
window.addEventListener('resize', () => {
  if (!schermate.canto.hidden) adattaLarghezza();
});

async function mostraCanto(id) {
  cantoCorrente = id;
  const canto = await Db.canto(id);
  const cartella = canto.cartella !== null ? await Db.cartella(canto.cartella) : null;
  mostra('canto', cartella ? cartella.nome : NOMI_SEZIONI[canto.sezione], true);
  titoloCanto.textContent = canto.titolo;
  disegnaTesto(canto.testo);
  mostraAllegati();
}

// ---------- Sposta canto ----------
$('btn-sposta-canto').addEventListener('click', async () => {
  const canto = await Db.canto(cantoCorrente);
  // Tutte le destinazioni possibili: ogni sezione (fuori dalle cartelle) e ogni sua cartella
  const opzioni = [];
  for (const sezione of Object.keys(NOMI_SEZIONI)) {
    opzioni.push({ valore: { sezione, cartella: null }, testo: `${NOMI_SEZIONI[sezione]} (fuori dalle cartelle)` });
    for (const c of await Db.cartelle(sezione)) {
      opzioni.push({ valore: { sezione, cartella: c.id }, testo: `${NOMI_SEZIONI[sezione]} › 📁 ${c.nome}` });
    }
  }
  // tolgo il posto in cui il canto si trova già
  const altrove = opzioni.filter((o) =>
    !(o.valore.sezione === canto.sezione && o.valore.cartella === (canto.cartella ?? null)));

  const dove = await chiediScelta(`Dove vuoi spostare «${canto.titolo}»?`, altrove);
  if (!dove) return;
  await Db.aggiornaCanto(cantoCorrente, dove);
  sezioneCorrente = dove.sezione;
  cartellaCorrente = dove.cartella;
  evidenziaSezione();
  mostraCanto(cantoCorrente);
  avviso('Canto spostato.');
});

// ---------- Modifica canto ----------
$('btn-modifica-canto').addEventListener('click', () => mostraModulo(cantoCorrente));

// Indirizzi temporanei dei file aperti: vanno liberati quando non servono più
let indirizziFile = [];

async function mostraAllegati() {
  indirizziFile.forEach((u) => URL.revokeObjectURL(u));
  indirizziFile = [];
  allegatiCanto.innerHTML = '';

  for (const a of await Db.allegati(cantoCorrente)) {
    const url = URL.createObjectURL(new Blob([a.dati], { type: a.mime }));
    indirizziFile.push(url);

    const li = crea('li', 'allegato');
    const riga = crea('div', 'allegato-riga');

    if (a.tipo === 'pdf') {
      const link = crea('a', 'allegato-nome', '📄 ' + a.nome);
      link.href = url;
      link.target = '_blank';
      riga.append(link);
    } else {
      riga.append(crea('span', 'allegato-nome', '🎵 ' + a.nome));
    }

    const rinomina = crea('button', 'btn-mini', '✎');
    rinomina.title = 'Rinomina';
    rinomina.addEventListener('click', async () => {
      const nome = await chiediNome('Nuovo nome', a.nome);
      if (!nome) return;
      await Db.rinominaAllegato(a.id, nome);
      mostraAllegati();
    });

    const elimina = crea('button', 'btn-mini', '🗑');
    elimina.title = 'Elimina';
    elimina.addEventListener('click', async () => {
      await Db.eliminaAllegato(a.id);
      mostraAllegati();
      avviso(`«${a.nome}» spostato nel cestino.`);
    });

    riga.append(rinomina, elimina);
    li.append(riga);

    if (a.tipo === 'audio') {
      const lettore = crea('audio');
      lettore.controls = true;
      lettore.preload = 'metadata';
      lettore.src = url;
      li.append(lettore);
    }
    allegatiCanto.append(li);
  }
}

// Aggiunta di audio dalla pagina del canto: per ogni file si chiede il nome
$('file-audio-canto').addEventListener('change', async (e) => {
  const files = [...e.target.files];
  e.target.value = '';
  for (const file of files) {
    const nome = await chiediNome('Come vuoi chiamare questo audio?', senzaEstensione(file.name));
    if (nome) await Db.aggiungiAllegato(cantoCorrente, nome, 'audio', file);
  }
  mostraAllegati();
});

$('btn-elimina-canto').addEventListener('click', async () => {
  const canto = await Db.canto(cantoCorrente);
  const scelta = await chiediScelta(`Eliminare «${canto.titolo}»?`, [
    { valore: 'si', testo: '🗑 Sposta nel cestino', pericolo: true },
  ]);
  if (!scelta) return;
  await Db.eliminaCanto(cantoCorrente);
  mostraElenco();
  avviso('Canto spostato nel cestino: puoi recuperarlo per 3 giorni.');
});

// ---------- Cestino ----------

// "tra 2 giorni", "tra 5 ore"...
function tempoRimasto(eliminato) {
  const ore = Math.ceil((eliminato + DURATA_CESTINO - Date.now()) / 3600000);
  if (ore > 24) {
    const giorni = Math.round(ore / 24);
    return giorni === 1 ? 'tra 1 giorno' : `tra ${giorni} giorni`;
  }
  if (ore > 1) return `tra ${ore} ore`;
  return 'a breve';
}

function descrizione(el) {
  if (el.tipo === 'cartella') {
    const canti = el.quantiCanti === 1 ? '1 canto' : `${el.quantiCanti} canti`;
    return `Cartella in ${NOMI_SEZIONI[el.sezione]} · ${canti}`;
  }
  if (el.tipo === 'canto') return `Canto in ${NOMI_SEZIONI[el.sezione]}`;
  return `${el.tipoFile === 'pdf' ? 'PDF' : 'Audio'} del canto «${el.canto}»`;
}

const ICONE = { cartella: '📁', canto: '♪', audio: '🎵', pdf: '📄' };

async function mostraCestino() {
  await Db.svuotaCestino(); // prima tolgo ciò che è scaduto
  mostra('cestino', 'Cestino', false);
  evidenziaSezione('cestino');

  const elementi = await Db.cestino();
  const lista = $('elenco-cestino');
  lista.innerHTML = '';

  for (const el of elementi) {
    const li = crea('li', 'allegato voce-cestino');
    const icona = ICONE[el.tipo === 'allegato' ? el.tipoFile : el.tipo];
    li.append(
      crea('div', 'allegato-nome', `${icona} ${el.nome}`),
      crea('div', 'dettaglio', descrizione(el)),
      crea('div', 'dettaglio scadenza', 'Si cancellerà per sempre ' + tempoRimasto(el.eliminato))
    );

    const ripristina = crea('button', 'btn-grande', '↺ Ripristina');
    ripristina.addEventListener('click', async () => {
      await Db.ripristina(el.tipo, el.id);
      avviso(`«${el.nome}» è tornato al suo posto.`);
      mostraCestino();
    });

    const cancella = crea('button', 'btn-piccolo', 'Elimina per sempre');
    cancella.addEventListener('click', async () => {
      const scelta = await chiediScelta(`Cancellare per sempre «${el.nome}»? Non si potrà più recuperare.`, [
        { valore: 'si', testo: 'Cancella per sempre', pericolo: true },
      ]);
      if (!scelta) return;
      await Db.cancellaDefinitivamente(el.tipo, el.id);
      mostraCestino();
    });

    const azioni = crea('div', 'comandi azioni-cestino');
    azioni.append(ripristina, cancella);
    li.append(azioni);
    lista.append(li);
  }

  $('cestino-vuoto').hidden = elementi.length > 0;
  $('btn-svuota-cestino').hidden = elementi.length === 0;
}

$('btn-svuota-cestino').addEventListener('click', async () => {
  const scelta = await chiediScelta('Svuotare il cestino? Tutto quello che contiene verrà cancellato per sempre.', [
    { valore: 'si', testo: 'Svuota il cestino', pericolo: true },
  ]);
  if (!scelta) return;
  await Db.svuotaCestino(true);
  mostraCestino();
});

// ---------- Nuovo canto ----------

// File scelti nel modulo ma non ancora salvati: [{ nome, tipo, file }]
let fileScelti = [];

function mostraFileScelti() {
  fileInAttesa.innerHTML = '';
  fileScelti.forEach((f, i) => {
    const li = crea('li', 'allegato');
    const riga = crea('div', 'allegato-riga');
    riga.append(crea('span', 'allegato-nome', (f.tipo === 'pdf' ? '📄 ' : '🎵 ') + f.nome));

    const rinomina = crea('button', 'btn-mini', '✎');
    rinomina.type = 'button';
    rinomina.title = 'Rinomina';
    rinomina.addEventListener('click', async () => {
      const nome = await chiediNome('Nuovo nome', f.nome);
      if (nome) f.nome = nome;
      mostraFileScelti();
    });

    const togli = crea('button', 'btn-mini', '✕');
    togli.type = 'button';
    togli.title = 'Togli';
    togli.addEventListener('click', () => {
      fileScelti.splice(i, 1);
      mostraFileScelti();
    });

    riga.append(rinomina, togli);
    li.append(riga);
    fileInAttesa.append(li);
  });
}

// Riempie la tendina "Cartella" con le cartelle della sezione scelta
async function aggiornaTendinaCartelle(selezionata = null) {
  const tendina = modulo.cartella;
  tendina.innerHTML = '';
  tendina.append(new Option('— Nessuna cartella —', ''));
  for (const c of await Db.cartelle(modulo.sezione.value)) {
    tendina.append(new Option(c.nome, c.id, false, c.id === selezionata));
  }
}

// Canto che si sta modificando (null = si sta creando un canto nuovo)
let idInModifica = null;

// Senza id: modulo vuoto per un canto nuovo. Con id: modulo con i dati del canto da modificare.
async function mostraModulo(id = null) {
  idInModifica = typeof id === 'number' ? id : null;
  modulo.reset();
  filePdf.value = '';
  fileScelti = [];
  mostraFileScelti();
  scriviStatoPdf('Il testo verrà letto in automatico: controllalo e poi salva.');

  // Importazione PDF e allegati solo per i canti nuovi:
  // per quelli esistenti i file si gestiscono dalla pagina del canto
  $('blocco-importa').hidden = idInModifica !== null;
  $('campo-allegati').hidden = idInModifica !== null;
  $('btn-salva').textContent = idInModifica !== null ? 'Salva modifiche' : 'Salva canto';

  if (idInModifica !== null) {
    const canto = await Db.canto(idInModifica);
    modulo.titolo.value = canto.titolo;
    modulo.sezione.value = canto.sezione;
    modulo.testo.value = canto.testo;
    await aggiornaTendinaCartelle(canto.cartella);
    mostra('modulo', 'Modifica canto', true);
  } else {
    modulo.sezione.value = sezioneCorrente;
    await aggiornaTendinaCartelle(cartellaCorrente);
    mostra('modulo', 'Nuovo canto', true);
    modulo.titolo.focus();
  }
  aggiornaInfoAccordi();
}

modulo.sezione.addEventListener('change', () => aggiornaTendinaCartelle());

// Mentre si scrive, l'app dice se ha trovato accordi o no
function aggiornaInfoAccordi() {
  const testo = modulo.testo.value;
  $('info-accordi').textContent = testo.trim() === ''
    ? ''
    : analizzaTesto(testo).conAccordi
      ? '🎸 Accordi riconosciuti: verranno mostrati sopra il testo.'
      : '📖 Nessun accordo trovato: il testo verrà mostrato centrato.';
}
modulo.testo.addEventListener('input', aggiornaInfoAccordi);

$('file-audio-modulo').addEventListener('change', async (e) => {
  const files = [...e.target.files];
  e.target.value = '';
  for (const file of files) {
    const nome = await chiediNome('Come vuoi chiamare questo audio?', senzaEstensione(file.name));
    if (nome) fileScelti.push({ nome, tipo: 'audio', file });
  }
  mostraFileScelti();
});

// ---------- Importazione da PDF ----------
function scriviStatoPdf(messaggio, errore = false) {
  statoPdf.textContent = messaggio;
  statoPdf.classList.toggle('errore', errore);
}

filePdf.addEventListener('change', async () => {
  const file = filePdf.files[0];
  if (!file) return;
  filePdf.value = '';
  scriviStatoPdf('Sto leggendo il PDF…');

  try {
    const testo = await leggiTestoPdf(file);
    if (testo === '') {
      scriviStatoPdf(
        'Questo PDF non contiene testo leggibile (probabilmente è una foto o una scansione).',
        true
      );
    } else {
      // Titolo: la prima riga che non è di accordi, altrimenti il nome del file
      const primaRiga = testo.split('\n').find((r) => r.trim() !== '' && !eRigaDiAccordi(r));
      modulo.titolo.value = (primaRiga || senzaEstensione(file.name)).trim();
      // Se il titolo è proprio la prima riga del testo, lo tolgo per non ripeterlo
      modulo.testo.value =
        primaRiga && testo.startsWith(primaRiga) ? testo.slice(primaRiga.length).trimStart() : testo;
      scriviStatoPdf('Fatto! Controlla titolo e testo qui sotto, poi tocca «Salva canto».');
      aggiornaInfoAccordi();
    }
  } catch (err) {
    console.error(err);
    scriviStatoPdf('Non sono riuscita a leggere questo PDF.', true);
    return;
  }

  // Il PDF originale viene tenuto come allegato del canto, col nome che si sceglie
  const nome = await chiediNome('Come vuoi chiamare questo PDF?', senzaEstensione(file.name));
  if (nome) {
    fileScelti = fileScelti.filter((f) => f.tipo !== 'pdf'); // un solo PDF per canto
    fileScelti.push({ nome, tipo: 'pdf', file });
    mostraFileScelti();
  }
});

modulo.addEventListener('submit', async (e) => {
  e.preventDefault();
  const canto = {
    titolo: modulo.titolo.value.trim(),
    sezione: modulo.sezione.value,
    cartella: modulo.cartella.value === '' ? null : Number(modulo.cartella.value),
    testo: modulo.testo.value,
  };
  let id = idInModifica;
  if (id !== null) {
    await Db.aggiornaCanto(id, canto);
  } else {
    id = await Db.aggiungiCanto(canto);
    for (const f of fileScelti) await Db.aggiungiAllegato(id, f.nome, f.tipo, f.file);
  }
  idInModifica = null;

  // Dopo il salvataggio, apro il canto
  sezioneCorrente = canto.sezione;
  cartellaCorrente = canto.cartella;
  evidenziaSezione();
  mostraCanto(id);
});

// ---------- Navigazione ----------
// Colora la voce attiva nella barra in basso ("prove", "chiesa" o "cestino")
function evidenziaSezione(voce = sezioneCorrente) {
  document.querySelectorAll('.barra-bassa button').forEach((b) => {
    b.classList.toggle('attivo', b.dataset.sezione === voce);
  });
}

document.querySelectorAll('.barra-bassa button').forEach((b) => {
  b.addEventListener('click', () => {
    if (b.dataset.sezione === 'cestino') return mostraCestino();
    sezioneCorrente = b.dataset.sezione;
    cartellaCorrente = null;
    evidenziaSezione();
    mostraElenco();
  });
});

btnAggiungi.addEventListener('click', () => mostraModulo());

// "Indietro": dalla modifica si torna al canto; dal canto o dal modulo all'elenco;
// da una cartella alla sezione
btnIndietro.addEventListener('click', () => {
  if (!schermate.modulo.hidden && idInModifica !== null) {
    mostraCanto(idInModifica);
  } else if (schermate.elenco.hidden) {
    mostraElenco();
  } else {
    cartellaCorrente = null;
    mostraElenco();
  }
});

// ---------- Tema chiaro / scuro ----------
// Se non si è mai scelto, segue l'impostazione del telefono/PC.
// La scelta viene ricordata in questo dispositivo.
const btnTema = $('btn-tema');
const sistemaScuro = window.matchMedia('(prefers-color-scheme: dark)');

function temaAttuale() {
  return document.documentElement.dataset.tema || (sistemaScuro.matches ? 'scuro' : 'chiaro');
}

function aggiornaPulsanteTema() {
  const scuro = temaAttuale() === 'scuro';
  btnTema.textContent = scuro ? '☀' : '☾';
  btnTema.title = scuro ? 'Passa al tema chiaro' : 'Passa al tema scuro';
  document.querySelector('meta[name=theme-color]').content = scuro ? '#5a141b' : '#6e1a22';
}

btnTema.addEventListener('click', () => {
  const nuovo = temaAttuale() === 'scuro' ? 'chiaro' : 'scuro';
  document.documentElement.dataset.tema = nuovo;
  try { localStorage.setItem('tema', nuovo); } catch (e) { /* va bene lo stesso */ }
  aggiornaPulsanteTema();
});
sistemaScuro.addEventListener('change', aggiornaPulsanteTema);
aggiornaPulsanteTema();

// ---------- Pagina iniziale ----------
// Toccando "Canta con noi" la pagina rossa sfuma e appare l'elenco dei canti
$('btn-entra').addEventListener('click', () => {
  $('pagina-iniziale').classList.add('chiusa');
});

// ---------- Funzionamento offline e installazione ----------

// Registra il service worker (sw.js), che salva l'app nel dispositivo
if ('serviceWorker' in navigator) {
  const avevaGiaUnaVersione = !!navigator.serviceWorker.controller;
  navigator.serviceWorker.register('sw.js').catch((err) => console.warn('Offline non disponibile:', err));
  // Quando arriva una versione nuova dell'app, lo diciamo (ma non la prima volta)
  navigator.serviceWorker.addEventListener('controllerchange', () => {
    if (avevaGiaUnaVersione) avviso('App aggiornata! Chiudila e riaprila per vedere le novità.');
  });
}

const btnInstalla = $('btn-installa');
const giaInstallata = () =>
  window.matchMedia('(display-mode: standalone)').matches || navigator.standalone === true;
const suIphone = /iphone|ipad|ipod/i.test(navigator.userAgent) ||
  (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1); // iPad recenti

// Android e PC (Chrome, Edge, Samsung Internet): il browser ci avvisa quando
// l'app si può installare, e noi mostriamo il pulsante
let richiestaInstallazione = null;
window.addEventListener('beforeinstallprompt', (e) => {
  e.preventDefault();
  richiestaInstallazione = e;
  btnInstalla.hidden = false;
});
window.addEventListener('appinstalled', () => {
  btnInstalla.hidden = true;
  richiestaInstallazione = null;
  avviso('App installata! La trovi tra le app del dispositivo.');
});

// iPhone e iPad: non esiste un pulsante automatico, quindi spieghiamo i passaggi
if (suIphone && !giaInstallata()) btnInstalla.hidden = false;

btnInstalla.addEventListener('click', async () => {
  if (richiestaInstallazione) {
    richiestaInstallazione.prompt();
    await richiestaInstallazione.userChoice;
    richiestaInstallazione = null;
    btnInstalla.hidden = true;
  } else if (suIphone) {
    await chiediScelta(
      "Per scaricare l'app su iPhone o iPad:\n\n" +
      '1. Apri questa pagina con Safari\n' +
      '2. Tocca il pulsante Condividi (il quadrato con la freccia in su)\n' +
      '3. Scegli «Aggiungi alla schermata Home»\n' +
      '4. Tocca «Aggiungi»',
      [],
      'Ho capito'
    );
  }
});

// Avvio: prima si cancella dal cestino ciò che ha più di 3 giorni,
// e lo si ricontrolla ogni ora finché l'app resta aperta.
Db.svuotaCestino().finally(mostraElenco);
setInterval(() => Db.svuotaCestino(), 60 * 60 * 1000);
