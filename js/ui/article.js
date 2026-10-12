// Feuilles de Courses (T3a, T3b, T3d) :
// - « Ajouter à la liste » : « Quoi ? » et un vrai bouton « Ajouter » ; Entrée fait pareil, le champ se vide et garde le
//   focus (on enchaîne, clavier ouvert) ; trois suggestions sous le champ, ajoutées d'un toucher (T3d : produits hors
//   cuisine compris, piles, lessive…) ; champ vide (T3d) : puces « Récents », les derniers articles ajoutés sur ce
//   téléphone pour ce compte ; « Terminé » ajoute d'abord le texte en cours (rien de tapé ne se perd). Le nom suffit :
//   ni quantité ni rayon demandés.
// - Feuille d'un article (⋮) : « 600 g en tout », « Pour : » et une ligne par plat ou version, « Déjà pris… » ; un
//   produit du placard : « À racheter cette fois » ; un article ajouté à la main : « Précision (facultatif) » (T3d) et
//   « Retirer de la liste » ; T3d : « Rayon : Épicerie salée · Changer » (feuille des 14 rayons), « À acheter chaque
//   semaine » avec « Quantité (facultatif) » et « Pas cette semaine », « Toujours dans mon placard » ; drive réglé
//   (T3b) : « Au drive, je cherche : « pâtes courtes » · Changer » (feuille « Au drive, je cherche », drive.js).
// - « Ordre des rayons » (T3d ; en bas du mode Magasin de Courses, carte de Réglages) : on touche un rayon, puis
//   « ↑ Monter » et « ↓ Descendre », collés en bas avec « Enregistrer » ; « Remettre l’ordre de départ ».
// Écritures : actions de l'app (ajouterArticle, retirerArticle, racheter ; T3d : changerRayon, reglerPlacard,
// reglerHabituel, sauterHabituel, changerPrecision, enregistrerOrdreRayons ; changerRecherche par drive.js), seulement
// sur un geste ; rien n'est écrit à l'ouverture d'une feuille. Les récents sont lus par actions.lireRecents (l'app les
// retient à chaque article ajouté, sur ce téléphone pour ce compte).
import { el, annoncer, ecrireTexte, reconcilier } from './dom.js';
import { ouvrirFeuille } from './feuille.js';
import { listeCourante } from './plat-semaine.js';
import { driveDe, ouvrirMotCherche } from './drive.js';
import { TEXTES_DRIVE, texteJeCherche } from '../coeur/drive.js';
import {
  catalogueAvecDictionnaire, suggestions, LIBELLES_RAYON, LIBELLES_UNITE, UNITES_EDITION,
} from '../coeur/edition.js';
import { clesDuProduit, entreeParId, idProduit, lireHabituel, reglageDuFoyer } from '../coeur/produits.js';
import { lireSemaine } from '../coeur/semaine.js';
import {
  ERREURS_ARTICLE, ERREURS_HABITUEL, ERREURS_PRECISION, PRECISION_MAX, RAYONS_DE_DEPART, TEXTES_T3D, descendreRayon,
  lireNombreSaisi, monterRayon, ordreRayons, preparerAjout, texteAjoutArticle, texteDejaPris, texteDeplacerRayon,
  textePlacard, texteQuantites, texteRayon, texteSource,
} from '../coeur/liste.js';

// Feuilles ouvertes : l'écran Courses (et Réglages, pour « Ordre des rayons ») les met à jour à chaque rendu
// (majFeuillesArticle).
const feuillesOuvertes = new Set();

/** Met à jour les feuilles de Courses ouvertes avec le contexte du moment. */
export function majFeuillesArticle(ctx) {
  for (const feuille of [...feuillesOuvertes]) feuille.maj(ctx);
}

const majuscule = (texte) => texte.charAt(0).toUpperCase() + texte.slice(1);
const reduire = (texte) => String(texte ?? '').replace(/\s+/g, ' ').trim();
/** Un ajout refusé : { erreur } ou un code autre que « ok » (« vide », « long », « echec », « refuse »…). */
const echoue = (resultat) => Boolean(resultat?.erreur) || (typeof resultat?.code === 'string' && resultat.code !== 'ok');
/** Un réglage refusé (T3d) : pas de réponse, { erreur }, ou un code autre que « ok » et « inchange » (rien à écrire). */
const refuse = (resultat) => !resultat || Boolean(resultat.erreur)
  || (typeof resultat.code === 'string' && resultat.code !== 'ok' && resultat.code !== 'inchange');

/** Une action peut rendre une valeur ou une promesse : `suite` reçoit la valeur (une promesse rejetée : { code: 'echec' }). */
function quand(resultat, suite) {
  if (resultat && typeof resultat.then === 'function') resultat.then(suite, () => suite({ code: 'echec' }));
  else suite(resultat);
}

const ECHEC_REGLAGE = 'Ce réglage n’a pas pu être enregistré. Réessayez.';
const ECHEC_RAYON = 'Le rayon n’a pas pu être enregistré. Réessayez.';
const ECHEC_ORDRE = 'L’ordre des rayons n’a pas pu être enregistré. Réessayez.';

/** Ordre des 14 rayons du foyer : `ctx.rayons` (l'app), sinon lu dans les réglages. */
const rayonsDe = (ctx) => (Array.isArray(ctx?.rayons) && ctx.rayons.length ? ctx.rayons : ordreRayons(ctx?.reglages ?? null));

/**
 * Feuille « Ajouter à la liste ». `lireCtx()` : le contexte du moment ; `onFermer` : après la fermeture.
 * Action : ajouterArticle(libelle) → { code: 'ok', id, message, aussi } | { code, message } (refus : « vide », « long »,
 * « echec »…) ; « Retirer » (même produit déjà dans la liste) : retirerArticle(id, { silencieux: true }).
 * Champ vide : puces « Récents » (T3d : actions.lireRecents() → [libellé], le plus récent d'abord), sauf les produits
 * déjà sur la liste comme article pas coché ; un toucher l'ajoute comme une suggestion.
 * → { maj(ctx), fermer }
 */
