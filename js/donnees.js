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
import { fusionnerVariantes } from './coeur/paquet.js';
import { cheminNote, noteValide } from './coeur/notes.js';
import { estDansCorbeille } from './coeur/corbeille.js';
import { empreinteRelecture, appliquerReperes } from './coeur/relecture.js';
import { VERSION_REPERES } from './coeur/vocabulaire.js';

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
 * Enregistre des recettes et des versions (CLAUDE.md §8, T2b), préparées par coeur/paquet.js › preparerImport.
 * - Fiches complètes `{ id, donnees, effacerModification? }` : un lot, comme en T1b. Seuls les champs présents sont
 *   écrits (`mergeFields`) : les autres (notes, photo, champs absents de la recette) restent intacts. Une recette qui
 *   remplace des modifications faites à la main (`effacerModification`) efface aussi leur marque (`modifieeLe`,
 *   `modifieePar`). Hors ligne : part plus tard.
 * - Versions `{ id, mode: 'versions', variantes, attendus? }` : une transaction par plat, qui relit ses versions, y
 *   fusionne celles reçues par profil et par style (coeur/paquet.js › fusionnerVariantes : une version reçue remplace
 *   celle du même profil et du même style, et celles d'un style que son profil n'attend pas, `attendus` ; les autres
 *   versions, de ce profil ou des autres, restent) et n'écrit que
 *   `variantes`, `majPar`, `majLe` (jamais le nom, le statut, la recette ni la marque « modifiée à la main »). Plat
 *   disparu entre-temps : rien n'est écrit, son identifiant est rendu dans `manquants`. Hors ligne, une transaction
 *   échoue au lieu d'être mise en file : l'app refuse ces envois avant d'appeler (actions.importer).
 * - Relectures des repères `{ id, mode: 'precautions', ajouts, retraits, marquerRelue, empreinte }` (T2d) : une
 *   transaction par plat (relireReperes). Un autre `mode` est refusé : rien n'est écrit.
 * Les demandes satisfaites sont closes dans un lot à part : celles des fiches complètes tout de suite, celles des
 * versions après leurs transactions, sauf pour un plat disparu. Une relecture n'en clôt aucune.
 * → { envoi, versions, precautions } : `envoi`, promesse de l'envoi du lot des fiches (rejetée aussi si le lot n'a
 *   pas pu être construit) ; `versions`, promesse de { manquants: [id] } (rejetée à la première transaction qui
 *   échoue ; les précédentes restent faites, et une relance ne fait que fusionner à nouveau les mêmes versions) ;
 *   `precautions`, promesse de { manquants, corbeille, changes, ecrites } (relireReperes).
 */
export function importer({ ecritures, demandesAClore }, auteur) {
  // Un mode inconnu est refusé : `{ ...undefined, id }` recréerait sinon une fiche vide (T2d).
  const inconnue = ecritures.find((ecriture) => ecriture.mode !== undefined
    && ecriture.mode !== 'versions' && ecriture.mode !== 'precautions');
  if (inconnue) {
    const refus = Promise.reject(new Error('Écriture d’import inconnue.'));
    refus.catch(() => {});
    return { envoi: refus, versions: refus, precautions: refus };
  }
  const completes = ecritures.filter((ecriture) => ecriture.mode === undefined);
  const versions = ecritures.filter((ecriture) => ecriture.mode === 'versions');
  const relectures = ecritures.filter((ecriture) => ecriture.mode === 'precautions');
  const idsVersions = new Set(versions.map(({ id }) => id));
  const deVersion = (demande) => idsVersions.has(String(demande).split('__')[0]);
  let envoi;
  try {
    const lot = writeBatch(db);
    for (const { id, donnees, effacerModification, effacerRelue } of completes) {
      const document = { ...donnees, id, ...trace(auteur) };
      if (effacerModification) Object.assign(document, { modifieeLe: deleteField(), modifieePar: deleteField() });
      // Recette remplacée ou complétée par Claude : elle n'est plus relue (T2d).
      if (effacerRelue) document.reperesRelus = deleteField();
      lot.set(doc(db, 'plats', id), document, { mergeFields: Object.keys(document) });
    }
    // Recettes toutes identiques : seules les demandes restées ouvertes sont closes.
    envoi = completes.length ? lot.commit() : Promise.resolve();
  } catch (erreur) {
    envoi = Promise.reject(erreur);
  }
  cloreDemandes((demandesAClore ?? []).filter((demande) => !deVersion(demande)));
  const envoiVersions = (async () => {
    const manquants = [];
    for (const { id, variantes, attendus } of versions) {
      const ecrite = await runTransaction(db, async (transaction) => {
        const reference = doc(db, 'plats', id);
        const actuel = await transaction.get(reference);
        if (!actuel.exists()) return false;
        const lues = actuel.data().variantes;
        transaction.update(reference, {
          variantes: fusionnerVariantes(Array.isArray(lues) ? lues : [], variantes, { attendus }),
          ...trace(auteur),
        });
        return true;
      });
      if (!ecrite) manquants.push(id);
    }
    const absents = new Set(manquants);
    cloreDemandes((demandesAClore ?? []).filter((demande) => deVersion(demande) && !absents.has(String(demande).split('__')[0])));
    return { manquants };
  })();
  return { envoi, versions: envoiVersions, precautions: relireReperes(relectures, auteur) };
}

