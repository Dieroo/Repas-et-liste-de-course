// Plan du batch (2026-10-19, décisions 15 à 23 du propriétaire, après la première semaine de l'utilisatrice des
// courses : 1 kg de pommes de terre cuit en deux fois au Cookeo pour deux plats). Elle demande d'un toucher le plan de
// batch de la semaine ; le gestionnaire envoie la demande à Claude (DEMANDE-BATCH) et colle sa réponse ; elle suit le
// plan étape par étape (#/batch/<semaine>). Claude regroupe ce qui se prépare et cuit de la même façon pour plusieurs
// plats, ordonne les étapes pour une seule personne et donne le récipient de chaque plat et sa taille selon ses
// portions ; l'app affiche les quantités de la semaine (cuisine.js › quantitesACuisiner), les rappels du four et des
// parts à mettre de côté, et la fin de chaque plat. Aucun minuteur (décision du propriétaire). Le plan ne change
// jamais les recettes : il vaut pour la semaine seulement.
// Plats du batch : ceux de la semaine (semaine.js › platsDeLaSemaine) qui ont leur recette et que quelqu'un mange,
// apéros exclus. Le plan vit dans `plansBatch/<semaine>` avec son empreinte (plats, recettes et parts) : un plan dont
// l'empreinte n'est plus celle de la semaine est périmé (« Redemander ») ; des portions changées depuis le plan le
// laissent servir (les quantités suivent), avec une phrase.
// Logique pure : ni DOM ni Firebase, aucune écriture ; rien sur les personnes ne part vers Claude (parts anonymes).
import { cleProduit, slug } from './slug.js';
import { VOCABULAIRES, estObjet, marqueursEffectifs, texte } from './vocabulaire.js';
import { aSaRecette, typeDe } from './plats.js';
import {
  RANGS_STATUT, jourDeDerniereFois, lireSemaine, platsDeLaSemaine, statutSemaine, texteDates, texteJour,
} from './semaine.js';
import {
  CONSEILS, TEXTES_CUISINE, aussiDeLEtape, finDeCuisson, hygieneDuPlat, lignesEnfant, phrasesDeFin, precautionsDuPlat,
  quantitesACuisiner, quantitesDeLEtape, rappelsDuDeroule, texteQuantiteCuisine, arrondiCuisine,
} from './cuisine.js';
import {
  AUSSI_MAX, DUREE_MAX_MIN, FEUX, MODE_MAX, PRET_MAX, TEXTE_LONG, TEXTE_MAX, TITRE_MAX, USTENSILES_MAX, USTENSILE_MAX,
  empreinteEtapes, etapesLisibles, ligneAppareil, ligneDuree, texteDuree,
} from './realisation.js';
import { cuissonEnTexte, empreinteDeTexte } from './empreinte.js';
import { estDansCorbeille } from './corbeille.js';
import { deNom } from './notes.js';
import { VERSION_INSTRUCTIONS, appareilsActifs, cuisineDeLaDemande } from './claude.js';

const FORMAT = 'paquet@1';
/** En-tête du texte copié pour Claude. */
export const ENTETE_DEMANDE_BATCH = `DEMANDE-BATCH ${FORMAT}`;
/** Plats qu'il faut au moins dans la semaine pour qu'un plan de batch ait un sens (décision 23). */
export const PLATS_BATCH_MIN = 2;
/** Étapes d'un plan, au plus. */
export const ETAPES_BATCH_MAX = 60;
/** Récipient et taille : caractères, au plus. */
export const RECIPIENT_MAX = 40;
export const TAILLE_MAX = 60;
/** Températures d'un four ou d'un airfryer acceptées dans un plan. */
const TEMP_MIN = 30;
const TEMP_MAX = 300;
const APPAREILS_A_PRECHAUFFER = ['four', 'airfryer'];
const MODES = ['cookeo', 'airfryer', 'monsieur_cuisine'];

const estNombre = (valeur) => typeof valeur === 'number' && Number.isFinite(valeur);
const estEntier = (valeur, min, max) => Number.isInteger(valeur) && valeur >= min && valeur <= max;
const listeDe = (valeur) => (Array.isArray(valeur) ? valeur : []);
const propre = (valeur) => Math.round(valeur * 1e6) / 1e6;
const majuscule = (valeur) => (valeur ? `${valeur.charAt(0).toLocaleUpperCase('fr-FR')}${valeur.slice(1)}` : valeur);
const guillemets = (valeur) => `«\u00A0${valeur}\u00A0»`;
const nomDe = (profil) => texte(profil?.nom) || 'Sans prénom';
const estMoi = (profil, moi) => Boolean(moi) && typeof moi.id === 'string' && moi.id === profil?.id;
const laPart = (profil, moi) => (estMoi(profil, moi) ? 'votre part' : `la part ${deNom(nomDe(profil))}`);
const sansPoint = (valeur) => texte(valeur).replace(/[\s.!…;,:]+$/u, '');
const nombreFr = new Intl.NumberFormat('fr-FR', { maximumFractionDigits: 2 });
const portionsEnMots = (n) => `${nombreFr.format(n)}\u00A0${n > 1 ? 'portions' : 'portion'}`;
/** Une ligne de texte copié : sans retour à la ligne (un nom saisi ne casse jamais la forme du texte). */
const ligne = (valeur) => texte(typeof valeur === 'number' ? String(valeur) : valeur);

// ——— Textes ———

export const TEXTES_PLAN_BATCH = Object.freeze({
  titreCarte: '👩‍🍳 Le batch de la semaine',
  // Sans « Claude » : la vue « Repas et courses » ne le nomme jamais (décision du 2026-10-16).
  invitation: (n) => `Un seul plan pour cuisiner vos ${n}\u00A0plats d’un coup\u00A0: les cuissons en commun, l’ordre des étapes et la taille des plats de cuisson.`,
  invitationGestionnaire: 'Envoyez la demande à Claude, puis collez sa réponse\u00A0: le plan apparaîtra ici, prêt à suivre.',
  // Avant « 📤 Envoyer à Claude » (comme la fiche, essai du 2026-10-15) : le menu « Partager » ne propose pas le projet.
  guidageEnvoi: 'Dans l’app Claude, ouvrez d’abord une conversation dans votre projet de recettes\u00A0: le menu «\u00A0Partager\u00A0» ne propose pas le projet. Touchez ensuite «\u00A0Envoyer à Claude\u00A0», choisissez Claude, puis cette conversation\u00A0: la demande est jointe au message. Envoyez, puis revenez ici et touchez «\u00A0Coller la réponse\u00A0».',
  recopier: 'Les plats ont changé depuis la copie\u00A0: recopiez la demande.',
  retirer: 'Retirer la demande',
  retiree: 'Demande retirée.',
  demander: '📬 Demander le plan du batch',
  redemander: '📬 Redemander le plan',
  demande: (quand) => `📬 Demandé ${quand}. Il apparaîtra ici dès qu’il sera prêt.`,
  demandeHorsLigne: '📬 Demandé. La demande partira au retour du réseau.',
  demandePar: (qui, quand) => `📬 Demandé par ${qui} ${quand}.`,
  demandeSansAuteur: (quand) => `📬 Demandé ${quand}.`,
  envoyer: '📤 Envoyer à Claude',
  copier: '📋 Copier la demande',
  coller: 'Coller la réponse',
  commencer: 'Commencer le batch ›',
  portionsChangees: 'Les portions ont changé depuis le plan\u00A0: les quantités suivent, vérifiez la taille des plats de cuisson.',
  perime: 'Les plats ont changé depuis le plan\u00A0: il faut le redemander.',
  notification: 'Plan du batch à préparer',
  titreCarteCourt: 'Le batch de la semaine',
  planPret: (environ) => `Le plan est prêt.${environ ? ` ${environ}.` : ''}`,
  copiee: 'Demande copiée. Collez-la dans une conversation de votre projet Claude, envoyez, puis revenez ici et touchez «\u00A0Coller la réponse\u00A0».',
  envoyee: 'Demande envoyée. Dans Claude, vérifiez qu’elle est jointe au message, puis envoyez. Revenez ensuite ici et touchez «\u00A0Coller la réponse\u00A0».',
  envoiAnnule: 'Envoi annulé.',
  envoiRate: 'L’envoi n’a pas marché. Touchez «\u00A0📋 Copier la demande\u00A0», puis collez-la dans Claude.',
  copieRatee: 'La copie n’a pas marché. Réessayez.',
  nomFichier: (semaineId) => `batch-${semaineId}-demande.txt`,
  // Écran #/batch/<semaine>.
  titrePage: (n) => `Batch\u00A0: ${n}\u00A0plats`,
  lesPlats: 'Les plats',
  recipients: 'Les plats de cuisson',
  recipient: (nom, ustensile, taille) => `${nom}\u00A0: ${ustensile}${taille ? ` · ${taille}` : ''}`,
  pour: (noms) => `Pour\u00A0: ${noms}`,
  fin: 'Batch terminé 🎉',
  termine: 'Batch terminé ›',
  revenir: 'Revenir à la semaine',
  pourTous: 'Pour tous les plats',
  leJourDuRepas: 'Le jour du repas',
  voirLaRecette: 'Voir la recette ›',
  introuvable: 'Ce plan de batch n’est plus là.',
  perimeEcran: 'Les plats de la semaine ont changé depuis ce plan. Demandez-en un nouveau depuis Semaine.',
  // Demandes (gestionnaire).
  sectionDemandes: 'Plan du batch',
  semaineDu: (dates) => `Semaine ${dates}`,
  // Écran « Ajouter des recettes » (réponse de Claude collée).
  apercuTitre: '👩‍🍳 Plan du batch reçu',
  apercuEtapes: (n, environ) => `${n}\u00A0${n > 1 ? 'étapes' : 'étape'}${environ ? ` · ${environ}` : ''}.`,
  apercuPlats: (noms) => `Pour\u00A0: ${noms}.`,
  voirLesEtapes: 'Voir les étapes',
  remplace: 'Il remplace le plan déjà enregistré pour cette semaine.',
  enregistrer: 'Enregistrer le plan du batch',
  enregistre: 'Plan du batch enregistré.',
  horsLigne: 'Hors ligne\u00A0: le plan est gardé sur ce téléphone et partira au retour du réseau.',
  echec: 'Le plan du batch n’a pas pu être enregistré. Réessayez.',
  titreAutreSemaine: 'Plan d’une autre semaine',
  autreSemaine: 'Ce plan est pour une autre semaine que celle de l’app. Demandez un nouveau plan depuis Semaine.',
  titrePerime: 'Plan à redemander',
  perimeImport: 'Les plats de la semaine ont changé depuis la demande. Recopiez la demande depuis Semaine, puis collez la nouvelle réponse de Claude.',
  ouvrirSemaine: 'Ouvrir Semaine',
});

