// Proposer les plats de la semaine (T4-0, CLAUDE.md §9 Proposition) : « ✨ Proposer 4 plats » remplit une semaine
// sans plat avec des plats du foyer qui ont leur recette ; « 🍰 Proposer des desserts » ajoute à part le nombre de
// desserts choisi ; « 🔄 Une autre idée » change un plat. Logique pure : ni DOM, ni Firebase, ni heure, ni hasard du
// téléphone (le jour vient de la cible, le départage d'une graine tirée des données : deux téléphones aux mêmes
// données proposent la même chose).
// - Filtre dur : jamais un plat sans recette, de la corbeille, un apéro, une préparation de chaque semaine, un autre
//   type que celui demandé, un plat déjà dans la cible, un plat refusé pendant la visite (ancien plat d'un 🔄), un plat
//   noté « Jamais » par un adulte, ni un plat dont personne ne mange ; option `ecarter` (2026-10-20, « Ma cuisine ») :
//   jamais un plat qui demande un objet que la cuisine n'a pas (ma-cuisine.js › manqueUnObjet, prédicat donné par
//   l'app : ce module n'en sait rien d'autre).
// - Paliers : 1 personne n'est écarté et pas mangé récemment (JOURS_RECENTS avant ou après la cible) ; 2 récent ;
//   3 quelqu'un est écarté (pas de version qui convient, 🧸 « Pas avant… », « Jamais » de l'enfant), ECARTES_MAX par
//   semaine, plats de la cible compris.
// - Groupes (D4) : la moitié des emplacements pour des plats aimés, l'autre pour des plats à découvrir ; un plat noté
//   sous 3 par un mangeur ne prend jamais un emplacement de groupe.
// - Score : moyenne des notes des mangeurs (non noté = 3) + ancienneté − variété (même protéine, même forme) + un
//   départage faible (BRUIT_MAX), ordre total.
// - Légumes (2026-10-13) : au moins LEGUMES_MIN plat avec des légumes (aDesLegumes) dans la cible après ✨, plats de la
//   cible compris ; sinon échange déterministe d'un plat retenu (même groupe d'abord) ; « 🔄 » garde des légumes quand
//   l'ancien plat était le seul à en avoir. Jamais pour les desserts.
// - Aucune écriture ici : semaine.js › ecrituresAjoutGroupe, ecrituresRetraitGroupe, ecrituresRemplacement.
import {
  RANGS_STATUT, aDesPlats, ajouterJours, appliquerChamps, ecartJours, ecrituresRemplacement, estDansLaSemaine,
  jourDeDerniereFois, jourValide, lireSemaine, mangeParDefaut, peutAllerDansLaSemaine, platsDeLaSemaine, statutSemaine,
  texteDates,
} from './semaine.js';
import { estNote, melanger, noteDe, noteRetenue } from './notes.js';
import { aSaRecette, categorieDuPlat, typeDe } from './plats.js';
import { estEnfant, trierProfils } from './profils.js';
import { evaluer as evaluerParDefaut } from './compatibilite.js';
import { code as codeDe, marqueursEffectifs, nombre as lireNombre } from './vocabulaire.js';
import { cleProduit } from './slug.js';

// ——— Constantes ———

/** Plats proposés sans historique, pour 7 jours. */
export const NB_PLATS_DEFAUT = 4;
/** Bornes du nombre de plats pour 7 jours, au prorata des jours de la cible (arrondi), plafond NB_PLATS_PLAFOND. */
export const NB_PLATS_MIN = 3;
export const NB_PLATS_MAX = 6;
export const NB_PLATS_PLAFOND = 10;
/** En dessous, pas de bouton ✨ (une proposition d'un seul plat est pauvre). */
export const PROPOSITION_MIN = 2;
/** Semaines regardées pour le nombre de plats. */
export const SEMAINES_HISTOIRE = 3;
/** Fenêtre « mangé récemment », avant ou après la cible. */
export const JOURS_RECENTS = 14;
/** Plats que quelqu'un ne mange pas, par semaine (plats de la cible compris, desserts compris). */
export const ECARTES_MAX = 1;
/** Ancienneté : + BONUS_PAR_SEMAINE par semaine depuis le dernier passage, SEMAINES_MAX au plus ; jamais au menu : BONUS_JAMAIS. */
export const BONUS_PAR_SEMAINE = 0.1;
export const SEMAINES_MAX = 8;
export const BONUS_JAMAIS = 0.4;
/** Raison « pas au menu depuis longtemps ». */
export const SEMAINES_ANCIEN = 6;
/** Variété : par plat de même protéine principale, puis par plat de même forme, plafonné. */
export const MALUS_VARIETE = 0.4;
export const MALUS_VARIETE_MAX = 0.8;
/** Départage seulement : jamais assez pour renverser un écart de goût (0,25). */
export const BRUIT_MAX = 0.15;
/** Notes : aimé à partir de NOTE_AIMEE, mal noté sous NOTE_PLANCHER. */
export const NOTE_AIMEE = 4;
export const NOTE_PLANCHER = 3;
/** Desserts (D6) : choix de 1 à DESSERTS_MAX dans la feuille « Combien de desserts ? ». */
export const DESSERTS_MAX = 4;
/** Légumes (2026-10-13) : plats avec des légumes au moins, dans la cible après « ✨ Proposer » (plats seulement). */
export const LEGUMES_MIN = 1;
/** Une portion de légumes (PNNS) : grammes de légumes non aromatiques par portion de la recette (`portionsBase`). */
export const PORTION_LEGUMES_G = 80;
/**
 * Une demi-portion (relecture du 2026-10-13) : un légume principal (a) ou nommé dans le plat (b) dont la quantité se
 * lit doit en peser autant par portion (une garniture de burger ou de pizza ne suffit pas).
 */
export const LEGUME_VISIBLE_G = 40;
/** Une boîte de légumes, en grammes. */
export const GRAMMES_PAR_BOITE = 400;
/** Légumes aromatiques (premier mot de la clé du produit, slug.js › cleProduit) : jamais comptés comme légumes. */
export const LEGUMES_AROMATIQUES = Object.freeze(['oignon', 'echalote', 'ail', 'cive', 'ciboule']);
/**
 * Bases de sauce tomate (relecture du 2026-10-13) : début de la clé du produit (cleProduit, mot entier). Comme les
 * aromatiques, jamais comptées : une bolognaise, des lasagnes ou un chili ne sont pas des plats « avec des légumes »
 * pour leur boîte de tomates. Les tomates fraîches comptent (« tomate », « tomate cerise »).
 */
export const BASES_DE_SAUCE = Object.freeze([
  'tomate-concassee', 'tomate-pelee', 'tomate-sechee', 'tomate-en-conserve', 'concassee', 'pulpe', 'couli',
  'puree-de-tomate', 'concentre', 'double-concentre', 'sauce', 'passata', 'ketchup',
]);
/**
 * Poids moyen d'un légume à la pièce (`pc`), en grammes, par clé de produit : la plus longue suite de premiers mots de
 * sa clé trouvée ici (« chou-fleur » 800, « chou rouge » → chou 1000, « courge butternut » → courge). Clés au format
 * cleProduit (« panais » → panai, « radis » → radi). Un légume absent : sa quantité en pièces ne compte pas. Ni pomme
 * de terre ni patate douce : des féculents, jamais des légumes ici.
 */
export const POIDS_PIECE_LEGUMES = Object.freeze({
  carotte: 100, courgette: 200, aubergine: 250, poivron: 150, tomate: 120, 'tomate-cerise': 15, poireau: 150,
  navet: 100, panai: 150, betterave: 150, fenouil: 250, concombre: 300, brocoli: 400, 'chou-fleur': 800, chou: 1000,
  'chou-de-bruxelle': 15, 'celeri-rave': 600, potimarron: 1000, courge: 1000, artichaut: 300,
  endive: 100, laitue: 300, champignon: 20, radi: 15, 'radi-noir': 250, asperge: 20,
});

/**
 * Produits de la mer (« 🔄 Changer des plats », 2026-10-18) : familles proposées dans « Quel produit ? », dans cet
 * ordre. `mots` : suites de mots d'une clé de produit (cleProduit, au pluriel près) qui disent la famille, où qu'elles
 * soient dans la clé (« pavé de saumon », « dos de cabillaud », « noix de Saint-Jacques ») ; `au` : la famille dans une
 * phrase (« Pas d’autre plat au saumon pour l’instant. » ; « avec du lieu », « avec du bar » : « au lieu » se lirait
 * « à la place »). Données génériques, sans rien du foyer.
 */
