// Demandes de recettes et de versions (CLAUDE.md §7, T2e) : ce que la vue « Repas et courses » peut demander sur la
// fiche, le document à écrire, les demandes encore utiles pour le gestionnaire (carte 📬, panneau, écran Demandes) et
// la phrase « Demandée… ». Logique pure : ni DOM ni Firebase. Une demande se reconnaît à son identifiant
// (`<platId>__recette`, `<platId>__<profilId>`), exactement celui que paquet.js › demandesSatisfaites reconstruit pour
// la clore : `type` et `platId` sont écrits pour la lisibilité, jamais lus pour décider. Une demande n'est montrée
// que si la prochaine réponse de Claude qui lui convient la fermera (même condition que la clôture). Aucun module de
// coeur/ ne l'importe : pas de cycle.
import { evaluer as evaluerParDefaut, profilsContraints } from './compatibilite.js';
import { aSaRecette, demandeDeRecette } from './plats.js';
import { estDansCorbeille, jourLisible, versDate } from './corbeille.js';
import { profilDeLEmail, trierProfils } from './profils.js';
import { normaliserEmail } from './roles.js';

/** Seconde moitié de l'identifiant d'une demande de recette. */
export const SUFFIXE_RECETTE = 'recette';

const SEPARATEUR = '__';
const ID_VALIDE = /^[a-z0-9-]+$/;

const estObjet = (valeur) => Boolean(valeur) && typeof valeur === 'object' && !Array.isArray(valeur);
const reduire = (texte) => (typeof texte === 'string' ? texte.replace(/\s+/g, ' ').trim() : '');
const comparerNoms = new Intl.Collator('fr', { sensitivity: 'base' }).compare;
// Ordre des identifiants indépendant de la langue du téléphone.
const parId = (a, b) => (a < b ? -1 : a > b ? 1 : 0);
const liste = (valeur) => (Array.isArray(valeur) ? valeur : []);

// ——— Identifiants ———

/**
 * Identifiant d'une demande : '<platId>__recette' (sans profilId) ou '<platId>__<profilId>'. null si un identifiant
 * n'est pas un slug [a-z0-9-]+ (un « __ » est donc refusé), ou si profilId vaut 'recette' (il se confondrait avec la
 * demande de recette).
 */
export function idDemande(platId, profilId = null) {
  if (typeof platId !== 'string' || !ID_VALIDE.test(platId)) return null;
  if (profilId === null || profilId === undefined) return `${platId}${SEPARATEUR}${SUFFIXE_RECETTE}`;
  if (typeof profilId !== 'string' || !ID_VALIDE.test(profilId) || profilId === SUFFIXE_RECETTE) return null;
  return `${platId}${SEPARATEUR}${profilId}`;
}

/**
 * Ce que dit l'identifiant d'une demande (`split('__')`, comme demandesSatisfaites) :
 * { platId, profilId | null, type: 'recette' | 'variante' } ; null s'il est illisible (pas un texte, sans « __ »,
 * « __ » en trop, moitié vide ou qui n'est pas un slug).
 */
export function lireIdDemande(id) {
  if (typeof id !== 'string') return null;
  const moities = id.split(SEPARATEUR);
  if (moities.length !== 2 || !moities.every((moitie) => ID_VALIDE.test(moitie))) return null;
  const [platId, suite] = moities;
  return suite === SUFFIXE_RECETTE
    ? { platId, profilId: null, type: 'recette' }
    : { platId, profilId: suite, type: 'variante' };
}

/** La demande ouverte (`statut: 'ouverte'`) de cet identifiant, ou null. */
export function demandeOuverte(demandes, id) {
  if (typeof id !== 'string' || !id) return null;
  return liste(demandes).find((demande) => estObjet(demande) && demande.id === id && demande.statut === 'ouverte')
    ?? null;
}

/**
 * Date de la demande (`creeLe` : horodatage Firestore, `{ seconds }`, Date, texte ISO).
 * → { date: Date | null, enAttente } : `enAttente` vrai seulement si `creeLe === null` (écriture de ce téléphone pas
 * encore reçue par le serveur) ; champ absent ou illisible → { date: null, enAttente: false } (date inconnue).
 */
