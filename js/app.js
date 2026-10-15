// Logica dell'interfaccia: sezioni, cartelle, canti e file allegati.

// Una volta c'erano due sezioni ("Canti prove" e "Canti chiesa"): ora è un elenco unico
const NOME_ELENCO = 'Canti';

// Stato dell'app: dove ci troviamo
let sezioneCorrente = 'canti'; // voce attiva nella barra in basso
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
const statoPdf = $('stato-pdf');
const fileInAttesa = $('file-in-attesa');
const schermate = {
  elenco: $('schermata-elenco'),
  modulo: $('schermata-modulo'),
  canto: $('schermata-canto'),
  cestino: $('schermata-cestino'),
  account: $('schermata-account'),
  gruppi: $('schermata-gruppi'),
  chat: $('schermata-chat'),
  scaletta: $('schermata-scaletta'),
};

// Chiede al browser di non cancellare mai i dati salvati (utile per gli audio,
// che occupano spazio). Se il browser non lo supporta, non succede nulla.
if (navigator.storage && navigator.storage.persist) navigator.storage.persist();

// Mostra una sola schermata alla volta
function mostra(nome, titoloBarra, conIndietro) {
  if (nome !== 'chat') lasciaChat();
  if (nome !== 'elenco') {
    $('alfabeto').hidden = true;
    document.body.classList.remove('con-alfabeto');
  }
  if (nome !== 'canto' && nome !== 'scaletta') percorsoScaletta = null;
  if (nome !== 'canto') {
    fermaCorrezioni();
    cantoEsterno = null;
  }
  for (const [chiave, el] of Object.entries(schermate)) el.hidden = chiave !== nome;
  titolo.textContent = titoloBarra;
  btnIndietro.hidden = !conIndietro;
  btnAggiungi.hidden = nome !== 'elenco';
  window.scrollTo(0, 0);
  ricordaPosizione(nome);
}

// La schermata che si sta guardando adesso
const schermataAttuale = () => Object.keys(schermate).find((k) => !schermate[k].hidden) || 'elenco';

// Crea un elemento con classe e testo, per scrivere meno codice
function crea(tag, classe, testo) {
  const el = document.createElement(tag);
  if (classe) el.className = classe;
  if (testo !== undefined) el.textContent = testo;
  return el;
}