export function ouvrirAjoutArticle(lireCtx, { onFermer } = {}) {
  let courant = lireCtx();
  let ouverte = true;
  let dernier = null; // { id, nom } du dernier article ajouté qui a aussi une ligne pour les plats (« Retirer »)

  const erreur = el('p', { class: 'erreur-champ', id: 'article-erreur', role: 'alert', hidden: true });
  const champ = el('input', {
    class: 'champ',
    id: 'article-quoi',
    name: 'quoi',
    autocomplete: 'off',
    autocapitalize: 'sentences',
    enterkeyhint: 'done',
    autofocus: true,
    'aria-describedby': 'article-erreur',
    oninput: () => {
      erreur.hidden = true;
      champ.removeAttribute('aria-invalid');
      dessinerSuggestions();
      majBouton();
    },
  });
  // Un toucher sur « Ajouter », une suggestion ou un récent ne retire pas le focus du champ : le clavier reste ouvert.
  const garderLeClavier = (evenement) => evenement.preventDefault();
  const boutonAjouter = el('button', { class: 'bouton bouton-secondaire bouton-ajouter-article', type: 'submit', onmousedown: garderLeClavier }, 'Ajouter');
  const listeSuggestions = el('div', { class: 'suggestions suggestions-article' });
  // Récents (T3d) : à la place des suggestions tant que le champ est vide, dans la même place réservée.
  const listeRecents = el('div', { class: 'puces puces-recents', role: 'group', 'aria-labelledby': 'article-recents' });
  const blocRecents = el('div', { class: 'bloc-recents', hidden: true },
    el('p', { class: 'etiquette-recents', id: 'article-recents' }, TEXTES_T3D.recents),
    listeRecents);
  // Place réservée sous le champ (trois suggestions, ou les récents) : elle ne rapetisse jamais pendant la vie de la
  // feuille, pour que le champ ne bouge pas quand on tape ou qu'Entrée le vide (relecture de T3d).
  const zoneSuggestions = el('div', { class: 'zone-suggestions-article' }, listeSuggestions, blocRecents);
  let hauteurZone = 0;
  const message = el('span', {});
  const boutonRetirer = el('button', {
    class: 'bouton bouton-texte bouton-retirer-article',
    type: 'button',
    hidden: true,
    onclick: retirerDernier,
  }, 'Retirer');
  const zoneMessage = el('p', { class: 'message-ajout', role: 'status' }, message, ' ', boutonRetirer);
  const boutonTermine = el('button', { class: 'bouton bouton-principal bouton-plein', type: 'button', onclick: terminer }, 'Terminé');

  const formulaire = el('form', {
    class: 'formulaire formulaire-article',
    novalidate: true,
    onsubmit: (evenement) => {
      evenement.preventDefault();
      ajouter(champ.value);
    },
  },
  el('label', { class: 'etiquette-champ', for: 'article-quoi' }, 'Quoi\u00A0?'),
  el('div', { class: 'ligne-ajout-article' }, champ, boutonAjouter),
  erreur,
  zoneSuggestions,
  zoneMessage);

  const feuille = ouvrirFeuille('Ajouter à la liste', () => el('div', { class: 'feuille-ajout-article' },
    formulaire,
    el('div', { class: 'feuille-pied' }, boutonTermine)), {
    onFermer: () => {
      ouverte = false;
      feuillesOuvertes.delete(handle);
      onFermer?.();
    },
  });

  /** « Ajouter » devient le bouton principal dès que le champ contient du texte ; « Terminé » l'est sinon. */
  function majBouton() {
    const texte = Boolean(champ.value.trim());
    const classe = `bouton bouton-ajouter-article ${texte ? 'bouton-principal' : 'bouton-secondaire'}`;
    if (boutonAjouter.className !== classe) boutonAjouter.className = classe;
    const classeTermine = `bouton bouton-plein ${texte ? 'bouton-secondaire' : 'bouton-principal'}`;
    if (boutonTermine.className !== classeTermine) boutonTermine.className = classeTermine;
  }

  function montrerErreur(texte) {
    erreur.textContent = texte;
    erreur.hidden = false;
    champ.setAttribute('aria-invalid', 'true');
    champ.focus();
  }

  /** Ajoute l'article ; → vrai si c'est fait (le champ se vide et garde le focus). */
  function ajouter(texte) {
    const prepare = preparerAjout(texte, { liste: listeCourante(courant) });
    if (prepare.erreur) {
      montrerErreur(ERREURS_ARTICLE[prepare.erreur]);
      return false;
    }
    const libelle = prepare.donnees.libelle;
    const resultat = courant.actions?.ajouterArticle?.(libelle);
    if (echoue(resultat)) {
      const code = resultat?.erreur ?? resultat?.code;
      montrerErreur((typeof resultat?.message === 'string' && resultat.message) || ERREURS_ARTICLE[code]
        || 'L’article n’a pas pu être ajouté. Réessayez.');
      return false;
    }
    champ.value = '';
    erreur.hidden = true;
    champ.removeAttribute('aria-invalid');
    dernier = prepare.aussi && typeof resultat?.id === 'string' ? { id: resultat.id, nom: majuscule(libelle) } : null;
    // Même texte deux fois de suite : une espace de plus pour qu'il soit relu.
    const annonce = texteAjoutArticle(libelle, prepare.aussi);
    message.textContent = message.textContent === annonce ? `${annonce}\u00A0` : annonce;
    boutonRetirer.hidden = !dernier;
    dessinerSuggestions();
    majBouton();
    champ.focus();
    return true;
  }

  /** « Retirer » : le même effet que « Annuler » de l'annonce. */
  function retirerDernier() {
    if (!dernier) return;
    const { id, nom } = dernier;
    dernier = null;
    courant.actions?.retirerArticle?.(id, { silencieux: true });
    message.textContent = `«\u00A0${nom}\u00A0» retiré de la liste.`;
    boutonRetirer.hidden = true;
    champ.focus();
  }

  function terminer() {
    if (champ.value.trim() && !ajouter(champ.value)) return;
    fermer();
  }

  /** Récents à proposer : sans les produits déjà sur la liste comme article à acheter (jamais deux « Piles »). */
  function recentsAProposer() {
    const articles = (listeCourante(courant)?.articles ?? []).filter((a) => !a.cochee);
    const deja = new Set(articles.map((a) => a.produitId || reduire(a.libelle).toLocaleLowerCase('fr-FR')));
    const recents = courant.actions?.lireRecents?.();
    return (Array.isArray(recents) ? recents : []).filter((libelle) => typeof libelle === 'string' && libelle.trim())
      .filter((libelle) => !deja.has(idProduit(libelle) || libelle.toLocaleLowerCase('fr-FR')));
  }

  function dessinerSuggestions() {
    const saisie = champ.value;
    const tape = Boolean(saisie.trim());
    // Produits hors cuisine compris (T3d) : « Ajouter à la liste » sert aussi aux piles et à la lessive.
    const catalogue = tape ? catalogueAvecDictionnaire(courant.tousLesPlats ?? courant.plats ?? [], { horsCuisine: true }) : [];
    const proposees = tape ? suggestions(catalogue, saisie, { max: 3 }) : [];
    reconcilier(listeSuggestions, proposees, {
      cle: (element) => reduire(element.produit),
      creer: (element) => el('button', {
        class: 'suggestion',
        type: 'button',
        onmousedown: garderLeClavier,
        onclick: () => ajouter(element.produit),
      }, el('span', { class: 'suggestion-nom' }, reduire(element.produit))),
    });
    listeSuggestions.hidden = !tape;
    const recents = tape ? [] : recentsAProposer();
    reconcilier(listeRecents, recents, {
      cle: (libelle) => libelle,
      creer: (libelle) => el('button', {
        class: 'puce puce-recent',
        type: 'button',
        onmousedown: garderLeClavier,
        onclick: () => ajouter(libelle),
      }, libelle),
    });
    blocRecents.hidden = !recents.length;
    const hauteur = zoneSuggestions.offsetHeight;
    if (hauteur > hauteurZone) {
      hauteurZone = hauteur;
      zoneSuggestions.style.minHeight = `${hauteur}px`;
    }
  }

  function fermer() {
    if (ouverte) feuille.fermer();
  }

  const handle = {
    maj(ctx) {
      if (!ouverte) return;
      courant = ctx;
    },
    fermer,
  };
  feuillesOuvertes.add(handle);
  dessinerSuggestions();
  majBouton();
  return handle;
}

