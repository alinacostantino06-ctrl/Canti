// Lettura del testo da un file PDF, usando pdf.js (in lib/, funziona offline).
//
// Un PDF non contiene "righe di testo" ma tanti pezzetti di testo, ognuno con
// la sua posizione (x, y) sulla pagina. Qui li rimettiamo insieme:
//   1. raggruppiamo i pezzetti che stanno alla stessa altezza → una riga
//   2. dentro ogni riga li ordiniamo da sinistra a destra
//   3. trasformiamo la posizione x in un numero di spazi, così gli accordi
//      restano (più o meno) sopra la sillaba giusta

pdfjsLib.GlobalWorkerOptions.workerSrc = 'lib/pdf.worker.min.js';

// Restituisce tutto il testo del PDF come stringa (pagine separate da una riga vuota)
async function leggiTestoPdf(file) {
  const dati = await file.arrayBuffer();
  const pdf = await pdfjsLib.getDocument({ data: dati }).promise;

  const pagine = [];
  for (let n = 1; n <= pdf.numPages; n++) {
    const pagina = await pdf.getPage(n);
    const contenuto = await pagina.getTextContent();
    pagine.push(ricostruisciRighe(contenuto.items));
  }
  return pagine.join('\n\n').replace(/\n{3,}/g, '\n\n').trim();
}

const mediana = (numeri) => {
  if (numeri.length === 0) return 0;
  const ordinati = [...numeri].sort((a, b) => a - b);
  return ordinati[Math.floor(ordinati.length / 2)];
};

function ricostruisciRighe(items) {
  // Teniamo solo i pezzetti con del testo, e ne ricaviamo posizione e misure
  const pezzi = items
    .filter((it) => it.str && it.str.trim() !== '')
    .map((it) => ({
      testo: it.str,
      x: it.transform[4],
      y: it.transform[5],
      larghezza: it.width,
      altezza: Math.abs(it.transform[3]) || it.height || 10,
    }));
  if (pezzi.length === 0) return '';

  // Larghezza tipica di un carattere: serve a convertire la x in spazi
  const larghezzaCarattere =
    mediana(pezzi.map((p) => p.larghezza / p.testo.length).filter((l) => l > 0)) || 5;
  const margineSinistro = Math.min(...pezzi.map((p) => p.x));

  // 1. Raggruppa per altezza (in un PDF la y cresce verso l'alto)
  pezzi.sort((a, b) => b.y - a.y || a.x - b.x);
  const righe = [];
  for (const p of pezzi) {
    const ultima = righe[righe.length - 1];
    if (ultima && Math.abs(ultima.y - p.y) < p.altezza * 0.5) {
      ultima.pezzi.push(p);
    } else {
      righe.push({ y: p.y, pezzi: [p] });
    }
  }

  // Distanza normale tra due righe: se è molto più grande, c'era una riga vuota (fine strofa)
  const salti = righe.slice(1).map((r, i) => righe[i].y - r.y);
  const saltoNormale = mediana(salti);

  // 2-3. Costruisce il testo di ogni riga
  const risultato = [];
  righe.forEach((riga, i) => {
    if (i > 0 && saltoNormale > 0 && righe[i - 1].y - riga.y > saltoNormale * 1.6) {
      risultato.push('');
    }

    riga.pezzi.sort((a, b) => a.x - b.x);
    let testo = '';
    let fineUltimo = null;
    for (const p of riga.pezzi) {
      const colonna = Math.round((p.x - margineSinistro) / larghezzaCarattere);
      if (testo.length < colonna) {
        testo = testo.padEnd(colonna, ' ');
      } else if (
        fineUltimo !== null &&
        p.x - fineUltimo > larghezzaCarattere * 0.3 &&
        !testo.endsWith(' ') &&
        !p.testo.startsWith(' ')
      ) {
        testo += ' '; // due parole vicine ma separate
      }
      testo += p.testo;
      fineUltimo = p.x + p.larghezza;
    }
    risultato.push(testo.trimEnd());
  });

  return risultato.join('\n');
}
