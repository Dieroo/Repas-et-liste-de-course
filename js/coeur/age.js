// Précautions d'un jeune enfant selon son âge (T2c, CLAUDE.md §7) : barème générique, âge en mois, règles de type
// `precautionAge` et plats repérés. Logique pure : ni DOM ni Firebase. N'importe que slug.js, vocabulaire.js et
// profils.js (ni regles.js ni compatibilite.js : pas de cycle). Une aide, pas un avis médical.
//
// Règles d'or :
// - le barème est complet et générique : rien ici ne dépend de l'âge réel d'un enfant ; une ligne dont l'âge est
//   passé n'est jamais ajoutée à un profil ;
// - « plus prudent tout de suite, moins prudent seulement par un toucher » : reglesSelonAge ajoute ou durcit, toujours
//   face aux règles enregistrées, jamais n'assouplit ni ne retire ; une précaution dont l'âge est passé est seulement
//   proposée (propositionsAge, carte 🧸🎂 de Semaine), et ne s'assouplit, ne disparaît ou n'est gardée que par un choix
//   de l'écran de l'enfant, pour l'âge où il est fait (appliquerChoixAge, rejouerChoixAge, T2c-3) ;
// - la borne est copiée dans la règle (`age.jusquAMois`) : precautionsAge ne lit jamais la date, et une modification
//   future du barème n'agit sur aucun profil sans passer par l'écran ;
// - les règles d'âge ne sont jamais évaluées par compatibilite.js › evaluer ni décrites à Claude (type propre).
//
// Sources du barème (relecture seulement, jamais affichées) :
// - Santé publique France, « Nouvelles recommandations pour la diversification alimentaire des enfants de moins de
//   3 ans : l'essentiel » (2021) et tableau « La diversification alimentaire de votre enfant jusqu'à 3 ans » ;
// - Santé publique France, « Pas à pas, votre enfant mange comme un grand » (2022) ;
// - Haut Conseil de la santé publique, avis du 30 juin 2020 (repères alimentaires 0-36 mois et 3-17 ans) ;
// - Santé publique France, « SHU : quelles précautions adopter ? » (2023) ;
// - ANSES, E. coli entérohémorragiques (2025) ; « Pas de miel pour les enfants de moins d'un an » (2023) ;
//   « Manger du poisson : pourquoi, comment » (2022) ;
// - ministère de l'Agriculture, fromages au lait cru, rappel des précautions (2025).
// Prudences de l'app : miel même cuit ; poisson fumé non compté ; fromage au lait cru bien cuit au four non compté ;
// café d'un dessert compris ; alcool non cuit jusqu'à 18 ans (âge légal) ; sauce soja non comptée.
import { slug } from './slug.js';
import { estObjet, marqueursEffectifs } from './vocabulaire.js';
import { trierProfils } from './profils.js';

export const TYPE_AGE = 'precautionAge';
/** Âge le plus élevé accepté pour une date de naissance (18 ans), et borne la plus haute d'une règle. */
export const AGE_MAX_MOIS = 216;

/**
 * Barème, dans l'ordre d'affichage. `jusquAMois` : âge, en mois révolus, à partir duquel le palier est passé.
 * `severite` : 'exclu' (« Pas avant… ») ou 'adaptable' (« Déconseillé avant… », avec un conseil). `court` : mot des
 * lignes des plats. Condition sur un ingrédient (marqueurs effectifs) : un de `marqueurs`, au moins un de
 * `etMarqueurs` s'il y en a, aucun de `saufMarqueurs`.
 */
