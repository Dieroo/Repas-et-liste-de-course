// Écran « Ajouter des recettes » (gestionnaire) : coller la réponse de Claude ou choisir un fichier, aperçu,
// enregistrement (CLAUDE.md §8). Le texte lu n'est jamais affiché : il contient des mots techniques (§4). Seul
// l'aperçu l'est. Un fichier suit exactement le chemin du collage ; seuls son plafond et ses messages changent.
import { el, annoncer } from './dom.js';
import { copier, lirePressePapiers, lectureBloquee } from './presse-papiers.js';
import { choisirFichier, lireTexte } from './fichier.js';
import {
  extrairePaquet, validerPaquet, preparerImport, filtrerPreparation, estSauvegarde, controlerInstructions,
  entreesPourImport,
} from '../coeur/paquet.js';
import { texteCorrectionPourClaude, texteDemandeEtapes } from '../coeur/claude.js';
import { FICHIER_MAX } from '../coeur/sauvegarde.js';
import { estDansCorbeille } from '../coeur/corbeille.js';
import {
  cleQuandMeme, ecrituresRelecture, effetsSurLesVersions, phrasesApercuRelecture,
} from '../coeur/relecture.js';
import {
  natureDuMessage, bilanDuMessage, dejaEnregistre, etatSerie, texteSerie, TEXTES_SERIE,
} from '../coeur/serie.js';
import {
  TEXTES_ETAPES, enteteApercuEtapes, lignesApercuEtapes, platsADetailler,
} from '../coeur/realisation.js';
import {
  TEXTES_PLAN_BATCH, empreintePlanBatch, estReponseBatch, planDeLaReponse, portionsDuBatch, texteCorrectionBatch,
  texteEnviron, texteSemaineDuPlan, validerPlanBatch,
} from '../coeur/plan-batch.js';
import { appareilsDuFoyer } from '../coeur/ma-cuisine.js';

// Écran ouvert en série d'étapes (T5-0b) : par « Coller la réponse de Claude » de la carte « 👩‍🍳 Étapes détaillées »
// (Réglages) ou de la carte des étapes d'une fiche (`platId` : le retour y ramène). Lu une fois, à l'ouverture de
// l'écran : mémoire de la visite, jamais du téléphone.
let prochaineSerieEtapes = null;

/** À appeler juste avant d'ouvrir `#/import` depuis une carte d'étapes détaillées. */
export function ouvrirEnSerieEtapes({ platId = null } = {}) {
  prochaineSerieEtapes = { platId: typeof platId === 'string' && platId ? platId : null };
}

// Éléments d'un lot d'étapes qui ne sont pas repris : ils restent à détailler.
const STATUTS_ETAPES_NON_REPRIS = new Set(['refusee', 'change', 'inconnu', 'attente', 'corbeille']);
const MESSAGE_ECHEC_ETAPES = 'Les étapes n’ont pas pu être enregistrées. Réessayez.';

// Claude refuse une demande écrite pour d'autres instructions que les siennes (docs/projet-claude.md §0) : mêmes
// messages pour un collage et pour un fichier.
const MESSAGES_ALIGNEMENT = {
  // Lot de relecture des repères (T2d) écrit avec d'autres instructions : jamais enregistrable.
  relecture: 'Cette relecture ne vient pas des instructions actuelles. Recopiez-les depuis Réglages › Projet Claude, puis redemandez ce lot.',
  instructions: 'Claude signale que ses instructions ne sont plus à jour. Recopiez-les depuis Réglages › Projet Claude, puis renvoyez la demande dans une nouvelle conversation.',
  app: 'Claude signale que votre app n’est pas à jour. Fermez puis rouvrez l’app, puis recopiez la demande.',
};

const TITRES_ALIGNEMENT = {
  relecture: 'Instructions à mettre à jour',
  instructions: 'Instructions à mettre à jour',
  app: 'App à mettre à jour',
};

const MESSAGES_EXTRACTION = {
  vide: 'Rien à coller. Dans l’app Claude, copiez toute la réponse, puis revenez ici.',
  trop_long: 'Ce texte est trop long pour être une réponse de Claude.',
  demande: 'C’est votre demande, pas la réponse de Claude. Collez-la dans votre projet Claude, puis copiez sa réponse.',
  coupee: 'La recette semble coupée ou abîmée. Copiez toute la réponse de Claude, jusqu’à la fin.',
  aucune: 'Aucune recette trouvée dans ce texte. Copiez toute la réponse de Claude.',
  ...MESSAGES_ALIGNEMENT,
};

const TITRES_EXTRACTION = {
  vide: 'Rien à coller',
  trop_long: 'Texte trop long',
  demande: 'Ce n’est pas encore la réponse',
  coupee: 'Recette illisible',
  aucune: 'Aucune recette trouvée',
  ...TITRES_ALIGNEMENT,
};

// Messages d'un fichier choisi (les codes de lecture du fichier s'ajoutent à ceux de l'extraction).
const MESSAGES_FICHIER = {
  vide: 'Ce fichier est vide.',
  trop_long: 'Ce fichier est trop gros pour l’app.',
  illisible: 'Ce fichier n’a pas pu être lu.',
  demande: 'Ce fichier contient votre demande, pas la réponse de Claude.',
  coupee: 'Ce fichier semble coupé ou abîmé.',
  aucune: 'Aucune recette trouvée dans ce fichier.',
  ...MESSAGES_ALIGNEMENT,
};

const TITRES_FICHIER = {
  vide: 'Fichier vide',
  trop_long: 'Fichier trop gros',
  illisible: 'Fichier illisible',
  demande: 'Ce n’est pas encore la réponse',
  coupee: 'Fichier abîmé',
  aucune: 'Aucune recette trouvée',
  ...TITRES_ALIGNEMENT,
};

const LIBELLES_STATUT = {
  nouveau: 'Nouveau plat',
  complete: 'Complète la recette ⏳',
  remplace: 'Remplace la recette actuelle',
  inchange: 'Recette inchangée',
  versions: 'Recette gardée',
  identique: 'Déjà dans l’app',
  deja: 'Déjà dans vos plats',
  corbeille: 'Dans la corbeille',
  refusee: 'Pas reprise',
};

/**
 * Éléments de l'aperçu qui ne sont pas repris : idée de Claude (DEMANDE-IDEES) pour un plat qui a déjà sa recette
 * (`deja`), recette ou version pour un plat de la corbeille (`corbeille`) ; leur avertissement dit pourquoi.
 */
const nonRepris = (element) => element.statut === 'deja' || element.statut === 'corbeille'
  // Recette entière glissée dans une série d'étapes (T5-0b) : jamais de remplacement.
  || element.statut === 'refusee';

/** Éléments de l'aperçu qui n'écrivent rien : recette identique à la fiche, ou élément non repris. */
const sansEcriture = (element) => element.statut === 'identique' || nonRepris(element);

// Fiche complète reçue, différente de la recette actuelle, avec des versions : ce que l'on en prend.
const CHOIX = [
  { valeur: 'version', libelle: 'Ne prendre que sa version', aide: 'La recette actuelle est gardée.' },
  { valeur: 'remplacer', libelle: 'Remplacer la recette', aide: 'La recette de Claude prend sa place.' },
];

const MESSAGE_HORS_LIGNE_VERSIONS = 'Il faut être connecté pour ajouter des versions.';
const MESSAGE_HORS_LIGNE_RELECTURE = 'Il faut être connecté pour enregistrer la relecture.';

// Relecture des repères (T2d) : plats de la réponse qui ne sont pas repris, et pourquoi.
const RAISONS_NON_REPRISES = {
  inconnu: 'pas dans vos plats',
  corbeille: 'dans la corbeille',
  attente: 'recette à ajouter ⏳',
};

/** « A, B et C » ; « A, B et 4 autres » au-delà de trois noms. */
function listeNoms(noms) {
  if (noms.length > 3) return `${noms.slice(0, 2).join(', ')} et ${noms.length - 2}\u00A0autres`;
  return noms.length > 1 ? `${noms.slice(0, -1).join(', ')} et ${noms.at(-1)}` : noms.join('');
}

// Presse-papiers bloqué : même explication en haut de l'écran et dans la carte de série (T5-0a).
const TEXTE_BLOCAGE = 'Le téléphone bloque la lecture du presse-papiers. Collez à la main\u00A0: touchez longuement la zone ci-dessous, puis «\u00A0Coller\u00A0». ';
const TEXTE_BLOCAGE_CHROME = 'Pour réactiver le bouton\u00A0: Chrome › Paramètres › Paramètres des sites › Presse-papiers.';

const MESSAGE_COPIE = 'Copié. Collez-le dans votre projet Claude, puis collez ici sa nouvelle réponse.';
// Aperçu prêt avec des versions à corriger : un nouveau collage remplacerait l'aperçu, et les autres versions du lot,
// jamais enregistrées, seraient perdues.
const MESSAGE_COPIE_ENREGISTRER = 'Copié. Touchez d’abord «\u00A0Enregistrer\u00A0»\u00A0: les autres versions seront gardées. Collez ensuite le texte dans votre projet Claude, et sa réponse dans «\u00A0Ajouter des recettes\u00A0».';

const pluriel = (n, singulier, plurielTexte) => `${n}\u00A0${n > 1 ? plurielTexte : singulier}`;

/**
 * Recette qui remplace une fiche modifiée à la main (« Modifier ») : `modifieeA` donne la date en secondes, ou
 * true tant que la modification n'est pas confirmée par le serveur. Date au fuseau du téléphone.
 */
function avertissementModification(modifieeA) {
  if (typeof modifieeA === 'number') {
    const date = new Date(modifieeA * 1000);
    if (!Number.isNaN(date.getTime())) {
      const jour = date.getDate();
      const mois = date.toLocaleDateString('fr-FR', { month: 'long' });
      return `Remplace les modifications faites à la main le ${jour === 1 ? '1er' : jour} ${mois}.`;
    }
  }
  return modifieeA ? 'Remplace des modifications faites à la main.' : null;
}

/**
 * Ce qu'un enregistrement écrit : `recettes` (fiches complètes) et `versions` (versions seules, une par profil et par
 * plat). `ecritures` : celles de la préparation (déjà filtrée des plats décochés).
 */
export function compterEcritures(ecritures) {
  let recettes = 0;
  let versions = 0;
  let relectures = 0;
  for (const ecriture of ecritures ?? []) {
    if (ecriture?.mode === 'versions') versions += Array.isArray(ecriture.variantes) ? ecriture.variantes.length : 0;
    else if (ecriture?.mode === 'precautions') relectures += 1;
    else recettes += 1;
  }
  return { recettes, versions, relectures };
}

/** Bouton d'un lot de relecture : « Enregistrer les 10 relectures », « Enregistrer la relecture ». */
export function libelleEnregistrerRelecture(relectures) {
  return relectures > 1 ? `Enregistrer les ${relectures}\u00A0relectures` : 'Enregistrer la relecture';
}