/** « aujourd’hui », « hier », « le 24 octobre » (jour 'AAAA-MM-JJ' de la demande, aujourd'hui en 'AAAA-MM-JJ'). */
export function quandDemande(jour, aujourdhui) {
  if (typeof jour !== 'string' || !texteJour(jour)) return '';
  if (jour === aujourdhui) return 'aujourd’hui';
  return `le ${texteJour(jour)}`;
}

// ——— Plats du batch ———

/**
 * Plats du batch d'une semaine → [{ platId, plat, element, quantites }] dans l'ordre de la semaine : plats présents,
 * avec leur recette, que quelqu'un mange (portions à cuisiner ou à congeler), hors apéros et corbeille ; `element` :
 * celui de semaine.js › platsDeLaSemaine, avec `semaine: { id, debut, fin }` (comme cuisine.js › elementPourCuisiner) ;
 * `quantites` : cuisine.js › quantitesACuisiner pour la semaine. Semaine illisible : [].
 */
export function platsDuBatch(semaine, { tousLesPlats = [], profils = [], evaluer = undefined, reglages = null } = {}) {
  const lue = lireSemaine(semaine);
  if (!lue) return [];
  return platsDeLaSemaine(lue, { tousLesPlats, profils, evaluer, reglages })
    .filter((e) => e.etat === 'ok' && estObjet(e.plat) && aSaRecette(e.plat) && !estDansCorbeille(e.plat)
      && typeDe(e.plat) !== 'apero' && estNombre(e.aCuire) && estNombre(e.aCongeler) && e.aCuire + e.aCongeler > 0)
    .map((e) => {
      const element = { ...e, semaine: { id: lue.id, debut: lue.debut, fin: lue.fin } };
      return { platId: e.platId, plat: e.plat, element, quantites: quantitesACuisiner(e.plat, element) };
    });
}

/**
 * Parts d'un plat du batch, anonymes, les identiques réunies : [{ texte : « sans jambon blanc (avec thon au naturel) »,
 * portions }], dans l'ordre des versions.
 */
function partsAnonymes(quantites) {
  const sortie = [];
  for (const part of listeDe(quantites?.parts)) {
    const sans = part.retirer.length ? `sans ${part.retirer.join(', ')}` : '';
    const avec = part.ajouts.length ? `avec ${part.ajouts.map((a) => a.produit).join(', ')}` : '';
    const morceau = sans && avec ? `${sans} (${avec})` : sans || avec;
    if (!morceau) continue;
    const portions = estNombre(part.portions) ? part.portions : 0;
    const deja = sortie.find((p) => p.texte === morceau);
    if (deja) deja.portions = propre(deja.portions + portions);
    else sortie.push({ texte: morceau, portions });
  }
  return sortie;
}

/** Clés des produits que la recette ne cite qu'aux étapes « le jour du repas » : donnés à part, jamais à citer. */
function produitsAuService(plat) {
  const auService = new Set();
  const avant = new Set();
  for (const etape of etapesLisibles(plat).etapes) {
    for (const cite of listeDe(etape.ingredients)) {
      const cle = cleProduit(typeof cite === 'string' ? cite : cite?.produit);
      if (cle) (etape.auService ? auService : avant).add(cle);
    }
  }
  return new Set([...auService].filter((cle) => !avant.has(cle)));
}

/**
 * Ingrédients d'un plat du batch, comme la demande les donne → { aCiter: Map clé → nom (quelqu'un en mange, pas
 * seulement au service : chacun doit être cité), lignes (celles de `ingrédients:`), auService (celles de `au service:`),
 * connus: Map clé → nom (tous les ingrédients de la fiche : une citation retrouvée parmi eux est gardée) }.
 */
function ingredientsDuPlat(element) {
  const service = produitsAuService(element.plat);
  const aCiter = new Map();
  const connus = new Map();
  const lignes = [];
  const auService = [];
  for (const l of listeDe(element.quantites?.lignes)) {
    const cle = cleProduit(l.produit);
    if (!cle) continue;
    if (!connus.has(cle)) connus.set(cle, l.produit);
    if (l.personne) continue;
    if (service.has(cle)) {
      auService.push(l);
      continue;
    }
    lignes.push(l);
    if (!aCiter.has(cle)) aCiter.set(cle, l.produit);
  }
  return { aCiter, connus, lignes, auService };
}

/**
 * Empreinte d'un plan de batch (6 caractères), ou null sans plat : ce que la demande donne à Claude, sans quantités ni
 * portions (2026-10-19, relecture) : par plat, son identifiant, les ingrédients à citer et ceux du service, les étapes
 * (titre, détail, texte), la cuisson et les parts. Un invité de plus, une quantité ou un repère changé gardent le plan ;
 * un plat ajouté ou retiré, une étape changée, un ingrédient que plus personne ne mange (ou de nouveau), une autre
 * version servie le périment. Un ordre différent des plats donne la même empreinte.
 */
export function empreintePlanBatch(elements) {
  const lignes = listeDe(elements).filter((e) => estObjet(e) && typeof e.platId === 'string' && estObjet(e.plat)).map((e) => {
    const { aCiter, auService } = ingredientsDuPlat(e);
    const etapes = etapesLisibles(e.plat).etapes.filter((x) => !x.auService)
      .map((x) => [ligne(x.titre), detailEtape(x), ligne(x.texte)].join('~'));
    return [
      e.platId, [...aCiter.keys()].sort().join(','), [...new Set(auService.map((l) => cleProduit(l.produit)))].sort().join(','),
      etapes.join('/'), cuissonEnTexte(e.plat.cuisson), partsAnonymes(e.quantites).map((p) => p.texte).join(';'),
    ].join('|');
  }).sort();
  return lignes.length ? empreinteDeTexte(lignes.join('\n')) : null;
}

/** Portions de chaque plat du batch : { platId: portions }. */
export function portionsDuBatch(elements) {
  const sortie = {};
  for (const e of listeDe(elements)) if (estObjet(e) && typeof e.platId === 'string') sortie[e.platId] = propre(e.quantites?.portions ?? 0);
  return sortie;
}

// ——— Demande pour Claude ———

const CONSIGNE_BATCH = '(Organise le batch de ces plats pour une seule personne, selon la section « DEMANDE-BATCH » : regroupe ce qui se prépare et cuit de la même façon pour plusieurs plats, fais avancer les plats en même temps selon les appareils, et donne le récipient de chaque plat et sa taille pour ses portions, et celui d\'une part qui cuit à part. Ne change ni les ingrédients, ni les quantités, ni la manière de cuire. Cite chaque ingrédient de la ligne `ingrédients:` de chaque plat, écrit exactement comme elle, avec l\'`id` de son plat ; jamais ceux de `au service:`. Rends seulement { "format", "instructions", "batch": { "semaine", "empreinte", "dureeTotale", "travail", "recipients", "etapes" } }, `semaine` et `empreinte` recopiées telles quelles, en un seul bloc.)';

/** « 600 g pâtes courtes », « 3 oignon jaune » (pièces sans unité), « sel fin » sans mesure. */
function quantitePourClaude(ligneQte) {
  const unite = ligneQte.unite === 'pc' ? '' : ligne(ligneQte.unite);
  const qte = estNombre(ligneQte.qte) && ligneQte.qte > 0 ? nombreFr.format(ligneQte.qte).replace(/\s/g, '') : '';
  return [qte, unite, ligne(ligneQte.produit)].filter(Boolean).join(' ');
}

const nombreCourt = (n) => nombreFr.format(n).replace(/\s/g, '');