export const FAMILLES_MER = Object.freeze([
  { id: 'saumon', nom: 'Saumon', au: 'au saumon', mots: [['saumon']] },
  { id: 'cabillaud', nom: 'Cabillaud', au: 'au cabillaud', mots: [['cabillaud']] },
  { id: 'thon', nom: 'Thon', au: 'au thon', mots: [['thon']] },
  { id: 'crevette', nom: 'Crevettes', au: 'aux crevettes', mots: [['crevette'], ['gamba']] },
  { id: 'colin', nom: 'Colin', au: 'au colin', mots: [['colin']] },
  { id: 'lieu', nom: 'Lieu', au: 'avec du lieu', mots: [['lieu']] },
  { id: 'merlu', nom: 'Merlu', au: 'au merlu', mots: [['merlu']] },
  { id: 'poisson-blanc', nom: 'Poisson blanc', au: 'au poisson blanc', mots: [['poisson', 'blanc']] },
  { id: 'truite', nom: 'Truite', au: 'à la truite', mots: [['truite']] },
  { id: 'sardine', nom: 'Sardines', au: 'aux sardines', mots: [['sardine']] },
  { id: 'maquereau', nom: 'Maquereau', au: 'au maquereau', mots: [['maquereau']] },
  { id: 'dorade', nom: 'Dorade', au: 'à la dorade', mots: [['dorade'], ['daurade']] },
  { id: 'bar', nom: 'Bar', au: 'avec du bar', mots: [['bar'], ['loup', 'de', 'mer']] },
  { id: 'sole', nom: 'Sole', au: 'à la sole', mots: [['sole']] },
  { id: 'lotte', nom: 'Lotte', au: 'à la lotte', mots: [['lotte']] },
  { id: 'poisson-pane', nom: 'Poisson pané', au: 'au poisson pané', mots: [['poisson', 'pane'], ['batonnet', 'de', 'poisson']] },
  { id: 'saint-jacques', nom: 'Saint-Jacques', au: 'aux saint-jacques', mots: [['saint', 'jacque'], ['st', 'jacque']] },
  { id: 'moule', nom: 'Moules', au: 'aux moules', mots: [['moule']] },
  { id: 'calamar', nom: 'Calamars', au: 'aux calamars', mots: [['calamar'], ['calmar'], ['encornet']] },
  { id: 'seiche', nom: 'Seiche', au: 'à la seiche', mots: [['seiche']] },
  { id: 'poulpe', nom: 'Poulpe', au: 'au poulpe', mots: [['poulpe']] },
  { id: 'fruits-de-mer', nom: 'Fruits de mer', au: 'aux fruits de mer', mots: [['fruit', 'de', 'mer']] },
  { id: 'crabe', nom: 'Crabe', au: 'au crabe', mots: [['crabe']] },
  { id: 'langoustine', nom: 'Langoustines', au: 'aux langoustines', mots: [['langoustine']] },
  { id: 'surimi', nom: 'Surimi', au: 'au surimi', mots: [['surimi']] },
  { id: 'haddock', nom: 'Haddock', au: 'au haddock', mots: [['haddock']] },
  { id: 'morue', nom: 'Morue', au: 'à la morue', mots: [['morue']] },
  { id: 'hareng', nom: 'Hareng', au: 'au hareng', mots: [['hareng']] },
  { id: 'espadon', nom: 'Espadon', au: 'à l’espadon', mots: [['espadon']] },
].map((famille) => Object.freeze({ ...famille, mots: Object.freeze(famille.mots.map((m) => Object.freeze([...m]))) })));
/**
 * Produits de la mer qui ne font pas un plat de la mer (premier mot de la clé) : un assaisonnement, un fond de sauce
 * ou une garniture (sauce nuoc-mâm, fumet, fond de poisson, court-bouillon, dashi, encre de seiche, œufs de lump).
 * CONDIMENTS_MER_PARTOUT : où que soit le mot (« filet d'anchois » d'une pizza, « worcestershire » seul) : lireMer.
 */
export const CONDIMENTS_MER = Object.freeze(['nuoc', 'sauce', 'fumet', 'bouillon', 'anchoi', 'huile', 'pate', 'creme', 'oeuf', 'tarama',
  'fond', 'court', 'dashi', 'bonite', 'garum', 'colatura', 'encre']);
export const CONDIMENTS_MER_PARTOUT = Object.freeze(['anchoi', 'worcestershire', 'worcester']);
/** Repères qu'un profil « Pas de viande » ne mange pas (comme regles.js) : un plat qui en a n'est jamais « de la mer ». */
const REPERES_DE_VIANDE = Object.freeze(['viande', 'bouillon_viande', 'gelatine_animale', 'graisse_animale']);

const ID_SUR = /^[a-z0-9-]+$/;
/** Mots d'un produit qui ne disent pas le légume (couleur, état) : jamais cherchés dans le nom du plat. */
const MOTS_QUALIFICATIFS = new Set([
  'rouge', 'vert', 'verte', 'blanc', 'blanche', 'jaune', 'noir', 'noire', 'frai', 'fraiche', 'nouveau', 'nouvelle',
  'petit', 'petite', 'grand', 'grande', 'grosse', 'douce', 'surgele', 'surgelee', 'hache', 'hachee', 'rape', 'rapee',
  'emince', 'emincee', 'cuit', 'cuite', 'entier', 'entiere', 'pele', 'pelee', 'concasse', 'concassee', 'seche', 'sechee',
]);
const PROTEINES = ['poisson', 'boeuf', 'porc', 'volaille', 'agneau', 'viande'];
const estObjet = (valeur) => Boolean(valeur) && typeof valeur === 'object' && !Array.isArray(valeur);
const listeDe = (valeur) => (Array.isArray(valeur) ? valeur : []);
const reduire = (texte) => (typeof texte === 'string' ? texte.replace(/\s+/g, ' ').trim() : '');
/** Arrondi au milliardième : des scores égaux restent égaux (0,1 + 0,2). */
const arrondi = (valeur) => Math.round(valeur * 1e9) / 1e9;
const parId = (a, b) => (a < b ? -1 : a > b ? 1 : 0);
const comparerNoms = new Intl.Collator('fr', { sensitivity: 'base' }).compare;

// ——— Cible et semaines ———

/** Cible lisible → { id, debut, fin, jours, plats } (plats : ceux de la cible donnée, sinon de son document), ou null. */
function lireCible(cible, semaines) {
  if (!estObjet(cible) || typeof cible.id !== 'string' || !ID_SUR.test(cible.id)) return null;
  const duree = ecartJours(cible.debut, cible.fin);
  if (duree === null || duree < 0 || duree + 1 > 14) return null;
  const document = listeDe(semaines).find((s) => estObjet(s) && s.id === cible.id) ?? null;
  const plats = estObjet(cible.plats) ? cible.plats : estObjet(document?.plats) ? document.plats : {};
  return { id: cible.id, debut: cible.debut, fin: cible.fin, jours: duree + 1, plats };
}

/** Semaines lisibles (lireSemaine). */
const lisibles = (semaines) => listeDe(semaines).map(lireSemaine).filter(Boolean);

/** Profils lus, dans l'ordre d'affichage. */
const profilsLus = (profils) => trierProfils(listeDe(profils).filter((p) => estObjet(p) && typeof p.id === 'string' && p.id !== ''));

/**
 * Adulte du foyer (D3-A) : un profil qui a une adresse et une portion entière. Son « Jamais » exclut le plat ; celui
 * d'un profil sans adresse ou de portion inférieure à 1 (l'enfant, noté par ses parents) l'écarte seulement.
 */
function estAdulte(profil) {
  return reduire(profil?.email) !== '' && !estEnfant(profil);
}

// ——— Historique ———

/**
 * Passages au menu de chaque plat, hors cible → Map<platId, [{ debut, fin }]> : intervalles des semaines qui ont des
 * plats (aDesPlats) où il est « dans la semaine » (non retiré), et [jour, jour + 6] de sa `derniereFois` lisible
 * (jourDeDerniereFois). Avant ou après la cible.
 */
export function historiqueDesPlats(semaines, tousLesPlats, { cible = null } = {}) {
  const passages = new Map();
  const ajouter = (platId, passage) => {
    if (!passages.has(platId)) passages.set(platId, []);
    passages.get(platId).push(passage);
  };
  const idCible = estObjet(cible) ? cible.id : null;
  for (const semaine of lisibles(semaines)) {
    if (semaine.id === idCible || !aDesPlats(semaine)) continue;
    for (const [platId, entree] of Object.entries(semaine.plats)) {
      if (ID_SUR.test(platId) && estDansLaSemaine(entree)) ajouter(platId, { debut: semaine.debut, fin: semaine.fin });
    }
  }
  for (const plat of listeDe(tousLesPlats)) {
    if (!estObjet(plat) || typeof plat.id !== 'string') continue;
    const jour = jourDeDerniereFois(plat.derniereFois);
    if (jour) ajouter(plat.id, { debut: jour, fin: ajouterJours(jour, 6) });
  }
  return passages;
}

/** Écart en jours entre la cible et le passage le plus proche (0 s'il la touche) ; null sans passage lisible. */
export function ecartAuMenu(passages, cible) {
  if (!estObjet(cible) || !jourValide(cible.debut) || !jourValide(cible.fin)) return null;
  let ecart = null;
  for (const p of listeDe(passages)) {
    if (!jourValide(p?.debut) || !jourValide(p?.fin)) continue;
    let e = 0;
    if (p.fin < cible.debut) e = ecartJours(p.fin, cible.debut);
    else if (p.debut > cible.fin) e = ecartJours(cible.fin, p.debut);
    if (ecart === null || e < ecart) ecart = e;
  }
  return ecart;
}

/**
 * Graine tirée des données seules : `proposer|<debut>|<fin>|<nombre d'entrées retire: true de la cible>` ; les plats
 * de la cible viennent de `cible.plats`, sinon de son document dans `semaines`. Deux téléphones aux mêmes données
 * proposent la même chose ; un « Annuler » (ou un plat retiré) fait avancer la graine. '' pour une cible illisible.
 */
export function graineProposition(cible, semaines = []) {
  const lue = lireCible(cible, semaines);
  if (!lue) return '';
  const retires = Object.values(lue.plats).filter((e) => estObjet(e) && e.retire === true).length;
  return `proposer|${lue.debut}|${lue.fin}|${retires}`;
}

// ——— Nombre voulu ———

/** Plats actifs d'une semaine d'un type : `ok` ou `sansRecette`, dont quelqu'un mange (ni corbeille ni « personne »). */
function compterActifs(semaine, type, { tousLesPlats, profils, evaluer }) {
  if (!semaine) return 0;
  const avecProfils = profilsLus(profils).length > 0;
  return platsDeLaSemaine(semaine, { tousLesPlats, profils, evaluer })
    .filter((e) => (e.etat === 'ok' || e.etat === 'sansRecette') && typeDe(e.plat) === type
      && (!avecProfils || e.mangeurs.some((m) => m.mange)))
    .length;
}

/** Semaines d'avant la cible (début plus tôt), la plus récente d'abord. */
function semainesAvant(semaines, cible) {
  return lisibles(semaines).filter((s) => s.id !== cible.id && s.debut < cible.debut)
    .sort((a, b) => parId(b.debut, a.debut) || (b.creeLe ?? -Infinity) - (a.creeLe ?? -Infinity) || parId(b.id, a.id));
}

const auProrata = (n, jours) => Math.round((n * jours) / 7);

