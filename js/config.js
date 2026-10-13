// Collegamento all'account online (Supabase).
//
// Dove trovare questi due dati: nel sito di Supabase apri il tuo progetto,
// poi Project Settings → API (oppure il pulsante "Connect" in alto):
//   url    → "Project URL", es. "https://abcdefghij.supabase.co"
//   chiave → la chiave "anon" "public" (un testo lungo che inizia con "eyJ…")
//
// La chiave "anon public" è fatta apposta per stare dentro l'app: i canti sono
// protetti dalle regole di sicurezza (vedi supabase/configurazione.sql), che
// permettono a ognuno di vedere e modificare solo i propri.
// NON mettere mai qui la chiave "service_role": quella è segreta.
//
// Se i due campi restano vuoti, l'app funziona lo stesso ma solo su questo
// dispositivo, senza accesso.

const CONFIG_CLOUD = {
  url: '',
  chiave: '',
};
