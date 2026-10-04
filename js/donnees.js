// Données partagées : abonnements Firestore → état de l'app ; écritures sur action de l'utilisateur.
import {
  doc,
  onSnapshot,
  runTransaction,
} from 'https://www.gstatic.com/firebasejs/12.19.0/firebase-firestore.js';
import { db } from './firebase.js';

let arreterSuiviReglages = null;

/**
 * Suit `reglages/foyer` en temps réel. Le rappel reçoit un des statuts :
 * - 'ok'      : document lu (éventuellement depuis le cache hors ligne) → { reglages } ;
 * - 'attente' : absent du cache, réponse du serveur pas encore reçue (ou pas de réseau) ;
 * - 'absent'  : le serveur confirme que le document n'existe pas → première ouverture ;
 * - 'refuse'  : adresse non autorisée par les règles Firestore ;
 * - 'erreur'  : autre problème → { code }.
 */
export function suivreReglages(rappel) {
  arreterReglages();
  arreterSuiviReglages = onSnapshot(
    doc(db, 'reglages', 'foyer'),
    { includeMetadataChanges: true },
    (instantane) => {
      if (instantane.exists()) {
        rappel({ statut: 'ok', reglages: instantane.data() });
      } else {
        rappel({ statut: instantane.metadata.fromCache ? 'attente' : 'absent' });
      }
    },
    (erreur) => {
      arreterSuiviReglages = null;
      rappel({ statut: erreur?.code === 'permission-denied' ? 'refuse' : 'erreur', code: erreur?.code ?? '' });
    },
  );
}

export function arreterReglages() {
  if (arreterSuiviReglages) arreterSuiviReglages();
  arreterSuiviReglages = null;
}

/**
 * Première ouverture : la personne connectée devient gestionnaire.
 * Ne touche à rien si le document a été créé entre-temps (renvoie false).
 */
export function devenirGestionnaire(email) {
  const reference = doc(db, 'reglages', 'foyer');
  return runTransaction(db, async (transaction) => {
    const actuel = await transaction.get(reference);
    if (actuel.exists()) return false;
    transaction.set(reference, { versionSchema: 1, gestionnaire: email });
    return true;
  });
}