/**
 * Nombre de plats voulu → { voulu, presents, aProposer: max(0, voulu − presents) } : médiane des SEMAINES_HISTOIRE
 * dernières semaines d'avant la cible qui ont des plats (type `plat`, `ok` ou `sansRecette`, ni corbeille ni
 * « personne »), ramenée à 7 jours, puis au prorata des jours de la cible ; NB_PLATS_DEFAUT sans historique (au
 * prorata) ; borné entre NB_PLATS_MIN et NB_PLATS_MAX au prorata (1 et NB_PLATS_PLAFOND au plus). `presents` : plats
 * de type `plat` actifs de la cible. Les desserts se comptent à part (nombreDeDessertsParDefaut). Cible illisible :
 * { voulu: 0, presents: 0, aProposer: 0 }.
 */
export function nombreAProposer(semaines, cible, { tousLesPlats = [], profils = [], evaluer = evaluerParDefaut } = {}) {
  const lue = lireCible(cible, semaines);
  if (!lue) return { voulu: 0, presents: 0, aProposer: 0 };
  const options = { tousLesPlats, profils, evaluer };
  const comptes = [];
  for (const semaine of semainesAvant(semaines, lue)) {
    const n = compterActifs(semaine, 'plat', options);
    const jours = ecartJours(semaine.debut, semaine.fin) + 1;
    if (n > 0) comptes.push((n * 7) / jours);
    if (comptes.length >= SEMAINES_HISTOIRE) break;
  }
  comptes.sort((a, b) => a - b);
  const milieu = Math.floor(comptes.length / 2);
  const mediane = comptes.length % 2 ? comptes[milieu] : (comptes[milieu - 1] + comptes[milieu]) / 2;
  const min = Math.max(1, auProrata(NB_PLATS_MIN, lue.jours));
  const max = Math.min(NB_PLATS_PLAFOND, Math.max(min, auProrata(NB_PLATS_MAX, lue.jours)));
  const brut = comptes.length ? Math.round(arrondi((mediane * lue.jours) / 7)) : auProrata(NB_PLATS_DEFAUT, lue.jours);
  const voulu = Math.min(max, Math.max(min, brut));
  const presents = compterActifs({ id: lue.id, debut: lue.debut, fin: lue.fin, plats: lue.plats }, 'plat', options);
  return { voulu, presents, aProposer: Math.max(0, voulu - presents) };
}

// ——— Candidats ———

/** Protéine principale d'une recette : poisson, boeuf, porc, volaille, agneau, viande (la première), sinon vegetal ; null sans ingrédient. */
function proteineDe(plat) {
  if (!aSaRecette(plat)) return null;
  const marqueurs = new Set();
  for (const ingredient of plat.ingredients) for (const m of marqueursEffectifs(ingredient)) marqueurs.add(m);
  if (marqueurs.has('fruits_de_mer')) marqueurs.add('poisson');
  if (marqueurs.has('charcuterie')) marqueurs.add('porc');
  return PROTEINES.find((p) => marqueurs.has(p)) ?? 'vegetal';
}

/** Forme d'un plat : gratin ou pâtes (plats.js › categorieDuPlat), sinon null (le « mijoté » par défaut ne compte pas). */
function formeDe(plat) {
  const categorie = categorieDuPlat(plat);
  return categorie === 'gratin' || categorie === 'pates' ? categorie : null;
}

// ——— Légumes (2026-10-13) ———

/** Mots d'un nom au format cleProduit : « Purée de carottes » → ['puree', 'de', 'carotte']. */
const motsCles = (texte) => cleProduit(typeof texte === 'string' ? texte : '').split('-').filter(Boolean);

/** Vrai si la clé `cle` est `prefixe` ou commence par `prefixe` suivi d'un autre mot (« sauce-tomate », jamais « saucisse »). */
const commencePar = (cle, prefixe) => cle === prefixe || cle.startsWith(`${prefixe}-`);

/**
 * Légume aromatique : premier mot de la clé parmi LEGUMES_AROMATIQUES (« oignon rouge », « ail des ours » ; jamais
 * « aile de poulet »), ou « gousse d'ail », « petit oignon » (le premier mot dit la forme ou la taille).
 */
function estAromatique(mots) {
  if (LEGUMES_AROMATIQUES.includes(mots[0])) return true;
  return (mots[0] === 'gousse' || mots[0] === 'petit') && mots.slice(1).some((m) => LEGUMES_AROMATIQUES.includes(m));
}

/**
 * Jamais un légume compté, même marqué `legume` : un aromatique (estAromatique), une base de sauce tomate
 * (BASES_DE_SAUCE), un féculent par son nom (pomme de terre, « patate », patate douce : comme les produits courants).
 */
function nonCompte(mots) {
  const cle = mots.join('-');
  return estAromatique(mots) || mots[0] === 'patate' || commencePar(cle, 'pomme-de-terre')
    || BASES_DE_SAUCE.some((prefixe) => commencePar(cle, prefixe));
}

/** Poids d'un légume à la pièce : la plus longue suite de premiers mots de sa clé dans POIDS_PIECE_LEGUMES ; null sinon. */
function poidsALaPiece(mots) {
  for (let n = mots.length; n > 0; n -= 1) {
    const cle = mots.slice(0, n).join('-');
    if (Object.hasOwn(POIDS_PIECE_LEGUMES, cle)) return POIDS_PIECE_LEGUMES[cle];
  }
  return null;
}

/**
 * Grammes d'un légume de la recette : g et kg tels quels, `boite` ≈ GRAMMES_PAR_BOITE, `pc` par POIDS_PIECE_LEGUMES ;
 * null si la quantité ne se lit pas (autre unité, pièce de poids inconnu, quantité illisible).
 */
function grammesDe(ingredient, mots) {
  const qte = lireNombre(ingredient.qte);
  if (!Number.isFinite(qte) || qte <= 0) return null;
  const unite = codeDe(ingredient.unite);
  if (unite === 'g') return qte;
  if (unite === 'kg') return qte * 1000;
  if (unite === 'boite') return qte * GRAMMES_PAR_BOITE;
  const poids = unite === 'pc' ? poidsALaPiece(mots) : null;
  return poids === null ? null : qte * poids;
}

/**
 * Vrai si la recette (jamais ses versions) a des légumes, pour l'équilibre des propositions (demande de l'utilisatrice
 * des courses, 2026-10-13 : « au moins un, même si c'est une purée »). Légume compté : marqueur effectif `legume`, ni
 * `feculent`, ni nonCompte (aromatique, base de sauce tomate, pomme de terre ou patate douce : des féculents, même en
 * purée). Il suffit d'un légume compté qui remplit l'une des conditions :
 * (a) `role: 'principal'` (il se voit et se mange tel quel : ratatouille, poêlée, gratin de courgettes) ;
 * (b) un mot de son produit de 4 lettres ou plus (clé cleProduit : sans accents, pluriel près ; ni couleur ni état,
 *     MOTS_QUALIFICATIFS) est un mot du nom du plat : « Purée de carottes », « Velouté de butternut » ;
 *     pour (a) et (b), le légume pèse LEGUME_VISIBLE_G par portion ou plus quand sa quantité et les portions se lisent
 *     (sinon il compte sans quantité) : une rondelle de tomate de burger ne suffit pas ;
 * (c) les légumes comptés pèsent PORTION_LEGUMES_G par portion ou plus (`portionsBase` lisible ; grammesDe).
 */
export function aDesLegumes(plat) {
  if (!estObjet(plat)) return false;
  const motsDuNom = new Set(motsCles(plat.nom));
  const portions = lireNombre(plat.portionsBase);
  const portionsLues = Number.isFinite(portions) && portions > 0;
  let grammes = 0;
  for (const ingredient of listeDe(plat.ingredients)) {
    if (!estObjet(ingredient)) continue;
    const marqueurs = marqueursEffectifs(ingredient);
    if (!marqueurs.has('legume') || marqueurs.has('feculent')) continue;
    const mots = motsCles(ingredient.produit);
    if (!mots.length || nonCompte(mots)) continue;
    const poids = grammesDe(ingredient, mots);
    const visible = poids === null || !portionsLues || arrondi(poids / portions) >= LEGUME_VISIBLE_G;
    if (visible && codeDe(ingredient.role) === 'principal') return true;
    if (visible && mots.some((m) => m.length >= 4 && !MOTS_QUALIFICATIFS.has(m) && motsDuNom.has(m))) return true;
    grammes += poids ?? 0;
  }
  return portionsLues && arrondi(grammes / portions) >= PORTION_LEGUMES_G;
}

// ——— Plats de la mer (2026-10-18) ———

/** Vrai si la suite de mots `suite` se trouve d'un bloc dans `mots`. */
function contientLaSuite(mots, suite) {
  for (let i = 0; i + suite.length <= mots.length; i += 1) {
    if (suite.every((mot, j) => mots[i + j] === mot)) return true;
  }
  return false;
}

/**
 * Plat de la mer, pour « 🔄 Changer des plats » → { deLaMer, familles: [id de FAMILLES_MER, dans leur ordre] }, sur la
 * recette seule (jamais ses versions). `deLaMer` : un plat qui a sa recette, ni viande, ni bouillon, gélatine ou graisse
 * animale (marqueurs effectifs, REPERES_DE_VIANDE : un plat de la mer se mange tel quel par un profil qui ne mange pas
 * de viande) et au moins un ingrédient marqué `poisson` ou `fruits_de_mer` qui n'est pas un assaisonnement
 * (CONDIMENTS_MER, CONDIMENTS_MER_PARTOUT). `familles` : celles de ses
 * produits de la mer (FAMILLES_MER) ; un produit d'aucune famille compte seulement pour « Peu importe ».
 */
export function lireMer(plat) {
  const rien = { deLaMer: false, familles: [] };
  if (!aSaRecette(plat)) return rien;
  const trouvees = new Set();
  let marin = false;
  for (const ingredient of plat.ingredients) {
    if (!estObjet(ingredient)) continue;
    const marqueurs = marqueursEffectifs(ingredient);
    if (REPERES_DE_VIANDE.some((m) => marqueurs.has(m))) return rien;
    if (!marqueurs.has('poisson') && !marqueurs.has('fruits_de_mer')) continue;
    const mots = motsCles(ingredient.produit);
    if (!mots.length || CONDIMENTS_MER.includes(mots[0]) || CONDIMENTS_MER_PARTOUT.some((m) => mots.includes(m))) continue;
    marin = true;
    for (const famille of FAMILLES_MER) if (famille.mots.some((suite) => contientLaSuite(mots, suite))) trouvees.add(famille.id);
  }
  return marin ? { deLaMer: true, familles: FAMILLES_MER.filter((f) => trouvees.has(f.id)).map((f) => f.id) } : rien;
}