/**
 * Relecture des repères par Claude (T2d, mode `precautions`) : une transaction par plat, qui relit la fiche et n'écrit
 * que `ingredients` (seulement si un repère change), `reperesRelus` (si `marquerRelue`), `majPar` et `majLe`. Jamais
 * le nom, les versions, les étapes, les portions, le statut, les notes, la corbeille ni la marque « modifiée à la
 * main ». Rien n'est écrit si la fiche a disparu (`manquants`), est passée à la corbeille (`corbeille`) ou a changé
 * depuis l'aperçu (`changes` : produit, repère, étape ou cuisson ; une quantité changée est gardée). Hors ligne, une
 * transaction échoue : l'app refuse l'envoi avant d'appeler.
 * → promesse de { manquants, corbeille, changes, ecrites } (identifiants), rejetée à la première transaction qui
 *   échoue (les précédentes restent faites).
 */
async function relireReperes(relectures, auteur) {
  const resultat = { manquants: [], corbeille: [], changes: [], ecrites: [] };
  for (const { id, ajouts = [], retraits = [], marquerRelue, empreinte } of relectures) {
    const issue = await runTransaction(db, async (transaction) => {
      const reference = doc(db, 'plats', id);
      const actuel = await transaction.get(reference);
      if (!actuel.exists()) return 'manquants';
      const fiche = { id, ...actuel.data() };
      if (estDansCorbeille(fiche)) return 'corbeille';
      if (empreinteRelecture(fiche) !== empreinte) return 'changes';
      const lus = Array.isArray(fiche.ingredients) ? fiche.ingredients : [];
      const ingredients = appliquerReperes(lus, { ajouts, retraits });
      const document = {};
      if (JSON.stringify(ingredients) !== JSON.stringify(lus)) document.ingredients = ingredients;
      if (marquerRelue) document.reperesRelus = VERSION_REPERES;
      if (!Object.keys(document).length) return 'ecrites';
      transaction.update(reference, { ...document, ...trace(auteur) });
      return 'ecrites';
    });
    resultat[issue].push(id);
  }
  return resultat;
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

// ——— Précautions selon l'âge (T2c-1) ———

/** Texte stable d'une valeur : clés des tables triées (l'ordre lu sur le serveur peut différer de la copie locale). */
function texteStable(valeur) {
  if (Array.isArray(valeur)) return `[${valeur.map((element) => (element === undefined ? 'null' : texteStable(element))).join(',')}]`;
  if (valeur && typeof valeur === 'object') {
    const cles = Object.keys(valeur).filter((cle) => valeur[cle] !== undefined).sort();
    return `{${cles.map((cle) => `${JSON.stringify(cle)}:${texteStable(valeur[cle])}`).join(',')}}`;
  }
  return JSON.stringify(valeur === undefined ? null : valeur);
}

/**
 * Empreinte de ce que « 🧸 Ce que <Enfant> mange » enregistre : `regles` (absent et `[]` restent distincts) et
 * `naissance` (absente = null). Indépendante de l'ordre des clés. Un profil absent → empreinte de { null, null }.
 */
export function empreintePrecautions(profil) {
  return texteStable({ regles: profil?.regles ?? null, naissance: profil?.naissance ?? null });
}

/**
 * Empreinte attendue, telle que l'écran l'a relevée à l'ouverture : le texte rendu par empreintePrecautions, les
 * valeurs elles-mêmes ({ regles, naissance }), ou leur JSON. → texte comparable à empreintePrecautions(profil).
 */
function empreinteAttendue(empreinteOuverture) {
  if (empreinteOuverture && typeof empreinteOuverture === 'object') return empreintePrecautions(empreinteOuverture);
  const texte = String(empreinteOuverture ?? '');
  try {
    const lu = JSON.parse(texte);
    if (lu && typeof lu === 'object' && !Array.isArray(lu)) return empreintePrecautions(lu);
  } catch {
    // Texte qui n'est pas du JSON : comparé tel quel.
  }
  return texte;
}

/** Vrai si une valeur `undefined` se cache dans `valeur`, à n'importe quelle profondeur. */
function contientIndefini(valeur) {
  if (valeur === undefined) return true;
  if (Array.isArray(valeur)) return valeur.some(contientIndefini);
  if (valeur && typeof valeur === 'object') return Object.values(valeur).some(contientIndefini);
  return false;
}

const FORMAT_NAISSANCE = /^\d{4}-\d{2}-\d{2}$/;

/**
 * « 🧸 Ce que <Enfant> mange » (gestionnaire) : règles (liste entière, préparée par coeur/age.js et coeur/regles.js :
 * régime, précautions d'âge, règles gardées telles quelles) et date de naissance (`'AAAA-MM-JJ'`, ou null pour
 * l'effacer) d'un profil. Transaction sur `profils/<id>`, qui relit le profil :
 * - absent → rien n'est écrit (jamais de profil recréé à moitié), { code: 'absent' } ;
 * - `regles` ou `naissance` changés depuis l'ouverture de l'écran (`empreinteOuverture` : empreintePrecautions du
 *   profil d'alors) → rien n'est écrit, { code: 'conflit' } ;
 * - sinon `update` de `regles` et, si la date a changé, de `naissance` (texte) ou `deleteField()` (date effacée).
 * En ligne seulement : hors ligne, { code: 'hors_ligne' } avant tout envoi (une transaction ne part jamais plus tard,
 * donc un appareil hors ligne ne peut pas écraser un durcissement fait sur l'autre).
 * Lève une erreur avant tout envoi si les règles ne sont pas une liste, cachent une valeur `undefined`, ou si la date
 * n'est pas au format `AAAA-MM-JJ`.
 * → promesse de { code: 'ok' | 'absent' | 'conflit' | 'hors_ligne' } ; rejetée si la transaction échoue (réseau…).
 */
export async function enregistrerPrecautions(profilId, { regles, naissance = null, empreinteOuverture } = {}) {
  if (typeof profilId !== 'string' || !profilId.trim() || profilId.includes('/')) {
    throw new Error('Identifiant de profil refusé.');
  }
  if (!Array.isArray(regles) || contientIndefini(regles)) {
    throw new Error('Règles refusées : une liste sans valeur indéfinie est attendue.');
  }
  const date = naissance === '' || naissance === undefined ? null : naissance;
  if (date !== null && (typeof date !== 'string' || !FORMAT_NAISSANCE.test(date))) {
    throw new Error('Date de naissance refusée : AAAA-MM-JJ, ou null pour l’effacer.');
  }
  if (typeof navigator !== 'undefined' && navigator.onLine === false) return { code: 'hors_ligne' };
  const attendue = empreinteAttendue(empreinteOuverture);
  const reference = doc(db, 'profils', profilId);
  return runTransaction(db, async (transaction) => {
    const lu = await transaction.get(reference);
    if (!lu.exists()) return { code: 'absent' };
    const actuel = lu.data();
    if (empreintePrecautions(actuel) !== attendue) return { code: 'conflit' };
    const maj = { regles };
    if (date !== null) {
      if (actuel.naissance !== date) maj.naissance = date;
    } else if (actuel.naissance !== undefined) {
      maj.naissance = deleteField();
    }
    transaction.update(reference, maj);
    return { code: 'ok' };
  });
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

/**
 * Écritures `update` d'un même document réunies en une seule, à la place de la première (champs, `effacer` et `clore`
 * mis bout à bout) : un profil présent peut recevoir ses règles et sa date de naissance par deux écritures aux
 * conditions distinctes (T2c), qui partent ainsi en une seule mise à jour. Les autres écritures restent telles quelles.
 */
function reunirMisesAJour(ecritures) {
  const reunies = [];
  const parDocument = new Map();
  for (const ecriture of ecritures) {
    if (ecriture.mode !== 'update') {
      reunies.push(ecriture);
      continue;
    }
    const cle = `${ecriture.collection}/${ecriture.id}`;
    const premiere = parDocument.get(cle);
    if (!premiere) {
      const copie = { ...ecriture, donnees: { ...(ecriture.donnees ?? {}) } };
      parDocument.set(cle, copie);
      reunies.push(copie);
      continue;
    }
    // Dans l'ordre des écritures : la dernière à poser ou à effacer un champ l'emporte.
    const ecrits = Object.keys(ecriture.donnees ?? {});
    const effaces = ecriture.effacer ?? [];
    for (const champ of effaces) delete premiere.donnees[champ];
    Object.assign(premiere.donnees, ecriture.donnees ?? {});
    const effacer = [...(premiere.effacer ?? []).filter((champ) => !ecrits.includes(champ)), ...effaces];
    if (effacer.length) premiere.effacer = [...new Set(effacer)];
    else delete premiere.effacer;
    const clore = [...(premiere.clore ?? []), ...(ecriture.clore ?? [])];
    if (clore.length) premiere.clore = [...new Set(clore)];
  }
  return reunies;
}
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
      const aFaire = reunirMisesAJour(tranche.map((ecriture, i) => appliquerConditions(ecriture, actuels[i])).filter(Boolean));
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

// ——— Corbeille ———

/** Identifiants de plats sans doublon, utilisables dans un chemin (jamais de « / »). */
function idsDePlats(platIds) {
  const liste = Array.isArray(platIds) ? platIds : [platIds];
  return [...new Set(liste.filter((id) => typeof id === 'string' && id.trim() && !id.includes('/')))];
}

/**
 * Une écriture `update` par plat, en lots de ECRITURES_PAR_TRANSACTION au plus (sous les 500 d'un lot Firestore,
 * horodatages compris) : un seul lot pour un foyer. `update` : un plat supprimé entre-temps n'est jamais recréé à
 * moitié (refus `not-found`). Hors ligne : part plus tard. → promesse de l'envoi de tous les lots.
 */
function mettreAJourPlats(platIds, champs) {
  const ids = idsDePlats(platIds);
  const envois = [];
  for (let debut = 0; debut < ids.length; debut += ECRITURES_PAR_TRANSACTION) {
    const lot = writeBatch(db);
    for (const id of ids.slice(debut, debut + ECRITURES_PAR_TRANSACTION)) lot.update(doc(db, 'plats', id), champs());
    envois.push(lot.commit());
  }
  return Promise.all(envois);
}

/**
 * Met des plats à la corbeille (les deux membres, jamais automatique) : `corbeille: { le, par }` (horodatage du
 * serveur, adresse de la personne). Seul ce champ est écrit : ni la recette, ni `majPar`, ni `majLe`.
 * → promesse de l'envoi.
 */
export function mettreALaCorbeille(platIds, auteur) {
  return mettreAJourPlats(platIds, () => ({ corbeille: { le: serverTimestamp(), par: String(auteur ?? '') } }));
}

/** Sort des plats de la corbeille : `corbeille` effacé (deleteField), rien d'autre. → promesse de l'envoi. */
export function remettreDeLaCorbeille(platIds) {
  return mettreAJourPlats(platIds, () => ({ corbeille: deleteField() }));
}

/**
 * Vide la corbeille (gestionnaire) : supprime chaque plat et sa photo (`photos/{id}`), et clôt ses demandes encore
 * ouvertes (`demandesAClore`, préparées par coeur/corbeille.js › demandesDesPlats : identifiants `<platId>__…`, ou
 * { id, platId } quand la demande dit elle-même son plat).
 * Transactions de ECRITURES_PAR_TRANSACTION écritures au plus, qui relisent chaque plat : un plat remis entre-temps
 * sur l'autre téléphone n'est jamais supprimé (ni sa photo, ni ses demandes touchées) ; un plat déjà disparu voit
 * seulement sa photo et ses demandes réglées. Une demande n'est close que si elle est encore ouverte. Hors ligne, une
 * transaction échoue au lieu d'être mise en file : rien n'est supprimé plus tard à l'insu de la personne.
 * → promesse de { supprimes: [platId], gardes: [platId], demandesCloses: [id] } ; rejetée à la première transaction
 *   qui échoue (les précédentes restent faites ; une relance ne retrouve que ce qui reste dans la corbeille).
 */
export async function viderCorbeille(platIds, demandesAClore = []) {
  const parPlat = new Map(idsDePlats(platIds).map((id) => [id, []]));
  const vues = new Set();
  for (const demande of Array.isArray(demandesAClore) ? demandesAClore : []) {
    const id = typeof demande === 'string' ? demande : demande?.id;
    if (typeof id !== 'string' || !id.trim() || id.includes('/') || vues.has(id)) continue;
    const plat = parPlat.get(demande?.platId) ?? parPlat.get(id.split('__')[0]);
    if (!plat) continue;
    vues.add(id);
    plat.push(id);
  }
  // Groupes de plats : chacun pèse sa suppression, celle de sa photo et ses demandes.
  const groupes = [];
  let groupe = [];
  let poids = 0;
  for (const [id, demandes] of parPlat) {
    const ecritures = 2 + demandes.length;
    if (groupe.length && poids + ecritures > ECRITURES_PAR_TRANSACTION) {
      groupes.push(groupe);
      groupe = [];
      poids = 0;
    }
    groupe.push({ id, demandes });
    poids += ecritures;
  }
  if (groupe.length) groupes.push(groupe);

  const bilan = { supprimes: [], gardes: [], demandesCloses: [] };
  for (const plats of groupes) {
    // Résultat rendu par la transaction (qui peut être rejouée) : rien n'est retenu avant qu'elle aboutisse.
    const fait = await runTransaction(db, async (transaction) => {
      // Toutes les lectures d'abord, comme l'exige une transaction.
      const lus = await Promise.all(plats.map(({ id }) => transaction.get(doc(db, 'plats', id))));
      const aSupprimer = plats.filter((_, i) => !lus[i].exists() || estDansCorbeille(lus[i].data()));
      const idsDemandes = aSupprimer.flatMap(({ demandes }) => demandes);
      const demandesLues = await Promise.all(idsDemandes.map((id) => transaction.get(doc(db, 'demandes', id))));
      const ouvertes = idsDemandes.filter((_, i) => demandesLues[i].exists() && demandesLues[i].data().statut === 'ouverte');
      for (const { id } of aSupprimer) {
        transaction.delete(doc(db, 'plats', id));
        transaction.delete(doc(db, 'photos', id));
      }
      for (const id of ouvertes) {
        transaction.update(doc(db, 'demandes', id), { statut: 'traitee', traiteeLe: serverTimestamp() });
      }
      const supprimes = new Set(aSupprimer.map(({ id }) => id));
      return {
        supprimes: [...supprimes],
        gardes: plats.map(({ id }) => id).filter((id) => !supprimes.has(id)),
        demandesCloses: ouvertes,
      };
    });
    bilan.supprimes.push(...fait.supprimes);
    bilan.gardes.push(...fait.gardes);
    bilan.demandesCloses.push(...fait.demandesCloses);
  }
  return bilan;
}

/**
 * Date de la dernière sauvegarde (date du téléphone, lisible tout de suite, contrairement à un serverTimestamp() en
 * attente). À n'appeler qu'en ligne. → promesse de l'envoi.
 */
/**
 * Version des instructions du projet Claude copiée par le gestionnaire (Réglages), partagée par ses appareils : une
 * copie faite sur l'ordinateur éteint aussi le rappel du téléphone.
 */
export function noterInstructionsCopiees(version) {
  const lot = writeBatch(db);
  lot.update(doc(db, 'reglages', 'foyer'), { instructionsCopiees: version });
  return lot.commit();
}

export function marquerSauvegarde(date) {
  const lot = writeBatch(db);
  lot.update(doc(db, 'reglages', 'foyer'), { derniereSauvegarde: date });
  return lot.commit();
}
