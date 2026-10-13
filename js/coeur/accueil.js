// Présentation de première ouverture (T6-0 ; le code dit « accueil », l'écran dit « présentation ») : quand elle
// s'ouvre toute seule, ce qu'elle montre, ses titres et ses textes. Logique pure : ni DOM, ni Firebase, ni stockage du
// téléphone (l'app lit et écrit la marque « déjà vu », ces fonctions ne font que la lire et la composer). Elle ne
// calcule aucune prochaine action : c'est le rôle de la carte de Semaine (coeur/liste.js › carteProchaineAction).
// Typographie : \u00A0 avant « : » et dans les guillemets, \u202F avant « ? » et « ! », apostrophe ’.
import { profilsARelier } from './profils.js';

/** Version de la présentation : une version plus récente, vue sur un autre appareil de l'app à jour, compte pour vue. */
export const VERSION_ACCUEIL = 1;
/** Ouvertures automatiques sans geste : au-delà, elle ne s'ouvre plus toute seule (« Revoir » marche toujours). */
export const OUVERTURES_MAX = 2;
/** Préfixe de la marque sur le téléphone (stockage partagé avec les autres sites du même domaine github.io). */
export const PREFIXE_ACCUEIL = 'repas-courses:accueil-vu:';

// Hash d'une ouverture ordinaire de l'app (icône, adresse de départ, Semaine) : seule ouverture où elle se montre.
// '#/accueil' : la page rechargée sur la présentation (Android libère l'app en arrière-plan, Chrome la rouvre à la
// même adresse) compte comme une ouverture ordinaire, donc dans OUVERTURES_MAX.
const HASH_OUVERTURE = ['', '#', '#/', '#/semaine', '#/accueil'];
const NON_VUE = Object.freeze({ vu: false, ouvertures: 0 });
const MARQUE = /^(\d{1,4})(?::o([1-9]\d{0,3}))?$/;

/** Clé de la marque pour un compte (`uid` Firebase) ; null sans identifiant. */
export function cleAccueil(uid) {
  return typeof uid === 'string' && uid !== '' ? `${PREFIXE_ACCUEIL}${uid}` : null;
}

/**
 * Valeur stockée → { vu, ouvertures }. '1' : vue ; '1:o1', '1:o2' : ouverte toute seule 1 ou 2 fois sans qu'un de ses
 * boutons soit touché ; version plus récente ('2', '2:o1') : vue ; plus ancienne, absente ou abîmée : jamais vue.
 * L'exception de lecture (stockage bloqué) est traitée par l'appelant (marque null).
 */
export function lireMarque(brut) {
  const morceaux = typeof brut === 'string' ? MARQUE.exec(brut) : null;
  if (!morceaux) return { ...NON_VUE };
  const version = Number(morceaux[1]);
  if (version > VERSION_ACCUEIL) return { vu: true, ouvertures: 0 };
  if (version < VERSION_ACCUEIL) return { ...NON_VUE };
  if (morceaux[2] === undefined) return { vu: true, ouvertures: 0 };
  return { vu: false, ouvertures: Number(morceaux[2]) };
}

/** Valeur « vue » (quittée par un de ses boutons). */
export function valeurVu() {
  return String(VERSION_ACCUEIL);
}

/** Valeur à écrire juste avant une ouverture automatique : une ouverture de plus que `marque`. */
export function valeurOuverture(marque) {
  const faites = Number.isInteger(marque?.ouvertures) && marque.ouvertures > 0 ? marque.ouvertures : 0;
  return `${VERSION_ACCUEIL}:o${faites + 1}`;
}

/**
 * La présentation s'ouvre-t-elle toute seule ? Seulement pour le rôle réel « Repas et courses » (jamais pour le
 * gestionnaire, aperçu compris), marque lisible, pas encore vue, moins de OUVERTURES_MAX ouvertures automatiques, et
 * sur une ouverture ordinaire (un lien vers une fiche ou vers Courses s'ouvre tel quel).
 */
export function accueilAuto({ roleReel, marque, hash } = {}) {
  return roleReel === 'courses'
    && marque !== null && typeof marque === 'object'
    && !marque.vu
    && Number.isInteger(marque.ouvertures) && marque.ouvertures < OUVERTURES_MAX
    && HASH_OUVERTURE.includes(hash ?? '');
}