/** Choix « Par quoi ? » lisible : 'tout' (« 🐟 Un plat de la mer », peu importe le produit), une famille connue, sinon null. */
function choixMer(mer) {
  if (mer === 'tout') return 'tout';
  return FAMILLES_MER.some((f) => f.id === mer) ? mer : null;
}

/** Vrai si le candidat convient au choix de la mer (null : tout convient). */
const convientALaMer = (candidat, mer) => mer === null
  || (candidat.mer.deLaMer && (mer === 'tout' || candidat.mer.familles.includes(mer)));

const ancienneteDe = (ecart) => (ecart === null ? BONUS_JAMAIS
  : Math.min(Math.floor(ecart / 7), SEMAINES_MAX) * BONUS_PAR_SEMAINE);
const estRecent = (ecart) => ecart !== null && ecart <= JOURS_RECENTS;

/**
 * Analyse d'un plat pour la cible → { rejet, profilId? } (filtre dur, ou personne n'en mange) ou le candidat. `rejet` :
 * 'recettes' (sans recette), 'jamais' (« Jamais » d'un adulte), 'personne' (aucun mangeur ; `raison` du premier
 * écarté). Le type, la corbeille, la cible et les refusés sont filtrés avant.
 */
function analyserPlat(plat, { profils, evaluer, passages, cible }) {
  if (!aSaRecette(plat)) return { rejet: 'recettes' };
  const mangeurs = [];
  const ecartes = [];
  for (const profil of profils) {
    const defaut = mangeParDefaut(plat, profil, { evaluer });
    if (defaut.mange) {
      mangeurs.push(profil);
      continue;
    }
    if (defaut.raison === 'jamais') {
      if (estAdulte(profil)) return { rejet: 'jamais' };
      ecartes.push({ profilId: profil.id, raison: 'jamaisEnfant' });
    } else ecartes.push({ profilId: profil.id, raison: defaut.raison === 'age' ? 'age' : 'version' });
  }
  if (profils.length && !mangeurs.length) return { rejet: 'personne', ecartes };
  const ecart = ecartAuMenu(passages.get(plat.id), cible);
  const notes = mangeurs.map((p) => noteDe(plat, p.id));
  const plancher = notes.some((n) => n !== null && n < NOTE_PLANCHER);
  const aimePar = mangeurs.filter((p) => (noteDe(plat, p.id) ?? -1) >= NOTE_AIMEE).map((p) => p.id);
  const jamaisAuMenu = ecart === null;
  let groupe = 'autre';
  if (!plancher && aimePar.length) groupe = 'aime';
  else if (!plancher && (jamaisAuMenu || mangeurs.some((p) => estAdulte(p) && !estNote(plat, p.id)))) groupe = 'decouvrir';
  const moyenne = mangeurs.length
    ? arrondi(mangeurs.reduce((s, p) => s + noteRetenue(plat, p.id), 0) / mangeurs.length) : 3;
  const recent = estRecent(ecart);
  return {
    platId: plat.id, plat, palier: ecartes.length ? 3 : recent ? 2 : 1, groupe, jamaisAuMenu, moyenne,
    mangeurs: mangeurs.map((p) => p.id), ecartes, ecart, recent, aimePar,
    proteine: proteineDe(plat), forme: formeDe(plat), legumes: aDesLegumes(plat), mer: lireMer(plat),
    base: arrondi(moyenne + ancienneteDe(ecart)),
  };
}

/**
 * Tout ce que la proposition sait de la cible → { cible, profils, actifs (Set des plats actifs de la cible),
 * elementsCible (platsDeLaSemaine), passages, candidats (type), rejets, ecartesCible }. `exclure` : plat de la cible
 * qui ne compte pas (l'ancien plat d'un 🔄) ; `ecarter(plat)` : vrai pour un plat qui demande un objet que la cuisine
 * n'a pas (rejet 'cuisine').
 */
function contexte(tousLesPlats, { cible, semaines, profils, evaluer, type, refuses, exclure = null, ecarter = null }) {
  const lue = lireCible(cible, semaines);
  if (!lue) return null;
  const lusProfils = profilsLus(profils);
  const evaluation = typeof evaluer === 'function' ? evaluer : evaluerParDefaut;
  const actifs = new Set(Object.keys(lue.plats).filter((id) => ID_SUR.test(id) && estDansLaSemaine(lue.plats[id])));
  const elementsCible = platsDeLaSemaine({ id: lue.id, debut: lue.debut, fin: lue.fin, plats: lue.plats },
    { tousLesPlats, profils: lusProfils, evaluer: evaluation }).filter((e) => e.platId !== exclure);
  // Un plat de la cible où quelqu'un est écarté par sa raison (pas une case décochée à la main ; une case cochée à la
  // main le fait manger) ; ni ⏳ ni corbeille.
  const ecartesCible = elementsCible.filter((e) => e.etat === 'ok' && e.mangeurs.some((m) => !m.mange && m.raison)).length;
  const passages = historiqueDesPlats(semaines, tousLesPlats, { cible: lue });
  const refusesSet = new Set(listeDe(refuses));
  const candidats = [];
  const rejets = [];
  const tries = listeDe(tousLesPlats).filter((p) => estObjet(p) && typeof p.id === 'string' && ID_SUR.test(p.id))
    .sort((a, b) => parId(a.id, b.id));
  const vus = new Set();
  for (const plat of tries) {
    if (vus.has(plat.id)) continue;
    vus.add(plat.id);
    if (!peutAllerDansLaSemaine(plat) || typeDe(plat) !== type || actifs.has(plat.id) || refusesSet.has(plat.id)) continue;
    const analyse = analyserPlat(plat, { profils: lusProfils, evaluer: evaluation, passages, cible: lue });
    // Un objet absent de la cuisine ne cache jamais une autre raison (sans recette, « Jamais », personne).
    if (analyse.rejet) rejets.push(analyse);
    else if (typeof ecarter === 'function' && ecarter(plat)) rejets.push({ rejet: 'cuisine', platId: plat.id });
    else candidats.push(analyse);
  }
  return { cible: lue, profils: lusProfils, evaluer: evaluation, actifs, elementsCible, passages, candidats, rejets, ecartesCible };
}

/**
 * Plats proposables pour la cible (filtre dur), avec palier, groupe et score de base → [{ platId, plat, palier: 1|2|3,
 * groupe: 'aime'|'decouvrir'|'autre', jamaisAuMenu, moyenne, mangeurs: [profilId], ecartes: [{ profilId, raison:
 * 'version'|'age'|'jamaisEnfant' }], ecart: n|null, recent, aimePar: [profilId], proteine, forme, legumes, mer (lireMer),
 * base }], triés par
 * identifiant. `type` : 'plat' | 'dessert' ; `refuses` : ids écartés pendant la visite (ancien plat d'un 🔄) ;
 * `ecarter` : prédicat des plats qui demandent un objet absent (filtre dur, « Ma cuisine »).
 */
export function candidats(tousLesPlats, { cible, semaines = [], profils = [], evaluer = evaluerParDefaut, type = 'plat', refuses = [], ecarter = null } = {}) {
  return contexte(tousLesPlats, { cible, semaines, profils, evaluer, type, refuses, ecarter })?.candidats ?? [];
}

// ——— Score et remplissage ———

/** Emplacements (D4-A) : n → ⌈n/2⌉ 'aime' puis 'decouvrir'. 4 → ['aime', 'aime', 'decouvrir', 'decouvrir']. */
export function emplacements(n) {
  const nombre = Number.isInteger(n) && n > 0 ? n : 0;
  const aimes = Math.ceil(nombre / 2);
  return Array.from({ length: nombre }, (_, i) => (i < aimes ? 'aime' : 'decouvrir'));
}

/** Rang de départage de chaque candidat (de 0 à 1) : sa place dans les identifiants triés, mélangés par la graine. */
function rangsDeDepartage(liste, graine) {
  const ids = liste.map((c) => c.platId).sort(parId);
  const melanges = melanger(ids, graine);
  const diviseur = Math.max(1, melanges.length - 1);
  return new Map(melanges.map((id, i) => [id, i / diviseur]));
}

/** Score face aux plats déjà là (cible du même type et plats retenus) : base − variété + départage. */
function scoreDe(candidat, presents, rang) {
  const memeProteine = candidat.proteine ? presents.filter((p) => p.proteine === candidat.proteine).length : 0;
  const memeForme = candidat.forme ? presents.filter((p) => p.forme === candidat.forme).length : 0;
  return arrondi(candidat.base
    - Math.min(MALUS_VARIETE_MAX, MALUS_VARIETE * memeProteine)
    - Math.min(MALUS_VARIETE_MAX, MALUS_VARIETE * memeForme)
    + BRUIT_MAX * (rang.get(candidat.platId) ?? 0));
}

const ecartOuInfini = (c) => (c.ecart === null ? Infinity : c.ecart);
/** Ordre d'un palier (ordre total) : 1 le score ; 2 le plus grand écart puis le score ; 3 le moins d'écartés, pas récent, puis le score. */
function comparerDansLePalier(palier) {
  return (a, b) => {
    if (palier === 2 && ecartOuInfini(a) !== ecartOuInfini(b)) return ecartOuInfini(b) - ecartOuInfini(a);
    if (palier === 3) {
      if (a.ecartes.length !== b.ecartes.length) return a.ecartes.length - b.ecartes.length;
      if (a.recent !== b.recent) return Number(a.recent) - Number(b.recent);
    }
    return b.score - a.score || ecartOuInfini(b) - ecartOuInfini(a)
      || comparerNoms(reduire(a.plat.nom), reduire(b.plat.nom)) || parId(a.platId, b.platId);
  };
}

/** Présents pour la variété : plats de la cible du type demandé (ni corbeille ni introuvables). */
function presentsDeLaCible(ctx, type) {
  return ctx.elementsCible.filter((e) => e.plat && e.etat !== 'corbeille' && e.etat !== 'absent' && typeDe(e.plat) === type)
    .map((e) => ({ proteine: proteineDe(e.plat), forme: formeDe(e.plat) }));
}