export const BAREME_AGE = [
  {
    code: 'miel', libelle: 'Miel', aide: 'Même cuit.', court: 'miel', marqueurs: ['miel'],
    paliers: [{ severite: 'exclu', jusquAMois: 12 }],
  },
  {
    code: 'lait_cru', libelle: 'Fromages au lait cru',
    aide: 'Sauf comté, beaufort, emmental, gruyère, parmesan, grana padano. '
      + 'L’app ne compte pas un fromage bien cuit au four.',
    court: 'lait cru', marqueurs: ['lait_cru'],
    paliers: [
      { severite: 'exclu', jusquAMois: 60 },
      { severite: 'adaptable', jusquAMois: 180, consigne: 'Préférer pasteurisé, pâte pressée cuite ou bien cuit.' },
    ],
  },
  {
    code: 'viande_crue', libelle: 'Viande crue ou rosée', aide: 'Tartare, carpaccio, viande saignante, steak haché rosé.',
    court: 'viande crue', marqueurs: ['cru'], etMarqueurs: ['viande'], saufMarqueurs: ['charcuterie'],
    paliers: [
      { severite: 'exclu', jusquAMois: 36 },
      { severite: 'adaptable', jusquAMois: 180, consigne: 'Cuire à cœur, sans rose (surtout la viande hachée).' },
    ],
  },
  {
    code: 'charcuterie_crue', libelle: 'Charcuterie crue', aide: 'Jambon cru, saucisson, chorizo.',
    court: 'charcuterie crue', marqueurs: ['cru'], etMarqueurs: ['charcuterie'],
    paliers: [{ severite: 'exclu', jusquAMois: 36 }],
  },
  {
    code: 'poisson_cru', libelle: 'Poisson, coquillages crus',
    aide: 'Sushi, huîtres, tartare… Le poisson fumé n’est pas compté.',
    court: 'poisson cru', marqueurs: ['cru'], etMarqueurs: ['poisson', 'fruits_de_mer'],
    paliers: [{ severite: 'exclu', jusquAMois: 36 }],
  },
  {
    code: 'oeuf_cru', libelle: 'Œufs crus ou peu cuits', aide: 'Mayonnaise maison, mousse au chocolat, œuf à la coque.',
    court: 'œuf cru', marqueurs: ['oeuf_cru'],
    paliers: [{ severite: 'exclu', jusquAMois: 36 }],
  },
  {
    code: 'fruit_coque', libelle: 'Fruits à coque entiers', aide: 'Noix, cacahuètes… En poudre ou en purée\u00A0: permis.',
    court: 'fruits à coque', marqueurs: ['fruit_coque'],
    paliers: [{ severite: 'exclu', jusquAMois: 60 }],
  },
  {
    code: 'poisson_predateur', libelle: 'Espadon, requin, marlin',
    aide: 'À cause du mercure. Limiter aussi thon, bar, dorade, raie, lotte.',
    court: 'espadon, requin', marqueurs: ['poisson_predateur'],
    paliers: [{ severite: 'exclu', jusquAMois: 36 }],
  },
  {
    code: 'soja', libelle: 'Soja', aide: 'Tofu, tempeh, boisson au soja.', court: 'soja', marqueurs: ['soja'],
    paliers: [{ severite: 'adaptable', jusquAMois: 36, consigne: 'Préférer une autre protéine.' }],
  },
  {
    code: 'cafeine', libelle: 'Café, thé, sodas', aide: 'Café d’un dessert compris (tiramisu).', court: 'café, thé',
    marqueurs: ['cafeine'],
    paliers: [{ severite: 'exclu', jusquAMois: 216 }],
  },
  {
    code: 'alcool', libelle: 'Alcool non cuit', aide: 'Ajouté sans cuisson ou en fin de cuisson.', court: 'alcool',
    marqueurs: ['alcool_cru'],
    paliers: [{ severite: 'exclu', jusquAMois: 216 }],
  },
];

const JOUR = /^(\d{4})-(\d{2})-(\d{2})$/;
const JOURS_DU_MOIS = [31, 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];

const textes = (valeurs) => (Array.isArray(valeurs) ? valeurs.filter((v) => typeof v === 'string' && v !== '') : []);
const reduire = (texte) => String(texte ?? '').replace(/\s+/g, ' ').trim();
const nombreOu = (valeur, defaut) => (typeof valeur === 'number' && Number.isFinite(valeur) ? valeur : defaut);

/** Copie profonde des tables et des listes ; les valeurs undefined sont omises (clés absentes). */
function copier(valeur) {
  if (Array.isArray(valeur)) return valeur.filter((v) => v !== undefined).map(copier);
  if (estObjet(valeur)) {
    const copie = {};
    for (const [cle, v] of Object.entries(valeur)) if (v !== undefined) copie[cle] = copier(v);
    return copie;
  }
  return valeur;
}

// ——— Dates ———

function bissextile(annee) {
  return (annee % 4 === 0 && annee % 100 !== 0) || annee % 400 === 0;
}

function joursDuMois(annee, mois) {
  return mois === 2 && bissextile(annee) ? 29 : JOURS_DU_MOIS[mois - 1];
}

/** « AAAA-MM-JJ » d'une date qui existe au calendrier → { a, m, j } ; null sinon. */
function jourDuTexte(valeur) {
  const morceaux = typeof valeur === 'string' ? JOUR.exec(valeur) : null;
  if (!morceaux) return null;
  const [a, m, j] = morceaux.slice(1).map(Number);
  if (m < 1 || m > 12 || j < 1 || j > joursDuMois(a, m)) return null;
  return { a, m, j };
}

/** Jour lu dans un texte « AAAA-MM-JJ » ou une Date (date locale du téléphone) ; null sinon. */
function jourLu(valeur) {
  if (valeur instanceof Date) {
    if (Number.isNaN(valeur.getTime())) return null;
    return { a: valeur.getFullYear(), m: valeur.getMonth() + 1, j: valeur.getDate() };
  }
  return jourDuTexte(valeur);
}