/** « 10 min dont 1 min de travail ; plaque, feu vif ; ingrédients : oignon jaune, beurre (part 0,5) ; la veille » */
function detailEtape(etape) {
  const morceaux = [];
  if (estNombre(etape.duree)) {
    const actif = estNombre(etape.actif) ? etape.actif : etape.duree;
    morceaux.push(actif < etape.duree ? `${etape.duree} min dont ${actif} min de travail` : `${etape.duree} min`);
  }
  const appareil = [etape.appareil, etape.feu ? `feu ${etape.feu}` : '', estNombre(etape.tempC) ? `${etape.tempC} °C` : '', etape.mode ?? '']
    .filter(Boolean).join(', ');
  if (appareil) morceaux.push(appareil);
  const cites = listeDe(etape.ingredients).map((i) => {
    const produit = ligne(typeof i === 'string' ? i : i?.produit);
    const part = estObjet(i) && estNombre(i.part) && i.part > 0 && i.part < 1 ? i.part : null;
    return produit && part !== null ? `${produit} (part ${nombreCourt(part)})` : produit;
  }).filter(Boolean);
  if (cites.length) morceaux.push(`ingrédients : ${cites.join(', ')}`);
  if (listeDe(etape.ustensiles).length) morceaux.push(`ustensiles : ${etape.ustensiles.map(ligne).join(', ')}`);
  if (etape.veille) morceaux.push('la veille');
  if (etape.partAvant) morceaux.push('parts mises de côté avant');
  return morceaux.join(' ; ');
}

/**
 * Texte copié pour demander à Claude le plan de batch d'une semaine (DEMANDE-BATCH) : semaine (identifiant, que Claude
 * recopie), empreinte (empreintePlanBatch, recopiée), appareils du foyer et lignes de « Ma cuisine » (claude.js ›
 * cuisineDeLaDemande : `reglages`, sinon `appareils` comme avant), nombre de plats,
 * consigne, puis pour chaque plat du batch (platsDuBatch, dans l'ordre de la semaine) : `id`, `nom`, `portions à
 * cuisiner` (de la semaine, « (dont 2 à congeler) »), `ingrédients:` (quantités de la semaine, arrondies ; un ingrédient
 * que toutes les parts retirent est omis ; ceux qui ne servent qu'au service vont dans `au service:`), `étapes:` (une
 * ligne par étape de la recette, « le jour du repas » exclues, parts d'ingrédient comprises), `cuisson:`, `se garde:`,
 * `parts à mettre de côté:` (anonymes, avec leurs portions). Rien sur les personnes : ni profil, ni prénom.
 */
export function texteDemandeBatch(elements, { semaine = null, appareils = null, reglages = null } = {}) {
  const lue = lireSemaine(semaine);
  const plats = listeDe(elements).filter((e) => estObjet(e) && estObjet(e.plat));
  const cuisine = cuisineDeLaDemande({ appareils, reglages });
  const lignes = [
    ENTETE_DEMANDE_BATCH,
    `instructions: ${VERSION_INSTRUCTIONS}`,
    `semaine: ${ligne(lue?.id ?? '')}`,
    `empreinte: ${empreintePlanBatch(plats) ?? ''}`,
    `appareils: ${cuisine.appareils.join(', ')}`,
    ...cuisine.cuisine,
    `nombre: ${plats.length}`,
    CONSIGNE_BATCH,
    'plats:',
  ];
  for (const element of plats) {
    const { platId, plat, quantites } = element;
    lignes.push(`- id: ${ligne(platId)}`);
    lignes.push(`  nom: ${ligne(plat.nom)}`);
    const aCongeler = estNombre(element.element?.aCongeler) ? element.element.aCongeler : 0;
    lignes.push(`  portions à cuisiner: ${nombreCourt(propre(quantites.portions))}${aCongeler > 0 ? ` (dont ${nombreCourt(propre(aCongeler))} à congeler)` : ''}`);
    const { lignes: aCiter, auService } = ingredientsDuPlat(element);
    lignes.push(`  ingrédients: ${aCiter.map(quantitePourClaude).join(' ; ')}`);
    if (auService.length) lignes.push(`  au service: ${auService.map(quantitePourClaude).join(' ; ')}`);
    const etapes = etapesLisibles(plat).etapes.filter((e) => !e.auService);
    if (etapes.length) {
      lignes.push('  étapes:');
      etapes.forEach((etape, i) => {
        const detail = detailEtape(etape);
        const corps = ligne(etape.texte);
        lignes.push(`    ${i + 1}. ${ligne(etape.titre)}${detail ? ` (${detail})` : ''}${corps ? ` : ${corps}` : ''}`);
      });
    }
    const cuisson = cuissonEnTexte(plat.cuisson);
    if (cuisson) lignes.push(`  cuisson: ${cuisson}`);
    const garde = [];
    if (Number.isInteger(plat.conservation?.frigoJours)) garde.push(`${plat.conservation.frigoJours} jours au frigo`);
    if (plat.conservation?.congelable === false) garde.push('ne se congèle pas');
    else if (plat.conservation?.congelable === true) garde.push('se congèle');
    if (garde.length) lignes.push(`  se garde: ${garde.join(' ; ')}`);
    const parts = partsAnonymes(quantites);
    if (parts.length) {
      // Texte copié pour Claude : espaces ordinaires (le document des instructions n'en a pas d'autres).
      const portions = (n) => `${nombreCourt(n)} ${n > 1 ? 'portions' : 'portion'}`;
      lignes.push(`  parts à mettre de côté: ${parts.map((p) => (p.portions > 0 ? `${p.texte} — ${portions(p.portions)}` : p.texte)).join(' ; ')}`);
    }
  }
  return lignes.join('\n');
}

// ——— Réponse de Claude ———

/** Plan de batch d'une réponse collée (objets paquet@1 extraits) → { batch, instructions } du premier objet qui porte `batch`, sinon null. */
export function planDeLaReponse(paquets) {
  for (const paquet of listeDe(paquets)) {
    if (estObjet(paquet) && Object.hasOwn(paquet, 'batch')) return { batch: paquet.batch, instructions: paquet.instructions ?? null };
  }
  return null;
}

/** Vrai si une réponse collée porte un plan de batch (clé `batch` à la racine d'un objet). */
export const estReponseBatch = (paquets) => planDeLaReponse(paquets) !== null;

/** Texte court d'une réponse : texte non vide de `max` caractères au plus, sinon null. */
function texteBorne(valeur, max) {
  const lu = texte(valeur);
  return lu && [...lu].length <= max ? lu : null;
}

const erreur = (message, pourClaude) => ({ message, pourClaude });
const avertissement = (message) => ({ message });
/** Vrai pour `true` ou le texte « true » (une réponse de Claude peut écrire l'un ou l'autre). */
const vrai = (valeur) => valeur === true || valeur === 'true';
/** Entier d'une réponse : un entier, ou un texte de chiffres (« 80 ») ; sinon null. */
const entierLu = (valeur) => {
  if (Number.isInteger(valeur)) return valeur;
  return typeof valeur === 'string' && /^\s*\d+\s*$/.test(valeur) ? Number(valeur) : null;
};
/** Texte d'une réponse, un nombre écrit sans guillemets compris (« semaine », « empreinte »). */
const texteOuNombre = (valeur) => (typeof valeur === 'number' && Number.isFinite(valeur) ? String(valeur) : texte(valeur));
/** Texte coupé à `max` caractères → { valeur (null si vide), coupe }. */
function coupe(valeur, max) {
  const lu = texte(valeur);
  if (!lu) return { valeur: null, coupe: false };
  const signes = [...lu];
  return signes.length <= max ? { valeur: lu, coupe: false } : { valeur: signes.slice(0, max).join('').trim(), coupe: true };
}
const NOMS_APPAREILS = Object.freeze({
  plaque: 'la plaque', four: 'le four', cookeo: 'le Cookeo', airfryer: 'l’airfryer', monsieur_cuisine: 'le Monsieur Cuisine',
});

/** Ingrédient cité retrouvé parmi `connus` (Map clé → nom) : même clé, sinon la seule clé qui la prolonge ou qu'elle prolonge (« oignon » → « oignon jaune ») → { cle, produit } | null. */
function retrouver(nomCite, connus) {
  const cle = cleProduit(nomCite);
  if (!cle) return null;
  if (connus.has(cle)) return { cle, produit: connus.get(cle) };
  const proches = [...connus.keys()].filter((k) => k.startsWith(`${cle}-`) || cle.startsWith(`${k}-`));
  return proches.length === 1 ? { cle: proches[0], produit: connus.get(proches[0]) } : null;
}

/** Appareils et températures des étapes de la recette (« le jour du repas » exclues), sinon de sa cuisson : Map appareil → [tempC]. */
function appareilsDeLaRecette(plat) {
  const sortie = new Map();
  const noter = (appareil, tempC) => {
    if (!VOCABULAIRES.appareil.includes(appareil)) return;
    if (!sortie.has(appareil)) sortie.set(appareil, []);
    if (estNombre(tempC)) sortie.get(appareil).push(tempC);
  };
  for (const etape of etapesLisibles(plat).etapes) if (!etape.auService && etape.appareil) noter(etape.appareil, etape.tempC);
  if (!sortie.size) for (const c of listeDe(plat?.cuisson)) if (estObjet(c)) noter(c.appareil, c.tempC);
  return sortie;
}