/** Ligne, ligne du placard ou article de la liste montrée, par sa clé ; null s'il n'y est plus. */
function trouver(ctx, cle) {
  const liste = listeCourante(ctx);
  return [...(liste?.lignes ?? []), ...(liste?.maison ?? []), ...(liste?.articles ?? [])].find((l) => l?.cle === cle) ?? null;
}

/** « À acheter chaque semaine » écrit par le foyer pour le produit d'une ligne, même éteint (quantité d'avant), ou null. */
function habituelEcrit(ctx, ligne) {
  const cles = clesDuProduit(ligne?.produitId, { repli: ligne?.repli ?? null, replis: ligne?.replis ?? null });
  return reglageDuFoyer(ctx?.produitsFoyer ?? {}, cles, 'habituel', lireHabituel)?.valeur ?? null;
}

/** Unité proposée pour la quantité d'un habituel : celle du produit courant, sinon la pièce. */
function uniteDe(ligne) {
  const unite = entreeParId(ligne?.produitId)?.unite;
  return UNITES_EDITION.includes(unite) ? unite : 'pc';
}

/** Quantité affichée dans le champ : « 0,5 » ; '' si absente. */
const qteSaisie = (qte) => (typeof qte === 'number' && Number.isFinite(qte) ? String(qte).replace('.', ',') : '');

let numeroDetails = 0;

/**
 * Feuille d'un article (⋮) : titre = le nom ; « 600 g en tout » ; « Pour : » puis une ligne par source (« Gratin de
 * pâtes · 400 g », « Version mer d'Adulte B · Gratin · 100 g », « Chaque semaine · 1 l ») ; « Déjà pris : … » ; produit
 * du placard : « D'habitude, vous en avez : il n'est pas sur la liste. » + interrupteur « À racheter cette fois » ;
 * article ajouté à la main : « Ajouté à la main. », « Précision (facultatif) » et « Retirer de la liste » (l'annonce de
 * l'app permet d'annuler).
 * Réglages du produit (T3d, les deux membres ; ils servent les semaines suivantes) :
 * - « Rayon : Épicerie salée · Changer » (feuille des 14 rayons ; pas pour un produit mis de côté par le placard) ;
 * - « À acheter chaque semaine » ; allumé : « Quantité (facultatif) » (nombre et unité, « Enregistrer ») et, avec une
 *   semaine montrée, « Pas cette semaine » ;
 * - « Toujours dans mon placard » (ligne des plats, sans habituel) : « Toujours mis de côté. » ou « Mis de côté si la
 *   semaine en demande 30 g au plus. ».
 * Une ligne partie de la liste par un geste fait ici (« À acheter chaque semaine » éteint, « Pas cette semaine ») garde
 * la feuille ouverte, telle qu'elle était : on peut revenir sur le geste. Sinon la feuille se ferme si la ligne
 * disparaît de la liste. Une quantité ou une précision tapées et pas enregistrées le sont à la fermeture.
 * → { maj(ctx), fermer }
 */
