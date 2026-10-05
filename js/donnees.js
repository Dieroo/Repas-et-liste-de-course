// Données partagées : abonnements Firestore → état de l'app ; écritures sur action de l'utilisateur.
import {
  collection,
  doc,
  onSnapshot,
  runTransaction,
  writeBatch,
  serverTimestamp,
  deleteField,
} from 'https://www.gstatic.com/firebasejs/12.19.0/firebase-firestore.js';
import { db } from './firebase.js';
import { gestionnaireADesigner } from './coeur/roles.js';
import { demandeDeRecette } from './coeur/plats.js';

let arreterSuiviReglages = null;
const arretsCollections = [];

/**
 * Suit `reglages/foyer` en temps réel. Le rappel reçoit un des statuts :
 * - 'ok'          : document lu → { reglages, depuisCache } (depuisCache : copie du téléphone, pas encore confirmée) ;
 * - 'injoignable' : rien dans le cache et pas de réponse du serveur (pas de réseau, ou base injoignable) ;
 * - 'absent'      : le serveur confirme que le document n'existe pas → première ouverture ;
 * - 'refuse'      : adresse non autorisée par les règles Firestore ;
 * - 'erreur'      : autre problème → { code }.
 */
export function suivreReglages(rappel) {
  arreterReglages();
  arreterSuiviReglages = onSnapshot(
    doc(db, 'reglages', 'foyer'),
    { includeMetadataChanges: true },
    (instantane) => {
      const depuisCache = instantane.metadata.fromCache;
      if (instantane.exists()) rappel({ statut: 'ok', reglages: instantane.data(), depuisCache });
      else rappel({ statut: depuisCache ? 'injoignable' : 'absent' });
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
 * Ne touche à rien si quelqu'un l'est devenu entre-temps (renvoie false). Demande du réseau.
 */
export function devenirGestionnaire(email) {
  const reference = doc(db, 'reglages', 'foyer');
  return runTransaction(db, async (transaction) => {
    const actuel = await transaction.get(reference);
    if (actuel.exists() && !gestionnaireADesigner(actuel.data())) return false;
    const donnees = actuel.exists() ? { gestionnaire: email } : { versionSchema: 1, gestionnaire: email };
    transaction.set(reference, donnees, { merge: true });
    return true;
  });
}

// ——— Collections partagées (profils, plats) ———

/**
 * Suit les profils et les plats en temps réel (un abonnement par collection).
 * rappel({ profils }) ou rappel({ plats }) à chaque changement, documents sous la forme { id, ...champs }.
 */
export function suivreCollections(rappel) {
  arreterCollections();
  for (const nom of ['profils', 'plats']) {
    arretsCollections.push(onSnapshot(
      collection(db, nom),
      (instantane) => rappel({ [nom]: instantane.docs.map((d) => ({ ...d.data(), id: d.id })) }),
      // Accès refusé ou autre erreur : l'écran d'état vient de reglages/foyer, rien à faire ici.
      () => {},
    ));
  }
}

export function arreterCollections() {
  while (arretsCollections.length) arretsCollections.pop()();
}

/** Suit la photo d'un plat (lue seulement quand sa fiche est ouverte). → fonction d'arrêt. */
export function suivrePhoto(platId, rappel) {
  return onSnapshot(
    doc(db, 'photos', platId),
    (instantane) => rappel(instantane.exists() ? instantane.data() : null),
    () => rappel(null),
  );
}

// ——— Écritures ———
// Les écritures s'appliquent tout de suite sur le téléphone (même hors ligne) et partent au serveur dès que
// possible : la promesse renvoyée ne se résout qu'à l'envoi. Ne pas l'attendre pour mettre l'écran à jour.

function trace(auteur) {
  return { majPar: auteur, majLe: serverTimestamp() };
}

/** Ajoute un plat ⏳ ; si l'auteur n'est pas le gestionnaire, crée aussi la demande de recette. */
export function ajouterPlat(plat, auteur, { demanderRecette }) {
  const lot = writeBatch(db);
  lot.set(doc(db, 'plats', plat.id), { ...plat, ...trace(auteur) });
  if (demanderRecette) {
    const demande = demandeDeRecette(plat.id, auteur);
    lot.set(doc(db, 'demandes', demande.id), { ...demande.donnees, creeLe: serverTimestamp() });
  }
  return lot.commit();
}

/** Enregistre la photo (document à part) et la vignette (dans la fiche). */
export function enregistrerPhoto(platId, { image, vignette }, auteur) {
  const lot = writeBatch(db);
  lot.set(doc(db, 'photos', platId), { image, ...trace(auteur) });
  lot.update(doc(db, 'plats', platId), { vignette, ...trace(auteur) });
  return lot.commit();
}

export function retirerPhoto(platId, auteur) {
  const lot = writeBatch(db);
  lot.delete(doc(db, 'photos', platId));
  lot.update(doc(db, 'plats', platId), { vignette: deleteField(), ...trace(auteur) });
  return lot.commit();
}

export function enregistrerProfil(profil) {
  const lot = writeBatch(db);
  lot.set(doc(db, 'profils', profil.id), profil, { merge: true });
  return lot.commit();
}

export function retirerProfil(profilId) {
  const lot = writeBatch(db);
  lot.delete(doc(db, 'profils', profilId));
  return lot.commit();
}
