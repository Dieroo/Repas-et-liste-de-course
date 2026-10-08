// Sauvegarde et restauration (CLAUDE.md §8) : le fichier `paquet@1` complet (plats, notes, profils), sa lecture,
// sa validation, et les écritures d'une restauration additive. Logique pure : ni DOM ni Firebase.
// Règle de la restauration : ce qui est dans l'app reste ; ce qui manque revient ; seules les recettes cochées
// reprennent leur version sauvegardée.
import { slug } from './slug.js';
import { statutDe } from './plats.js';
import { normaliserEmail } from './roles.js';
import { preparerProfil, trierProfils } from './profils.js';
import { cheminNote, noteValide } from './notes.js';
import { egalProfonde } from './edition.js';
import { stylesAttendus, validerRegles } from './regles.js';
import { styleDe } from './compatibilite.js';
import { STYLES } from './vocabulaire.js';
import {
  CHAMPS_PLAT, FORMAT, code, demandesSatisfaites, estSauvegarde, extrairePaquet, fusionnerVariantes, recetteValidee,
  validerPaquet,
} from './paquet.js';

export const FICHIER_MAX = 5_000_000; // caractères (le collage garde 500 000)
export const PLATS_MAX_SAUVEGARDE = 2000;
export const ECRITURES_PAR_LOT = 450; // sous les 500 écritures d'un lot Firestore

const ID = /^[a-z0-9-]+$/;
const JOUR = /^(\d{4})-(\d{2})-(\d{2})$/;
const JOUR_MS = 86_400_000;

// Défauts d'un plat ajouté par son nom (⏳), écrits dans le fichier comme le prévoit le §8.
const DEFAUTS_PLAT = { type: 'plat', recurrence: 'aucune', statutRecette: 'attente' };
// Champs ajoutés à la recette dans le fichier.
const CHAMPS_SUIVI = ['notes', 'derniereFois', 'modifieeLe', 'modifieePar'];
// Champs d'un profil repris à la restauration (ceux qu'écrit coeur/profils.js › preparerProfil, et ses règles, T2a).
const CHAMPS_PROFIL = ['id', 'nom', 'email', 'ordre', 'coefPortion', 'regles'];
// Champs d'un profil jamais exportés (liste fermée ; vide en T1d).
const EXCLUSIONS_PROFIL = [];
// Clés de premier niveau comprises par la restauration.
const CLES_SAUVEGARDE = ['format', 'sauvegardeLe', 'plats', 'profils'];

const estObjet = (valeur) => Boolean(valeur) && typeof valeur === 'object' && !Array.isArray(valeur);
const reduire = (valeur) => (typeof valeur === 'string' ? valeur.replace(/\s+/g, ' ').trim() : '');
const parId = (a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0);
const deux = (n) => String(n).padStart(2, '0');
const guillemets = (nom) => `«\u00A0${nom}\u00A0»`;
const marqueurHorodatage = () => ({ horodatageServeur: true });

// ——— Dates ———

/** Vrai pour un objet de forme horodatage Firestore sans méthode ({ seconds, nanoseconds }). */
function estSecondes(valeur) {
  return estObjet(valeur) && typeof valeur.seconds === 'number' && Number.isFinite(valeur.seconds)
    && Object.keys(valeur).every((cle) => cle === 'seconds' || cle === 'nanoseconds');
}

/** Date tirée d'une Date, d'un horodatage Firestore (`toDate()` ou `{ seconds }`) ou d'un texte ISO ; null sinon. */
function versDate(valeur) {
  let date = null;
  if (valeur instanceof Date) date = valeur;
  else if (estObjet(valeur) && typeof valeur.toDate === 'function') {
    try {
      date = valeur.toDate();
    } catch {
      date = null;
    }
  } else if (estSecondes(valeur)) {
    const nano = typeof valeur.nanoseconds === 'number' && Number.isFinite(valeur.nanoseconds) ? valeur.nanoseconds : 0;
    date = new Date(valeur.seconds * 1000 + Math.floor(nano / 1e6));
  } else if (typeof valeur === 'string' && valeur.trim()) {
    date = new Date(valeur.trim());
  }
  return date instanceof Date && !Number.isNaN(date.getTime()) ? date : null;
}

/** Date de la dernière sauvegarde (`reglages/foyer.derniereSauvegarde` : horodatage, Date ou absente) ; null sinon. */
export function dateDeSauvegarde(valeur) {
  return versDate(valeur);
}

/**
 * Jours de calendrier (date du téléphone) écoulés depuis `date` : 0 le jour même, 1 le lendemain ; jamais négatif.
 * Infinity sans date lisible (le rappel de sauvegarde s'affiche alors).
 */
export function joursDepuis(date, maintenant = new Date()) {
  const depuis = versDate(date);
  const jour = versDate(maintenant) ?? new Date();
  if (!depuis) return Infinity;
  const minuit = (d) => new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
  return Math.max(0, Math.round((minuit(jour) - minuit(depuis)) / JOUR_MS));
}

/** Vrai pour une date « AAAA-MM-JJ » qui existe au calendrier. */
function jourValide(valeur) {
  const morceaux = typeof valeur === 'string' ? JOUR.exec(valeur) : null;
  if (!morceaux) return false;
  const [annee, mois, jour] = morceaux.slice(1).map(Number);
  const date = new Date(Date.UTC(annee, mois - 1, jour));
  return date.getUTCFullYear() === annee && date.getUTCMonth() === mois - 1 && date.getUTCDate() === jour;
}

