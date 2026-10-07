// Notes des plats (0 à 5, par profil), file de l'écran Découvrir et textes des notes. Logique pure : ni DOM ni
// Firebase. Une note absente ou abîmée vaut « non noté » ; 0 est une vraie note (« Jamais »).
import { statutDe, typeDe } from './plats.js';
import { estEnfant, trierProfils } from './profils.js';
import { normaliserEmail } from './roles.js';

export const NOTE_MAX = 5;
export const NOTE_PAR_DEFAUT = 3; // non noté = « Pourquoi pas » (CLAUDE.md §9)
export const LIBELLES_NOTE = ['Jamais', 'Pas trop', 'Bof', 'Pourquoi pas', 'J’aime bien', 'J’adore']; // index = note
export const TEXTE_NON_NOTE = 'Pas encore noté · compte comme Pourquoi pas';
export const GESTES = [
  { note: 0, emoji: '👎', libelle: 'Jamais', sortie: 'gauche' },
  { note: 3, emoji: '👍', libelle: 'Pourquoi pas', sortie: 'haut' },
  { note: 5, emoji: '❤️', libelle: 'J’adore', sortie: 'droite' },
];

// Ordre des types dans Découvrir ; un type inconnu compte comme un plat, les préparations n'y figurent pas.
const ORDRE_TYPES = ['plat', 'dessert', 'apero', 'accompagnement'];
const ID_VALIDE = /^[a-z0-9-]+$/;

const estObjet = (valeur) => Boolean(valeur) && typeof valeur === 'object' && !Array.isArray(valeur);
const reduire = (texte) => String(texte ?? '').replace(/\s+/g, ' ').trim();
// Ordre des identifiants indépendant de la langue du téléphone.
const parId = (a, b) => (a < b ? -1 : a > b ? 1 : 0);

// ——— Lecture et écriture d'une note ———

/** Vrai pour une note : entier de 0 à 5 (0 compris ; '4', 2.5, 6, -1 et null refusés). */
export function noteValide(valeur) {
  return Number.isInteger(valeur) && valeur >= 0 && valeur <= NOTE_MAX;
}

/** Note du plat pour ce profil, de 0 à 5 ; null si elle est absente ou abîmée. */
export function noteDe(plat, profilId) {
  const notes = plat?.notes;
  if (!estObjet(notes) || typeof profilId !== 'string' || !Object.hasOwn(notes, profilId)) return null;
  return noteValide(notes[profilId]) ? notes[profilId] : null;
}

/** Vrai dès qu'une note valide existe, 3 compris : « noté » reste distinct de « Pourquoi pas » par défaut. */
export function estNote(plat, profilId) {
  return noteDe(plat, profilId) !== null;
}

/** Note retenue pour le score : la note (0 reste 0), ou 3 si elle est absente ou abîmée. */
export function noteRetenue(plat, profilId) {
  return noteDe(plat, profilId) ?? NOTE_PAR_DEFAUT;
}

/** Vrai si le profil a noté le plat « Jamais » : il ne lui sera plus proposé. */
export function jamaisPropose(plat, profilId) {
  return noteDe(plat, profilId) === 0;
}

/** « J’aime bien » ; « Pas encore noté · compte comme Pourquoi pas » sans note. */
export function libelleNote(note) {
  return noteValide(note) ? LIBELLES_NOTE[note] : TEXTE_NON_NOTE;
}

/**
 * « de » devant un prénom, élidé devant une voyelle (accentuée ou non, Œ, Æ), un h, ou un y suivi d'une consonne
 * (« d’Yves », mais « de Yann ») : « d’Emma », « d’Hélène », « de Paul ». Le prénom est repris tel quel, sans les
 * espaces autour.
 */
export function deNom(nom) {
  const propre = String(nom ?? '').trim();
  const debut = propre.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
  const elision = /^(?:[aeiouhœæ]|y[^aeiouy])/.test(debut);
  return elision ? `d’${propre}` : `de ${propre}`;
}

/** Chemin écrit pour une note : « notes.<id> » ; null si l'identifiant n'est pas strictement un slug. */
export function cheminNote(profilId) {
  return typeof profilId === 'string' && ID_VALIDE.test(profilId) ? `notes.${profilId}` : null;
}

/**
 * Copie du plat avec la note de ce profil, pour l'affichage immédiat ; l'original reste intact. `note` null (ou
 * toute valeur qui n'est pas une note) retire la clé. Identifiant refusé par cheminNote : copie inchangée.
 */
export function avecNote(plat, profilId, note) {
  if (!estObjet(plat)) return plat;
  const notes = estObjet(plat.notes) ? { ...plat.notes } : {};
  if (cheminNote(profilId) !== null) {
    if (noteValide(note)) notes[profilId] = note;
    else delete notes[profilId];
  }
  return { ...plat, notes };
}

// ——— Pour qui la personne connectée peut noter ———