export function ouvrirDetailsArticle(lireCtx, cle, { onFermer } = {}) {
  let courant = lireCtx();
  let ouverte = true;
  let derniere = null; // la ligne telle qu'elle était au dernier dessin où elle était dans la liste
  let garder = false; // un geste « chaque semaine » a été fait ici : la feuille reste si la ligne part
  let vivante = true; // la ligne est dans la liste du moment
  let saleQte = false; // quantité tapée, pas encore enregistrée
  let salePrecision = false; // précision tapée, pas encore enregistrée
  // Article à la main devenu « À acheter chaque semaine » ici (actions.reglerHabituel › converti) : la feuille suit la
  // ligne de l'habituel ; éteint aussitôt, l'article revient (`remettre`).
  let articleConverti = null;
  numeroDetails += 1;
  const base = `details-article-${numeroDetails}`;

  const total = el('p', { class: 'total-article' });
  const dejaPris = el('p', { class: 'texte-doux' });
  const listeSources = el('ul', { class: 'liste-simple sources-article' });
  const blocSources = el('div', { class: 'bloc-sources' }, el('p', { class: 'etiquette-pour' }, 'Pour\u00A0:'), listeSources);
  const textePlacardMaison = el('p', { id: `${base}-placard` });
  const interrupteur = el('input', {
    class: 'interrupteur',
    type: 'checkbox',
    role: 'switch',
    'aria-describedby': `${base}-placard`,
    onchange: () => courant.actions?.racheter?.(cle, interrupteur.checked),
  });
  const blocPlacard = el('div', { class: 'bloc-placard' },
    textePlacardMaison,
    el('label', { class: 'ligne-precaution ligne-racheter' },
      el('span', { class: 'precaution-texte' }, el('span', { class: 'precaution-libelle' }, 'À racheter cette fois')),
      interrupteur));

  // ——— Article ajouté à la main : « Ajouté à la main. », « Précision (facultatif) », « Retirer de la liste » ———
  const texteMain = el('p', {});
  const erreurPrecision = el('p', { class: 'erreur-champ', id: `${base}-precision-erreur`, role: 'alert', hidden: true });
  const champPrecision = el('input', {
    class: 'champ',
    id: `${base}-precision`,
    autocomplete: 'off',
    autocapitalize: 'off',
    enterkeyhint: 'done',
    'aria-describedby': `${base}-precision-erreur`,
    oninput: () => {
      salePrecision = true;
      cacherErreur(erreurPrecision, champPrecision);
    },
  });
  const formPrecision = el('form', {
    class: 'formulaire formulaire-precision',
    novalidate: true,
    onsubmit: (evenement) => {
      evenement.preventDefault();
      enregistrerPrecision();
    },
  },
  el('label', { class: 'etiquette-champ', for: `${base}-precision` }, TEXTES_T3D.precision),
  champPrecision,
  erreurPrecision,
  el('button', { class: 'bouton bouton-secondaire bouton-plein', type: 'submit', 'aria-label': 'Enregistrer la précision' },
    TEXTES_T3D.enregistrer));
  const boutonRetirer = el('button', {
    class: 'bouton bouton-secondaire bouton-plein',
    type: 'button',
    onclick: () => {
      const ligne = trouver(courant, cle);
      salePrecision = false; // l'article part : sa précision tapée aussi
      fermer();
      if (ligne?.type === 'article') courant.actions?.retirerArticle?.(ligne.articleId);
    },
  }, 'Retirer de la liste');
  const blocMain = el('div', { class: 'bloc-main' }, texteMain, formPrecision, boutonRetirer);

  // ——— Réglages du produit (T3d) ———
  const erreurReglage = el('p', { class: 'erreur-champ', role: 'alert', hidden: true });

  // « Rayon : Épicerie salée · Changer »
  const texteRayonNoeud = el('span', { id: `${base}-rayon` });
  const boutonRayon = el('button', {
    class: 'bouton bouton-texte bouton-changer-rayon',
    type: 'button',
    // Le nom lu commence par le mot affiché ; le rayon actuel est lu à la suite.
    'aria-label': 'Changer le rayon',
    'aria-describedby': `${base}-rayon`,
    onclick: () => {
      if (!vivante) return;
      ouvrirChoixRayon(lireCtx, cle, {
        onFermer: () => {
          if (ouverte && boutonRayon.isConnected) boutonRayon.focus();
        },
      });
    },
  }, TEXTES_T3D.changer);
  const blocRayon = el('div', { class: 'bloc-rayon' },
    el('p', { class: 'ligne-rayon' }, texteRayonNoeud, el('span', { 'aria-hidden': 'true' }, ' · '), boutonRayon),
    el('p', { class: 'aide' }, TEXTES_T3D.suivantes));

  // « À acheter chaque semaine », « Quantité (facultatif) », « Pas cette semaine »
  const interrupteurHabituel = el('input', { class: 'interrupteur', type: 'checkbox', role: 'switch', onchange: basculerHabituel });
  const erreurQte = el('p', { class: 'erreur-champ', id: `${base}-qte-erreur`, role: 'alert', hidden: true });
  const statutQte = el('p', { class: 'visuellement-masque', role: 'status' });
  const champQte = el('input', {
    class: 'champ',
    id: `${base}-qte`,
    inputmode: 'decimal',
    enterkeyhint: 'done',
    autocomplete: 'off',
    'aria-describedby': `${base}-qte-erreur`,
    oninput: () => {
      saleQte = true;
      cacherErreur(erreurQte, champQte);
    },
  });
  const choixUnite = el('select', {
    class: 'champ',
    id: `${base}-unite`,
    'aria-label': 'Unité',
    onchange: () => {
      saleQte = true;
      cacherErreur(erreurQte, champQte);
    },
  }, UNITES_EDITION.map((unite) => el('option', { value: unite }, LIBELLES_UNITE[unite])));
  const formQte = el('form', {
    class: 'formulaire formulaire-habituel',
    novalidate: true,
    hidden: true,
    onsubmit: (evenement) => {
      evenement.preventDefault();
      enregistrerQuantite();
    },
  },
  el('label', { class: 'etiquette-champ', for: `${base}-qte` }, TEXTES_T3D.quantite),
  el('div', { class: 'ligne-quantite-habituel' }, champQte, choixUnite),
  erreurQte,
  el('button', { class: 'bouton bouton-secondaire bouton-plein', type: 'submit', 'aria-label': 'Enregistrer la quantité' },
    TEXTES_T3D.enregistrer),
  statutQte);
  const interrupteurSaute = el('input', { class: 'interrupteur', type: 'checkbox', role: 'switch', onchange: basculerSaute });
  const ligneSaute = el('label', { class: 'ligne-precaution ligne-pas-cette-semaine', hidden: true },
    el('span', { class: 'precaution-texte' }, el('span', { class: 'precaution-libelle' }, TEXTES_T3D.pasCetteSemaine)),
    interrupteurSaute);
  const blocHabituel = el('div', { class: 'bloc-habituel' },
    el('label', { class: 'ligne-precaution' },
      el('span', { class: 'precaution-texte' }, el('span', { class: 'precaution-libelle' }, TEXTES_T3D.habituel)),
      interrupteurHabituel),
    formQte,
    ligneSaute);

  // « Toujours dans mon placard »
  const texteToujours = el('p', { class: 'aide', id: `${base}-toujours` });
  const interrupteurPlacard = el('input', {
    class: 'interrupteur',
    type: 'checkbox',
    role: 'switch',
    'aria-describedby': `${base}-toujours`,
    onchange: basculerPlacard,
  });
  const blocToujours = el('div', { class: 'bloc-toujours' },
    el('label', { class: 'ligne-precaution' },
      el('span', { class: 'precaution-texte' }, el('span', { class: 'precaution-libelle' }, TEXTES_T3D.placard)),
      interrupteurPlacard),
    texteToujours);

  // Drive réglé (T3b) : le mot cherché au drive pour ce produit, « Changer » ouvre « Au drive, je cherche ».
  const texteMot = el('span', { class: 'texte-mot-drive' });
  const boutonMot = el('button', {
    class: 'bouton bouton-texte bouton-changer-mot',
    type: 'button',
    // Le nom lu commence par le mot affiché : « Changer le mot cherché ».
    'aria-label': TEXTES_DRIVE.changerLeMot,
    onclick: () => {
      if (!vivante) return;
      ouvrirMotCherche(lireCtx, cle, {
        onFermer: () => {
          if (ouverte && boutonMot.isConnected) boutonMot.focus();
        },
      });
    },
  }, TEXTES_DRIVE.changer);
  const blocMot = el('div', { class: 'bloc-mot-drive', hidden: true },
    el('p', { class: 'ligne-mot-drive' }, texteMot, el('span', { 'aria-hidden': 'true' }, ' · '), boutonMot),
    el('p', { class: 'aide' }, TEXTES_DRIVE.serviraSuivantes));
  const blocReglages = el('div', { class: 'reglages-article' },
    erreurReglage, blocRayon, blocHabituel, blocToujours, blocMot);
  const boutonFermer = el('button', { class: 'bouton bouton-texte', type: 'button', onclick: () => fermer() }, 'Fermer');

  const depart = trouver(courant, cle);
  const feuille = ouvrirFeuille(depart?.nom ?? 'Article', () => el('div', { class: 'feuille-article' },
    total, dejaPris, blocSources, blocPlacard, blocMain, blocReglages,
    el('div', { class: 'actions-feuille' }, boutonFermer)), {
    onFermer: () => {
      ouverte = false;
      feuillesOuvertes.delete(handle);
      // Rien de tapé ne se perd : une quantité ou une précision lisibles partent à la fermeture. Une quantité ne part
      // que si l'habituel est encore allumé dans les données du moment (éteint sur l'autre téléphone : jamais rallumé
      // d'ici sans un geste).
      if (saleQte && interrupteurHabituel.checked && habituelEcrit(courant, trouver(courant, cle) ?? derniere)?.actif === true) {
        enregistrerQuantite({ silencieux: true });
      }
      if (salePrecision) enregistrerPrecision({ silencieux: true });
      onFermer?.({ cle });
    },
  });

  function fermer() {
    if (ouverte) feuille.fermer();
  }

  function cacherErreur(noeud, champ) {
    noeud.hidden = true;
    champ?.removeAttribute('aria-invalid');
  }

  function montrerErreur(noeud, texte, champ = null) {
    noeud.textContent = texte;
    noeud.hidden = false;
    if (champ) {
      champ.setAttribute('aria-invalid', 'true');
      champ.focus();
    }
  }

  /**
   * Un geste qui redessine la feuille (l'app met à jour les feuilles ouvertes avant de rendre la main) : la commande
   * touchée garde sa place à l'écran, même si un bloc apparaît ou disparaît au-dessus (« À racheter cette fois » d'un
   * produit qui passe dans le placard). Une feuille qui ne défile pas reste collée en bas : rien à compenser.
   */
  function ancrer(noeud, geste) {
    const avant = noeud.getBoundingClientRect().top;
    const resultat = geste();
    const ecart = noeud.isConnected ? noeud.getBoundingClientRect().top - avant : 0;
    if (Math.abs(ecart) >= 1) feuille.dialogue.scrollTop += ecart;
    return resultat;
  }

  /** Ce que les actions reçoivent : la clé de la ligne, ou l'identifiant de son produit si elle est partie de la liste. */
  function cible() {
    return vivante || !derniere?.produitId ? cle : derniere.produitId;
  }

  /** Ligne partie de la liste après un geste fait ici : celle d'avant, avec son habituel du moment. */
  function ligneFigee() {
    const ecrit = habituelEcrit(courant, derniere);
    const habituel = (listeCourante(courant)?.habituels ?? []).find((h) => h?.produitId === derniere.produitId);
    return { ...derniere, habituel: ecrit?.actif ? ecrit : null, habituelSaute: Boolean(habituel?.saute) };
  }

  // ——— Gestes ———

  function basculerHabituel() {
    const actif = interrupteurHabituel.checked;
    garder = true;
    cacherErreur(erreurReglage);
    // Rallumé : la quantité d'avant (ou celle tapée) repart avec lui, si elle se lit.
    const nombre = lireNombreSaisi(champQte.value);
    const avecQte = actif && typeof nombre === 'number' && Number.isFinite(nombre) && nombre > 0;
    const reglage = {
      actif, qte: avecQte ? champQte.value : null, unite: choixUnite.value,
      ...(!actif && articleConverti ? { remettre: articleConverti } : {}),
    };
    quand(ancrer(interrupteurHabituel, () => courant.actions?.reglerHabituel?.(cible(), reglage)), (resultat) => {
      if (!ouverte) return;
      if (refuse(resultat)) {
        interrupteurHabituel.checked = !actif;
        montrerErreur(erreurReglage, ECHEC_REGLAGE);
        return;
      }
      if (avecQte || !actif) saleQte = false;
      // L'article à la main est devenu l'habituel (retiré de la liste) : la feuille suit sa ligne ; remis, l'article.
      if (resultat?.converti && typeof resultat.converti.cle === 'string') {
        articleConverti = resultat.converti.article ?? null;
        cle = resultat.converti.cle;
        salePrecision = false;
      } else if (typeof resultat?.remis === 'string') {
        articleConverti = null;
        cle = resultat.remis;
      }
      dessiner();
    });
  }

  /** « Enregistrer » de la quantité (vide : sans quantité) ; `silencieux` : à la fermeture, sans message. */
  function enregistrerQuantite({ silencieux = false } = {}) {
    garder = true;
    const reglage = { actif: true, qte: champQte.value, unite: choixUnite.value };
    const geste = () => courant.actions?.reglerHabituel?.(cible(), reglage);
    quand(silencieux || !ouverte ? geste() : ancrer(champQte, geste), (resultat) => {
      if (silencieux || !ouverte) return;
      if (refuse(resultat)) {
        const code = resultat?.erreur ?? resultat?.code;
        montrerErreur(erreurQte, (typeof resultat?.message === 'string' && resultat.message) || ERREURS_HABITUEL[code]
          || ECHEC_REGLAGE, champQte);
        return;
      }
      saleQte = false;
      cacherErreur(erreurQte, champQte);
      // Même texte deux fois de suite : une espace de plus pour qu'il soit relu.
      const texte = 'Quantité enregistrée.';
      statutQte.textContent = statutQte.textContent === texte ? `${texte}\u00A0` : texte;
      dessiner();
    });
  }

  function basculerSaute() {
    const oui = interrupteurSaute.checked;
    garder = true;
    cacherErreur(erreurReglage);
    const produitId = (trouver(courant, cle) ?? derniere)?.produitId ?? null;
    quand(ancrer(interrupteurSaute, () => courant.actions?.sauterHabituel?.(produitId, oui)), (resultat) => {
      if (!ouverte) return;
      if (refuse(resultat)) {
        interrupteurSaute.checked = !oui;
        montrerErreur(erreurReglage, ECHEC_REGLAGE);
        return;
      }
      dessiner();
    });
  }

  function basculerPlacard() {
    const oui = interrupteurPlacard.checked;
    cacherErreur(erreurReglage);
    quand(ancrer(interrupteurPlacard, () => courant.actions?.reglerPlacard?.(cible(), oui)), (resultat) => {
      if (!ouverte) return;
      if (refuse(resultat)) {
        interrupteurPlacard.checked = !oui;
        montrerErreur(erreurReglage, ECHEC_REGLAGE);
        return;
      }
      dessiner();
    });
  }

  /** « Enregistrer » de la précision d'un article (vide : effacée) ; `silencieux` : à la fermeture, sans message. */
  function enregistrerPrecision({ silencieux = false } = {}) {
    const saisie = champPrecision.value;
    if (reduire(saisie).length > PRECISION_MAX) {
      if (!silencieux && ouverte) montrerErreur(erreurPrecision, ERREURS_PRECISION.long, champPrecision);
      return;
    }
    const geste = () => courant.actions?.changerPrecision?.(cle, saisie);
    quand(silencieux || !ouverte ? geste() : ancrer(champPrecision, geste), (resultat) => {
      if (silencieux || !ouverte) return;
      if (refuse(resultat)) {
        const code = resultat?.erreur ?? resultat?.code;
        montrerErreur(erreurPrecision, (typeof resultat?.message === 'string' && resultat.message) || ERREURS_PRECISION[code]
          || ECHEC_REGLAGE, champPrecision);
        return;
      }
      salePrecision = false;
      cacherErreur(erreurPrecision, champPrecision);
      dessiner();
    });
  }

  // ——— Dessin ———

  function dessiner() {
    const trouvee = trouver(courant, cle);
    if (!trouvee && !(garder && derniere)) {
      // Partie sans geste fait ici (retirée ou éteinte sur l'autre téléphone) : rien de tapé ne repart à la fermeture.
      saleQte = false;
      salePrecision = false;
      fermer();
      return;
    }
    vivante = Boolean(trouvee);
    if (trouvee) derniere = trouvee;
    const ligne = trouvee ?? ligneFigee();
    feuille.definirTitre(ligne.nom);
    if (vivante) dessinerLigne(ligne);
    dessinerHabituel(ligne);
  }

  /** Tout ce qui ne change que tant que la ligne est dans la liste (une ligne partie reste telle qu'elle était). */
  function dessinerLigne(ligne) {
    const article = ligne.type === 'article';
    const quantite = article ? '' : texteQuantites(ligne.totaux);
    ecrireTexte(total, quantite ? `${quantite} en tout` : (article ? ligne.precision ?? '' : ''));
    total.hidden = !total.textContent;
    const pris = texteDejaPris(ligne);
    ecrireTexte(dejaPris, pris);
    dejaPris.hidden = !pris;
    const sources = article ? [] : (ligne.sources ?? []);
    reconcilier(listeSources, sources, {
      cle: (s) => `${s.type ?? 'plat'}|${s.platId ?? s.produitId ?? ''}|${s.pour ?? ''}`,
      creer: (s) => el('li', {}, texteSource(s, { profils: courant.profils ?? [], moi: courant.moi ?? null })),
      maj: (n, s) => ecrireTexte(n, texteSource(s, { profils: courant.profils ?? [], moi: courant.moi ?? null })),
    });
    blocSources.hidden = !sources.length;
    blocPlacard.hidden = !ligne.placard;
    if (ligne.placard) {
      ecrireTexte(textePlacardMaison, ligne.rachetee
        ? `D’habitude, vous en avez. Sur la liste cette fois\u00A0: ${LIBELLES_RAYON[ligne.rayon] ?? LIBELLES_RAYON.divers}.`
        : 'D’habitude, vous en avez\u00A0: il n’est pas sur la liste.');
      if (interrupteur.checked !== ligne.rachetee) interrupteur.checked = ligne.rachetee;
    }
    blocMain.hidden = !article;
    if (article) {
      ecrireTexte(texteMain, 'Ajouté à la main.');
      if (!salePrecision && document.activeElement !== champPrecision) {
        const precision = ligne.precision ?? '';
        if (champPrecision.value !== precision) champPrecision.value = precision;
      }
    }
    const produit = typeof ligne.produitId === 'string' && ligne.produitId !== '';
    // Mis de côté (« Déjà à la maison ? ») : il n'est pas sur la liste, son rayon ni son mot cherché ne servent pas.
    const misDeCote = Boolean(ligne.placard && !ligne.rachetee);
    blocRayon.hidden = !produit || misDeCote;
    if (!blocRayon.hidden) ecrireTexte(texteRayonNoeud, texteRayon(ligne.rayon));
    blocHabituel.hidden = !produit;
    // Un produit acheté chaque semaine n'est jamais mis de côté : l'interrupteur du placard ne servirait pas.
    blocToujours.hidden = !produit || article || Boolean(ligne.habituel);
    if (!blocToujours.hidden) {
      const dansLePlacard = ligne.placardProduit !== null && ligne.placardProduit !== undefined;
      if (interrupteurPlacard.checked !== dansLePlacard) interrupteurPlacard.checked = dansLePlacard;
      const texte = dansLePlacard ? textePlacard(ligne.placardProduit, { produitId: ligne.produitId }) : '';
      ecrireTexte(texteToujours, texte);
      texteToujours.hidden = !texte;
    }
    // Le mot cherché ne sert qu'avec un drive réglé ; jamais pour un produit du placard (il n'est pas sur la liste).
    const avecMot = Boolean(driveDe(courant)) && !misDeCote;
    blocMot.hidden = !avecMot;
    if (avecMot) ecrireTexte(texteMot, texteJeCherche(ligne.recherche ?? ligne.libelle));
  }

  function dessinerHabituel(ligne) {
    const habituel = ligne.habituel ?? null;
    if (interrupteurHabituel.checked !== Boolean(habituel)) interrupteurHabituel.checked = Boolean(habituel);
    formQte.hidden = !habituel;
    // Quantité : celle de l'habituel (même éteint : rallumé, il la retrouve), tant que rien n'est tapé.
    const actifs = [champQte, choixUnite];
    if (!saleQte && !actifs.includes(document.activeElement)) {
      const ecrit = habituel ?? habituelEcrit(courant, ligne);
      const qte = qteSaisie(ecrit?.qte);
      if (champQte.value !== qte) champQte.value = qte;
      const unite = UNITES_EDITION.includes(ecrit?.unite) ? ecrit.unite : uniteDe(ligne);
      if (choixUnite.value !== unite) choixUnite.value = unite;
    }
    // « Pas cette semaine » : seulement pour la semaine montrée.
    ligneSaute.hidden = !habituel || !lireSemaine(courant.semaine);
    const saute = Boolean(ligne.habituelSaute);
    if (interrupteurSaute.checked !== saute) interrupteurSaute.checked = saute;
  }

  const handle = {
    maj(ctx) {
      if (!ouverte) return;
      courant = ctx;
      dessiner();
    },
    fermer,
  };
  feuillesOuvertes.add(handle);
  dessiner();
  return handle;
}