export function dateDemande(demande) {
  if (!estObjet(demande)) return { date: null, enAttente: false };
  if (Object.hasOwn(demande, 'creeLe') && demande.creeLe === null) return { date: null, enAttente: true };
  return { date: versDate(demande.creeLe), enAttente: false };
}

// ——— Ce qui peut être demandé ———

/** Vrai si le profil a noté le plat « Jamais » (0). */
function noteJamais(plat, profil) {
  const notes = estObjet(plat?.notes) ? plat.notes : {};
  return typeof profil?.id === 'string' && Object.hasOwn(notes, profil.id) && notes[profil.id] === 0;
}

/** Plat actif (objet, hors corbeille). */
const estActif = (plat) => estObjet(plat) && !estDansCorbeille(plat);

/**
 * Vrai si ce plat attend une version que ce profil peut demander : plat actif, recette remplie, à créer ou à revoir
 * d'après `resultat` (compatibilite.js › evaluer), pas noté « Jamais » par ce profil. Tous les types, apéro et
 * préparation compris : sur un plat actif qui a sa recette et que ce profil n'a pas noté « Jamais », c'est exactement
 * l'inverse de paquet.js › platAdapte, qui clôt. Jamais « à compléter » (une version convient déjà), jamais ⏳.
 */
export function versionADemander(plat, profil, resultat) {
  if (!estActif(plat) || !aSaRecette(plat) || !estObjet(profil) || noteJamais(plat, profil)) return false;
  return Boolean(resultat?.aCreer || resultat?.aRevoir);
}

/**
 * Examen commun de la fiche, de la préparation et de l'écran Demandes (invariant 5 : ce qui peut être demandé est ce
 * que le gestionnaire voit ensuite). `profil` null : la recette.
 * → null (rien d'utile) | { id, ouverte: demande | null, resultat: résultat d'evaluer | null }
 * `evaluer` n'est appelé qu'une fois, et seulement pour une version.
 */
function examiner(plat, profil, demandes, evaluation) {
  if (!estActif(plat)) return null;
  if (profil === null || profil === undefined) {
    const id = idDemande(plat.id);
    if (!id || aSaRecette(plat)) return null;
    return { id, ouverte: demandeOuverte(demandes, id), resultat: null };
  }
  // Un profil sans identifiant n'est jamais pris pour la recette (idDemande sans profil).
  if (!estObjet(profil) || typeof profil.id !== 'string') return null;
  const id = idDemande(plat.id, profil.id);
  // Un profil sans règle (ou qui n'a que des précautions d'âge) n'attend jamais de version.
  if (!id || !aSaRecette(plat) || noteJamais(plat, profil) || !profilsContraints([profil]).length) return null;
  const resultat = typeof evaluation === 'function' ? evaluation(plat, profil) : null;
  if (!versionADemander(plat, profil, resultat)) return null;
  return { id, ouverte: demandeOuverte(demandes, id), resultat };
}

/**
 * Ce que la vue « Repas et courses » peut proposer sur la fiche, pour ce plat et ce profil (profil null : la recette).
 * → null (rien à proposer) | { possible: true, id } | { ouverte: demande }
 * Version : versionADemander vrai, profil qui a des règles, identifiant valide. Recette : plat actif sans ingrédients.
 * Une demande ouverte devenue inutile (version arrivée, plat rempli…) ne se montre pas : null.
 */
export function etatDemande(plat, profil, { demandes = [], evaluer = evaluerParDefaut } = {}) {
  const examen = examiner(plat, profil, demandes, evaluer);
  if (!examen) return null;
  return examen.ouverte ? { ouverte: examen.ouverte } : { possible: true, id: examen.id };
}