/** « AAAA-MM-JJ » à la date locale. */
function jourLocal(date) {
  return `${date.getFullYear()}-${deux(date.getMonth() + 1)}-${deux(date.getDate())}`;
}

/** `derniereFois` comparable : la date « AAAA-MM-JJ » telle quelle, un horodatage à sa date locale ; null sinon. */
function jourDe(valeur) {
  if (jourValide(valeur)) return valeur;
  if (typeof valeur === 'string') return null;
  const date = versDate(valeur);
  return date ? jourLocal(date) : null;
}

// ——— Valeurs du fichier ———

/**
 * Copie sérialisable sans perte : horodatages et dates en ISO, aucune valeur undefined ni fonction, objets autres
 * que des tables (références, etc.) écartés. undefined si rien ne reste.
 */
function serialisable(valeur) {
  if (valeur === null) return null;
  if (valeur instanceof Date || (estObjet(valeur) && typeof valeur.toDate === 'function') || estSecondes(valeur)) {
    return versDate(valeur)?.toISOString();
  }
  if (Array.isArray(valeur)) return valeur.map((v) => serialisable(v) ?? null);
  if (typeof valeur === 'number') return Number.isFinite(valeur) ? valeur : undefined;
  if (typeof valeur === 'string' || typeof valeur === 'boolean') return valeur;
  if (!estObjet(valeur)) return undefined;
  const prototype = Object.getPrototypeOf(valeur);
  if (prototype !== Object.prototype && prototype !== null) return undefined;
  const copie = {};
  for (const [cle, sous] of Object.entries(valeur)) {
    const propre = serialisable(sous);
    if (propre !== undefined) copie[cle] = propre;
  }
  return copie;
}

/** Notes valides d'un plat, clés triées (identifiants stricts, notes de 0 à 5). */
function notesValides(notes) {
  if (!estObjet(notes)) return {};
  const propres = {};
  for (const cle of Object.keys(notes).sort()) if (ID.test(cle) && noteValide(notes[cle])) propres[cle] = notes[cle];
  return propres;
}

/**
 * Plat tel qu'il est écrit dans le fichier : champs du §8 dans leur ordre, défauts d'un ⏳, notes et suivi. Les
 * versions partent telles qu'elles sont sur la fiche, `style` et `frigoJours` compris (une version d'avant les styles
 * reste sans style : il se déduit à la lecture).
 */
function platPourSauvegarde(plat) {
  const sortie = {};
  for (const champ of CHAMPS_PLAT) {
    const valeur = champ === 'id' ? plat.id : serialisable(plat[champ]);
    if (valeur !== undefined && valeur !== null) sortie[champ] = valeur;
    else if (DEFAUTS_PLAT[champ]) sortie[champ] = DEFAUTS_PLAT[champ];
  }
  const notes = notesValides(plat.notes);
  if (Object.keys(notes).length) sortie.notes = notes;
  const jour = jourDe(plat.derniereFois);
  if (jour) sortie.derniereFois = jour;
  const modifieeLe = versDate(plat.modifieeLe);
  if (modifieeLe) sortie.modifieeLe = modifieeLe.toISOString();
  if (typeof plat.modifieePar === 'string' && plat.modifieePar) sortie.modifieePar = plat.modifieePar;
  return sortie;
}

/** Profil tel qu'il est écrit dans le fichier : tous ses champs (identifiant en tête), sauf les exclusions. */
function profilPourSauvegarde(profil) {
  const sortie = { id: profil.id };
  for (const [cle, valeur] of Object.entries(profil)) {
    if (cle === 'id' || EXCLUSIONS_PROFIL.includes(cle)) continue;
    const propre = serialisable(valeur);
    if (propre !== undefined) sortie[cle] = propre;
  }
  return sortie;
}

// ——— Créer le fichier ———

/** « repas-courses-sauvegarde-2026-10-06.json » ; copie de précaution : « repas-courses-avant-restauration-2026-10-06-1842.json ». Date locale. */
export function nomFichierSauvegarde(date, { avantRestauration = false } = {}) {
  const quand = versDate(date) ?? new Date();
  const jour = jourLocal(quand);
  return avantRestauration
    ? `repas-courses-avant-restauration-${jour}-${deux(quand.getHours())}${deux(quand.getMinutes())}.json`
    : `repas-courses-sauvegarde-${jour}.json`;
}

/**
 * Fichier de sauvegarde, à partir des plats et des profils de l'app (documents { id, ...champs }).
 * → { nomFichier, texte, resume: { plats, profils, notes }, aCorriger: [{ id, nom }] }
 *   `aCorriger` : plats dont la recette ne pourrait pas être reprise depuis ce fichier (fiche abîmée) ; le reste
 *   du fichier reste restaurable.
 */