const avant = (x, y) => x.a - y.a || x.m - y.m || x.j - y.j;

/**
 * Âge en mois révolus à `aujourdhui` (« AAAA-MM-JJ », date locale du téléphone ; une Date est acceptée). Un mois
 * est révolu le même jour du mois suivant, ou le dernier jour d'un mois plus court (né un 31, un 30 ou un 29 février :
 * né le 2024-02-29, 12 mois le 2025-02-28). Date absente, impossible ou dans le futur → null.
 */
export function ageEnMois(naissance, aujourdhui) {
  const ne = jourLu(naissance);
  const jour = jourLu(aujourdhui);
  if (!ne || !jour || avant(ne, jour) > 0) return null;
  let mois = (jour.a - ne.a) * 12 + (jour.m - ne.m);
  if (jour.j < ne.j && jour.j !== joursDuMois(jour.a, jour.m)) mois -= 1;
  return mois;
}

// ——— Textes ———

/** Âge affiché : moins de 24 mois → « N mois » ; sinon « N ans ». */
export function texteAge(mois) {
  const n = Math.max(0, Math.floor(nombreOu(mois, 0)));
  return n < 24 ? `${n} mois` : `${Math.floor(n / 12)} ans`;
}

/** Borne d'une précaution (« Pas avant 5 ans ») : « 1 an » pour 12, « N ans » ; « N mois » sous 2 ans hors années entières. */
export function texteBorne(jusquAMois) {
  const n = Math.max(0, Math.floor(nombreOu(jusquAMois, 0)));
  if (n === 12) return '1 an';
  if (n < 24) return `${n} mois`;
  const ans = Math.floor(n / 12);
  return n % 12 === 0 ? `${ans} ans` : `${ans} ans et ${n % 12} mois`;
}

/** Temps qui reste avant la borne : moins de 24 mois → « encore N mois » ; sinon « encore N ans » (arrondi vers le bas). */
export function texteReste(mois) {
  const n = Math.max(0, Math.floor(nombreOu(mois, 0)));
  return n < 24 ? `encore ${n} mois` : `encore ${Math.floor(n / 12)} ans`;
}

// ——— Date de naissance ———

/**
 * Date saisie à l'écran (`aujourdhui` : « AAAA-MM-JJ » local). → { naissance } ou { erreur } :
 * 'format' (pas un texte « AAAA-MM-JJ » d'une date réelle, ou `aujourdhui` illisible), 'futur' (après aujourd'hui),
 * 'ancienne' (plus de AGE_MAX_MOIS mois). Le jour même est accepté (0 mois).
 */
export function validerNaissance(valeur, aujourdhui) {
  const ne = jourDuTexte(valeur);
  const jour = jourLu(aujourdhui);
  if (!ne || !jour) return { erreur: 'format' };
  if (avant(ne, jour) > 0) return { erreur: 'futur' };
  if (ageEnMois(valeur, aujourdhui) > AGE_MAX_MOIS) return { erreur: 'ancienne' };
  return { naissance: valeur };
}

/**
 * Date lue dans un fichier de sauvegarde : texte « AAAA-MM-JJ » d'une date réelle, sans comparaison à aujourd'hui
 * (une sauvegarde restaurée après les 18 ans de l'enfant garde sa date).
 */
export function naissanceLisible(valeur) {
  return jourDuTexte(valeur) !== null;
}

// ——— Barème et règles ———

/** Vrai pour une règle de type `precautionAge`. */
export function estRegleAge(regle) {
  return estObjet(regle) && regle.type === TYPE_AGE;
}

/** Entrée du barème pour ce code, ou null. */
function entreeDe(code) {
  return BAREME_AGE.find((entree) => entree.code === code) ?? null;
}

/** Code d'une règle d'âge lisible (`age.code` texte non vide) ; null pour toute autre règle. */
function codeDe(regle) {
  return estRegleAge(regle) && estObjet(regle.age) && typeof regle.age.code === 'string' && regle.age.code
    ? regle.age.code : null;
}

/** Position dans le barème (codes inconnus à la fin). */
function rangDuCode(code) {
  const index = BAREME_AGE.findIndex((entree) => entree.code === code);
  return index === -1 ? BAREME_AGE.length : index;
}

/** Index d'un palier connu du barème pour cette règle ; null pour un palier inconnu de cette version. */
function palierConnu(regle, entree) {
  const palier = regle?.age?.palier;
  return entree && Number.isInteger(palier) && palier >= 0 && palier < entree.paliers.length ? palier : null;
}

