// Feuilles de Courses (T3a) :
// - « Ajouter à la liste » : « Quoi ? » et un vrai bouton « Ajouter » ; Entrée fait pareil, le champ se vide et garde le
//   focus (on enchaîne, clavier ouvert) ; trois suggestions sous le champ, ajoutées d'un toucher ; « Terminé » ajoute
//   d'abord le texte en cours (rien de tapé ne se perd). Le nom suffit : ni quantité ni rayon demandés.
// - Feuille d'un article (⋮) : « 600 g en tout », « Pour : » et une ligne par plat ou version, « Déjà pris… » ; un
//   produit du placard : « À racheter cette fois » ; un article ajouté à la main : « Retirer de la liste » ; drive réglé
//   (T3b) : « Au drive, je cherche : « pâtes courtes » · Changer » (feuille « Au drive, je cherche », drive.js).
// Écritures : actions de l'app (ajouterArticle, retirerArticle, racheter ; changerRecherche par drive.js), seulement
// sur un geste.
import { el, ecrireTexte, reconcilier } from './dom.js';
import { ouvrirFeuille } from './feuille.js';
import { listeCourante } from './plat-semaine.js';
import { driveDe, ouvrirMotCherche } from './drive.js';
import { TEXTES_DRIVE, texteJeCherche } from '../coeur/drive.js';
import { catalogueAvecDictionnaire, suggestions, LIBELLES_RAYON } from '../coeur/edition.js';
import {
  ERREURS_ARTICLE, preparerAjout, texteAjoutArticle, texteDejaPris, texteQuantites, texteSource,
} from '../coeur/liste.js';

// Feuilles ouvertes : l'écran Courses les met à jour à chaque rendu (majFeuillesArticle).
const feuillesOuvertes = new Set();

/** Met à jour les feuilles de Courses ouvertes avec le contexte du moment. */
export function majFeuillesArticle(ctx) {
  for (const feuille of [...feuillesOuvertes]) feuille.maj(ctx);
}

const majuscule = (texte) => texte.charAt(0).toUpperCase() + texte.slice(1);
const reduire = (texte) => String(texte ?? '').replace(/\s+/g, ' ').trim();
/** Un ajout refusé : { erreur } ou un code autre que « ok » (« vide », « long », « echec », « refuse »…). */
const echoue = (resultat) => Boolean(resultat?.erreur) || (typeof resultat?.code === 'string' && resultat.code !== 'ok');

/**
 * Feuille « Ajouter à la liste ». `lireCtx()` : le contexte du moment ; `onFermer` : après la fermeture.
 * Action : ajouterArticle(libelle) → { code: 'ok', id, message, aussi } | { code, message } (refus : « vide », « long »,
 * « echec »…) ; « Retirer » (même produit déjà dans la liste) : retirerArticle(id, { silencieux: true }).
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
  // Un toucher sur « Ajouter » ou une suggestion ne retire pas le focus du champ : le clavier reste ouvert.
  const garderLeClavier = (evenement) => evenement.preventDefault();
  const boutonAjouter = el('button', { class: 'bouton bouton-secondaire bouton-ajouter-article', type: 'submit', onmousedown: garderLeClavier }, 'Ajouter');
  const listeSuggestions = el('div', { class: 'suggestions suggestions-article' });
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
  listeSuggestions,
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

  function dessinerSuggestions() {
    const catalogue = catalogueAvecDictionnaire(courant.tousLesPlats ?? courant.plats ?? []);
    const saisie = champ.value;
    const proposees = saisie.trim() ? suggestions(catalogue, saisie, { max: 3 }) : [];
    reconcilier(listeSuggestions, proposees, {
      cle: (element) => reduire(element.produit),
      creer: (element) => el('button', {
        class: 'suggestion',
        type: 'button',
        onmousedown: garderLeClavier,
        onclick: () => ajouter(element.produit),
      }, el('span', { class: 'suggestion-nom' }, reduire(element.produit))),
    });
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
  majBouton();
  return handle;
}

/** Ligne, ligne du placard ou article de la liste montrée, par sa clé ; null s'il n'y est plus. */
function trouver(ctx, cle) {
  const liste = listeCourante(ctx);
  return [...(liste?.lignes ?? []), ...(liste?.maison ?? []), ...(liste?.articles ?? [])].find((l) => l?.cle === cle) ?? null;
}

let numeroDetails = 0;

/**
 * Feuille d'un article (⋮) : titre = le nom ; « 600 g en tout » ; « Pour : » puis une ligne par source (« Gratin de
 * pâtes · 400 g », « Version mer d'Adulte B · Gratin · 100 g ») ; « Déjà pris : … » ; produit du placard : « D'habitude,
 * vous en avez : il n'est pas sur la liste. » + interrupteur « À racheter cette fois » ; article ajouté à la main :
 * « Ajouté à la main. » et « Retirer de la liste » (l'annonce de l'app permet d'annuler). Se ferme si la ligne
 * disparaît de la liste. → { maj(ctx), fermer }
 */