export function creerSauvegarde({ plats = [], profils = [] } = {}, { maintenant = new Date() } = {}) {
  const quand = versDate(maintenant) ?? new Date();
  const platsFichier = (Array.isArray(plats) ? plats : [])
    .filter((plat) => estObjet(plat) && typeof plat.id === 'string' && plat.id !== '')
    .map(platPourSauvegarde)
    .sort(parId);
  const profilsFichier = trierProfils((Array.isArray(profils) ? profils : [])
    .filter((profil) => estObjet(profil) && typeof profil.id === 'string' && profil.id !== ''))
    .map(profilPourSauvegarde);
  const fichier = { format: FORMAT, sauvegardeLe: quand.toISOString(), profils: profilsFichier, plats: platsFichier };
  const texte = `${JSON.stringify(fichier, null, 2)}\n`;

  // Relu comme à la restauration : une recette qui ne passerait pas est signalée tout de suite.
  const relu = validerSauvegarde(JSON.parse(texte));
  const reprises = new Map(relu.plats.map((plat) => [plat.id, plat]));
  const aCorriger = platsFichier
    .filter((plat) => !reprises.get(plat.id)?.recette)
    .map((plat) => ({ id: plat.id, nom: reduire(plat.nom) || plat.id }));

  return {
    nomFichier: nomFichierSauvegarde(quand),
    texte,
    resume: {
      plats: platsFichier.length,
      profils: profilsFichier.length,
      notes: platsFichier.reduce((total, plat) => total + Object.keys(plat.notes ?? {}).length, 0),
    },
    aCorriger,
  };
}

// ——— Lire le fichier ———

/**
 * Lit le texte d'un fichier de sauvegarde.
 * → { sauvegarde } ou { erreur } avec erreur ∈ vide, trop_gros, illisible, coupee, recettes (des recettes, pas une
 *   sauvegarde), version (sauvegarde d'un autre format).
 */
export function lireSauvegarde(texte) {
  const brut = String(texte ?? '');
  if (brut.length > FICHIER_MAX) return { erreur: 'trop_gros' };
  const propre = brut.replace(/^\uFEFF/, '');
  if (!propre.trim()) return { erreur: 'vide' };
  let objet;
  try {
    objet = JSON.parse(propre);
  } catch {
    // Texte autour, ou fichier abîmé : la recherche des recettes départage.
    const extrait = extrairePaquet(propre, { max: FICHIER_MAX });
    if (extrait.paquets) {
      if (!estSauvegarde(extrait.paquets)) return { erreur: 'recettes' };
      if (extrait.paquets.length !== 1) return { erreur: 'illisible' };
      objet = extrait.paquets[0];
    } else {
      return { erreur: extrait.erreur === 'coupee' ? 'coupee' : 'illisible' };
    }
  }
  if (!estObjet(objet)) return { erreur: 'illisible' };
  if (!Object.hasOwn(objet, 'sauvegardeLe')) return { erreur: 'format' in objet || 'plats' in objet ? 'recettes' : 'illisible' };
  if (code(objet.format) !== code(FORMAT)) return { erreur: 'version' };
  return { sauvegarde: objet };
}

// ——— Valider le fichier ———

/** Note lue dans le fichier : entier de 0 à 5, « 4 » toléré ; null sinon. */
function noteDuFichier(valeur) {
  if (noteValide(valeur)) return valeur;
  if (typeof valeur === 'string' && /^\s*\d\s*$/.test(valeur) && noteValide(Number(valeur))) return Number(valeur);
  return null;
}

/** Profils du fichier, vérifiés comme dans Réglages (coeur/profils.js › preparerProfil). */
function validerProfils(bruts, erreurs, avertissements) {
  const profils = [];
  const ids = new Set();
  const adresses = new Map();
  for (const brut of bruts) {
    if (!estObjet(brut)) {
      avertissements.push('Un profil illisible a été ignoré.');
      continue;
    }
    const nomAffiche = reduire(brut.nom) || 'sans prénom';
    const id = typeof brut.id === 'string' && ID.test(brut.id) ? brut.id : '';
    const ordreLisible = brut.ordre == null || (typeof brut.ordre === 'number' && Number.isFinite(brut.ordre) && brut.ordre >= 0);
    const emailLisible = brut.email == null || typeof brut.email === 'string';
    const prepare = id && emailLisible
      ? preparerProfil(
        { nom: typeof brut.nom === 'string' ? brut.nom : '', email: brut.email ?? '', coefPortion: brut.coefPortion },
        { profils: [{ id, ordre: brut.ordre ?? 0 }], id },
      )
      : null;
    if (!prepare?.profil || !ordreLisible) {
      avertissements.push(`Le profil ${guillemets(nomAffiche)} est abîmé dans ce fichier\u00A0: il a été ignoré.`);
      continue;
    }
    if (ids.has(id)) {
      erreurs.push(`Le profil ${guillemets(prepare.profil.nom)} apparaît deux fois dans ce fichier.`);
      continue;
    }
    ids.add(id);
    const { nom, coefPortion } = prepare.profil;
    let email = brut.email == null ? undefined : prepare.profil.email;
    if (email && adresses.has(email)) {
      avertissements.push(`${guillemets(nom)} a la même adresse que ${guillemets(adresses.get(email))}\u00A0: il est gardé sans adresse.`);
      email = '';
    } else if (email) {
      adresses.set(email, nom);
    }
    if (Object.keys(brut).some((cle) => !CHAMPS_PROFIL.includes(cle))) {
      avertissements.push(`${guillemets(nom)}\u00A0: des informations non reconnues ont été ignorées.`);
    }
    // Règles : absentes ≠ [] (« Mange de tout », choisi exprès) ; seulement si le fichier en porte une liste.
    let regles;
    if (Array.isArray(brut.regles)) {
      const lues = validerRegles(brut.regles, { nom });
      regles = lues.regles;
      avertissements.push(...lues.avertissements);
    } else if (brut.regles != null) {
      avertissements.push(`${guillemets(nom)}\u00A0: ses règles sont abîmées dans ce fichier, elles ont été ignorées.`);
    }
    profils.push({
      id,
      nom,
      ...(email !== undefined ? { email } : {}),
      ...(brut.ordre != null ? { ordre: brut.ordre } : {}),
      coefPortion,
      ...(regles !== undefined ? { regles } : {}),
    });
  }
  return profils;
}