/**
 * Meilleur candidat de `pool` au palier `palier`, face aux `presents` (variété recalculée à chaque emplacement) ; null
 * si le pool est vide.
 */
function meilleur(pool, palier, presents, rang) {
  if (!pool.length) return null;
  return pool.map((c) => ({ ...c, score: scoreDe(c, presents, rang) })).sort(comparerDansLePalier(palier))[0];
}

/**
 * Raison d'un plat retenu → { code: 'aime', profils } | { code: 'decouvrir' | 'ancien' | 'recent' | 'autre' }, avec
 * `legumes: true` pour un plat (jamais un dessert) qui a des légumes (aDesLegumes).
 */
function raisonDe(candidat) {
  let raison;
  if (candidat.groupe === 'aime') raison = { code: 'aime', profils: [...candidat.aimePar] };
  else if (candidat.groupe === 'decouvrir') raison = { code: 'decouvrir' };
  else if (candidat.ecart !== null && Math.floor(candidat.ecart / 7) >= SEMAINES_ANCIEN) raison = { code: 'ancien' };
  else raison = { code: candidat.recent ? 'recent' : 'autre' };
  return candidat.legumes && typeDe(candidat.plat) === 'plat' ? { ...raison, legumes: true } : raison;
}

const choisi = (c) => ({
  platId: c.platId, groupe: c.groupe, palier: c.palier, raison: raisonDe(c), ecartes: c.ecartes.map((e) => ({ ...e })),
});

/**
 * Cause d'une proposition pauvre → { cause, profilCause } : parmi les plats du type qui ne sont pas au palier 1 (sans
 * recette, objet absent de la cuisine, « Jamais », quelqu'un écarté, récents), la raison la plus fréquente ; à
 * égalité : versions, age, recettes, cuisine, jamais, recents. `versions` et `age` nomment le profil le plus souvent écarté (ordre des profils à égalité).
 * 'catalogue' si rien de tout cela.
 */
function causeDe(ctx) {
  const comptes = { versions: 0, age: 0, recettes: 0, cuisine: 0, jamais: 0, recents: 0 };
  const parProfil = { versions: new Map(), age: new Map() };
  const compterEcarte = (ecarte) => {
    if (!ecarte) return;
    const cause = ecarte.raison === 'version' ? 'versions' : ecarte.raison === 'age' ? 'age' : 'jamais';
    comptes[cause] += 1;
    if (parProfil[cause]) parProfil[cause].set(ecarte.profilId, (parProfil[cause].get(ecarte.profilId) ?? 0) + 1);
  };
  for (const rejet of ctx.rejets) {
    if (rejet.rejet === 'personne') compterEcarte(rejet.ecartes[0]);
    else comptes[rejet.rejet] += 1;
  }
  for (const c of ctx.candidats) {
    if (c.palier === 3) compterEcarte(c.ecartes[0]);
    else if (c.palier === 2) comptes.recents += 1;
  }
  const ordre = ['versions', 'age', 'recettes', 'cuisine', 'jamais', 'recents'];
  const cause = ordre.reduce((meilleure, c) => (comptes[c] > (meilleure ? comptes[meilleure] : 0) ? c : meilleure), null);
  if (!cause) return { cause: 'catalogue', profilCause: null };
  let profilCause = null;
  if (parProfil[cause]) {
    let max = 0;
    for (const profil of ctx.profils) {
      const n = parProfil[cause].get(profil.id) ?? 0;
      if (n > max) [max, profilCause] = [n, profil.id];
    }
  }
  return { cause, profilCause };
}

/** Remplit les emplacements (3.6 du plan) : palier par palier, groupe d'abord, puis tous groupes ; palier 3 limité. */
function remplir(ctx, nombre, rang, type) {
  const slots = emplacements(nombre);
  const pris = new Array(slots.length).fill(null);
  const utilises = new Set();
  const presents = presentsDeLaCible(ctx, type);
  let ecartes = ctx.ecartesCible;
  for (const palier of [1, 2, 3]) {
    for (const parGroupe of [true, false]) {
      for (let i = 0; i < slots.length; i += 1) {
        if (pris[i]) continue;
        if (palier === 3 && ecartes >= ECARTES_MAX) break;
        const pool = ctx.candidats.filter((c) => c.palier === palier && !utilises.has(c.platId)
          && (!parGroupe || c.groupe === slots[i]));
        const retenu = meilleur(pool, palier, presents, rang);
        if (!retenu) continue;
        pris[i] = retenu;
        utilises.add(retenu.platId);
        presents.push({ proteine: retenu.proteine, forme: retenu.forme });
        if (palier === 3) ecartes += 1;
      }
    }
  }
  return pris.filter(Boolean);
}

/** Plats de la cible avec des légumes : type `plat`, avec leur recette (`ok`), dont quelqu'un mange (sans profil : tous). */
function legumesDeLaCible(ctx) {
  const avecProfils = ctx.profils.length > 0;
  return ctx.elementsCible.filter((e) => e.etat === 'ok' && e.plat && typeDe(e.plat) === 'plat' && aDesLegumes(e.plat)
    && (!avecProfils || listeDe(e.mangeurs).some((m) => m.mange))).length;
}

/**
 * Légumes (LEGUMES_MIN, plats seulement) : si ni la cible ni les plats retenus n'ont de plat avec des légumes, échange
 * déterministe d'un retenu par un candidat avec des légumes pas encore retenu. Palier par palier (1, puis 2, puis 3,
 * comme le remplissage : un plat que tout le monde mange passe toujours avant un plat que quelqu'un ne mange pas) :
 * d'abord, du dernier retenu au premier, le meilleur candidat du palier de son groupe le remplace ; sinon, du dernier
 * retenu au premier, le meilleur candidat du palier, tous groupes (l'ordre du palier, score face à la cible et aux
 * autres retenus). Un candidat du palier 3 seulement si ECARTES_MAX le permet encore après l'échange (il peut toujours
 * remplacer un retenu du palier 3). Aucun candidat : retenus inchangés.
 */
function avecDesLegumes(ctx, retenus, rang) {
  if (!retenus.length || legumesDeLaCible(ctx) + retenus.filter((c) => c.legumes).length >= LEGUMES_MIN) return retenus;
  const pris = new Set(retenus.map((c) => c.platId));
  const pool = ctx.candidats.filter((c) => c.legumes && !pris.has(c.platId));
  if (!pool.length) return retenus;
  const ecartesRetenus = retenus.filter((c) => c.palier === 3).length;
  const permis = (ancien, nouveau) => nouveau.palier < 3 || ancien.palier === 3
    || ctx.ecartesCible + ecartesRetenus + 1 <= ECARTES_MAX;
  const cible = presentsDeLaCible(ctx, 'plat');
  const presentsSans = (i) => [...cible, ...retenus.filter((_, j) => j !== i).map((c) => ({ proteine: c.proteine, forme: c.forme }))];
  const duDernierAuPremier = retenus.map((_, i) => retenus.length - 1 - i);
  for (const palier of [1, 2, 3]) {
    const duPalier = pool.filter((c) => c.palier === palier);
    if (!duPalier.length) continue;
    for (const parGroupe of [true, false]) {
      for (const i of duDernierAuPremier) {
        const possibles = duPalier.filter((c) => (!parGroupe || c.groupe === retenus[i].groupe) && permis(retenus[i], c));
        const nouveau = meilleur(possibles, palier, presentsSans(i), rang);
        if (nouveau) return retenus.map((c, j) => (j === i ? nouveau : c));
      }
    }
  }
  return retenus;
}

/** Proposition vide d'une cible illisible ou d'un nombre nul. */
const sansRien = (type, nombre) => ({
  type, ids: [], choisis: [], manque: Math.max(0, nombre), code: 'aucun', cause: null, profilCause: null,
});

function proposer(tousLesPlats, { cible, semaines, profils, evaluer, nombre, graine, refuses, ecarter }, type) {
  const voulu = Number.isInteger(nombre) && nombre > 0 ? nombre : 0;
  const ctx = contexte(tousLesPlats, { cible, semaines, profils, evaluer, type, refuses, ecarter });
  if (!ctx || !voulu) return sansRien(type, voulu);
  const rang = rangsDeDepartage(ctx.candidats, graine);
  const remplis = remplir(ctx, voulu, rang, type);
  const retenus = type === 'plat' ? avecDesLegumes(ctx, remplis, rang) : remplis;
  const manque = voulu - retenus.length;
  const code = !retenus.length ? 'aucun' : manque > 0 ? 'peu' : 'ok';
  const { cause, profilCause } = code === 'ok' ? { cause: null, profilCause: null } : causeDe(ctx);
  return { type, ids: retenus.map((c) => c.platId), choisis: retenus.map(choisi), manque, code, cause, profilCause };
}

/**
 * La proposition de plats (type `plat` seulement : les desserts ont leur bouton, proposerDesserts) → { type: 'plat',
 * ids: [platId…] (ordre des emplacements : aimés d'abord ; ordre d'ajout, donc des cartes), choisis: [{ platId, groupe,
 * palier, raison, ecartes }], manque, code: 'ok' | 'peu' | 'aucun', cause: null | 'versions' | 'age' | 'recettes' |
 * 'cuisine' | 'jamais' | 'recents' | 'catalogue', profilCause }. `ecarter` : comme candidats. `nombre` : nombreAProposer().aProposer par défaut ; `graine` :
 * graineProposition(cible) par défaut. `plafond` (facultatif) : le nombre dit par le libellé du bouton touché ; la
 * proposition vise `nombre` (code 'peu' et sa cause si les plats manquent, même quand le libellé le savait déjà), et
 * si elle trouve plus que `plafond` (plats arrivés depuis l'affichage), elle est refaite pour `plafond` plats.
 * Légumes : au moins LEGUMES_MIN plat avec des légumes dans la cible après la proposition, s'il en existe un
 * proposable (avecDesLegumes : échange, même nombre de plats).
 * Déterministe, indépendante de l'ordre des plats en entrée ; rien n'est modifié.
 */
