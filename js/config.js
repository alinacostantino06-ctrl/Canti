// Collegamento all'account online (Supabase).
//
// Dove trovare questi due dati: nel sito di Supabase apri il tuo progetto,
// poi Project Settings → API (oppure il pulsante "Connect" in alto):
//   url    → "Project URL", es. "https://abcdefghij.supabase.co"
//   chiave → la chiave pubblica: "Publishable key" (inizia con "sb_publishable_…")
//            oppure, nei progetti più vecchi, la chiave "anon public" (inizia con "eyJ…")
//
// La chiave pubblica è fatta apposta per stare dentro l'app: i canti sono
// protetti dalle regole di sicurezza (vedi supabase/configurazione.sql), che
// permettono a ognuno di vedere e modificare solo i propri.
// NON mettere mai qui la chiave "secret" / "service_role": quella è segreta.
//
// Se i due campi restano vuoti, l'app funziona lo stesso ma solo su questo
// dispositivo, senza accesso.

const CONFIG_CLOUD = {
  url: 'https://mbbdvitpphlpdmxlsznz.supabase.co',
  chiave: 'sb_publishable_MXIczEe4oOgHfvoyjLTDnw_H5hYr2Z8',
  // Chiave PUBBLICA per le notifiche (quella segreta sta solo nei Secrets di Supabase)
  vapidPubblica: 'BLTexGv4wa5yHTfJUYQzgAwb56fNKA_m2s0Sd3JelZ3Z80I30GRfmKqvCZAdMJ0A4EePyt8sok_tLXPPOReyzl8',
};