/**
 * Vérifie une sauvegarde lue par lireSauvegarde. Seules les fautes du fichier entier bloquent (liste des plats
 * illisible, trop de plats, identifiants en double) ; une recette abîmée n'est simplement pas reprise.
 * → { date (Date ou null), plats: [{ id, nom, recette (null si abîmée), notes, derniereFois?, modifieeLe? (Date),
 *     modifieePar? }], profils, erreurs: [texte], avertissements: [texte], valide }
 */
export function validerSauvegarde(sauvegarde) {
  const erreurs = [];
  const avertissements = [];
  const fin = (plats = [], profils = []) => ({
    date: typeof sauvegarde?.sauvegardeLe === 'string' ? versDate(sauvegarde.sauvegardeLe) : null,
    plats,
    profils,
    erreurs,
    avertissements,
    valide: !erreurs.length,
  });
  if (!estObjet(sauvegarde)) {
    erreurs.push('Ce fichier n’est pas une sauvegarde de l’app.');
    return fin();
  }
  if (Object.keys(sauvegarde).some((cle) => !CLES_SAUVEGARDE.includes(cle))) {
    avertissements.push('Une partie du fichier n’est pas encore reprise par l’app\u00A0: elle a été ignorée.');
  }

  // Profils.
  let profils = [];
  if (sauvegarde.profils != null && !Array.isArray(sauvegarde.profils)) erreurs.push('La liste des profils est illisible.');
  else profils = validerProfils(sauvegarde.profils ?? [], erreurs, avertissements);

  // Plats : la liste entière d'abord.
  const bruts = sauvegarde.plats ?? [];
  if (!Array.isArray(bruts)) {
    erreurs.push('La liste des plats est illisible.');
    return fin([], profils);
  }
  if (bruts.length > PLATS_MAX_SAUVEGARDE) {
    erreurs.push('Ce fichier contient trop de plats (2\u00A0000 au plus).');
    return fin([], profils);
  }

  const retenus = [];
  const ids = new Set();
  for (const brut of bruts) {
    const nom = reduire(brut?.nom);
    const id = typeof brut?.id === 'string' && ID.test(brut.id) ? brut.id : '';
    if (!estObjet(brut) || !nom) {
      avertissements.push('Un plat sans nom a été ignoré.');
      continue;
    }
    if (!id) {
      avertissements.push(`${guillemets(nom)} n’a pas d’identifiant lisible\u00A0: il a été ignoré.`);
      continue;
    }
    if (ids.has(id)) {
      erreurs.push(`${guillemets(nom)} apparaît deux fois dans ce fichier.`);
      continue;
    }
    ids.add(id);
    retenus.push({ brut, id, nom });
  }

  // Recettes : même grille que l'ajout de recettes, sans l'erreur « même nom » (la restauration va par identifiant).
  const recettes = validerPaquet([{
    format: FORMAT,
    plats: retenus.map(({ brut }) => Object.fromEntries(Object.entries(brut).filter(([cle]) => !CHAMPS_SUIVI.includes(cle)))),
  }], { platsMax: PLATS_MAX_SAUVEGARDE, doublonsDeNom: false, versionsEnDouble: 'premiere' });

  const plats = retenus.map(({ brut, id, nom }, i) => {
    const valide = recettes.plats[i];
    const recette = valide && !valide.erreurs.length ? valide.donnees : null;
    if (!recette) avertissements.push(`${guillemets(nom)}\u00A0: sa recette est abîmée dans ce fichier, elle ne sera pas reprise.`);
    const plat = { id, nom, recette, notes: {} };

    if (brut.notes != null) {
      let illisibles = 0;
      if (!estObjet(brut.notes)) illisibles = 1;
      else {
        for (const [cle, valeur] of Object.entries(brut.notes)) {
          const note = noteDuFichier(valeur);
          if (ID.test(cle) && note !== null) plat.notes[cle] = note;
          else illisibles += 1;
        }
      }
      if (illisibles === 1) avertissements.push(`${guillemets(nom)}\u00A0: une note illisible a été ignorée.`);
      else if (illisibles > 1) avertissements.push(`${guillemets(nom)}\u00A0: ${illisibles} notes illisibles ont été ignorées.`);
    }
    if (brut.derniereFois != null) {
      if (jourValide(brut.derniereFois)) plat.derniereFois = brut.derniereFois;
      else avertissements.push(`${guillemets(nom)}\u00A0: la date du dernier passage au menu est illisible, elle a été ignorée.`);
    }
    if (brut.modifieeLe != null) {
      const date = typeof brut.modifieeLe === 'string' ? versDate(brut.modifieeLe) : null;
      if (date) plat.modifieeLe = date;
      else avertissements.push(`${guillemets(nom)}\u00A0: la date de modification est illisible, elle a été ignorée.`);
    }
    if (typeof brut.modifieePar === 'string' && brut.modifieePar.trim()) plat.modifieePar = brut.modifieePar.trim();
    return plat;
  });
  return fin(plats, profils);
}

// ——— Préparer la restauration ———

/** Vrai si la fiche a été modifiée à la main (« Modifier »). */
function modifieeALaMain(plat) {
  return Boolean(plat?.modifieePar) || plat?.modifieeLe != null;
}

