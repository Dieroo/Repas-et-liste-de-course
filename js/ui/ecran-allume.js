// Écran allumé (T5-1, plan §8.5) : `navigator.wakeLock`, demandé à l'ouverture d'un écran où l'on cuisine, rendu après
// `minutes` sans toucher, en quittant l'écran (liberer) ou quand l'app est cachée ; redemandé au retour sur l'app et au
// toucher. Toute erreur est ignorée (navigateur sans wakeLock, refus, batterie faible) : l'écran s'éteint alors comme
// d'habitude, sans message. Courses garde son propre code (T3b), intouché.

const MINUTE_MS = 60_000;

/**
 * Garde l'écran allumé tant que la personne s'en sert.
 * `minutes` : durée sans toucher au-delà de laquelle l'écran est rendu (30 par défaut) ;
 * `tantQue()` : vrai tant que l'écran doit rester allumé (faux : rendu ; minuteur en cours en T5-1b, par exemple, pour
 *   ne pas le rendre) ; `surChange(obtenu)` : appelé quand l'écran devient allumé (vrai) ou ne l'est plus (faux).
 * → { toucher(), liberer(), obtenu() } ; `liberer()` est définitif (écran quitté).
 */
export function garderAllume({ minutes = 30, tantQue = () => true, surChange = () => {} } = {}) {
  let verrou = null;
  let demandeEnCours = false;
  let dernierToucher = Date.now();
  let minuteur = null;
  let libere = false;
  let etat = false;

  const signaler = () => {
    const obtenu = Boolean(verrou);
    if (obtenu === etat) return;
    etat = obtenu;
    try {
      surChange(obtenu);
    } catch {
      // L'affichage de l'écran ne doit jamais casser le verrou.
    }
  };

  const voulu = () => !libere && document.visibilityState === 'visible'
    && Date.now() - dernierToucher < minutes * MINUTE_MS && Boolean(tantQue());

  function rendre() {
    clearTimeout(minuteur);
    minuteur = null;
    const sentinelle = verrou;
    verrou = null;
    if (sentinelle) {
      try {
        Promise.resolve(sentinelle.release?.()).catch(() => {});
      } catch {
        // Déjà rendu.
      }
    }
    signaler();
  }

  function programmer() {
    clearTimeout(minuteur);
    const reste = minutes * MINUTE_MS - (Date.now() - dernierToucher);
    minuteur = setTimeout(verifier, Math.max(1000, reste));
  }

  function verifier() {
    minuteur = null;
    if (libere) return;
    if (voulu()) programmer();
    else rendre();
  }

  function demander() {
    if (!voulu()) {
      rendre();
      return;
    }
    programmer();
    if (verrou || demandeEnCours || typeof navigator.wakeLock?.request !== 'function') return;
    demandeEnCours = true;
    let demande;
    try {
      demande = navigator.wakeLock.request('screen');
    } catch {
      demandeEnCours = false;
      return;
    }
    Promise.resolve(demande).then((sentinelle) => {
      demandeEnCours = false;
      if (!sentinelle) return;
      if (!voulu() || verrou) {
        // Plus voulu entre-temps (écran quitté, app cachée) : rendu aussitôt.
        try {
          Promise.resolve(sentinelle.release?.()).catch(() => {});
        } catch {
          // Déjà rendu.
        }
        return;
      }
      verrou = sentinelle;
      sentinelle.addEventListener?.('release', () => {
        if (verrou !== sentinelle) return;
        verrou = null;
        signaler();
      });
      signaler();
    }, () => {
      demandeEnCours = false;
    });
  }

  const surActivite = () => {
    if (libere) return;
    dernierToucher = Date.now();
    demander();
  };
  const surVisibilite = () => {
    if (libere) return;
    if (document.visibilityState !== 'visible') {
      rendre();
      return;
    }
    dernierToucher = Date.now();
    demander();
  };
  document.addEventListener('pointerdown', surActivite, { capture: true });
  document.addEventListener('keydown', surActivite, { capture: true });
  document.addEventListener('visibilitychange', surVisibilite);
  demander();

  return {
    /** Un geste de la personne (sans événement : bouton activé par le lecteur d'écran, par exemple). */
    toucher: surActivite,
    /** Écran quitté : l'écran est rendu, plus rien n'est demandé. */
    liberer() {
      if (libere) return;
      rendre();
      libere = true;
      document.removeEventListener('pointerdown', surActivite, { capture: true });
      document.removeEventListener('keydown', surActivite, { capture: true });
      document.removeEventListener('visibilitychange', surVisibilite);
    },
    obtenu: () => Boolean(verrou),
  };
}