export function ouvrirDetailsArticle(lireCtx, cle, { onFermer } = {}) {
  let courant = lireCtx();
  let ouverte = true;
  numeroDetails += 1;
  const base = `details-article-${numeroDetails}`;

  const total = el('p', { class: 'total-article' });
  const dejaPris = el('p', { class: 'texte-doux' });
  const listeSources = el('ul', { class: 'liste-simple sources-article' });
  const blocSources = el('div', { class: 'bloc-sources' }, el('p', { class: 'etiquette-pour' }, 'Pour\u00A0:'), listeSources);
  const textePlacard = el('p', { id: `${base}-placard` });
  const interrupteur = el('input', {
    class: 'interrupteur',
    type: 'checkbox',
    role: 'switch',
    'aria-describedby': `${base}-placard`,
    onchange: () => courant.actions?.racheter?.(cle, interrupteur.checked),
  });
  const blocPlacard = el('div', { class: 'bloc-placard' },
    textePlacard,
    el('label', { class: 'ligne-precaution ligne-racheter' },
      el('span', { class: 'precaution-texte' }, el('span', { class: 'precaution-libelle' }, 'À racheter cette fois')),
      interrupteur));
  const texteMain = el('p', {});
  const boutonRetirer = el('button', {
    class: 'bouton bouton-secondaire bouton-plein',
    type: 'button',
    onclick: () => {
      const ligne = trouver(courant, cle);
      fermer();
      if (ligne?.type === 'article') courant.actions?.retirerArticle?.(ligne.articleId);
    },
  }, 'Retirer de la liste');
  const blocMain = el('div', { class: 'bloc-main' }, texteMain, boutonRetirer);
  // Drive réglé (T3b) : le mot cherché au drive pour ce produit, « Changer » ouvre « Au drive, je cherche ».
  const texteMot = el('span', { class: 'texte-mot-drive' });
  const boutonMot = el('button', {
    class: 'bouton bouton-texte bouton-changer-mot',
    type: 'button',
    // Le nom lu commence par le mot affiché : « Changer le mot cherché ».
    'aria-label': TEXTES_DRIVE.changerLeMot,
    onclick: () => ouvrirMotCherche(lireCtx, cle, {
      onFermer: () => {
        if (ouverte && boutonMot.isConnected) boutonMot.focus();
      },
    }),
  }, TEXTES_DRIVE.changer);
  const blocMot = el('div', { class: 'bloc-mot-drive', hidden: true },
    el('p', { class: 'ligne-mot-drive' }, texteMot, el('span', { 'aria-hidden': 'true' }, ' · '), boutonMot),
    el('p', { class: 'aide' }, TEXTES_DRIVE.serviraSuivantes));
  const boutonFermer = el('button', { class: 'bouton bouton-texte', type: 'button', onclick: () => fermer() }, 'Fermer');

  const depart = trouver(courant, cle);
  const feuille = ouvrirFeuille(depart?.nom ?? 'Article', () => el('div', { class: 'feuille-article' },
    total, dejaPris, blocSources, blocPlacard, blocMain, blocMot,
    el('div', { class: 'actions-feuille' }, boutonFermer)), {
    onFermer: () => {
      ouverte = false;
      feuillesOuvertes.delete(handle);
      onFermer?.();
    },
  });

  function fermer() {
    if (ouverte) feuille.fermer();
  }

  function dessiner() {
    const ligne = trouver(courant, cle);
    if (!ligne) {
      fermer();
      return;
    }
    feuille.definirTitre(ligne.nom);
    const article = ligne.type === 'article';
    const quantite = article ? '' : texteQuantites(ligne.totaux);
    ecrireTexte(total, quantite ? `${quantite} en tout` : (article ? ligne.precision ?? '' : ''));
    total.hidden = !total.textContent;
    const pris = texteDejaPris(ligne);
    ecrireTexte(dejaPris, pris);
    dejaPris.hidden = !pris;
    const sources = article ? [] : (ligne.sources ?? []);
    reconcilier(listeSources, sources, {
      cle: (s) => `${s.platId}|${s.pour ?? ''}`,
      creer: (s) => el('li', {}, texteSource(s, { profils: courant.profils ?? [], moi: courant.moi ?? null })),
      maj: (n, s) => ecrireTexte(n, texteSource(s, { profils: courant.profils ?? [], moi: courant.moi ?? null })),
    });
    blocSources.hidden = !sources.length;
    blocPlacard.hidden = !ligne.placard;
    if (ligne.placard) {
      ecrireTexte(textePlacard, ligne.rachetee
        ? `D’habitude, vous en avez. Sur la liste cette fois\u00A0: ${LIBELLES_RAYON[ligne.rayon] ?? LIBELLES_RAYON.divers}.`
        : 'D’habitude, vous en avez\u00A0: il n’est pas sur la liste.');
      if (interrupteur.checked !== ligne.rachetee) interrupteur.checked = ligne.rachetee;
    }
    blocMain.hidden = !article;
    if (article) ecrireTexte(texteMain, 'Ajouté à la main.');
    // Le mot cherché ne sert qu'avec un drive réglé ; jamais pour un produit du placard (il n'est pas sur la liste).
    const avecMot = Boolean(driveDe(courant)) && !(ligne.placard && !ligne.rachetee);
    blocMot.hidden = !avecMot;
    if (avecMot) ecrireTexte(texteMot, texteJeCherche(ligne.recherche ?? ligne.libelle));
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