/**
 * Profils que la personne connectée peut noter : elle-même d'abord (`moi`, s'il existe), puis les enfants sans
 * adresse, dans l'ordre d'affichage. Un autre adulte, ou un enfant qui a son adresse, note lui-même.
 * → [{ profil, estMoi }]
 */
export function profilsNotables(profils, moi) {
  const resultat = moi ? [{ profil: moi, estMoi: true }] : [];
  for (const profil of trierProfils(profils)) {
    if (!profil || profil.id === moi?.id) continue;
    if (estEnfant(profil) && normaliserEmail(profil.email) === '') resultat.push({ profil, estMoi: false });
  }
  return resultat;
}

// ——— File de Découvrir ———

/** Empreinte 32 bits d'un texte (FNV-1a). */
function empreinte(texte) {
  let h = 0x811c9dc5;
  for (let i = 0; i < texte.length; i += 1) {
    h ^= texte.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

/** Générateur à graine (mulberry32) : nombres de [0, 1), toujours la même suite pour la même graine. */
function generateur(graine) {
  let etat = graine >>> 0;
  return () => {
    etat = (etat + 0x6d2b79f5) >>> 0;
    let t = etat;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * Nouvelle liste, mélangée de façon déterministe : même graine → même ordre. L'entrée n'est jamais modifiée.
 * Resservira au « bruit faible » de la proposition (T4).
 */
export function melanger(liste, graine) {
  const copie = Array.isArray(liste) ? [...liste] : [];
  const hasard = generateur(empreinte(String(graine ?? '')));
  for (let i = copie.length - 1; i > 0; i -= 1) {
    const j = Math.floor(hasard() * (i + 1));
    [copie[i], copie[j]] = [copie[j], copie[i]];
  }
  return copie;
}

/** Vrai si le plat est à montrer dans Découvrir : il a un nom, ce n'est pas une préparation, ce profil ne l'a pas noté. */
export function aDecouvrir(plat, profilId) {
  if (!estObjet(plat) || typeof plat.id !== 'string' || plat.id === '') return false;
  if (reduire(plat.nom) === '' || typeDe(plat) === 'preparation') return false;
  return !estNote(plat, profilId);
}

/**
 * Plats à découvrir, chacun une seule fois. `garder(plat)` (facultatif) écarte en plus des plats : pour un profil
 * contraint, ceux qui attendent encore leur version (T2a).
 */
function aMontrer(plats, profilId, garder) {
  const vus = new Set();
  const garde = typeof garder === 'function' ? garder : () => true;
  return (Array.isArray(plats) ? plats : []).filter((plat) => {
    if (!aDecouvrir(plat, profilId) || vus.has(plat.id) || !garde(plat)) return false;
    vus.add(plat.id);
    return true;
  });
}

/**
 * Identifiants des plats à montrer dans Découvrir pour ce profil : par type (plat, dessert, apéro,
 * accompagnement), d'abord ceux qui ont une recette puis les ⏳ ; chaque groupe trié par identifiant puis mélangé
 * avec la graine. L'ordre du tableau reçu ne change donc rien. Graine de l'app : grainePour (même ordre toute la
 * journée). `garder(plat)` (facultatif) écarte des plats de la file ; sans lui, l'ordre est celui de T1d.
 */
export function fileDecouverte(plats, profilId, { graine = '', garder = null } = {}) {
  const groupes = ORDRE_TYPES.flatMap(() => [[], []]);
  for (const plat of aMontrer(plats, profilId, garder)) {
    const type = Math.max(0, ORDRE_TYPES.indexOf(typeDe(plat)));
    groupes[type * 2 + (statutDe(plat) === 'attente' ? 1 : 0)].push(plat.id);
  }
  return groupes.flatMap((ids, i) => melanger(ids.sort(parId), `${graine}|${i}`));
}

/**
 * Index de la prochaine carte, à partir de `depuis` : le premier plat de la file qui existe encore et reste à
 * découvrir (un plat noté ailleurs ou supprimé est sauté ; `garder`, facultatif : même filtre que fileDecouverte) ;
 * `file.length` en fin de file.
 */
export function suivant(file, depuis, plats, profilId, { garder = null } = {}) {
  const liste = Array.isArray(file) ? file : [];
  const garde = typeof garder === 'function' ? garder : () => true;
  const parIdentifiant = new Map((Array.isArray(plats) ? plats : []).filter(estObjet).map((p) => [p.id, p]));
  for (let i = Number.isInteger(depuis) && depuis > 0 ? depuis : 0; i < liste.length; i += 1) {
    const plat = parIdentifiant.get(liste[i]);
    if (plat && aDecouvrir(plat, profilId) && garde(plat)) return i;
  }
  return liste.length;
}

/**
 * Nouvelle file : la file, plus, à la fin, chaque plat à découvrir qui n'est ni la carte affichée (`file[position]`)
 * ni déjà devant, dans l'ordre de fileDecouverte. Un plat nouveau, ou dont la note a été effacée, revient ainsi à
 * la fin, une seule fois. `garder` : même filtre que fileDecouverte (un plat qui reçoit sa version entre ainsi à
 * la fin de la file).
 */
export function completerFile(file, position, plats, profilId, { graine = '', garder = null } = {}) {
  const liste = Array.isArray(file) ? file : [];
  const devant = new Set(liste.slice(Number.isInteger(position) && position > 0 ? position : 0));
  return [...liste, ...fileDecouverte(plats, profilId, { graine, garder }).filter((id) => !devant.has(id))];
}

/** Nombre de plats que ce profil n'a pas encore notés (préparations, plats sans nom et plats écartés par `garder` exclus). */
export function nombreANoter(plats, profilId, { garder = null } = {}) {
  return aMontrer(plats, profilId, garder).length;
}

/** Bilan de la visite, pour l'écran de fin. `gestes` : [{ note }] (0, 3 ou 5). → { adore, pourquoiPas, jamais } */
export function bilan(gestes) {
  const compte = (note) => (Array.isArray(gestes) ? gestes : []).filter((geste) => geste?.note === note).length;
  return { adore: compte(5), pourquoiPas: compte(3), jamais: compte(0) };
}

/** Graine de la file : « <profilId>:<AAAA-MM-JJ> », à la date du téléphone. L'ordre change le lendemain. */
export function grainePour(profilId, date = new Date()) {
  const jour = date instanceof Date && !Number.isNaN(date.getTime()) ? date : new Date();
  const deux = (n) => String(n).padStart(2, '0');
  return `${profilId}:${jour.getFullYear()}-${deux(jour.getMonth() + 1)}-${deux(jour.getDate())}`;
}

// ——— Textes ———

/** « a », « a et b », « a, b et c » */
function enumerer(mots) {
  return mots.length > 1 ? `${mots.slice(0, -1).join(', ')} et ${mots.at(-1)}` : mots.join('');
}

/**
 * Ingrédients de la carte de Découvrir : « Avec : pâtes courtes, jambon blanc et gruyère râpé » ; au-delà de `max`,
 * « Avec : a, b, c et 2 autres » ; '' sans ingrédients. Produits manquants ignorés, doublons comptés une fois.
 */
export function texteIngredients(plat, max = 3) {
  const produits = [...new Set((Array.isArray(plat?.ingredients) ? plat.ingredients : [])
    .map((ingredient) => (typeof ingredient?.produit === 'string' ? reduire(ingredient.produit) : ''))
    .filter(Boolean))];
  if (!produits.length) return '';
  const montres = Math.max(1, Number.isInteger(max) ? max : 3);
  if (produits.length <= montres) return `Avec\u00A0: ${enumerer(produits)}`;
  const reste = produits.length - montres;
  return `Avec\u00A0: ${produits.slice(0, montres).join(', ')} et ${reste} ${reste > 1 ? 'autres' : 'autre'}`;
}

/** Symbole d'une note dans la liste des plats : ❤️ (5), 👎 (0), ★n (1 à 4). */
function symbole(note) {
  if (note === NOTE_MAX) return '❤️';
  if (note === 0) return '👎';
  return `★${note}`;
}

/** « J’aime bien » → « j’aime bien » */
const minuscule = (texte) => texte.charAt(0).toLowerCase() + texte.slice(1);

/**
 * Résumé des notes d'un plat pour la liste des plats, profils connus seulement, dans l'ordre d'affichage.
 * → { morceaux: [{ profilId, texte: 'Adulte A ❤️' }], accessible } ; null si aucun profil connu n'a noté.
 * `accessible` dit aussi qui n'a pas encore noté : « Notes : Adulte A, j’adore ; Enfant, jamais. Pas encore noté :
 * Adulte B, compte comme Pourquoi pas. »
 */
export function resumeNotes(plat, profils) {
  const morceaux = [];
  const notes = [];
  const sansNote = [];
  for (const profil of trierProfils(profils)) {
    if (!profil || typeof profil.id !== 'string') continue;
    const nom = reduire(profil.nom) || 'Sans prénom';
    const note = noteDe(plat, profil.id);
    if (note === null) {
      sansNote.push(nom);
      continue;
    }
    morceaux.push({ profilId: profil.id, texte: `${nom}\u00A0${symbole(note)}` });
    notes.push(`${nom}, ${minuscule(LIBELLES_NOTE[note])}`);
  }
  if (!morceaux.length) return null;
  let accessible = `Notes\u00A0: ${notes.join('\u00A0; ')}.`;
  if (sansNote.length) accessible += ` Pas encore noté\u00A0: ${enumerer(sansNote)}, compte comme Pourquoi pas.`;
  return { morceaux, accessible };
}