/**
 * Feuille du rayon d'un produit (« Rayon : … · Changer » de la feuille ⋮, T3d) : « Il servira les semaines
 * suivantes. », puis les 14 rayons dans l'ordre du foyer, celui du produit marqué ; un toucher l'enregistre et ferme
 * la feuille. Choisir le rayon de départ efface le réglage du foyer (coeur/liste.js › ecrituresRayon).
 * Action : changerRayon(cle, rayon) → { code: 'ok', rayon } | { code } (refus : la feuille le dit et reste ouverte).
 * → { maj(ctx), fermer } | null (ligne partie)
 */
function ouvrirChoixRayon(lireCtx, cle, { onFermer } = {}) {
  let courant = lireCtx();
  let ouverte = true;
  const depart = trouver(courant, cle);
  if (!depart) {
    onFermer?.();
    return null;
  }
  const erreur = el('p', { class: 'erreur-champ', role: 'alert', hidden: true });
  const choix = el('div', { class: 'choix-rayons' });
  const feuille = ouvrirFeuille(`Rayon de «\u00A0${depart.nom}\u00A0»`, () => el('div', { class: 'feuille-rayon' },
    el('p', { class: 'aide' }, TEXTES_T3D.suivantes),
    choix,
    erreur,
    el('div', { class: 'actions-feuille' },
      el('button', { class: 'bouton bouton-texte bouton-plein', type: 'button', onclick: () => fermer() }, 'Fermer'))), {
    onFermer: () => {
      ouverte = false;
      feuillesOuvertes.delete(handle);
      onFermer?.();
    },
  });

  function fermer() {
    if (ouverte) feuille.fermer();
  }

  function choisir(rayon) {
    const ligne = trouver(courant, cle);
    if (!ligne) {
      fermer();
      return;
    }
    if (rayon === ligne.rayon) {
      fermer();
      return;
    }
    erreur.hidden = true;
    quand(courant.actions?.changerRayon?.(cle, rayon), (resultat) => {
      if (refuse(resultat)) {
        if (!ouverte) return;
        erreur.textContent = ECHEC_RAYON;
        erreur.hidden = false;
        return;
      }
      fermer();
    });
  }

  function dessiner() {
    const ligne = trouver(courant, cle);
    if (!ligne) {
      fermer();
      return;
    }
    reconcilier(choix, rayonsDe(courant), {
      cle: (rayon) => rayon,
      creer: (rayon) => el('button', {
        class: 'choix choix-rayon',
        type: 'button',
        'data-rayon': rayon,
        'aria-pressed': 'false',
        onclick: () => choisir(rayon),
      }, LIBELLES_RAYON[rayon] ?? LIBELLES_RAYON.divers),
    });
    for (const bouton of choix.children) {
      const voulu = String(bouton.dataset.rayon === ligne.rayon);
      if (bouton.getAttribute('aria-pressed') !== voulu) bouton.setAttribute('aria-pressed', voulu);
    }
  }

  const handle = {
    maj(ctx) {
      if (!ouverte) return;
      courant = ctx;
      dessiner();
    },
    fermer,
  };
  feuillesOuvertes.add(handle);
  dessiner();
  return handle;
}