/**
 * Rigueur d'une règle d'âge, pour départager deux règles du même code : plus petit = plus strict (palier connu le plus
 * petit). Palier inconnu du barème : Infinity. Code inconnu : son palier entier, s'il en a un.
 */
function rigueur(regle) {
  const code = codeDe(regle);
  const entree = entreeDe(code);
  if (entree) return palierConnu(regle, entree) ?? Infinity;
  const palier = regle?.age?.palier;
  return Number.isInteger(palier) && palier >= 0 ? palier : Infinity;
}

/** Vrai si la règle d'âge agit (active, avec des marqueurs) : seules celles-là comptent pour precautionsAge. */
function agit(regle) {
  return regle.actif !== false && textes(regle.marqueurs).length > 0;
}

/**
 * Doublons (deux règles d'âge du même code : fichier fusionné, double toucher), jugés sur leur effet : une règle qui
 * agit passe toujours avant une règle éteinte (jamais d'assouplissement sans toucher l'interrupteur) ; entre règles du
 * même état, la plus stricte (à égalité, la première). La règle gardée prend la place de la première ; les autres
 * règles restent à leur place.
 */
function sansDoublons(regles) {
  const cle = (regle) => [agit(regle) ? 0 : 1, rigueur(regle)];
  const avantDans = ([a1, a2], [b1, b2]) => a1 < b1 || (a1 === b1 && a2 < b2);
  const retenues = new Map();
  for (const regle of regles) {
    const code = codeDe(regle);
    if (!code) continue;
    const actuelle = retenues.get(code);
    if (!actuelle || avantDans(cle(regle), cle(actuelle))) retenues.set(code, regle);
  }
  const placees = new Set();
  const sortie = [];
  for (const regle of regles) {
    const code = codeDe(regle);
    if (!code) sortie.push(regle);
    else if (!placees.has(code)) {
      placees.add(code);
      sortie.push(retenues.get(code));
    }
  }
  return sortie;
}

/** Index du premier palier encore en vigueur à `mois` (`mois < jusquAMois`) ; -1 si tous sont passés ou sans âge. */
export function palierEnVigueur(entree, mois) {
  if (!Number.isInteger(mois) || mois < 0) return -1;
  const paliers = Array.isArray(entree?.paliers) ? entree.paliers : [];
  return paliers.findIndex((palier) => mois < palier?.jusquAMois);
}

/**
 * Règle d'un palier du barème : { id: 'age-<code>', type: 'precautionAge', marqueurs, etMarqueurs?, saufMarqueurs?,
 * severite, consigne?, age: { code, palier, jusquAMois }, actif }. Clés vides omises, jamais de valeur undefined.
 * null pour un palier qui n'existe pas.
 */
export function regleDuPalier(entree, palier, { actif = true } = {}) {
  const valeurs = Array.isArray(entree?.paliers) && Number.isInteger(palier) ? entree.paliers[palier] : null;
  if (!estObjet(valeurs) || typeof entree.code !== 'string') return null;
  const etMarqueurs = textes(entree.etMarqueurs);
  const saufMarqueurs = textes(entree.saufMarqueurs);
  return {
    id: `age-${entree.code}`,
    type: TYPE_AGE,
    marqueurs: textes(entree.marqueurs),
    ...(etMarqueurs.length ? { etMarqueurs } : {}),
    ...(saufMarqueurs.length ? { saufMarqueurs } : {}),
    severite: valeurs.severite,
    ...(valeurs.consigne ? { consigne: valeurs.consigne } : {}),
    age: { code: entree.code, palier, jusquAMois: valeurs.jusquAMois },
    actif: actif !== false,
  };
}

/**
 * « Plus prudent tout de suite » : règles du profil pour son âge, toujours calculées sur les règles **enregistrées**
 * (jamais sur un brouillon précédent). Doublons d'un même code réduits à une seule règle : celle qui agit d'abord,
 * puis la plus stricte (sansDoublons). Pour chaque ligne du barème :
 * - aucune règle de ce code : la règle du palier en vigueur est ajoutée à la fin (`actif: true`), dans l'ordre du
 *   barème ; rien si tous les paliers sont passés ;
 * - une règle à un palier connu moins strict que celui en vigueur : remplacée à sa place par la règle du palier en
 *   vigueur (`actif` gardé, `garde` retiré) ;
 * - sinon (même palier, plus strict, paliers passés, palier inconnu de cette version) : gardée telle quelle.
 * Règles hors barème (régime, code d'une version future) : intactes, à leur place. Jamais d'assouplissement ni de
 * retrait ; sans date lisible, rien n'est ajouté ni durci. Jamais de valeur undefined.
 * → { regles, ajoutees: [code], durcies: [code] }
 */