/**
 * État de la reliure, pour figer les écrans de la présentation :
 * - 'chargement' : profils pas encore lus, ou lus seulement dans la copie du téléphone alors qu'on est en ligne et que
 *   l'attente du serveur n'est pas finie (`confirmes` faux) ;
 * - 'reliee' : la personne connectée est reconnue (`moi`) ;
 * - 'apercu' : gestionnaire non reconnu (jamais de « C'est moi » pour lui, aperçu ou non) ;
 * - 'relier' : sinon.
 */
export function etatBienvenue({ roleReel, moi, profilsCharges, confirmes } = {}) {
  if (!profilsCharges || !confirmes) return 'chargement';
  if (moi) return 'reliee';
  if (roleReel === 'gestionnaire') return 'apercu';
  return 'relier';
}

/** Écrans montrés, dans l'ordre : « Qui êtes-vous ? » seulement si elle n'est pas reconnue ; null en chargement. */
export function ecransAccueil(etat) {
  if (etat === 'relier') return ['relier', 'bienvenue'];
  if (etat === 'reliee' || etat === 'apercu') return ['bienvenue'];
  return null;
}

/** Nom d'un profil, espaces resserrés ; '' sans nom. */
function nomDe(profil) {
  return String(profil?.nom ?? '').replace(/\s+/g, ' ').trim();
}

/** « Bienvenue, Adulte B » ; sans prénom reconnu, « Bienvenue dans Repas & Courses ». */
export function titreBienvenue(moi) {
  const nom = nomDe(moi);
  return nom ? `Bienvenue, ${nom}` : TEXTES_ACCUEIL.titreNeutre;
}

/** Titre de l'écran « relier » : « Qui êtes-vous ? » s'il y a un prénom à proposer, sinon « Votre prénom n’est pas… ». */
export function titreRelier(profils, { gestionnaire } = {}) {
  return profilsARelier(profils ?? [], { gestionnaire }).length
    ? TEXTES_ACCUEIL.titreRelier
    : TEXTES_ACCUEIL.titreSansPrenom;
}

/** Tous les textes de la présentation (une seule source ; ui/accueil.js et ui/relier.js les reprennent). */
export const TEXTES_ACCUEIL = Object.freeze({
  titrePage: 'Bienvenue',
  titreChargement: 'Un instant…',
  // Écran « relier »
  titreRelier: 'Qui êtes-vous\u202F?',
  titreSansPrenom: 'Votre prénom n’est pas encore dans l’app',
  phraseRelier: 'Touchez votre prénom\u00A0: l’app saura que c’est vous, sur tous vos appareils.',
  phraseSansPrenom: 'Demandez qu’on vous ajoute dans les réglages de l’app.',
  plusTard: 'Plus tard',
  continuer: 'Continuer',
  reconnue: 'C’est fait\u00A0: l’app vous reconnaît.',
  relierChange: 'Ce prénom vient de changer sur un autre appareil. Choisissez à nouveau.',
  relierInconnu: 'Ce prénom n’est plus dans l’app. Choisissez à nouveau.',
  relierAdressePrise: 'Votre adresse est déjà utilisée pour un autre prénom.',
  // Écran « bienvenue »
  titreNeutre: 'Bienvenue dans Repas & Courses',
  phraseBienvenue: 'Fini la liste de courses à écrire\u00A0: elle se fait toute seule.',
  lignes: Object.freeze([
    Object.freeze({ emoji: '🗓️', nom: 'Semaine', texte: 'L’app propose les plats, vous choisissez.' }),
    Object.freeze({ emoji: '🛒', nom: 'Courses', texte: 'Au drive, un toucher cherche chaque produit.' }),
    Object.freeze({ emoji: '❤️', nom: 'Découvrir', texte: 'Dites ce qui vous plaît\u00A0: les propositions suivront vos goûts.' }),
  ]),
  apercu: 'Ici, la personne choisit son prénom.',
  decouvrirEmoji: '❤️',
  decouvrir: 'Dire ce qui me plaît',
  aideDecouvrir: 'Arrêtez quand vous voulez\u00A0: chaque réponse compte.',
  cestParti: 'C’est parti',
});

/** « Votre adresse est déjà utilisée pour « Adulte B ». » (écran « relier ») ; sans nom, la phrase générale. */
export function texteAdressePrise(nom) {
  const propre = nomDe({ nom });
  return propre
    ? `Votre adresse est déjà utilisée pour «\u00A0${propre}\u00A0».`
    : TEXTES_ACCUEIL.relierAdressePrise;
}
