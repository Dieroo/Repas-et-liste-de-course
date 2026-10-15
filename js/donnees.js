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
import { fusionnerVariantes, verifierEcritureEtapes, champsEcritureEtapes } from './coeur/paquet.js';
import { cheminNote, noteValide } from './coeur/notes.js';
import { estDansCorbeille } from './coeur/corbeille.js';
import { empreinteRelecture, appliquerReperes } from './coeur/relecture.js';
import { VERSION_REPERES } from './coeur/vocabulaire.js';
import { lireIdDemande } from './coeur/demandes.js';
import { PHOTOS_DEMANDE_MAX, champsDemandePhotos, idPhotoDemande, idsPhotosDeLaDemande } from './coeur/photos-demande.js';
import { EFFACER, cheminSur, champsValides, jourValide, ecartJours, DUREE_MAX_JOURS } from './coeur/semaine.js';
import { ARTICLE_MAX, PRECISION_MAX } from './coeur/liste.js';
import { CHAMPS_PRODUIT, lireChampProduit, lireOrdreRayons } from './coeur/sauvegarde.js';
import { RECHERCHE_MAX, lireDrive } from './coeur/drive.js';

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

// ——— Collections partagées (profils, plats, demandes, semaines, articles, produits) ———

/**
 * Suit les profils, les plats, les demandes, les semaines, les articles ajoutés à la main (T3a) et les produits du
 * foyer (`produits/{id}`, T3b : mot cherché au drive…) en temps réel, un abonnement par collection entière, créé une fois
 * au démarrage : la liste de courses est ainsi dans la copie du téléphone dès que l'app a été ouverte avec du réseau,
 * même si l'onglet Courses ne l'a jamais été.
 * rappel({ profils, profilsDepuisCache }), rappel({ plats, platsDepuisCache }), rappel({ demandes }),
 * rappel({ semaines, semainesDepuisCache }), rappel({ articles, articlesDepuisCache }) ou rappel({ produits,
 * produitsDepuisCache }) à chaque changement, documents sous la forme { id, ...champs } ; `…DepuisCache` : copie du
 * téléphone, pas encore confirmée par le serveur.
 * surErreur(code) si une écoute s'arrête pour une autre raison qu'un accès refusé (géré par reglages/foyer).
 */