export function reglesSelonAge(naissance, aujourdhui, regles) {
  const liste = sansDoublons((Array.isArray(regles) ? regles : []).filter((regle) => regle !== undefined)).map(copier);
  const mois = ageEnMois(naissance, aujourdhui);
  const ajouts = [];
  const ajoutees = [];
  const durcies = [];
  for (const entree of BAREME_AGE) {
    const enVigueur = palierEnVigueur(entree, mois);
    const index = liste.findIndex((regle) => codeDe(regle) === entree.code);
    if (index === -1) {
      if (enVigueur >= 0) {
        ajouts.push(regleDuPalier(entree, enVigueur));
        ajoutees.push(entree.code);
      }
      continue;
    }
    const palier = palierConnu(liste[index], entree);
    if (enVigueur >= 0 && palier !== null && palier > enVigueur) {
      liste[index] = regleDuPalier(entree, enVigueur, { actif: liste[index].actif !== false });
      durcies.push(entree.code);
    }
  }
  return { regles: [...liste, ...ajouts], ajoutees, durcies };
}

/** Interrupteur d'une précaution : seul `actif` de la règle d'âge de ce code change (copie, sans undefined). */
export function basculerPrecaution(regles, code, actif) {
  return (Array.isArray(regles) ? regles : []).filter((regle) => regle !== undefined).map((regle) => {
    const copie = copier(regle);
    if (codeDe(regle) === code) copie.actif = Boolean(actif);
    return copie;
  });
}

/**
 * Précautions d'un profil, pour l'écran : une entrée par code (doublons réduits comme dans reglesSelonAge), dans
 * l'ordre du barème, codes inconnus à la fin (affichés avec leurs propres champs ; `entree` null).
 * `etat` : 'desactivee' (`actif: false`), 'gardee' (`age.garde`), 'passee' (âge ≥ borne), sinon 'en_cours'.
 * `resteMois` : borne − âge (null sans date lisible).
 * → [{ regle, entree, etat, resteMois }]
 */
export function lireAge(profil, aujourdhui) {
  const mois = ageEnMois(profil?.naissance, aujourdhui);
  const regles = sansDoublons(Array.isArray(profil?.regles) ? profil.regles : []).filter((regle) => codeDe(regle));
  return regles
    .map((regle, position) => ({ regle, position, rang: rangDuCode(codeDe(regle)) }))
    .sort((a, b) => a.rang - b.rang || a.position - b.position)
    .map(({ regle }) => {
      const borne = regle.age.jusquAMois;
      const connue = Number.isFinite(borne) && mois !== null;
      let etat = 'en_cours';
      if (regle.actif === false) etat = 'desactivee';
      else if (regle.age.garde === true) etat = 'gardee';
      else if (connue && mois >= borne) etat = 'passee';
      return { regle, entree: entreeDe(codeDe(regle)), etat, resteMois: connue ? borne - mois : null };
    });
}

// ——— Il a grandi (T2c-3) ———
//
// Passer un palier n'est jamais automatique : propositionsAge le propose (lignes « Âge passé : à revoir » de l'écran de
// l'enfant, carte 🧸🎂 de Semaine), appliquerChoixAge l'applique au brouillon après un toucher. Ordre fixe du brouillon
// de l'écran : règles enregistrées → reglesSelonAge (plus prudent) → choix de T2c-3, chacun seulement à l'âge où il a
// été fait (rejouerChoixAge) → interrupteurs. « Garder » est définitif (`age.garde`, plus rien n'est proposé pour cette
// précaution) et réversible (« Revoir »).

/**
 * Ce qu'une précaution d'âge permet à `mois` (ni `actif` ni `garde` ne sont lus ici : propositionsAge les filtre, et
 * un choix fait avant de toucher un interrupteur s'applique quand même, dans l'ordre du brouillon) :
 * - null : âge inconnu, borne de la règle pas encore atteinte (`mois < age.jusquAMois`), barème de cette version
 *   qui demande encore ce palier ou un plus strict (borne copiée plus basse que celle du barème), ou palier inconnu
 *   d'un code connu alors qu'un palier du barème est encore en vigueur (retirée, la précaution reviendrait aussitôt
 *   par reglesSelonAge : jamais moins prudent que le barème de l'app) ;
 * - { action: 'assouplir', entree, palier } : un palier moins strict du barème est en vigueur (palierEnVigueur saute
 *   les paliers passés) ;
 * - { action: 'retirer' } : tous les paliers du barème sont passés (palier inconnu compris), ou code inconnu de cette
 *   version (dès la borne de la règle).
 */