/** Liste découpée en lots de `taille` au plus. */
function enLots(ecritures, taille) {
  const lots = [];
  for (let i = 0; i < ecritures.length; i += taille) lots.push(ecritures.slice(i, i + taille));
  return lots;
}

/**
 * Écritures d'une restauration, à partir des données lues sur le serveur (`plats`, `profils`, `demandes`) et de la
 * personne connectée (`email`, posé en `majPar`). Ce qui est dans l'app reste ; ce qui manque revient (plats,
 * notes, profils, `derniereFois` plus récente, versions des profils qui n'en ont pas sur la fiche) ; seules les
 * recettes de `recettesAReprendre` (identifiants) reprennent leur version sauvegardée, en bloc, sans toucher aux
 * versions de la fiche. L'écran coche d'avance celles dont `cocheeParDefaut` est vrai (fiche ⏳ dans l'app) et les
 * passe ici. Recettes comparées sans leurs versions. Une demande de version n'est close que si la version convient.
 * `resume.versionsRemises` : [{ pour, nom, nombre }] (versions remises sur des plats présents, par profil).
 * → { resume, recettesDifferentes: [{ id, nom, modifieeLe? (Date), appEnAttente, cocheeParDefaut }],
 *     lots: [[{ collection, id, mode: 'fusion' | 'update', donnees, effacer?, condition, clore? }]], demandesAClore,
 *     avertissements, rien }
 *   `condition` : ce qui doit encore être vrai au moment de l'envoi (voir appliquerConditions) ; `clore` : demandes
 *   satisfaites par cette écriture, closes seulement si elle a lieu.
 *   Dans `donnees`, `majLe` vaut le marqueur { horodatageServeur: true } (donnees.js le traduit) ; `modifieeLe` du
 *   fichier est une Date. `avertissements` : ceux de la validation, puis ceux de la restauration.
 */