/**
 * Valide un plan de batch reçu → { plan | null, erreurs: [{ message, pourClaude }], avertissements: [{ message }],
 * refus: null | 'semaine' | 'perime' }.
 * `brut` : la valeur de `batch` ; `elements` : platsDuBatch de la semaine montrée ; `semaineId`, `empreinte` : les
 * siens (sans semaine : refus `semaine`) ; `appareils` : reglages.appareils, ou les codes de ma-cuisine.js ›
 * appareilsDuFoyer (un appareil absent du foyer : avertissement).
 * Refus (rien n'est enregistrable, rien à corriger par Claude) : plan d'une autre semaine (`semaine`), ou d'avant un
 * changement des plats (`perime` : empreinte différente). Erreurs (« Copier les corrections pour Claude ») : forme,
 * durées, plat inconnu, étape sans plat, plat absent de toutes les étapes, manière de cuire changée (appareil de la
 * recette absent des étapes de son plat, four ou airfryer à plus de 10 °C de la recette). Avertissements (le plan reste
 * enregistrable) : ingrédient cité inconnu de son plat (retiré ; un ajout d'une part, retiré sans rien dire), ingrédient
 * jamais cité, parts de plus de 1, étape « le jour du repas » retirée, nom de récipient raccourci, temps de travail
 * ramené à la durée, four allumé nulle part, part sans étape, champs facultatifs fautifs (retirés), texte long.
 * Souplesse (2026-10-19, relecture) : un nombre écrit en texte, `true` écrit « true », un ingrédient en texte sur une
 * étape d'un seul plat, un nom approché (« oignon » pour « oignon jaune »), `partAvant: true` (les plats de l'étape qui
 * ont une part) ou une liste, une étape sans `plats` dont les ingrédients disent le plat, ou qui allume le four (le plat
 * de son prochain usage).
 * Plan normalisé : { semaine, empreinte, dureeTotale, travail, recipients: [{ plat, ustensile, taille }], etapes: [{
 * titre, texte, duree, actif, appareil, mode, tempC, feu, ustensiles, plats, ingredients: [{ produit, plat, part }],
 * aussi, pret, prechauffer, partAvant: [platId], veille }] }.
 */