let numeroOrdre = 0;

/**
 * Feuille « Ordre des rayons » (T3d ; lien en bas du mode Magasin de Courses, carte de Réglages ; les deux membres) :
 * « Touchez un rayon, puis montez-le ou descendez-le. », les 14 rayons dans l'ordre du foyer (un bouton radio chacun :
 * le rayon choisi), puis, collés en bas de la feuille, « ↑ Monter » et « ↓ Descendre » (« Monter « Crèmerie » ») et
 * « Enregistrer » (principal) ; « Remettre l’ordre de départ ». Relecture de T3d : les flèches ne sont plus sur chaque
 * ligne, qui changeait de place sous le doigt (deux touchers au même endroit faisaient monter le rayon puis remonter son
 * voisin) ; en bas, toujours à la même place, plusieurs touchers déplacent toujours le même rayon, qui reste visible.
 * Rien n'est écrit avant « Enregistrer » ; l'ordre de départ efface le réglage. Tant qu'on n'a rien touché, l'ordre
 * suit celui que l'autre téléphone enregistre.
 * Action : enregistrerOrdreRayons(ordre) → { code: 'ok', message } | { code: 'inchange' } (rien à écrire) | { code }
 * (refus : la feuille le dit et reste ouverte). Annonce, la feuille fermée : « Ordre des rayons enregistré. ».
 * → { maj(ctx), fermer }
 */