export function preparerRestauration(validation, { plats = [], profils = [], demandes = [], email = '' } = {},
  { recettesAReprendre = [] } = {}) {
  const avertissements = [...(validation?.avertissements ?? [])];
  const auteur = normaliserEmail(email);
  const platsApp = (Array.isArray(plats) ? plats : []).filter((p) => estObjet(p) && typeof p.id === 'string');
  const profilsApp = (Array.isArray(profils) ? profils : []).filter((p) => estObjet(p) && typeof p.id === 'string');
  const parIdApp = new Map(platsApp.map((p) => [p.id, p]));
  const ouvertes = new Set((Array.isArray(demandes) ? demandes : [])
    .filter((d) => d?.statut === 'ouverte' && typeof d.id === 'string').map((d) => d.id));
  const platsFichier = Array.isArray(validation?.plats) ? validation.plats : [];
  const profilsFichier = Array.isArray(validation?.profils) ? validation.profils : [];
  const reprises = new Set(Array.isArray(recettesAReprendre) ? recettesAReprendre : []);
  /** Un autre plat de l'app (identifiant différent) porte-t-il ce nom ? */
  const nomPrisPar = (nom, id) => {
    const cle = slug(nom);
    return cle ? platsApp.find((p) => p.id !== id && slug(p.nom) === cle) ?? null : null;
  };

  const resume = {
    date: validation?.date ?? null,
    platsRemis: [],
    notesRemises: 0,
    profilsRemis: [],
    datesRemises: 0,
    recettesReprises: 0,
    dontModifiees: 0,
    identiques: 0,
    ajoutesDepuis: 0,
    nonRemis: [],
    reglesRemises: [],
    versionsRemises: [],
  };
  const recettesDifferentes = [];
  const ecrituresProfils = [];
  const ecrituresPlats = [];
  const demandesAClore = [];
  const clore = (ids) => {
    for (const id of ids) if (!demandesAClore.includes(id)) demandesAClore.push(id);
  };

  // Profils : un profil absent revient (avec ses règles) ; un profil présent n'est jamais modifié, sauf ses règles
  // s'il n'en a jamais eu (champ absent : jamais réglé ; [] : « Mange de tout », choisi exprès, jamais remplacé).
  const idsProfilsApp = new Set(profilsApp.map((p) => p.id));
  const adressesPrises = new Set(profilsApp.map((p) => normaliserEmail(p.email)).filter(Boolean));
  for (const profil of profilsFichier) {
    if (idsProfilsApp.has(profil.id)) {
      const present = profilsApp.find((p) => p.id === profil.id);
      if (Array.isArray(profil.regles) && !Array.isArray(present.regles)) {
        ecrituresProfils.push({
          collection: 'profils', id: profil.id, mode: 'update', donnees: { regles: profil.regles },
          condition: { reglesAbsentes: true },
        });
        resume.reglesRemises.push(reduire(present.nom) || profil.nom);
      }
      continue;
    }
    const donnees = { ...profil };
    const adresse = normaliserEmail(donnees.email);
    if (adresse && adressesPrises.has(adresse)) {
      donnees.email = '';
      avertissements.push(`${guillemets(profil.nom)} est remis sans adresse\u00A0: un autre profil porte déjà la sienne.`);
    } else if (adresse) {
      adressesPrises.add(adresse);
    }
    ecrituresProfils.push({ collection: 'profils', id: profil.id, mode: 'fusion', donnees, condition: { absent: true } });
    resume.profilsRemis.push(profil.nom);
  }
  const profilsConnus = new Set([...idsProfilsApp, ...profilsFichier.map((p) => p.id)]);
  // Profils qui jugent les versions : ceux de l'app, puis ceux que la restauration remet.
  const profilsJuges = [...profilsApp, ...profilsFichier.filter((p) => !idsProfilsApp.has(p.id))];
  const versionsRemises = new Map();

  /** Notes du fichier pour des profils connus ; les autres sont ignorées, avec un avertissement. */
  const notesConnues = (plat) => {
    const connues = {};
    let inconnues = 0;
    for (const [profilId, note] of Object.entries(plat.notes ?? {})) {
      if (profilsConnus.has(profilId) && cheminNote(profilId) && noteValide(note)) connues[profilId] = note;
      else inconnues += 1;
    }
    if (inconnues === 1) avertissements.push(`${guillemets(plat.nom)}\u00A0: la note d’un profil qui n’existe plus a été ignorée.`);
    else if (inconnues > 1) avertissements.push(`${guillemets(plat.nom)}\u00A0: ${inconnues} notes de profils qui n’existent plus ont été ignorées.`);
    return connues;
  };

  const idsFichier = new Set();
  for (const plat of platsFichier) {
    idsFichier.add(plat.id);
    const existant = parIdApp.get(plat.id);

    // Plat absent de l'app : remis entier, sauf si un autre plat porte déjà ce nom.
    if (!existant) {
      if (nomPrisPar(plat.nom, plat.id)) {
        avertissements.push(`${guillemets(plat.nom)} n’est pas remis\u00A0: un autre plat porte déjà ce nom.`);
        resume.nonRemis.push(plat.nom);
        continue;
      }
      const notes = notesConnues(plat);
      const donnees = { ...(plat.recette ?? {}), id: plat.id, nom: plat.recette?.nom ?? plat.nom };
      if (Object.keys(notes).length) donnees.notes = notes;
      if (plat.derniereFois) donnees.derniereFois = plat.derniereFois;
      if (plat.modifieeLe) donnees.modifieeLe = plat.modifieeLe;
      if (plat.modifieePar) donnees.modifieePar = plat.modifieePar;
      donnees.majPar = auteur;
      donnees.majLe = marqueurHorodatage();
      const satisfaites = plat.recette
        ? demandesSatisfaites(plat.id, plat.recette, ouvertes, { plat: donnees, profils: profilsJuges }) : [];
      ecrituresPlats.push({
        collection: 'plats', id: plat.id, mode: 'fusion', donnees, condition: { absent: true },
        ...(satisfaites.length ? { clore: satisfaites } : {}),
      });
      resume.platsRemis.push(donnees.nom);
      resume.notesRemises += Object.keys(notes).length;
      if (plat.derniereFois) resume.datesRemises += 1;
      clore(satisfaites);
      continue;
    }

    // Plat présent : une seule écriture, seulement si quelque chose manque.
    const donnees = {};
    const effacer = [];
    const condition = {};
    let satisfaites = [];
    for (const [profilId, note] of Object.entries(notesConnues(plat))) {
      // Une note présente dans l'app est plus récente que la sauvegarde : jamais remplacée.
      const actuelle = estObjet(existant.notes) && Object.hasOwn(existant.notes, profilId) ? existant.notes[profilId] : null;
      if (noteValide(actuelle)) continue;
      donnees[cheminNote(profilId)] = note;
      (condition.notesAbsentes ??= []).push(profilId);
      resume.notesRemises += 1;
    }
    if (plat.derniereFois) {
      const actuelle = jourDe(existant.derniereFois);
      if (!actuelle || plat.derniereFois > actuelle) {
        donnees.derniereFois = plat.derniereFois;
        condition.derniereFois = true;
        resume.datesRemises += 1;
      }
    }

    // Recette, traitée comme un bloc, comparée sans ses versions (rendues à part, ci-dessous).
    const recette = plat.recette ? recetteValidee(plat.recette) : null;
    let reprise = false;
    if (recette && statutDe(recette) !== 'attente') {
      const actuelle = recetteValidee(existant);
      if (actuelle && egalProfonde(sansVersions(actuelle), sansVersions(recette))) {
        resume.identiques += 1;
      } else {
        const appEnAttente = statutDe(existant) === 'attente';
        const modifieeLe = versDate(existant.modifieeLe);
        recettesDifferentes.push({
          id: plat.id,
          nom: reduire(existant.nom) || plat.nom,
          ...(modifieeLe ? { modifieeLe } : {}),
          appEnAttente,
          cocheeParDefaut: appEnAttente,
        });
        if (reprises.has(plat.id)) {
          reprise = true;
          for (const champ of CHAMPS_PLAT) {
            // Les versions de la fiche restent : celles du fichier qui manquent reviennent à part.
            if (champ === 'id' || champ === 'variantes') continue;
            if (champ === 'nom') {
              const autre = nomPrisPar(recette.nom, plat.id);
              if (autre) avertissements.push(`${guillemets(existant.nom ?? plat.nom)} garde son nom actuel\u00A0: un autre plat porte déjà celui du fichier.`);
              else donnees.nom = recette.nom;
            } else if (recette[champ] !== undefined) {
              donnees[champ] = recette[champ];
            } else if (existant[champ] !== undefined) {
              // Jamais de recette hybride (étapes ou variantes posées sur d'autres ingrédients).
              effacer.push(champ);
            }
          }
          for (const champ of ['modifieeLe', 'modifieePar']) {
            if (plat[champ] !== undefined) donnees[champ] = plat[champ];
            else if (existant[champ] !== undefined) effacer.push(champ);
          }
          donnees.majPar = auteur;
          donnees.majLe = marqueurHorodatage();
          // La recette n'est remplacée que si la fiche est encore celle de l'aperçu (vérifié à l'envoi).
          condition.recette = empreinteRecette(existant);
          resume.recettesReprises += 1;
          if (modifieeALaMain(existant)) resume.dontModifiees += 1;
        }
      }
    } else if (recette) {
      // Plat ⏳ dans le fichier : la recette de l'app reste (inchangée).
      resume.identiques += 1;
    }

    // Versions du fichier qui manquent sur la fiche : toutes celles d'un profil qui n'en a aucune (une par style, avec
    // leurs jours au frigo) ; pour un profil qui en a déjà, celle d'un style écrit qu'il attend pour ce plat
    // (regles.js › stylesAttendus) et dont la fiche n'a aucune version (compatibilite.js › styleDe) : une version de
    // chaque style qui manque revient. Une version de la fiche n'est jamais remplacée ; une version sans style ne
    // revient que pour un profil qui n'en a aucune (elle doit être la seule de son profil). Sur un plat ⏳ dont la
    // recette n'est pas reprise, une version n'aurait rien à adapter : elle attend.
    const surFiche = (Array.isArray(existant.variantes) ? existant.variantes : []).filter(estObjet);
    const avecRecette = reprise || (Array.isArray(existant.ingredients) && existant.ingredients.length > 0);
    const ficheJugee = { ...existant, ...(reprise ? recette : {}) };
    const absentes = [];
    const profilsSansVersion = []; // conditions revues à l'envoi (appliquerConditions)
    const stylesAbsents = [];
    for (const variante of (avecRecette && Array.isArray(recette?.variantes) ? recette.variantes : []).filter(estObjet)) {
      const siennes = surFiche.filter((v) => v.pour === variante.pour);
      const style = STYLES.includes(variante.style) ? variante.style : null;
      if (!siennes.length) {
        absentes.push(variante);
        // Un profil peut revenir avec plusieurs versions (une par style) : une fois dans la condition.
        if (!profilsSansVersion.includes(variante.pour)) profilsSansVersion.push(variante.pour);
      } else if (style && !siennes.some((v) => styleDe(v) === style)
        && stylesAttendus(profilsJuges.find((p) => p.id === variante.pour), ficheJugee).includes(style)) {
        absentes.push(variante);
        stylesAbsents.push({ pour: variante.pour, style });
      }
    }
    if (absentes.length) {
      donnees.variantes = fusionnerVariantes(existant.variantes, absentes);
      if (profilsSansVersion.length) condition.variantesAbsentes = profilsSansVersion;
      if (stylesAbsents.length) condition.stylesAbsents = stylesAbsents;
      for (const { pour } of absentes) versionsRemises.set(pour, (versionsRemises.get(pour) ?? 0) + 1);
    }
    if (reprise || absentes.length) {
      const fiche = { ...existant, ...(reprise ? recette : {}), id: plat.id, variantes: donnees.variantes ?? existant.variantes };
      // Recette reprise : toute version de la fiche qui lui convient satisfait sa demande ; sinon, seules les versions
      // remises.
      satisfaites = demandesSatisfaites(plat.id, reprise
        ? { ingredients: recette.ingredients, variantes: fiche.variantes }
        : { variantes: absentes }, ouvertes, { plat: fiche, profils: profilsJuges });
      clore(satisfaites);
    }

    if (Object.keys(donnees).length || effacer.length) {
      ecrituresPlats.push({
        collection: 'plats', id: plat.id, mode: 'update', donnees, condition,
        ...(effacer.length ? { effacer } : {}),
        ...(satisfaites.length ? { clore: satisfaites } : {}),
      });
    }
  }
  resume.ajoutesDepuis = platsApp.filter((p) => !idsFichier.has(p.id)).length;
  resume.versionsRemises = trierProfils([...versionsRemises.keys()].map((pour) => {
    const profil = profilsJuges.find((p) => p.id === pour);
    return { id: pour, ordre: profil?.ordre, nom: reduire(profil?.nom) || pour };
  })).map(({ id, nom }) => ({ pour: id, nom, nombre: versionsRemises.get(id) }));

  const lots = enLots([...ecrituresProfils, ...ecrituresPlats], ECRITURES_PAR_LOT);
  return { resume, recettesDifferentes, lots, demandesAClore, avertissements, rien: lots.length === 0 };
}