export function validerPlanBatch(brut, { elements = [], semaineId = null, empreinte = null, appareils = null } = {}) {
  const erreurs = [];
  const avertissements = [];
  const sortie = (plan, refus = null) => ({ plan: erreurs.length || refus ? null : plan, erreurs, avertissements, refus });
  if (!estObjet(brut)) {
    erreurs.push(erreur('Le plan de batch est illisible.', 'batch : objet attendu'));
    return sortie(null);
  }
  if (!texte(semaineId)) return sortie(null, 'semaine');
  const semaineLue = texteOuNombre(brut.semaine);
  if (semaineLue !== texte(semaineId)) {
    if (!semaineLue) erreurs.push(erreur('Le plan ne dit pas pour quelle semaine il est.', `batch.semaine : « ${semaineId} » attendu`));
    else return sortie(null, 'semaine');
  }
  const empreinteLue = texteOuNombre(brut.empreinte);
  if (empreinteLue !== texte(empreinte)) {
    if (!empreinteLue) erreurs.push(erreur('Le plan n’a pas recopié l’empreinte de la demande.', `batch.empreinte : « ${empreinte} » attendu`));
    else return sortie(null, 'perime');
  }
  const parId = new Map(listeDe(elements).filter((e) => estObjet(e) && typeof e.platId === 'string').map((e) => [e.platId, e]));
  const nom = (platId) => texte(parId.get(platId)?.plat?.nom) || platId;
  const actifs = new Set(appareilsActifs(appareils));
  const ingredients = new Map([...parId].map(([platId, e]) => [platId, ingredientsDuPlat(e)]));
  const ajoutsDesParts = new Map([...parId].map(([platId, e]) => [platId, new Map(listeDe(e.quantites?.parts)
    .flatMap((p) => p.ajouts).map((a) => [cleProduit(a.produit), a.produit]))]));
  const aDesParts = (platId) => listeDe(parId.get(platId)?.quantites?.parts).length > 0;

  const dureeTotale = entierLu(brut.dureeTotale);
  const dureeLue = dureeTotale !== null && dureeTotale >= 1 && dureeTotale <= DUREE_MAX_MIN;
  if (!dureeLue) {
    erreurs.push(erreur(brut.dureeTotale === undefined ? 'La durée du batch manque.' : 'La durée du batch est illisible.',
      `batch.dureeTotale : entier de 1 à ${DUREE_MAX_MIN} attendu`));
  }
  let travail = entierLu(brut.travail);
  if (travail === null || travail < 1) {
    erreurs.push(erreur(brut.travail === undefined ? 'Le temps de travail du batch manque.' : 'Le temps de travail du batch est illisible.',
      'batch.travail : entier de 1 à dureeTotale attendu'));
  } else if (dureeLue && travail > dureeTotale) {
    avertissements.push(avertissement('Le temps de travail dépasse la durée du batch\u00A0: il est ramené à la durée.'));
    travail = dureeTotale;
  }

  // Récipients.
  const recipients = [];
  if (brut.recipients !== undefined && !Array.isArray(brut.recipients)) {
    erreurs.push(erreur('Les plats de cuisson sont illisibles.', 'batch.recipients : liste attendue'));
  }
  listeDe(brut.recipients).forEach((r, i) => {
    const code = `batch.recipients[${i}]`;
    if (!estObjet(r) || typeof r.plat !== 'string') {
      erreurs.push(erreur('Un plat de cuisson est illisible.', `${code} : { "plat", "ustensile", "taille" } attendu`));
      return;
    }
    if (!parId.has(r.plat)) {
      erreurs.push(erreur('Un plat de cuisson est donné pour un plat qui n’est pas dans la semaine.', `${code}.plat : « ${ligne(r.plat)} » n'est pas un plat de la demande`));
      return;
    }
    const ustensile = coupe(r.ustensile, RECIPIENT_MAX);
    if (!ustensile.valeur) {
      erreurs.push(erreur(`Le plat de cuisson de ${guillemets(nom(r.plat))} n’est pas nommé.`, `${code}.ustensile : texte de 1 à ${RECIPIENT_MAX} caractères attendu`));
      return;
    }
    if (ustensile.coupe) avertissements.push(avertissement(`Le nom du plat de cuisson de ${guillemets(nom(r.plat))} est long\u00A0: il est raccourci.`));
    const taille = coupe(r.taille, TAILLE_MAX);
    if (r.taille !== undefined && !taille.valeur) avertissements.push(avertissement(`La taille du plat de cuisson de ${guillemets(nom(r.plat))} est illisible\u00A0: elle n’est pas reprise.`));
    if (taille.coupe) avertissements.push(avertissement(`La taille du plat de cuisson de ${guillemets(nom(r.plat))} est longue\u00A0: elle est raccourcie.`));
    recipients.push({ plat: r.plat, ustensile: ustensile.valeur, taille: taille.valeur });
  });

  // Étapes.
  const etapes = [];
  if (!Array.isArray(brut.etapes) || !brut.etapes.length) {
    erreurs.push(erreur('Le plan n’a pas d’étapes.', `batch.etapes : liste de 1 à ${ETAPES_BATCH_MAX} étapes attendue`));
    return sortie(null);
  }
  if (brut.etapes.length > ETAPES_BATCH_MAX) {
    erreurs.push(erreur(`Le plan a trop d’étapes (${ETAPES_BATCH_MAX} au plus).`, `batch.etapes : liste de 1 à ${ETAPES_BATCH_MAX} étapes attendue`));
    return sortie(null);
  }
  const sansPlat = []; // étapes (index dans `etapes`) dont aucun plat n'est dit ni déduit
  brut.etapes.forEach((e, i) => {
    const n = i + 1;
    const code = `batch.etapes[${i}]`;
    if (!estObjet(e)) {
      erreurs.push(erreur(`L’étape ${n} est illisible.`, `${code} : objet attendu`));
      return;
    }
    const titre = texteBorne(e.titre, TITRE_MAX);
    if (!titre) erreurs.push(erreur(texte(e.titre) ? `Le titre de l’étape ${n} est trop long.` : `L’étape ${n} n’a pas de titre.`, `${code}.titre : texte de 1 à ${TITRE_MAX} caractères attendu`));
    if (vrai(e.auService)) {
      avertissements.push(avertissement(`${guillemets(titre ?? `Étape ${n}`)} se fait le jour du repas\u00A0: elle n’est pas reprise (l’app la rappelle à la fin).`));
      return;
    }
    const corps = texteBorne(e.texte, TEXTE_MAX);
    if (!corps) erreurs.push(erreur(texte(e.texte) ? `Le texte de l’étape ${n} est trop long.` : `L’étape ${n} n’a pas de texte.`, `${code}.texte : texte de 1 à ${TEXTE_MAX} caractères attendu`));
    else if ([...corps].length > TEXTE_LONG) avertissements.push(avertissement(`Le texte de l’étape ${n} est long.`));
    const dureeEtape = entierLu(e.duree);
    const duree = dureeEtape !== null && dureeEtape >= 1 && dureeEtape <= DUREE_MAX_MIN ? dureeEtape : null;
    if (duree === null) erreurs.push(erreur(e.duree === undefined ? `L’étape ${n} n’a pas de durée.` : `La durée de l’étape ${n} est illisible.`, `${code}.duree : entier de 1 à ${DUREE_MAX_MIN} attendu`));
    // Plats de l'étape.
    const plats = [];
    const platsLus = typeof e.plats === 'string' ? [e.plats] : e.plats;
    if (platsLus !== undefined && !Array.isArray(platsLus)) {
      erreurs.push(erreur(`Les plats de l’étape ${n} sont illisibles.`, `${code}.plats : identifiants des plats de la demande attendus`));
    }
    let platFautif = false;
    for (const p of listeDe(platsLus)) {
      if (typeof p === 'string' && parId.has(p)) {
        if (!plats.includes(p)) plats.push(p);
      } else {
        platFautif = true;
        erreurs.push(erreur(`L’étape ${n} parle d’un plat qui n’est pas dans la semaine.`, `${code}.plats : « ${ligne(p)} » n'est pas un plat de la demande`));
      }
    }
    const seulPlat = plats.length === 1 ? plats[0] : null;
    // Ingrédients cités : { produit, plat, part? }, ou le nom seul sur une étape d'un seul plat.
    const cites = [];
    if (e.ingredients !== undefined && !Array.isArray(e.ingredients)) {
      erreurs.push(erreur(`Les ingrédients de l’étape ${n} sont illisibles.`, `${code}.ingredients : liste de { "produit", "plat" } attendue`));
    }
    listeDe(e.ingredients).forEach((c, j) => {
      const codeC = `${code}.ingredients[${j}]`;
      const nomCite = texte(typeof c === 'string' ? c : estObjet(c) ? c.produit : '');
      if (!nomCite) {
        avertissements.push(avertissement(`Un ingrédient de l’étape ${n} est illisible\u00A0: il n’est pas repris.`));
        return;
      }
      const platCite = estObjet(c) && typeof c.plat === 'string' ? c.plat : seulPlat;
      if (!platCite) {
        avertissements.push(avertissement(`L’étape ${n} cite ${guillemets(nomCite)} sans dire pour quel plat\u00A0: sa quantité ne s’affichera pas.`));
        return;
      }
      if (!parId.has(platCite)) {
        erreurs.push(erreur(`L’étape ${n} cite un ingrédient d’un plat qui n’est pas dans la semaine.`, `${codeC}.plat : « ${ligne(platCite)} » n'est pas un plat de la demande`));
        return;
      }
      const trouve = retrouver(nomCite, ingredients.get(platCite).connus);
      if (!trouve) {
        // L'ajout d'une part (le thon d'une version mer) : sa quantité est dans le rappel de la part.
        if (!retrouver(nomCite, ajoutsDesParts.get(platCite))) {
          avertissements.push(avertissement(`L’étape ${n} cite ${guillemets(nomCite)}, qui n’est pas dans ${guillemets(nom(platCite))}\u00A0: sa quantité ne s’affichera pas.`));
        }
        if (!plats.includes(platCite)) plats.push(platCite);
        return;
      }
      if (cites.some((x) => x.plat === platCite && cleProduit(x.produit) === trouve.cle)) return;
      let part = 1;
      let partDite = false;
      if (estObjet(c) && c.part !== undefined && c.part !== null) {
        const valeur = typeof c.part === 'string' ? Number(c.part.replace(',', '.')) : c.part;
        if (estNombre(valeur) && valeur > 0 && valeur <= 1) {
          part = valeur;
          partDite = true;
        } else {
          avertissements.push(avertissement(`Une part d’ingrédient de l’étape ${n} est illisible\u00A0: tout l’ingrédient est compté.`));
        }
      }
      cites.push({ produit: trouve.produit, plat: platCite, part, partDite });
      if (!plats.includes(platCite)) plats.push(platCite);
    });
    // Champs facultatifs : retirés avec un avertissement s'ils sont fautifs.
    let actif = null;
    if (e.actif !== undefined) {
      const lu = entierLu(e.actif);
      if (lu !== null && lu >= 0 && lu <= (duree ?? DUREE_MAX_MIN)) actif = lu;
      else avertissements.push(avertissement(`Le temps de travail de l’étape ${n} est illisible\u00A0: toute l’étape compte comme du travail.`));
    }
    let appareil = null;
    if (e.appareil !== undefined && e.appareil !== null) {
      if (VOCABULAIRES.appareil.includes(e.appareil)) {
        appareil = e.appareil;
        if (!actifs.has(appareil)) avertissements.push(avertissement(`L’étape ${n} utilise un appareil que vos réglages n’ont pas.`));
      } else {
        avertissements.push(avertissement(`L’appareil de l’étape ${n} est inconnu\u00A0: il n’est pas repris.`));
      }
    }
    const mode = appareil && MODES.includes(appareil) ? texteBorne(e.mode, MODE_MAX) : null;
    const tempLue = entierLu(e.tempC);
    const tempC = appareil && APPAREILS_A_PRECHAUFFER.includes(appareil) && tempLue !== null && tempLue >= TEMP_MIN && tempLue <= TEMP_MAX ? tempLue : null;
    if (e.tempC !== undefined && e.tempC !== null && tempC === null) avertissements.push(avertissement(`La température de l’étape ${n} est illisible\u00A0: elle n’est pas reprise.`));
    const feu = appareil === 'plaque' && FEUX.includes(e.feu) ? e.feu : null;
    const ustensiles = listeDe(e.ustensiles).map((u) => texteBorne(u, USTENSILE_MAX)).filter(Boolean).slice(0, USTENSILES_MAX);
    const aussi = listeDe(e.aussi).filter((a) => (typeof a === 'string' ? texte(a) : estObjet(a) && texte(a.produit))).slice(0, AUSSI_MAX)
      .map((a) => (typeof a === 'string' ? texte(a) : { produit: texte(a.produit), ...(estNombre(a.qte) && a.qte > 0 ? { qte: a.qte } : {}), ...(typeof a.unite === 'string' ? { unite: a.unite } : {}) }));
    const pret = e.pret === undefined || e.pret === null ? null : texteBorne(e.pret, PRET_MAX);
    if (e.pret !== undefined && e.pret !== null && !pret) avertissements.push(avertissement(`Le signe «\u00A0prêt\u00A0» de l’étape ${n} est illisible\u00A0: il n’est pas repris.`));
    let prechauffer = false;
    if (vrai(e.prechauffer)) {
      if (appareil && APPAREILS_A_PRECHAUFFER.includes(appareil) && tempC !== null) prechauffer = true;
      else avertissements.push(avertissement(`L’étape ${n} allume un appareil sans dire lequel ni à quelle température.`));
    }
    // Parts mises de côté avant cette étape : `true` (les plats de l'étape qui ont une part), un identifiant, une liste.
    let partAvant = [];
    if (e.partAvant !== undefined && e.partAvant !== null && e.partAvant !== false) {
      const lus = vrai(e.partAvant) ? plats.filter(aDesParts) : (typeof e.partAvant === 'string' ? [e.partAvant] : listeDe(e.partAvant));
      partAvant = [...new Set(lus.filter((p) => typeof p === 'string' && aDesParts(p)))];
      if (!partAvant.length) avertissements.push(avertissement(`L’étape ${n} met de côté une part qui n’existe pas\u00A0: ce n’est pas repris.`));
    }
    for (const p of partAvant) if (!plats.includes(p)) plats.push(p);
    if (!plats.length && !prechauffer && !platFautif) sansPlat.push(i);
    etapes.push({
      n, titre, texte: corps, duree, actif, appareil, mode, tempC, feu, ustensiles, plats, ingredients: cites, aussi, pret,
      prechauffer, partAvant, veille: vrai(e.veille),
    });
  });

  // Une étape qui allume un appareil sans dire pour quel plat : celui de son prochain usage.
  etapes.forEach((etape, i) => {
    if (!etape.prechauffer || etape.plats.length) return;
    const usage = etapes.slice(i + 1).find((x) => x.appareil === etape.appareil && !x.prechauffer && x.plats.length);
    if (usage) etape.plats = [...usage.plats];
    else avertissements.push(avertissement(`L’étape ${etape.n} allume ${NOMS_APPAREILS[etape.appareil]} pour aucun plat\u00A0: elle n’est pas reprise.`));
  });
  for (const i of sansPlat) {
    erreurs.push(erreur(`L’étape ${i + 1} ne dit pas pour quels plats elle est.`, `batch.etapes[${i}].plats : identifiants des plats de la demande attendus`));
  }
  const gardees = etapes.filter((e) => e.plats.length);
  const travaux = gardees.filter((e) => !e.prechauffer);

  for (const [platId, element] of parId) {
    const siennes = travaux.filter((e) => e.plats.includes(platId));
    if (!siennes.length) {
      erreurs.push(erreur(`${guillemets(nom(platId))} n’apparaît dans aucune étape.`, `batch.etapes : le plat ${platId} n'apparaît dans aucune étape`));
      continue;
    }
    // Ingrédients jamais cités, parts de plus de 1.
    const citations = new Map();
    for (const e of siennes) {
      for (const c of e.ingredients.filter((x) => x.plat === platId)) {
        const cle = cleProduit(c.produit);
        if (!citations.has(cle)) citations.set(cle, []);
        citations.get(cle).push(c);
      }
    }
    for (const [cle, produit] of ingredients.get(platId).aCiter) {
      const vues = citations.get(cle) ?? [];
      if (!vues.length) {
        avertissements.push(avertissement(`${guillemets(majuscule(produit))} de ${guillemets(nom(platId))} n’est cité dans aucune étape\u00A0: il est seulement dans «\u00A0Sortir tout ce qu’il faut\u00A0».`));
      } else if (vues.some((c) => c.partDite) && vues.reduce((somme, c) => somme + c.part, 0) > 1 + 1e-6) {
        avertissements.push(avertissement(`Les parts de ${guillemets(produit)} de ${guillemets(nom(platId))} font plus que la quantité de la recette.`));
      }
    }
    // Manière de cuire : chaque appareil de la recette, et la température du four ou de l'airfryer à 10 °C près.
    for (const [app, temperatures] of appareilsDeLaRecette(element.plat)) {
      const avecLui = siennes.filter((e) => e.appareil === app);
      if (!avecLui.length) {
        erreurs.push(erreur(`${guillemets(nom(platId))} ne passe plus par ${NOMS_APPAREILS[app]} de sa recette.`,
          `batch.etapes : l'appareil ${app} de ${platId} n'apparaît dans aucune étape`));
        continue;
      }
      if (!APPAREILS_A_PRECHAUFFER.includes(app) || !temperatures.length) continue;
      const lues = avecLui.map((e) => e.tempC).filter(estNombre);
      const loin = lues.find((t) => !temperatures.some((r) => Math.abs(t - r) <= 10));
      if (loin !== undefined) {
        erreurs.push(erreur(`${guillemets(nom(platId))} cuit à ${loin}\u00A0°C au lieu de ${temperatures[0]}\u00A0°C.`,
          `batch.etapes : ${app} de ${platId} à ${loin} °C au lieu de ${temperatures[0]} °C`));
      }
    }
    if (!recipients.some((r) => r.plat === platId)) {
      avertissements.push(avertissement(`Pas de plat de cuisson donné pour ${guillemets(nom(platId))}.`));
    }
    // Part : à l'étape `partAvant`, sinon à la première étape qui cite un ingrédient qu'elle retire (comme l'écran).
    const parts = listeDe(element.quantites?.parts);
    if (parts.length && !gardees.some((e) => e.partAvant.includes(platId))) {
      const retires = new Set(parts.flatMap((p) => p.retirer.map(cleProduit)));
      if (!siennes.some((e) => e.ingredients.some((c) => c.plat === platId && retires.has(cleProduit(c.produit))))) {
        avertissements.push(avertissement(`La part à mettre de côté de ${guillemets(nom(platId))} n’a pas d’étape\u00A0: elle se prépare à part.`));
      }
    }
  }
  // Four ou airfryer jamais allumé avant son premier usage : l'écran le rappellera à l'étape d'avant.
  for (const app of APPAREILS_A_PRECHAUFFER) {
    const premier = gardees.findIndex((e) => e.appareil === app && !e.prechauffer && estNombre(e.tempC));
    if (premier > 0 && !gardees.slice(0, premier).some((e) => e.prechauffer && e.appareil === app)) {
      avertissements.push(avertissement(`Le plan n’allume pas ${NOMS_APPAREILS[app]} avant ${guillemets(gardees[premier].titre)}\u00A0: l’app le rappellera à l’étape d’avant.`));
    }
  }
  return sortie({
    semaine: texte(semaineId),
    empreinte: texte(empreinte),
    dureeTotale,
    travail,
    recipients,
    etapes: gardees.map(({ n: _n, ingredients: cites, ...reste }) => ({
      ...reste, ingredients: cites.map(({ partDite: _p, ...c }) => c),
    })),
  });
}