// ---------- Finestrella per chiedere un nome ----------
// Restituisce il nome scritto, oppure null se si preme "Annulla".
// Con { password: true } quello che si scrive viene nascosto.
// Con { facoltativo: true } si può confermare anche senza scrivere niente (restituisce "").
function chiediNome(domanda, valoreIniziale = '', opzioni = {}) {
  const dialogo = $('dialogo-nome');
  const campo = $('dialogo-valore');
  $('dialogo-domanda').textContent = domanda;
  campo.type = opzioni.password ? 'password' : 'text';
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
      fine(!ok ? null : nome !== '' ? nome : opzioni.facoltativo ? '' : null);
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
// Testo "semplificato" per confrontare: senza accenti e senza maiuscole ("È" → "e")
const semplifica = (t) => String(t || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();

// La lettera dell'indice di un titolo: "Èccomi" → "E"; "...Qual fiore", "1. Santo" → "#"
function letteraDi(titolo) {
  const iniziale = semplifica(titolo.trim().charAt(0)).toUpperCase();
  return /^[A-Z]$/.test(iniziale) ? iniziale : '#';
}

// Testo cercato nella barra di ricerca (resta quando si apre un canto e si torna indietro)
let ricerca = '';
const campoRicerca = $('cerca-canti');

async function mostraElenco() {
  cantoCorrente = null;
  const cartella = cartellaCorrente !== null ? await Db.cartella(cartellaCorrente) : null;
  if (cartellaCorrente !== null && !cartella) cartellaCorrente = null; // cartella eliminata

  mostra('elenco', cartella ? cartella.nome : NOME_ELENCO, !!cartella);
  comandiCartella.hidden = !cartella || !!cartella.libretto;
  btnNuovaCartella.hidden = !!cartella;
  await mostraInfoLibretto(cartella);

  campoRicerca.placeholder = cartella ? 'Cerca in questa cartella…' : 'Cerca canti e cartelle…';
  if (campoRicerca.value !== ricerca) campoRicerca.value = ricerca;
  const cercato = semplifica(ricerca.trim());

  // Cartelle: si vedono solo nella schermata principale
  let cartelle = cartella ? [] : await Db.cartelle();
  if (cercato) cartelle = cartelle.filter((c) => semplifica(c.nome).includes(cercato));
  elencoCartelle.innerHTML = '';
  for (const c of cartelle) {
    const btn = crea('button', 'voce-cartella', c.nome);
    btn.addEventListener('click', () => {
      cartellaCorrente = c.id;
      ricerca = '';
      mostraElenco();
    });
    const li = crea('li');
    li.append(btn);
    elencoCartelle.append(li);
  }

  // Canti: cercando dalla schermata principale si cerca in tutti, cartelle comprese
  let canti;
  if (cercato) {
    const dove = cartella ? await Db.canti(cartellaCorrente) : await Db.tuttiPerRicerca();
    canti = dove.filter((c) => semplifica(c.titolo).includes(cercato));
  } else {
    canti = await Db.canti(cartellaCorrente);
  }
  const nomiCartelle = cercato && !cartella
    ? new Map((await Db.cartelle()).map((c) => [c.id, c.nome]))
    : new Map();

  elenco.innerHTML = '';
  let letteraPrecedente = '';
  for (const canto of canti) {
    // Intestazione con l'iniziale, come nell'indice di un libretto (non durante la ricerca).
    // Se il titolo non comincia con una lettera si mostra il nome dell'elenco.
    if (!cercato) {
      const lettera = letteraDi(canto.titolo);
      if (lettera !== letteraPrecedente) {
        const intestazione = crea('li', 'lettera', lettera === '#' ? NOME_ELENCO : lettera);
        intestazione.dataset.lettera = lettera;
        elenco.append(intestazione);
        letteraPrecedente = lettera;
      }
    }
    const btn = crea('button', '', canto.titolo);
    if (cercato && canto.cartella && nomiCartelle.has(canto.cartella)) {
      btn.append(crea('span', 'dove-sta', '📁 ' + nomiCartelle.get(canto.cartella)));
    }
    btn.addEventListener('click', () => mostraCanto(canto.id));
    const li = crea('li');
    li.append(btn);
    elenco.append(li);
  }

  elencoVuoto.hidden = cercato || canti.length > 0 || cartelle.length > 0;
  $('nessun-risultato').hidden = !cercato || canti.length > 0 || cartelle.length > 0;
  if (cercato) $('nessun-risultato').textContent = 'Nessun canto o cartella trovati per «' + ricerca.trim() + '».';
  preparaAlfabeto(cercato ? [] : canti);
}

// ---------- Ricerca ----------
let timerRicerca = null;
campoRicerca.addEventListener('input', () => {
  clearTimeout(timerRicerca);
  timerRicerca = setTimeout(() => {
    ricerca = campoRicerca.value;
    mostraElenco();
  }, 150);
});
// "Invio" sulla tastiera del telefono: chiude la tastiera
campoRicerca.addEventListener('keydown', (e) => {
  if (e.key === 'Enter') campoRicerca.blur();
});

// ---------- Alfabeto laterale "a rotella" ----------
// Si trascina il dito sulle lettere: l'elenco scorre alla lettera e al centro dello schermo
// compare la lettera grande. Le lettere senza canti portano alla successiva che ne ha.
const LETTERE = ['#', ...'ABCDEFGHIJKLMNOPQRSTUVWXYZ'];
const alfabeto = $('alfabeto');
const letteraGrande = $('lettera-grande');
let lettereElenco = [];   // le lettere che hanno canti, in ordine
let letteraAttuale = null;

function preparaAlfabeto(canti) {
  lettereElenco = [...new Set(canti.map((c) => letteraDi(c.titolo)))];
  const mostrare = lettereElenco.length >= 2;
  alfabeto.hidden = !mostrare;
  document.body.classList.toggle('con-alfabeto', mostrare);
  if (!mostrare) return;
  alfabeto.innerHTML = '';
  for (const l of LETTERE) {
    const span = crea('span', lettereElenco.includes(l) ? 'presente' : '', l);
    span.dataset.lettera = l;
    alfabeto.append(span);
  }
}

// Porta l'elenco alla lettera (o alla prima lettera con canti che viene dopo)
function vaiAllaLettera(l) {
  const indice = LETTERE.indexOf(l);
  const destinazione = lettereElenco.find((x) => LETTERE.indexOf(x) >= indice) || lettereElenco[lettereElenco.length - 1];
  if (!destinazione || destinazione === letteraAttuale) return;
  letteraAttuale = destinazione;
  const intestazione = elenco.querySelector(`.lettera[data-lettera="${destinazione}"]`);
  if (!intestazione) return;
  const altezzaBarra = document.querySelector('.barra-alta').offsetHeight;
  window.scrollTo(0, intestazione.getBoundingClientRect().top + window.scrollY - altezzaBarra - 8);
  letteraGrande.textContent = destinazione === '#' ? '#' : destinazione;
  letteraGrande.hidden = false;
  alfabeto.querySelectorAll('span').forEach((s) => s.classList.toggle('scelta', s.dataset.lettera === destinazione));
  if (navigator.vibrate) navigator.vibrate(8); // piccolo "scatto", come una rotella
}

// La lettera sotto il dito, in base all'altezza
function letteraSotto(y) {
  const r = alfabeto.getBoundingClientRect();
  const i = Math.floor(((y - r.top) / r.height) * LETTERE.length);
  return LETTERE[Math.max(0, Math.min(LETTERE.length - 1, i))];
}

alfabeto.addEventListener('pointerdown', (e) => {
  e.preventDefault();
  try { alfabeto.setPointerCapture(e.pointerId); } catch (err) { /* va bene lo stesso */ }
  alfabeto.classList.add('in-uso');
  letteraAttuale = null;
  vaiAllaLettera(letteraSotto(e.clientY));
});
alfabeto.addEventListener('pointermove', (e) => {
  if (!alfabeto.classList.contains('in-uso')) return;
  e.preventDefault();
  vaiAllaLettera(letteraSotto(e.clientY));
});
function fineAlfabeto() {
  alfabeto.classList.remove('in-uso');
  letteraGrande.hidden = true;
  alfabeto.querySelectorAll('.scelta').forEach((s) => s.classList.remove('scelta'));
}
alfabeto.addEventListener('pointerup', fineAlfabeto);
alfabeto.addEventListener('pointercancel', fineAlfabeto);

// ---------- Cartelle ----------
btnNuovaCartella.addEventListener('click', async () => {
  const nome = await chiediNome('Nome della nuova cartella');
  if (!nome) return;
  await Db.aggiungiCartella(nome);
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

// Un PDF di spartito (pentagramma, chiavi, note) letto come testo dà "lettere a caso":
// simboli musicali, lettere singole, parole senza vocali. Se la maggior parte delle
// "parole" è così, probabilmente è uno spartito e va mostrato com'è.
function sembraSpartito(testo) {
  if (/[\uE000-\uF8FF]/.test(testo)) return true; // i caratteri dei font musicali moderni
  const parole = testo.split(/\s+/).filter(Boolean);
  if (parole.length === 0) return false;
  const vere = parole.filter((p) =>
    ACCORDO.test(p) || (/^[\p{L}'’,.;:!?«»"()\-]{2,}$/u.test(p) && /[aeiouàèéìòùy]/i.test(p)));
  return vere.length / parole.length < 0.5;
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
const SCALA_MAX = 4;
let scalaTesto = 1;
try { scalaTesto = Number(localStorage.getItem('scalaTesto')) || 1; } catch (e) { /* va bene 1 */ }

const entroLimiti = (s) => Math.min(SCALA_MAX, Math.max(SCALA_MIN, Math.round(s * 10) / 10));

function impostaScala(nuova) {
  scalaTesto = entroLimiti(nuova);
  try { localStorage.setItem('scalaTesto', scalaTesto); } catch (e) { /* va bene lo stesso */ }
  adattaLarghezza();
  ridisegnaSpartiti();
}
const cambiaScala = (passo) => impostaScala(scalaTesto + passo);
$('btn-testo-meno').addEventListener('click', () => cambiaScala(-0.1));
$('btn-testo-piu').addEventListener('click', () => cambiaScala(+0.1));

// ---------- Ingrandire con due dita: solo il PDF / il testo, non tutta l'app ----------
// Mentre si allargano le dita il contenuto si ingrandisce "al volo"; quando si staccano,
// il PDF viene ridisegnato nitido alla nuova grandezza (come con A− / A+).
const zonaCanto = $('schermata-canto');
let pizzico = null;
const distanzaDita = (t) => Math.hypot(t[0].clientX - t[1].clientX, t[0].clientY - t[1].clientY);

zonaCanto.addEventListener('touchstart', (e) => {
  if (e.touches.length !== 2) return;
  e.preventDefault();
  const centroX = (e.touches[0].clientX + e.touches[1].clientX) / 2;
  const centroY = (e.touches[0].clientY + e.touches[1].clientY) / 2;
  const elementi = [spartitiCanto, testoCanto].filter((el) => el.offsetHeight > 0);
  for (const el of elementi) {
    const r = el.getBoundingClientRect();
    el.style.transformOrigin = `${centroX - r.left}px ${centroY - r.top}px`;
  }
  pizzico = { inizio: distanzaDita(e.touches), scala0: scalaTesto, scala: scalaTesto, elementi };
}, { passive: false });

zonaCanto.addEventListener('touchmove', (e) => {
  if (!pizzico || e.touches.length !== 2) return;
  e.preventDefault();
  pizzico.scala = entroLimiti(pizzico.scala0 * distanzaDita(e.touches) / pizzico.inizio);
  const fattore = pizzico.scala / pizzico.scala0;
  for (const el of pizzico.elementi) el.style.transform = `scale(${fattore})`;
}, { passive: false });

function finePizzico() {
  if (!pizzico) return;
  const { scala, elementi } = pizzico;
  pizzico = null;
  for (const el of elementi) el.style.transform = '';
  if (scala !== scalaTesto) impostaScala(scala);
}
zonaCanto.addEventListener('touchend', (e) => { if (e.touches.length < 2) finePizzico(); });
zonaCanto.addEventListener('touchcancel', finePizzico);

// iPhone/iPad: Safari ingrandirebbe comunque tutta la pagina; lo blocco
document.addEventListener('gesturestart', (e) => e.preventDefault());
document.addEventListener('gesturechange', (e) => e.preventDefault());

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
  if (schermate.canto.hidden) return;
  adattaLarghezza();
  ridisegnaSpartiti();
});

// I file del canto aperto (uno dei miei, del libretto, oppure uno condiviso aperto dalla chat)
const allegatiAperti = async () =>
  cantoEsterno ? cantoEsterno.allegati : cantoCorrente ? Db.allegati(cantoCorrente) : [];

// ---------- Aprire un canto condiviso (nel gruppo o in privato) senza salvarlo ----------
// est: { titolo, testo, allegati (con percorso), gruppo, origine: { tipo, rif }, puoCorreggere,
//        nota, ritorno: { scheda, con }, altro (in privato: l'altra persona) }
let cantoEsterno = null;
const fileScaricati = new Map(); // percorso → dati (per non riscaricarli ogni volta)
const idFile = (f) => f.id || f.percorso.split('/').pop();

async function apriCantoEsterno(est) {
  if (!navigator.onLine) return avviso('📴 Per aprire i canti della chat serve internet.');
  const lista = est.allegati || [];
  const allegati = [];
  try {
    for (let i = 0; i < lista.length; i++) {
      const f = lista[i];
      if (!fileScaricati.has(f.percorso)) {
        avviso('Scarico i file: ' + (i + 1) + ' di ' + lista.length + '…');
        fileScaricati.set(f.percorso, await (await Gruppi.scaricaFile(f)).arrayBuffer());
      }
      allegati.push({ id: idFile(f), nome: f.nome, tipo: f.tipo, mime: f.mime, voce: f.voce || '', dati: fileScaricati.get(f.percorso) });
    }
  } catch (err) {
    return avviso('⚠ ' + err.message);
  }
  $('avviso').hidden = true;
  cantoEsterno = { ...est, allegati };
  cantoCorrente = 'esterno';
  mostra('canto', gruppoCorrente ? gruppoCorrente.nome : NOME_ELENCO, true);
  cantoEsterno = { ...est, allegati }; // (mostra() lo toglie solo uscendo dal canto)
  titoloCanto.textContent = est.titolo;
  $('nota-libretto').hidden = !est.nota;
  $('nota-libretto').textContent = est.nota || '';
  for (const el of ['etichetta-audio-canto', 'etichetta-spartito-canto']) $(el).hidden = true;
  document.querySelector('.comandi-fondo').hidden = true;
  disegnaTesto(est.testo || '');
  preparaCorrezioniEsterne(cantoEsterno);
  mostraAllegati();
  aggiornaNavScaletta(null);
}

// Dal canto aperto dalla chat si torna alla chat (o alla conversazione privata)
function tornaDaEsterno() {
  const { ritorno } = cantoEsterno;
  schedaRichiesta = ritorno.scheda;
  conversazioneRichiesta = ritorno.con || null;
  if (gruppoCorrente) apriChat(gruppoCorrente);
  else mostraGruppi();
}

async function mostraCanto(id) {
  cantoEsterno = null;
  const canto = await Db.canto(id);
  if (!canto) {
    avviso('Questo canto non è più disponibile su questo dispositivo.');
    return mostraElenco();
  }
  cantoCorrente = id;
  const cartella = canto.cartella !== null ? await Db.cartella(canto.cartella) : null;
  mostra('canto', cartella ? cartella.nome : NOME_ELENCO, true);
  titoloCanto.textContent = canto.titolo;

  // I canti del libretto di un coro si leggono soltanto: li cura il direttore
  const delLibretto = !!canto.libretto;
  $('nota-libretto').hidden = !delLibretto;
  if (delLibretto) $('nota-libretto').textContent = '📖 Dal libretto del coro «' + canto.libretto.nomeGruppo + '»: lo cura il direttore.';
  for (const el of ['etichetta-audio-canto', 'etichetta-spartito-canto']) $(el).hidden = delLibretto;
  document.querySelector('.comandi-fondo').hidden = delLibretto;

  disegnaTesto(canto.testo);
  await preparaCorrezioni(delLibretto ? canto : null);
  mostraAllegati();
  aggiornaNavScaletta(id);
}

// ---------- Sposta canto ----------
$('btn-sposta-canto').addEventListener('click', async () => {
  const canto = await Db.canto(cantoCorrente);
  const opzioni = [{ valore: { cartella: null }, testo: 'Fuori dalle cartelle' }];
  for (const c of (await Db.cartelle()).filter((x) => !x.libretto)) {
    opzioni.push({ valore: { cartella: c.id }, testo: '📁 ' + c.nome });
  }
  // tolgo il posto in cui il canto si trova già
  const altrove = opzioni.filter((o) => o.valore.cartella !== (canto.cartella ?? null));
  const dove = await chiediScelta('Dove vuoi spostare «' + canto.titolo + '»?', altrove);
  if (!dove) return;
  await Db.aggiornaCanto(cantoCorrente, dove);
  cartellaCorrente = dove.cartella;
  mostraCanto(cantoCorrente);
  avviso('Canto spostato.');
});

// ---------- Condividi canto in un gruppo ----------
$('btn-condividi-canto').addEventListener('click', () => condividiCanto(cantoCorrente));

// ---------- Modifica canto ----------
$('btn-modifica-canto').addEventListener('click', () => mostraModulo(cantoCorrente));

// Indirizzi temporanei dei file aperti: vanno liberati quando non servono più
let indirizziFile = [];

const ICONA_FILE = { audio: '🎵', pdf: '📄', spartito: '📄' };

async function mostraAllegati() {
  indirizziFile.forEach((u) => URL.revokeObjectURL(u));
  indirizziFile = [];
  allegatiCanto.innerHTML = '';

  const canto = cantoEsterno || (await Db.canto(cantoCorrente));
  const delLibretto = !!(canto && (canto.libretto || cantoEsterno)); // (si guardano soltanto)
  const voce = await voceDaUsare(canto);
  const laMiaVoce = (a) => !!voce && (a.voce ? a.voce === voce : a.tipo === 'audio' && a.nome.toLowerCase().includes(voce));
  const lista = [...(await allegatiAperti())].sort((x, y) => laMiaVoce(y) - laMiaVoce(x));

  for (const a of lista) {
    // Un file arrivato da un altro dispositivo può essere ancora in download
    const url = a.dati ? URL.createObjectURL(new Blob([a.dati], { type: a.mime })) : null;
    if (url) indirizziFile.push(url);

    const li = crea('li', 'allegato');
    const riga = crea('div', 'allegato-riga');

    if (!url) {
      riga.append(crea('span', 'allegato-nome', `${ICONA_FILE[a.tipo] || '📄'} ${a.nome} · ⏳ in arrivo…`));
    } else if (a.tipo === 'pdf') {
      const link = crea('a', 'allegato-nome', '📄 ' + a.nome);
      link.href = url;
      link.target = '_blank';
      riga.append(link);
    } else {
      riga.append(crea('span', 'allegato-nome', `${ICONA_FILE[a.tipo] || '🎵'} ${a.nome}` +
        (laMiaVoce(a) ? ' · 🎤 la tua voce' : a.voce ? ' · 🎤 ' + (VOCI[a.voce] || a.voce) : '')));
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

    if (!delLibretto) riga.append(rinomina, elimina);
    li.append(riga);

    if (a.tipo === 'audio' && url) {
      const lettore = crea('audio');
      lettore.controls = true;
      lettore.preload = 'metadata';
      lettore.src = url;
      li.append(lettore);
    }
    allegatiCanto.append(li);
  }
  disegnaSpartiti();
}

// ---------- Spartiti ----------
// Le pagine del PDF (o la foto) vengono disegnate a tutta larghezza, così come sono.
// Con A− / A+ si rimpiccioliscono o ingrandiscono (e si scorrono di lato).

const spartitiCanto = $('spartiti-canto');
let disegnoInCorso = 0; // per fermare un disegno vecchio se nel frattempo si cambia canto

async function disegnaSpartiti() {
  const mio = ++disegnoInCorso;
  const spartiti = (await allegatiAperti()).filter((a) => a.tipo === 'spartito' || a.tipo === 'pdf');
  if (mio !== disegnoInCorso) return;
  spartitiCanto.innerHTML = '';
  spartitiCanto.style.setProperty('--scala', scalaTesto);

  // (misuro la pagina del canto: il contenitore degli spartiti, finché è vuoto, è nascosto)
  const larghezza = Math.floor(schermate.canto.clientWidth * scalaTesto);
  const densita = Math.min(window.devicePixelRatio || 1, 3);

  for (const a of spartiti) {
    const blocco = crea('div', 'spartito');
    spartitiCanto.append(blocco);
    if (!a.dati) {
      blocco.append(crea('p', 'dettaglio', `🎼 ${a.nome} · ⏳ in arrivo…`));
      continue;
    }

    // Foto o immagine
    if (a.mime && a.mime.startsWith('image/')) {
      const url = URL.createObjectURL(new Blob([a.dati], { type: a.mime }));
      indirizziFile.push(url);
      const img = crea('img');
      img.alt = 'Spartito: ' + a.nome;
      img.style.width = larghezza + 'px';
      const foglio = foglioPerPagina(a.id, 1, img);
      img.onload = () => {
        const strato = foglio.querySelector('.strato-correzioni');
        strato.width = Math.floor(larghezza * densita);
        strato.height = Math.floor(larghezza * densita * img.naturalHeight / img.naturalWidth);
        disegnaStrato(foglio);
      };
      img.src = url;
      blocco.append(foglio);
      continue;
    }

    // PDF: una pagina alla volta
    try {
      // pdf.js "consuma" i dati che riceve: gli passo una copia
      const pdf = await pdfjsLib.getDocument({ data: new Uint8Array(a.dati.slice(0)) }).promise;
      for (let n = 1; n <= pdf.numPages; n++) {
        if (mio !== disegnoInCorso) return pdf.destroy();
        const pagina = await pdf.getPage(n);
        const base = pagina.getViewport({ scale: 1 });
        const vista = pagina.getViewport({ scale: (larghezza / base.width) * densita });
        const tela = crea('canvas');
        tela.width = Math.floor(vista.width);
        tela.height = Math.floor(vista.height);
        tela.style.width = larghezza + 'px';
        tela.setAttribute('aria-label', `Spartito: ${a.nome}, pagina ${n}`);
        const foglio = foglioPerPagina(a.id, n, tela, tela.width, tela.height);
        blocco.append(foglio);
        disegnaStrato(foglio);
        await pagina.render({ canvasContext: tela.getContext('2d'), viewport: vista }).promise;
      }
      pdf.destroy();
      aggiornaComandiCorrezioni();
    } catch (err) {
      console.error(err);
      blocco.append(crea('p', 'dettaglio', `Non è stato possibile mostrare lo spartito «${a.nome}».`));
    }
  }
}

// Dopo A− / A+ o un cambio di larghezza, ridisegno (aspettando un attimo)
let timerSpartiti = null;
function ridisegnaSpartiti() {
  if (!spartitiCanto.querySelector('.spartito')) return;
  clearTimeout(timerSpartiti);
  timerSpartiti = setTimeout(disegnaSpartiti, 250);
}

// ---------- Correzioni del direttore sopra lo spartito ----------
// Si può scrivere sopra i PDF e le foto (penna, evidenziatore, parole) dei canti del libretto
// (i direttori), dei canti condivisi nel gruppo (chi l'ha condiviso e i direttori) e dei canti
// mandati in privato (le due persone). Il file originale non viene mai cambiato: le correzioni
// sono un "foglio trasparente" appoggiato sopra, salvato a parte. Chi guarda le vede in diretta,
// e con «Vedi l'originale» si può togliere il foglio trasparente.

// Il canto aperto: { gruppo, origine: { tipo, rif }, perAllegato: { [id del file]: [segni] }, puoCorreggere }
let correzioni = null;
let modoCorrezione = false;
let strumento = { tipo: 'penna', colore: '#d0021b' };
let tratto = null;            // il tratto che si sta disegnando adesso
let smettiCorrezioni = null;  // per smettere di ascoltare le correzioni in diretta
let cronologiaCorrezioni = []; // per «annulla»
let correzioniCambiate = false;
const salvataggiCorrezioni = new Map(); // id del file → timer
const GRANDEZZE = { penna: 0.004, evidenziatore: 0.022, testo: 0.035 }; // in proporzione alla larghezza della pagina

const copia = (x) => JSON.parse(JSON.stringify(x));
const ciSonoCorrezioni = () => !!correzioni && Object.values(correzioni.perAllegato).some((s) => s && s.length);

// Prepara le correzioni del canto del libretto appena aperto
async function preparaCorrezioni(canto) {
  fermaCorrezioni();
  correzioni = null;
  $('comandi-correzioni').hidden = true;
  spartitiCanto.classList.remove('senza-correzioni');
  if (!canto || !canto.libretto) return;
  const gid = canto.libretto.gruppo;
  const salvate = ((await Db.impostazione('correzioni:' + gid)) || {})[canto.id] || {};
  const puoCorreggere = await sonoDirettoreDel(gid);
  if (cantoCorrente !== canto.id) return;
  correzioni = { gruppo: gid, origine: { tipo: 'libretto', rif: canto.id }, perAllegato: copia(salvate), puoCorreggere };
  avviaCorrezioni();
}

// Le correzioni di un canto condiviso nel gruppo o mandato in privato (solo con internet)
function preparaCorrezioniEsterne(est) {
  fermaCorrezioni();
  spartitiCanto.classList.remove('senza-correzioni');
  correzioni = { gruppo: est.gruppo, origine: est.origine, perAllegato: {}, puoCorreggere: !!est.puoCorreggere };
  avviaCorrezioni();
}

function avviaCorrezioni() {
  const c = correzioni;
  aggiornaComandiCorrezioni();
  disegnaStrati();
  if (!Gruppi.disponibili() || !navigator.onLine) return;
  // le ultime correzioni (se nel frattempo qualcuno ha scritto qualcosa)...
  Gruppi.correzioniDi(c.origine).then((fresche) => {
    if (fresche && correzioni === c && !modoCorrezione) {
      c.perAllegato = fresche;
      ricordaCorrezioni();
      aggiornaComandiCorrezioni();
      disegnaStrati();
    }
  });
  // ...e quelle che arrivano mentre si guarda il canto
  try {
    smettiCorrezioni = Gruppi.ascoltaCorrezioni(c.origine, (riga) => {
      if (!riga || correzioni !== c || modoCorrezione) return;
      c.perAllegato[riga.allegato_id] = riga.segni || [];
      ricordaCorrezioni();
      aggiornaComandiCorrezioni();
      disegnaStrati();
    });
  } catch (e) { /* va bene lo stesso: le vedrà alla prossima apertura */ }
}

// Quando si lascia il canto
function fermaCorrezioni() {
  if (modoCorrezione) fineCorrezioni();
  if (smettiCorrezioni) {
    try { smettiCorrezioni(); } catch (e) { /* niente */ }
    smettiCorrezioni = null;
  }
}

// Salvo sul dispositivo le correzioni dei canti del libretto (per vederle anche senza internet)
async function ricordaCorrezioni() {
  if (!correzioni || correzioni.origine.tipo !== 'libretto') return;
  const chiave = 'correzioni:' + correzioni.gruppo;
  const tutte = (await Db.impostazione(chiave)) || {};
  tutte[correzioni.origine.rif] = copia(correzioni.perAllegato);
  await Db.salvaImpostazione(chiave, tutte);
}

async function sonoDirettoreDel(gruppoId) {
  const info = (await Db.impostazione('coro:' + gruppoId)) || {};
  return info.ruolo === 'direttore' && info.attivo !== false;
}

async function aggiornaComandiCorrezioni() {
  const c = correzioni;
  const haSpartiti = !!spartitiCanto.querySelector('.pagina-spartito') ||
    (await allegatiAperti()).some((a) => a.tipo === 'spartito' || a.tipo === 'pdf');
  if (c !== correzioni) return;
  $('btn-correggi').hidden = !c || !c.puoCorreggere || !haSpartiti || modoCorrezione;
  $('btn-originale').hidden = !c || !ciSonoCorrezioni() || modoCorrezione;
  $('btn-originale').textContent = spartitiCanto.classList.contains('senza-correzioni')
    ? '✏️ Vedi le correzioni' : "👁 Vedi l'originale";
  $('comandi-correzioni').hidden = $('btn-correggi').hidden && $('btn-originale').hidden;
}

// ---- Disegno ----
function disegnaSegno(ctx, s, W, H) {
  if (s.tipo === 'testo') {
    ctx.fillStyle = s.c;
    ctx.font = `700 ${Math.max(8, s.d * W)}px system-ui, sans-serif`;
    ctx.textBaseline = 'middle';
    ctx.fillText(s.testo, s.x * W, s.y * H);
    return;
  }
  if (!s.t || !s.t.length) return;
  ctx.save();
  ctx.strokeStyle = s.c;
  ctx.lineWidth = Math.max(1, s.d * W);
  ctx.lineCap = s.tipo === 'evidenziatore' ? 'butt' : 'round';
  ctx.lineJoin = 'round';
  if (s.tipo === 'evidenziatore') ctx.globalAlpha = 0.35;
  ctx.beginPath();
  s.t.forEach(([x, y], i) => (i ? ctx.lineTo(x * W, y * H) : ctx.moveTo(x * W, y * H)));
  if (s.t.length === 1) ctx.lineTo(s.t[0][0] * W + 0.5, s.t[0][1] * H + 0.5); // un puntino
  ctx.stroke();
  ctx.restore();
}

function disegnaStrato(foglio) {
  const strato = foglio.querySelector('.strato-correzioni');
  if (!strato || !strato.width) return;
  const ctx = strato.getContext('2d');
  ctx.clearRect(0, 0, strato.width, strato.height);
  const pagina = Number(foglio.dataset.pagina);
  const segni = (correzioni && correzioni.perAllegato[foglio.dataset.allegato]) || [];
  for (const s of segni) if (s.p === pagina) disegnaSegno(ctx, s, strato.width, strato.height);
  if (tratto && tratto.foglio === foglio && tratto.segno) disegnaSegno(ctx, tratto.segno, strato.width, strato.height);
}

function disegnaStrati(allegatoId = null) {
  spartitiCanto.querySelectorAll('.pagina-spartito').forEach((f) => {
    if (!allegatoId || f.dataset.allegato === allegatoId) disegnaStrato(f);
  });
}

// Avvolge una pagina dello spartito (canvas o foto) con il suo foglio trasparente
function foglioPerPagina(allegatoId, pagina, elemento, larghezzaPx, altezzaPx) {
  const foglio = crea('div', 'pagina-spartito');
  foglio.dataset.allegato = allegatoId;
  foglio.dataset.pagina = pagina;
  const strato = crea('canvas', 'strato-correzioni');
  strato.setAttribute('aria-hidden', 'true');
  if (larghezzaPx) {
    strato.width = larghezzaPx;
    strato.height = altezzaPx;
  }
  foglio.append(elemento, strato);
  return foglio;
}

// ---- Scrivere ----
function posizioneSu(strato, e) {
  const r = strato.getBoundingClientRect();
  const x = Math.min(1, Math.max(0, (e.clientX - r.left) / r.width));
  const y = Math.min(1, Math.max(0, (e.clientY - r.top) / r.height));
  return [Math.round(x * 10000) / 10000, Math.round(y * 10000) / 10000];
}

// Cambia i segni di un file: si può annullare, si ridisegna e si salva (subito per tutto il coro)
function cambiaSegni(allegatoId, nuovi) {
  cronologiaCorrezioni.push(copia(correzioni.perAllegato));
  if (cronologiaCorrezioni.length > 50) cronologiaCorrezioni.shift();
  correzioni.perAllegato[allegatoId] = nuovi;
  correzioniCambiate = true;
  disegnaStrati(allegatoId);
  salvaCorrezioniPresto(allegatoId);
}

function salvaCorrezioniPresto(allegatoId) {
  const c = correzioni;
  scriviStatoCorrezioni('Salvo…');
  clearTimeout(salvataggiCorrezioni.get(allegatoId));
  salvataggiCorrezioni.set(allegatoId, setTimeout(async () => {
    salvataggiCorrezioni.delete(allegatoId);
    try {
      await Gruppi.salvaCorrezioni(c.gruppo, c.origine, allegatoId, c.perAllegato[allegatoId] || []);
      if (!salvataggiCorrezioni.size) scriviStatoCorrezioni('✓ Il coro le vede');
    } catch (err) {
      scriviStatoCorrezioni(navigator.onLine ? '⚠ Non salvate' : '📴 Serve internet');
      avviso('⚠ ' + (navigator.onLine ? err.message : 'Senza internet le correzioni non arrivano al coro.'));
    }
    ricordaCorrezioni();
  }, 500));
}

function scriviStatoCorrezioni(testo) { $('stato-correzioni').textContent = testo; }

// Gomma: toglie i segni vicini al dito
function cancellaVicino(foglio, [x, y]) {
  const strato = foglio.querySelector('.strato-correzioni');
  const W = strato.width;
  const H = strato.height;
  const raggio = 0.025 * W;
  const pagina = Number(foglio.dataset.pagina);
  const id = foglio.dataset.allegato;
  const segni = correzioni.perAllegato[id] || [];
  const vicino = (s) => {
    if (s.p !== pagina) return false;
    if (s.tipo === 'testo') {
      const larghezzaTesto = s.testo.length * s.d * W * 0.6;
      return x * W >= s.x * W - raggio && x * W <= s.x * W + larghezzaTesto + raggio && Math.abs(y * H - s.y * H) <= s.d * W;
    }
    return s.t.some(([sx, sy]) => Math.hypot((sx - x) * W, (sy - y) * H) <= raggio + s.d * W / 2);
  };
  if (segni.some(vicino)) cambiaSegni(id, segni.filter((s) => !vicino(s)));
}

async function scriviParola(foglio, [x, y]) {
  const testo = await chiediNome('Cosa vuoi scrivere sullo spartito? (es. «più piano», «respiro», «rit.»)');
  if (!testo || !correzioni) return;
  const id = foglio.dataset.allegato;
  cambiaSegni(id, [...(correzioni.perAllegato[id] || []),
    { tipo: 'testo', p: Number(foglio.dataset.pagina), c: strumento.colore, d: GRANDEZZE.testo, x, y, testo: testo.slice(0, 80) }]);
}

spartitiCanto.addEventListener('pointerdown', (e) => {
  if (!modoCorrezione || tratto) return;
  const strato = e.target.closest('.strato-correzioni');
  if (!strato) return;
  e.preventDefault();
  const foglio = strato.parentElement;
  const pos = posizioneSu(strato, e);
  if (strumento.tipo === 'testo') return scriviParola(foglio, pos);
  try { strato.setPointerCapture(e.pointerId); } catch (err) { /* va bene lo stesso */ }
  if (strumento.tipo === 'gomma') {
    tratto = { foglio, gomma: true, id: e.pointerId };
    cancellaVicino(foglio, pos);
    return;
  }
  tratto = {
    foglio, id: e.pointerId,
    segno: { tipo: strumento.tipo, p: Number(foglio.dataset.pagina), c: strumento.colore, d: GRANDEZZE[strumento.tipo], t: [pos] },
  };
  disegnaStrato(foglio);
});
spartitiCanto.addEventListener('pointermove', (e) => {
  if (!tratto || e.pointerId !== tratto.id) return;
  e.preventDefault();
  const strato = tratto.foglio.querySelector('.strato-correzioni');
  const pos = posizioneSu(strato, e);
  if (tratto.gomma) return cancellaVicino(tratto.foglio, pos);
  const ultimo = tratto.segno.t[tratto.segno.t.length - 1];
  if (Math.hypot(pos[0] - ultimo[0], pos[1] - ultimo[1]) < 0.002) return;
  tratto.segno.t.push(pos);
  disegnaStrato(tratto.foglio);
});
function fineTratto(e) {
  if (!tratto || e.pointerId !== tratto.id) return;
  const { foglio, segno } = tratto;
  tratto = null;
  if (segno && correzioni) cambiaSegni(foglio.dataset.allegato, [...(correzioni.perAllegato[foglio.dataset.allegato] || []), segno]);
}
spartitiCanto.addEventListener('pointerup', fineTratto);
spartitiCanto.addEventListener('pointercancel', fineTratto);
// due dita (per ingrandire): il tratto appena iniziato non vale
spartitiCanto.addEventListener('touchstart', (e) => {
  if (tratto && e.touches.length > 1) {
    const foglio = tratto.foglio;
    tratto = null;
    disegnaStrato(foglio);
  }
});

// ---- Pulsanti ----
function scegliStrumento(btn) {
  document.querySelectorAll('#barra-correzioni [data-strumento]').forEach((b) => b.classList.toggle('attivo', b === btn));
  strumento = { tipo: btn.dataset.strumento, colore: btn.dataset.colore || strumento.colore };
  spartitiCanto.classList.toggle('mano', strumento.tipo === 'mano');
}
document.querySelectorAll('#barra-correzioni [data-strumento]').forEach((b) =>
  b.addEventListener('click', () => scegliStrumento(b)));

$('btn-correggi').addEventListener('click', async () => {
  if (!correzioni) return;
  if (!navigator.onLine) return avviso('📴 Per correggere lo spartito serve internet: le correzioni arrivano subito a tutto il coro.');
  modoCorrezione = true;
  correzioniCambiate = false;
  cronologiaCorrezioni = [];
  spartitiCanto.classList.remove('senza-correzioni');
  spartitiCanto.classList.add('modo-correzione');
  document.body.classList.add('correggendo');
  scegliStrumento(document.querySelector('#barra-correzioni [data-strumento]'));
  $('barra-correzioni').hidden = false;
  scriviStatoCorrezioni('Scrivi con il dito · ✋ per scorrere');
  aggiornaComandiCorrezioni();
  disegnaStrati();
  const primo = spartitiCanto.querySelector('.pagina-spartito');
  if (primo && primo.getBoundingClientRect().top > window.innerHeight * 0.6) primo.scrollIntoView({ behavior: 'smooth' });
});

function fineCorrezioni() {
  modoCorrezione = false;
  tratto = null;
  spartitiCanto.classList.remove('modo-correzione', 'mano');
  document.body.classList.remove('correggendo');
  $('barra-correzioni').hidden = true;
  // quello che non è ancora partito, parte adesso
  for (const [id, timer] of salvataggiCorrezioni) {
    clearTimeout(timer);
    salvataggiCorrezioni.delete(id);
    const c = correzioni;
    if (c) Gruppi.salvaCorrezioni(c.gruppo, c.origine, id, c.perAllegato[id] || [])
      .catch(() => avviso('⚠ Alcune correzioni non sono state salvate: serve internet.'));
  }
  if (correzioniCambiate && correzioni) {
    ricordaCorrezioni();
    const { gruppo, origine } = correzioni;
    const quale = '«' + titoloCanto.textContent + '»';
    if (origine.tipo === 'libretto') Notifiche.invia(gruppo, 'libretto', '✏️ corretto lo spartito di ' + quale);
    if (origine.tipo === 'privato' && cantoEsterno && cantoEsterno.altro) {
      Notifiche.invia(gruppo, 'privato', '✏️ ho corretto lo spartito di ' + quale, cantoEsterno.altro);
    }
  }
  correzioniCambiate = false;
  aggiornaComandiCorrezioni();
}
$('btn-fine-correzioni').addEventListener('click', () => {
  const cambiate = correzioniCambiate;
  fineCorrezioni();
  if (cambiate) avviso('Correzioni salvate: ' + (correzioni && correzioni.origine.tipo === 'privato' ? 'le vedete tutti e due' : 'tutto il gruppo le vede') +
    '. Il PDF originale resta com\'era.');
});

$('btn-annulla-segno').addEventListener('click', () => {
  if (!cronologiaCorrezioni.length) return avviso('Niente da annullare.');
  const prima = cronologiaCorrezioni.pop();
  const ids = new Set([...Object.keys(prima), ...Object.keys(correzioni.perAllegato)]);
  for (const id of ids) {
    if (JSON.stringify(prima[id] || []) !== JSON.stringify(correzioni.perAllegato[id] || [])) salvaCorrezioniPresto(id);
  }
  correzioni.perAllegato = prima;
  correzioniCambiate = true;
  disegnaStrati();
});

$('btn-togli-correzioni').addEventListener('click', async () => {
  if (!ciSonoCorrezioni()) return avviso('Su questo spartito non ci sono correzioni.');
  const scelta = await chiediScelta('Togliere tutte le correzioni da questo canto?\n\nLo spartito tornerà come l\'originale per tutti.',
    [{ valore: 'si', testo: 'Togli tutte le correzioni', pericolo: true }]);
  if (!scelta) return;
  cronologiaCorrezioni.push(copia(correzioni.perAllegato));
  for (const id of Object.keys(correzioni.perAllegato)) {
    correzioni.perAllegato[id] = [];
    salvaCorrezioniPresto(id);
  }
  correzioniCambiate = true;
  disegnaStrati();
});

$('btn-originale').addEventListener('click', () => {
  spartitiCanto.classList.toggle('senza-correzioni');
  aggiornaComandiCorrezioni();
});

// Un PDF allegato (caricato come testo) diventa uno spartito
async function trasformaInSpartito(allegato) {
  await Db.aggiornaAllegato(allegato.id, { tipo: 'spartito' });
  const canto = await Db.canto(cantoCorrente);
  if (canto.testo.trim() && sembraSpartito(canto.testo)) {
    const scelta = await chiediScelta(
      'Fatto! Ora lo spartito si vede con le note.\n\nIl testo letto dal PDF sembra fatto di lettere a caso: vuoi toglierlo?',
      [{ valore: 'togli', testo: 'Sì, togli il testo sbagliato' }],
      'No, lascialo'
    );
    if (scelta) await Db.aggiornaCanto(cantoCorrente, { testo: '' });
  }
  mostraCanto(cantoCorrente);
}

// Aggiunta di uno spartito dalla pagina del canto
$('file-spartito-canto').addEventListener('change', async (e) => {
  const file = e.target.files[0];
  e.target.value = '';
  if (!file) return;
  const nome = await chiediNome('Come vuoi chiamare questo PDF?', senzaEstensione(file.name));
  if (!nome) return;
  await Db.aggiungiAllegato(cantoCorrente, nome, 'spartito', file);
  mostraAllegati();
});

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
    return `Cartella · ${canti}`;
  }
  if (el.tipo === 'canto') return 'Canto';
  const tipo = { pdf: 'PDF', spartito: 'Spartito', audio: 'Audio' }[el.tipoFile] || 'File';
  return `${tipo} del canto «${el.canto}»`;
}

const ICONE = { cartella: '📁', canto: '♪', audio: '🎵', pdf: '📄', spartito: '🎼' };

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
    riga.append(crea('span', 'allegato-nome', `${ICONA_FILE[f.tipo]} ${f.nome}`));

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

// Riempie la tendina "Cartella" con tutte le cartelle (in ordine alfabetico)
async function aggiornaTendinaCartelle(selezionata = null) {
  const tendina = modulo.cartella;
  tendina.innerHTML = '';
  tendina.append(new Option('— Nessuna cartella —', ''));
  for (const c of (await Db.cartelle()).filter((x) => !x.libretto)) {
    tendina.append(new Option(c.nome, c.id, false, c.id === selezionata));
  }
}

// Canto che si sta modificando (null = si sta creando un canto nuovo)
let idInModifica = null;

// Senza id: modulo vuoto per un canto nuovo. Con id: modulo con i dati del canto da modificare.
async function mostraModulo(id = null) {
  idInModifica = typeof id === 'string' ? id : null;
  modulo.reset();
  fileScelti = [];
  mostraFileScelti();
  scriviStatoPdf('I PDF (o le foto) si vedranno nel canto così come sono.');

  // PDF e audio si caricano qui per i canti nuovi; per quelli esistenti dalla pagina del canto
  $('campo-allegati').hidden = idInModifica !== null;
  $('btn-salva').textContent = idInModifica !== null ? 'Salva modifiche' : 'Salva canto';

  // Il campo del testo si vede solo per i canti che ne hanno già uno (versioni precedenti)
  let conTesto = false;
  if (idInModifica !== null) {
    const canto = await Db.canto(idInModifica);
    modulo.titolo.value = canto.titolo;
    modulo.testo.value = canto.testo || '';
    conTesto = !!(canto.testo || '').trim();
    await aggiornaTendinaCartelle(canto.cartella);
    mostra('modulo', 'Modifica canto', true);
  } else {
    await aggiornaTendinaCartelle(cartellaCorrente);
    mostra('modulo', 'Nuovo canto', true);
  }
  $('campo-testo').hidden = !conTesto;
  $('info-accordi').hidden = !conTesto;
  aggiornaInfoAccordi();
}

// Mentre si modifica un testo, l'app dice se ha trovato accordi o no
function aggiornaInfoAccordi() {
  const testo = modulo.testo.value;
  $('info-accordi').textContent = testo.trim() === ''
    ? ''
    : analizzaTesto(testo).conAccordi
      ? '🎸 Accordi riconosciuti: verranno mostrati sopra il testo.'
      : '📖 Nessun accordo trovato: il testo verrà mostrato centrato.';
}
modulo.testo.addEventListener('input', aggiornaInfoAccordi);

function scriviStatoPdf(messaggio, errore = false) {
  statoPdf.textContent = messaggio;
  statoPdf.classList.toggle('errore', errore);
}

// Audio scelti nel modulo
$('file-audio-modulo').addEventListener('change', async (e) => {
  const files = [...e.target.files];
  e.target.value = '';
  for (const file of files) {
    const nome = await chiediNome('Come vuoi chiamare questo audio?', senzaEstensione(file.name));
    if (!nome) continue;
    fileScelti.push({ nome, tipo: 'audio', file });
    if (!modulo.titolo.value.trim()) modulo.titolo.value = nome;
  }
  mostraFileScelti();
});

// PDF o foto scelti nel modulo: nel canto si vedranno così come sono, pagina per pagina
$('file-spartito').addEventListener('change', async (e) => {
  const files = [...e.target.files];
  e.target.value = '';
  for (const file of files) {
    const nome = await chiediNome('Come vuoi chiamare questo PDF?', senzaEstensione(file.name));
    if (!nome) continue;
    fileScelti.push({ nome, tipo: 'spartito', file });
    if (!modulo.titolo.value.trim()) modulo.titolo.value = nome;
  }
  mostraFileScelti();
  if (fileScelti.length) scriviStatoPdf('Pronto: controlla il titolo, aggiungi gli audio se vuoi, poi tocca «Salva canto».');
});

modulo.addEventListener('submit', async (e) => {
  e.preventDefault();
  const canto = {
    titolo: modulo.titolo.value.trim(),
    cartella: modulo.cartella.value === '' ? null : modulo.cartella.value,
    testo: modulo.testo.value,
  };
  let id = idInModifica;
  if (id !== null) {
    await Db.aggiornaCanto(id, canto);
  } else {
    if (!fileScelti.length) {
      const scelta = await chiediScelta('Non hai caricato né PDF né audio. Vuoi salvare lo stesso il canto, solo con il titolo?',
        [{ valore: 'si', testo: 'Salva lo stesso' }]);
      if (!scelta) return;
    }
    id = await Db.aggiungiCanto({ ...canto, sezione: 'canti' });
    for (const f of fileScelti) await Db.aggiungiAllegato(id, f.nome, f.tipo, f.file);
  }
  idInModifica = null;

  // Dopo il salvataggio, apro il canto
  cartellaCorrente = canto.cartella;
  evidenziaSezione('canti');
  mostraCanto(id);
});

// ---------- Navigazione ----------
// Colora la voce attiva nella barra in basso ("prove", "chiesa", "cestino" o "account")
function evidenziaSezione(voce = sezioneCorrente) {
  document.querySelectorAll('.barra-bassa button').forEach((b) => {
    b.classList.toggle('attivo', b.dataset.sezione === voce);
  });
}

document.querySelectorAll('.barra-bassa button').forEach((b) => {
  b.addEventListener('click', () => {
    if (b.dataset.sezione === 'cestino') return mostraCestino();
    if (b.dataset.sezione === 'account') return mostraAccount();
    if (b.dataset.sezione === 'gruppi') return mostraGruppi();
    sezioneCorrente = b.dataset.sezione;
    cartellaCorrente = null;
    ricerca = '';
    evidenziaSezione();
    mostraElenco();
  });
});

btnAggiungi.addEventListener('click', () => mostraModulo());

// "Indietro": dalla modifica si torna al canto; dal canto o dal modulo all'elenco;
// da una cartella alla sezione
btnIndietro.addEventListener('click', () => {
  if (!schermate.canto.hidden && cantoEsterno) {
    tornaDaEsterno();
  } else if (!schermate.canto.hidden && percorsoScaletta && scalettaAperta) {
    percorsoScaletta = null;
    disegnaScaletta();
  } else if (!schermate.scaletta.hidden) {
    tornaDallaScaletta();
  } else if (!schermate.chat.hidden) {
    mostraGruppi();
  } else if (!schermate.modulo.hidden && idInModifica !== null) {
    mostraCanto(idInModifica);
  } else if (schermate.elenco.hidden) {
    mostraElenco();
  } else {
    cartellaCorrente = null;
    ricerca = '';
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

// ---------- Account e sincronizzazione ----------

function mostraAccount() {
  mostra('account', 'Account', false);
  evidenziaSezione('account');
  aggiornaAccount();
}

// Messaggio sopra il modulo di accesso (in rosso se è un errore)
function messaggioAccount(testo, errore = false) {
  const el = $('account-messaggio');
  el.textContent = testo;
  el.hidden = !testo;
  el.classList.toggle('errore', errore);
}

function testoStatoSync() {
  switch (Sync.stato) {
    case 'inCorso':
      return '⟳ Sto controllando e salvando i canti online…';
    case 'offline':
      return '📴 Sei senza internet. I canti sono salvati su questo dispositivo e verranno ' +
        'salvati online appena torna la connessione.';
    case 'errore':
      return `⚠ Salvataggio online non riuscito: ${Sync.errore} I canti restano salvati qui e l'app riproverà da sola.`;
    default: {
      if (!Sync.ultimaVolta) return '✓ Collegato al tuo account.';
      const ora = new Date(Sync.ultimaVolta).toLocaleTimeString('it-IT', { hour: '2-digit', minute: '2-digit' });
      return `✓ Tutto salvato online. Ultimo controllo alle ${ora}.`;
    }
  }
}

// Aggiorna la pagina Account e il pallino sull'icona in basso
function aggiornaAccount() {
  const dentro = !!Sync.utente;
  $('account-spento').hidden = Sync.stato !== 'spento';
  $('account-fuori').hidden = Sync.stato === 'spento' || dentro;
  $('account-dentro').hidden = !dentro;
  if (dentro) $('account-email').textContent = Sync.utente.email;
  $('account-avviso').textContent = Sync.errore;
  $('account-avviso').hidden = dentro || !Sync.errore;

  const stato = $('stato-sync');
  stato.textContent = testoStatoSync();
  stato.classList.toggle('errore', Sync.stato === 'errore');
  $('btn-sincronizza').disabled = Sync.stato === 'inCorso';

  aggiornaNotificheUI();

  const pallino = $('pallino-sync');
  pallino.hidden = !dentro;
  pallino.className = 'pallino ' + Sync.stato;
}
Sync.quandoCambiaStato(() => {
  aggiornaAccount();
  aggiornaIniziale();
});

// Quando arrivano canti da un altro dispositivo, aggiorno quello che si sta guardando
Sync.quandoArrivanoDati(async () => {
  if (!schermate.elenco.hidden) {
    const y = window.scrollY;
    await mostraElenco();
    window.scrollTo(0, y);
  } else if (!schermate.canto.hidden) {
    const canto = cantoCorrente && (await Db.canto(cantoCorrente));
    if (!canto || canto.eliminato) return mostraElenco();
    titoloCanto.textContent = canto.titolo;
    disegnaTesto(canto.testo);
    // non interrompo un audio che sta suonando
    const suona = [...allegatiCanto.querySelectorAll('audio')].some((a) => !a.paused);
    if (!suona) mostraAllegati();
  } else if (!schermate.cestino.hidden) {
    mostraCestino();
  }
});

// ---------- Accedi / Crea un account (sulla pagina iniziale) ----------

// Mostra la pagina "Accedi" oppure "Crea un account"
function mostraPaginaAccesso(quale) {
  const registrazione = quale === 'registrazione';
  $('modulo-accesso').hidden = registrazione;
  $('modulo-registrazione').hidden = !registrazione;
  $('titolo-accesso').textContent = registrazione ? 'Crea un account' : 'Accedi';
  $('sottotitolo-accesso').textContent = registrazione
    ? 'Con un account ritrovi i tuoi canti su telefono e PC, e puoi condividerli nei gruppi.'
    : 'Accedi per ritrovare i tuoi canti su telefono e PC. L\'accesso viene ricordato: lo fai una volta sola.';
  messaggioAccount('');
  paginaIniziale.scrollTop = 0;
}

// Mentre si aspetta la risposta, i pulsanti del modulo non si possono toccare
async function conPulsantiFermi(form, lavoro) {
  const pulsanti = form.querySelectorAll('button');
  pulsanti.forEach((b) => (b.disabled = true));
  try {
    await lavoro();
  } finally {
    pulsanti.forEach((b) => (b.disabled = false));
  }
}

// Dopo l'accesso: si entra nei canti
function entraDopoAccesso() {
  messaggioAccount('');
  aggiornaAccount();
  aggiornaIniziale();
  chiudiIniziale();
}

$('modulo-accesso').addEventListener('submit', (e) => {
  e.preventDefault();
  const form = e.target;
  conPulsantiFermi(form, async () => {
    messaggioAccount('Un momento…');
    try {
      await Sync.accedi(form.email.value.trim(), form.password.value);
      form.reset();
      avviso('Accesso effettuato! I tuoi canti arrivano su questo dispositivo.');
      entraDopoAccesso();
    } catch (err) {
      messaggioAccount(err.message, true);
    }
  });
});

$('modulo-registrazione').addEventListener('submit', (e) => {
  e.preventDefault();
  const form = e.target;
  const nome = form.nome.value.trim();
  const email = form.email.value.trim();
  if (form.password.value !== form.ripeti.value) {
    messaggioAccount('Le due password non sono uguali: riscrivile.', true);
    form.ripeti.value = '';
    return form.ripeti.focus();
  }
  conPulsantiFermi(form, async () => {
    messaggioAccount('Un momento…');
    try {
      const esito = await Sync.registrati(email, form.password.value);
      await Gruppi.salvaMioNome(nome); // il nome che vedranno gli altri nei gruppi
      form.reset();
      if (esito === 'confermaEmail') {
        // si torna alla pagina "Accedi", con l'email già scritta
        mostraPaginaAccesso('accesso');
        $('modulo-accesso').email.value = email;
        messaggioAccount(`Account creato! Ti abbiamo mandato un'email a ${email}: apri il link che contiene ` +
          'per attivarlo (guarda anche nella posta indesiderata), poi torna qui e tocca «Accedi».');
        return;
      }
      avviso(`Ciao ${nome}! Account creato: i tuoi canti ora vengono salvati anche online.`);
      entraDopoAccesso();
    } catch (err) {
      messaggioAccount(err.message, true);
    }
  });
});

$('btn-vai-registrazione').addEventListener('click', () => {
  const email = $('modulo-accesso').email.value.trim();
  mostraPaginaAccesso('registrazione');
  if (email) $('modulo-registrazione').email.value = email;
  $('modulo-registrazione').nome.focus();
});

$('btn-torna-accesso').addEventListener('click', () => {
  const email = $('modulo-registrazione').email.value.trim();
  mostraPaginaAccesso('accesso');
  if (email) $('modulo-accesso').email.value = email;
  $('modulo-accesso').email.focus();
});

$('btn-password-dimenticata').addEventListener('click', async () => {
  const email = $('modulo-accesso').email.value.trim();
  if (!email) return messaggioAccount('Scrivi prima la tua email, poi tocca di nuovo «Password dimenticata?».', true);
  try {
    await Sync.recuperaPassword(email);
    messaggioAccount(`Ti abbiamo mandato un'email a ${email} con un link per scegliere una nuova password.`);
  } catch (err) {
    messaggioAccount(err.message, true);
  }
});

// Aperta l'app dal link "nuova password" ricevuto per email
Sync.quandoServeNuovaPassword(async () => {
  $('pagina-iniziale').classList.add('chiusa');
  const password = await chiediNome('Scegli una nuova password (almeno 6 caratteri)', '', { password: true });
  if (!password) return;
  try {
    await Sync.cambiaPassword(password);
    avviso('Password cambiata!');
  } catch (err) {
    avviso(err.message);
  }
});

$('btn-sincronizza').addEventListener('click', () => Sync.sincronizza());

$('btn-esci').addEventListener('click', async () => {
  await Sync.sincronizza(); // prima provo a salvare online le ultime modifiche
  const mancanti = await Db.quanteDaInviare();
  const domanda = mancanti
    ? (mancanti === 1
      ? 'Attenzione: 1 modifica non è ancora stata salvata online (serve internet). Se esci adesso andrà persa.'
      : `Attenzione: ${mancanti} modifiche non sono ancora state salvate online (serve internet). Se esci adesso andranno perse.`) +
      '\n\nVuoi uscire lo stesso?'
    : "Vuoi uscire dall'account?\n\nI tuoi canti restano salvati online. Da questo dispositivo " +
      'verranno tolti, e torneranno quando accederai di nuovo.';
  const scelta = await chiediScelta(domanda, [{ valore: 'esci', testo: "Esci dall'account", pericolo: true }]);
  if (!scelta) return;
  await Notifiche.disattiva().catch(() => {});
  await Sync.esci();
  sezioneCorrente = 'canti';
  cartellaCorrente = null;
  avviso("Uscita dall'account effettuata.");
  aggiornaAccount();
  mostraElenco();
  apriIniziale();
});

$('btn-vai-accesso').addEventListener('click', () => apriIniziale(true));

// Persone bloccate nei gruppi: si possono sbloccare
$('btn-bloccati').addEventListener('click', async () => {
  let bloccati;
  try {
    bloccati = await Gruppi.bloccati();
  } catch (err) {
    return avviso('⚠ ' + err.message);
  }
  if (!bloccati.length) return chiediScelta('Non hai bloccato nessuno.', [], 'Chiudi');
  const chi = await chiediScelta('Persone bloccate: non vedi i canti che condividono.\n\nTocca un nome per sbloccarlo.',
    bloccati.map((b) => ({ valore: b, testo: '🚫 ' + (b.nome || 'Senza nome') })), 'Chiudi');
  if (!chi) return;
  try {
    await Gruppi.sblocca(chi.bloccato_id);
    avviso(`Hai sbloccato ${chi.nome || 'questa persona'}.`);
  } catch (err) {
    avviso('⚠ ' + err.message);
  }
});

// Elimina il mio account (requisito di Google Play)
$('btn-elimina-account').addEventListener('click', async () => {
  const scelta = await chiediScelta(
    'Eliminare per sempre il tuo account?\n\n' +
    'Verranno cancellati: l\'account, tutti i tuoi canti e i loro file (online e su questo dispositivo), ' +
    'i canti che hai condiviso nei gruppi e i gruppi che hai creato (anche per le altre persone).\n\n' +
    'Non si potrà tornare indietro.',
    [{ valore: 'si', testo: 'Sì, elimina il mio account', pericolo: true }]);
  if (!scelta) return;
  const password = await chiediNome('Per sicurezza, scrivi la tua password', '', { password: true });
  if (!password) return;
  avviso('Eliminazione in corso…');
  await Notifiche.disattiva().catch(() => {});
  try {
    await Sync.eliminaAccount(password);
    sezioneCorrente = 'canti';
    cartellaCorrente = null;
    mostraElenco();
    apriIniziale();
    avviso('Il tuo account e tutti i tuoi dati sono stati eliminati.');
  } catch (err) {
    avviso('⚠ ' + err.message);
  }
});

// ---------- Gruppi: condividere i canti ----------

const URL_APP = location.origin + location.pathname;
let gruppoCorrente = null;     // gruppo aperto nella chat
let smettiDiAscoltare = null;  // per chiudere la chat "in diretta"
let timerChat = null;
let caricamentoChat = 0;

function lasciaChat() {
  if (smettiDiAscoltare) {
    try { smettiDiAscoltare(); } catch (e) { /* niente */ }
    smettiDiAscoltare = null;
  }
  clearInterval(timerChat);
  timerChat = null;
}

// Il nome con cui gli altri ti vedono: chiesto una volta sola
async function chiediMioNome() {
  let nome = await Gruppi.mioNome();
  if (nome) return nome;
  nome = await chiediNome('Come ti chiami? Gli altri del gruppo vedranno questo nome accanto ai canti che condividi.');
  if (nome) await Gruppi.salvaMioNome(nome);
  return nome;
}

async function mostraGruppi() {
  mostra('gruppi', 'Gruppi', false);
  evidenziaSezione('gruppi');
  const nota = $('gruppi-avviso');
  const contenuto = $('gruppi-contenuto');
  $('btn-gruppi-accedi').hidden = true;

  if (!Gruppi.disponibili()) {
    nota.textContent = Sync.stato === 'spento'
      ? "I gruppi funzionano con l'accesso online, che in questa app non è attivo."
      : "Per usare i gruppi serve l'accesso: così gli altri sanno chi condivide i canti.";
    nota.hidden = false;
    contenuto.hidden = true;
    $('btn-gruppi-accedi').hidden = Sync.stato === 'spento';
    return;
  }
  if (!navigator.onLine) {
    nota.textContent = '📴 I gruppi funzionano solo con internet. Riprova quando torna la connessione.';
    nota.hidden = false;
    contenuto.hidden = true;
    return;
  }

  nota.hidden = true;
  contenuto.hidden = false;
  aggiornaNotificheUI();
  const lista = $('elenco-gruppi');
  try {
    const gruppi = await Gruppi.miei();
    const nuovi = await Gruppi.novita(gruppi).catch(() => ({}));
    lista.innerHTML = '';
    for (const g of gruppi) {
      const btn = crea('button', 'voce-gruppo', g.nome);
      if (nuovi[g.id]) btn.append(crea('span', 'nuovi', nuovi[g.id] === 1 ? '1 nuovo' : `${nuovi[g.id]} nuovi`));
      btn.addEventListener('click', () => apriChat(g));
      const li = crea('li');
      li.append(btn);
      lista.append(li);
    }
    $('gruppi-vuoto').hidden = gruppi.length > 0;
    $('pallino-gruppi').hidden = !Object.values(nuovi).some((n) => n > 0);
  } catch (err) {
    nota.textContent = '⚠ ' + err.message;
    nota.hidden = false;
  }
}

$('btn-gruppi-accedi').addEventListener('click', () => apriIniziale(true));

$('btn-crea-gruppo').addEventListener('click', async () => {
  const nomeGruppo = await chiediNome('Nome del nuovo gruppo (es. «Coro parrocchia»)');
  if (!nomeGruppo) return;
  const mioNome = await chiediMioNome();
  if (!mioNome) return;
  try {
    await creaGruppo(nomeGruppo, mioNome);
  } catch (err) {
    if (!/2 gruppi gratuiti/.test(err.message) || (await Gruppi.provaGiaUsata())) {
      return chiediScelta(err.message, [], 'Ho capito');
    }
    const scelta = await chiediScelta(err.message +
      '\n\nPuoi però creare «' + nomeGruppo + '» come gruppo Coro, con 7 giorni di prova gratuita.',
      [{ valore: 'prova', testo: '⭐ Crealo come gruppo Coro (prova gratuita)' }]);
    if (!scelta) return;
    try {
      await creaGruppo(nomeGruppo, mioNome, true);
    } catch (err2) {
      avviso('⚠ ' + err2.message);
    }
  }
});

$('btn-entra-gruppo').addEventListener('click', async () => {
  const codice = await chiediNome('Scrivi il codice del gruppo (6 lettere e numeri, es. K7PMQ2)');
  if (!codice) return;
  const mioNome = await chiediMioNome();
  if (!mioNome) return;
  try {
    const g = await Gruppi.entra(codice.replace(/\s+/g, ''), mioNome);
    avviso(`Ora fai parte di «${g.nome}»!`);
    apriChat(g);
  } catch (err) {
    avviso('⚠ ' + err.message);
  }
});

// Invito: con il menu "Condividi" del telefono (WhatsApp, SMS…) oppure copiato da incollare
async function invita(g) {
  const testo = `Entra nel gruppo «${g.nome}» per condividere i canti con l'app Canta con noi!\n` +
    `1. Apri ${URL_APP}\n2. Accedi (o crea un account)\n3. Tocca «Gruppi» → «Entra con un codice»\n` +
    `4. Scrivi il codice: ${g.codice}`;
  if (navigator.share) {
    try {
      await navigator.share({ title: 'Canta con noi', text: testo });
      return;
    } catch (e) {
      if (e.name === 'AbortError') return;
    }
  }
  try {
    await navigator.clipboard.writeText(testo);
    avviso('Invito copiato: incollalo in un messaggio (es. su WhatsApp).');
  } catch (e) {
    await chiediScelta(testo, [], 'Chiudi');
  }
}

async function apriChat(g) {
  gruppoCorrente = g;
  mostra('chat', g.nome, true);
  evidenziaSezione('gruppi');
  $('chat-codice').textContent = g.codice;
  $('elenco-chat').innerHTML = '';
  $('chat-vuota').hidden = true;
  $('coro-stato').hidden = true;
  $('schede-coro').hidden = true;
  $('pallino-messaggi').hidden = true;
  conversazioneCon = null;
  scegliScheda('chat');
  await preparaCoro(g);
  if (Gruppi.coroAttivo(g)) scegliScheda(schedaRichiesta || 'bacheca');
  schedaRichiesta = null;
  await caricaChat(true);
  // messaggi nuovi "in diretta"; e comunque ricontrollo ogni 20 secondi
  try { smettiDiAscoltare = Gruppi.ascolta(g.id, () => caricaChat()); } catch (e) { /* va bene lo stesso */ }
  timerChat = setInterval(() => caricaChat(), 20000);
}

async function caricaChat(vaiInFondo = false) {
  const g = gruppoCorrente;
  if (!g || schermate.chat.hidden) return;
  if (!$('pannello-bacheca').hidden) mostraBacheca();
  if (!$('pannello-messaggi').hidden) mostraMessaggi();
  else if (Gruppi.coroAttivo(g)) controllaMessaggiNuovi(g);
  const mio = ++caricamentoChat;
  const nota = $('chat-avviso');
  try {
    const [lista, salvati, corretti] = await Promise.all([Gruppi.condivisioni(g.id), Gruppi.giaSalvati(),
      Gruppi.coroAttivo(g) ? Gruppi.cantiCorretti(g.id) : new Set()]);
    if (mio !== caricamentoChat || gruppoCorrente !== g) return;
    nota.hidden = true;
    const eraInFondo = vaiInFondo || window.innerHeight + window.scrollY >= document.body.scrollHeight - 120;
    disegnaChat(lista, salvati, corretti);
    if (eraInFondo) window.scrollTo(0, document.body.scrollHeight);
    if (lista.length) {
      await Gruppi.segnaVisto(g.id, lista[lista.length - 1].creato);
      aggiornaNovita();
    }
  } catch (err) {
    nota.textContent = navigator.onLine ? '⚠ ' + err.message : '📴 Senza internet la chat non si aggiorna.';
    nota.hidden = false;
  }
}

const formatoOra = (d) => d.toLocaleTimeString('it-IT', { hour: '2-digit', minute: '2-digit' });

// "testo con accordi · 🎵 2 · 🎼 1"
function riassuntoCanto(c) {
  const files = c.allegati || [];
  const quanti = (tipo) => files.filter((f) => f.tipo === tipo).length;
  const parti = [];
  if ((c.testo || '').trim()) parti.push(analizzaTesto(c.testo).conAccordi ? 'testo con accordi' : 'testo');
  if (quanti('audio')) parti.push(`🎵 ${quanti('audio')}`);
  if (quanti('spartito')) parti.push(`🎼 ${quanti('spartito')}`);
  if (quanti('pdf')) parti.push(`📄 ${quanti('pdf')}`);
  return parti.join(' · ') || 'solo titolo';
}
const siPuoAprire = (c) => !!((c.testo || '').trim() || (c.allegati || []).length);

function disegnaChat(lista, salvati, corretti = new Set()) {
  const ul = $('elenco-chat');
  ul.innerHTML = '';
  $('chat-vuota').hidden = lista.length > 0;
  let giornoPrecedente = '';

  for (const c of lista) {
    const quando = new Date(c.creato);
    const giorno = quando.toLocaleDateString('it-IT', { weekday: 'long', day: 'numeric', month: 'long' });
    if (giorno !== giornoPrecedente) {
      ul.append(crea('li', 'giorno-chat', giorno));
      giornoPrecedente = giorno;
    }

    const mio = c.user_id === Sync.utente.id;
    const li = crea('li', 'messaggio' + (mio ? ' mio' : ''));
    li.append(crea('div', 'autore', `${mio ? 'Tu' : c.autore} · ${formatoOra(quando)}`));
    if (c.messaggio) li.append(crea('p', 'testo-messaggio', c.messaggio));

    const scheda = crea('div', 'scheda-canto');
    scheda.append(crea('div', 'titolo-condiviso', '♪ ' + c.titolo));
    scheda.append(crea('div', 'dettaglio', riassuntoCanto(c) + (corretti.has(c.id) ? ' · ✏️ con correzioni' : '')));

    const azioni = crea('div', 'azioni-chat');
    if (siPuoAprire(c)) {
      const apri = crea('button', 'btn-piccolo', '👁 Apri');
      apri.addEventListener('click', () => {
        const g = gruppoCorrente;
        apriCantoEsterno({
          titolo: c.titolo, testo: c.testo, allegati: c.allegati, gruppo: g.id,
          origine: { tipo: 'condivisione', rif: c.id },
          puoCorreggere: Gruppi.coroAttivo(g) && (mio || Gruppi.sonoDirettore(g)),
          nota: '♪ Condiviso da ' + (mio ? 'te' : c.autore) + ' nel gruppo «' + g.nome + '».',
          ritorno: { scheda: 'chat' },
        });
      });
      azioni.append(apri);
    }
    // (i canti che ho condiviso io sono già tra i miei: per quelli niente "Salva")
    if (!mio) {
      const salva = crea('button', 'btn-piccolo salva', salvati.has(c.id) ? '✓ Salvato' : '⬇ Salva nei miei canti');
      salva.addEventListener('click', () => salvaCondiviso(c, salva));
      azioni.append(salva);
      // ⋯ : segnala, blocca e (per chi ha creato il gruppo) togli dalla chat
      const altro = crea('button', 'btn-mini', '⋯');
      altro.title = 'Altre azioni';
      altro.setAttribute('aria-label', 'Altre azioni: segnala o blocca');
      altro.addEventListener('click', () => azioniSuCantoAltrui(c));
      azioni.append(altro);
    } else {
      const togli = crea('button', 'btn-mini', '🗑');
      togli.title = 'Togli dalla chat';
      togli.addEventListener('click', () => togliDallaChat(c, 'Chi l\'ha già salvato lo tiene; il tuo canto resta tra i tuoi canti.'));
      azioni.append(togli);
    }
    scheda.append(azioni);
    li.append(scheda);
    ul.append(li);
  }
}

async function togliDallaChat(c, spiegazione) {
  const scelta = await chiediScelta(`Togliere «${c.titolo}» dalla chat del gruppo?\n\n${spiegazione}`,
    [{ valore: 'togli', testo: 'Togli dalla chat', pericolo: true }]);
  if (!scelta) return;
  try {
    await Gruppi.elimina(c);
    caricaChat();
  } catch (err) {
    avviso('⚠ ' + err.message);
  }
}

// Menu ⋯ su un canto condiviso da un'altra persona
async function azioniSuCantoAltrui(c) {
  const opzioni = [
    { valore: 'segnala', testo: '⚑ Segnala questo canto' },
    { valore: 'blocca', testo: `🚫 Blocca ${c.autore}` },
  ];
  if (Gruppi.sonoCreatore(gruppoCorrente)) {
    opzioni.push({ valore: 'togli', testo: '🗑 Togli dalla chat (sei il moderatore)', pericolo: true });
  }
  const scelta = await chiediScelta(`«${c.titolo}», condiviso da ${c.autore}`, opzioni);

  if (scelta === 'segnala') {
    const motivo = await chiediScelta('Perché lo segnali?', [
      { valore: 'Contenuto offensivo o inappropriato', testo: 'Contenuto offensivo o inappropriato' },
      { valore: "Viola i diritti d'autore", testo: "Viola i diritti d'autore" },
      { valore: 'Spam o pubblicità', testo: 'Spam o pubblicità' },
      { valore: 'Altro', testo: 'Altro' },
    ]);
    if (!motivo) return;
    try {
      await Gruppi.segnala(c, motivo);
      avviso('Grazie: la segnalazione è stata inviata e questo canto non lo vedrai più.');
      caricaChat();
    } catch (err) {
      avviso('⚠ ' + err.message);
    }
  } else if (scelta === 'blocca') {
    const conferma = await chiediScelta(
      `Bloccare ${c.autore}?\n\nNon vedrai più i canti che condivide, in nessun gruppo. ` +
      'Non riceverà nessun avviso. Puoi sbloccare quando vuoi da Account → Persone bloccate.',
      [{ valore: 'si', testo: `🚫 Blocca ${c.autore}`, pericolo: true }]);
    if (!conferma) return;
    try {
      await Gruppi.blocca(c.user_id, c.autore);
      avviso(`Hai bloccato ${c.autore}.`);
      caricaChat();
    } catch (err) {
      avviso('⚠ ' + err.message);
    }
  } else if (scelta === 'togli') {
    togliDallaChat(c, 'Come moderatore puoi togliere i canti inappropriati. Chi l\'ha già salvato lo tiene.');
  }
}

function mostraAnteprima(c) {
  const dialogo = $('dialogo-anteprima');
  $('anteprima-titolo').textContent = c.titolo;
  $('anteprima-testo').textContent = c.testo;
  dialogo.showModal();
}
$('chiudi-anteprima').addEventListener('click', () => $('dialogo-anteprima').close());

// Dove salvare un canto ricevuto: fuori dalle cartelle, in una cartella, o in una cartella nuova
async function chiediDestinazione(c) {
  const opzioni = [{ valore: { sezione: 'canti', cartella: null }, testo: 'Fuori dalle cartelle' }];
  for (const cart of (await Db.cartelle()).filter((x) => !x.libretto)) {
    opzioni.push({ valore: { sezione: 'canti', cartella: cart.id, nomeCartella: cart.nome }, testo: '📁 ' + cart.nome });
  }
  opzioni.push({ valore: { sezione: 'canti', nuova: true }, testo: '＋ In una cartella nuova' });
  const scelta = await chiediScelta('Dove vuoi salvare «' + c.titolo + '»?', opzioni);
  if (!scelta || !scelta.nuova) return scelta;
  const nome = await chiediNome('Nome della nuova cartella');
  if (!nome) return null;
  const id = await Db.aggiungiCartella(nome);
  return { sezione: 'canti', cartella: id, nomeCartella: nome };
}

async function salvaCondiviso(c, pulsante) {
  const dove = await chiediDestinazione(c);
  if (!dove) return;
  pulsante.disabled = true;
  pulsante.textContent = '⏳ Salvataggio…';
  try {
    await Gruppi.salva(c, dove, (testo) => (pulsante.textContent = '⏳ ' + testo));
    const posto = dove.nomeCartella ? '📁 ' + dove.nomeCartella : NOME_ELENCO;
    avviso(`«${c.titolo}» salvato in ${posto}.`);
    pulsante.textContent = '✓ Salvato';
  } catch (err) {
    avviso('⚠ Salvataggio non riuscito: ' + err.message);
    pulsante.textContent = '⬇ Salva nei miei canti';
  } finally {
    pulsante.disabled = false;
  }
}

// Scelta di uno dei miei canti (con ricerca per titolo)
function scegliCanto(domanda = 'Quale canto vuoi condividere?') {
  const dialogo = $('dialogo-canti');
  dialogo.querySelector('p').textContent = domanda;
  const cerca = $('cerca-canto');
  const lista = $('lista-canti');
  return new Promise(async (resolve) => {
    const canti = await Db.tuttiICanti();
    const fine = (valore) => {
      dialogo.oncancel = null;
      dialogo.close();
      resolve(valore);
    };
    const disegna = () => {
      const testo = cerca.value.trim().toLowerCase();
      lista.innerHTML = '';
      const trovati = canti.filter((c) => c.titolo.toLowerCase().includes(testo));
      for (const c of trovati) {
        const btn = crea('button', '', c.titolo);
                btn.addEventListener('click', () => fine(c.id));
        const li = crea('li');
        li.append(btn);
        lista.append(li);
      }
      if (!trovati.length) lista.append(crea('li', 'dettaglio', canti.length ? 'Nessun canto trovato.' : 'Non hai ancora canti.'));
    };
    cerca.value = '';
    cerca.oninput = disegna;
    disegna();
    $('chiudi-dialogo-canti').onclick = () => fine(null);
    dialogo.oncancel = (e) => {
      e.preventDefault();
      fine(null);
    };
    dialogo.showModal();
  });
}

$('btn-condividi-qui').addEventListener('click', async () => {
  const id = await scegliCanto();
  if (id) condividiCanto(id, gruppoCorrente);
});

// Condivide un mio canto in un gruppo (se il gruppo non è indicato, lo chiede)
async function condividiCanto(cantoId, gruppo = null) {
  if (!Gruppi.disponibili()) {
    const scelta = await chiediScelta("Per condividere i canti serve l'accesso.",
      [{ valore: 'accedi', testo: 'Accedi o crea un account' }]);
    if (scelta) apriIniziale(true);
    return;
  }
  if (!navigator.onLine) return avviso('📴 Per condividere serve internet.');

  if (!gruppo) {
    let gruppi;
    try {
      gruppi = await Gruppi.miei();
    } catch (err) {
      return avviso('⚠ ' + err.message);
    }
    if (!gruppi.length) {
      const scelta = await chiediScelta('Non sei ancora in nessun gruppo: creane uno o entra con un codice.',
        [{ valore: 'vai', testo: '✉ Vai ai Gruppi' }]);
      if (scelta) mostraGruppi();
      return;
    }
    gruppo = await chiediScelta('In quale gruppo vuoi condividere il canto?',
      gruppi.map((g) => ({ valore: g, testo: '✉ ' + g.nome })));
    if (!gruppo) return;
  }

  const canto = await Db.canto(cantoId);
  const messaggio = await chiediNome(
    `Vuoi aggiungere un messaggio per «${gruppo.nome}»? (facoltativo, es. «Lo facciamo domenica»)`,
    '', { facoltativo: true });
  if (messaggio === null) return;

  avviso('Invio in corso…');
  try {
    await Gruppi.condividi(gruppo.id, cantoId, messaggio, (testo) => avviso(testo));
    avviso(`«${canto.titolo}» condiviso in «${gruppo.nome}».`);
    if (gruppoCorrente && gruppoCorrente.id === gruppo.id && !schermate.chat.hidden) caricaChat(true);
  } catch (err) {
    avviso('⚠ Condivisione non riuscita: ' + err.message);
  }
}

$('btn-invita').addEventListener('click', () => gruppoCorrente && invita(gruppoCorrente));

$('btn-membri').addEventListener('click', async () => {
  const g = gruppoCorrente;
  if (!g) return;
  let membri;
  try {
    membri = await Gruppi.membri(g.id);
  } catch (err) {
    return avviso('⚠ ' + err.message);
  }
  const coro = Gruppi.coroAttivo(g);
  const elencoNomi = membri.map((m) => '• ' + m.nome +
    (coro && (m.ruolo === 'direttore' || m.user_id === g.creato_da) ? ' ⭐ direttore' : '') +
    (coro && m.voce ? ' · ' + (VOCI[m.voce] || m.voce) : '') +
    (m.user_id === Sync.utente.id ? ' (tu)' : '')).join('\n');
  const moderatore = Gruppi.sonoCreatore(g);
  const opzioni = [];
  if (coro) opzioni.push({ valore: 'voce', testo: '🎤 La mia voce' });
  if (coro && moderatore) opzioni.push({ valore: 'direttori', testo: '⭐ Scegli i direttori' });
  if (moderatore) {
    opzioni.push({ valore: 'rimuovi', testo: '👤 Rimuovi una persona dal gruppo' });
    opzioni.push({ valore: 'codice', testo: '🔑 Cambia il codice del gruppo' });
  }
  opzioni.push({ valore: 'esci', testo: 'Esci dal gruppo', pericolo: true });
  const scelta = await chiediScelta(
    `Nel gruppo «${g.nome}» ci sono:\n\n${elencoNomi}\n\nCodice per entrare: ${g.codice}` +
    (moderatore ? '\n\nHai creato tu questo gruppo: ne sei il moderatore.' : ''),
    opzioni, 'Chiudi');
  if (!scelta) return;

  if (scelta === 'voce') {
    const voce = await chiediScelta('Che voce canti? Dal libretto riceverai solo i file della tua voce (e quelli per tutti); negli audio vedrai per primi i tuoi.',
      [...Object.entries(VOCI).map(([valore, testo]) => ({ valore, testo: '🎤 ' + testo })), { valore: 'nessuna', testo: 'Nessuna in particolare' }]);
    if (!voce) return;
    const nuova = voce === 'nessuna' ? '' : voce;
    try {
      await Gruppi.impostaVoce(g.id, nuova);
      await Db.salvaImpostazione('miaVoce', nuova);
      const info = (await Db.impostazione('coro:' + g.id)) || {};
      await Db.salvaImpostazione('coro:' + g.id, { ...info, voce: nuova });
      g.miaVoce = nuova;
      avviso(nuova ? 'La tua voce: ' + VOCI[nuova] + '. Aggiorno il libretto…' : 'Voce tolta: riceverai tutti i file.');
      aggiornaLibrettiOra();
    } catch (err) {
      avviso('⚠ ' + err.message);
    }
    return;
  }

  if (scelta === 'direttori') {
    const altri = membri.filter((m) => m.user_id !== Sync.utente.id);
    if (!altri.length) return avviso('Nel gruppo per ora ci sei solo tu.');
    const chi = await chiediScelta('I direttori possono curare libretto e scalette e scrivere avvisi. Tocca una persona per nominarla o toglierla.',
      altri.map((m) => ({ valore: m, testo: m.ruolo === 'direttore' ? '⭐ ' + m.nome + ' (togli da direttore)' : '👤 ' + m.nome + ' (nomina direttore)' })));
    if (!chi) return;
    const nuovo = chi.ruolo === 'direttore' ? 'corista' : 'direttore';
    try {
      await Gruppi.impostaRuolo(g.id, chi.user_id, nuovo);
      avviso(nuovo === 'direttore' ? chi.nome + ' ora è direttore.' : chi.nome + ' non è più direttore.');
    } catch (err) {
      avviso('⚠ ' + err.message);
    }
    return;
  }

  if (scelta === 'rimuovi') {
    const altri = membri.filter((m) => m.user_id !== Sync.utente.id);
    if (!altri.length) return avviso('Nel gruppo per ora ci sei solo tu.');
    const chi = await chiediScelta('Chi vuoi rimuovere dal gruppo?',
      altri.map((m) => ({ valore: m, testo: '👤 ' + m.nome })));
    if (!chi) return;
    const conferma = await chiediScelta(
      `Rimuovere ${chi.nome} dal gruppo?\n\nNon vedrà più la chat. Per evitare che rientri con il vecchio ` +
      'codice, dopo puoi cambiarlo (👥 Chi c\'è → Cambia il codice).',
      [{ valore: 'si', testo: `Rimuovi ${chi.nome}`, pericolo: true }]);
    if (!conferma) return;
    try {
      await Gruppi.rimuoviMembro(g.id, chi.user_id);
      avviso(`${chi.nome} non fa più parte del gruppo.`);
    } catch (err) {
      avviso('⚠ ' + err.message);
    }
    return;
  }

  if (scelta === 'codice') {
    const conferma = await chiediScelta(
      'Cambiare il codice del gruppo?\n\nChi è già nel gruppo resta dentro; il vecchio codice non funzionerà più.',
      [{ valore: 'si', testo: '🔑 Cambia il codice' }]);
    if (!conferma) return;
    try {
      const aggiornato = await Gruppi.nuovoCodice(g.id);
      gruppoCorrente = aggiornato;
      $('chat-codice').textContent = aggiornato.codice;
      avviso(`Nuovo codice: ${aggiornato.codice}`);
    } catch (err) {
      avviso('⚠ ' + err.message);
    }
    return;
  }

  const conferma = await chiediScelta(`Uscire da «${g.nome}»?\n\nNon vedrai più la sua chat. I canti che hai già salvato restano tuoi.`,
    [{ valore: 'si', testo: 'Esci dal gruppo', pericolo: true }]);
  if (!conferma) return;
  try {
    await Gruppi.esci(g.id);
    gruppoCorrente = null;
    avviso(`Hai lasciato il gruppo «${g.nome}».`);
    mostraGruppi();
  } catch (err) {
    avviso('⚠ ' + err.message);
  }
});

// Pallino sulla voce "Gruppi" quando ci sono canti nuovi (controllato al massimo ogni minuto)
let ultimoControlloNovita = 0;
async function aggiornaNovita(forza = false) {
  const pallino = $('pallino-gruppi');
  if (!Gruppi.disponibili() || !navigator.onLine) {
    pallino.hidden = true;
    return;
  }
  if (!forza && Date.now() - ultimoControlloNovita < 60000) return;
  ultimoControlloNovita = Date.now();
  try {
    const nuovi = await Gruppi.novita(await Gruppi.miei());
    pallino.hidden = !Object.values(nuovi).some((n) => n > 0);
  } catch (e) { /* riproverò */ }
}
Sync.quandoCambiaStato((stato) => {
  if (stato === 'ok') aggiornaNovita();
  if (!Sync.utente) $('pallino-gruppi').hidden = true;
});

// ---------- Versione Coro: libretto, scalette, ruoli, voci, avvisi ----------

const MOMENTI_MESSA = ['Ingresso', 'Kyrie', 'Gloria', 'Salmo', 'Alleluia', 'Offertorio', 'Santo',
  'Mistero della fede', 'Padre nostro', 'Agnello di Dio', 'Comunione', 'Ringraziamento', 'Finale'];
const VOCI = { soprano: 'Soprano', contralto: 'Contralto', tenore: 'Tenore', basso: 'Basso' };

const dataLunga = (data) =>
  new Date(data).toLocaleDateString('it-IT', { day: 'numeric', month: 'long', year: 'numeric' });

// La voce da mettere in evidenza negli audio: quella scelta nel coro del libretto, o l'ultima scelta
async function voceDaUsare(canto) {
  if (canto && canto.libretto) {
    const info = await Db.impostazione('coro:' + canto.libretto.gruppo);
    if (info && info.voce) return info.voce;
  }
  return (await Db.impostazione('miaVoce')) || '';
}

// Nella cartella 📖 del libretto: una nota e le scalette (funzionano anche senza internet)
async function mostraInfoLibretto(cartella) {
  const nota = $('nota-cartella-libretto');
  const lista = $('scalette-cartella');
  nota.hidden = true;
  lista.hidden = true;
  lista.innerHTML = '';
  if (!cartella || !cartella.libretto) return;

  const gid = cartella.libretto.gruppo;
  const info = (await Db.impostazione('coro:' + gid)) || {};
  nota.textContent = info.attivo === false
    ? '📖 Libretto del coro. La versione Coro del gruppo non è più attiva: questi canti restano, ma non si aggiornano più.'
    : '📖 Libretto del coro: questi canti li cura il direttore e si aggiornano da soli.';
  nota.hidden = false;

  const scalette = (await Db.impostazione('scalette:' + gid)) || [];
  for (const sc of scalette) {
    const btn = crea('button', '', '📅 ' + sc.titolo);
    btn.addEventListener('click', () => apriScaletta(sc, { gruppoId: gid, modificabile: false, daGruppo: false }));
    const li = crea('li');
    li.append(btn);
    lista.append(li);
  }
  lista.hidden = !scalette.length;
}

// Prepara la parte Coro della pagina del gruppo
async function preparaCoro(g) {
  const coro = Gruppi.coroAttivo(g);
  const posto = await Gruppi.mioPosto(g.id).catch(() => ({ ruolo: 'corista', voce: '' }));
  g.mioRuolo = posto.ruolo;
  g.miaVoce = posto.voce;
  const direttore = Gruppi.sonoDirettore(g);

  $('schede-coro').hidden = !coro;
  if (!coro) scegliScheda('chat');

  const stato = $('coro-stato');
  stato.innerHTML = '';
  stato.hidden = true;
  if (coro && direttore) {
    stato.append(crea('span', '', '⭐ Versione Coro attiva fino al ' + dataLunga(g.coro_fino_al) +
      (g.creato_da === Sync.utente.id ? '' : ' · sei direttore')));
    stato.hidden = false;
  } else if (!coro && g.creato_da === Sync.utente.id) {
    stato.append(crea('p', '', '⭐ Versione Coro: libretto condiviso, scalette delle messe, ruoli, voci e avvisi per tutto il coro.'));
    if (!(await Gruppi.provaGiaUsata())) {
      const prova = crea('button', 'btn-grande', 'Provala gratis per 7 giorni');
      prova.addEventListener('click', async () => {
        try {
          Object.assign(g, await Gruppi.iniziaProva(g.id));
          avviso('Versione Coro attiva per 7 giorni: buona prova!');
          await preparaCoro(g);
          aggiornaLibrettiOra();
        } catch (err) {
          avviso('⚠ ' + err.message);
        }
      });
      stato.append(prova);
    } else {
      stato.append(crea('p', 'dettaglio', 'La prova gratuita si può usare una volta sola e l\'hai già usata in un altro gruppo. ' +
        'Per avere la versione Coro anche qui, la parrocchia deve attivare l\'abbonamento: scrivi a commissionilumart@gmail.com.'));
    }
    stato.hidden = false;
  }
}

// ---- Bacheca: avvisi del direttore, come in un'app di messaggi ----
async function mostraBacheca(vaiInFondo = false) {
  const g = gruppoCorrente;
  if (!g) return;
  const direttore = Gruppi.sonoDirettore(g);
  $('scrivi-avviso').hidden = !direttore;
  $('bacheca-solo-direttori').hidden = direttore;

  const lista = await Gruppi.avvisi(g.id);
  if (gruppoCorrente !== g || $('pannello-bacheca').hidden) return;
  const eraInFondo = vaiInFondo || window.innerHeight + window.scrollY >= document.body.scrollHeight - 120;

  const ul = $('elenco-bacheca');
  ul.innerHTML = '';
  let giornoPrecedente = '';
  for (const a of lista) {
    const quando = new Date(a.creato);
    const giorno = quando.toLocaleDateString('it-IT', { weekday: 'long', day: 'numeric', month: 'long' });
    if (giorno !== giornoPrecedente) {
      ul.append(crea('li', 'giorno-chat', giorno));
      giornoPrecedente = giorno;
    }
    const mio = a.user_id === Sync.utente.id;
    const li = crea('li', 'messaggio avviso-bacheca' + (mio ? ' mio' : ''));
    const testa = crea('div', 'autore', '📣 ' + (mio ? 'Tu' : a.autore) + ' · ' + formatoOra(quando));
    if (direttore) {
      const togli = crea('button', 'btn-mini', '🗑');
      togli.title = 'Togli dalla bacheca';
      togli.addEventListener('click', async () => {
        const scelta = await chiediScelta('Togliere questo avviso dalla bacheca?', [{ valore: 'si', testo: 'Togli', pericolo: true }]);
        if (!scelta) return;
        try {
          await Gruppi.eliminaAvviso(a.id);
          mostraBacheca();
        } catch (err) {
          avviso('⚠ ' + err.message);
        }
      });
      testa.append(togli);
    }
    li.append(testa, crea('p', 'testo-messaggio', a.testo));
    ul.append(li);
  }
  $('bacheca-vuota').hidden = lista.length > 0;
  if (eraInFondo) window.scrollTo(0, document.body.scrollHeight);
  if (lista.length) {
    await Gruppi.segnaVisto(g.id, lista[lista.length - 1].creato);
    aggiornaNovita(true);
  }
}

// La casella per scrivere si allunga mentre si scrive (fino a 6 righe circa)
const testoAvviso = $('testo-avviso');
function adattaCasellaAvviso() {
  testoAvviso.style.height = 'auto';
  testoAvviso.style.height = Math.min(testoAvviso.scrollHeight, 160) + 'px';
}
testoAvviso.addEventListener('input', adattaCasellaAvviso);
// Sul computer: Ctrl+Invio invia
testoAvviso.addEventListener('keydown', (e) => {
  if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) $('scrivi-avviso').requestSubmit();
});

$('scrivi-avviso').addEventListener('submit', async (e) => {
  e.preventDefault();
  const testo = testoAvviso.value.trim();
  if (!testo) return;
  const invia = e.target.querySelector('button');
  invia.disabled = true;
  try {
    await Gruppi.pubblicaAvviso(gruppoCorrente.id, testo);
    testoAvviso.value = '';
    adattaCasellaAvviso();
    await mostraBacheca(true);
  } catch (err) {
    avviso('⚠ ' + err.message);
  } finally {
    invia.disabled = false;
  }
});

// ---- Schede del gruppo Coro ----
function scegliScheda(nome) {
  document.querySelectorAll('#schede-coro button').forEach((b) => b.classList.toggle('attiva', b.dataset.scheda === nome));
  $('pannello-bacheca').hidden = nome !== 'bacheca';
  $('pannello-chat').hidden = nome !== 'chat';
  $('pannello-libretto').hidden = nome !== 'libretto';
  $('pannello-scalette').hidden = nome !== 'scalette';
  $('pannello-messaggi').hidden = nome !== 'messaggi';
  if (nome !== 'messaggi') conversazioneCon = null;
  if (nome === 'messaggi') mostraMessaggi(true);
  if (nome === 'bacheca') mostraBacheca(true);
  if (nome === 'libretto') mostraLibretto();
  if (nome === 'scalette') mostraScalette();
}
document.querySelectorAll('#schede-coro button').forEach((b) =>
  b.addEventListener('click', () => scegliScheda(b.dataset.scheda)));

// ---- Libretto ----
async function mostraLibretto() {
  const g = gruppoCorrente;
  const ul = $('elenco-libretto');
  const direttore = Gruppi.sonoDirettore(g);
  $('btn-aggiungi-libretto').hidden = !direttore;
  ul.innerHTML = '';
  let voci;
  try {
    voci = await Gruppi.libretto(g.id);
  } catch (err) {
    ul.append(crea('li', 'dettaglio', '⚠ ' + err.message));
    return;
  }
  if (gruppoCorrente !== g) return;
  for (const v of voci) {
    const li = crea('li', 'allegato');
    const riga = crea('div', 'allegato-riga');
    const files = v.allegati || [];
    const dettagli = [];
    if (files.some((f) => f.tipo === 'audio')) dettagli.push('🎵');
    if (files.some((f) => f.tipo === 'spartito' || f.tipo === 'pdf')) dettagli.push('🎼');
    if (riassuntoVoci(files)) dettagli.push(riassuntoVoci(files));
    const nome = crea('button', 'allegato-nome nome-libretto', '♪ ' + v.titolo);
    nome.append(crea('span', 'dettaglio', ' ' + dettagli.join(' ')));
    nome.addEventListener('click', () => apriDalLibretto(v.id));
    riga.append(nome);
    if (direttore) {
      if (v.canto_origine) {
        const aggiorna = crea('button', 'btn-mini', '↻');
        aggiorna.title = 'Aggiorna con la versione attuale del tuo canto';
        aggiorna.addEventListener('click', async () => {
          const vociFile = await vociPerIlLibretto(v.canto_origine);
          if (!vociFile) return;
          try {
            await Gruppi.aggiornaNelLibretto(v, (t) => avviso(t), vociFile);
            avviso('«' + v.titolo + '» aggiornato per tutto il coro.');
            mostraLibretto();
            aggiornaLibrettiOra();
          } catch (err) {
            avviso('⚠ ' + err.message);
          }
        });
        riga.append(aggiorna);
      }
      if (files.length) {
        const voci = crea('button', 'btn-mini', '🎤');
        voci.title = 'Per quale voce è ogni file';
        voci.addEventListener('click', async () => {
          const scelte = await chiediVociFile(v.titolo, files, false);
          if (!scelte) return;
          try {
            await Gruppi.impostaVociLibretto(v, scelte);
            avviso('Fatto: ognuno riceverà i file della sua voce.');
            mostraLibretto();
            aggiornaLibrettiOra();
          } catch (err) {
            avviso('⚠ ' + err.message);
          }
        });
        riga.append(voci);
      }
      const togli = crea('button', 'btn-mini', '🗑');
      togli.title = 'Togli dal libretto';
      togli.addEventListener('click', async () => {
        const scelta = await chiediScelta('Togliere «' + v.titolo + '» dal libretto del coro?\n\nSparirà dal libretto di tutti. Il tuo canto resta tra i tuoi canti.',
          [{ valore: 'si', testo: 'Togli dal libretto', pericolo: true }]);
        if (!scelta) return;
        try {
          await Gruppi.rimuoviDalLibretto(v);
          mostraLibretto();
          aggiornaLibrettiOra();
        } catch (err) {
          avviso('⚠ ' + err.message);
        }
      });
      riga.append(togli);
    }
    li.append(riga);
    ul.append(li);
  }
  $('libretto-vuoto').hidden = voci.length > 0;
}

$('btn-aggiungi-libretto').addEventListener('click', async () => {
  const g = gruppoCorrente;
  const id = await scegliCanto('Quale canto vuoi aggiungere al libretto?');
  if (!id) return;
  const vociFile = await vociPerIlLibretto(id);
  if (!vociFile) return;
  try {
    await Gruppi.aggiungiAlLibretto(g.id, id, (t) => avviso(t), vociFile);
    avviso('Canto aggiunto al libretto: arriverà a tutto il coro.');
    mostraLibretto();
    aggiornaLibrettiOra();
  } catch (err) {
    avviso('⚠ ' + err.message);
  }
});

// Apre un canto del libretto (dalla copia sul dispositivo; se non c'è ancora, la scarica)
async function apriDalLibretto(id) {
  if (!(await Db.canto(id))) {
    avviso('Scarico il libretto…');
    await aggiornaLibrettiOra();
  }
  if (!(await Db.canto(id))) return avviso('Questo canto non è ancora disponibile su questo dispositivo: serve internet.');
  mostraCanto(id);
}

// ---- File per voce (libretto) ----
// Dal nome del file provo a capire per quale voce è: "Santo - soprano.mp3" → soprano
function voceDalNome(nome) {
  const n = semplifica(nome);
  if (/sopran/.test(n)) return 'soprano';
  if (/contralt|(^|[^a-z])alt[oi]?([^a-z]|$)/.test(n)) return 'contralto';
  if (/tenor/.test(n)) return 'tenore';
  if (/bass[oi]?([^a-z]|$)|baritono/.test(n)) return 'basso';
  return '';
}

// Chiede al direttore per quale voce è ogni file. files: [{ id, nome, voce? }]
// Restituisce { [id]: voce } (voce '' = per tutti), oppure null per "Annulla".
function chiediVociFile(titoloCanto, files, daNome = true) {
  const dialogo = $('dialogo-voci');
  const ul = $('voci-file');
  $('voci-domanda').textContent = 'Per chi è ogni file di «' + titoloCanto + '»?';
  ul.innerHTML = '';
  const tendine = [];
  for (const f of files) {
    const li = crea('li');
    li.append(crea('span', 'nome-file', (ICONA_FILE[f.tipo] || '📄') + ' ' + f.nome));
    const sel = crea('select');
    sel.setAttribute('aria-label', 'Voce per ' + f.nome);
    for (const [valore, testo] of [['', '👥 Per tutti'], ...Object.entries(VOCI).map(([v, t]) => [v, '🎤 Solo ' + t])]) {
      const o = crea('option', '', testo);
      o.value = valore;
      sel.append(o);
    }
    sel.value = f.voce !== undefined && !daNome ? f.voce || '' : voceDalNome(f.nome);
    tendine.push([f.id, sel]);
    li.append(sel);
    ul.append(li);
  }
  dialogo.showModal();
  return new Promise((resolve) => {
    const fine = (valore) => {
      dialogo.onclose = null;
      dialogo.oncancel = null;
      resolve(valore);
    };
    dialogo.oncancel = (e) => {
      e.preventDefault();
      dialogo.close('annulla');
    };
    dialogo.onclose = () => fine(dialogo.returnValue === 'ok' ? Object.fromEntries(tendine.map(([id, s]) => [id, s.value])) : null);
    dialogo.returnValue = '';
  });
}

// Prima di mettere un canto nel libretto: per quale voce è ogni file?
// Lo chiedo solo se ha più file o se dal nome sembra che un file sia per una voce.
async function vociPerIlLibretto(cantoId) {
  const canto = await Db.canto(cantoId);
  const files = (await Db.allegati(cantoId)).filter((a) => a.dati);
  if (files.length < 2 && !files.some((f) => voceDalNome(f.nome))) return {};
  return chiediVociFile(canto ? canto.titolo : '', files);
}

// Le iniziali delle voci dei file di un canto del libretto: "🎤 S C T B"
function riassuntoVoci(files) {
  const voci = Object.keys(VOCI).filter((v) => files.some((f) => f.voce === v));
  return voci.length ? '🎤 ' + voci.map((v) => VOCI[v][0]).join(' ') : '';
}

// ---- Messaggi privati ----
let conversazioneCon = null;  // user_id della persona con cui si sta scrivendo
let conversazioneRichiesta = null; // aperta toccando una notifica

async function mostraMessaggi(vaiInFondo = false) {
  const g = gruppoCorrente;
  if (!g || $('pannello-messaggi').hidden) return;
  let lista;
  let membri;
  try {
    [lista, membri] = await Promise.all([Gruppi.messaggiPrivati(g.id), Gruppi.membri(g.id)]);
  } catch (err) {
    const ul = $('elenco-conversazioni');
    ul.innerHTML = '';
    ul.append(crea('li', 'dettaglio', navigator.onLine ? '⚠ ' + err.message : '📴 Senza internet i messaggi non si aggiornano.'));
    return;
  }
  if (gruppoCorrente !== g || $('pannello-messaggi').hidden) return;
  if (conversazioneRichiesta) {
    conversazioneCon = conversazioneRichiesta;
    conversazioneRichiesta = null;
    vaiInFondo = true;
  }
  const altro = conversazioneCon && membri.find((m) => m.user_id === conversazioneCon);
  if (conversazioneCon && !altro) conversazioneCon = null; // non è più nel gruppo
  $('scegli-conversazione').hidden = !!conversazioneCon;
  $('conversazione').hidden = !conversazioneCon;
  if (conversazioneCon) {
    const corretti = lista.some((m) => m.canto) ? await Gruppi.cantiCorretti(g.id) : new Set();
    if (gruppoCorrente !== g) return;
    disegnaConversazione(g, altro, lista, vaiInFondo, corretti);
  }
  else disegnaConversazioni(g, membri, lista);
  aggiornaPallinoMessaggi(lista);
}

function aggiornaPallinoMessaggi(lista) {
  $('pallino-messaggi').hidden = !lista.some((m) => m.a === Sync.utente.id && !m.letto);
}

// L'elenco delle persone del coro, con l'ultimo messaggio e quanti non ho letto
function disegnaConversazioni(g, membri, lista) {
  const io = Sync.utente.id;
  const ul = $('elenco-conversazioni');
  ul.innerHTML = '';
  const altri = membri.filter((m) => m.user_id !== io).map((m) => {
    const nostri = lista.filter((x) => (x.da === m.user_id && x.a === io) || (x.da === io && x.a === m.user_id));
    return {
      m,
      ultimo: nostri[nostri.length - 1] || null,
      nuovi: nostri.filter((x) => x.da === m.user_id && !x.letto).length,
    };
  });
  altri.sort((x, y) => (y.ultimo ? Date.parse(y.ultimo.creato) : 0) - (x.ultimo ? Date.parse(x.ultimo.creato) : 0) ||
    x.m.nome.localeCompare(y.m.nome, 'it'));
  for (const { m, ultimo, nuovi } of altri) {
    const btn = crea('button', 'conversazione-voce');
    const riga = crea('span', 'riga-nome');
    const direttore = m.ruolo === 'direttore' || m.user_id === g.creato_da;
    riga.append(crea('strong', '', m.nome + (direttore ? ' ⭐' : '')));
    if (m.voce) riga.append(crea('span', 'etichetta-voce', VOCI[m.voce] || m.voce));
    if (nuovi) riga.append(crea('span', 'nuovi', nuovi === 1 ? '1 nuovo' : nuovi + ' nuovi'));
    btn.append(riga);
    const ultimoTesto = ultimo && (ultimo.testo || (ultimo.canto ? '♪ ' + ultimo.canto.titolo : ''));
    btn.append(crea('span', 'anteprima', ultimo ? (ultimo.da === io ? 'Tu: ' : '') + ultimoTesto : 'Scrivi un messaggio'));
    btn.addEventListener('click', () => {
      conversazioneCon = m.user_id;
      mostraMessaggi(true);
    });
    const li = crea('li');
    li.append(btn);
    ul.append(li);
  }
  $('conversazioni-vuote').hidden = altri.length > 0;
}

// La conversazione con una persona, come in un'app di messaggi
// Il canto dentro un messaggio privato: Apri (e correggi), Salva nei miei canti
function schedaCantoPrivato(g, x, altro, mio, corretti) {
  const c = { id: x.id, titolo: x.canto.titolo, testo: x.canto.testo || '', allegati: x.canto.allegati || [] };
  const scheda = crea('div', 'scheda-canto');
  scheda.append(crea('div', 'titolo-condiviso', '♪ ' + c.titolo));
  scheda.append(crea('div', 'dettaglio', riassuntoCanto(c) + (corretti.has(x.id) ? ' · ✏️ con correzioni' : '')));
  const azioni = crea('div', 'azioni-chat');
  if (siPuoAprire(c)) {
    const apri = crea('button', 'btn-piccolo', '👁 Apri');
    apri.addEventListener('click', () => apriCantoEsterno({
      ...c, gruppo: g.id, origine: { tipo: 'privato', rif: x.id },
      puoCorreggere: Gruppi.coroAttivo(g), altro: altro.user_id,
      nota: mio ? '✉️ L\'hai mandato a ' + altro.nome + ': potete correggerlo tutti e due.'
        : '✉️ Te l\'ha mandato ' + altro.nome + ': potete correggerlo tutti e due.',
      ritorno: { scheda: 'messaggi', con: altro.user_id },
    }));
    azioni.append(apri);
  }
  if (!mio) {
    const salva = crea('button', 'btn-piccolo salva', '⬇ Salva nei miei canti');
    salva.addEventListener('click', () => salvaCondiviso(c, salva));
    azioni.append(salva);
  }
  scheda.append(azioni);
  return scheda;
}

function disegnaConversazione(g, altro, lista, vaiInFondo, corretti = new Set()) {
  const io = Sync.utente.id;
  $('nome-conversazione').textContent = '✉️ ' + altro.nome;
  const nostri = lista.filter((x) => (x.da === altro.user_id && x.a === io) || (x.da === io && x.a === altro.user_id));
  const eraInFondo = vaiInFondo || window.innerHeight + window.scrollY >= document.body.scrollHeight - 120;
  const ul = $('elenco-privati');
  ul.classList.add('privati');
  ul.innerHTML = '';
  let giornoPrecedente = '';
  for (const x of nostri) {
    const quando = new Date(x.creato);
    const giorno = quando.toLocaleDateString('it-IT', { weekday: 'long', day: 'numeric', month: 'long' });
    if (giorno !== giornoPrecedente) {
      ul.append(crea('li', 'giorno-chat', giorno));
      giornoPrecedente = giorno;
    }
    const mio = x.da === io;
    const li = crea('li', 'messaggio' + (mio ? ' mio' : ''));
    const testa = crea('div', 'autore', (mio ? 'Tu' : altro.nome) + ' · ' + formatoOra(quando));
    if (mio && x.letto) testa.append(crea('span', 'letto', '✓✓ letto'));
    const azioni = crea('button', 'btn-mini', mio ? '🗑' : '⋯');
    azioni.setAttribute('aria-label', mio ? 'Elimina il messaggio' : 'Segnala o blocca');
    azioni.title = mio ? 'Elimina il messaggio' : 'Segnala o blocca';
    azioni.addEventListener('click', () => (mio ? eliminaPrivato(x) : azioniSuPrivato(x, altro)));
    testa.append(azioni);
    li.append(testa);
    if (x.testo) li.append(crea('p', 'testo-messaggio', x.testo));
    if (x.canto) li.append(schedaCantoPrivato(g, x, altro, mio, corretti));
    ul.append(li);
  }
  $('privati-vuoti').hidden = nostri.length > 0;
  if (eraInFondo) window.scrollTo(0, document.body.scrollHeight);
  // i messaggi che mi ha mandato ora li ho letti
  if (nostri.some((x) => x.da === altro.user_id && !x.letto)) {
    Gruppi.segnaLetti(g.id, altro.user_id).then(() => {
      for (const x of nostri) if (x.da === altro.user_id) x.letto = x.letto || new Date().toISOString();
      aggiornaPallinoMessaggi(lista);
      aggiornaNovita(true);
    });
  }
}

async function eliminaPrivato(x) {
  const scelta = await chiediScelta('Eliminare questo messaggio? Sparirà anche per l\'altra persona.',
    [{ valore: 'si', testo: 'Elimina', pericolo: true }]);
  if (!scelta) return;
  try {
    await Gruppi.eliminaPrivato(x);
    mostraMessaggi();
  } catch (err) {
    avviso('⚠ ' + err.message);
  }
}

async function azioniSuPrivato(x, altro) {
  if (!x.testo && x.canto) x = { ...x, testo: '♪ ' + x.canto.titolo }; // per la segnalazione
  const scelta = await chiediScelta('Messaggio di ' + altro.nome,
    [{ valore: 'segnala', testo: '⚑ Segnala questo messaggio' }, { valore: 'blocca', testo: '🚫 Blocca ' + altro.nome, pericolo: true }]);
  if (!scelta) return;
  try {
    if (scelta === 'segnala') {
      const motivo = await chiediScelta('Perché lo segnali?', [
        { valore: 'Contenuto offensivo o inappropriato', testo: 'Contenuto offensivo o inappropriato' },
        { valore: 'Molestie', testo: 'Molestie' },
        { valore: 'Spam o pubblicità', testo: 'Spam o pubblicità' },
        { valore: 'Altro', testo: 'Altro' },
      ]);
      if (!motivo) return;
      await Gruppi.segnalaPrivato(x, altro.nome, motivo);
      avviso('Grazie: il messaggio è stato segnalato e non lo vedrai più.');
    } else {
      const conferma = await chiediScelta('Bloccare ' + altro.nome + '?\n\nNon vedrai più i suoi canti e i suoi messaggi, e non riceverai le sue notifiche. Puoi sbloccare quando vuoi da Account → Persone bloccate.',
        [{ valore: 'si', testo: '🚫 Blocca ' + altro.nome, pericolo: true }]);
      if (!conferma) return;
      await Gruppi.blocca(altro.user_id, altro.nome);
      conversazioneCon = null;
      avviso(altro.nome + ' è bloccato.');
    }
    mostraMessaggi();
  } catch (err) {
    avviso('⚠ ' + err.message);
  }
}

$('btn-chiudi-conversazione').addEventListener('click', () => {
  conversazioneCon = null;
  mostraMessaggi();
  window.scrollTo(0, 0);
});

const testoPrivato = $('testo-privato');
function adattaCasellaPrivato() {
  testoPrivato.style.height = 'auto';
  testoPrivato.style.height = Math.min(testoPrivato.scrollHeight, 160) + 'px';
}
testoPrivato.addEventListener('input', adattaCasellaPrivato);
testoPrivato.addEventListener('keydown', (e) => {
  if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) $('scrivi-privato').requestSubmit();
});
$('btn-canto-privato').addEventListener('click', async () => {
  const g = gruppoCorrente;
  const con = conversazioneCon;
  if (!g || !con) return;
  const id = await scegliCanto('Quale canto vuoi mandare?');
  if (!id) return;
  const pulsante = $('btn-canto-privato');
  pulsante.disabled = true;
  try {
    // l'eventuale testo scritto parte insieme al canto
    await Gruppi.scriviPrivato(g.id, con, testoPrivato.value.trim(), id, (t) => avviso(t));
    testoPrivato.value = '';
    adattaCasellaPrivato();
    avviso('Canto mandato.');
    await mostraMessaggi(true);
  } catch (err) {
    avviso('⚠ ' + (navigator.onLine ? err.message : 'Senza internet il canto non parte.'));
  } finally {
    pulsante.disabled = false;
  }
});

$('scrivi-privato').addEventListener('submit', async (e) => {
  e.preventDefault();
  const testo = testoPrivato.value.trim();
  if (!testo || !conversazioneCon || !gruppoCorrente) return;
  const invia = e.target.querySelector('button[type="submit"]');
  invia.disabled = true;
  try {
    await Gruppi.scriviPrivato(gruppoCorrente.id, conversazioneCon, testo);
    testoPrivato.value = '';
    adattaCasellaPrivato();
    await mostraMessaggi(true);
  } catch (err) {
    avviso('⚠ ' + (navigator.onLine ? err.message : 'Senza internet il messaggio non parte.'));
  } finally {
    invia.disabled = false;
  }
});

// Il pallino sulla scheda "Messaggi" quando apro il gruppo
async function controllaMessaggiNuovi(g) {
  const nuovi = await Gruppi.privatiNonLetti().catch(() => ({}));
  if (gruppoCorrente === g) $('pallino-messaggi').hidden = !nuovi[g.id];
}

// ---- Copia dei libretti sul dispositivo ----
let librettiInCorso = null;
let ultimoAggiornamentoLibretti = 0;
function aggiornaLibrettiOra() {
  if (librettiInCorso) return librettiInCorso;
  librettiInCorso = (async () => {
    try {
      const cambiato = await Gruppi.aggiornaLibretti();
      ultimoAggiornamentoLibretti = Date.now();
      if (cambiato && !schermate.elenco.hidden) {
        const y = window.scrollY;
        await mostraElenco();
        window.scrollTo(0, y);
      }
    } catch (err) {
      console.warn('Libretti non aggiornati:', err);
    } finally {
      librettiInCorso = null;
    }
  })();
  return librettiInCorso;
}
Sync.quandoCambiaStato((stato) => {
  // dopo ogni sincronizzazione riuscita, al massimo ogni 3 minuti
  if (stato === 'ok' && Date.now() - ultimoAggiornamentoLibretti > 3 * 60 * 1000) aggiornaLibrettiOra();
});

// ---- Scalette ----
async function mostraScalette() {
  const g = gruppoCorrente;
  const direttore = Gruppi.sonoDirettore(g);
  $('btn-nuova-scaletta').hidden = !direttore;
  const lista = await Gruppi.scalette(g.id);
  if (gruppoCorrente !== g) return;
  const ul = $('elenco-scalette');
  ul.innerHTML = '';
  for (const sc of lista) {
    const btn = crea('button', 'voce-scaletta', '📅 ' + sc.titolo);
    btn.append(crea('span', 'dettaglio', (sc.voci || []).length + ' canti'));
    btn.addEventListener('click', () => apriScaletta(sc, { gruppoId: g.id, modificabile: direttore, daGruppo: true }));
    const li = crea('li');
    li.append(btn);
    ul.append(li);
  }
  $('scalette-vuote').hidden = lista.length > 0;
}

function prossimaDomenica() {
  const d = new Date();
  d.setDate(d.getDate() + ((7 - d.getDay()) % 7));
  return d;
}
const dataIso = (d) => d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');

$('btn-nuova-scaletta').addEventListener('click', async () => {
  const domenica = prossimaDomenica();
  const titoloScaletta = await chiediNome('Titolo della scaletta',
    'Messa di domenica ' + domenica.toLocaleDateString('it-IT', { day: 'numeric', month: 'long' }));
  if (!titoloScaletta) return;
  apriScaletta({ titolo: titoloScaletta, data: dataIso(domenica), voci: [] },
    { gruppoId: gruppoCorrente.id, modificabile: true, daGruppo: true, nuova: true });
});

// La scaletta aperta e, se si sta scorrendo, il canto a cui si è arrivati
let scalettaAperta = null;   // { scaletta, gruppoId, modificabile, daGruppo, modificata }
let percorsoScaletta = null; // { indice }

function apriScaletta(sc, opzioni) {
  scalettaAperta = { scaletta: JSON.parse(JSON.stringify(sc)), ...opzioni, modificata: !!opzioni.nuova };
  percorsoScaletta = null;
  disegnaScaletta();
}

function disegnaScaletta() {
  const { scaletta, modificabile } = scalettaAperta;
  if (schermate.scaletta.hidden) mostra('scaletta', scaletta.titolo, true);
  else titolo.textContent = scaletta.titolo;
  const voci = scaletta.voci || [];
  $('scaletta-sottotitolo').textContent = (scaletta.data ? dataLunga(scaletta.data) + ' · ' : '') +
    (voci.length === 1 ? '1 canto' : voci.length + ' canti') + ' · tocca un canto per aprirlo';

  const ol = $('voci-scaletta');
  ol.innerHTML = '';
  voci.forEach((v, i) => {
    const li = crea('li', 'voce-scaletta-riga');
    li.append(crea('span', 'momento', v.momento));
    const apri = crea('button', 'titolo-voce', '♪ ' + v.titolo);
    apri.addEventListener('click', () => {
      percorsoScaletta = { indice: i };
      apriDalLibretto(v.libretto_id);
    });
    li.append(apri);
    if (modificabile) {
      const sposta = (passo) => {
        const j = i + passo;
        if (j < 0 || j >= voci.length) return;
        [voci[i], voci[j]] = [voci[j], voci[i]];
        scalettaAperta.modificata = true;
        disegnaScaletta();
      };
      const su = crea('button', 'btn-mini', '↑');
      su.title = 'Sposta su';
      su.addEventListener('click', () => sposta(-1));
      const giu = crea('button', 'btn-mini', '↓');
      giu.title = 'Sposta giù';
      giu.addEventListener('click', () => sposta(1));
      const togli = crea('button', 'btn-mini', '✕');
      togli.title = 'Togli dalla scaletta';
      togli.addEventListener('click', () => {
        voci.splice(i, 1);
        scalettaAperta.modificata = true;
        disegnaScaletta();
      });
      li.append(su, giu, togli);
    }
    ol.append(li);
  });
  $('scaletta-vuota').hidden = voci.length > 0;
  $('comandi-scaletta').hidden = !modificabile;
  $('btn-elimina-scaletta').hidden = !scaletta.id;
  $('btn-salva-scaletta').hidden = !(modificabile && scalettaAperta.modificata);
}

$('btn-aggiungi-voce').addEventListener('click', async () => {
  let momento = await chiediScelta('Per quale momento della messa?',
    [...MOMENTI_MESSA.map((m) => ({ valore: m, testo: m })), { valore: '__altro', testo: 'Altro…' }]);
  if (!momento) return;
  if (momento === '__altro') momento = await chiediNome('Scrivi il momento (es. «Canto a Maria»)');
  if (!momento) return;
  let voci;
  try {
    voci = await Gruppi.libretto(scalettaAperta.gruppoId);
  } catch (err) {
    return avviso('⚠ ' + err.message);
  }
  if (!voci.length) return avviso('Prima aggiungi dei canti al libretto del coro.');
  const scelto = await chiediScelta('Quale canto per «' + momento + '»?', voci.map((v) => ({ valore: v, testo: '♪ ' + v.titolo })));
  if (!scelto) return;
  scalettaAperta.scaletta.voci.push({ momento, libretto_id: scelto.id, titolo: scelto.titolo });
  scalettaAperta.modificata = true;
  disegnaScaletta();
});

$('btn-rinomina-scaletta').addEventListener('click', async () => {
  const sc = scalettaAperta.scaletta;
  const nuovo = await chiediNome('Titolo della scaletta', sc.titolo);
  if (!nuovo) return;
  const attuale = sc.data ? new Date(sc.data).toLocaleDateString('it-IT') : '';
  const data = await chiediNome('Data (giorno/mese/anno, es. 20/10/2026). Lascia vuoto se non serve.', attuale, { facoltativo: true });
  if (data === null) return;
  if (data) {
    const m = /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/.exec(data.trim());
    if (!m) return avviso('Data non valida: scrivila come 20/10/2026.');
    sc.data = m[3] + '-' + m[2].padStart(2, '0') + '-' + m[1].padStart(2, '0');
  } else {
    sc.data = null;
  }
  sc.titolo = nuovo;
  scalettaAperta.modificata = true;
  disegnaScaletta();
});

$('btn-salva-scaletta').addEventListener('click', async () => {
  try {
    await Gruppi.salvaScaletta(scalettaAperta.gruppoId, scalettaAperta.scaletta);
    scalettaAperta.modificata = false;
    avviso('Scaletta salvata: la vede tutto il coro.');
    aggiornaLibrettiOra();
    tornaDallaScaletta();
  } catch (err) {
    avviso('⚠ ' + err.message);
  }
});

$('btn-elimina-scaletta').addEventListener('click', async () => {
  const sc = scalettaAperta.scaletta;
  const scelta = await chiediScelta('Eliminare la scaletta «' + sc.titolo + '»? Sparirà per tutto il coro.',
    [{ valore: 'si', testo: 'Elimina la scaletta', pericolo: true }]);
  if (!scelta) return;
  try {
    await Gruppi.eliminaScaletta(sc.id);
    scalettaAperta.modificata = false;
    aggiornaLibrettiOra();
    tornaDallaScaletta();
  } catch (err) {
    avviso('⚠ ' + err.message);
  }
});

// Dalla scaletta si torna al gruppo (scheda Scalette) o alla cartella del libretto
async function tornaDallaScaletta() {
  if (scalettaAperta && scalettaAperta.modificata) {
    const scelta = await chiediScelta('Uscire senza salvare la scaletta?', [{ valore: 'esci', testo: 'Esci senza salvare', pericolo: true }]);
    if (!scelta) return;
  }
  const daGruppo = scalettaAperta && scalettaAperta.daGruppo;
  scalettaAperta = null;
  percorsoScaletta = null;
  if (daGruppo && gruppoCorrente) {
    await apriChat(gruppoCorrente);
    scegliScheda('scalette');
  } else {
    mostraElenco();
  }
}

// Nella pagina del canto aperto da una scaletta: ‹ canto precedente · canto successivo ›
function aggiornaNavScaletta(id) {
  const nav = $('nav-scaletta');
  const voci = scalettaAperta && scalettaAperta.scaletta.voci;
  if (!percorsoScaletta || !voci || !voci[percorsoScaletta.indice] || voci[percorsoScaletta.indice].libretto_id !== id) {
    nav.hidden = true;
    return;
  }
  const i = percorsoScaletta.indice;
  const prima = $('btn-scaletta-prima');
  const dopo = $('btn-scaletta-dopo');
  prima.hidden = i === 0;
  dopo.hidden = i === voci.length - 1;
  if (i > 0) prima.textContent = '‹ ' + voci[i - 1].momento;
  if (i < voci.length - 1) dopo.textContent = voci[i + 1].momento + ' ›';
  nav.hidden = false;
}
$('btn-scaletta-prima').addEventListener('click', () => {
  percorsoScaletta.indice--;
  apriDalLibretto(scalettaAperta.scaletta.voci[percorsoScaletta.indice].libretto_id);
});
$('btn-scaletta-dopo').addEventListener('click', () => {
  percorsoScaletta.indice++;
  apriDalLibretto(scalettaAperta.scaletta.voci[percorsoScaletta.indice].libretto_id);
});

// ---- Creare un gruppo (con il limite dei 2 gruppi gratuiti) ----
async function creaGruppo(nomeGruppo, mioNome, conProva = false) {
  const g = await Gruppi.crea(nomeGruppo, mioNome, conProva);
  await apriChat(g);
  const scelta = await chiediScelta(
    (conProva ? 'Gruppo Coro creato, con 7 giorni di prova gratuita!' : 'Gruppo creato!') +
    ' Il codice per entrare è:\n\n' + g.codice + '\n\nMandalo a chi vuoi invitare.',
    [{ valore: 'invita', testo: '📨 Invita adesso' }], 'Più tardi');
  if (scelta) invita(g);
}

// ---------- Pagina iniziale ----------
// Prima si vedono solo la croce e "Canta con noi". Toccandolo:
//   - se l'accesso è già salvato (o l'accesso online non è attivo) si entra nei canti;
//   - altrimenti compare il modulo per iscriversi o accedere.
const paginaIniziale = $('pagina-iniziale');
let moduloAperto = false; // il modulo di accesso è visibile sulla pagina iniziale?

const serveAccesso = () => Sync.stato !== 'spento' && !Sync.utente;

function aggiornaIniziale() {
  const dentro = !!Sync.utente;
  if (!serveAccesso()) moduloAperto = false;
  $('blocco-accesso').hidden = !moduloAperto;
  $('iniziale-entra').hidden = moduloAperto;
  paginaIniziale.classList.toggle('con-accesso', moduloAperto);
  $('iniziale-utente').hidden = !dentro;
  if (dentro) $('iniziale-utente').textContent = '✓ Accesso salvato: ' + Sync.utente.email;
}

function chiudiIniziale() {
  paginaIniziale.classList.add('chiusa');
  ricordaPosizione(schermataAttuale());
}

// conModulo = true: si apre direttamente il modulo di accesso (es. da "Accedi" nella pagina Account)
function apriIniziale(conModulo = false) {
  moduloAperto = conModulo === true && serveAccesso();
  mostraPaginaAccesso('accesso');
  aggiornaIniziale();
  paginaIniziale.classList.remove('chiusa');
  paginaIniziale.scrollTop = 0;
  ricordaPosizione(schermataAttuale());
}

$('btn-entra').addEventListener('click', () => {
  if (!serveAccesso()) return chiudiIniziale();
  moduloAperto = true;
  mostraPaginaAccesso('accesso');
  aggiornaIniziale();
  $('modulo-accesso').email.focus();
});
$('btn-senza-account').addEventListener('click', () => {
  messaggioAccount('');
  chiudiIniziale();
});

// ---------- Notifiche: attivarle e aprire il gruppo giusto quando se ne tocca una ----------

async function aggiornaNotificheUI() {
  const stato = await Notifiche.stato().catch(() => 'non supportate');
  const testi = {
    attive: '🔔 Notifiche attive su questo dispositivo.',
    spente: '🔕 Notifiche spente su questo dispositivo.',
    bloccate: '🔕 Le notifiche sono bloccate nelle impostazioni del telefono (o del browser).',
    'non supportate': '🔕 ' + Notifiche.perchéNo(),
  };
  $('stato-notifiche').textContent = testi[stato];
  const pulsante = $('btn-notifiche');
  pulsante.hidden = !Sync.utente || stato === 'non supportate' || stato === 'bloccate';
  pulsante.textContent = stato === 'attive' ? 'Disattiva' : 'Attiva le notifiche';
  $('invito-notifiche').hidden = !(Sync.utente && stato === 'spente');
}

async function attivaNotifiche() {
  try {
    await Notifiche.attiva();
    avviso('🔔 Notifiche attive: ti avviseremo quando arrivano avvisi, canti e scalette.');
  } catch (err) {
    await chiediScelta(err.message, [], 'Ho capito');
  }
  aggiornaNotificheUI();
}

$('btn-notifiche').addEventListener('click', async () => {
  if ((await Notifiche.stato()) === 'attive') {
    await Notifiche.disattiva().catch((err) => avviso('⚠ ' + err.message));
    avviso('🔕 Notifiche spente su questo dispositivo.');
    aggiornaNotificheUI();
  } else {
    attivaNotifiche();
  }
});
$('btn-attiva-notifiche-gruppi').addEventListener('click', attivaNotifiche);

// Apre un gruppo (nella scheda indicata) quando si tocca una sua notifica
let schedaRichiesta = null;
async function apriGruppoDaNotifica(gruppoId, scheda, con = null) {
  paginaIniziale.classList.add('senza-animazione', 'chiusa');
  if (!Gruppi.disponibili()) return mostraElenco();
  try {
    const g = (await Gruppi.miei()).find((x) => x.id === gruppoId);
    if (!g) return mostraGruppi();
    schedaRichiesta = scheda || 'bacheca';
    conversazioneRichiesta = scheda === 'messaggi' ? con : null;
    await apriChat(g);
  } catch (err) {
    mostraGruppi();
  }
}

// Se l'app è già aperta, il service worker ci manda un messaggio
if ('serviceWorker' in navigator) {
  navigator.serviceWorker.addEventListener('message', (e) => {
    if (e.data && e.data.tipo === 'apri-gruppo' && e.data.gruppo) apriGruppoDaNotifica(e.data.gruppo, e.data.scheda, e.data.con);
  });
}

// ---------- Tasto "indietro" del telefono ----------
// Nella cronologia c'è sempre una "pagina" in più: quando si preme indietro il telefono la
// toglie e noi, invece di uscire dall'app, torniamo alla schermata precedente e la rimettiamo.
// Dalla schermata principale, per uscire bisogna premere indietro due volte.

let ultimoIndietroAllaRadice = 0;

// Fa un passo indietro dentro l'app; restituisce false se si è già all'inizio
function passoIndietro() {
  // una finestrella aperta: la chiudo (come "Annulla")
  const finestra = document.querySelector('dialog[open]');
  if (finestra) {
    const annulla = new Event('cancel', { cancelable: true });
    finestra.dispatchEvent(annulla);
    if (!annulla.defaultPrevented && finestra.open) finestra.close();
    return true;
  }
  // pagina iniziale: dal modulo di accesso si torna al pulsante "Canta con noi"
  if (!paginaIniziale.classList.contains('chiusa')) {
    if (moduloAperto) {
      moduloAperto = false;
      aggiornaIniziale();
      return true;
    }
    return false;
  }
  // mentre si corregge lo spartito: si finisce di correggere
  if (modoCorrezione) {
    $('btn-fine-correzioni').click();
    return true;
  }
  // in una conversazione privata: si torna all'elenco delle persone
  if (conversazioneCon && !schermate.chat.hidden && !$('pannello-messaggi').hidden) {
    $('btn-chiudi-conversazione').click();
    return true;
  }
  // dentro l'app: come la freccia ‹ in alto
  if (!btnIndietro.hidden) {
    btnIndietro.click();
    return true;
  }
  // da Gruppi, Cestino o Account si torna ai Canti
  if (schermate.elenco.hidden) {
    cartellaCorrente = null;
    evidenziaSezione('canti');
    mostraElenco();
    return true;
  }
  return false;
}

history.replaceState({ cantaConNoi: 'base' }, '');
history.pushState({ cantaConNoi: 'app' }, '');
window.addEventListener('popstate', () => {
  if (passoIndietro()) {
    history.pushState({ cantaConNoi: 'app' }, '');
    return;
  }
  if (Date.now() - ultimoIndietroAllaRadice < 2500) {
    history.back(); // seconda volta: si esce
    return;
  }
  ultimoIndietroAllaRadice = Date.now();
  avviso('Premi ancora indietro per uscire.');
  history.pushState({ cantaConNoi: 'app' }, '');
});

// ---------- Riprendere da dove si era ----------
// Ogni volta che cambia schermata, ricordo dove si è. Se l'app viene chiusa dal telefono
// (ad esempio dopo averla messa in sottofondo) e riaperta entro qualche ora, si riparte da lì,
// senza ripassare dalla pagina iniziale.

const ORE_PER_RIPRENDERE = 8;

function ricordaPosizione(schermata) {
  try {
    localStorage.setItem('posizione', JSON.stringify({
      quando: Date.now(),
      schermata,
      cartella: cartellaCorrente,
      canto: cantoCorrente,
      gruppo: gruppoCorrente ? gruppoCorrente.id : null,
      dentro: paginaIniziale.classList.contains('chiusa'),
    }));
  } catch (e) { /* va bene lo stesso */ }
}

function posizioneSalvata() {
  try {
    const p = JSON.parse(localStorage.getItem('posizione'));
    if (p && p.dentro && Date.now() - p.quando < ORE_PER_RIPRENDERE * 3600 * 1000) return p;
  } catch (e) { /* niente */ }
  return null;
}

// Riapre la schermata in cui si era; restituisce false se non c'è niente da riprendere
async function riprendiPosizione() {
  const p = posizioneSalvata();
  if (!p) return false;
  paginaIniziale.classList.add('senza-animazione', 'chiusa');
  cartellaCorrente = p.cartella ?? null;

  if (p.schermata === 'canto' && p.canto && (await Db.canto(p.canto))) {
    await mostraCanto(p.canto);
    return true;
  }
  if (p.schermata === 'cestino') return mostraCestino().then(() => true);
  if (p.schermata === 'account') { mostraAccount(); return true; }
  if (p.schermata === 'gruppi' || p.schermata === 'chat' || p.schermata === 'scaletta') {
    if (p.gruppo && p.schermata !== 'gruppi' && Gruppi.disponibili() && navigator.onLine) {
      try {
        const g = (await Gruppi.miei()).find((x) => x.id === p.gruppo);
        if (g) {
          await apriChat(g);
          return true;
        }
      } catch (e) { /* torno alla pagina Gruppi */ }
    }
    if (p.schermata === 'scaletta' && cartellaCorrente) {
      await mostraElenco();
      return true;
    }
    await mostraGruppi();
    return true;
  }
  await mostraElenco();
  return true;
}

// ---------- Funzionamento offline e installazione ----------

// Registra il service worker (sw.js), che salva l'app nel dispositivo
if ('serviceWorker' in navigator) {
  const avevaGiaUnaVersione = !!navigator.serviceWorker.controller;
  navigator.serviceWorker.register('sw.js').catch((err) => console.warn('Offline non disponibile:', err));
  // Quando arriva una versione nuova dell'app la apro subito (ma non la prima volta),
  // a meno che si stia scrivendo un canto o rispondendo a una domanda: in quel caso aspetto.
  let ricaricando = false;
  navigator.serviceWorker.addEventListener('controllerchange', () => {
    if (!avevaGiaUnaVersione || ricaricando) return;
    const staScrivendo = !schermate.modulo.hidden || document.querySelector('dialog[open]') ||
      (!paginaIniziale.classList.contains('chiusa') && !$('blocco-accesso').hidden);
    if (staScrivendo) {
      avviso("È arrivata una versione nuova dell'app: la vedrai la prossima volta che la apri.");
      return;
    }
    ricaricando = true;
    location.reload();
  });
  // Quando si torna nell'app (es. era rimasta aperta in sottofondo), controllo se ci sono novità
  document.addEventListener('visibilitychange', async () => {
    if (document.visibilityState !== 'visible') return;
    const registrazione = await navigator.serviceWorker.getRegistration();
    if (registrazione) registrazione.update().catch(() => {});
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
Db.svuotaCestino().finally(async () => {
  // accesso ricordato e sincronizzazione con l'account online
  await Sync.avvia().catch((err) => console.warn(err));
  aggiornaIniziale();
  // aperta toccando una notifica: si va dritti al gruppo
  const daNotifica = new URLSearchParams(location.search);
  if (daNotifica.get('gruppo')) {
    history.replaceState(history.state, '', location.pathname);
    await apriGruppoDaNotifica(daNotifica.get('gruppo'), daNotifica.get('scheda'), daNotifica.get('con'));
    return;
  }
  // se l'app era aperta da poco si riparte da dove si era, altrimenti dall'elenco dei canti
  const ripresa = await riprendiPosizione().catch((err) => {
    console.warn(err);
    return false;
  });
  if (!ripresa) mostraElenco();
});
setInterval(() => Db.svuotaCestino(), 60 * 60 * 1000);
