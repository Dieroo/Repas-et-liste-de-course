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
import { gestionnaireADesigner, normaliserEmail } from './coeur/roles.js';
import { demandeDeRecette } from './coeur/plats.js';
import { cheminNote, noteValide } from './coeur/notes.js';

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

// ——— Collections partagées (profils, plats, demandes) ———

/**
 * Suit les profils, les plats et les demandes en temps réel (un abonnement par collection).
 * rappel({ profils }), rappel({ plats }) ou rappel({ demandes }) à chaque changement, documents sous la forme
 * { id, ...champs }.
 * surErreur(code) si une écoute s'arrête pour une autre raison qu'un accès refusé (géré par reglages/foyer).
 */
export function suivreCollections(rappel, surErreur) {
  arreterCollections();
  for (const nom of ['profils', 'plats', 'demandes']) {
    arretsCollections.push(onSnapshot(
      collection(db, nom),
      (instantane) => rappel({ [nom]: instantane.docs.map((d) => ({ ...d.data(), id: d.id })) }),
      (erreur) => {
        if (erreur?.code !== 'permission-denied') surErreur(erreur?.code ?? '');
      },
    ));
  }
}

export function arreterCollections() {
  while (arretsCollections.length) arretsCollections.pop()();
}

/** Suit la photo d'un plat (lue seulement quand sa fiche est ouverte). → fonction d'arrêt. */
export function suivrePhoto(platId, rappel) {
  try {
    return onSnapshot(
      doc(db, 'photos', platId),
      (instantane) => rappel(instantane.exists() ? instantane.data() : null),
      () => rappel(null),
    );
  } catch {
    rappel(null);
    return () => {};
  }
}

// ——— Écritures ———
// Les écritures s'appliquent tout de suite sur le téléphone (même hors ligne) et partent au serveur dès que
// possible : la promesse renvoyée ne se résout qu'à l'envoi. Ne pas l'attendre pour mettre l'écran à jour.

function trace(auteur) {
  return { majPar: auteur, majLe: serverTimestamp() };
}

/**
 * Ajoute un plat par son nom ({ id, nom } : statut ⏳ par défaut). Écriture fusionnée : si l'autre téléphone a
 * créé ce plat entre-temps, sa recette, ses notes et sa photo restent intactes.
 * Si l'auteur n'est pas le gestionnaire, crée aussi la demande de recette.
 */