/**
 * Texte stable des écritures prévues et de l'aperçu : deux préparations faites sur les mêmes données donnent le
 * même texte ; un changement arrivé entre-temps sur l'autre téléphone le change.
 */
export function empreinteRestauration(preparation) {
  return JSON.stringify({
    lots: preparation?.lots ?? [],
    demandesAClore: preparation?.demandesAClore ?? [],
    recettesDifferentes: preparation?.recettesDifferentes ?? [],
    resume: preparation?.resume ?? null,
  });
}

/** Texte stable d'une valeur (clés triées à toute profondeur), pour comparer deux lectures d'un même document. */
function texteStable(valeur) {
  if (Array.isArray(valeur)) return `[${valeur.map(texteStable).join(',')}]`;
  if (valeur instanceof Date) return JSON.stringify(valeur.toISOString());
  if (estObjet(valeur)) {
    return `{${Object.keys(valeur).sort().map((cle) => `${JSON.stringify(cle)}:${texteStable(valeur[cle])}`).join(',')}}`;
  }
  return JSON.stringify(valeur ?? null);
}

/** Recette sans ses versions (elles se comparent et se restaurent à part). */
function sansVersions(recette) {
  if (!estObjet(recette)) return recette;
  const { variantes: _v, ...reste } = recette;
  return reste;
}