/**
 * Texte copié par « Copier les corrections pour Claude » pour un plan de batch refusé : CORRECTION paquet@1, la
 * version des instructions, la semaine, une ligne par erreur (codes exacts), puis la formule qui redemande le plan
 * entier (rien n'a été enregistré).
 */
export function texteCorrectionBatch({ erreurs = [], semaineId = null } = {}) {
  return [
    `CORRECTION ${FORMAT}`,
    `instructions: ${VERSION_INSTRUCTIONS}`,
    `semaine: ${ligne(semaineId ?? '')}`,
    ...listeDe(erreurs).filter((e) => e?.pourClaude).map((e) => `- ${ligne(e.pourClaude)}`),
    '(Rends le plan de batch entier, corrigé, { "format", "instructions", "batch" }, en un seul bloc.)',
  ].join('\n');
}

// ——— État de la carte ———

/**
 * Carte « 👩‍🍳 Le batch de la semaine » → { visible, etat: 'pret' | 'perime' | 'demande' | 'aDemander', nombre,
 * duree (texte), portionsChangees, demande: null | { par (adresse), quand (« aujourd’hui », « le 24 octobre », ''
 * tant que le serveur ne l'a pas datée), horsLigne } }.
 * `doc` : `plansBatch/<semaine>` lu (ou null) ; `elements` : platsDuBatch ; `semaine` : la semaine montrée ;
 * `aujourdhui` : 'AAAA-MM-JJ'.
 * Visible dès que la semaine a PLATS_BATCH_MIN plats du batch (décision 23 : avant comme après les courses), jusqu'à
 * sa fin ; `pret` : un plan à l'empreinte de la semaine ; `perime` : un plan d'avant un changement des plats ;
 * `demande` : demande ouverte sans plan à jour ; sinon `aDemander`.
 */
export function etatCarteBatch({ doc = null, elements = [], semaine = null, aujourdhui = null } = {}) {
  const lue = lireSemaine(semaine);
  const nombre = listeDe(elements).length;
  const masquee = { visible: false, etat: null, nombre, duree: null, portionsChangees: false, demande: null };
  if (!lue || nombre < PLATS_BATCH_MIN) return masquee;
  const empreinte = empreintePlanBatch(elements);
  const plan = estObjet(doc?.plan) && Array.isArray(doc.plan.etapes) ? doc.plan : null;
  const aJour = Boolean(plan) && doc.empreinte === empreinte;
  const demande = estObjet(doc?.demande) && doc.demande.statut === 'ouverte' && !aJour
    ? {
      par: texte(doc.demande.creePar) || null,
      quand: quandDemande(jourDeDerniereFois(doc.demande.creeLe), aujourdhui),
      horsLigne: doc.demande.creeLe == null,
    }
    : null;
  let etat = 'aDemander';
  if (aJour) etat = 'pret';
  else if (demande) etat = 'demande';
  else if (plan) etat = 'perime';
  const portions = portionsDuBatch(elements);
  const portionsChangees = aJour && estObjet(doc.portions)
    && Object.keys(portions).some((id) => Math.abs((doc.portions[id] ?? 0) - portions[id]) > 1e-6);
  return {
    visible: true, etat, nombre,
    duree: aJour ? texteEnviron(plan.dureeTotale, plan.travail) : null,
    portionsChangees, demande,
  };
}

const adresse = (valeur) => (typeof valeur === 'string' ? valeur.trim().toLowerCase() : '');

/**
 * Phrase d'une demande de plan (`etatCarteBatch().demande` ; carte de Semaine, écran Demandes) : « 📬 Demandé
 * aujourd’hui. Il apparaîtra ici dès qu’il sera prêt. » ; avec l'auteur (`avecAuteur`, gestionnaire) : « 📬 Demandé par
 * Adulte B le 24 octobre. » (« vous », ou le prénom du profil qui porte l'adresse ; jamais une adresse ; auteur
 * inconnu : « 📬 Demandé le 24 octobre. ») ; pas encore reçue par le serveur et `enLigne` faux : « 📬 Demandé. La
 * demande partira au retour du réseau. ». `moi` : adresse de la personne connectée. '' sans demande.
 */
export function phraseDemandeBatch(demande, { profils = [], moi = null, avecAuteur = false, enLigne = true } = {}) {
  if (!estObjet(demande)) return '';
  if (demande.horsLigne && !enLigne) return TEXTES_PLAN_BATCH.demandeHorsLigne;
  const quand = demande.quand || 'aujourd’hui';
  if (!avecAuteur) return TEXTES_PLAN_BATCH.demande(quand);
  const par = adresse(demande.par);
  const qui = par && par === adresse(moi) ? 'vous'
    : texte(listeDe(profils).find((p) => estObjet(p) && par && adresse(p.email) === par)?.nom);
  return qui ? TEXTES_PLAN_BATCH.demandePar(qui, quand) : TEXTES_PLAN_BATCH.demandeSansAuteur(quand);
}


/** « Environ 2 h 30, dont 1 h 10 de travail » ; « Environ 2 h 30 » ; null. */
export function texteEnviron(total, travail) {
  if (!estNombre(total) || total <= 0) return null;
  return estNombre(travail) && travail > 0 && travail < total
    ? `Environ ${texteDuree(total)}, dont ${texteDuree(travail)} de travail`
    : `Environ ${texteDuree(total)}`;
}


/** Dates de la semaine pour l'écran Demandes : « Semaine du 24 au 30 octobre ». */
export function texteSemaineDuPlan(semaine) {
  const lue = lireSemaine(semaine);
  return lue ? TEXTES_PLAN_BATCH.semaineDu(texteDates(lue.debut, lue.fin)) : '';
}

// ——— L'écran du batch ———

/** Ingrédient d'une version qui demande une cuisson à cœur (volaille, porc hors charcuterie, viande hachée). */
function aCuireACoeur(ingredient) {
  const m = marqueursEffectifs(ingredient);
  return !m.has('charcuterie') && (m.has('volaille') || m.has('porc') || (m.has('viande') && ingredient?.forme === 'hachee'));
}

/** Familles d'unités qui s'additionnent (comme la liste de courses) : masse en grammes, volume en millilitres. */
const FAMILLES_UNITES = Object.freeze({ g: ['masse', 1], kg: ['masse', 1000], ml: ['volume', 1], cl: ['volume', 10], l: ['volume', 1000] });

/**
 * Total de plusieurs mesures d'un même produit → [{ qte, unite }] : masses additionnées (en kg dès 1 000 g), volumes
 * additionnés (en litres dès 1 000 ml, en cl dès 100 ml), chaque autre unité à part (pièces, c. à soupe), dans l'ordre
 * de leur première apparition ; une mesure illisible est ignorée.
 */