export function proposerPlats(tousLesPlats, {
  cible = null, semaines = [], profils = [], evaluer = evaluerParDefaut, nombre = null, graine = null, refuses = [],
  plafond = null, ecarter = null,
} = {}) {
  const n = nombre ?? nombreAProposer(semaines, cible, { tousLesPlats, profils, evaluer }).aProposer;
  const options = { cible, semaines, profils, evaluer, graine: graine ?? graineProposition(cible, semaines), refuses, ecarter };
  const resultat = proposer(tousLesPlats, { ...options, nombre: n }, 'plat');
  if (!Number.isInteger(plafond) || plafond < 0 || resultat.ids.length <= plafond) return resultat;
  return proposer(tousLesPlats, { ...options, nombre: plafond }, 'plat');
}

/**
 * Desserts (D6, « 🍰 Proposer des desserts ») : même forme que proposerPlats (`type: 'dessert'`), candidats de type
 * `dessert` seulement ; mêmes paliers, groupes, score et départage ; la limite du palier 3 compte les plats de la cible ;
 * graine `graineProposition(cible) + '|desserts'` par défaut ; jamais un plat ni un dessert déjà actif dans la cible.
 */
export function proposerDesserts(tousLesPlats, {
  cible = null, semaines = [], profils = [], evaluer = evaluerParDefaut, nombre = 1, graine = null, refuses = [], ecarter = null,
} = {}) {
  return proposer(tousLesPlats, {
    cible, semaines, profils, evaluer, nombre, graine: graine ?? `${graineProposition(cible, semaines)}|desserts`, refuses, ecarter,
  }, 'dessert');
}

/** Proposables d'un contexte : paliers 1 et 2, plus le palier 3 dans la limite ECARTES_MAX (plats de la cible compris). */
function proposablesDe(ctx) {
  if (!ctx) return 0;
  const sansEcarte = ctx.candidats.filter((c) => c.palier < 3).length;
  return sansEcarte + Math.min(ctx.candidats.length - sansEcarte, Math.max(0, ECARTES_MAX - ctx.ecartesCible));
}

/**
 * Nombre de plats (ou de desserts) proposables pour la cible : paliers 1 et 2, plus le palier 3 dans la limite
 * ECARTES_MAX (plats de la cible compris). 0 pour une cible illisible.
 */
export function nombreProposable(tousLesPlats, { cible = null, semaines = [], profils = [], evaluer = evaluerParDefaut, type = 'plat', refuses = [], ecarter = null } = {}) {
  return proposablesDe(contexte(tousLesPlats, { cible, semaines, profils, evaluer, type, refuses, ecarter }));
}

/**
 * Ce que la carte « prochaine action » et la feuille de choix montrent, à l'ouverture → { plats, voulu, presents,
 * aProposer, disponibles, cause, profilCause, desserts } : `plats` = min(aProposer, disponibles) s'il atteint
 * PROPOSITION_MIN, sinon 0 (pas de bouton ✨) ; `cause` et `profilCause` seulement sans bouton parce que les plats
 * manquent (texteSansProposition ; 'catalogue' sans plat du tout) ; `desserts` : desserts proposables, DESSERTS_MAX au
 * plus (0 : pas de bouton 🍰).
 */
export function apercuProposition(tousLesPlats, { cible = null, semaines = [], profils = [], evaluer = evaluerParDefaut, refuses = [], ecarter = null } = {}) {
  const options = { cible, semaines, profils, evaluer, refuses, ecarter };
  const { voulu, presents, aProposer } = nombreAProposer(semaines, cible, { tousLesPlats, profils, evaluer });
  const ctx = contexte(tousLesPlats, { ...options, type: 'plat' });
  const disponibles = proposablesDe(ctx);
  const n = Math.min(aProposer, disponibles);
  const plats = n >= PROPOSITION_MIN ? n : 0;
  const { cause, profilCause } = !ctx || plats || disponibles >= PROPOSITION_MIN
    ? { cause: null, profilCause: null } : causeDe(ctx);
  const desserts = Math.min(DESSERTS_MAX, nombreProposable(tousLesPlats, { ...options, type: 'dessert' }));
  return { plats, voulu, presents, aProposer, disponibles, cause, profilCause, desserts };
}

/**
 * Nombre de desserts prérempli dans « Combien de desserts ? » (D6) : celui de la semaine la plus récente d'avant la
 * cible qui en avait au moins un (desserts `ok` ou `sansRecette`, ni corbeille ni « personne »), 1 sans historique ;
 * borné de 1 à DESSERTS_MAX et au nombre de desserts proposables (s'il y en a). Rien n'est stocké.
 */
export function nombreDeDessertsParDefaut(semaines, cible, { tousLesPlats = [], profils = [], evaluer = evaluerParDefaut, refuses = [], ecarter = null } = {}) {
  const lue = lireCible(cible, semaines);
  let n = 1;
  if (lue) {
    for (const semaine of semainesAvant(semaines, lue)) {
      const compte = compterActifs(semaine, 'dessert', { tousLesPlats, profils, evaluer });
      if (compte > 0) {
        n = compte;
        break;
      }
    }
  }
  const disponibles = nombreProposable(tousLesPlats, { cible, semaines, profils, evaluer, type: 'dessert', refuses, ecarter });
  const plafond = disponibles > 0 ? Math.min(DESSERTS_MAX, disponibles) : DESSERTS_MAX;
  return Math.min(plafond, Math.max(1, n));
}

/**
 * « 🔄 Une autre idée » → { platId, groupe, palier, raison } | null : remplaçant de `platId` (un plat ou un dessert de la
 * cible), du même type ; palier par palier, du même groupe d'abord, puis tous groupes ; palier 3 seulement si la cible,
 * SANS l'ancien plat, n'en a pas déjà ECARTES_MAX. Jamais l'ancien, jamais un plat de la cible, jamais un refusé.
 * Variété face aux plats de la cible sans l'ancien. `graine` : graineProposition(cible) + '|autre' par défaut.
 * Légumes : un plat qui en avait, seul de la cible sans lui, est remplacé d'abord par un plat avec des légumes (même
 * ordre de recherche), sinon par n'importe lequel.
 * `mer` (« 🔄 Changer des plats », 2026-10-18) : 'tout' (un plat de la mer, lireMer) ou l'id d'une famille de
 * FAMILLES_MER (un plat de la mer de cette famille) ; seulement pour un plat (jamais un dessert) ; aucun plat qui
 * convient → null, jamais un autre plat à la place. Une valeur inconnue → null.
 */
export function autreIdee(tousLesPlats, platId, {
  cible = null, semaines = [], profils = [], evaluer = evaluerParDefaut, graine = null, refuses = [], mer = null, ecarter = null,
} = {}) {
  const ancien = listeDe(tousLesPlats).find((p) => estObjet(p) && p.id === platId) ?? null;
  const type = typeDe(ancien);
  if (!ancien || (type !== 'plat' && type !== 'dessert')) return null;
  const voulu = mer === null || mer === undefined ? null : choixMer(mer);
  if ((mer !== null && mer !== undefined && !voulu) || (voulu && type !== 'plat')) return null;
  const ctx = contexte(tousLesPlats, {
    cible, semaines, profils, evaluer, type, refuses: [...listeDe(refuses), platId], exclure: platId, ecarter,
  });
  if (!ctx) return null;
  const vu = analyserPlat(ancien, { profils: ctx.profils, evaluer: ctx.evaluer, passages: ctx.passages, cible: ctx.cible });
  const groupe = vu.rejet ? null : vu.groupe;
  const rang = rangsDeDepartage(ctx.candidats, graine ?? `${graineProposition(cible, semaines)}|autre`);
  const presents = presentsDeLaCible(ctx, type);
  // Un plat de la mer est pour toute la famille : jamais un plat que quelqu'un ne mange pas (palier 3).
  const paliers = voulu ? [1, 2] : [1, 2, 3];
  const chercher = (liste) => {
    for (const palier of paliers) {
      if (palier === 3 && ctx.ecartesCible >= ECARTES_MAX) break;
      const duPalier = liste.filter((c) => c.palier === palier);
      const retenu = meilleur(duPalier.filter((c) => c.groupe === groupe), palier, presents, rang)
        ?? meilleur(duPalier, palier, presents, rang);
      if (retenu) return retenu;
    }
    return null;
  };
  const possibles = ctx.candidats.filter((c) => convientALaMer(c, voulu));
  // Légumes : l'ancien plat était le seul de la cible à en avoir → un plat avec des légumes d'abord, sinon tous.
  const garderDesLegumes = type === 'plat' && aDesLegumes(ancien) && legumesDeLaCible(ctx) < LEGUMES_MIN;
  const retenu = (garderDesLegumes ? chercher(possibles.filter((c) => c.legumes)) : null) ?? chercher(possibles);
  return retenu ? { platId: retenu.platId, groupe: retenu.groupe, palier: retenu.palier, raison: raisonDe(retenu) } : null;
}

/**
 * « Par quoi ? » de « 🔄 Changer des plats » → { total, familles: [{ id, nom, nombre }] } : les plats de la mer
 * (lireMer) qui pourraient entrer dans la cible (filtre dur des propositions, type `plat`, plats de la cible et
 * refusés exclus ; paliers 1 et 2 seulement, comme autreIdee avec `mer` : tout le monde en mange), `total` en tout et `familles` dans l'ordre de FAMILLES_MER, sans famille vide. Un
 * plat compte dans chacune de ses familles. Cible illisible : { total: 0, familles: [] }.
 */
export function choixDeLaMer(tousLesPlats, { cible = null, semaines = [], profils = [], evaluer = evaluerParDefaut, refuses = [], ecarter = null } = {}) {
  const ctx = contexte(tousLesPlats, { cible, semaines, profils, evaluer, type: 'plat', refuses, ecarter });
  const marins = ctx ? ctx.candidats.filter((c) => c.mer.deLaMer && c.palier < 3) : [];
  const familles = FAMILLES_MER.map((f) => ({ id: f.id, nom: f.nom, nombre: marins.filter((c) => c.mer.familles.includes(f.id)).length }))
    .filter((f) => f.nombre > 0);
  return { total: marins.length, familles };
}