/**
 * Empreinte de la recette actuelle d'une fiche (avec sa marque « modifiée à la main »), sans ses versions : une
 * version ajoutée entre-temps ne change ni la comparaison ni la reprise d'une recette cochée.
 */
function empreinteRecette(plat) {
  return texteStable({
    recette: sansVersions(recetteValidee(plat)),
    modifieeLe: versDate(plat?.modifieeLe)?.toISOString() ?? null,
    modifieePar: plat?.modifieePar ?? null,
  });
}

/**
 * Écriture de restauration revue au moment de l'envoi, contre le document lu à cet instant (`actuel` : ses champs,
 * ou null s'il n'existe pas). Rien de ce qui a changé entre-temps sur l'autre téléphone n'est écrasé :
 * - plat ou profil à remettre : seulement s'il manque encore ;
 * - note : seulement si le profil n'a toujours pas de note ;
 * - `derniereFois` : seulement si elle reste plus récente ;
 * - recette cochée : seulement si la fiche est encore celle de l'aperçu ;
 * - règles d'un profil (`reglesAbsentes`) : seulement s'il n'en a toujours aucune (une liste, même vide, reste) ;
 * - versions : seulement celles dont le profil n'a toujours aucune version sur la fiche (`variantesAbsentes` : [pour]),
 *   ou aucune de ce style (`stylesAbsents` : [{ pour, style }], compatibilite.js › styleDe), ajoutées à la fin des
 *   versions lues (celles de la fiche gagnent).
 * → l'écriture à faire (même forme, `clore` gardé seulement pour ce qui est écrit), ou null s'il ne reste rien.
 */
export function appliquerConditions(ecriture, actuel) {
  const condition = ecriture?.condition ?? {};
  const existe = estObjet(actuel);
  if (condition.absent) return existe ? null : ecriture;
  if (ecriture.mode !== 'update') return ecriture;
  if (!existe) return null; // plat supprimé entre-temps : jamais recréé à moitié
  if (condition.reglesAbsentes && Array.isArray(actuel.regles)) return null;
  const donnees = { ...ecriture.donnees };
  let effacer = [...(ecriture.effacer ?? [])];
  let clore = ecriture.clore ?? [];
  for (const profilId of condition.notesAbsentes ?? []) {
    const note = estObjet(actuel.notes) && Object.hasOwn(actuel.notes, profilId) ? actuel.notes[profilId] : null;
    if (noteValide(note)) delete donnees[cheminNote(profilId)];
  }
  if (condition.derniereFois) {
    const actuelle = jourDe(actuel.derniereFois);
    if (actuelle && !(donnees.derniereFois > actuelle)) delete donnees.derniereFois;
  }
  let ajoutees = null;
  if (condition.variantesAbsentes || condition.stylesAbsents) {
    const lues = (Array.isArray(actuel.variantes) ? actuel.variantes : []).filter(estObjet);
    // Ce qui manque encore : le profil n'a toujours aucune version, ou aucune de ce style.
    const encore = [
      ...(condition.variantesAbsentes ?? []).map((pour) => ({ pour })),
      ...(condition.stylesAbsents ?? []),
    ].filter((m) => estObjet(m) && !lues.some((v) => v.pour === m.pour && (!m.style || styleDe(v) === m.style)));
    // Versions du fichier dans l'écriture prévue : toutes celles d'un profil qui n'en avait aucune, ou celle du style.
    const fichier = (Array.isArray(ecriture.donnees?.variantes) ? ecriture.donnees.variantes : [])
      .filter((v) => estObjet(v) && encore.some((m) => v.pour === m.pour && (!m.style || styleDe(v) === m.style)));
    ajoutees = new Set(fichier.map((v) => v.pour));
    if (fichier.length) donnees.variantes = fusionnerVariantes(actuel.variantes, fichier);
    else delete donnees.variantes;
  }
  let recetteEcrite = true;
  if (condition.recette !== undefined && empreinteRecette(actuel) !== condition.recette) {
    // La fiche a changé depuis l'aperçu : seules les notes, la date et les versions manquantes restent.
    for (const cle of Object.keys(donnees)) {
      if (!cle.startsWith('notes.') && cle !== 'derniereFois' && cle !== 'variantes') delete donnees[cle];
    }
    effacer = [];
    recetteEcrite = false;
  }
  // Demandes : celles de la recette reprise si elle est écrite ; celles d'une version remise si elle l'est.
  const reprise = condition.recette !== undefined && recetteEcrite;
  const recetteDuPlat = `${ecriture.id}__recette`;
  clore = clore.filter((demande) => reprise
    || (demande !== recetteDuPlat && Boolean(ajoutees?.has(demande.slice(`${ecriture.id}__`.length)))));
  if (!Object.keys(donnees).length && !effacer.length) return null;
  const { effacer: _e, clore: _c, ...reste } = ecriture;
  return { ...reste, donnees, ...(effacer.length ? { effacer } : {}), ...(clore.length ? { clore } : {}) };
}