function choixPossible(regle, mois) {
  const borne = regle?.age?.jusquAMois;
  if (!Number.isInteger(mois) || mois < 0 || !Number.isFinite(borne) || mois < borne) return null;
  const entree = entreeDe(codeDe(regle));
  if (!entree) return { action: 'retirer' };
  const enVigueur = palierEnVigueur(entree, mois);
  if (enVigueur === -1) return { action: 'retirer' };
  const palier = palierConnu(regle, entree);
  if (palier !== null && enVigueur > palier) return { action: 'assouplir', entree, palier: enVigueur };
  return null;
}

/** Bouton principal d'une précaution à revoir : « Passer à « déconseillé » » ou « Retirer la précaution ». */
function texteChoix(possible) {
  if (possible.action !== 'assouplir') return 'Retirer la précaution';
  const cible = possible.entree.paliers[possible.palier];
  return cible.severite === 'adaptable'
    ? 'Passer à «\u00A0déconseillé\u00A0»'
    : `Passer à «\u00A0pas avant ${texteBorne(cible.jusquAMois)}\u00A0»`;
}

/**
 * Précautions d'un profil dont l'âge est passé, à revoir (T2c-3) : règles d'âge actives, non gardées, avec
 * `mois ≥ age.jusquAMois` (date du profil à `aujourdhui`). `action` : 'assouplir' si un palier suivant du barème est
 * encore en vigueur, sinon 'retirer' quand plus aucun palier du barème ne l'est (code inconnu de cette version : dès
 * la borne de la règle ; palier inconnu d'un code connu : rien tant qu'un palier du barème est en vigueur). Une règle
 * désactivée ou gardée ne propose jamais rien ; sans date lisible, rien. Une entrée par code (doublons réduits comme dans lireAge), dans
 * l'ordre du barème. `texte` : bouton principal de la ligne. Ne propose que : rien n'est écrit.
 * → [{ code, regleId, action: 'assouplir' | 'retirer', texte }]
 */
export function propositionsAge(profil, aujourdhui) {
  const mois = ageEnMois(profil?.naissance, aujourdhui);
  if (mois === null) return [];
  const propositions = [];
  for (const { regle } of lireAge(profil, aujourdhui)) {
    if (regle.actif === false || regle.age.garde === true) continue;
    const possible = choixPossible(regle, mois);
    if (!possible) continue;
    const code = codeDe(regle);
    propositions.push({
      code,
      regleId: typeof regle.id === 'string' && regle.id ? regle.id : `age-${code}`,
      action: possible.action,
      texte: texteChoix(possible),
    });
  }
  return propositions;
}

/**
 * Choix de l'écran de l'enfant pour une précaution dont l'âge est passé (T2c-3), appliqué au brouillon (copie, sans
 * valeur undefined) ; seules les règles d'âge de ce `code` changent, les autres sont recopiées telles quelles, à leur
 * place. `mois` : âge du brouillon (ageEnMois), null s'il n'y a pas de date.
 * - 'assouplir' : la règle est remplacée à sa place par celle du palier en vigueur (regleDuPalier ; paliers passés
 *   sautés, `actif` gardé, `garde` retiré) ;
 * - 'retirer' : la règle disparaît ;
 * - 'garder' : `age.garde = true` (plus rien n'est proposé pour elle) ;
 * - 'revoir' : `age.garde` est retiré (toujours permis : jamais moins prudent).
 * Les trois premiers ne s'appliquent qu'à une règle à revoir à `mois` (choixPossible) : 'assouplir' seulement si un
 * palier moins strict est en vigueur (impossible pour un code ou un palier inconnu), 'retirer' seulement si aucun
 * palier du barème n'est plus en vigueur (code inconnu : dès la borne de la règle), 'garder' dans les deux cas. Sinon
 * (âge pas encore atteint, choix inconnu) : liste inchangée. Ainsi un choix ne rend jamais une précaution moins
 * prudente que ce que le barème permet à `mois` ; rejouerChoixAge écarte en plus les choix faits pour un autre âge.
 * → regles
 */
export function appliquerChoixAge(regles, code, choix, mois) {
  const sortie = [];
  for (const regle of (Array.isArray(regles) ? regles : []).filter((r) => r !== undefined)) {
    const copie = copier(regle);
    if (typeof code !== 'string' || !code || codeDe(regle) !== code) {
      sortie.push(copie);
      continue;
    }
    if (choix === 'revoir') {
      delete copie.age.garde;
      sortie.push(copie);
      continue;
    }
    const possible = choixPossible(regle, mois);
    if (choix === 'retirer' && possible?.action === 'retirer') continue;
    if (choix === 'assouplir' && possible?.action === 'assouplir') {
      sortie.push(regleDuPalier(possible.entree, possible.palier, { actif: regle.actif !== false }));
      continue;
    }
    if (choix === 'garder' && possible) copie.age.garde = true;
    sortie.push(copie);
  }
  return sortie;
}