/**
 * « 🔄 Changer des plats » (2026-10-18) : un remplaçant pour chacun des `platIds` (plats ou desserts actifs de
 * `semaine`, la semaine lue entière), pris l'un après l'autre dans l'ordre de la semaine (`ajouteLe`), comme autant de
 * « 🔄 Une autre idée » : chacun voit la semaine avec les échanges déjà décidés (variété, ECARTES_MAX, légumes), et
 * jamais un plat de `platIds` ni un remplaçant déjà choisi. `mer` : comme autreIdee (null : ce que l'app propose).
 * → { remplacements: [{ ancienId, platId, groupe, palier, raison }], restes: [ancienId] } (restes : sans remplaçant,
 * ils restent dans la semaine). Aucune écriture ici : semaine.js › ecrituresRemplacements.
 */
export function changerDesPlats(tousLesPlats, platIds, {
  semaine = null, semaines = [], profils = [], evaluer = evaluerParDefaut, refuses = [], mer = null, ecarter = null,
} = {}) {
  const lue = lireSemaine(semaine);
  if (!lue) return { remplacements: [], restes: [] };
  const demandes = [...new Set(listeDe(platIds).filter((id) => typeof id === 'string' && estDansLaSemaine(lue.plats[id])))]
    .sort((a, b) => (lue.plats[a].ajouteLe - lue.plats[b].ajouteLe) || parId(a, b));
  const remplacements = [];
  const restes = [];
  let courante = lue;
  for (const ancienId of demandes) {
    const cible = { id: courante.id, debut: courante.debut, fin: courante.fin, plats: courante.plats };
    const idee = autreIdee(tousLesPlats, ancienId, {
      cible, semaines, profils, evaluer, mer, ecarter,
      refuses: [...listeDe(refuses), ...demandes, ...remplacements.map((r) => r.platId)],
    });
    const ecritures = idee ? ecrituresRemplacement(courante, ancienId, idee.platId) : null;
    if (!idee || ecritures.code) {
      restes.push(ancienId);
      continue;
    }
    courante = lireSemaine({ ...appliquerChamps(courante, ecritures.champs), id: courante.id }) ?? courante;
    remplacements.push({ ancienId, ...idee });
  }
  return { remplacements, restes };
}

/** Vrai si « 🔄 Une autre idée » a sa place sur la feuille du plat : plat ou dessert avec sa recette, semaine avant les courses faites. */
export function peutChangerDIdee(semaine, plat) {
  const type = typeDe(plat);
  if (!estObjet(plat) || (type !== 'plat' && type !== 'dessert') || !aSaRecette(plat) || !peutAllerDansLaSemaine(plat)) return false;
  const lue = lireSemaine(semaine);
  return Boolean(lue) && RANGS_STATUT[statutSemaine(lue)] < RANGS_STATUT.courses_faites;
}

// ——— Textes ———

export const TEXTES_PROPOSER = Object.freeze({
  emoji: '✨',
  texteCarte: 'Laissez l’app proposer, ou choisissez vous-même\u00A0: la liste de courses se fait toute seule.',
  legumes: 'avec des légumes',
  pasDAutreDessert: 'Il n’y avait pas d’autre dessert à proposer.',
  complet: 'Les plats de la semaine sont déjà choisis.',
  causes: Object.freeze({
    recettes: 'Les autres plats n’ont pas encore leur recette.',
    cuisine: 'Les autres plats demandent un objet que vous n’avez pas.',
    recents: 'Les autres plats ont été mangés ces deux dernières semaines.',
    catalogue: 'Ajoutez des plats pour avoir plus d’idées.',
  }),
  sansProposition: Object.freeze({
    recettes: 'L’app proposera des plats quand ils auront leur recette.',
    cuisine: 'Vos plats demandent un objet que vous n’avez pas. Si vous l’avez finalement, changez-le dans Ma cuisine\u00A0; sinon, choisissez-les vous-même.',
    recents: 'Vos plats ont tous été mangés ces deux dernières semaines\u00A0: choisissez-les vous-même.',
  }),
  autreIdee: Object.freeze({
    emoji: '🔄',
    libelle: 'Une autre idée',
    aucune: 'Plus d’autre idée pour l’instant.',
    reglages: 'Invités et repas sont à régler de nouveau.',
  }),
  erreurs: Object.freeze({
    echec: 'Les plats proposés n’ont pas pu être ajoutés. Réessayez.',
    chevauche: 'Les dates de la semaine ont changé\u00A0: touchez de nouveau «\u00A0Proposer\u00A0».',
    inutile: 'Ces plats ont été réglés sur l’autre téléphone.',
  }),
  desserts: Object.freeze({
    emoji: '🍰',
    libelle: 'Proposer des desserts',
    titre: 'Combien de desserts\u00A0?',
    aide: 'Ils s’ajoutent aux plats de la semaine.',
    fermer: 'Fermer',
  }),
  // « 🔄 Changer des plats » (2026-10-18), sous les plats de la semaine.
  changer: Object.freeze({
    emoji: '🔄',
    libelle: 'Changer des plats',
    titre: 'Changer des plats',
    quels: 'Quels plats remplacer\u00A0?',
    parQuoi: 'Par quoi\u00A0?',
    app: 'Ce que l’app propose',
    merEmoji: '🐟',
    mer: 'Un plat de la mer',
    produit: 'Avec quel produit\u00A0?',
    peuImporte: 'Peu importe',
    aucunCoche: 'Cochez au moins un plat.',
    sansMer: 'Pas encore de plat de la mer à proposer.',
    autrePlat: 'Un plat précis en tête\u00A0? Ajoutez-le par «\u00A0Choisir d’autres plats\u00A0», puis «\u00A0Nouveau plat\u00A0».',
    faites: 'Les courses sont faites\u00A0: les plats ne se changent plus.',
    fermer: 'Fermer',
    echec: 'Les plats n’ont pas pu être changés. Réessayez.',
    echecRemise: 'Les plats n’ont pas pu être remis. Réessayez.',
  }),
});

const nomDe = (profil) => reduire(profil?.nom) || 'Sans prénom';
const estMoi = (profilId, moi) => Boolean(moi) && typeof moi.id === 'string' && moi.id === profilId;
const enumerer = (mots) => (mots.length > 1 ? `${mots.slice(0, -1).join(', ')} et ${mots[mots.length - 1]}` : mots.join(''));
/** « vous » pour la personne connectée, sinon le prénom ; null pour un profil inconnu. */
function qui(profilId, { moi, profils }) {
  if (estMoi(profilId, moi)) return 'vous';
  const profil = profilsLus(profils).find((p) => p.id === profilId);
  return profil ? nomDe(profil) : null;
}

/** « ✨ Proposer 4 plats » : { emoji: '✨', libelle: 'Proposer 4 plats' } ; « Proposer un plat » pour 1. */
export function libelleProposer({ plats } = {}) {
  const n = Number.isInteger(plats) && plats > 0 ? plats : 0;
  return { emoji: TEXTES_PROPOSER.emoji, libelle: n === 1 ? 'Proposer un plat' : `Proposer ${n}\u00A0plats` };
}

/** « 🍰 Proposer 2 desserts », « 🍰 Proposer un dessert » (bouton principal de « Combien de desserts ? »). */
export function libelleProposerDesserts(nombre) {
  const n = Number.isInteger(nombre) && nombre > 0 ? nombre : 1;
  return { emoji: TEXTES_PROPOSER.desserts.emoji, libelle: n === 1 ? 'Proposer un dessert' : `Proposer ${n}\u00A0desserts` };
}

/** Sous-titre de « Combien de desserts ? » : « Pour cette semaine. » ou « Pour la semaine du 17 au 23 octobre. ». */
export function sousTitreDesserts(cible, aujourdhui) {
  return plusTard(cible, aujourdhui) ? `Pour la semaine ${texteDates(cible.debut, cible.fin)}.` : 'Pour cette semaine.';
}

/** Nom accessible de « 🔄 Une autre idée » : « Remplacer « Gratin de pâtes » par une autre idée ». */
export function nomAutreIdee(nom) {
  return `Remplacer «\u00A0${reduire(nom)}\u00A0» par une autre idée`;
}

/** Bouton principal de « Changer des plats » : « Remplacer 2 plats », « Remplacer un plat », « Remplacer les plats cochés ». */
export function libelleChanger(nombre) {
  const n = Number.isInteger(nombre) && nombre > 0 ? nombre : 0;
  if (!n) return 'Remplacer les plats cochés';
  return n === 1 ? 'Remplacer un plat' : `Remplacer ${n}\u00A0plats`;
}

/** Puce d'une famille de la mer (choixDeLaMer) : « Saumon · 3 plats », « Crevettes · 1 plat » (le nombre jamais seul à la ligne). */
export function libelleFamille(famille) {
  const n = Number.isInteger(famille?.nombre) && famille.nombre > 0 ? famille.nombre : 0;
  return `${reduire(famille?.nom)}\u00A0· ${n}\u00A0plat${n > 1 ? 's' : ''}`;
}

/** « au saumon », « de la mer » (« tout ») ; null sans choix de la mer. */
function tournureMer(mer) {
  if (mer === 'tout') return 'de la mer';
  return FAMILLES_MER.find((f) => f.id === mer)?.au ?? null;
}

/** « Pas d’autre plat au saumon pour l’instant. », « … de la mer … » ; sans choix de la mer : « Plus d’autre idée pour l’instant. ». */
export function texteAucunChangement(mer = null) {
  const tournure = tournureMer(mer);
  return tournure ? `Pas d’autre plat ${tournure} pour l’instant.` : TEXTES_PROPOSER.autreIdee.aucune;
}

/**
 * Annonce de « Changer des plats », courte (elle passe sur les cartes changées) : « 2 plats changés. », « Un plat
 * changé. » ; moins que voulu : « Un plat changé sur 2 : pas d’autre plat au saumon pour l’instant. » (« … de la mer… »,
 * sans choix de la mer « … pas d’autre idée pour l’instant. »). Ni noms ni dates : les cartes changées sont à l'écran.
 * `reglages` (un plat changé avait des invités ou des repas écrits, partis avec lui) : « … Invités et repas sont à
 * régler de nouveau. », comme « 🔄 Une autre idée ».
 */