/**
 * Document à écrire pour le geste « Demander ». `auteur` : adresse de la personne connectée, écrite telle quelle (même
 * en aperçu).
 * → { id, donnees } (sans `creeLe`, posé par donnees.js) | { erreur: 'invalide' | 'inutile' | 'deja' }.
 * Recette : même forme que plats.js › demandeDeRecette. Version : { type: 'variante', platId, profilId, besoin?,
 * creePar, statut: 'ouverte' }, `besoin` (celui d'evaluer) seulement s'il est un texte. Une demande traitée (ou
 * retirée) du même identifiant est rouverte : le document est entier. Aucune valeur undefined ni null.
 * 'invalide' : auteur vide, identifiant impossible (plat ou profil sans slug, profil d'identifiant 'recette') ;
 * 'inutile' : rien à demander (plat absent ou de la corbeille, déjà rempli, qui convient, à compléter, noté
 * « Jamais », profil sans règle) ; 'deja' : la demande est déjà ouverte.
 */
export function preparerDemande({ plat, profil = null } = {}, { demandes = [], auteur, evaluer = evaluerParDefaut } = {}) {
  if (typeof auteur !== 'string' || !auteur.trim()) return { erreur: 'invalide' };
  if (!estObjet(plat)) return { erreur: 'inutile' };
  const pourVersion = profil !== null && profil !== undefined;
  if (pourVersion && (!estObjet(profil) || typeof profil.id !== 'string' || !idDemande(plat.id, profil.id))) {
    return { erreur: 'invalide' };
  }
  if (!pourVersion && !idDemande(plat.id)) return { erreur: 'invalide' };
  const examen = examiner(plat, profil, demandes, evaluer);
  if (!examen) return { erreur: 'inutile' };
  if (examen.ouverte) return { erreur: 'deja' };
  if (!pourVersion) return demandeDeRecette(plat.id, auteur);
  const besoin = examen.resultat?.besoin;
  return {
    id: examen.id,
    donnees: {
      type: 'variante',
      platId: plat.id,
      profilId: profil.id,
      ...(typeof besoin === 'string' && besoin ? { besoin } : {}),
      creePar: auteur,
      statut: 'ouverte',
    },
  };
}

// ——— Demandes à traiter (gestionnaire) ———

/**
 * Vrai si la demande est ouverte, vise un plat actif de `plats` et attend encore quelque chose : recette → plat sans
 * ingrédients ; version → profil présent dans `profils`, qui a des règles, et versionADemander vrai. Le plat et le
 * profil se lisent dans l'identifiant (celui que la clôture reconstruit) ; identifiant illisible : faux.
 */
export function demandeUtile(demande, { plats = [], profils = [], evaluer = evaluerParDefaut } = {}) {
  return trouver(demande, index(plats), index(profils), evaluer) !== null;
}

/** Objets par identifiant (le premier l'emporte). */
function index(valeurs) {
  const parIdentifiant = new Map();
  for (const valeur of liste(valeurs)) {
    if (estObjet(valeur) && typeof valeur.id === 'string' && !parIdentifiant.has(valeur.id)) parIdentifiant.set(valeur.id, valeur);
  }
  return parIdentifiant;
}

/** { lu, plat, profil } d'une demande utile ; null sinon. */
function trouver(demande, plats, profils, evaluation) {
  if (!estObjet(demande) || demande.statut !== 'ouverte') return null;
  const lu = lireIdDemande(demande.id);
  if (!lu) return null;
  const plat = plats.get(lu.platId);
  const profil = lu.profilId === null ? null : profils.get(lu.profilId);
  if (!plat || profil === undefined) return null;
  const examen = examiner(plat, profil, [demande], evaluation);
  return examen?.ouverte === demande ? { lu, plat, profil } : null;
}

/**
 * Demandes utiles (demandeUtile), chacune une fois, la plus ancienne d'abord (date en attente ou inconnue : en
 * dernier), puis par nom du plat, puis par identifiant.
 * → [{ demande, type: 'recette' | 'variante', plat, profil | null, date: Date | null }]
 */
export function demandesATraiter(demandes, { plats = [], profils = [], evaluer = evaluerParDefaut } = {}) {
  const platsParId = index(plats);
  const profilsParId = index(profils);
  const vues = new Set();
  const elements = [];
  for (const demande of liste(demandes)) {
    const trouve = trouver(demande, platsParId, profilsParId, evaluer);
    if (!trouve || vues.has(demande.id)) continue;
    vues.add(demande.id);
    elements.push({ demande, type: trouve.lu.type, plat: trouve.plat, profil: trouve.profil, date: dateDemande(demande).date });
  }
  return elements.sort((a, b) => {
    const ta = a.date?.getTime() ?? null;
    const tb = b.date?.getTime() ?? null;
    if (ta !== tb) {
      if (ta === null) return 1;
      if (tb === null) return -1;
      return ta - tb;
    }
    return comparerNoms(reduire(a.plat.nom), reduire(b.plat.nom)) || parId(a.demande.id, b.demande.id);
  });
}

