// Données partagées : abonnements Firestore → état de l'app ; écritures sur action de l'utilisateur.
import {
  collection,
  doc,
  getDocsFromServer,
  onSnapshot,
  runTransaction,
  writeBatch,
  serverTimestamp,
  deleteField,
} from 'https://www.gstatic.com/firebasejs/12.19.0/firebase-firestore.js';
import { db } from './firebase.js';
import { gestionnaireADesigner, normaliserEmail } from './coeur/roles.js';
import { demandeDeRecette } from './coeur/plats.js';
import { appliquerConditions } from './coeur/sauvegarde.js';
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
 * rappel({ profils, profilsDepuisCache }), rappel({ plats, platsDepuisCache }) ou rappel({ demandes }) à chaque
 * changement, documents sous la forme { id, ...champs } ; `…DepuisCache` : copie du téléphone, pas encore confirmée
 * par le serveur.
 * surErreur(code) si une écoute s'arrête pour une autre raison qu'un accès refusé (géré par reglages/foyer).
 */
export function suivreCollections(rappel, surErreur) {
  arreterCollections();
  for (const nom of ['profils', 'plats', 'demandes']) {
    // Profils et plats : on sait aussi si la copie vient du serveur ou seulement du téléphone (sauvegarde).
    const suivreCache = nom !== 'demandes';
    let dernierCache = null;
    arretsCollections.push(onSnapshot(
      collection(db, nom),
      { includeMetadataChanges: suivreCache },
      (instantane) => {
        const depuisCache = Boolean(instantane.metadata?.fromCache);
        // Changement des seules métadonnées (écriture confirmée…) : rien à redessiner, sauf l'origine de la copie.
        const changements = typeof instantane.docChanges === 'function' ? instantane.docChanges().length : 1;
        if (suivreCache && dernierCache !== null && !changements && depuisCache === dernierCache) return;
        dernierCache = depuisCache;
        rappel({
          [nom]: instantane.docs.map((d) => ({ ...d.data(), id: d.id })),
          ...(suivreCache ? { [`${nom}DepuisCache`]: depuisCache } : {}),
        });
      },
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
    // Recettes toutes identiques : seules les demandes restées ouvertes sont closes.
    envoi = ecritures.length ? lot.commit() : Promise.resolve();
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

/**
 * Règles d'un profil (liste entière, préparée par coeur/regles.js › ecrireRegime) : `update` du seul champ `regles`.
 * Un profil supprimé entre-temps n'est jamais recréé à moitié (refus `not-found`). Hors ligne : part plus tard.
 * → promesse de l'envoi.
 */
export function enregistrerRegles(profilId, regles) {
  if (!Array.isArray(regles)) throw new Error('Règles refusées : une liste est attendue.');
  const lot = writeBatch(db);
  lot.update(doc(db, 'profils', profilId), { regles });
  return lot.commit();
}

export function retirerProfil(profilId) {
  const lot = writeBatch(db);
  lot.delete(doc(db, 'profils', profilId));
  return lot.commit();
}

// ——— Sauvegarde et restauration (T1d-2) ———

// Au-delà, le serveur est jugé injoignable : la restauration ne part que de données à jour.
const DELAI_SERVEUR_MS = 15000;

/**
 * Lit les profils, les plats et les demandes sur le serveur, jamais dans la copie du téléphone : la restauration
 * part des données à jour de l'autre téléphone. → promesse de { plats, profils, demandes } (documents sous la forme
 * { id, ...champs }) ; rejetée hors ligne, ou si le serveur ne répond pas à temps.
 */
export function lireDepuisServeur() {
  const noms = ['plats', 'profils', 'demandes'];
  let minuteur = null;
  const delai = new Promise((_, rejeter) => {
    minuteur = setTimeout(() => rejeter(new Error('Serveur injoignable.')), DELAI_SERVEUR_MS);
  });
  const lecture = Promise.all(noms.map((nom) => getDocsFromServer(collection(db, nom))))
    .then((instantanes) => Object.fromEntries(noms.map((nom, i) => [
      nom,
      instantanes[i].docs.map((d) => ({ ...d.data(), id: d.id })),
    ])));
  return Promise.race([lecture, delai]).finally(() => clearTimeout(minuteur));
}

/** Données préparées par le cœur → données Firestore : le marqueur { horodatageServeur: true } devient serverTimestamp(). */
function versFirestore(valeur) {
  if (Array.isArray(valeur)) return valeur.map(versFirestore);
  if (valeur === null || typeof valeur !== 'object' || Object.getPrototypeOf(valeur) !== Object.prototype) return valeur;
  if (valeur.horodatageServeur === true && Object.keys(valeur).length === 1) return serverTimestamp();
  return Object.fromEntries(Object.entries(valeur).map(([cle, sous]) => [cle, versFirestore(sous)]));
}

const COLLECTIONS_RESTAUREES = new Set(['plats', 'profils']);
// Écritures par transaction : sous les 500 d'une transaction Firestore, demandes closes comprises.
const ECRITURES_PAR_TRANSACTION = 200;

/**
 * Restaure une sauvegarde (préparée par coeur/sauvegarde.js › preparerRestauration), par transactions de
 * ECRITURES_PAR_TRANSACTION écritures au plus. Une transaction relit chaque document visé et ne garde que ce qui
 * reste vrai à cet instant (coeur/sauvegarde.js › appliquerConditions) : une note, une recette ou un plat posés
 * entre-temps sur l'autre téléphone ne sont jamais écrasés. Hors ligne, une transaction échoue au lieu d'être mise
 * en file : rien ne part plus tard à l'insu de la personne.
 * - `fusion` : `set` + `merge` (données imbriquées) ;
 * - `update` : chemins (`notes.<profil>`, champs de recette), `effacer` → deleteField().
 * Les demandes satisfaites par une écriture faite (`clore`) sont closes dans la même transaction.
 * `auteur` : la personne connectée (`majPar` est déjà posé par le cœur).
 * → promesse de la fin de toutes les transactions (rejetée à la première qui échoue ; les précédentes restent faites,
 *   et une relance ne refait pas ce qui ne manque plus).
 */
export async function restaurer({ lots }, auteur) {
  const ecritures = (lots ?? []).flat();
  for (const { collection: nom, mode } of ecritures) {
    if (!COLLECTIONS_RESTAUREES.has(nom)) throw new Error(`Collection refusée pour une restauration : ${nom}.`);
    if (mode !== 'fusion' && mode !== 'update') throw new Error(`Mode d’écriture inconnu : ${mode}.`);
  }
  for (let debut = 0; debut < ecritures.length; debut += ECRITURES_PAR_TRANSACTION) {
    const tranche = ecritures.slice(debut, debut + ECRITURES_PAR_TRANSACTION);
    await runTransaction(db, async (transaction) => {
      // Toutes les lectures d'abord, comme l'exige une transaction.
      const actuels = [];
      for (const ecriture of tranche) {
        const instantane = await transaction.get(doc(db, ecriture.collection, ecriture.id));
        actuels.push(instantane.exists() ? instantane.data() : null);
      }
      const aFaire = tranche.map((ecriture, i) => appliquerConditions(ecriture, actuels[i])).filter(Boolean);
      const idsDemandes = [...new Set(aFaire.flatMap((ecriture) => ecriture.clore ?? []))];
      const demandes = [];
      for (const id of idsDemandes) {
        const instantane = await transaction.get(doc(db, 'demandes', id));
        if (instantane.exists() && instantane.data().statut === 'ouverte') demandes.push(id);
      }
      for (const { collection: nom, id, mode, donnees, effacer = [] } of aFaire) {
        const reference = doc(db, nom, id);
        const document = versFirestore(donnees ?? {});
        if (mode === 'fusion') {
          transaction.set(reference, document, { merge: true });
        } else {
          for (const champ of effacer) document[champ] = deleteField();
          transaction.update(reference, document);
        }
      }
      for (const id of demandes) {
        transaction.update(doc(db, 'demandes', id), { statut: 'traitee', traiteeLe: serverTimestamp() });
      }
    });
  }
}

/**
 * Date de la dernière sauvegarde (date du téléphone, lisible tout de suite, contrairement à un serverTimestamp() en
 * attente). À n'appeler qu'en ligne. → promesse de l'envoi.
 */
export function marquerSauvegarde(date) {
  const lot = writeBatch(db);
  lot.update(doc(db, 'reglages', 'foyer'), { derniereSauvegarde: date });
  return lot.commit();
}