export function annonceChangement({ remplaces = 0, voulus = 0, mer = null, reglages = false } = {}) {
  const n = Number.isInteger(remplaces) && remplaces > 0 ? remplaces : 0;
  const total = Number.isInteger(voulus) && voulus > n ? voulus : n;
  const combien = n === 1 ? 'Un plat changé' : `${n}\u00A0plats changés`;
  const tournure = tournureMer(mer);
  const suite = tournure ? `pas d’autre plat ${tournure} pour l’instant.` : 'pas d’autre idée pour l’instant.';
  const phrase = total === n ? `${combien}.` : `${combien} sur ${total}\u00A0: ${suite}`;
  return reglages && n > 0 ? `${phrase} ${TEXTES_PROPOSER.autreIdee.reglages}` : phrase;
}

/**
 * Annonce de « 🔄 Une autre idée » : « « Curry de lentilles » à la place de « Gratin de pâtes ». » ; `reglages` (l'ancien
 * avait des réglages écrits) : « … Invités et repas sont à régler de nouveau. ».
 */
export function texteAutreIdee({ nouveau, ancien, reglages = false } = {}) {
  const phrase = `«\u00A0${reduire(nouveau)}\u00A0» à la place de «\u00A0${reduire(ancien)}\u00A0».`;
  return reglages ? `${phrase} ${TEXTES_PROPOSER.autreIdee.reglages}` : phrase;
}

/**
 * Raison d'un plat proposé, montrée dans sa feuille → texte ou null (recent, autre, raison inconnue) : « ✨ Proposé :
 * vous l’aimez. », « ✨ Proposé : vous et Adulte B l’aimez. », « ✨ Proposé : Adulte B l’aime. », « ✨ Proposé : Adulte A
 * et Enfant l’aiment. », « ✨ Proposé : à découvrir. », « ✨ Proposé : pas au menu depuis longtemps. ». La personne
 * connectée d'abord, puis les autres dans l'ordre des profils ; un profil retiré est ignoré. `legumes` (raisonDe, plats
 * seulement) : « ✨ Proposé : vous l’aimez · avec des légumes. », « ✨ Proposé : à découvrir · avec des légumes. », et
 * « ✨ Proposé : avec des légumes. » quand il n'y a rien d'autre à dire.
 */
export function texteRaison(raison, { moi = null, profils = [] } = {}) {
  const debut = `${TEXTES_PROPOSER.emoji} Proposé\u00A0: `;
  const legumes = raison?.legumes === true ? TEXTES_PROPOSER.legumes : null;
  const phrase = (texte) => {
    const parties = [texte, legumes].filter(Boolean);
    return parties.length ? `${debut}${parties.join(' · ')}.` : null;
  };
  if (raison?.code === 'decouvrir') return phrase('à découvrir');
  if (raison?.code === 'ancien') return phrase('pas au menu depuis longtemps');
  if (raison?.code !== 'aime') return phrase(null);
  const ids = new Set(listeDe(raison.profils));
  const moiAussi = [...ids].some((id) => estMoi(id, moi));
  const autres = profilsLus(profils).filter((p) => ids.has(p.id) && !estMoi(p.id, moi)).map(nomDe);
  const noms = [...(moiAussi ? ['vous'] : []), ...autres];
  if (!noms.length) return phrase(null);
  const verbe = moiAussi ? 'l’aimez' : noms.length > 1 ? 'l’aiment' : 'l’aime';
  return phrase(`${enumerer(noms)} ${verbe}`);
}

function plusTard(cible, aujourdhui) {
  return estObjet(cible) && jourValide(cible.debut) && jourValide(cible.fin) && jourValide(aujourdhui) && cible.debut > aujourdhui;
}

/** « pour Adulte B », « pour vous » ; '' pour un profil inconnu. */
const pourQui = (profilId, contexteTexte) => {
  const nom = qui(profilId, contexteTexte);
  return nom ? `pour ${nom}` : '';
};

/**
 * Phrase d'un plat du palier 3 retenu : « Un plat n’a pas encore de version pour vous : c’est écrit sur sa carte. »,
 * « Un plat n’est pas encore pour Enfant : … », « Enfant a dit « Jamais » à un plat : … » ; null pour un profil inconnu.
 */
function phraseEcarte(ecarte, mot, contexteTexte) {
  const nom = qui(ecarte?.profilId, contexteTexte);
  if (!nom) return null;
  const suite = '\u00A0: c’est écrit sur sa carte.';
  if (ecarte.raison === 'version') return `Un ${mot} n’a pas encore de version pour ${nom}${suite}`;
  if (ecarte.raison === 'age') return `Un ${mot} n’est pas encore pour ${nom}${suite}`;
  const aDit = nom === 'vous' ? 'Vous avez dit' : `${nom} a dit`;
  return `${aDit} «\u00A0Jamais\u00A0» à un ${mot}${suite}`;
}

/** Phrase de la cause (moins de plats que voulu) : « Les autres plats n’ont pas encore de version pour Adulte B. »… */
function phraseCause(cause, profilCause, contexteTexte) {
  const pour = pourQui(profilCause, contexteTexte);
  if (cause === 'versions' && pour) return `Les autres plats n’ont pas encore de version ${pour}.`;
  if (cause === 'age' && pour) return `Les autres plats ne sont pas encore ${pour}.`;
  if (cause === 'recettes' || cause === 'cuisine' || cause === 'recents') return TEXTES_PROPOSER.causes[cause];
  return TEXTES_PROPOSER.causes.catalogue;
}

/**
 * Annonce d'une proposition (plats ou desserts), deux phrases au plus, courte : elle passe sur les cartes qu'elle
 * annonce (retour du propriétaire, 2026-10-13 : « l'étiquette blanche prend trop de place »). `resultat` : proposerPlats
 * ou proposerDesserts, dont `choisis` ne garde que les plats vraiment ajoutés (le nombre annoncé est le leur).
 * Phrase 1 : « 4 plats proposés : 2 que vous aimez, 2 à découvrir. », « Un plat proposé. », « 2 desserts proposés… » ;
 * « que vous aimez » seulement pour les plats que `moi` a notés 4 ou 5, les autres aimés (et tous, sans `moi`) :
 * « 1 aimé à la maison » ; composition omise si un seul groupe montré (aimé, à découvrir) y figure.
 * Phrase 2, seulement si elle apprend quelque chose, la première qui s'applique : moins que voulu (plats : la cause ;
 * desserts : « Il n’y avait pas d’autre dessert à proposer. ») ; un plat du palier 3 (« Un plat n’a pas encore de
 * version pour Adulte B : c’est écrit sur sa carte. »). Sinon, rien (plus de « Touchez un plat pour le changer. »).
 * Ni dates ni restes, quel que soit le chemin, car rien de neuf : la semaine proposée est toujours, ensuite, celle que
 * Semaine montre, ses dates en titre juste au-dessus du bandeau (une semaine qui commence plus tard passe devant dès son
 * premier plat), et ses dates étaient sur le bouton touché (« Préparer la semaine du 17 au 23 octobre ») et en tête de
 * la feuille ; les articles pas pris de la semaine qui finit ne partent qu'avec une proposition faite depuis la feuille
 * qui vient de le dire (« Il reste 4 articles… Ils passeront sur la nouvelle liste. », avec « Ne pas les garder »).
 */
export function annonceProposition(resultat, { moi = null, profils = [] } = {}) {
  const dessert = resultat?.type === 'dessert';
  const mot = dessert ? 'dessert' : 'plat';
  const choisis = listeDe(resultat?.choisis).length ? listeDe(resultat.choisis)
    : listeDe(resultat?.ids).map((platId) => ({ platId, groupe: 'autre', palier: 1, ecartes: [] }));
  const n = choisis.length;
  const combien = n === 1 ? `Un ${mot} proposé` : `${n}\u00A0${mot}s proposés`;
  const aimes = choisis.filter((c) => c.groupe === 'aime');
  // « que vous aimez » : seulement les plats que la personne connectée a notés 4 ou 5 ; les autres aimés le sont « à
  // la maison » (jamais lui faire dire qu'elle aime un plat qu'un autre a noté).
  const vous = aimes.filter((c) => listeDe(c.raison?.profils).some((id) => estMoi(id, moi))).length;
  const maison = aimes.length - vous;
  const decouvrir = choisis.filter((c) => c.groupe === 'decouvrir').length;
  const parties = [];
  if (vous) parties.push(`${vous}\u00A0que vous aimez`);
  if (maison) parties.push(`${maison}\u00A0${maison > 1 ? 'aimés' : 'aimé'} à la maison`);
  if (decouvrir) parties.push(`${decouvrir}\u00A0à découvrir`);
  const phrase1 = parties.length > 1 ? `${combien}\u00A0: ${parties.join(', ')}.` : `${combien}.`;
  const contexteTexte = { moi, profils };
  let phrase2 = null;
  if (resultat?.code === 'peu') {
    phrase2 = dessert ? TEXTES_PROPOSER.pasDAutreDessert : phraseCause(resultat.cause, resultat.profilCause, contexteTexte);
  }
  if (!phrase2) {
    const ecarte = choisis.find((c) => c.palier === 3 && listeDe(c.ecartes).length);
    if (ecarte) phrase2 = phraseEcarte(ecarte.ecartes[0], mot, contexteTexte);
  }
  return phrase2 ? `${phrase1} ${phrase2}` : phrase1;
}

/**
 * Ligne sous le texte de la carte (et à la place du bouton ✨ dans la feuille) quand moins de PROPOSITION_MIN plats
 * sont proposables → texte ou null : « L’app proposera des plats quand ils auront leur recette. », « … quand ils
 * auront une version pour Adulte B. » (« pour vous »), « Vos plats ont tous été mangés ces deux dernières semaines :
 * choisissez-les vous-même. » ; null pour un catalogue vide, « Jamais » (voulu par la personne) ou l'âge.
 */
export function texteSansProposition(cause, { moi = null, profils = [], profilCause = null } = {}) {
  if (cause === 'recettes' || cause === 'cuisine' || cause === 'recents') return TEXTES_PROPOSER.sansProposition[cause];
  if (cause === 'versions') {
    const pour = pourQui(profilCause, { moi, profils });
    return pour ? `L’app proposera des plats quand ils auront une version ${pour}.` : null;
  }
  return null;
}