/**
 * Demandes à traiter rangées pour l'écran Demandes : { recettes: [élément], versions: [{ profil, elements }] }, dans
 * l'ordre de `aTraiter` à l'intérieur de chaque groupe ; les profils dans l'ordre d'affichage (profils.js ›
 * trierProfils).
 */
export function grouperDemandes(aTraiter) {
  const recettes = [];
  const parProfil = new Map();
  for (const element of liste(aTraiter)) {
    if (!estObjet(element)) continue;
    if (element.type === 'recette') {
      recettes.push(element);
    } else if (estObjet(element.profil) && typeof element.profil.id === 'string') {
      if (!parProfil.has(element.profil.id)) parProfil.set(element.profil.id, { profil: element.profil, elements: [] });
      parProfil.get(element.profil.id).elements.push(element);
    }
  }
  const ordre = trierProfils([...parProfil.values()].map((groupe) => groupe.profil));
  return { recettes, versions: ordre.map((profil) => parProfil.get(profil.id)) };
}

// ——— Phrase « Demandée… » ———

const memeJour = (a, b) => a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();

/** « vous » ou le prénom du profil qui porte l'adresse `creePar` ; '' sinon. Jamais une adresse. */
function auteurDe(demande, profils, moi) {
  const par = normaliserEmail(demande?.creePar);
  if (!par) return '';
  const monAdresse = normaliserEmail(typeof moi === 'string' ? moi : moi?.email);
  if (monAdresse && monAdresse === par) return 'vous';
  return reduire(profilDeLEmail(liste(profils).filter(estObjet), par)?.nom);
}

/**
 * Une seule forme de phrase, partout (fiche des deux vues, carte ⏳, écran Demandes), point final compris ; l'écran
 * ajoute « 📬 » (aria-hidden) devant et sa suite éventuelle derrière.
 * - date connue, du jour (date locale de `maintenant`) : « Demandée aujourd’hui. » ;
 * - date connue, autre jour : « Demandée le 9 octobre. » (année ajoutée si besoin, corbeille.js › jourLisible) ;
 * - en attente du serveur (`creeLe === null`), en ligne : « Demandée aujourd’hui. » (date du téléphone : la phrase ne
 *   change plus quand l'horodatage revient) ;
 * - en attente du serveur, `horsLigne` vrai : « Demandée. La demande partira au retour du réseau. » ;
 * - date inconnue (champ absent) : « Demandée. », même hors ligne (la demande est déjà sur le serveur).
 * Avec l'auteur (`avecAuteur`, gestionnaire) : « Demandée par Adulte B le 9 octobre. », « Demandée par vous
 * aujourd’hui. » (`moi` : adresse ou profil de la personne connectée) ; auteur inconnu : sans « par ». L'auteur est le
 * prénom du profil qui porte l'adresse `creePar` (comparée normalisée) ; jamais une adresse.
 */
export function texteDemandee(demande, {
  profils = [], moi = null, avecAuteur = false, horsLigne = false, maintenant = new Date(),
} = {}) {
  const aujourdhui = versDate(maintenant) ?? new Date();
  const { date, enAttente } = dateDemande(demande);
  let quand = '';
  if (date) quand = memeJour(date, aujourdhui) ? ' aujourd’hui' : ` le ${jourLisible(date, aujourdhui)}`;
  else if (enAttente && !horsLigne) quand = ' aujourd’hui';
  const auteur = avecAuteur ? auteurDe(demande, profils, moi) : '';
  const suite = enAttente && horsLigne ? ' La demande partira au retour du réseau.' : '';
  return `Demandée${auteur ? ` par ${auteur}` : ''}${quand}.${suite}`;
}