function totalDesMesures(mesures, produit) {
  const groupes = new Map();
  for (const m of mesures) {
    if (!estNombre(m?.qte) || m.qte <= 0 || !m.unite) continue;
    const famille = FAMILLES_UNITES[m.unite];
    const cle = famille ? famille[0] : m.unite;
    const deja = groupes.get(cle) ?? 0;
    groupes.set(cle, deja + m.qte * (famille ? famille[1] : 1));
  }
  return [...groupes].map(([cle, total]) => {
    const base = propre(total);
    let mesure;
    if (cle === 'masse') mesure = base >= 1000 ? { qte: propre(base / 1000), unite: 'kg' } : { qte: base, unite: 'g' };
    else if (cle === 'volume') mesure = base >= 1000 ? { qte: propre(base / 1000), unite: 'l' } : (base >= 100 ? { qte: propre(base / 10), unite: 'cl' } : { qte: base, unite: 'ml' });
    else mesure = { qte: base, unite: cle };
    return { qte: arrondiCuisine(mesure.qte, mesure.unite, produit), unite: mesure.unite };
  });
}

const texteDesMesures = (mesures) => mesures.map((m) => texteQuantiteCuisine(m.qte, m.unite)).join(' + ');

/**
 * Quantités d'une étape du plan, ingrédients de plusieurs plats réunis par produit : « Pomme de terre · 1,6 kg (1 kg
 * pour Gratin, 600 g pour Salade) » ; toutes les mesures de chaque plat (« Beurre · 50 g + 1 c. à soupe (30 g + 1 c. à
 * soupe pour Poulet, 20 g pour Gratin) ») ; un plat dont aucune part ne prend l'ingrédient : « pas cette fois pour … ».
 */
function quantitesDuPlan(etape, parId) {
  const parProduit = new Map();
  const ordre = [];
  for (const cite of etape.ingredients) {
    const element = parId.get(cite.plat);
    if (!element) continue;
    const [lue] = quantitesDeLEtape({ ingredients: [{ produit: cite.produit, part: cite.part }] }, element.quantites);
    if (!lue) continue;
    const cle = cleProduit(cite.produit);
    if (!parProduit.has(cle)) {
      parProduit.set(cle, []);
      ordre.push(cle);
    }
    parProduit.get(cle).push({ ...lue, plat: texte(element.plat.nom) });
  }
  return ordre.map((cle) => {
    const lues = parProduit.get(cle);
    if (lues.length === 1) return { produit: lues[0].produit, texte: lues[0].texte };
    const nom = majuscule(lues[0].produit);
    const detail = lues.map((l) => {
      if (l.qte === 0) return `${TEXTES_CUISINE.pasCetteFois} pour ${l.plat}`;
      return l.mesures?.length ? `${texteDesMesures(l.mesures)} pour ${l.plat}` : l.plat;
    }).join(', ');
    const total = totalDesMesures(lues.flatMap((l) => l.mesures ?? []), lues[0].produit);
    return { produit: lues[0].produit, texte: total.length ? `${nom} · ${texteDesMesures(total)} (${detail})` : `${nom} (${detail})` };
  });
}

/** Parts mises de côté avant une étape normalisée : liste d'identifiants (un identifiant seul d'avant : en liste). */
const partsAvant = (etape) => (Array.isArray(etape.partAvant) ? etape.partAvant : (typeof etape.partAvant === 'string' ? [etape.partAvant] : []));

/**
 * Modèle de l'écran du batch (#/batch/<semaine>) → { etat: 'ok' | 'introuvable', titrePage, duree, avant: { plats:
 * [texte], recipients: [texte], hygiene: [texte], enfant: [ligne 🧸], parts: [texte], veille: [étape], reunir: [{ platId,
 * nom, ingredients: [{ cle, texte }] }], aussi: texte | null, ustensiles: [{ cle, nom }] }, etapes: [{ cle, n, rang,
 * titre, texte, pret, duree, actif, ligneDuree, ligneAppareil, plats: [nom], pour, quantites: [{ produit, texte }],
 * aussi: [texte], ustensiles: [nom], rappels, conseils: [texte], pendant }], total, fin: { titre, plats: [{ platId,
 * nom, portions, partFragile, congeler, service: [{ titre, texte }] }], conseils: [texte] } }. Rien n'est écrit.
 * Une étape qui allume le four ou l'airfryer (`prechauffer`) n'a pas d'écran : son rappel « Allumez le four… » va sur
 * l'étape qui la suit ; sans elle, le rappel va sur l'étape d'avant le premier usage. « Pendant que ça cuit » seulement
 * quand l'étape suivante fait avancer d'autres plats.
 * `plan` : plan normalisé (validerPlanBatch) ; `elements` : platsDuBatch (une étape qui ne vise plus aucun plat de la
 * semaine n'est pas montrée) ; `aujourdhui` : jour de cuisson ('AAAA-MM-JJ' ou Date).
 */