export function suivreCollections(rappel, surErreur) {
  arreterCollections();
  for (const nom of ['profils', 'plats', 'demandes', 'semaines', 'articles', 'produits']) {
    // Toutes sauf les demandes : on sait aussi si la copie vient du serveur ou seulement du téléphone (sauvegarde ;
    // « La liste n'est pas encore sur ce téléphone »).
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
 * `demanderRecette` (rôle effectif « Repas et courses », aperçu compris : décidé par l'app) : crée aussi la demande de
 * recette, `set` sans fusion (une demande traitée du même identifiant se rouvre entière).
 */
export function ajouterPlat(plat, auteur, { demanderRecette, photos = [], photoDuPlat = null, nomATrouver = false }) {
  const lot = writeBatch(db);
  // Recette en photos (2026-10-16) : « ⭐ C'est la photo du plat » devient la photo de la fiche et sa vignette.
  const vignette = photoDuPlat?.vignette ? { vignette: photoDuPlat.vignette } : {};
  lot.set(doc(db, 'plats', plat.id), { id: plat.id, nom: plat.nom, ...vignette, ...trace(auteur) }, { merge: true });
  if (photoDuPlat?.image) lot.set(doc(db, 'photos', plat.id), { image: photoDuPlat.image, ...trace(auteur) });
  if (demanderRecette) {
    const demande = demandeDeRecette(plat.id, auteur);
    // Photos de la recette : une par document (près de 1 Mo chacune), lues seulement sur la fiche du plat.
    const images = (Array.isArray(photos) ? photos : []).filter((p) => typeof p?.image === 'string').slice(0, PHOTOS_DEMANDE_MAX);
    images.forEach(({ image }, i) => {
      lot.set(doc(db, 'photosDemandes', idPhotoDemande(plat.id, i + 1)), {
        platId: plat.id, rang: i + 1, image, creePar: auteur, creeLe: serverTimestamp(),
      });
    });
    lot.set(doc(db, 'demandes', demande.id), {
      ...demande.donnees,
      ...champsDemandePhotos({ photos: images.length, nomATrouver }),
      creeLe: serverTimestamp(),
    });
  }
  return lot.commit();
}

/**
 * Suit les photos de la demande de recette d'un plat (lues seulement quand sa fiche est ouverte) : un document par
 * photo. rappel([{ rang, image }]) à chaque changement, par rang croissant ; les photos absentes sont omises.
 * → fonction d'arrêt.
 */
export function suivrePhotosDemande(platId, nombre, rappel) {
  const lues = new Map();
  const arrets = [];
  const rendre = () => rappel([...lues.entries()].sort(([a], [b]) => a - b).map(([rang, image]) => ({ rang, image })));
  try {
    for (let rang = 1; rang <= Math.min(nombre, PHOTOS_DEMANDE_MAX); rang += 1) {
      const id = idPhotoDemande(platId, rang);
      if (!id) continue;
      arrets.push(onSnapshot(doc(db, 'photosDemandes', id), (instantane) => {
        const image = instantane.exists() ? instantane.data()?.image : null;
        if (typeof image === 'string' && image.startsWith('data:image/')) lues.set(rang, image);
        else lues.delete(rang);
        rendre();
      }, () => {
        lues.delete(rang);
        rendre();
      }));
    }
  } catch {
    rendre();
  }
  return () => {
    while (arrets.length) arrets.pop()();
  };
}

// ——— Demandes (T2e) ———

/** Identifiant de demande lisible (coeur/demandes.js › lireIdDemande), sinon une erreur avant tout envoi. */
function referenceDemande(id) {
  if (!lireIdDemande(id)) throw new Error('Identifiant de demande refusé.');
  return doc(db, 'demandes', id);
}

/**
 * « 📬 Demander » (vue « Repas et courses ») : demande préparée par coeur/demandes.js › preparerDemande
 * ({ id, donnees }). Lot, `set` sans fusion : une demande traitée ou retirée se rouvre entière (nouveau `creeLe`, plus
 * de `traiteeLe`) ; `creeLe` du serveur. Pas de transaction : une demande doit pouvoir naître hors ligne, elle part
 * alors au retour du réseau. Lève une erreur avant tout envoi si l'identifiant est illisible ou si les champs ne sont
 * pas une table sans valeur indéfinie.
 * → promesse de l'envoi (ne pas l'attendre pour mettre l'écran à jour).
 */
export function creerDemande({ id, donnees } = {}) {
  const reference = referenceDemande(id);
  if (!donnees || typeof donnees !== 'object' || Array.isArray(donnees) || contientIndefini(donnees)) {
    throw new Error('Demande refusée : une table sans valeur indéfinie est attendue.');
  }
  const lot = writeBatch(db);
  lot.set(reference, { ...donnees, creeLe: serverTimestamp() });
  return lot.commit();
}

/**
 * « Retirer la demande » (gestionnaire, écran Demandes) et « Annuler » juste après « 📬 Demander » (vue « Repas et
 * courses ») : `update` de `statut: 'traitee'` et `traiteeLe` (serveur), comme une clôture. Une demande supprimée
 * entre-temps n'est jamais recréée (refus `not-found`). Hors ligne : part plus tard. → promesse de l'envoi.
 */
export function retirerDemande(id) {
  const reference = referenceDemande(id);
  const lot = writeBatch(db);
  lot.update(reference, { statut: 'traitee', traiteeLe: serverTimestamp() });
  return lot.commit();
}

/**
 * « Annuler » un retrait (gestionnaire) : `update` de `statut: 'ouverte'`, `traiteeLe` effacé ; `creeLe` et l'auteur
 * gardés. Hors ligne : part plus tard. → promesse de l'envoi.
 */
export function remettreDemande(id) {
  const reference = referenceDemande(id);
  const lot = writeBatch(db);
  lot.update(reference, { statut: 'ouverte', traiteeLe: deleteField() });
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
/**
 * Recette de Claude enregistrée (2026-10-16) : les photos des demandes de recette closes ne servent plus. Effacées
 * seulement après l'envoi de la recette (jamais si elle n'a pas pu être écrite), dans un lot à part ; échec silencieux
 * (photos orphelines, sans effet). « Modifier » ne les efface pas : une recette écrite à la main peut être en cours.
 */
function effacerPhotosDemandes(demandesAClore, envoi) {
  const ids = (demandesAClore ?? []).flatMap((id) => idsPhotosDeLaDemande(id));
  if (!ids.length) return;
  Promise.resolve(envoi).then(() => {
    const lot = writeBatch(db);
    for (const id of ids) lot.delete(doc(db, 'photosDemandes', id));
    return lot.commit();
  }).catch(() => {});
}

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
 *   transaction par plat (relireReperes).
 * - Étapes détaillées `{ id, mode: 'etapes', realisation, etapes, empreinte, effacerRelue }` (T5-0b) : une transaction
 *   par plat (ecrireEtapes). Un autre `mode` est refusé : rien n'est écrit.
 * Une fiche complète qui porte `supprimer` (T5-0b : `['realisation']`, recette remplacée par une réponse sans étapes
 * détaillées) efface ces champs dans le même `set` (jamais de recette hybride).
 * Les demandes satisfaites sont closes dans un lot à part : celles des fiches complètes tout de suite, celles des
 * versions après leurs transactions, sauf pour un plat disparu. Une relecture n'en clôt aucune.
 * → { envoi, versions, precautions, etapes } : `envoi`, promesse de l'envoi du lot des fiches (rejetée aussi si le lot
 *   n'a pas pu être construit) ; `versions`, promesse de { manquants: [id] } (rejetée à la première transaction qui
 *   échoue ; les précédentes restent faites, et une relance ne fait que fusionner à nouveau les mêmes versions) ;
 *   `precautions`, promesse de { manquants, corbeille, changes, ecrites } (relireReperes) ; `etapes`, promesse de
 *   { ecrites, supprime, corbeille, sansRecette, change } (ecrireEtapes).
 */
export function importer({ ecritures, demandesAClore }, auteur) {
  // Un mode inconnu est refusé : `{ ...undefined, id }` recréerait sinon une fiche vide (T2d).
  const inconnue = ecritures.find((ecriture) => ecriture.mode !== undefined
    && ecriture.mode !== 'versions' && ecriture.mode !== 'precautions' && ecriture.mode !== 'etapes');
  if (inconnue) {
    const refus = Promise.reject(new Error('Écriture d’import inconnue.'));
    refus.catch(() => {});
    return { envoi: refus, versions: refus, precautions: refus, etapes: refus };
  }
  const completes = ecritures.filter((ecriture) => ecriture.mode === undefined);
  const versions = ecritures.filter((ecriture) => ecriture.mode === 'versions');
  const relectures = ecritures.filter((ecriture) => ecriture.mode === 'precautions');
  const detaillees = ecritures.filter((ecriture) => ecriture.mode === 'etapes');
  const idsVersions = new Set(versions.map(({ id }) => id));
  const deVersion = (demande) => idsVersions.has(String(demande).split('__')[0]);
  let envoi;
  try {
    const lot = writeBatch(db);
    for (const { id, donnees, effacerModification, effacerRelue, supprimer } of completes) {
      const document = { ...donnees, id, ...trace(auteur) };
      if (effacerModification) Object.assign(document, { modifieeLe: deleteField(), modifieePar: deleteField() });
      // Recette remplacée ou complétée par Claude : elle n'est plus relue (T2d).
      if (effacerRelue) document.reperesRelus = deleteField();
      // Recette remplacée sans étapes détaillées (T5-0b) : celles de la fiche partent avec l'ancienne recette.
      for (const champ of Array.isArray(supprimer) ? supprimer : []) {
        if (champ === 'realisation') document.realisation = deleteField();
      }
      lot.set(doc(db, 'plats', id), document, { mergeFields: Object.keys(document) });
    }
    // Recettes toutes identiques : seules les demandes restées ouvertes sont closes.
    envoi = completes.length ? lot.commit() : Promise.resolve();
  } catch (erreur) {
    envoi = Promise.reject(erreur);
  }
  cloreDemandes((demandesAClore ?? []).filter((demande) => !deVersion(demande)));
  effacerPhotosDemandes((demandesAClore ?? []).filter((demande) => !deVersion(demande)), envoi);
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
  const etapes = detaillees.length ? ecrireEtapes(detaillees, auteur) : Promise.resolve(VIDE_ETAPES());
  etapes.catch(() => {});
  return { envoi, versions: envoiVersions, precautions: relireReperes(relectures, auteur), etapes };
}

const VIDE_ETAPES = () => ({ ecrites: [], supprime: [], corbeille: [], sansRecette: [], change: [] });

/**
 * Étapes détaillées d'un lot DEMANDE-ETAPES (T5-0b, mode `etapes`) : une transaction par plat, qui relit la fiche
 * (coeur/paquet.js › verifierEcritureEtapes) et n'écrit que `realisation`, `etapes` (ses titres), `majPar`, `majLe`,
 * et efface `reperesRelus` seulement quand Claude signale un repère à revoir (champsEcritureEtapes). Jamais les
 * ingrédients, la cuisson, les versions, les notes, le statut ni la marque « modifiée à la main ». Rien n'est écrit si
 * la fiche a disparu (`supprime`), est passée à la corbeille (`corbeille`), n'a plus sa recette (`sansRecette`) ou si
 * ses étapes ont changé depuis l'aperçu (`change`) ; une fiche qui porte déjà exactement ces étapes compte parmi
 * `ecrites`, sans rien réécrire. Hors ligne, une transaction échoue : l'app refuse l'envoi avant.
 * Aucune demande créée ni close.
 * → promesse de { ecrites, supprime, corbeille, sansRecette, change } (identifiants), rejetée à la première
 *   transaction qui échoue (les précédentes restent faites).
 */
async function ecrireEtapes(ecritures, auteur) {
  const resultat = VIDE_ETAPES();
  for (const ecriture of ecritures) {
    const issue = await runTransaction(db, async (transaction) => {
      const reference = doc(db, 'plats', ecriture.id);
      const actuel = await transaction.get(reference);
      const fiche = actuel.exists() ? { id: ecriture.id, ...actuel.data() } : null;
      const refus = verifierEcritureEtapes(ecriture, fiche);
      // Déjà détaillée de ces mêmes étapes (autre appareil, premier envoi) : rien à écrire, comptée comme écrite.
      if (refus === 'dejaFaite') return 'ecrites';
      if (refus) return refus;
      const { champs, effacer } = champsEcritureEtapes(ecriture);
      const document = { realisation: champs.realisation, etapes: champs.etapes, ...trace(auteur) };
      if (effacer.includes('reperesRelus')) document.reperesRelus = deleteField();
      transaction.update(reference, document);
      return 'ecrites';
    });
    (resultat[issue] ?? resultat.change).push(ecriture.id);
  }
  return resultat;
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
 * Lit les profils, les plats, les demandes, les produits du foyer (T3b) et les réglages du foyer (T3b : le drive) sur le
 * serveur, jamais dans la copie du téléphone : la restauration part des données à jour de l'autre téléphone.
 * → promesse de { plats, profils, demandes, produits } (documents sous la forme { id, ...champs }) et { reglages } (le
 * document `reglages/foyer`, ou null s'il n'existe pas) ; rejetée hors ligne, ou si le serveur ne répond pas à temps.
 * `reglages/foyer` est lu avec sa collection (`reglages` n'a que ce document), par la même lecture que les autres.
 */
export function lireDepuisServeur() {
  const noms = ['plats', 'profils', 'demandes', 'produits', 'reglages'];
  let minuteur = null;
  const delai = new Promise((_, rejeter) => {
    minuteur = setTimeout(() => rejeter(new Error('Serveur injoignable.')), DELAI_SERVEUR_MS);
  });
  const lecture = Promise.all(noms.map((nom) => getDocsFromServer(collection(db, nom))))
    .then((instantanes) => {
      const lus = Object.fromEntries(noms.map((nom, i) => [
        nom,
        instantanes[i].docs.map((d) => ({ ...d.data(), id: d.id })),
      ]));
      const foyer = lus.reglages.find((document) => document.id === 'foyer') ?? null;
      if (foyer) delete foyer.id;
      return { ...lus, reglages: foyer };
    });
  return Promise.race([lecture, delai]).finally(() => clearTimeout(minuteur));
}

/** Données préparées par le cœur → données Firestore : le marqueur { horodatageServeur: true } devient serverTimestamp(). */
function versFirestore(valeur) {
  if (Array.isArray(valeur)) return valeur.map(versFirestore);
  if (valeur === null || typeof valeur !== 'object' || Object.getPrototypeOf(valeur) !== Object.prototype) return valeur;
  if (valeur.horodatageServeur === true && Object.keys(valeur).length === 1) return serverTimestamp();
  return Object.fromEntries(Object.entries(valeur).map(([cle, sous]) => [cle, versFirestore(sous)]));
}

const COLLECTIONS_RESTAUREES = new Set(['plats', 'profils', 'produits', 'reglages']);
// Réglages du foyer qu'une restauration peut écrire (T3b : le drive ; T3d : l'ordre des rayons), par `update` de ces
// seuls champs : jamais un `set` du document, le gestionnaire, le sujet des notifications ni la date de sauvegarde ne
// sont touchés.
const REGLAGES_RESTAURES = new Set(['drive', 'rayons']);

/**
 * Vrai si une écriture de restauration sur `produits` ou `reglages` reste dans ce qui est permis (T3b, T3d) : un
 * produit d'identifiant `^[a-z0-9-]+$`, de champs CHAMPS_PRODUIT seulement, chacun lisible tel quel (lireChampProduit :
 * mot cherché, rayon, placard, habituel) ; `reglages/foyer` par `update` des seuls champs REGLAGES_RESTAURES (un drive
 * lisible : { nom, urlRecherche } ; un ordre des 14 rayons), sans rien effacer. Les autres collections ne sont pas
 * vérifiées ici.
 */
function ecritureRestaurablePermise({ collection: nom, id, mode, donnees, effacer }) {
  const champs = Object.keys(estTable(donnees) ? donnees : {});
  if (nom === 'produits') {
    return cheminSur(id) !== null && champs.length > 0
      && champs.every((champ) => CHAMPS_PRODUIT.includes(champ) && valeurDeProduitSure(champ, donnees[champ]))
      && !champs.some((champ) => donnees[champ] === EFFACER) && !(effacer ?? []).length;
  }
  if (nom === 'reglages') {
    return id === 'foyer' && mode === 'update' && champs.length > 0 && champs.every((champ) => REGLAGES_RESTAURES.has(champ))
      && (!champs.includes('drive') || driveSur(donnees.drive))
      && (!champs.includes('rayons') || rayonsSurs(donnees.rayons)) && !(effacer ?? []).length;
  }
  return true;
}

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
 * T3b : produits du foyer (`produits/{id}`, champs CHAMPS_PRODUIT seulement) et drive du foyer (`reglages/foyer`, `update`
 * du seul champ `drive`, jamais un `set` du document : rôle et notifications restent intacts) ; une autre écriture sur
 * ces collections est refusée avant tout envoi.
 * Les demandes satisfaites par une écriture faite (`clore`) sont closes dans la même transaction.
 * `auteur` : la personne connectée (`majPar` est déjà posé par le cœur).
 * → promesse de la fin de toutes les transactions (rejetée à la première qui échoue ; les précédentes restent faites,
 *   et une relance ne refait pas ce qui ne manque plus).
 */
export async function restaurer({ lots }, auteur) {
  const ecritures = (lots ?? []).flat();
  for (const ecriture of ecritures) {
    const { collection: nom, mode } = ecriture;
    if (!COLLECTIONS_RESTAUREES.has(nom)) throw new Error(`Collection refusée pour une restauration : ${nom}.`);
    if (mode !== 'fusion' && mode !== 'update') throw new Error(`Mode d’écriture inconnu : ${mode}.`);
    if (!ecritureRestaurablePermise(ecriture)) throw new Error(`Écriture refusée pour une restauration : ${nom}.`);
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
  // Groupes de plats : chacun pèse sa suppression, celle de sa photo, des photos de sa demande et ses demandes.
  const groupes = [];
  let groupe = [];
  let poids = 0;
  for (const [id, demandes] of parPlat) {
    const ecritures = 2 + PHOTOS_DEMANDE_MAX + demandes.length;
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
        for (const photo of idsPhotosDeLaDemande(`${id}__recette`)) transaction.delete(doc(db, 'photosDemandes', photo));
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
 * Version des instructions du projet Claude copiée par le gestionnaire (Réglages), partagée par ses appareils : une
 * copie faite sur l'ordinateur éteint aussi le rappel du téléphone.
 */
export function noterInstructionsCopiees(version) {
  const lot = writeBatch(db);
  lot.update(doc(db, 'reglages', 'foyer'), { instructionsCopiees: version });
  return lot.commit();
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

// ——— Notifications (T2e) ———

/** Sujet ntfy lu dans `reglages/foyer` ; absent, null ou vide → null (aucun sujet). */
function sujetLu(reglages) {
  const sujet = reglages?.notifications?.ntfySujet;
  return sujet === undefined || sujet === null || sujet === '' ? null : sujet;
}

/**
 * Sujet ntfy du foyer (« Activer les notifications », « Arrêter les notifications » et son « Annuler », gestionnaire),
 * par une transaction sur `reglages/foyer` (modèle devenirGestionnaire) : relit `notifications.ntfySujet` (absent ou
 * vide → null) ; s'il vaut toujours `attendu` (le sujet que la carte montrait, null : aucun), écrit `nouveau` par
 * `update` du chemin pointé (null → deleteField()) ; sinon n'écrit rien : un sujet créé ou changé sur un autre appareil
 * n'est jamais écrasé. Demande du réseau : une transaction hors ligne est refusée au lieu d'être mise en file (l'app
 * vérifie le réseau avant d'appeler). Lève une erreur avant tout envoi si `nouveau` n'est ni null ni un texte non vide.
 * → promesse de { ecrit: true } | { ecrit: false, actuel } (sujet trouvé, null si aucun) ; rejetée si la transaction
 *   échoue (réseau…).
 */
export function remplacerSujet(attendu, nouveau) {
  if (nouveau !== null && (typeof nouveau !== 'string' || !nouveau)) {
    throw new Error('Sujet refusé : un texte non vide, ou null pour l’effacer.');
  }
  const voulu = attendu === undefined || attendu === '' ? null : attendu;
  const reference = doc(db, 'reglages', 'foyer');
  return runTransaction(db, async (transaction) => {
    const lu = await transaction.get(reference);
    const actuel = sujetLu(lu.exists() ? lu.data() : null);
    if (actuel !== voulu) return { ecrit: false, actuel };
    transaction.update(reference, { 'notifications.ntfySujet': nouveau === null ? deleteField() : nouveau });
    return { ecrit: true };
  });
}

// ——— Semaine et liste de courses (T3a) ———
// La liste se calcule sur le téléphone (coeur/liste.js) : on n'écrit que les gestes, toujours par lot (appliqué tout de
// suite sur le téléphone, envoyé au retour du réseau ; aucune transaction : rien ne doit être refusé en magasin).

/** Valeur prête pour Firestore : EFFACER (coeur/semaine.js) → deleteField(), seulement au premier niveau d'un chemin. */
function versChamp(valeur) {
  return valeur === EFFACER ? deleteField() : valeur;
}

/** Vrai si EFFACER se cache sous le premier niveau (Firestore refuse deleteField() imbriqué dans un update). */
function effacerImbrique(valeur) {
  if (Array.isArray(valeur)) return valeur.some((v) => v === EFFACER || effacerImbrique(v));
  if (valeur && typeof valeur === 'object') return Object.values(valeur).some((v) => v === EFFACER || effacerImbrique(v));
  return false;
}

/** Table simple (ni tableau, ni null, ni objet du SDK). */
function estTable(valeur) {
  return Boolean(valeur) && typeof valeur === 'object' && !Array.isArray(valeur)
    && Object.getPrototypeOf(valeur) === Object.prototype;
}

/** Identifiant de document utilisable dans un chemin : texte non vide, sans « / ». */
function idDocumentSur(id) {
  return typeof id === 'string' && id.trim() !== '' && !id.includes('/') && id !== '.' && id !== '..';
}

const CHAMPS_CREATION_SEMAINE = new Set(['debut', 'fin', 'creePar', 'creeLe']);

/**
 * Dates d'une semaine changées (T3c, « Les dates de la semaine ») : `debut` et `fin` toujours ensemble (deux téléphones
 * qui changeraient l'un le début, l'autre la fin pourraient laisser une semaine illisible, qui disparaîtrait avec ses
 * plats), jours réels « AAAA-MM-JJ », jamais effacés, fin au plus tôt le jour du début, DUREE_MAX_JOURS jours au plus.
 * Vrai aussi pour une écriture qui ne touche pas aux dates.
 */
function datesSures(champs) {
  const aDebut = Object.hasOwn(champs, 'debut');
  const aFin = Object.hasOwn(champs, 'fin');
  if (!aDebut && !aFin) return true;
  if (!aDebut || !aFin || !jourValide(champs.debut) || !jourValide(champs.fin)) return false;
  const duree = ecartJours(champs.debut, champs.fin);
  return duree !== null && duree >= 0 && duree + 1 <= DUREE_MAX_JOURS;
}

const CHAMPS_ARTICLE = new Set(['libelle', 'precision', 'creePar', 'creeLe']);

/**
 * Données d'un nouvel article ({ libelle, precision?, creePar?, creeLe }) vérifiées avant tout envoi : libellé non vide
 * de ARTICLE_MAX caractères au plus, précision de PRECISION_MAX au plus, aucun autre champ, aucune valeur indéfinie.
 * Lève une erreur sinon.
 */
function verifierNouvelArticle(donnees) {
  const ok = estTable(donnees)
    && Object.keys(donnees).every((cle) => CHAMPS_ARTICLE.has(cle))
    && !contientIndefini(donnees)
    && typeof donnees.libelle === 'string' && donnees.libelle.trim() !== '' && donnees.libelle.length <= ARTICLE_MAX
    && (donnees.precision === undefined
      || (typeof donnees.precision === 'string' && donnees.precision.length <= PRECISION_MAX))
    && (donnees.creePar === undefined || typeof donnees.creePar === 'string')
    && Number.isFinite(donnees.creeLe);
  if (!ok) throw new Error('Article refusé : libellé, précision, auteur et date du téléphone seulement.');
}

/**
 * Écritures d'un geste sur une semaine, préparées par coeur/semaine.js (ecrituresAjout, ecrituresRetrait,
 * ecrituresRemise, ecrituresStyle, ecrituresReglage) ou coeur/liste.js (ecrituresCoche, ecrituresRachat ; T3d :
 * ecrituresSansHabituel, ecrituresSansHebdo, « Pas cette semaine » : `sansHabituel.<produitId>`, `sansHebdo.<platId>`),
 * ou par app.js › changerDates (coeur/semaine.js › validerDates), en un lot :
 * - `creation` ({ id, donnees: { debut, fin, creePar?, creeLe } }, seulement au premier plat) : `set` fusionné de ces
 *   champs seulement (jamais de statut : deux téléphones qui créent la même semaine le même jour se fusionnent) ;
 * - `champs` : `update` des chemins pointés (`plats.<id>.ajouteLe`, `plats.<id>.mange.<p>`,
 *   `plats.<id>.invites.adultes`, `coches.<cle>`…), EFFACER → deleteField() ; deux téléphones qui touchent deux chemins
 *   différents ne s'écrasent jamais ; `debut` et `fin` (T3c, dates changées) : toujours ensemble, jours réels,
 *   14 jours au plus (datesSures) ;
 * - `articles` (restes de la semaine qui finit, seulement avec l'ajout d'un plat, `plats.<id>.ajouteLe`) : un document
 *   `articles/{id}` chacun ({ id?, libelle, precision?, creePar?, creeLe }), `set` fusionné ; `id` donné
 *   (`reste--<semaine>--<produit>`, coeur/semaine.js › idReste) : deux téléphones écrivent le même document, une coche
 *   posée entre-temps reste ; sans lui, identifiant créé ici ;
 * - `supprimer` (identifiants d'articles des restes, coeur/semaine.js › ecrituresRetrait) : supprimés dans le même lot.
 * Lève une erreur avant tout envoi si l'identifiant de la semaine n'est pas `^[a-z0-9-]+$`, si un chemin, une valeur
 * (undefined, NaN, table vide) ou un article est refusé, si la création porte un autre champ, si des dates changées
 * sont refusées, ou s'il n'y a rien à écrire. Hors ligne : part plus tard.
 * → { envoi, articleIds } : `envoi`, promesse de l'envoi (ne pas l'attendre pour mettre l'écran à jour) ; `articleIds`,
 *   identifiants des articles écrits, dans l'ordre de `articles`.
 */
export function ecrireSemaine({ creation = null, id, champs = {}, articles = [], supprimer = [] } = {}) {
  if (!cheminSur(id)) throw new Error('Identifiant de semaine refusé.');
  const chemins = estTable(champs) ? Object.entries(champs) : null;
  if (!chemins || !champsValides(champs) || chemins.some(([, valeur]) => effacerImbrique(valeur))) {
    throw new Error('Écriture de la semaine refusée : chemins sûrs et valeurs définies attendus.');
  }
  if (creation !== null) {
    const donnees = creation?.donnees;
    const ok = estTable(donnees) && (creation.id === undefined || creation.id === id)
      && Object.keys(donnees).every((cle) => CHAMPS_CREATION_SEMAINE.has(cle))
      && typeof donnees.debut === 'string' && typeof donnees.fin === 'string'
      && !contientIndefini(donnees) && !effacerImbrique(donnees);
    if (!ok) throw new Error('Création de la semaine refusée : début, fin, auteur et date du téléphone seulement.');
  }
  const nouveaux = (Array.isArray(articles) ? articles : []).map((article) => {
    const { id: articleId, ...donnees } = estTable(article) ? article : {};
    if (articleId !== undefined && !idDocumentSur(articleId)) throw new Error('Identifiant d’article refusé.');
    verifierNouvelArticle(donnees);
    return { articleId, donnees };
  });
  const ajoutDePlat = chemins.some(([chemin]) => /^plats\.[a-z0-9-]+\.ajouteLe$/.test(chemin));
  if (nouveaux.length && !ajoutDePlat) throw new Error('Articles refusés : seulement avec l’ajout d’un plat.');
  const aSupprimer = Array.isArray(supprimer) ? supprimer : [];
  if (aSupprimer.some((articleId) => !idDocumentSur(articleId))) throw new Error('Identifiant d’article refusé.');
  if (creation === null && !chemins.length) throw new Error('Rien à écrire dans la semaine.');
  if (!datesSures(champs)) {
    throw new Error('Dates de la semaine refusées : début et fin ensemble, jours réels, 14 jours au plus.');
  }

  const reference = doc(db, 'semaines', id);
  const lot = writeBatch(db);
  if (creation !== null) lot.set(reference, { ...creation.donnees }, { merge: true });
  if (chemins.length) lot.update(reference, Object.fromEntries(chemins.map(([chemin, valeur]) => [chemin, versChamp(valeur)])));
  const articleIds = [];
  for (const { articleId, donnees } of nouveaux) {
    const referenceArticle = articleId === undefined ? doc(collection(db, 'articles')) : doc(db, 'articles', articleId);
    lot.set(referenceArticle, { ...donnees }, { merge: true });
    articleIds.push(referenceArticle.id);
  }
  for (const articleId of new Set(aSupprimer)) lot.delete(doc(db, 'articles', articleId));
  return { envoi: lot.commit(), articleIds };
}

/**
 * Ajoute un article à la main (« Ajouter à la liste ») : nouveau document `articles/{id}`, identifiant créé ici (sur le
 * téléphone, hors ligne compris). `donnees` : { libelle, precision?, creePar?, creeLe } (voir verifierNouvelArticle).
 * Lève une erreur avant tout envoi sinon. → { id, envoi } (promesse de l'envoi).
 */
export function ajouterArticle(donnees) {
  verifierNouvelArticle(donnees);
  const reference = doc(collection(db, 'articles'));
  const lot = writeBatch(db);
  lot.set(reference, { ...donnees });
  return { id: reference.id, envoi: lot.commit() };
}

/**
 * Coche (`coche: { le }` ou EFFACER) ou précision (T3d, « Précision (facultatif) » : texte de PRECISION_MAX caractères au
 * plus, ou EFFACER ; coeur/liste.js › ecrituresPrecision) d'un article :
 * `update` de ces seuls champs. Un article supprimé entre-temps par l'autre téléphone n'est jamais recréé à moitié :
 * le refus `not-found` est silencieux (promesse résolue). Lève une erreur avant tout envoi si l'identifiant ou un champ
 * est refusé. → promesse de l'envoi (rejetée pour un autre refus).
 */
export function modifierArticle(id, champs) {
  if (!idDocumentSur(id)) throw new Error('Identifiant d’article refusé.');
  const entrees = estTable(champs) ? Object.entries(champs) : [];
  const ok = entrees.length > 0 && entrees.every(([cle, valeur]) => {
    if (valeur === EFFACER) return cle === 'coche' || cle === 'precision';
    if (cle === 'coche') return estTable(valeur) && !contientIndefini(valeur) && !effacerImbrique(valeur);
    if (cle === 'precision') return typeof valeur === 'string' && valeur.length <= PRECISION_MAX;
    return false;
  });
  if (!ok) throw new Error('Modification d’article refusée : coche ou précision seulement.');
  const lot = writeBatch(db);
  lot.update(doc(db, 'articles', id), Object.fromEntries(entrees.map(([cle, valeur]) => [cle, versChamp(valeur)])));
  return lot.commit().catch((erreur) => {
    if (erreur?.code === 'not-found') return undefined;
    throw erreur;
  });
}

/** Retire des articles de la liste (« Retirer de la liste ») : suppression de chaque document. → promesse de l'envoi. */
export function supprimerArticles(ids) {
  const liste = [...new Set((Array.isArray(ids) ? ids : [ids]).filter(idDocumentSur))];
  if (!liste.length) throw new Error('Aucun article à retirer.');
  const envois = [];
  for (let debut = 0; debut < liste.length; debut += ECRITURES_PAR_TRANSACTION) {
    const lot = writeBatch(db);
    for (const id of liste.slice(debut, debut + ECRITURES_PAR_TRANSACTION)) lot.delete(doc(db, 'articles', id));
    envois.push(lot.commit());
  }
  return Promise.all(envois);
}

/**
 * « Annuler » d'un retrait : remet chaque article tel qu'il était ({ id, ...champs }, même identifiant), par un `set`
 * sans fusion. Lève une erreur avant tout envoi si un identifiant est refusé ou si une valeur est indéfinie.
 * → promesse de l'envoi.
 */
export function remettreArticles(docs) {
  const liste = (Array.isArray(docs) ? docs : [docs]).map((article) => {
    if (!estTable(article) || !idDocumentSur(article.id)) throw new Error('Article refusé.');
    const { id, ...champs } = article;
    if (contientIndefini(champs) || effacerImbrique(champs)) throw new Error('Article refusé : valeur indéfinie.');
    return { id, champs };
  });
  if (!liste.length) throw new Error('Aucun article à remettre.');
  const envois = [];
  for (let debut = 0; debut < liste.length; debut += ECRITURES_PAR_TRANSACTION) {
    const lot = writeBatch(db);
    for (const { id, champs } of liste.slice(debut, debut + ECRITURES_PAR_TRANSACTION)) lot.set(doc(db, 'articles', id), champs);
    envois.push(lot.commit());
  }
  return Promise.all(envois);
}

// ——— Au drive et fin des courses (T3b) ———
// Toujours par lot (appliqué tout de suite sur le téléphone, envoyé au retour du réseau ; aucune transaction : rien ne
// doit être refusé en magasin), seulement sur un geste.

/**
 * Vrai pour une valeur de champ d'un produit (`produits/{id}`) : EFFACER, un mot cherché de 1 à RECHERCHE_MAX caractères
 * (T3b), ou (T3d) un rayon, un placard { actif } ou un habituel { actif, qte?, unite?, libelle? } écrits tels que
 * coeur/sauvegarde.js › lireChampProduit les relit à l'identique (aucun champ de plus, aucune valeur illisible).
 */
function valeurDeProduitSure(champ, valeur) {
  if (valeur === EFFACER) return true;
  if (champ === 'rechercheDrive') return typeof valeur === 'string' && valeur.trim() !== '' && valeur.length <= RECHERCHE_MAX;
  if (contientIndefini(valeur) || effacerImbrique(valeur)) return false;
  const lu = lireChampProduit(champ, valeur);
  return lu !== null && texteStable(lu) === texteStable(valeur);
}

/**
 * Différences voulues par le foyer sur des produits (« Au drive, je cherche », T3b ; T3d : « Rayon : … · Changer »,
 * « Toujours dans mon placard », « À acheter chaque semaine » ; préparées par coeur/liste.js › ecrituresRecherche,
 * ecrituresRayon, ecrituresPlacard, ecrituresHabituel : [{ id, champs }]), en un seul lot : pour chacun, `set` +
 * `mergeFields` des seuls champs donnés
 * (EFFACER → deleteField() : retour au défaut) ; les autres champs du produit restent, et un produit absent est créé
 * avec ce seul champ. Jamais une valeur recopiée des produits courants ni des recettes.
 * Dans le même lot (T3d, « À acheter chaque semaine » allumé depuis un article ajouté à la main : l'article devient
 * l'habituel, jamais deux « Lait » ; éteint aussitôt, il revient) : `supprimerArticles` (identifiants d'articles) et
 * `remettreArticles` (articles tels qu'ils étaient, { id, ...champs }, `set` sans fusion, même identifiant).
 * Lève une erreur avant tout envoi si un identifiant n'est pas `^[a-z0-9-]+$`, si un champ n'est pas un champ de produit
 * (coeur/sauvegarde.js › CHAMPS_PRODUIT) ou si une valeur est refusée, si un article est refusé, ou s'il n'y a rien à
 * écrire. Hors ligne : part plus tard. → promesse de l'envoi.
 */
export function ecrireProduits(ecritures, { supprimerArticles: aSupprimer = [], remettreArticles: aRemettre = [] } = {}) {
  const liste = Array.isArray(ecritures) ? ecritures : [];
  const supprimes = [...new Set((Array.isArray(aSupprimer) ? aSupprimer : []).filter(idDocumentSur))];
  if (supprimes.length !== (Array.isArray(aSupprimer) ? new Set(aSupprimer).size : 0)) throw new Error('Article refusé.');
  const remis = (Array.isArray(aRemettre) ? aRemettre : []).map((article) => {
    if (!estTable(article) || !idDocumentSur(article.id)) throw new Error('Article refusé.');
    const { id, ...champs } = article;
    if (contientIndefini(champs) || effacerImbrique(champs)) throw new Error('Article refusé : valeur indéfinie.');
    return { id, champs };
  });
  if (!liste.length && !supprimes.length && !remis.length) throw new Error('Rien à écrire dans les produits.');
  const preparees = liste.map((ecriture) => {
    const id = ecriture?.id;
    const champs = ecriture?.champs;
    const entrees = estTable(champs) ? Object.entries(champs) : [];
    if (!cheminSur(id) || !entrees.length
      || !entrees.every(([champ, valeur]) => CHAMPS_PRODUIT.includes(champ) && valeurDeProduitSure(champ, valeur))) {
      throw new Error('Écriture d’un produit refusée : identifiant sûr et champs d’un produit attendus.');
    }
    return { id, document: Object.fromEntries(entrees.map(([champ, valeur]) => [champ, versChamp(valeur)])) };
  });
  const lot = writeBatch(db);
  for (const { id, document } of preparees) {
    lot.set(doc(db, 'produits', id), document, { mergeFields: Object.keys(document) });
  }
  for (const id of supprimes) lot.delete(doc(db, 'articles', id));
  for (const { id, champs } of remis) lot.set(doc(db, 'articles', id), champs);
  return lot.commit();
}

/** Un seul produit : ecrireProduits([{ id, champs }]). → promesse de l'envoi. */
export function ecrireProduit(id, champs) {
  return ecrireProduits([{ id, champs }]);
}

// Réglages du foyer que les deux membres écrivent depuis les écrans des courses (T3b : le drive ; T3d : l'ordre des
// rayons ; T3e : apéro), par `update` de ces chemins seulement.
const REGLAGES_COURSES = new Set(['drive', 'rayons']);

/** Vrai pour un drive écrit tel que coeur/drive.js › lireDrive le relit : { nom, urlRecherche } exactement. */
function driveSur(valeur) {
  if (!estTable(valeur) || !Object.keys(valeur).every((cle) => cle === 'nom' || cle === 'urlRecherche')) return false;
  const lu = lireDrive(valeur);
  return Boolean(lu) && lu.nom === valeur.nom && lu.urlRecherche === valeur.urlRecherche;
}

/**
 * Vrai pour un ordre des rayons écrit tel que coeur/sauvegarde.js › lireOrdreRayons le relit (T3d) : les 14 rayons,
 * chacun une fois, rien d'autre (coeur/liste.js › ecrituresRayons écrit toujours la liste entière).
 */
function rayonsSurs(valeur) {
  if (!Array.isArray(valeur)) return false;
  const lu = lireOrdreRayons(valeur);
  return Boolean(lu) && lu.length === valeur.length && lu.every((rayon, i) => rayon === valeur[i]);
}

/**
 * Réglages des courses du foyer (T3b : `drive`, préparé par coeur/drive.js › ecrituresDrive ; T3d : `rayons`, l'ordre
 * des 14 rayons, préparé par coeur/liste.js › ecrituresRayons) : `update` de `reglages/foyer`, chemins validés (`drive`
 * et `rayons` seulement ; EFFACER → deleteField() : retour au défaut). Jamais un `set` du document : le gestionnaire, le
 * sujet des notifications et les autres réglages restent. Lève une erreur avant tout envoi si un chemin ou une valeur
 * est refusé (drive illisible, ordre qui n'a pas les 14 rayons une fois chacun). Hors ligne : part plus tard.
 * → promesse de l'envoi.
 */
export function ecrireReglages(champs) {
  const entrees = estTable(champs) ? Object.entries(champs) : [];
  const ok = entrees.length > 0 && entrees.every(([chemin, valeur]) => REGLAGES_COURSES.has(chemin)
    && (valeur === EFFACER || (chemin === 'drive' && driveSur(valeur)) || (chemin === 'rayons' && rayonsSurs(valeur))));
  if (!ok) throw new Error('Réglage refusé : seulement le drive ou l’ordre des rayons du foyer.');
  const lot = writeBatch(db);
  lot.update(doc(db, 'reglages', 'foyer'), Object.fromEntries(entrees.map(([chemin, valeur]) => [chemin, versChamp(valeur)])));
  return lot.commit();
}

// Champs d'une semaine qu'écrivent « Courses terminées » et son « Annuler » (T3b).
const CHAMPS_FIN_DES_COURSES = new Set(['statut', 'statutAvant', 'coursesFaitesLe', 'coursesFaitesPar', 'coursesFaitesA']);

/**
 * Article écrit tel quel par « Courses terminées » (article gardé pour la prochaine fois) ou par son « Annuler » (article
 * remis tel qu'il était) : { id, libelle, ...champs } ; identifiant de document sûr, libellé non vide de ARTICLE_MAX
 * caractères au plus, aucune valeur indéfinie. Lève une erreur sinon. → { id, champs }.
 */
function articleEntier(article) {
  if (!estTable(article) || !idDocumentSur(article.id)) throw new Error('Identifiant d’article refusé.');
  const { id, ...champs } = article;
  const ok = typeof champs.libelle === 'string' && champs.libelle.trim() !== '' && champs.libelle.length <= ARTICLE_MAX
    && (champs.precision === undefined || (typeof champs.precision === 'string' && champs.precision.length <= PRECISION_MAX))
    && !contientIndefini(champs) && !effacerImbrique(champs);
  if (!ok) throw new Error('Article refusé : libellé et valeurs définies attendus.');
  return { id, champs };
}

/**
 * « Courses terminées » (T3b) et son « Annuler » : un seul lot, préparé par coeur/liste.js › preparerFinDesCourses
 * (`lot`, ou `avant` pour « Annuler ») : { id (la semaine), champs, articles, supprimer } :
 * - `champs` : `update` des seuls champs de la fin des courses (`statut`, `statutAvant`, `coursesFaitesLe`,
 *   `coursesFaitesPar`, `coursesFaitesA` ; EFFACER → deleteField()) ;
 * - `articles` : chacun `{ id, libelle, ...champs }` écrit par un `set` sans fusion (article gardé pour la prochaine
 *   fois, `garde--<semaine>--<produit>` : deux téléphones écrivent le même document, jamais deux ; « Annuler » : article
 *   remis tel qu'il était, même identifiant) ;
 * - `supprimer` : articles supprimés (achetés ; « Annuler » : articles gardés retirés).
 * Lève une erreur avant tout envoi si l'identifiant de la semaine n'est pas `^[a-z0-9-]+$`, si un champ ou un article
 * est refusé, ou s'il n'y a rien à écrire. Hors ligne : part plus tard. → promesse de l'envoi.
 */
export function terminerCourses({ lot: ecritures } = {}) {
  const { id, champs = {}, articles = [], supprimer = [] } = estTable(ecritures) ? ecritures : {};
  if (!cheminSur(id)) throw new Error('Identifiant de semaine refusé.');
  const chemins = estTable(champs) ? Object.entries(champs) : null;
  if (!chemins || !champsValides(champs) || chemins.some(([chemin, valeur]) => !CHAMPS_FIN_DES_COURSES.has(chemin)
    || effacerImbrique(valeur))) {
    throw new Error('Fin des courses refusée : statut et traces de la fin des courses seulement.');
  }
  const ecrits = (Array.isArray(articles) ? articles : []).map(articleEntier);
  const aSupprimer = [...new Set(Array.isArray(supprimer) ? supprimer : [])];
  if (aSupprimer.some((articleId) => !idDocumentSur(articleId))) throw new Error('Identifiant d’article refusé.');
  if (!chemins.length && !ecrits.length && !aSupprimer.length) throw new Error('Rien à écrire pour la fin des courses.');

  const lot = writeBatch(db);
  if (chemins.length) {
    lot.update(doc(db, 'semaines', id), Object.fromEntries(chemins.map(([chemin, valeur]) => [chemin, versChamp(valeur)])));
  }
  for (const articleId of aSupprimer) lot.delete(doc(db, 'articles', articleId));
  for (const { id: articleId, champs: donnees } of ecrits) lot.set(doc(db, 'articles', articleId), donnees);
  return lot.commit();
}

/**
 * Date des plats (« Courses terminées », T3b ; préparées par coeur/liste.js › ecrituresDernieresFois : [{ platId, champs:
 * { derniereFois } }]) : un lot par plat, `update` du seul champ `derniereFois` (EFFACER → deleteField()), sans `majPar`
 * ni `majLe`. Un plat supprimé entre-temps n'empêche que le sien et n'est jamais recréé (refus `not-found`), sans
 * message. Les écritures refusées (plat ou valeur illisibles) sont écartées avant tout envoi. Hors ligne : part plus
 * tard.
 * → promesse de { echecs: [platId] } (jamais rejetée) : plats dont l'écriture a été refusée ou écartée.
 */
export function ecrireDernieresFois(ecritures) {
  const echecs = [];
  const envois = [];
  for (const ecriture of Array.isArray(ecritures) ? ecritures : []) {
    const platId = ecriture?.platId;
    const champs = ecriture?.champs;
    const valeur = estTable(champs) ? champs.derniereFois : undefined;
    const ok = cheminSur(platId) !== null && estTable(champs) && Object.keys(champs).length === 1
      && valeur !== undefined && valeur !== null && !contientIndefini(valeur) && !effacerImbrique(valeur);
    if (!ok) {
      if (typeof platId === 'string') echecs.push(platId);
      continue;
    }
    try {
      const lot = writeBatch(db);
      lot.update(doc(db, 'plats', platId), { derniereFois: versChamp(valeur) });
      envois.push(lot.commit().catch(() => {
        echecs.push(platId);
      }));
    } catch {
      echecs.push(platId);
    }
  }
  return Promise.all(envois).then(() => ({ echecs }));
}
