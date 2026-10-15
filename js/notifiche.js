// Notifiche sul dispositivo (anche ad app chiusa).
//
//   - ogni persona le attiva dal suo dispositivo (🔔): il telefono chiede il permesso;
//   - il dispositivo lascia in Supabase il suo "indirizzo" per le notifiche
//     (tabella iscrizioni_notifiche, vedi supabase/notifiche.sql);
//   - quando in un gruppo succede qualcosa, l'app chiede alla Edge Function "notifica"
//     di avvisare gli altri membri (supabase/functions/notifica/index.ts);
//   - le notifiche le mostra il service worker (sw.js), anche ad app chiusa.

// La chiave pubblica è scritta in "base64url": il browser la vuole come byte
function chiaveInByte(testo) {
  const base64 = (testo + '='.repeat((4 - (testo.length % 4)) % 4)).replace(/-/g, '+').replace(/_/g, '/');
  return Uint8Array.from(atob(base64), (c) => c.charCodeAt(0));
}

const suIphoneOIpad = () => /iphone|ipad|ipod/i.test(navigator.userAgent) ||
  (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
const appInstallata = () =>
  window.matchMedia('(display-mode: standalone)').matches || navigator.standalone === true;

const Notifiche = {
  // Le notifiche si possono usare su questo dispositivo?
  supportate() {
    return 'serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window &&
      typeof CONFIG_CLOUD !== 'undefined' && !!CONFIG_CLOUD.vapidPubblica;
  },

  // Perché non si possono usare (per spiegarlo con parole semplici)
  perchéNo() {
    if (suIphoneOIpad() && !appInstallata()) {
      return 'Su iPhone e iPad le notifiche funzionano solo con l\'app aggiunta alla schermata Home: ' +
        'aggiungila (Condividi → «Aggiungi alla schermata Home») e aprila da lì.';
    }
    return 'Questo browser non permette le notifiche. Prova con Chrome (Android/PC) o con l\'app installata.';
  },

  async _iscrizione() {
    const reg = await navigator.serviceWorker.ready;
    return reg.pushManager.getSubscription();
  },

  // "attive" | "spente" | "bloccate" (permesso negato nelle impostazioni) | "non supportate"
  async stato() {
    if (!this.supportate()) return 'non supportate';
    if (Notification.permission === 'denied') return 'bloccate';
    if (Notification.permission !== 'granted') return 'spente';
    return (await this._iscrizione()) ? 'attive' : 'spente';
  },

  async attiva() {
    if (!this.supportate()) throw new Error(this.perchéNo());
    if (!Sync.utente) throw new Error("Per ricevere le notifiche serve l'accesso.");
    const permesso = await Notification.requestPermission();
    if (permesso !== 'granted') {
      throw new Error('Le notifiche non sono state permesse. Puoi permetterle dalle impostazioni del telefono ' +
        '(Impostazioni → App → Canta con noi → Notifiche) o del browser.');
    }
    const reg = await navigator.serviceWorker.ready;
    let iscrizione = await reg.pushManager.getSubscription();
    if (!iscrizione) {
      iscrizione = await reg.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: chiaveInByte(CONFIG_CLOUD.vapidPubblica),
      });
    }
    const dati = iscrizione.toJSON();
    const { error } = await Sync.client.from('iscrizioni_notifiche').upsert({
      endpoint: dati.endpoint, user_id: Sync.utente.id, p256dh: dati.keys.p256dh, auth: dati.keys.auth,
    });
    if (error) {
      throw new Error(/does not exist|schema cache/i.test(error.message)
        ? 'Le notifiche non sono ancora attive: in Supabase va eseguito il file supabase/notifiche.sql.'
        : spiegaErrore(error));
    }
  },

  // Spegne le notifiche su questo dispositivo (anche quando si esce dall'account)
  async disattiva() {
    if (!this.supportate()) return;
    const iscrizione = await this._iscrizione().catch(() => null);
    if (!iscrizione) return;
    if (Sync.client && Sync.utente) {
      await Sync.client.from('iscrizioni_notifiche').delete().eq('endpoint', iscrizione.endpoint);
    }
    await iscrizione.unsubscribe();
  },

  // Chiede di avvisare gli altri membri del gruppo. Non blocca mai l'app: se non riesce, pazienza.
  //   tipo: "avviso" | "canto" | "scaletta" | "libretto"
  // a: per i messaggi privati, la persona a cui arriva la notifica
  invia(gruppoId, tipo, testo, a) {
    if (!Sync.client || !Sync.utente || !navigator.onLine) return;
    Sync.client.functions.invoke('notifica', { body: { gruppo_id: gruppoId, tipo, testo, a } })
      .catch((err) => console.warn('Notifica non inviata:', err));
  },
};