/**
 * Choix « Il a grandi » de l'écran de l'enfant, rejoués sur le brouillon dans l'ordre où ils ont été touchés
 * (appliquerChoixAge). Un choix ne vaut que pour l'âge, en mois révolus, où il a été fait : après une date corrigée ou
 * effacée, ou un nouveau mois, les choix faits pour un autre âge sont laissés de côté, et leurs précautions redeviennent
 * à revoir (jamais assouplies ni retirées pour un âge que personne n'a regardé). `choix` : [{ code, choix, mois }]
 * (`mois` null : fait sans date ; seul « revoir » agit alors). `mois` : âge du brouillon, null sans date. Copie, sans
 * valeur undefined ; la liste reçue n'est pas modifiée.
 * → regles
 */
export function rejouerChoixAge(regles, choix, mois) {
  const ageDe = (valeur) => (Number.isInteger(valeur) && valeur >= 0 ? valeur : null);
  const age = ageDe(mois);
  let sortie = (Array.isArray(regles) ? regles : []).filter((regle) => regle !== undefined).map(copier);
  for (const fait of Array.isArray(choix) ? choix : []) {
    if (!estObjet(fait) || ageDe(fait.mois) !== age) continue;
    sortie = appliquerChoixAge(sortie, fait.code, fait.choix, age);
  }
  return sortie;
}

/**
 * Carte « 🧸🎂 <Enfant> a 5 ans ! » de Semaine : le premier profil de profilsAvecAge (ordre d'affichage) qui a au
 * moins une précaution à revoir ; `age` : son âge (texteAge) ; `nombre` : précautions à revoir, tous profils
 * confondus. Ne lit aucun plat. null quand rien n'est à revoir.
 * → null | { profil, age, nombre }
 */
export function carteAnniversaire(profils, aujourdhui) {
  let premier = null;
  let nombre = 0;
  for (const profil of profilsAvecAge(profils)) {
    const propositions = propositionsAge(profil, aujourdhui);
    if (!propositions.length) continue;
    nombre += propositions.length;
    premier ??= profil;
  }
  return premier ? { profil: premier, age: texteAge(ageEnMois(premier.naissance, aujourdhui)), nombre } : null;
}

// ——— Plats repérés ———

/**
 * Ingrédients du plat tel qu'il est servi : ceux de la recette, moins ceux que la version retire (comparés par slug),
 * plus ses ajouts. Sans version : la recette.
 */
export function ingredientsServis(plat, variante) {
  const ingredients = Array.isArray(plat?.ingredients) ? plat.ingredients.filter(estObjet) : [];
  if (!estObjet(variante)) return ingredients;
  const retires = new Set(textes(variante.retirer).map(slug).filter(Boolean));
  const ajouts = Array.isArray(variante.ajouter) ? variante.ajouter.filter(estObjet) : [];
  return [...ingredients.filter((ingredient) => !retires.has(slug(ingredient.produit))), ...ajouts];
}

/** Règles d'âge actives et lisibles d'un profil. */
function reglesAgeActives(profil) {
  return (Array.isArray(profil?.regles) ? profil.regles : []).filter((regle) => codeDe(regle) && agit(regle));
}

/** Vrai si l'ingrédient déclenche la règle (marqueurs effectifs). */
function touche(regle, ingredient) {
  const effectifs = marqueursEffectifs(ingredient);
  const et = textes(regle.etMarqueurs);
  return textes(regle.marqueurs).some((m) => effectifs.has(m))
    && (!et.length || et.some((m) => effectifs.has(m)))
    && !textes(regle.saufMarqueurs).some((m) => effectifs.has(m));
}

/** Noms des produits, sans doublon (casse et accents ignorés), dans l'ordre. */
function nomsUniques(ingredients) {
  const vus = new Set();
  const noms = [];
  for (const ingredient of ingredients) {
    const nom = reduire(ingredient.produit);
    const cle = slug(nom);
    if (!cle || vus.has(cle)) continue;
    vus.add(cle);
    noms.push(nom);
  }
  return noms;
}

const gravite = (precaution) => (precaution.severite === 'exclu' ? 0 : 1);

/**
 * Précautions d'âge que le plat déclenche pour ce profil, sur le plat tel qu'il lui est servi (`variante` : la version
 * retenue par compatibilite.js › evaluer pour lui, ou null). Plat sans ingrédients (⏳) → []. Seules les règles
 * `precautionAge` actives comptent ; tous les types de plats (apéro, préparations compris). Ne lit jamais la date.
 * → [{ code, severite: 'exclu' | 'attention', court, consigne?, jusquAMois, produits: [nom] }], triées : 'exclu'
 *   d'abord, puis borne décroissante, puis ordre du barème. `court` : celui du barème (code inconnu : ses marqueurs).
 */