/**
 * Bouton d'enregistrement : « Enregistrer 9 versions », « Enregistrer les 3 recettes », « Enregistrer 2 recettes et
 * 5 versions », ou seulement des demandes restées ouvertes à clore.
 */
export function libelleEnregistrer({ recettes = 0, versions = 0 }, aClore = 0) {
  if (recettes && versions) {
    return `Enregistrer ${pluriel(recettes, 'recette', 'recettes')} et ${pluriel(versions, 'version', 'versions')}`;
  }
  if (versions) return versions > 1 ? `Enregistrer ${versions}\u00A0versions` : 'Enregistrer la version';
  if (recettes) return recettes > 1 ? `Enregistrer les ${recettes}\u00A0recettes` : 'Enregistrer la recette';
  return aClore > 1 ? 'Marquer les recettes comme ajoutées' : 'Marquer la recette comme ajoutée';
}

export function creer(ctx) {
  let courant = ctx;
  const cible = ctx.parametre || null;
  // Série d'étapes (T5-0b) : ouverte depuis une carte d'étapes, ou après un lot d'étapes enregistré dans la visite.
  const ouverture = prochaineSerieEtapes;
  prochaineSerieEtapes = null;
  let serieEtapes = Boolean(ouverture) && !cible;
  const retourFiche = cible ? null : ouverture?.platId ?? null;
  let envoi = null; // { etat } : lot d'étapes en cours d'envoi, aperçu figé (« Enregistrement… »)
  let messageSerie = ''; // copie d'une demande d'étapes depuis la carte de série
  let detruit = false;
  let texte = ''; // dernier texte collé ou lu dans un fichier
  let colle = false; // vrai dès qu'un collage ou un fichier choisi a eu lieu (même vide)
  let source = 'collage'; // origine du texte : 'collage' ou 'fichier'
  let erreurFichier = null; // lecture du fichier refusée : 'trop_gros' ou 'illisible'
  let lectureEnCours = false; // fichier en cours de lecture : un second fichier choisi entre-temps est ignoré
  let minuteurSaisie = null;
  let signature = ''; // évite de reconstruire (et de réannoncer) un aperçu identique
  let preparation = null; // écritures prêtes (plats décochés retirés), si l'aperçu est valide
  let decoches = new Set(); // plats décochés dans l'aperçu : rien ne s'écrit pour eux
  let choix = {}; // { platId: 'version' | 'remplacer' } choisi dans l'aperçu
  let messageEnvoi = ''; // refus d'enregistrer (hors ligne, versions)
  // Relecture des repères (T2d) : { clé de la case (relecture.js › cleChangement, avec l'identifiant du plat): coché }
  // changé par la personne (un ajout est coché par défaut, un retrait décoché), et plats à marquer relus « quand même ».
  let cases = {};
  let quandMeme = new Set();
  let copieFaite = false;
  let enregistre = false;
  let focaliserResultat = false;
  let dernierEtat = null; // dernier aperçu calculé : sa validation dit si le message enregistré est un message d'idées
  // Série d'idées de Claude (T5-0a, « Coller la suite ») : mémoire de la visite seulement, jamais du téléphone.
  // `ajoutes` : idées écrites depuis l'ouverture de l'écran ; `ids` : tous les plats écrits pendant la visite (un
  // message recollé les vise) ; `dernier`, `autres`, `nonRepris` : ceux du dernier message ; `actif` : la carte de
  // série remplace l'aperçu (jusqu'au prochain collage) ; `montreeA` : heure de son apparition (garde du double
  // toucher sur « Enregistrer »).
  // `reprise` : plats écrits par le message dont la carte a proposé « Remettre » (son aperçu recalculé les voit « déjà
  // dans vos plats » : ils ne sont pas redits).
  // Étapes (T5-0b) : `nature` ('idees' ou 'etapes', celle du dernier message enregistré), `reponses` (lots d'étapes
  // enregistrés dans la visite : conseil de nouvelle conversation), `refuses` (recettes pas reprises dans la visite :
  // id → { id, nom, aCorriger }, pour « Redemander ces N recettes »).
  const serie = {
    ajoutes: [], ids: [], dernier: [], autres: [], nonRepris: [], actif: false, montreeA: 0, reprise: new Set(),
    nature: null, reponses: 0, refuses: new Map(),
  };
  let zoneSerieOuverte = false; // presse-papiers refusé : la carte de série montre sa zone de collage

  const sousTitre = el('p', { class: 'sous-titre' });
  const retour = el('a', { class: 'retour', onclick: revenir }, el('span', { 'aria-hidden': 'true' }, '‹'), el('span', { class: 'retour-texte' }));

  const boutonColler = el('button', {
    class: 'bouton bouton-principal bouton-plein',
    type: 'button',
    onclick: collerDepuisPressePapiers,
  }, '📋 Coller la réponse de Claude');

  const boutonFichier = el('button', {
    class: 'bouton bouton-secondaire bouton-plein',
    type: 'button',
    'aria-describedby': 'aide-fichier',
    onclick: choisirUnFichier,
  }, '📄 Choisir un fichier');
  const aideFichier = el('p', { class: 'aide', id: 'aide-fichier' },
    'Un fichier de recettes, par exemple le catalogue de départ.');

  const aideBlocage = el('p', { class: 'message-erreur', id: 'aide-blocage', hidden: true }, TEXTE_BLOCAGE, TEXTE_BLOCAGE_CHROME);

  const zoneTexte = el('textarea', {
    class: 'champ zone-collage',
    id: 'texte-colle',
    rows: '5',
    spellcheck: 'false',
    autocapitalize: 'off',
    autocomplete: 'off',
    'aria-describedby': 'aide-blocage aide-collage',
    // Le texte peut arriver en plusieurs morceaux : on analyse une fois la saisie terminée.
    oninput: () => {
      clearTimeout(minuteurSaisie);
      minuteurSaisie = setTimeout(() => analyser(zoneTexte.value, { manuel: true }), 300);
    },
  });
  const collageManuel = el('details', { class: 'collage-manuel' },
    el('summary', {}, 'Coller à la main'),
    el('label', { class: 'etiquette-champ', for: 'texte-colle' }, 'Réponse de Claude'),
    el('p', { class: 'aide', id: 'aide-collage' }, 'Touchez longuement la zone, puis «\u00A0Coller\u00A0».'),
    zoneTexte,
  );

  // Carte de série (T5-0a) : zone de collage montrée sous « Coller la suite » quand le téléphone refuse la lecture
  // du presse-papiers (rien ne bouge au-dessus du bouton touché). Gardée d'un rendu à l'autre.
  const zoneSerie = el('textarea', {
    class: 'champ zone-collage',
    id: 'texte-suite',
    rows: '5',
    spellcheck: 'false',
    autocapitalize: 'off',
    autocomplete: 'off',
    'data-action': 'zone-suite',
    'aria-describedby': 'aide-zone-suite',
    oninput: () => {
      clearTimeout(minuteurSaisie);
      minuteurSaisie = setTimeout(() => {
        const valeur = zoneSerie.value;
        if (!valeur.trim()) return;
        zoneSerie.value = '';
        analyser(valeur, { manuel: false });
      }, 300);
    },
  });
  const blocZoneSerie = el('div', { class: 'zone-suite' },
    el('label', { class: 'etiquette-champ', for: 'texte-suite' }, TEXTES_SERIE.zone),
    zoneSerie,
    // Sous la zone : « ci-dessous » de l'explication du haut n'irait pas ici.
    el('p', { class: 'message-erreur', id: 'aide-zone-suite' },
      'Le téléphone bloque la lecture du presse-papiers. Touchez longuement la zone, puis «\u00A0Coller\u00A0». ',
      TEXTE_BLOCAGE_CHROME),
  );

  const texteLigneCollee = el('span', {}, '✓ Réponse collée');
  const ligneCollee = el('div', { class: 'ligne-collee', hidden: true },
    texteLigneCollee,
    el('button', { class: 'bouton bouton-texte', type: 'button', onclick: effacer }, 'Effacer'),
  );

  const resultat = el('div', { class: 'resultat-import' });
  // Gardée d'un rendu à l'autre : seul son affichage suit le réseau.
  const noteHorsLigne = el('p', { class: 'aide' },
    'Hors ligne\u00A0: la recette est gardée sur ce téléphone et sera partagée au retour du réseau.');

  // Tous les plats, corbeille comprise : un plat de la corbeille n'est jamais recréé à côté (aperçu « Dans la corbeille »).
  const tousLesPlats = () => courant.tousLesPlats ?? courant.plats;

  function platCible() {
    return cible ? tousLesPlats().find((plat) => plat.id === cible) ?? null : null;
  }

  // Ouvert depuis Réglages (carte « 🧸 Relire les recettes », « Ajouter des recettes ») : le retour y ramène.
  const depuisReglages = () => !cible && !retourFiche && courant.routePrecedente === 'reglages';
  /** Fiche d'où l'écran a été ouvert en série d'étapes (carte des étapes d'une fiche) ; null sinon. */
  const ficheDOrigine = () => (retourFiche ? tousLesPlats().find((plat) => plat.id === retourFiche) ?? null : null);
  // Ouvert depuis l'écran Demandes (« Coller la réponse de Claude », T2e) : le retour, et l'enregistrement, y ramènent.
  const depuisDemandes = () => !cible && courant.routePrecedente === 'demandes';
  // Ouvert depuis Semaine (« Coller la réponse » du plan du batch, « Idées de plats ») : le retour y ramène.
  const depuisSemaine = () => !cible && !retourFiche && courant.routePrecedente === 'semaine';

  function revenir(evenement) {
    // Venu de cet écran-là : retour dans l'historique, pour que le geste retour d'Android reste naturel.
    let attendu = 'plats';
    if (cible || retourFiche) attendu = 'plat';
    else if (depuisReglages()) attendu = 'reglages';
    else if (depuisDemandes()) attendu = 'demandes';
    else if (depuisSemaine()) attendu = 'semaine';
    if (courant.routePrecedente === attendu && history.length > 1) {
      evenement.preventDefault();
      history.back();
    }
  }

  function majEntete() {
    const plat = platCible();
    sousTitre.textContent = plat
      ? `Recette de «\u00A0${plat.nom}\u00A0»`
      : 'Collez la réponse de votre projet Claude.';
    if (plat) {
      retour.href = `#/plat/${encodeURIComponent(plat.id)}`;
      retour.querySelector('.retour-texte').textContent = plat.nom;
    } else if (retourFiche) {
      retour.href = `#/plat/${encodeURIComponent(retourFiche)}`;
      retour.querySelector('.retour-texte').textContent = ficheDOrigine()?.nom ?? 'Plat';
    } else if (depuisReglages()) {
      retour.href = '#/reglages';
      retour.querySelector('.retour-texte').textContent = 'Réglages';
    } else if (depuisDemandes()) {
      retour.href = '#/demandes';
      retour.querySelector('.retour-texte').textContent = 'Demandes';
    } else if (depuisSemaine()) {
      retour.href = '#/semaine';
      retour.querySelector('.retour-texte').textContent = 'Semaine';
    } else {
      retour.href = '#/plats';
      retour.querySelector('.retour-texte').textContent = 'Plats';
    }
  }

  async function collerDepuisPressePapiers() {
    clearTimeout(minuteurSaisie);
    const lu = await lirePressePapiers();
    if (lu.refus) {
      aideBlocage.hidden = false;
      collageManuel.open = true;
      zoneTexte.focus();
      return;
    }
    analyser(lu.texte, { manuel: false });
  }

  /**
   * « 📋 Coller la suite » (T5-0a) : comme le bouton du haut ; lecture refusée, la zone de collage s'ouvre dans la
   * carte, sous le bouton touché.
   */
  async function collerLaSuite() {
    clearTimeout(minuteurSaisie);
    const lu = await lirePressePapiers();
    if (lu.refus) {
      zoneSerieOuverte = true;
      dessiner();
      zoneSerie.focus();
      return;
    }
    analyser(lu.texte, { manuel: false });
  }

  /**
   * Rien qui bouge sous le doigt : la carte de série prend la place de l'aperçu au toucher sur « Enregistrer », et ses
   * boutons peuvent arriver sous le doigt. Un second toucher (double toucher, toucher impatient) dans les 700 ms est
   * ignoré, sauf « Coller la suite » (sans effet sur un message déjà enregistré).
   */
  const DELAI_CARTE_SERIE = 700;
  const carteTropRecente = () => performance.now() - serie.montreeA < DELAI_CARTE_SERIE;

  /** « Terminé » de la série : retour à l'écran d'où l'on vient (Semaine, Réglages, Plats), sinon Plats. */
  function terminerSerie() {
    if (carteTropRecente()) return;
    if (courant.routePrecedente && courant.routePrecedente !== 'import' && history.length > 1) history.back();
    else location.replace(retour.getAttribute('href') || '#/plats');
  }

  /**
   * « Voir les plats › » : venu de Plats, un pas en arrière (sans doublon dans l'historique) ; sinon cet écran est
   * remplacé, le geste retour ne ramène pas à une série terminée.
   */
  function voirLesPlats(evenement) {
    evenement.preventDefault();
    if (carteTropRecente()) return;
    if (courant.routePrecedente === 'plats' && history.length > 1) history.back();
    else location.replace('#/plats');
  }

  /**
   * « Remettre » d'une idée non reprise de la carte (plat ⏳ de la corbeille) : le plat revient et l'aperçu du même
   * message se recalcule aussitôt, sans recoller (les idées déjà écrites y sont « déjà dans vos plats »).
   */
  function remettreDepuisLaSerie(plat) {
    if (carteTropRecente()) return;
    serie.actif = false;
    serie.reprise = new Set([...serie.dernier, ...serie.autres].map((p) => p.id));
    oublierChoix();
    enregistre = false;
    signature = '';
    focaliserResultat = true;
    courant.actions.remettreDeLaCorbeille([plat.id]);
    dessiner();
  }

  /** Fichier choisi : son texte suit le chemin du collage, avec le plafond d'un fichier. */
  async function choisirUnFichier() {
    clearTimeout(minuteurSaisie);
    // Le sélecteur n'est pas verrouillé : sans événement « cancel » (anciens Chrome), le bouton resterait bloqué.
    const fichier = await choisirFichier();
    if (!fichier || lectureEnCours) return;
    lectureEnCours = true;
    let lu;
    try {
      lu = await lireTexte(fichier, FICHIER_MAX);
    } finally {
      lectureEnCours = false;
    }
    source = 'fichier';
    messageSerie = '';
    erreurFichier = lu.erreur ?? null;
    texte = lu.texte ?? '';
    colle = true;
    zoneTexte.value = '';
    serie.actif = false;
    serie.reprise = new Set();
    oublierChoix();
    copieFaite = false;
    enregistre = false;
    signature = '';
    focaliserResultat = true;
    dessiner();
  }

  /** Nouveau texte : cases et choix de l'aperçu précédent oubliés. */
  function oublierChoix() {
    decoches = new Set();
    choix = {};
    cases = {};
    quandMeme = new Set();
    messageEnvoi = '';
  }

  /**
   * Choix d'un lot de relecture, au format de coeur/relecture.js › ecrituresRelecture. Les clés des cases portent
   * l'identifiant du plat : le même produit dans deux recettes (un œuf cru dans deux desserts) a deux cases
   * indépendantes.
   */
  function choixRelecture() {
    const resultat = { ...cases };
    for (const platId of quandMeme) resultat[cleQuandMeme(platId)] = true;
    return resultat;
  }

  /** Écritures d'un lot de relecture selon les cases : seules celles qui écrivent quelque chose (repère ou marque). */
  function preparerRelecture(prepares) {
    return { ...prepares, ecritures: ecrituresRelecture(prepares, choixRelecture()), demandesAClore: [] };
  }

  function effacer() {
    clearTimeout(minuteurSaisie);
    messageSerie = '';
    serie.actif = false;
    serie.reprise = new Set();
    oublierChoix();
    texte = '';
    colle = false;
    source = 'collage';
    erreurFichier = null;
    zoneTexte.value = '';
    signature = '';
    dessiner();
    boutonColler.focus();
  }

  function analyser(nouveau, { manuel }) {
    // Lot d'étapes en cours d'envoi : l'aperçu reste figé jusqu'à la fin des transactions.
    if (envoi) return;
    texte = nouveau ?? '';
    messageSerie = '';
    // Un nouveau collage remplace la carte de série par son aperçu (le compte de la visite reste).
    serie.actif = false;
    serie.reprise = new Set();
    source = 'collage';
    erreurFichier = null;
    // Zone vidée à la main : rien à montrer. Presse-papiers vide : on le dit.
    colle = !manuel || Boolean(texte.trim());
    oublierChoix();
    copieFaite = false;
    enregistre = false;
    signature = '';
    focaliserResultat = !manuel || Boolean(extrairePaquet(texte).paquets);
    dessiner();
  }

  /** Calcule l'aperçu ; ne reconstruit l'affichage que s'il a changé. */
  function dessiner() {
    majEntete();
    noteHorsLigne.hidden = navigator.onLine;
    const etat = calculer();
    dernierEtat = etat;
    // Carte de série : son « Coller la suite » est la seule action principale (même place, même taille en haut).
    boutonColler.className = `bouton ${etat.type === 'serie' ? 'bouton-secondaire' : 'bouton-principal'} bouton-plein`;
    const nouvelleSignature = JSON.stringify([etat, copieFaite, [...decoches], choix, cases, [...quandMeme], messageEnvoi, navigator.onLine, zoneSerieOuverte, Boolean(envoi), messageSerie]);
    if (nouvelleSignature === signature) return;
    signature = nouvelleSignature;
    if (etat.type !== 'pret') preparation = null;
    else preparation = etat.relecture ? preparerRelecture(etat.preparation) : filtrerPreparation(etat.preparation, decoches);

    // Un texte collé, lisible ou non, disparaît de l'écran : il contient des mots techniques (§4).
    const traite = etat.type !== 'rien' && !(etat.type === 'illisible' && etat.code === 'vide');
    // Carte de série : elle dit déjà ce qu'il en est du message ; « Effacer » y ferait croire qu'on retire les idées.
    ligneCollee.hidden = !traite || etat.type === 'serie';
    texteLigneCollee.textContent = source === 'fichier' ? '✓ Fichier lu' : '✓ Réponse collée';
    if (traite) {
      zoneTexte.value = '';
      collageManuel.open = false;
    }
    // Une recette lue : l'explication du presse-papiers bloqué n'a plus lieu d'être.
    if (['pret', 'erreurs', 'chargement', 'sauvegarde', 'batch', 'erreursBatch', 'refusBatch'].includes(etat.type) || source === 'fichier') aideBlocage.hidden = true;

    // Le bouton qui avait le focus (copie, enregistrement) le retrouve après la reconstruction ; sinon le titre.
    const actif = resultat.contains(document.activeElement) ? document.activeElement.dataset.action ?? 'titre' : null;
    resultat.replaceChildren(...rendu(etat));
    const titre = resultat.querySelector('[data-titre-resultat]');
    if (focaliserResultat) {
      focaliserResultat = false;
      titre?.focus();
    } else if (actif) {
      (resultat.querySelector(`[data-action="${actif}"]`) ?? titre)?.focus({ preventScroll: true });
    }
  }

  /** Plats encore à détailler, lus dans la base (partagés entre appareils) : la semaine d'abord (T5-0b). */
  const aDetaillerMaintenant = () => platsADetailler(tousLesPlats(), {
    semaines: courant.semaines ?? [],
    aujourdhui: courant.aujourdhui ?? new Date(),
  });

  /**
   * Carte de série (T5-0a) : après l'enregistrement d'un message d'idées, ou un message d'idées recollé ; T5-0b :
   * après un lot d'étapes (« ✓ 4 recettes détaillées », « Encore N recettes à détailler. »).
   */
  function etatCarteSerie(recolle = false, nature = serie.nature) {
    if (nature === 'etapes') {
      return {
        type: 'serie',
        ...etatSerie({
          nature: 'etapes',
          ajoutesDepuisOuverture: serie.ajoutes,
          dernier: recolle ? [] : serie.dernier,
          nonRepris: recolle ? [] : serie.nonRepris,
          recolle,
          aDetailler: aDetaillerMaintenant(),
          reponses: serie.reponses,
          refuses: [...serie.refuses.values()],
        }),
      };
    }
    return {
      type: 'serie',
      ...etatSerie({
        nature: 'idees',
        ajoutesDepuisOuverture: serie.ajoutes,
        dernier: recolle ? [] : serie.dernier,
        autres: recolle ? [] : serie.autres,
        nonRepris: recolle ? [] : serie.nonRepris,
        recolle,
      }),
    };
  }

  /** Écran en série : jamais pour « Coller la recette » d'une fiche ni depuis Demandes (retours d'aujourd'hui). */
  const serieIci = () => !cible && !depuisDemandes();
  /** Série d'étapes en cours : une recette entière collée pour un plat qui a déjà la sienne est refusée (T5-0b). */
  const serieEtapesActive = () => serieIci() && (serieEtapes || serie.nature === 'etapes');

  /**
   * Lot d'étapes (réponse à DEMANDE-ETAPES, T5-0b) : chaque entrée vaut pour elle-même, refusée en entier si la
   * réponse vient d'une autre version des instructions.
   */
  function calculerEtapes(extrait, validation) {
    const controle = controlerInstructions(extrait.paquets);
    const prepares = preparerImport(entreesPourImport(validation), { plats: tousLesPlats(), controle });
    if (prepares.refus) return { type: 'refusEtapes', refus: prepares.refus, message: prepares.messageRefus };
    // Message recollé dans la série : rien de nouveau, la carte le dit.
    if (serie.nature === 'etapes' && serie.ids.length && serieIci() && dejaEnregistre(prepares, serie.ids)) {
      return etatCarteSerie(true, 'etapes');
    }
    return { type: 'pret', validation, preparation: prepares, instructions: null, relecture: false, lotDEtapes: true };
  }

  /**
   * Plan de batch collé (2026-10-19) : jugé face à la semaine montrée (coeur/plan-batch.js › validerPlanBatch : plats,
   * recettes et parts au moment du collage ; sans semaine montrée, refusé). → chargement | refusBatch (autre semaine,
   * plats changés depuis la demande) | erreursBatch (à faire corriger par Claude) | batch (aperçu).
   */
  function calculerBatch(extrait) {
    const { batch: brut, instructions: version } = planDeLaReponse(extrait.paquets);
    // Jugé face à la semaine montrée seulement : c'est elle dont Semaine montre le plan (une réponse pour une autre
    // semaine, même connue, est refusée).
    if (!courant.semainesChargees || (courant.semaine && !courant.batch)) return { type: 'chargement' };
    const reference = courant.batch;
    const validation = validerPlanBatch(brut, {
      elements: reference?.elements ?? [],
      semaineId: reference?.semaineId ?? null,
      empreinte: reference ? empreintePlanBatch(reference.elements) : null,
      appareils: appareilsDuFoyer(courant.reglages ?? null),
    });
    if (validation.refus) return { type: 'refusBatch', refus: validation.refus };
    if (!validation.plan) return { type: 'erreursBatch', erreurs: validation.erreurs, semaineId: reference?.semaineId ?? null };
    const semaine = (courant.semaines ?? []).find((s) => s?.id === reference.semaineId) ?? null;
    return {
      type: 'batch',
      semaineId: reference.semaineId,
      plan: validation.plan,
      empreinte: validation.plan.empreinte,
      portions: portionsDuBatch(reference.elements),
      version: Number.isInteger(version) ? version : null,
      noms: Object.fromEntries(reference.elements.map((e) => [e.platId, e.plat?.nom ?? e.platId])),
      dates: texteSemaineDuPlan(semaine),
      remplace: Boolean(reference.doc?.plan),
      avertissements: [
        controlerInstructions(extrait.paquets)?.message ?? null,
        ...validation.avertissements.map((a) => a.message),
      ].filter(Boolean),
    };
  }

  function calculer() {
    if (envoi) return envoi.etat;
    if (serie.actif) return etatCarteSerie();
    if (!colle) return { type: 'rien' };
    if (erreurFichier) return { type: 'illisible', code: erreurFichier === 'trop_gros' ? 'trop_long' : 'illisible' };
    const extrait = extrairePaquet(texte, source === 'fichier' ? { max: FICHIER_MAX } : undefined);
    if (extrait.erreur) return { type: 'illisible', code: extrait.erreur };
    // Une sauvegarde passe par Réglages › Restaurer : ici, elle effacerait les marques « modifiée à la main » et
    // pourrait recréer en double un plat renommé depuis.
    if (estSauvegarde(extrait.paquets)) return { type: 'sauvegarde' };
    // Plan de batch (réponse à DEMANDE-BATCH, 2026-10-19) : son propre aperçu, jamais des recettes.
    if (estReponseBatch(extrait.paquets)) return calculerBatch(extrait);
    const validation = validerPaquet(extrait.paquets, {
      profils: courant.profilsCharges ? courant.profils : null,
      relectureEnCours: courant.actions?.lireRelectureEnCours?.() ?? [],
      serieEtapes: serieEtapesActive(),
    });
    if (!validation.valide) return { type: 'erreurs', validation };
    // Sans les plats et les demandes, un plat déjà présent passerait pour nouveau : on attend leur chargement.
    // Sans les profils, une version ne peut pas être jugée.
    if (!courant.platsCharges || !courant.demandesChargees || !courant.profilsCharges) return { type: 'chargement' };
    if (validation.lotDEtapes) return calculerEtapes(extrait, validation);
    // Lot de relecture des repères (T2d) d'une autre version des instructions : jamais enregistrable.
    const relecture = Boolean(validation.relecture);
    if (relecture && controlerInstructions(extrait.paquets)) return { type: 'illisible', code: 'relecture' };
    const prepares = preparerImport(validation.plats.map((plat) => plat.donnees), {
      plats: tousLesPlats(),
      demandes: courant.demandes,
      cible,
      profils: courant.profils,
      choix,
      // Dernier lot de relecture copié sur ce téléphone : des recettes entières rendues à sa place sont une erreur.
      relectureEnCours: courant.actions?.lireRelectureEnCours?.() ?? [],
      // Série d'étapes (T5-0b) : une recette entière pour un plat qui a déjà la sienne n'est pas reprise.
      serieEtapes: serieEtapesActive(),
    });
    // Plats gardés sans leurs erreurs (ils n'en ont pas) : la correction pour Claude sait si le lot était de versions.
    if (prepares.erreurs.length) {
      // Recettes entières rendues à la place d'une relecture (T2d) : la correction redemande des relectures seules,
      // et ne cite pas parmi « les autres plats du lot » ceux qu'elle redemande déjà.
      const fautifs = new Set(prepares.relecture
        ? prepares.erreurs.map((e) => /^plats\[(\d+)\]/.exec(e.pourClaude ?? '')?.[1]).filter(Boolean).map(Number)
        : []);
      return {
        type: 'erreurs',
        validation: {
          ...validation,
          plats: validation.plats.filter((plat) => !fautifs.has(plat.index)).map((plat) => ({ ...plat, erreurs: [] })),
          erreurs: prepares.erreurs,
          ...(prepares.relecture ? { relecture: true } : {}),
        },
      };
    }
    // Série d'idées (T5-0a) : le même message recollé (il vise des plats écrits pendant la visite) n'apporte rien de
    // nouveau, la carte le dit.
    if (serie.ids.length && serieIci() && !relecture && natureDuMessage(validation) === 'idees'
      && dejaEnregistre(prepares, serie.ids)) {
      return etatCarteSerie(true, 'idees');
    }
    // Réponse écrite avec d'autres instructions que celles de l'app : prévenu, sans bloquer (message seul).
    const instructions = controlerInstructions(extrait.paquets)?.message ?? null;
    return { type: 'pret', validation, preparation: prepares, instructions, relecture };
  }

  function titreResultat(texteTitre) {
    return el('h2', { tabindex: '-1', 'data-titre-resultat': '' }, texteTitre);
  }

  function boutonCopierCorrections(probleme, { secondaire = false, message = MESSAGE_COPIE } = {}) {
    return el('button', {
      class: `bouton ${secondaire ? 'bouton-secondaire' : 'bouton-principal'} bouton-plein`,
      type: 'button',
      'data-action': 'copier-corrections',
      onclick: async () => {
        const reussi = await copier(texteCorrectionPourClaude(probleme));
        if (reussi) {
          copieFaite = true;
          dessiner();
          annoncer(message);
        } else {
          annoncer('La copie n’a pas marché. Réessayez.');
        }
      },
    }, '📋 Copier les corrections pour Claude');
  }

  const messageCopie = (message = MESSAGE_COPIE) => el('p', { class: 'aide' }, message);

  function rendu(etat) {
    switch (etat.type) {
      case 'rien':
        return [];
      case 'illisible': {
        const corrigeable = etat.code === 'coupee';
        const titres = source === 'fichier' ? TITRES_FICHIER : TITRES_EXTRACTION;
        const messages = source === 'fichier' ? MESSAGES_FICHIER : MESSAGES_EXTRACTION;
        return [el('section', { class: 'carte resultat-erreur' },
          titreResultat(titres[etat.code] ?? titres.aucune),
          el('p', { role: 'alert' }, messages[etat.code] ?? messages.aucune),
          etat.code === 'instructions' || etat.code === 'relecture'
            ? el('a', { class: 'bouton bouton-principal bouton-plein', href: '#/reglages', 'data-action': 'reglages' },
              'Ouvrir Réglages')
            : null,
          corrigeable ? boutonCopierCorrections({ erreur: etat.code }) : null,
          corrigeable && copieFaite ? messageCopie() : null,
        )];
      }
      case 'sauvegarde':
        return [el('section', { class: 'carte resultat-erreur' },
          titreResultat('C’est une sauvegarde'),
          el('p', { role: 'alert' },
            'C’est une sauvegarde\u00A0: pour la remettre, utilisez Réglages › Restaurer une sauvegarde.'),
          el('a', {
            class: 'bouton bouton-principal bouton-plein',
            href: '#/restaurer',
            'data-action': 'restaurer',
          }, 'Restaurer une sauvegarde'),
        )];
      case 'chargement':
        return [el('section', { class: 'carte' },
          titreResultat('Recette lue'),
          el('p', { class: 'texte-doux', role: 'status' }, 'Chargement des plats…'),
          el('button', { class: 'bouton bouton-principal bouton-plein', type: 'button', disabled: true }, 'Enregistrer'),
        )];
      case 'erreurs': {
        const { validation } = etat;
        const messages = [
          ...validation.erreurs.map((e) => e.message),
          ...validation.plats.flatMap((plat) => plat.erreurs.map((e) => e.message)),
        ];
        return [el('section', { class: 'carte resultat-erreur' },
          titreResultat(messages.length > 1 ? `${messages.length} points à corriger` : '1 point à corriger'),
          el('ul', { class: 'liste-erreurs', role: 'alert' }, messages.map((message) => el('li', {}, `⚠️ ${message}`))),
          boutonCopierCorrections(validation),
          copieFaite ? messageCopie() : null,
        )];
      }
      case 'refusEtapes':
        // Lot d'étapes d'une autre version des instructions (T5-0b) : rien n'est enregistrable.
        return [el('section', { class: 'carte resultat-erreur' },
          titreResultat(TITRES_ALIGNEMENT[etat.refus] ?? TITRES_ALIGNEMENT.instructions),
          el('p', { role: 'alert' }, etat.message),
          etat.refus === 'instructions'
            ? el('a', { class: 'bouton bouton-principal bouton-plein', href: '#/reglages', 'data-action': 'reglages' },
              'Ouvrir Réglages')
            : null,
        )];
      case 'serie':
        return [renduSerie(etat)];
      case 'refusBatch':
        return [el('section', { class: 'carte resultat-erreur' },
          titreResultat(etat.refus === 'perime' ? TEXTES_PLAN_BATCH.titrePerime : TEXTES_PLAN_BATCH.titreAutreSemaine),
          el('p', { role: 'alert' }, etat.refus === 'perime' ? TEXTES_PLAN_BATCH.perimeImport : TEXTES_PLAN_BATCH.autreSemaine),
          el('a', { class: 'bouton bouton-principal bouton-plein', href: '#/semaine', 'data-action': 'semaine' },
            TEXTES_PLAN_BATCH.ouvrirSemaine),
        )];
      case 'erreursBatch':
        return [el('section', { class: 'carte resultat-erreur' },
          titreResultat(etat.erreurs.length > 1 ? `${etat.erreurs.length} points à corriger` : '1 point à corriger'),
          el('ul', { class: 'liste-erreurs', role: 'alert' }, etat.erreurs.map((e) => el('li', {}, `⚠️ ${e.message}`))),
          el('button', {
            class: 'bouton bouton-principal bouton-plein',
            type: 'button',
            'data-action': 'copier-corrections',
            onclick: async () => {
              const reussi = await copier(texteCorrectionBatch({ erreurs: etat.erreurs, semaineId: etat.semaineId }));
              if (reussi) {
                copieFaite = true;
                dessiner();
                annoncer(MESSAGE_COPIE);
              } else {
                annoncer('La copie n’a pas marché. Réessayez.');
              }
            },
          }, '📋 Copier les corrections pour Claude'),
          copieFaite ? messageCopie() : null,
        )];
      case 'batch':
        return [renduBatch(etat)];
      default:
        if (etat.lotDEtapes) return [renduEtapes(etat)];
        return [etat.relecture ? renduRelecture(etat) : renduPret(etat)];
    }
  }

  /**
   * Carte de série (T5-0a, CLAUDE.md §8) : « ✓ 3 idées ajoutées », noms, « 6 depuis l’ouverture de cet écran. »,
   * aide, « 📋 Coller la suite » (principal), « Terminé » et « Voir les plats › ». Focus sur le titre ; titre, noms et
   * compte dans une zone `role="status"`.
   * Étapes (T5-0b) : « ✓ 4 recettes détaillées », noms, recettes pas reprises, « Encore N recettes à détailler. » ;
   * après 5 réponses, le conseil de nouvelle conversation et « 📋 Recopier la demande pour les N restantes » ;
   * recettes refusées dans la visite et « 📋 Redemander ces N recettes » ; fin « ✓ Toutes vos recettes sont détaillées
   * 🎉 » : « Terminé » devient principal, « Coller la suite » s'en va.
   */
  function renduSerie(etat) {
    const textes = texteSerie(etat);
    const etapes = etat.nature === 'etapes';
    const fini = etapes && !etat.recolle && etat.restants === 0;
    // Message recollé : « Ce message est déjà enregistré. Écrivez « suite » à Claude pour le suivant. » d'un tenant.
    const aide = textes.aide ? el('p', { class: 'aide', id: 'aide-suite' }, textes.aide) : null;
    return el('section', { class: 'carte resultat-serie' },
      el('div', { class: 'serie-bilan', role: 'status' },
        titreResultat(textes.titre),
        etat.recolle ? aide : null,
        textes.noms.length ? el('ul', { class: 'liste-serie' }, textes.noms.map((nom) => el('li', {}, nom))) : null,
        textes.autres.length
          ? el('ul', { class: 'liste-avertissements' }, textes.autres.map((m) => el('li', {}, m)))
          : null,
        textes.nonRepris.length
          ? el('ul', { class: 'liste-avertissements' }, textes.nonRepris.map((m, i) => el('li', {},
            `⚠️ ${m}`,
            boutonRemettreSerie(etat.nonRepris[i]))))
          : null,
        etapes && textes.restants ? el('p', { class: fini ? 'serie-fin' : 'texte-doux' }, textes.restants) : null,
        textes.depuis ? el('p', { class: 'texte-doux' }, textes.depuis) : null),
      etat.recolle ? null : aide,
      fini ? null : el('button', {
        class: 'bouton bouton-principal bouton-plein',
        type: 'button',
        'data-action': 'coller-suite',
        'aria-describedby': aide ? 'aide-suite' : null,
        onclick: collerLaSuite,
      }, TEXTES_SERIE.collerLaSuite),
      zoneSerieOuverte && !fini ? blocZoneSerie : null,
      etapes ? (navigator.onLine ? null : el('p', { class: 'aide' }, TEXTES_ETAPES.horsLigne)) : noteHorsLigne,
      etapes && textes.conseil ? el('p', { class: 'aide' }, textes.conseil) : null,
      etapes && textes.recopier
        ? el('button', {
          class: 'bouton bouton-secondaire bouton-plein',
          type: 'button',
          'data-action': 'recopier-etapes',
          onclick: recopierLaDemande,
        }, textes.recopier)
        : null,
      etapes && textes.refuses ? el('p', {}, textes.refuses) : null,
      etapes && textes.redemander
        ? el('button', {
          class: 'bouton bouton-secondaire bouton-plein',
          type: 'button',
          'data-action': 'redemander-etapes',
          onclick: redemanderLesRefusees,
        }, textes.redemander)
        : null,
      etapes ? el('p', { class: 'aide', role: 'status', 'data-zone': 'copie-serie' }, messageSerie) : null,
      el('div', { class: 'actions-serie' },
        el('button', {
          class: `bouton ${fini ? 'bouton-principal' : 'bouton-secondaire'}`,
          type: 'button',
          'data-action': 'terminer-serie',
          onclick: terminerSerie,
        }, TEXTES_SERIE.termine),
        etapes ? null : el('a', {
          class: 'bouton bouton-secondaire',
          href: '#/plats',
          'data-action': 'voir-plats',
          onclick: voirLesPlats,
        }, TEXTES_SERIE.voirLesPlats)),
    );
  }

  /**
   * Demande d'étapes copiée depuis la carte de série : la carte dit comment continuer, dans sa zone `role="status"`
   * (T5-0b ; jamais aussi par `annoncer`, qui recouvrirait la carte du même texte).
   */
  function copieDeLaSerie(reussi) {
    messageSerie = reussi ? TEXTES_ETAPES.annonceCopie : 'La copie n’a pas marché. Réessayez.';
    dessiner();
  }

  /** « 📋 Recopier la demande pour les N restantes » : pour une nouvelle conversation Claude (T5-0b). */
  async function recopierLaDemande() {
    if (carteTropRecente()) return;
    const plats = aDetaillerMaintenant();
    if (!plats.length) return;
    // Texte calculé dans le toucher, avant toute attente : la copie de repli reste permise.
    copieDeLaSerie(await copier(texteDemandeEtapes(plats, { reglages: courant.reglages ?? null })));
  }

  /** « 📋 Redemander ces N recettes » : les recettes pas reprises dans la visite, avec leurs lignes `à corriger:`. */
  async function redemanderLesRefusees() {
    if (carteTropRecente()) return;
    const encore = new Map(aDetaillerMaintenant().map((plat) => [plat.id, plat]));
    const refuses = [...serie.refuses.values()].filter((plat) => encore.has(plat.id));
    if (!refuses.length) return;
    const aCorriger = Object.fromEntries(refuses.filter((plat) => plat.aCorriger.length).map((plat) => [plat.id, plat.aCorriger]));
    copieDeLaSerie(await copier(texteDemandeEtapes(refuses.map((plat) => encore.get(plat.id)), {
      reglages: courant.reglages ?? null,
      aCorriger,
    })));
  }

  /**
   * « Remettre » sous une idée non reprise de la carte : seulement si le plat, remis, prendrait la recette
   * (`remettable`) et qu'il est encore dans la corbeille ; la phrase de l'aperçu (« remettez-le pour lui ajouter cette
   * recette ») reste ainsi vraie.
   */
  function boutonRemettreSerie(entree) {
    if (!entree?.remettable) return null;
    const plat = tousLesPlats().find((p) => p.id === entree.id);
    if (!estDansCorbeille(plat)) return null;
    return el('button', {
      class: 'bouton bouton-secondaire bouton-remettre-apercu',
      type: 'button',
      'data-action': `remettre-${plat.id}`,
      'aria-label': `Remettre «\u00A0${plat.nom}\u00A0» dans vos plats`,
      onclick: () => remettreDepuisLaSerie(plat),
    }, TEXTES_SERIE.remettre);
  }

  /** Case « l'enregistrer » d'un plat de l'aperçu (lot de plusieurs écritures). */
  function caseDuPlat(element) {
    const idCase = `garder-${element.id}`;
    return el('label', { class: 'case-apercu', for: idCase },
      el('input', {
        type: 'checkbox',
        id: idCase,
        'data-action': idCase,
        checked: !decoches.has(element.id),
        onchange: (evenement) => {
          if (evenement.target.checked) decoches.delete(element.id);
          else decoches.add(element.id);
          messageEnvoi = '';
          dessiner();
        },
      }),
      el('span', { class: 'visuellement-masque' }, `Enregistrer «\u00A0${element.nom}\u00A0»`));
  }

  /** « Ne prendre que sa version » / « Remplacer la recette » pour une fiche complète différente de l'actuelle. */
  function choixDuPlat(element) {
    const nom = `choix-${element.id}`;
    return el('fieldset', { class: 'groupe-choix choix-cartes choix-import' },
      el('legend', { class: 'etiquette-champ' }, 'Claude a aussi changé la recette'),
      CHOIX.map(({ valeur, libelle, aide }) => el('label', { class: 'choix-carte' },
        el('input', {
          type: 'radio',
          name: nom,
          value: valeur,
          'data-action': `${nom}-${valeur}`,
          checked: element.choix.retenu === valeur,
          onchange: () => {
            choix = { ...choix, [element.id]: valeur };
            messageEnvoi = '';
            dessiner();
          },
        }),
        el('span', { class: 'choix-carte-texte' },
          el('span', { class: 'choix-carte-libelle' }, libelle),
          el('span', { class: 'choix-carte-aide' }, aide)),
        el('span', { class: 'choix-carte-coche', 'aria-hidden': 'true' }, '✓'))));
  }

  /**
   * Plat validé d'où vient un élément de l'aperçu : par sa position dans le collage (`index`, posé par
   * preparerImport) ; à défaut, même rang s'il n'en manque aucun, puis même identifiant, puis même nom.
   */
  function validationDe(validation, elements, element, i) {
    if (Number.isInteger(element.index) && validation.plats[element.index]) return validation.plats[element.index];
    if (validation.plats.length === elements.length) return validation.plats[i];
    return validation.plats.find((plat) => plat.donnees?.id === element.id)
      ?? validation.plats.find((plat) => plat.donnees?.nom === element.nom) ?? null;
  }

  /** Ligne de détail d'un plat de l'aperçu. */
  function detailDuPlat(element) {
    if (element.statut === 'identique') return 'Identique à la fiche actuelle.';
    if (element.statut === 'corbeille') return 'Rien n’est enregistré pour ce plat.';
    if (['versions', 'inchange', 'deja', 'refusee'].includes(element.statut)) return 'La recette actuelle est gardée.';
    if (!element.ingredients) return 'Sans recette pour l’instant (⏳)';
    return [pluriel(element.ingredients, 'ingrédient', 'ingrédients'), element.etapes ? pluriel(element.etapes, 'étape', 'étapes') : null]
      .filter(Boolean).join(' · ');
  }

  /**
   * « Remettre » d'un élément « Dans la corbeille » : le plat revient, l'aperçu se recalcule aussitôt (sans recoller).
   * Seulement si le plat, remis, prendrait ce qui est reçu (`remettable`, décidé par preparerImport) : pas pour une
   * idée de Claude visant un plat qui a déjà sa recette, ni pour une réponse qui n'apporte rien à ce plat.
   */
  function boutonRemettre(element) {
    if (!element.remettable) return null;
    const plat = tousLesPlats().find((p) => p.id === element.id);
    if (!estDansCorbeille(plat)) return null;
    return el('button', {
      class: 'bouton bouton-secondaire bouton-remettre-apercu',
      type: 'button',
      'data-action': `remettre-${element.id}`,
      'aria-label': `Remettre «\u00A0${plat.nom}\u00A0» dans vos plats`,
      onclick: () => courant.actions.remettreDeLaCorbeille([plat.id]),
    }, 'Remettre');
  }

  function renduPret({ validation, preparation: prepares, instructions }) {
    // Une idée déjà dans les plats, ou un plat de la corbeille, n'est pas repris : il ne compte pas parmi les recettes
    // prêtes.
    const deja = prepares.elements.filter((element) => element.statut === 'deja').length;
    const jetes = prepares.elements.filter((element) => element.statut === 'corbeille').length;
    // Recette entière glissée dans une série d'étapes (T5-0b) : pas reprise.
    const refusees = prepares.elements.filter((element) => element.statut === 'refusee').length;
    const n = prepares.elements.length - deja - jetes - refusees;
    const ecrivables = prepares.elements.filter((element) => !sansEcriture(element));
    const filtree = preparation ?? prepares;
    const comptes = compterEcritures(filtree.ecritures);
    const aEcrire = comptes.recettes + comptes.versions;
    const aClore = aEcrire ? 0 : filtree.demandesAClore.length;
    // Cases seulement pour un lot : décocher le seul plat collé reviendrait à ne rien enregistrer.
    const avecCases = ecrivables.length > 1;
    const versionsSeules = ecrivables.length > 0 && ecrivables.every((element) => element.statut === 'versions');
    const avecVersions = filtree.ecritures.some((ecriture) => ecriture.mode === 'versions');
    const horsLigne = !navigator.onLine && avecVersions;
    // La version des instructions d'abord ; jamais dans le texte « Copier les corrections pour Claude ».
    const avertissementsGeneraux = [
      instructions,
      ...[...validation.avertissements, ...prepares.avertissements].map((a) => a.message),
    ].filter(Boolean);
    let titre;
    if (!ecrivables.length && refusees) titre = 'Rien de nouveau à enregistrer.';
    else if (!ecrivables.length && jetes && !deja && !n) titre = jetes > 1 ? 'Ces plats sont dans la corbeille.' : 'Ce plat est dans la corbeille.';
    else if (!ecrivables.length && jetes) titre = 'Rien de nouveau à enregistrer.';
    else if (!ecrivables.length && deja) {
      if (n) titre = 'Ces recettes sont déjà dans l’app.';
      else titre = deja > 1 ? 'Ces idées sont déjà dans vos plats.' : 'Cette idée est déjà dans vos plats.';
    } else if (!ecrivables.length) titre = n > 1 ? 'Ces recettes sont déjà dans l’app, à l’identique.' : 'Cette recette est déjà dans l’app, à l’identique.';
    else if (versionsSeules) {
      const versions = ecrivables.reduce((total, element) => total + (element.versions?.length ?? 0), 0);
      titre = versions > 1 ? `${versions}\u00A0versions prêtes` : '1\u00A0version prête';
    } else titre = n > 1 ? `${n}\u00A0recettes prêtes` : '1 recette prête';
    const corrections = filtree.corrections ?? [];
    return el('section', { class: 'carte resultat-pret' },
      titreResultat(titre),
      avertissementsGeneraux.length
        ? el('ul', { class: 'liste-avertissements' }, avertissementsGeneraux.map((m) => el('li', {}, `⚠️ ${m}`)))
        : null,
      el('ul', { class: 'liste-apercu' }, prepares.elements.map((element, i) => {
        const identique = sansEcriture(element);
        const nonReprise = nonRepris(element);
        const valide = validationDe(validation, prepares.elements, element, i);
        const garde = !decoches.has(element.id);
        // Idée non reprise : seul son avertissement compte (ceux de sa recette, jamais écrite, n'ont plus d'objet).
        const avertissements = [
          element.statut === 'refusee' ? element.raison : null,
          identique || element.statut === 'versions' ? null : avertissementModification(element.modifieeA),
          ...(nonReprise ? [] : (valide?.avertissements ?? []).map((a) => a.message)),
          ...(element.avertissements ?? []),
        ].filter(Boolean);
        return el('li', { class: `apercu-plat${avecCases && !identique ? ' avec-case' : ''}${garde ? '' : ' decoche'}` },
          avecCases && !identique ? caseDuPlat(element) : null,
          el('div', { class: 'apercu-corps' },
            el('p', { class: 'apercu-nom' }, element.nom),
            el('p', { class: 'badges' }, el('span', { class: `badge badge-${element.statut}` }, LIBELLES_STATUT[element.statut] ?? '')),
            element.ancienNom && !nonReprise ? el('p', { class: 'texte-doux' }, `Renommé\u00A0: «\u00A0${element.ancienNom}\u00A0» → «\u00A0${element.nom}\u00A0»`) : null,
            !nonReprise && (element.versions ?? []).length
              ? el('ul', { class: 'apercu-versions' }, element.versions.map((version) => el('li', {
                class: version.convient ? 'compat-version' : 'compat-discret',
              }, version.libelle)))
              : null,
            el('p', { class: 'texte-doux' }, detailDuPlat(element)),
            // Recette remplacée : les repères de précaution de la fiche sont gardés (T2d), et le texte le dit.
            element.statut === 'remplace' && element.reperesGardes && garde
              ? el('p', { class: 'texte-doux' }, element.reperesGardes)
              : null,
            element.statut === 'remplace' && element.reperesPerdus && garde
              ? el('p', { class: 'texte-doux' }, element.reperesPerdus)
              : null,
            element.choix && !nonReprise ? choixDuPlat(element) : null,
            avertissements.length
              ? el('ul', { class: 'liste-avertissements' }, avertissements.map((m) => el('li', {}, `⚠️ ${m}`)))
              : null,
            garde ? null : el('p', { class: 'texte-doux' }, 'Ne sera pas enregistré.'),
            element.statut === 'corbeille' ? boutonRemettre(element) : null,
          ),
        );
      })),
      // Versions importées qui ne conviennent pas encore : la demande reste ouverte, Claude peut les corriger.
      // Rien encore d'enregistré : la consigne dit d'enregistrer avant de coller la réponse corrigée.
      corrections.length ? boutonCopierCorrections({ corrections }, { secondaire: true, message: aEcrire ? MESSAGE_COPIE_ENREGISTRER : MESSAGE_COPIE }) : null,
      corrections.length && copieFaite ? messageCopie(aEcrire ? MESSAGE_COPIE_ENREGISTRER : MESSAGE_COPIE) : null,
      messageEnvoi ? el('p', { class: 'message-erreur', role: 'alert' }, messageEnvoi) : null,
      // Toutes identiques : rien à enregistrer, sauf une demande de recette restée ouverte, à clore. Tout décoché :
      // le bouton reste, inactif.
      ecrivables.length || aClore
        ? el('button', {
          class: 'bouton bouton-principal bouton-plein',
          type: 'button',
          'data-action': 'enregistrer',
          disabled: (!aEcrire && !aClore) || horsLigne,
          onclick: enregistrer,
        }, aEcrire || aClore ? libelleEnregistrer(comptes, aClore) : 'Rien de coché')
        : null,
      horsLigne ? el('p', { class: 'aide' }, 'Hors ligne\u00A0: il faut être connecté pour ajouter des versions.') : null,
      !horsLigne && comptes.recettes ? noteHorsLigne : null,
    );
  }

  /**
   * Aperçu d'un lot d'étapes (T5-0b, CLAUDE.md §8) : « 3 recettes reçoivent leurs étapes détaillées. Le reste des
   * recettes ne change pas. » ; par recette reprise, « « Gratin » : 9 étapes, dont 21 min de travail. », ses lignes
   * d'état et « Voir les étapes » (titres numérotés, repliés) ; chaque recette pas reprise dit pourquoi (elle reste à
   * détailler). Bouton « Enregistrer les étapes de 3 recettes », inactif hors ligne ; « Enregistrement… » pendant
   * l'envoi (aperçu figé).
   */
  function renduEtapes({ preparation: prepares }) {
    const filtree = preparation ?? prepares;
    const elements = prepares.elements ?? [];
    const ecrivables = elements.filter((element) => element.statut === 'etapes');
    // Cases seulement pour plusieurs recettes : décocher la seule reviendrait à ne rien enregistrer.
    const avecCases = ecrivables.length > 1;
    const { entete } = enteteApercuEtapes(prepares);
    const { bouton, actif } = enteteApercuEtapes(filtree);
    const horsLigne = !navigator.onLine;
    const enCours = Boolean(envoi);
    return el('section', { class: 'carte resultat-pret' },
      titreResultat(entete ?? 'Aucune recette reprise'),
      el('ul', { class: 'liste-apercu' }, elements.map((element) => {
        const lignes = lignesApercuEtapes(element);
        const ecrivable = element.statut === 'etapes';
        const garde = !ecrivable || !decoches.has(element.id);
        const pasReprise = STATUTS_ETAPES_NON_REPRIS.has(element.statut);
        return el('li', { class: `apercu-plat${avecCases && ecrivable ? ' avec-case' : ''}${garde ? '' : ' decoche'}` },
          avecCases && ecrivable ? caseDuPlat(element) : null,
          el('div', { class: 'apercu-corps' },
            lignes.titre ? el('p', { class: 'apercu-nom' }, lignes.titre) : null,
            lignes.etat.map((ligne) => el('p', { class: pasReprise ? '' : 'texte-doux' }, pasReprise ? `⚠️ ${ligne}` : ligne)),
            ecrivable && (element.titres ?? []).length
              ? el('details', { class: 'depliable apercu-titres' },
                el('summary', {}, TEXTES_ETAPES.voirLesEtapes),
                el('ol', { class: 'liste-titres-etapes' }, element.titres.map((titre) => el('li', {}, titre))))
              : null,
            lignes.avertissements.length
              ? el('ul', { class: 'liste-avertissements' }, lignes.avertissements.map((m) => el('li', {}, `⚠️ ${m}`)))
              : null,
            garde ? null : el('p', { class: 'texte-doux' }, 'Ne sera pas enregistré.'),
          ));
      })),
      messageEnvoi ? el('p', { class: 'message-erreur', role: 'alert' }, messageEnvoi) : null,
      // Pendant l'envoi, le bouton garde le focus (aria-disabled plutôt que disabled) et dit « Enregistrement… ».
      el('button', {
        class: 'bouton bouton-principal bouton-plein',
        type: 'button',
        'data-action': 'enregistrer',
        disabled: !enCours && (!actif || horsLigne),
        'aria-disabled': enCours ? 'true' : null,
        'aria-busy': enCours ? 'true' : null,
        onclick: enregistrer,
      }, enCours ? TEXTES_ETAPES.enregistrement : bouton),
      horsLigne && actif ? el('p', { class: 'aide' }, TEXTES_ETAPES.horsLigne) : null,
    );
  }

  /**
   * Lot d'étapes (T5-0b) : en ligne seulement ; une transaction par plat (actions.importer), aperçu figé pendant
   * l'envoi. Ensuite, la carte de série dit ce qui est détaillé, ce qui ne l'est pas (refus à l'envoi compris) et ce
   * qui reste à détailler ; l'écran passe en série d'étapes. Échec : l'aperçu revient, avec le message.
   */
  function enregistrerEtapes() {
    if (envoi || !preparation?.ecritures?.length || preparation.refus) return;
    if (!navigator.onLine) {
      messageEnvoi = TEXTES_ETAPES.horsLigne;
      dessiner();
      annoncer(TEXTES_ETAPES.horsLigne);
      return;
    }
    const envoyee = preparation;
    // Bilan lu avant l'envoi, sur l'aperçu enregistré (plats décochés retirés).
    const bilan = bilanDuMessage(envoyee);
    envoi = { etat: dernierEtat };
    messageEnvoi = '';
    dessiner();
    Promise.resolve(courant.actions.importer(envoyee)).then((resultat) => {
      envoi = null;
      if (detruit) return;
      const refuses = new Set((resultat?.refuses ?? []).map((plat) => plat.id));
      const ajoutes = bilan.ajoutes.filter((plat) => !refuses.has(plat.id));
      const pasRepris = [
        ...bilan.nonRepris,
        ...bilan.ajoutes.filter((plat) => refuses.has(plat.id)).map((plat) => ({
          ...plat, raison: TEXTES_ETAPES.refusEnvoi(plat.nom), remettable: false, aCorriger: [],
        })),
      ];
      serieEtapes = true;
      serie.nature = 'etapes';
      serie.reponses += 1;
      serie.ajoutes = [...serie.ajoutes, ...ajoutes];
      serie.ids = [...serie.ids, ...ajoutes.map((plat) => plat.id)];
      for (const plat of ajoutes) serie.refuses.delete(plat.id);
      for (const entree of pasRepris) {
        if (entree.id) serie.refuses.set(entree.id, { id: entree.id, nom: entree.nom, aCorriger: entree.aCorriger ?? [] });
      }
      serie.dernier = ajoutes;
      serie.autres = [];
      serie.nonRepris = pasRepris;
      serie.actif = true;
      serie.montreeA = performance.now();
      zoneSerie.value = '';
      messageSerie = '';
      oublierChoix();
      focaliserResultat = true;
      dessiner();
    }, (erreur) => {
      envoi = null;
      if (detruit) return;
      messageEnvoi = erreur?.code === 'hors_ligne' ? TEXTES_ETAPES.horsLigne : MESSAGE_ECHEC_ETAPES;
      dessiner();
    });
  }

  /**
   * Aperçu d'un plan de batch (2026-10-19) : la semaine, le nombre d'étapes et la durée, les plats, leurs plats de
   * cuisson, les titres des étapes (repliés), les avertissements ; « Enregistrer le plan du batch ».
   */
  function renduBatch(etat) {
    const { plan } = etat;
    // Comme l'écran du batch : une étape qui allume le four n'est pas une étape à suivre.
    const aSuivre = plan.etapes.filter((etape) => !etape.prechauffer);
    const plats = [...new Set(plan.etapes.flatMap((etape) => etape.plats))].map((id) => etat.noms[id] ?? id);
    return el('section', { class: 'carte resultat-pret' },
      titreResultat([el('span', { 'aria-hidden': 'true' }, '👩‍🍳\u00A0'), TEXTES_PLAN_BATCH.apercuTitre.replace(/^\S+\s*/u, '')]),
      etat.avertissements.length
        ? el('ul', { class: 'liste-avertissements' }, etat.avertissements.map((m) => el('li', {}, `⚠️ ${m}`)))
        : null,
      etat.dates ? el('p', {}, etat.dates) : null,
      el('p', {}, TEXTES_PLAN_BATCH.apercuEtapes(aSuivre.length, texteEnviron(plan.dureeTotale, plan.travail))),
      el('p', { class: 'texte-doux' }, TEXTES_PLAN_BATCH.apercuPlats(listeNoms(plats))),
      plan.recipients.length
        ? el('div', {},
          el('h3', { class: 'apercu-nom' }, TEXTES_PLAN_BATCH.recipients),
          el('ul', { class: 'liste-serie' }, plan.recipients.map((r) => el('li', {},
            TEXTES_PLAN_BATCH.recipient(etat.noms[r.plat] ?? r.plat, r.ustensile, r.taille)))))
        : null,
      el('details', { class: 'depliable apercu-titres' },
        el('summary', {}, TEXTES_PLAN_BATCH.voirLesEtapes),
        el('ol', { class: 'liste-titres-etapes' }, aSuivre.map((etape) => el('li', {}, etape.titre)))),
      etat.remplace ? el('p', { class: 'texte-doux' }, TEXTES_PLAN_BATCH.remplace) : null,
      messageEnvoi ? el('p', { class: 'message-erreur', role: 'alert' }, messageEnvoi) : null,
      el('button', {
        class: 'bouton bouton-principal bouton-plein',
        type: 'button',
        'data-action': 'enregistrer',
        onclick: enregistrer,
      }, TEXTES_PLAN_BATCH.enregistrer),
      navigator.onLine ? null : el('p', { class: 'aide' }, TEXTES_PLAN_BATCH.horsLigne),
    );
  }

  /**
   * Plan de batch : écrit tout de suite (hors ligne : part plus tard), puis retour à l'écran Demandes s'il en vient,
   * sinon à Semaine (un pas en arrière si l'on en vient).
   */
  function enregistrerBatch() {
    const etat = dernierEtat;
    if (enregistre || etat?.type !== 'batch') return;
    const resultat = courant.actions.enregistrerPlanBatch({
      semaineId: etat.semaineId, plan: etat.plan, empreinte: etat.empreinte, portions: etat.portions,
      instructions: etat.version,
    });
    if (resultat?.code !== 'ok') {
      messageEnvoi = TEXTES_PLAN_BATCH.echec;
      dessiner();
      annoncer(TEXTES_PLAN_BATCH.echec);
      return;
    }
    enregistre = true;
    annoncer(TEXTES_PLAN_BATCH.enregistre);
    if (depuisDemandes()) {
      if (courant.routePrecedente === 'demandes' && history.length > 1) history.back();
      else location.replace('#/demandes');
    } else if (courant.routePrecedente === 'semaine' && history.length > 1) history.back();
    else location.replace('#/semaine');
  }

  /** Coché ou non : choix de la personne, sinon ajout coché et retrait décoché. Une case par plat et par repère. */
  const estCochee = (cle, parDefaut) => (Object.hasOwn(cases, cle) ? cases[cle] : parDefaut);

  /** Une case de repère de la relecture (libellé entier cliquable, raison de Claude et suite reliées). */
  function caseRepere(changement, type) {
    const { cle } = changement;
    const idCase = `repere-${cle}`.replace(/[^\w-]/g, '_');
    const cochee = estCochee(cle, type === 'ajout');
    const pourquoi = String(changement.pourquoi ?? '').trim()
      || (type === 'retrait' ? '(sans raison donnée)' : '');
    const idPourquoi = `${idCase}-pourquoi`;
    const libelle = type === 'ajout'
      ? `«\u00A0${changement.produit}\u00A0»\u00A0: ${changement.libelle}`
      : `Enlever «\u00A0${changement.libelle}\u00A0» de «\u00A0${changement.produit}\u00A0»`;
    let suite = null;
    if (type === 'ajout' && !cochee) suite = 'Ne sera pas ajouté.';
    if (type === 'retrait' && cochee) suite = 'Sera enlevé.';
    const idSuite = `${idCase}-suite`;
    const decrite = [pourquoi ? idPourquoi : null, suite ? idSuite : null].filter(Boolean).join(' ');
    return el('li', { class: 'repere-relecture' },
      el('label', { class: 'case-repere-relecture', for: idCase },
        el('input', {
          type: 'checkbox',
          id: idCase,
          'data-action': idCase,
          checked: cochee,
          'aria-describedby': decrite || null,
          onchange: (evenement) => {
            cases = { ...cases, [cle]: evenement.target.checked };
            messageEnvoi = '';
            dessiner();
          },
        }),
        el('span', {}, libelle)),
      pourquoi ? el('p', { class: 'texte-doux repere-pourquoi', id: idPourquoi }, pourquoi) : null,
      suite ? el('p', { class: 'texte-doux repere-suite', id: idSuite }, suite) : null);
  }

  /**
   * Lignes 🌿 d'un plat relu : profils qui ont un régime pour qui le plat, avec les repères cochés, aurait besoin
   * d'une version (coeur/relecture.js › effetsSurLesVersions). Calcul pur, refait à chaque case.
   */
  function effetsVersions(plat, ajoutsCoches, retraitsCoches) {
    if (!plat || !ajoutsCoches.length || !courant.profilsCharges) return [];
    return effetsSurLesVersions(plat, { ajouts: ajoutsCoches, retraits: retraitsCoches }, courant.profils ?? []);
  }

  /** Aperçu d'un lot de relecture des repères (T2d) : une case par repère, puis ce qui ne change pas ou n'est pas repris. */
  function renduRelecture({ validation, preparation: prepares, instructions }) {
    const elements = prepares.elements ?? [];
    const relues = elements.filter((element) => element.statut === 'relecture');
    const dejaRelues = elements.filter((element) => element.statut === 'dejaRelue');
    const nonReprises = elements.filter((element) => RAISONS_NON_REPRISES[element.statut]);
    const ajoutsDe = (element) => element.ajouts ?? [];
    const retraitsDe = (element) => element.retraits ?? [];
    const totalAjouts = relues.reduce((total, element) => total + ajoutsDe(element).length, 0);
    const totalRetraits = relues.reduce((total, element) => total + retraitsDe(element).length, 0);
    // Avertissements de coeur/paquet.js : produit introuvable, nature à corriger, recette changée depuis la demande,
    // « Cette recette restera à relire. ».
    const avertissementsDe = (element) => element.avertissements ?? [];
    const avecQuelqueChose = (element) => ajoutsDe(element).length || retraitsDe(element).length
      || avertissementsDe(element).length || (element.infos ?? []).length || !element.marquerRelue;
    const changeantes = relues.filter(avecQuelqueChose);
    const sansChangement = relues.filter((element) => !avecQuelqueChose(element));
    const comptes = compterEcritures(preparation?.ecritures);
    const horsLigne = !navigator.onLine;
    const vues = relues.length + dejaRelues.length;
    const avertissementsGeneraux = [
      instructions,
      ...[...(validation.avertissements ?? []), ...(prepares.avertissements ?? [])].map((a) => a.message),
    ].filter(Boolean);

    const blocDuPlat = (element) => {
      const plat = tousLesPlats().find((p) => p.id === element.id) ?? null;
      const ajoutsCoches = ajoutsDe(element).filter((ajout) => estCochee(ajout.cle, true));
      const retraitsCoches = retraitsDe(element).filter((retrait) => estCochee(retrait.cle, false));
      const avertissements = avertissementsDe(element);
      const idQuandMeme = `relue-${element.id}`.replace(/[^\w-]/g, '_');
      return el('li', { class: 'apercu-plat apercu-relecture' },
        el('div', { class: 'apercu-corps' },
          el('h3', { class: 'apercu-nom' }, element.nom),
          ajoutsDe(element).length || retraitsDe(element).length
            ? el('ul', { class: 'liste-reperes-relecture' },
              ajoutsDe(element).map((ajout) => caseRepere(ajout, 'ajout')),
              retraitsDe(element).map((retrait) => caseRepere(retrait, 'retrait')))
            : null,
          effetsVersions(plat, ajoutsCoches, retraitsCoches).map((effet) => el('p', { class: 'compat-version' },
            el('span', { 'aria-hidden': 'true' }, '🌿\u00A0'), effet.texte.replace(/^🌿\s*/u, ''))),
          avertissements.length
            ? el('ul', { class: 'liste-avertissements' }, avertissements.map((m) => el('li', {}, `⚠️ ${m}`)))
            : null,
          (element.infos ?? []).map((info) => el('p', { class: 'texte-doux' },
            el('span', { 'aria-hidden': 'true' }, 'ℹ️\u00A0'), info)),
          element.marquerRelue
            ? null
            : el('label', { class: 'case-repere-relecture', for: idQuandMeme },
              el('input', {
                type: 'checkbox',
                id: idQuandMeme,
                'data-action': idQuandMeme,
                checked: quandMeme.has(element.id),
                onchange: (evenement) => {
                  quandMeme = new Set(quandMeme);
                  if (evenement.target.checked) quandMeme.add(element.id);
                  else quandMeme.delete(element.id);
                  messageEnvoi = '';
                  dessiner();
                },
              }),
              el('span', {}, 'La marquer relue quand même')),
        ));
    };

    const phrases = phrasesApercuRelecture(totalAjouts, totalRetraits);
    const rienAEcrire = !relues.length;
    return el('section', { class: 'carte resultat-pret' },
      titreResultat(vues > 1 ? `${vues}\u00A0recettes relues` : vues ? '1\u00A0recette relue' : 'Aucune recette reprise'),
      avertissementsGeneraux.length
        ? el('ul', { class: 'liste-avertissements' }, avertissementsGeneraux.map((m) => el('li', {}, `⚠️ ${m}`)))
        : null,
      phrases.map((phrase) => el('p', {}, phrase)),
      changeantes.length ? el('ul', { class: 'liste-apercu' }, changeantes.map(blocDuPlat)) : null,
      sansChangement.length
        ? el('p', { class: 'texte-doux' }, `Rien à changer\u00A0: ${listeNoms(sansChangement.map((element) => element.nom))}.`)
        : null,
      dejaRelues.length
        ? el('p', { class: 'texte-doux' }, `Déjà relues\u00A0: ${listeNoms(dejaRelues.map((element) => element.nom))}.`,
          dejaRelues.some((element) => element.propose) ? ' Pour changer un repère\u00A0: Modifier.' : '')
        : null,
      nonReprises.length
        ? el('p', { class: 'texte-doux' }, `Pas reprises\u00A0: ${nonReprises.map((element) => `«\u00A0${element.nom}\u00A0» (${RAISONS_NON_REPRISES[element.statut]})`).join(', ')}.`)
        : null,
      messageEnvoi ? el('p', { class: 'message-erreur', role: 'alert' }, messageEnvoi) : null,
      rienAEcrire
        ? el('p', { role: 'status' }, dejaRelues.length
          ? 'Ces recettes sont déjà relues\u00A0: rien à enregistrer.'
          : 'Rien à enregistrer.')
        : el('p', { class: 'aide' }, 'Seuls les repères changent\u00A0: quantités, étapes et versions restent telles quelles.'),
      rienAEcrire
        ? null
        : el('button', {
          class: 'bouton bouton-principal bouton-plein',
          type: 'button',
          'data-action': 'enregistrer',
          disabled: !comptes.relectures || horsLigne,
          onclick: enregistrer,
        }, comptes.relectures ? libelleEnregistrerRelecture(comptes.relectures) : 'Rien de coché'),
      !rienAEcrire && horsLigne ? el('p', { class: 'aide' }, MESSAGE_HORS_LIGNE_RELECTURE) : null,
    );
  }

  /** Lot de relecture : en ligne seulement ; l'annonce suit les transactions (actions.importer), puis Réglages. */
  function enregistrerRelecture() {
    if (!navigator.onLine) {
      messageEnvoi = MESSAGE_HORS_LIGNE_RELECTURE;
      dessiner();
      annoncer(MESSAGE_HORS_LIGNE_RELECTURE);
      return;
    }
    enregistre = true;
    Promise.resolve(courant.actions.importer(preparation)).catch((erreur) => {
      if (erreur?.code === 'hors_ligne') annoncer(MESSAGE_HORS_LIGNE_RELECTURE);
    });
    // Le lot suivant attend dans Réglages : retour dans l'historique si l'on en vient (geste retour naturel), sinon
    // cet écran est remplacé.
    if (depuisReglages() && history.length > 1) history.back();
    else location.replace('#/reglages');
  }

  function enregistrer() {
    if (dernierEtat?.type === 'batch') {
      enregistrerBatch();
      return;
    }
    if (preparation?.lotDEtapes) {
      enregistrerEtapes();
      return;
    }
    if (preparation?.ecritures?.some((ecriture) => ecriture.mode === 'precautions')) {
      if (!enregistre) enregistrerRelecture();
      return;
    }
    if (!preparation || enregistre || (!preparation.ecritures.length && !preparation.demandesAClore.length)) return;
    const { ecritures } = preparation;
    const comptes = compterEcritures(ecritures);
    // Versions : une transaction par plat, impossible hors ligne. Rien ne part, l'aperçu reste.
    if (comptes.versions && !navigator.onLine) {
      messageEnvoi = MESSAGE_HORS_LIGNE_VERSIONS;
      dessiner();
      annoncer(MESSAGE_HORS_LIGNE_VERSIONS);
      return;
    }
    enregistre = true;
    // Message d'idées de Claude (T5-0a) : décidé avant l'envoi, sur le message validé de l'aperçu.
    const enSerie = serieIci() && dernierEtat?.type === 'pret' && !dernierEtat.relecture
      && natureDuMessage(dernierEtat.validation) === 'idees';
    // Bilan lu avant l'envoi : l'affichage local des fiches (actions.importer) redessine aussitôt l'écran, et l'aperçu
    // recalculé verrait les idées « déjà dans vos plats ».
    if (enSerie) {
      const bilan = bilanDuMessage(preparation);
      // Après « Remettre » de la carte, les plats que ce même message a déjà écrits ne sont pas redits « déjà dans vos
      // plats » ; une idée d'un autre message, déjà écrite plus tôt dans la visite, l'est (Claude l'a reproposée).
      const ecritesAvant = serie.reprise;
      serie.reprise = new Set();
      serie.nature = 'idees';
      serie.ajoutes = [...serie.ajoutes, ...bilan.ajoutes];
      serie.ids = [...serie.ids, ...bilan.ajoutes.map((p) => p.id), ...bilan.autres.map((p) => p.id)];
      serie.dernier = bilan.ajoutes;
      serie.autres = bilan.autres;
      serie.nonRepris = bilan.nonRepris.filter((entree) => !ecritesAvant.has(entree.id));
      serie.actif = true;
      serie.montreeA = performance.now();
      zoneSerie.value = '';
    }
    // L'annonce des versions (combien, combien restent) suit leur envoi (actions.importer) ; un échec est annoncé là.
    Promise.resolve(courant.actions.importer(preparation)).catch((erreur) => {
      if (erreur?.code === 'hors_ligne') annoncer(MESSAGE_HORS_LIGNE_VERSIONS);
    });
    // L'écran reste ouvert : la carte de série remplace l'aperçu, son titre prend le focus (il dit ce qui est ajouté).
    if (enSerie) {
      focaliserResultat = true;
      signature = '';
      dessiner();
      return;
    }
    if (!ecritures.length) annoncer('Recette marquée comme ajoutée.');
    else if (comptes.recettes) annoncer(comptes.recettes > 1 ? `${comptes.recettes} recettes enregistrées.` : 'Recette enregistrée.');
    // Venu de l'écran Demandes : toujours y revenir, il montre ce qui reste à traiter.
    if (depuisDemandes()) {
      if (courant.routePrecedente === 'demandes' && history.length > 1) history.back();
      else location.replace('#/demandes');
      return;
    }
    // Retour à l'écran d'où l'on vient (fiche ciblée, liste) : un pas en arrière, sans doublon dans l'historique.
    // Sinon, cet écran est remplacé : le geste retour ne ramène pas à un aperçu déjà enregistré.
    const origine = cible ? `#/plat/${encodeURIComponent(cible)}` : '#/plats';
    // Rien écrit (seulement une demande close) : retour d'où l'on vient.
    const destination = !ecritures.length ? origine
      : ecritures.length === 1 ? `#/plat/${encodeURIComponent(ecritures[0].id)}` : '#/plats';
    if (destination === origine && courant.routePrecedente === (cible ? 'plat' : 'plats') && history.length > 1) history.back();
    else location.replace(destination);
  }

  // Lecture déjà bloquée par le téléphone : la zone de collage s'ouvre d'emblée, avec l'explication.
  lectureBloquee().then((bloquee) => {
    if (!bloquee) return;
    aideBlocage.hidden = false;
    collageManuel.open = true;
    zoneSerieOuverte = true;
  });

  dessiner();

  return {
    noeud: el('div', { class: 'vue import' },
      retour,
      el('header', { class: 'vue-entete' }, el('h1', {}, 'Ajouter des recettes'), sousTitre),
      boutonColler,
      aideBlocage,
      collageManuel,
      boutonFichier,
      aideFichier,
      ligneCollee,
      resultat,
    ),
    maj(nouveau) {
      courant = nouveau;
      dessiner();
    },
    detruire() {
      detruit = true;
      clearTimeout(minuteurSaisie);
    },
  };
}