export function ouvrirOrdreDesRayons(lireCtx, { onFermer } = {}) {
  let courant = lireCtx();
  let ouverte = true;
  let touche = false; // l'ordre a été changé ici : il n'est plus remplacé par celui du foyer
  let ordre = [...rayonsDe(courant)];
  let choisi = null; // le rayon touché : « Monter » et « Descendre » le déplacent
  const total = ordre.length;
  numeroOrdre += 1;
  const groupe = `ordre-rayons-${numeroOrdre}`;
  const statut = el('p', { class: 'visuellement-masque', role: 'status' });
  const erreur = el('p', { class: 'erreur-champ', role: 'alert', hidden: true });
  const liste = el('ol', { class: 'liste-rayons' });
  const parties = new WeakMap(); // <li> → { input, nom }

  const boutonMonter = el('button', { class: 'bouton bouton-secondaire bouton-deplacer', type: 'button', disabled: true,
    onclick: () => deplacer(-1) }, el('span', { 'aria-hidden': 'true' }, '↑'), TEXTES_T3D.monter);
  const boutonDescendre = el('button', { class: 'bouton bouton-secondaire bouton-deplacer', type: 'button', disabled: true,
    onclick: () => deplacer(1) }, el('span', { 'aria-hidden': 'true' }, '↓'), TEXTES_T3D.descendre);
  const boutonDepart = el('button', { class: 'bouton bouton-texte bouton-plein', type: 'button', onclick: remettre },
    TEXTES_T3D.ordreDeDepart);
  const boutonEnregistrer = el('button', { class: 'bouton bouton-principal bouton-plein', type: 'button', onclick: enregistrer },
    TEXTES_T3D.enregistrer);
  const feuille = ouvrirFeuille(TEXTES_T3D.ordreRayons, () => el('div', { class: 'feuille-ordre-rayons' },
    el('p', { class: 'aide', id: `${groupe}-aide` }, TEXTES_T3D.aideOrdre),
    el('fieldset', { class: 'groupe-rayons', 'aria-describedby': `${groupe}-aide` },
      el('legend', { class: 'visuellement-masque' }, 'Rayon à déplacer'),
      liste),
    statut,
    el('div', { class: 'actions-feuille' }, boutonDepart),
    erreur,
    el('div', { class: 'feuille-pied pied-ordre-rayons' },
      el('div', { class: 'boutons-deplacer' }, boutonMonter, boutonDescendre),
      boutonEnregistrer),
    el('div', { class: 'actions-feuille' },
      el('button', { class: 'bouton bouton-texte bouton-plein', type: 'button', onclick: () => fermer() }, 'Fermer'))), {
    onFermer: () => {
      ouverte = false;
      feuillesOuvertes.delete(handle);
      onFermer?.();
    },
  });

  function fermer() {
    if (ouverte) feuille.fermer();
  }

  function dire(texte) {
    // Même texte deux fois de suite : une espace de plus pour qu'il soit relu.
    statut.textContent = statut.textContent === texte ? `${texte}\u00A0` : texte;
  }

  /** « Monter » ou « Descendre » : le rayon choisi change de place et reste visible ; au bord, le focus passe à l'autre. */
  function deplacer(sens) {
    if (!choisi) return;
    const rayon = choisi;
    const nouveau = sens < 0 ? monterRayon(ordre, rayon) : descendreRayon(ordre, rayon);
    if (nouveau.join('|') === ordre.join('|')) return;
    ordre = nouveau;
    touche = true;
    erreur.hidden = true;
    const rang = ordre.indexOf(rayon);
    // Avant d'éteindre le bouton du bord : le focus ne tombe jamais sur la page.
    if ((sens < 0 && rang === 0) || (sens > 0 && rang === total - 1)) (sens < 0 ? boutonDescendre : boutonMonter).focus();
    dessiner();
    const li = [...liste.children].find((n) => n.dataset.rayon === rayon);
    li?.scrollIntoView?.({ block: 'nearest' });
    dire(`«\u00A0${LIBELLES_RAYON[rayon] ?? rayon}\u00A0»\u00A0: ${rang + 1} sur ${total}.`);
  }

  function remettre() {
    ordre = [...RAYONS_DE_DEPART];
    touche = true;
    erreur.hidden = true;
    dessiner();
    dire('Ordre de départ remis.');
  }

  function enregistrer() {
    erreur.hidden = true;
    quand(courant.actions?.enregistrerOrdreRayons?.([...ordre]), (resultat) => {
      if (refuse(resultat)) {
        if (!ouverte) return;
        erreur.textContent = ECHEC_ORDRE;
        erreur.hidden = false;
        return;
      }
      fermer();
      if (resultat?.code !== 'inchange') {
        annoncer(typeof resultat?.message === 'string' && resultat.message ? resultat.message : 'Ordre des rayons enregistré.');
      }
    });
  }

  function creerLigne(rayon) {
    const input = el('input', { type: 'radio', name: groupe, value: rayon });
    input.addEventListener('change', () => {
      if (!input.checked) return;
      choisi = rayon;
      dessiner();
    });
    const nom = el('span', { class: 'rayon-ordre-nom' });
    const li = el('li', { 'data-rayon': rayon }, el('label', { class: 'ligne-ordre-rayon' }, input, nom));
    parties.set(li, { input, nom });
    return li;
  }

  function dessiner() {
    const noeuds = reconcilier(liste, ordre, { cle: (rayon) => rayon, creer: creerLigne });
    noeuds.forEach((li, i) => {
      const { input, nom } = parties.get(li);
      ecrireTexte(nom, LIBELLES_RAYON[ordre[i]] ?? ordre[i]);
      const coche = ordre[i] === choisi;
      if (input.checked !== coche) input.checked = coche;
    });
    const rang = choisi ? ordre.indexOf(choisi) : -1;
    for (const [bouton, sens] of [[boutonMonter, -1], [boutonDescendre, 1]]) {
      const libelle = rang >= 0 ? texteDeplacerRayon(choisi, sens) : (sens < 0 ? TEXTES_T3D.monter : TEXTES_T3D.descendre);
      if (bouton.getAttribute('aria-label') !== libelle) bouton.setAttribute('aria-label', libelle);
      const inactif = rang < 0 || (sens < 0 ? rang === 0 : rang === total - 1);
      if (bouton.disabled !== inactif) bouton.disabled = inactif;
    }
  }

  const handle = {
    maj(ctx) {
      if (!ouverte) return;
      courant = ctx;
      if (!touche) {
        ordre = [...rayonsDe(ctx)];
        dessiner();
      }
    },
    fermer,
  };
  feuillesOuvertes.add(handle);
  dessiner();
  return handle;
}