export function precautionsAge(plat, profil, { variante = null } = {}) {
  const recette = Array.isArray(plat?.ingredients) ? plat.ingredients.filter(estObjet) : [];
  if (!recette.length) return [];
  const servis = ingredientsServis(plat, variante);
  const parCode = new Map();
  for (const regle of reglesAgeActives(profil)) {
    const touches = servis.filter((ingredient) => touche(regle, ingredient));
    if (!touches.length) continue;
    const code = codeDe(regle);
    const entree = entreeDe(code);
    const consigne = reduire(typeof regle.consigne === 'string' ? regle.consigne : '');
    const precaution = {
      code,
      severite: regle.severite === 'adaptable' ? 'attention' : 'exclu',
      court: entree ? entree.court : textes(regle.marqueurs).join(', '),
      ...(consigne ? { consigne } : {}),
      jusquAMois: nombreOu(regle.age.jusquAMois, null),
      produits: nomsUniques(touches),
    };
    const deja = parCode.get(code);
    if (!deja) {
      parCode.set(code, precaution);
      continue;
    }
    // Deux règles du même code : la plus grave, puis la borne la plus haute ; produits réunis.
    const garder = gravite(precaution) < gravite(deja)
      || (gravite(precaution) === gravite(deja) && nombreOu(precaution.jusquAMois, 0) > nombreOu(deja.jusquAMois, 0))
      ? precaution : deja;
    const produits = nomsUniques([...deja.produits, ...precaution.produits].map((produit) => ({ produit })));
    parCode.set(code, { ...garder, produits });
  }
  return [...parCode.values()].sort((a, b) => gravite(a) - gravite(b)
    || nombreOu(b.jusquAMois, 0) - nombreOu(a.jusquAMois, 0)
    || rangDuCode(a.code) - rangDuCode(b.code));
}

/**
 * Ligne courte des listes (Plats, Découvrir) : le groupe le plus grave ; borne affichée = la plus haute du groupe ;
 * `courts` = les seules précautions du groupe qui ont cette borne (deux au plus) ; `autres` = nombre des autres
 * précautions du groupe (« Pas avant 18 ans : alcool + 1 autre »). null sans précaution.
 * → { severite: 'exclu' | 'attention', jusquAMois, courts: [court], autres }
 */
export function lignePrecautions(precautions) {
  const liste = Array.isArray(precautions) ? precautions.filter(estObjet) : [];
  if (!liste.length) return null;
  const severite = liste.some((p) => p.severite === 'exclu') ? 'exclu' : 'attention';
  const groupe = liste.filter((p) => (p.severite === 'exclu') === (severite === 'exclu'));
  const jusquAMois = Math.max(...groupe.map((p) => nombreOu(p.jusquAMois, 0)));
  const courts = groupe.filter((p) => nombreOu(p.jusquAMois, 0) === jusquAMois).slice(0, 2).map((p) => p.court);
  return { severite, jusquAMois, courts, autres: groupe.length - courts.length };
}

/** Profils qui ont au moins une règle d'âge active, dans l'ordre d'affichage (profils.js › trierProfils). */
export function profilsAvecAge(profils) {
  return trierProfils((Array.isArray(profils) ? profils : []).filter((profil) => estObjet(profil)
    && reglesAgeActives(profil).length > 0));
}

/**
 * Bilan de l'écran « 🧸 Ce que <Enfant> mange » sur les plats donnés (l'écran passe les plats actifs, jamais la
 * corbeille), hors ⏳ (sans ingrédients), tous types. `precautions(plat, profil)` : fonction à utiliser (par défaut
 * precautionsAge ; l'app passe sa version mémorisée, qui tient compte de la version servie).
 * → { exclus (plats avec au moins une précaution « exclu »), attention (plats avec seulement des « attention ») }
 */
export function bilanPrecautions(plats, profil, { precautions = precautionsAge } = {}) {
  const bilan = { exclus: 0, attention: 0 };
  for (const plat of Array.isArray(plats) ? plats.filter(estObjet) : []) {
    if (!(Array.isArray(plat.ingredients) && plat.ingredients.length)) continue;
    const liste = precautions(plat, profil);
    if (!Array.isArray(liste) || !liste.length) continue;
    if (liste.some((p) => p?.severite === 'exclu')) bilan.exclus += 1;
    else bilan.attention += 1;
  }
  return bilan;
}