export function pasAPasBatch(plan, { elements = [], profils = [], moi = null, role = null, reglages = null, evaluer = undefined, aujourdhui = new Date() } = {}) {
  if (!estObjet(plan) || !Array.isArray(plan.etapes)) return { etat: 'introuvable', titrePage: TEXTES_PLAN_BATCH.titrePage(0) };
  const parId = new Map(listeDe(elements).filter((e) => estObjet(e) && typeof e.platId === 'string').map((e) => [e.platId, e]));
  const nomDuPlat = (platId) => texte(parId.get(platId)?.plat?.nom) || platId;
  const lues = plan.etapes.filter((e) => estObjet(e) && listeDe(e.plats).some((p) => parId.has(p)));

  // Étapes affichées : la veille d'abord (dans « Avant de commencer »), puis le jour même ; jamais une étape qui allume.
  const affichee = (etape, i, prefixe) => ({
    cle: `${prefixe}${i + 1}`,
    n: i + 1,
    titre: etape.titre,
    texte: etape.texte ?? '',
    pret: etape.pret ?? null,
    duree: etape.duree ?? null,
    actif: etape.actif ?? etape.duree ?? null,
    ligneDuree: ligneDuree({ duree: etape.duree, actif: etape.actif ?? etape.duree }),
    ligneAppareil: ligneAppareil(etape),
    plats: listeDe(etape.plats).filter((p) => parId.has(p)).map(nomDuPlat),
    quantites: quantitesDuPlan(etape, parId),
    aussi: aussiDeLEtape(etape, 1).map((a) => a.texte),
    ustensiles: listeDe(etape.ustensiles).map((u) => majuscule(texte(u))),
    citations: listeDe(etape.ingredients).map((c) => ({ cle: cleProduit(c.produit), plat: c.plat })),
    source: { ...etape, plats: listeDe(etape.plats), partAvant: partsAvant(etape) },
    origine: etape,
  });
  const veille = lues.filter((e) => e.veille && !e.prechauffer).map((e, i) => affichee(e, i, 'v'));
  const jour = lues.filter((e) => !e.veille && !e.prechauffer).map((e, i) => affichee(e, i, 'b'));
  jour.forEach((etape, i) => {
    etape.rang = i + 1;
    etape.pour = etape.plats.length ? TEXTES_PLAN_BATCH.pour(etape.plats.join(', ')) : null;
    const suivante = jour[i + 1];
    etape.pendant = Boolean(suivante && estNombre(etape.duree) && estNombre(etape.actif) && etape.duree > etape.actif
      && !suivante.source.plats.some((p) => etape.source.plats.includes(p)));
  });
  for (const etape of veille) {
    etape.rang = null;
    etape.pour = etape.plats.length ? TEXTES_PLAN_BATCH.pour(etape.plats.join(', ')) : null;
    etape.pendant = false;
  }
  const toutes = [...veille, ...jour];

  // Rappels du four : une étape `prechauffer` le pose sur l'étape qui la suit ; un four jamais allumé avant son premier
  // usage, sur l'étape d'avant ce premier usage (ou sur lui-même s'il ouvre la séance).
  const prechauffages = [];
  const sequence = lues.filter((e) => !(e.veille && !e.prechauffer));
  const visible = new Map(jour.map((e) => [e.origine, e]));
  sequence.forEach((etape, i) => {
    if (!etape.prechauffer) return;
    const apres = sequence.slice(i + 1).find((e) => !e.prechauffer && visible.has(e));
    const servie = sequence.slice(i + 1).find((e) => !e.prechauffer && e.appareil === etape.appareil && visible.has(e));
    if (!apres) return;
    prechauffages.push({ appareil: etape.appareil, tempC: etape.tempC, avant: visible.get(apres).cle, pour: servie ? visible.get(servie).cle : null, titre: servie ? visible.get(servie).titre : null });
  });
  for (const app of APPAREILS_A_PRECHAUFFER) {
    const premier = jour.findIndex((e) => e.source.appareil === app && estNombre(e.source.tempC));
    if (premier < 0 || prechauffages.some((p) => p.appareil === app)) continue;
    const usage = jour[premier];
    prechauffages.push({ appareil: app, tempC: usage.source.tempC, avant: jour[Math.max(0, premier - 1)].cle, pour: usage.cle, titre: usage.titre });
  }
  const rappelsFour = rappelsDuDeroule({ sequence: toutes.map((e) => ({ cle: e.cle, titre: e.titre })), prechauffages });
  for (const etape of toutes) etape.rappels = [...(rappelsFour.get(etape.cle) ?? [])];

  const lignesParts = [];
  const hygiene = new Set();
  const enfant = [];
  const reunir = [];
  const fin = [];
  const conseilsFin = [];
  const jourCuisson = typeof aujourdhui === 'string' ? aujourdhui : (() => {
    const d = aujourdhui instanceof Date ? aujourdhui : new Date();
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  })();
  for (const [platId, element] of parId) {
    const { plat, quantites } = element;
    const nom = texte(plat.nom);
    const versions = listeDe(element.element?.versions).filter((v) => estObjet(v?.variante) && estObjet(v?.profil));
    const ajoutsVersions = versions.flatMap((v) => listeDe(v.variante.ajouter));
    for (const geste of hygieneDuPlat(plat, ajoutsVersions)) hygiene.add(geste);
    // Parts : sur l'étape `partAvant` de ce plat, sinon la première de ce plat qui cite un ingrédient que la version retire.
    for (const part of listeDe(quantites.parts)) {
      const retires = new Set(part.retirer.map(cleProduit));
      const etape = toutes.find((e) => e.source.partAvant.includes(platId))
        ?? toutes.find((e) => e.citations.some((c) => c.plat === platId && retires.has(c.cle))) ?? null;
      const qui = laPart(part.profil, moi);
      const consigne = part.consigne ? `\u00A0: ${sansPoint(part.consigne)}` : '';
      const coeur = part.ajouts.length && versions.some((v) => v.profil.id === part.profilId && listeDe(v.variante.ajouter).some(aCuireACoeur))
        ? ` ${CONSEILS.coeur.texte}` : '';
      if (etape) {
        etape.rappels.push({
          genre: 'part', profilId: part.profilId,
          texte: `✂️ Mettez de côté ${qui} de ${guillemets(nom)} maintenant, avec une cuillère propre.`,
          consigne: [part.consigne ? `${sansPoint(part.consigne)}.` : '', coeur.trim()].filter(Boolean).join(' '),
          ajouts: part.ajouts.map((a) => a.texte),
          case: { cle: `part:${platId}:${part.profilId}`, libelle: estMoi(part.profil, moi) ? `Votre part de ${guillemets(nom)} mise de côté` : `Part ${deNom(nomDe(part.profil))} de ${guillemets(nom)} mise de côté` },
        });
      }
      const ou = etape?.rang ? ` se met de côté avant l’étape ${etape.rang}` : (etape ? ' se met de côté la veille' : ' se prépare à part');
      lignesParts.push(`✂️ ${majuscule(qui)} de ${guillemets(nom)}${ou}${consigne}.${coeur}`);
    }
    // 🧸 : sur la première étape qui cite, pour ce plat, un produit en cause.
    const precautions = precautionsDuPlat(plat, { element: element.element, profils, evaluer });
    enfant.push(...lignesEnfant(precautions, { role }).map((l) => ({ ...l, texte: `${l.texte} (${nom})` })));
    const rappelsEnfant = rappelsDuDeroule({
      sequence: toutes.map((e) => ({ cle: e.cle, titre: e.titre, citations: e.citations.filter((c) => c.plat === platId) })),
      precautions, role, moi,
    });
    for (const etape of toutes) etape.rappels.push(...(rappelsEnfant.get(etape.cle) ?? []).filter((r) => r.genre === 'enfant'));
    // Sortir tout ce qu'il faut : les ingrédients de ce plat (quantités de la semaine, un produit présent deux fois
    // additionné), sauf ceux du seul jour du repas et ceux que seules les étapes de la veille utilisent ; puis les
    // ajouts de ses parts.
    const service = produitsAuService(plat);
    const citesLeJour = new Set(jour.flatMap((e) => e.citations.filter((c) => c.plat === platId).map((c) => c.cle)));
    const citesLaVeille = new Set(veille.flatMap((e) => e.citations.filter((c) => c.plat === platId).map((c) => c.cle)));
    const cles = [];
    for (const l of listeDe(quantites.lignes)) {
      const cle = cleProduit(l.produit);
      if (!cle || l.personne || cles.includes(cle) || service.has(cle) || (citesLaVeille.has(cle) && !citesLeJour.has(cle))) continue;
      cles.push(cle);
    }
    const uniques = cles.map((cle) => {
      const produit = listeDe(quantites.lignes).find((l) => cleProduit(l.produit) === cle).produit;
      const [lue] = quantitesDeLEtape({ ingredients: [{ produit }] }, quantites);
      return { cle: `ing:${platId}:${cle}`, texte: lue?.texte ?? majuscule(produit) };
    });
    for (const part of listeDe(quantites.parts)) {
      const qui = estMoi(part.profil, moi) ? 'votre part' : `part ${deNom(nomDe(part.profil))}`;
      part.ajouts.forEach((ajout, i) => uniques.push({ cle: `part:${platId}:${part.profilId}:${i}`, texte: `${ajout.texte} (${qui})` }));
    }
    reunir.push({ platId, nom, ingredients: uniques });
    // Fin : portions au frigo et au congélateur, date limite, part la plus fragile, et le jour du repas.
    const finDuPlat = finDeCuisson(plat, element.element, jourCuisson, { finSemaine: element.element?.semaine?.fin ?? null, reglages });
    const phrases = phrasesDeFin(finDuPlat, { moi });
    const leJour = etapesLisibles(plat).etapes.filter((e) => e.auService).map((e) => ({ titre: e.titre, texte: e.texte ?? '' }));
    fin.push({ platId, nom, portions: phrases.portions, partFragile: phrases.partFragile, congeler: phrases.congeler, service: leJour });
    for (const c of phrases.conseils) if (!conseilsFin.includes(c)) conseilsFin.push(c);
  }
  // Rappels d'une étape : four, part, 🧸 (comme « Cuisiner pas à pas »).
  const rang = { four: 0, part: 1, enfant: 2 };
  for (const etape of toutes) etape.rappels.sort((a, b) => rang[a.genre] - rang[b.genre]);
  // Conseil de cuisson à cœur (comme cuisine.js › etapesDuCoeur) : pour chaque ingrédient à cuire à cœur, à partir de
  // la première étape qui le cite, la première étape de son plat qui a un appareil et un signe « prêt », sinon la
  // première qui a un appareil, sinon l'étape qui le cite.
  for (const etape of toutes) etape.conseils = [];
  for (const [platId, element] of parId) {
    for (const ingredient of listeDe(element.plat.ingredients).filter((i) => estObjet(i) && aCuireACoeur(i))) {
      const cle = cleProduit(ingredient.produit);
      const debut = toutes.findIndex((e) => e.citations.some((c) => c.plat === platId && c.cle === cle));
      if (debut < 0) continue;
      const suite = toutes.slice(debut).filter((e) => e.source.plats.includes(platId));
      const choisie = suite.find((e) => e.source.appareil && e.source.pret) ?? suite.find((e) => e.source.appareil) ?? toutes[debut];
      if (!choisie.conseils.includes(CONSEILS.coeur.texte)) choisie.conseils.push(CONSEILS.coeur.texte);
    }
  }

  // Ce qu'on sort : « Et aussi » et ustensiles de toutes les étapes du jour, plats de cuisson.
  const aussi = [];
  const ustensiles = new Map();
  for (const etape of jour) {
    for (const chose of listeDe(etape.source.aussi)) {
      const produit = texte(typeof chose === 'string' ? chose : chose?.produit);
      if (produit && !aussi.some((a) => slug(a) === slug(produit))) aussi.push(produit);
    }
    for (const ustensile of listeDe(etape.source.ustensiles)) {
      const cle = slug(ustensile);
      if (cle && !ustensiles.has(cle)) ustensiles.set(cle, { cle: `ust:${cle}`, nom: majuscule(texte(ustensile)) });
    }
  }
  const recipients = listeDe(plan.recipients).filter((r) => parId.has(r.plat))
    .map((r) => TEXTES_PLAN_BATCH.recipient(nomDuPlat(r.plat), majuscule(r.ustensile), r.taille));
  const nettoyer = ({ citations: _c, source: _s, origine: _o, ...etape }) => etape;
  return {
    etat: 'ok',
    titrePage: TEXTES_PLAN_BATCH.titrePage(parId.size),
    duree: texteEnviron(plan.dureeTotale, plan.travail),
    avant: {
      plats: [...parId.values()].map((e) => `${texte(e.plat.nom)} · ${portionsEnMots(propre(e.quantites.portions))}`),
      recipients,
      hygiene: [
        TEXTES_CUISINE.mains,
        ...(hygiene.has('planche') ? [CONSEILS.planche.texte] : []),
        ...(hygiene.has('oeufs') ? [TEXTES_CUISINE.oeufs] : []),
      ],
      enfant,
      parts: lignesParts,
      veille: veille.map(nettoyer),
      reunir,
      aussi: aussi.length ? TEXTES_CUISINE.etAussi(aussi.join(', ')) : null,
      ustensiles: [...ustensiles.values()],
    },
    etapes: jour.map(nettoyer),
    total: jour.length,
    fin: { titre: TEXTES_PLAN_BATCH.fin, plats: fin, conseils: conseilsFin },
  };
}

/** Clé de la reprise du batch sur le téléphone (étape, cases, 12 h, comme « Cuisiner pas à pas ») : par compte et par semaine. */
export function cleRepriseBatch(uid, semaineId) {
  return `repas-courses:batch:${uid}:${semaineId}`;
}