export function ajouterPlat(plat, auteur, { demanderRecette }) {
  const lot = writeBatch(db);
  lot.set(doc(db, 'plats', plat.id), { id: plat.id, nom: plat.nom, ...trace(auteur) }, { merge: true });
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

/**
 * Clôt les demandes satisfaites, dans un lot à part, par `update` : son échec ne touche pas à la recette et ne
 * peut pas recréer une demande disparue. Échec silencieux : la demande reste ouverte, elle sera close au prochain
 * ajout ou à la prochaine modification de la recette.
 */
function cloreDemandes(demandesAClore) {
  if (!demandesAClore?.length) return;
  try {
    const lot = writeBatch(db);
    for (const id of demandesAClore) lot.update(doc(db, 'demandes', id), { statut: 'traitee', traiteeLe: serverTimestamp() });
    lot.commit().catch(() => {});
  } catch {
    // Échec silencieux, comme ci-dessus.
  }
}

/**
 * Enregistre des recettes (CLAUDE.md §8). Seuls les champs présents sont écrits (`mergeFields`) : les autres
 * (notes, photo, champs absents de la recette) restent intacts. Une recette qui remplace des modifications faites
 * à la main (`effacerModification`) efface aussi leur marque (`modifieeLe`, `modifieePar`).
 * Les demandes satisfaites sont closes dans un second lot.
 * → promesse de l'envoi des recettes (rejetée aussi si le lot n'a pas pu être construit).
 */
export function importer({ ecritures, demandesAClore }, auteur) {
  let envoi;
  try {
    const lot = writeBatch(db);
    for (const { id, donnees, effacerModification } of ecritures) {
      const document = { ...donnees, id, ...trace(auteur) };
      if (effacerModification) Object.assign(document, { modifieeLe: deleteField(), modifieePar: deleteField() });
      lot.set(doc(db, 'plats', id), document, { mergeFields: Object.keys(document) });
    }
    envoi = lot.commit();
  } catch (erreur) {
    return Promise.reject(erreur);
  }
  cloreDemandes(demandesAClore);
  return envoi;
}

/**
 * Enregistre une recette modifiée à la main (« Modifier », les deux membres). `champs` : seuls les champs touchés,
 * préparés par coeur/edition.js › preparerModification ; `supprimer` : champs à effacer (toutes les étapes
 * retirées…). `update` : échoue proprement si la fiche a été supprimée entre-temps, sans la recréer à moitié.
 * Les demandes satisfaites (recette ⏳ écrite à la main) sont closes dans un second lot.
 * → promesse de l'envoi de la recette (rejetée aussi si le lot n'a pas pu être construit).
 */
export function modifierPlat(id, { champs, supprimer = [] }, demandesAClore, auteur) {
  let envoi;
  try {
    const { conservation, ...document } = champs;
    // Conservation : un chemin par sous-champ touché (update remplacerait sinon la table entière).
    for (const [cle, valeur] of Object.entries(conservation ?? {})) document[`conservation.${cle}`] = valeur;
    for (const champ of supprimer) document[champ] = deleteField();
    const lot = writeBatch(db);
    lot.update(doc(db, 'plats', id), {
      ...document,
      modifieeLe: serverTimestamp(),
      modifieePar: auteur,
      ...trace(auteur),
    });
    envoi = lot.commit();
  } catch (erreur) {
    return Promise.reject(erreur);
  }
  cloreDemandes(demandesAClore);
  return envoi;
}

/**
 * Note d'un profil sur un plat (0 à 5), ou `null` pour l'effacer. Un seul chemin, `notes.<profilId>`, en `update` :
 * les notes des autres profils restent, la recette n'est pas marquée comme modifiée (ni `majPar` ni `majLe`), et une
 * fiche supprimée entre-temps n'est jamais recréée (refus `not-found`). 0 (« Jamais ») est une vraie note.
 * Lève une erreur avant tout envoi si l'identifiant du profil ne forme pas un chemin sûr, ou si la note est illisible.
 * → promesse de l'envoi.
 */
export function noterPlat(platId, profilId, note) {
  const chemin = cheminNote(profilId);
  if (!chemin) throw new Error('Identifiant de profil refusé pour une note.');
  if (note !== null && !noteValide(note)) throw new Error('Note refusée : un entier de 0 à 5, ou null pour l’effacer.');
  const lot = writeBatch(db);
  lot.update(doc(db, 'plats', platId), { [chemin]: note ?? deleteField() });
  return lot.commit();
}

/**
 * « C'est moi » : relie le profil `id` à l'adresse de la personne connectée (`email`, préparée par
 * coeur/profils.js › preparerReliure). Transaction, qui n'écrit que `email`, et seulement si l'adresse du profil vaut
 * encore `attendu` et qu'aucun autre profil ne porte déjà cette adresse : deux téléphones ne peuvent pas prendre le
 * même profil. Les profils connus (`idsProfils`) sont lus par référence : une transaction ne fait pas de requête, et
 * le foyer en compte moins de 5. Demande du réseau.
 * → promesse de { code: 'ok' | 'change' | 'inconnu' }, ou { code: 'adresse_prise', nom } (prénom du profil qui porte
 * déjà l'adresse).
 */
export async function relierProfil({ id, email, attendu }, idsProfils) {
  const reference = doc(db, 'profils', id);
  const autres = [...new Set(idsProfils ?? [])].filter((autre) => autre !== id).map((autre) => doc(db, 'profils', autre));
  return runTransaction(db, async (transaction) => {
    // Toutes les lectures avant toute écriture, comme l'exige une transaction.
    const [vise, ...lus] = await Promise.all([reference, ...autres].map((ref) => transaction.get(ref)));
    if (!vise.exists()) return { code: 'inconnu' };
    if (normaliserEmail(vise.data().email) !== attendu) return { code: 'change' };
    const pris = lus.find((lu) => lu.exists() && normaliserEmail(lu.data().email) === email);
    if (pris) return { code: 'adresse_prise', nom: String(pris.data().nom ?? '') };
    transaction.update(reference, { email });
    return { code: 'ok' };
  });
}

/**
 * « Ce n'est pas moi » : retire l'adresse du profil `id` (préparé par coeur/profils.js › preparerDeliure).
 * Transaction, qui n'écrit `email: ''` que si l'adresse du profil vaut encore `attendu`. Demande du réseau.
 * → promesse de { code: 'ok' | 'change' | 'inconnu' }.
 */
export async function delierProfil({ id, attendu }) {
  const reference = doc(db, 'profils', id);
  return runTransaction(db, async (transaction) => {
    const vise = await transaction.get(reference);
    if (!vise.exists()) return { code: 'inconnu' };
    if (normaliserEmail(vise.data().email) !== attendu) return { code: 'change' };
    transaction.update(reference, { email: '' });
    return { code: 'ok' };
  });
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
