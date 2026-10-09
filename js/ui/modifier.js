// Écran « Modifier la recette » (#/modifier/<id>, les deux membres) : nom, type, portions, ingrédients, étapes,
// cuisson principale, conservation, « Recette vérifiée ». Le formulaire est construit une seule fois : les mises à
// jour en direct (autre téléphone, retour dans l'app) ne touchent jamais à la saisie. Chaque changement est gardé
// dans un brouillon durable (brouillon.js), effacé à l'enregistrement ou à l'annulation.
import { el, annoncer } from './dom.js';
import { ouvrirFeuille } from './feuille.js';
import { pictogramme } from './pictos.js';
import { lireBrouillon, ecrireBrouillon, effacerBrouillon } from './brouillon.js';
import { slug } from '../coeur/slug.js';
import { APPAREILS, LIBELLES_TYPE, NOM_MAX, quantiteLisible } from '../coeur/plats.js';
import { marqueursEffectifs } from '../coeur/vocabulaire.js';
import { marqueursSurveilles } from '../coeur/regles.js';
import {
  UNITES_EDITION,
  LIBELLES_UNITE,
  LIBELLES_RAYON,
  LIBELLES_FORME,
  LIBELLES_ROLE,
  NATURES,
  CASES_REPERES,
  MARQUEURS_PREPARATION,
  casesPour,
  appliquerCase,
  reperesProposes,
  appliquerNature,
  natureProposee,
  PORTIONS_MAX,
  FRIGO_JOURS_MAX,
  natureDe,
  catalogueProduits,
  suggestions,
  produitConnu,
  ingredientSaisi,
  normaliserPourEdition,
  egalProfonde,
  deplacer,
  ajouterEtape,
  indexCuissonPrincipale,
  changerCuissonPrincipale,
  preparerModification,
} from '../coeur/edition.js';

const PRODUIT_MAX = 80;
const DELAI_CONFIRMATION_MS = 8000;
const DELAI_DOUBLE_APPUI_MS = 600;

// Champs de la saisie nommés dans le bandeau de conflit : [nom, genre, nombre].
const NOMS_CHAMPS = {
  nom: ['le nom', 'm', 1],
  type: ['le type de plat', 'm', 1],
  portionsBase: ['le nombre de portions', 'm', 1],
  ingredients: ['les ingrédients', 'm', 2],
  etapes: ['les étapes', 'f', 2],
  cuisson: ['la cuisson', 'f', 1],
  frigoJours: ['les jours au frigo', 'm', 2],
  congelable: ['la congélation', 'f', 1],
  emporter: ['la boîte à emporter', 'f', 1],
  verifiee: ['la case «\u00A0Recette vérifiée\u00A0»', 'f', 1],
};

// Ordre des erreurs à l'écran (de haut en bas) : « N points à corriger » mène à la première.
const ORDRE_ERREURS = ['nom', 'portionsBase', 'ingredients', 'cuisson', 'frigoJours', 'verifiee', 'recette'];

// Cases « Repères » (coeur/edition.js › CASES_REPERES) par identifiant, et marqueurs qu'elles posent.
const CASES = new Map(CASES_REPERES.map((definition) => [definition.id, definition]));
const MARQUEURS_POSES = new Set(CASES_REPERES.flatMap((definition) => definition.pose));
// Deux cases qui retirent les mêmes marqueurs (« Crue ou rosée » d'une viande, « Cru » d'un poisson) : une seule montrée.
const signatureRetrait = (definition) => [...definition.retire].sort().join('|');

/** Vrai si la case est cochée pour ces marqueurs : l'un de ceux qu'elle retire est porté, implications comprises. */
function cocheSur(definition, marqueurs) {
  const effectifs = marqueursEffectifs({ marqueurs });
  return definition.retire.some((marqueur) => effectifs.has(marqueur));
}

function majuscule(texte) {
  const [premiere = '', ...reste] = Array.from(String(texte ?? ''));
  return premiere.toLocaleUpperCase('fr-FR') + reste.join('');
}

function accord(nombre, singulier, pluriel) {
  return `${nombre}\u00A0${nombre > 1 ? pluriel : singulier}`;
}

const reduire = (texte) => String(texte ?? '').replace(/\s+/g, ' ').trim();

/** Quantité affichée dans le champ : « 0,5 » ; '' si absente. */
const qteSaisie = (qte) => (typeof qte === 'number' && Number.isFinite(qte) ? String(qte).replace('.', ',') : '');

const copie = (valeur) => structuredClone(valeur);

/** « Le nom vient d'être changé sur l'autre téléphone : le vôtre le remplacera. » (accordé) ; '' sans conflit. */
function texteConflit(conflits) {
  const champs = (conflits ?? []).map((champ) => NOMS_CHAMPS[champ]).filter(Boolean);
  if (!champs.length) return '';
  const pluriel = champs.length > 1 || champs[0][2] > 1;
  const feminin = champs.every(([, genre]) => genre === 'f');
  const noms = champs.map(([nom]) => nom);
  const liste = noms.length > 1 ? `${noms.slice(0, -1).join(', ')} et ${noms.at(-1)}` : noms[0];
  const participe = `changé${feminin ? 'e' : ''}${pluriel ? 's' : ''}`;
  let fin = 'le vôtre le remplacera';
  if (pluriel) fin = 'les vôtres les remplaceront';
  else if (feminin) fin = 'la vôtre la remplacera';
  return `${majuscule(liste)} ${pluriel ? 'viennent' : 'vient'} d’être ${participe} sur l’autre téléphone\u00A0: ${fin}.`;
}

/** Bouton radio dans une étiquette `.choix` (composant existant). → { noeud, input } */
function choixRadio(nom, valeur, contenu, { coche = false, surChoix, classe = 'choix', decrit } = {}) {
  const input = el('input', { type: 'radio', name: nom, value: valeur, checked: coche, 'aria-describedby': decrit, onchange: surChoix });
  return { noeud: el('label', { class: classe }, input, ...[contenu].flat()), input };
}

/**
 * Compteur [−] N [+] (boutons de 48 px, valeur annoncée). `surChange(n)` reçoit la nouvelle valeur.
 * → { noeud, groupe }
 */
function compteur({ id, etiquette, valeur, min, max, singulier, pluriel, moins, plus, aide, surChange }) {
  let actuelle = valeur;
  const affichage = el('span', { class: 'compteur-valeur', 'aria-live': 'polite' });
  const boutonMoins = el('button', { class: 'compteur-bouton', type: 'button', 'aria-label': moins, onclick: () => regler(-1) },
    el('span', { 'aria-hidden': 'true' }, '−'));
  const boutonPlus = el('button', { class: 'compteur-bouton', type: 'button', 'aria-label': plus, onclick: () => regler(1) },
    el('span', { 'aria-hidden': 'true' }, '+'));
  const idEtiquette = `${id}-etiquette`;
  const groupe = el('div', { class: 'compteur', role: 'group', id, tabindex: '-1', 'aria-labelledby': idEtiquette, 'aria-describedby': aide },
    boutonMoins, affichage, boutonPlus);

  function afficher() {
    affichage.textContent = accord(actuelle, singulier, pluriel);
    boutonMoins.disabled = actuelle <= min;
    boutonPlus.disabled = actuelle >= max;
  }

  function regler(pas) {
    const depart = Number.isInteger(actuelle) ? actuelle : min;
    const nouvelle = Math.min(max, Math.max(min, depart + pas));
    if (nouvelle === actuelle) return;
    actuelle = nouvelle;
    afficher();
    // Bouton devenu inactif (borne atteinte) : le focus passe à l'autre, il n'est pas perdu.
    const presse = pas < 0 ? boutonMoins : boutonPlus;
    if (presse.disabled) (pas < 0 ? boutonPlus : boutonMoins).focus();
    surChange(actuelle);
  }

  afficher();
  return {
    groupe,
    noeud: el('div', { class: 'ligne-compteur' },
      el('span', { class: 'etiquette-compteur', id: idEtiquette }, etiquette),
      groupe),
  };
}

export function creer(ctx) {
  const id = ctx.parametre;
  const uid = ctx.utilisateur?.uid ?? '';
  let courant = ctx;
  let base = null; // saisie figée à l'ouverture (ou celle du brouillon repris)
  let saisie = null; // saisie courante
  let construit = false;
  let termine = false; // enregistré ou annulé : plus d'écriture du brouillon, plus de bandeau
  let detruit = false;
  let tentative = false; // vrai après un « Enregistrer » refusé : les erreurs suivent alors la saisie
  let absent = false;
  let annulationAConfirmer = false;
  let annulationDemandeeA = 0; // un double appui ne vaut pas confirmation
  let minuteurAnnulation = null;
  let feuilleOuverte = null;

  const platCourant = () => courant.plats.find((plat) => plat.id === id);
  const vientDeLaFiche = () => courant.routePrecedente === 'plat' && history.length > 1;

  /** Retour à la fiche sans doublon dans l'historique. */
  function revenirALaFiche() {
    if (vientDeLaFiche()) history.back();
    else location.replace(`#/plat/${encodeURIComponent(id)}`);
  }

  // ——— Structure permanente ———

  const texteRetour = el('span', { class: 'retour-texte' }, 'Plat');
  const retour = el('a', {
    class: 'retour',
    href: `#/plat/${encodeURIComponent(id)}`,
    onclick: (evenement) => {
      // Venu de la fiche (toujours là) : on y revient dans l'historique. Le brouillon garde la saisie.
      if (vientDeLaFiche() && platCourant()) {
        evenement.preventDefault();
        history.back();
      }
    },
  }, el('span', { 'aria-hidden': 'true' }, '‹'), texteRetour);

  // Messages sous le titre, dans une région vivante toujours présente : un bandeau qui apparaît est annoncé.
  const messageChargement = el('p', { class: 'texte-doux', hidden: true }, 'Chargement…');
  const messageAbsent = el('div', { class: 'carte etat-vide compact', hidden: true },
    el('p', {}, 'Ce plat n’existe plus.'),
    el('a', { class: 'bouton bouton-secondaire', href: '#/plats' }, 'Voir les plats'));
  const bandeauRepris = el('p', { class: 'bandeau', hidden: true },
    el('span', { 'aria-hidden': 'true' }, '↺'),
    el('span', {}, 'Vos changements non enregistrés sont repris.'));
  const texteConflitAffiche = el('span', {});
  const bandeauConflit = el('p', { class: 'bandeau bandeau-alerte', hidden: true },
    el('span', { 'aria-hidden': 'true' }, '⚠️'), texteConflitAffiche);
  const messages = el('div', { class: 'modifier-messages', role: 'status' },
    messageChargement, messageAbsent, bandeauRepris, bandeauConflit);
  const formulaire = el('div', { class: 'modifier-formulaire', hidden: true });

  const lienErreurs = el('button', { class: 'lien-erreurs', type: 'button', hidden: true, onclick: allerALaPremiereErreur });
  const boutonEnregistrer = el('button', {
    class: 'bouton bouton-principal bouton-plein',
    type: 'button',
    disabled: true,
    onclick: enregistrer,
  }, 'Enregistrer');
  const barre = el('div', { class: 'barre-enregistrer', hidden: true },
    el('div', { class: 'barre-enregistrer-contenu' }, lienErreurs, boutonEnregistrer));

  // Éléments du formulaire, créés par construireFormulaire().
  const champs = {};
  const zonesErreur = {};
  const descriptions = {}; // aria-describedby de base de chaque champ (aide toujours visible)
  let listeIngredients;
  let videIngredients;
  let boutonAjouterIngredient;
  let listeEtapes;
  let boutonAjouterEtape;
  let boutonAnnuler;
  // Demande de confirmation lue par le lecteur d'écran, sans annonce visible qui cacherait le bouton.
  const statutAnnulation = el('p', { class: 'visuellement-masque', role: 'status' });

  // ——— Cuisson principale (« Cuit surtout au ») ———
  // La liste de départ reste fixe pendant la saisie : le choix (appareil et durée) remplace son étape principale,
  // même si une autre étape devient plus longue en cours de route. Revenir au choix de départ rend la liste de départ.
  let cuissonSource = [];
  let choixCuisson = { appareil: undefined, dureeMin: null }; // undefined : rien de coché ; null : « Aucun »

  function initialiserCuisson() {
    // Liste de départ : celle de la fiche, même après la reprise d'un brouillon. Le choix se lit dans la saisie, sur
    // l'étape qui occupe la place de l'étape principale de départ (sa durée a pu être raccourcie ou effacée).
    cuissonSource = copie(base.cuisson.length ? base.cuisson : saisie.cuisson);
    if (!saisie.cuisson.length) {
      choixCuisson = { appareil: null, dureeMin: null };
      return;
    }
    const principale = indexCuissonPrincipale(cuissonSource);
    const etape = saisie.cuisson[principale >= 0 && principale < saisie.cuisson.length ? principale : saisie.cuisson.length - 1];
    choixCuisson = {
      appareil: Object.hasOwn(APPAREILS, etape?.appareil ?? '') ? etape.appareil : undefined,
      dureeMin: Number.isFinite(etape?.dureeMin) ? etape.dureeMin : null,
    };
  }

  /** Position, dans la saisie, de l'étape que règle « Cuit surtout au » ; -1 sans appareil choisi. */
  function indexCuissonChoisie() {
    if (typeof choixCuisson.appareil !== 'string') return -1;
    const principale = indexCuissonPrincipale(cuissonSource);
    return principale >= 0 ? principale : saisie.cuisson.length - 1;
  }

  function appliquerCuisson() {
    const { appareil, dureeMin } = choixCuisson;
    if (appareil === undefined) return;
    if (appareil === null) {
      saisie.cuisson = [];
      return;
    }
    const principale = indexCuissonPrincipale(cuissonSource);
    if (principale < 0) {
      saisie.cuisson = changerCuissonPrincipale(cuissonSource, { appareil, dureeMin });
      return;
    }
    const liste = copie(cuissonSource);
    const origine = cuissonSource[principale];
    const inchangee = origine.appareil === appareil && (Number.isFinite(origine.dureeMin) ? origine.dureeMin : null) === dureeMin;
    if (!inchangee) [liste[principale]] = changerCuissonPrincipale([origine], { appareil, dureeMin });
    saisie.cuisson = liste;
  }

  // ——— Changements de saisie ———

  function sauverBrouillon() {
    if (termine || !saisie) return;
    if (egalProfonde(saisie, base)) effacerBrouillon(uid, id);
    else ecrireBrouillon(uid, id, { base, saisie });
  }

  function changement() {
    if (termine || !saisie) return;
    sauverBrouillon();
    majAideCuisson();
    majBarre();
  }

  const pret = () => courant.platsCharges && courant.demandesChargees && !termine;

  function preparer(plat) {
    return preparerModification(base, saisie, plat, {
      plats: courant.plats,
      demandes: courant.demandes,
      reglages: courant.reglages,
    });
  }

  function majBarre() {
    const plat = platCourant();
    if (!plat || !saisie) {
      barre.hidden = true;
      return;
    }
    barre.hidden = false;
    const resultat = preparer(plat);
    boutonEnregistrer.disabled = resultat.rien || !pret();
    if (tentative) afficherErreurs(resultat.erreurs);
    majConflit(resultat.conflits);
  }

  function majConflit(conflits) {
    const texte = termine ? '' : texteConflit(conflits);
    if (texteConflitAffiche.textContent !== texte) texteConflitAffiche.textContent = texte;
    bandeauConflit.hidden = !texte;
  }

  // ——— Erreurs de l'écran ———

  /** Affiche les erreurs sous chaque champ concerné, et « N points à corriger » dans la barre. */
  function afficherErreurs(erreurs) {
    const parZone = new Map();
    for (const { champ, message } of erreurs) {
      const zone = Object.hasOwn(zonesErreur, champ) ? champ : 'recette';
      if (!parZone.has(zone)) parZone.set(zone, []);
      if (!parZone.get(zone).includes(message)) parZone.get(zone).push(message);
    }
    let total = 0;
    for (const [zone, noeud] of Object.entries(zonesErreur)) {
      const messages = parZone.get(zone) ?? [];
      total += messages.length;
      if (zone === 'recette') noeud.replaceChildren(...messages.map((message) => el('li', {}, message)));
      else noeud.textContent = messages.join(' ');
      noeud.hidden = !messages.length;
      const champ = champs[zone];
      if (!champ) continue;
      const decrit = [descriptions[zone], messages.length ? noeud.id : null].filter(Boolean).join(' ');
      if (decrit) champ.setAttribute('aria-describedby', decrit);
      else champ.removeAttribute('aria-describedby');
      if (messages.length && champ.matches('input, select, textarea')) champ.setAttribute('aria-invalid', 'true');
      else champ.removeAttribute('aria-invalid');
    }
    zonesErreur.recette.parentElement.hidden = !parZone.has('recette');
    lienErreurs.replaceChildren(...(total
      ? [el('span', { 'aria-hidden': 'true' }, '⚠️'), total > 1 ? `${total}\u00A0points à corriger` : '1\u00A0point à corriger']
      : []));
    lienErreurs.hidden = !total;
  }

  function allerALaPremiereErreur() {
    const zone = ORDRE_ERREURS.find((cle) => !zonesErreur[cle]?.hidden);
    if (!zone) return;
    let cible = champs[zone];
    if (zone === 'cuisson' && champs.cuisson.closest('[hidden]')) cible = formulaire.querySelector('input[name="modifier-appareil"]');
    if (zone === 'recette') cible = zonesErreur.recette.parentElement;
    if (!cible) return;
    cible.focus({ preventScroll: true });
    cible.scrollIntoView({ block: 'center', behavior: 'smooth' });
  }

  // ——— Enregistrer, annuler ———

  function enregistrer() {
    const plat = platCourant();
    if (!plat || !saisie || !pret()) return;
    const resultat = preparer(plat);
    if (resultat.erreurs.length) {
      tentative = true;
      afficherErreurs(resultat.erreurs);
      lienErreurs.focus();
      return;
    }
    if (resultat.rien) return;
    termine = true;
    courant.actions.modifierPlat(id, {
      champs: resultat.champs,
      supprimer: resultat.supprimer,
      demandesAClore: resultat.demandesAClore,
    });
    effacerBrouillon(uid, id);
    annoncer('Recette enregistrée.');
    revenirALaFiche();
  }

  function remettreAnnulation() {
    clearTimeout(minuteurAnnulation);
    annulationAConfirmer = false;
    statutAnnulation.textContent = '';
    if (boutonAnnuler) {
      boutonAnnuler.textContent = 'Annuler les modifications';
      boutonAnnuler.classList.remove('bouton-danger');
    }
  }

  function annuler() {
    if (termine) return;
    clearTimeout(minuteurAnnulation);
    const aDesChangements = saisie && !egalProfonde(saisie, base);
    if (aDesChangements && annulationAConfirmer && Date.now() - annulationDemandeeA < DELAI_DOUBLE_APPUI_MS) return;
    if (aDesChangements && !annulationAConfirmer) {
      annulationAConfirmer = true;
      annulationDemandeeA = Date.now();
      boutonAnnuler.textContent = 'Toucher pour confirmer l’annulation';
      boutonAnnuler.classList.add('bouton-danger');
      statutAnnulation.textContent = 'Touchez à nouveau pour annuler vos changements.';
      minuteurAnnulation = setTimeout(remettreAnnulation, DELAI_CONFIRMATION_MS);
      return;
    }
    termine = true;
    effacerBrouillon(uid, id);
    if (aDesChangements) annoncer('Modifications annulées.');
    revenirALaFiche();
  }

  // ——— Lignes d'ingrédients et d'étapes ———

  const ligneIngredient = (index) => listeIngredients?.children[index]?.querySelector('button') ?? null;
  const ligneEtape = (index) => listeEtapes?.children[index]?.querySelector('button') ?? null;

  function dessinerIngredients() {
    listeIngredients.replaceChildren(...saisie.ingredients.map((ingredient, index) => {
      const quantite = quantiteLisible(ingredient?.qte, ingredient?.unite);
      return el('li', {}, el('button', { class: 'ligne-edition', type: 'button', onclick: () => ouvrirIngredient(index) },
        el('span', { class: 'ligne-quantite' }, quantite),
        quantite ? el('span', { class: 'visuellement-masque' }, ', ') : null,
        el('span', { class: 'ligne-texte' }, String(ingredient?.produit ?? '')),
        el('span', { class: 'chevron', 'aria-hidden': 'true' }, '›')));
    }));
    videIngredients.hidden = saisie.ingredients.length > 0;
  }

  function dessinerEtapes() {
    listeEtapes.replaceChildren(...saisie.etapes.map((etape, index) => el('li', {},
      el('button', { class: 'ligne-edition ligne-etape', type: 'button', onclick: () => ouvrirEtape(index) },
        el('span', { class: 'numero-etape' }, String(index + 1)),
        el('span', { class: 'visuellement-masque' }, '. '),
        el('span', { class: 'ligne-texte' }, etape),
        el('span', { class: 'chevron', 'aria-hidden': 'true' }, '›')))));
  }

  // ——— Feuille d'un ingrédient ———

  function ouvrirIngredient(index) {
    if (feuilleOuverte || termine) return;
    const existant = index === null ? null : saisie.ingredients[index];
    const nouveau = !existant;
    const catalogue = catalogueProduits(courant.plats);
    const declencheur = nouveau ? boutonAjouterIngredient : ligneIngredient(index);
    let focusApres = () => declencheur;

    const feuille = ouvrirFeuille(nouveau ? 'Nouvel ingrédient' : majuscule(existant.produit), (fermer) => {
      // Choix faits dans cette feuille ; sans choix, ils suivent l'ingrédient, puis le produit connu.
      const touches = { nature: null, forme: null, role: null };
      // Cases « Repères » touchées dans cette feuille : caseId → coche, de la plus ancienne à la plus récente. Gardées
      // si le nom est corrigé ; oubliées si une suggestion est choisie (le produit connu reprend tout).
      const touchees = new Map();
      let rayonTouche = false;
      let uniteTouchee = false;
      let suggestionChoisie = false;
      let natureDemandee = false; // erreur « Choisissez… » affichée

      const erreur = (cle) => el('p', { class: 'erreur-champ', id: `ingredient-erreur-${cle}`, hidden: true });
      const erreurs = { produit: erreur('produit'), qte: erreur('qte'), unite: erreur('unite'), nature: erreur('nature') };

      const champProduit = el('input', {
        class: 'champ',
        id: 'ingredient-produit',
        value: existant?.produit ?? '',
        maxlength: PRODUIT_MAX,
        autocomplete: 'off',
        autocapitalize: 'none',
        enterkeyhint: nouveau ? 'next' : 'done',
        autofocus: nouveau,
        oninput: () => {
          suggestionChoisie = false;
          masquerErreur('produit');
          majPrecisions();
        },
        onkeydown: (evenement) => {
          // Nouvel ingrédient : la touche « Suivant » du clavier mène à la quantité.
          if (nouveau && evenement.key === 'Enter' && !evenement.isComposing) {
            evenement.preventDefault();
            champQte.focus();
          }
        },
      });
      const champQte = el('input', {
        class: 'champ',
        id: 'ingredient-qte',
        value: qteSaisie(existant?.qte),
        inputmode: 'decimal',
        enterkeyhint: 'done',
        autocomplete: 'off',
        oninput: () => masquerErreur('qte'),
      });
      const choixUnite = el('select', {
        class: 'champ',
        id: 'ingredient-unite',
        onchange: () => {
          uniteTouchee = true;
          masquerErreur('unite');
        },
      }, UNITES_EDITION.map((unite) => el('option', { value: unite }, LIBELLES_UNITE[unite])));
      choixUnite.value = UNITES_EDITION.includes(existant?.unite) ? existant.unite : 'g';

      // Suggestions (nouvel ingrédient) : produits déjà connus, sauf ceux déjà dans la recette.
      const listeSuggestions = el('div', { class: 'suggestions', hidden: true });
      const statutSuggestions = el('p', { class: 'visuellement-masque', role: 'status' });

      const radiosNature = Object.entries(NATURES).map(([valeur, { libelle }]) => choixRadio('ingredient-nature', valeur, el('span', {}, libelle), {
        decrit: erreurs.nature.id,
        surChoix: () => {
          touches.nature = valeur;
          masquerErreur('nature');
          majPrecisions();
        },
      }));
      const groupeNature = el('fieldset', { class: 'groupe-choix', 'aria-describedby': erreurs.nature.id },
        el('legend', { class: 'etiquette-champ' }, 'C’est…'),
        el('div', { class: 'choix-ligne' }, radiosNature.map((r) => r.noeud)));
      const blocNouveau = el('div', { class: 'bloc-nouveau-produit', hidden: true },
        el('p', { class: 'aide-forte' }, 'Nouveau produit\u00A0: dites-nous ce que c’est.'));
      const emplacementNature = el('div', {});
      // « Repères » (« Au lait cru », « Crue ou rosée »…), dans « Plus de précisions » : une case par ligne, seulement
      // celles qu'une règle active surveille pour cette nature, ou dont le repère est déjà là (coeur/edition.js ›
      // casesPour) ; rien sans case. Les deux membres, aussi en aperçu « Repas et courses ».
      const surveilles = courant.surveilles ?? marqueursSurveilles(courant.profils);
      const noeudsCases = new Map(); // caseId → { noeud, input } : gardés d'un dessin à l'autre (focus conservé)
      const listeCases = el('div', { class: 'cases-reperes' });
      const groupeReperes = el('fieldset', { class: 'groupe-choix groupe-reperes', hidden: true },
        el('legend', { class: 'etiquette-champ' }, 'Repères'),
        listeCases);
      let ordreCases = '';
      let ouvertPour = null; // produit pour lequel « Plus de précisions » s'est ouvert sur un repère proposé

      const radiosForme = Object.entries(LIBELLES_FORME).map(([valeur, libelle]) => choixRadio('ingredient-forme', valeur, el('span', {}, libelle), {
        surChoix: () => { touches.forme = valeur; },
      }));
      const groupeForme = el('fieldset', { class: 'groupe-choix', hidden: true },
        el('legend', { class: 'etiquette-champ' }, 'Coupe de la viande'),
        el('div', { class: 'choix-ligne' }, radiosForme.map((r) => r.noeud)));
      const radiosRole = Object.entries(LIBELLES_ROLE).map(([valeur, libelle]) => choixRadio('ingredient-role', valeur, el('span', {}, libelle), {
        surChoix: () => { touches.role = valeur; },
      }));
      const groupeRole = el('fieldset', { class: 'groupe-choix', hidden: true },
        el('legend', { class: 'etiquette-champ' }, 'Dans le plat, ce légume est…'),
        el('div', { class: 'choix-ligne' }, radiosRole.map((r) => r.noeud)));
      const choixRayon = el('select', { class: 'champ', id: 'ingredient-rayon', onchange: () => { rayonTouche = true; } },
        Object.entries(LIBELLES_RAYON).map(([valeur, libelle]) => el('option', { value: valeur }, libelle)));
      const precisions = el('details', { class: 'depliable' },
        el('summary', {}, 'Plus de précisions'),
        el('div', { class: 'depliable-contenu' },
          emplacementNature,
          groupeReperes,
          groupeForme,
          groupeRole,
          el('label', { class: 'etiquette-champ', for: 'ingredient-rayon' }, 'Rayon du magasin'),
          choixRayon));

      function masquerErreur(cle) {
        // Texte vidé aussi : un message caché resterait lu comme description du champ.
        erreurs[cle].textContent = '';
        erreurs[cle].hidden = true;
        if (cle === 'nature') natureDemandee = false;
        const champ = { produit: champProduit, qte: champQte, unite: choixUnite }[cle];
        champ?.removeAttribute('aria-invalid');
        champ?.removeAttribute('aria-describedby');
      }

      /**
       * Ce que l'on sait du produit saisi : l'ingrédient lui-même (même nom, `meme`), un produit connu, ou rien.
       * → { etat: 'vide' | 'connu' | 'inconnu', ref, meme? }
       */
      function reference() {
        const cle = slug(champProduit.value);
        if (!cle) return { etat: 'vide', ref: null };
        if (existant && slug(existant.produit) === cle) {
          return { etat: 'connu', ref: { ...existant, nature: natureDe(existant) }, meme: true };
        }
        const connu = produitConnu(catalogue, champProduit.value);
        return connu ? { etat: 'connu', ref: connu } : { etat: 'inconnu', ref: null };
      }

      function proposer() {
        if (!nouveau || suggestionChoisie) return [];
        const dejaLa = new Set(saisie.ingredients.map((ingredient) => slug(ingredient?.produit)));
        return suggestions(catalogue, champProduit.value, { max: 4 + dejaLa.size })
          .filter((element) => !dejaLa.has(slug(element.produit)))
          .slice(0, 4);
      }

      function choisirSuggestion(element) {
        champProduit.value = element.produit;
        choixUnite.value = element.unite;
        uniteTouchee = false;
        if (typeof element.qte === 'number' && !champQte.value.trim()) champQte.value = qteSaisie(element.qte);
        Object.assign(touches, { nature: null, forme: null, role: null });
        touchees.clear();
        rayonTouche = false;
        suggestionChoisie = true;
        masquerErreur('produit');
        masquerErreur('nature');
        majPrecisions();
        champQte.focus();
      }

      function dessinerSuggestions(proposees) {
        listeSuggestions.replaceChildren(...proposees.map((element) => {
          const quantite = quantiteLisible(element.qte, element.unite);
          return el('button', { class: 'suggestion', type: 'button', onclick: () => choisirSuggestion(element) },
            el('span', { class: 'suggestion-nom' }, element.produit),
            quantite ? el('span', { class: 'suggestion-detail' }, `·\u00A0${quantite}`) : null);
        }));
        listeSuggestions.hidden = !proposees.length;
      }

      /** Nature et repères que le nom d'un produit jamais vu laisse attendre (« jambon cru »), ou null. */
      function proposition(etat) {
        return etat === 'inconnu' ? natureProposee(champProduit.value, catalogue, { surveilles }) : null;
      }

      /** Nature affichée : celle choisie ici, sinon celle de l'ingrédient ou du produit connu, sinon celle proposée. */
      function natureAffichee(etat, ref) {
        return touches.nature ?? ref?.nature ?? proposition(etat)?.nature ?? null;
      }

      /**
       * Cases « Repères » du produit saisi, pour la nature affichée. Marqueurs de départ : l'ingrédient même, ou le
       * produit connu (sans ses repères de préparation), ou rien. S'y ajoutent, cochés d'avance, les repères que son
       * nom annonce (coeur/edition.js › reperesProposes) : pour un produit jamais vu, et pour un produit connu ceux de
       * préparation seulement (« jambon cru » → cru) ; jamais sur l'ingrédient même, qui montre ce qu'il porte. Puis
       * les cases touchées ici. Une case touchée reste montrée (elle ne disparaît pas sous le doigt).
       * `changements` : cases dont l'état diffère du départ ou de la proposition, seules transmises à ingredientSaisi.
       * → { cases: [{ id, libelle, coche }], changements: [{ caseId, coche }], annonce }
       */
      function etatReperes() {
        const { etat, ref, meme } = reference();
        const nature = natureAffichee(etat, ref);
        // Produit connu (pas l'ingrédient même) : ses repères de préparation ne suivent jamais, comme dans
        // coeur/edition.js › ingredientSaisi ; sinon une case cochée ici ne serait pas enregistrée.
        const portes = Array.isArray(ref?.marqueurs) ? ref.marqueurs : [];
        const source = { marqueurs: etat === 'connu' && !meme ? portes.filter((m) => !MARQUEURS_PREPARATION.includes(m)) : portes };
        const depart = (Object.hasOwn(NATURES, nature ?? '') ? appliquerNature(source, nature) : source).marqueurs ?? [];
        let annonces = [];
        if (etat === 'inconnu' || (etat === 'connu' && !meme)) {
          annonces = (reperesProposes(champProduit.value, { surveilles }) ?? [])
            .filter((marqueur) => MARQUEURS_POSES.has(marqueur)
              && (etat === 'inconnu' || MARQUEURS_PREPARATION.includes(marqueur)));
        }
        const proposes = [...new Set([...depart, ...annonces])];
        let affiches = proposes;
        for (const [caseId, coche] of touchees) affiches = appliquerCase(affiches, caseId, coche);

        const montrees = new Set((casesPour({ marqueurs: affiches }, { surveilles }) ?? []).map((c) => c?.id));
        for (const caseId of touchees.keys()) montrees.add(caseId);
        // Cases sœurs (mêmes marqueurs retirés) aussi candidates : le choix ci-dessous garde la mieux placée.
        const signatures = new Set(CASES_REPERES.filter((d) => montrees.has(d.id)).map(signatureRetrait));
        let definitions = CASES_REPERES.filter((d) => montrees.has(d.id) || signatures.has(signatureRetrait(d)));
        // Même marqueur sous deux natures (« cru ») : une seule case, celle de la nature affichée, sinon celle de la
        // nature d'origine du produit, sinon la première ; une case touchée reste.
        const natureCases = natureDe({ marqueurs: affiches });
        const natureOrigine = natureDe(source);
        const rang = (d) => (d.natures.includes(natureCases) ? 0 : d.natures.includes(natureOrigine) ? 1 : 2);
        const gardee = new Map();
        for (const d of definitions) {
          const cle = signatureRetrait(d);
          if (!gardee.has(cle) || rang(d) < rang(gardee.get(cle))) gardee.set(cle, d);
        }
        definitions = definitions.filter((d) => gardee.get(signatureRetrait(d)) === d || touchees.has(d.id));

        const cases = definitions.map((d) => ({ id: d.id, libelle: d.libelle, coche: cocheSur(d, affiches) }));
        const changements = definitions
          .filter((d) => cocheSur(d, affiches) !== cocheSur(d, depart) || cocheSur(d, affiches) !== cocheSur(d, proposes))
          .map((d) => ({ caseId: d.id, coche: cocheSur(d, affiches) }));
        const annonce = definitions.some((d) => cocheSur(d, proposes) && !cocheSur(d, depart));
        return { cases, changements, annonce };
      }

      /** Une case par ligne, dans l'ordre de CASES_REPERES ; nœuds gardés d'un dessin à l'autre. */
      function caseRepere(caseId) {
        if (!noeudsCases.has(caseId)) {
          const input = el('input', {
            type: 'checkbox',
            onchange: () => {
              // Le dernier toucher l'emporte : la case passe en fin d'ordre.
              touchees.delete(caseId);
              touchees.set(caseId, input.checked);
              majPrecisions();
            },
          });
          noeudsCases.set(caseId, {
            input,
            noeud: el('label', { class: 'case-repere' }, input, el('span', {}, CASES.get(caseId)?.libelle ?? '')),
          });
        }
        return noeudsCases.get(caseId);
      }

      function dessinerCases(cases) {
        const ordre = cases.map(({ id: caseId }) => caseId).join('|');
        if (ordre !== ordreCases) {
          ordreCases = ordre;
          // Une case retirée puis remise dans la liste perdrait le focus : il lui est rendu.
          const focus = listeCases.contains(document.activeElement) ? document.activeElement : null;
          listeCases.replaceChildren(...cases.map(({ id: caseId }) => caseRepere(caseId).noeud));
          if (focus?.isConnected && document.activeElement !== focus) focus.focus({ preventScroll: true });
        }
        for (const { id: caseId, coche } of cases) caseRepere(caseId).input.checked = coche;
        groupeReperes.hidden = !cases.length;
      }

      /** Met à jour suggestions, nature, coupe, rôle et rayon affichés selon le produit saisi et les choix faits. */
      function majPrecisions() {
        const { etat, ref } = reference();
        const proposees = proposer();
        dessinerSuggestions(proposees);
        const texteStatut = proposees.length ? accord(proposees.length, 'suggestion', 'suggestions') : '';
        if (statutSuggestions.textContent !== texteStatut) statutSuggestions.textContent = texteStatut;

        // Nouvel ingrédient tapé en entier : il prend l'unité habituelle du produit connu ; « g » sinon.
        if (nouveau && !uniteTouchee) choixUnite.value = UNITES_EDITION.includes(ref?.unite) ? ref.unite : 'g';

        // Produit jamais vu dont le nom parle de viande, de bouillon de viande… : sa nature arrive présélectionnée.
        const nature = natureAffichee(etat, ref);
        for (const radio of radiosNature) radio.input.checked = radio.input.value === nature;

        // Produit jamais vu : la question de sa nature est posée en évidence (une fois pour toutes).
        const inconnu = etat === 'inconnu';
        const demander = inconnu && (!proposees.length || touches.nature !== null || natureDemandee);
        if (demander && groupeNature.parentNode !== blocNouveau) {
          blocNouveau.append(groupeNature);
          if (!nouveau) precisions.open = true;
        } else if (!demander && groupeNature.parentNode !== emplacementNature) {
          emplacementNature.append(groupeNature);
        }
        blocNouveau.hidden = !demander;

        // Repères : un repère que le nom annonce (« Fruits à coque entiers » pour « noix ») arrive coché ; « Plus de
        // précisions » s'ouvre alors une fois pour ce produit, pour que la case se voie et reste modifiable.
        const reperes = etatReperes();
        dessinerCases(reperes.cases);
        const cleProduit = slug(champProduit.value);
        if (reperes.annonce && ouvertPour !== cleProduit) {
          ouvertPour = cleProduit;
          precisions.open = true;
        }

        groupeForme.hidden = nature !== 'viande';
        groupeRole.hidden = nature !== 'legume';
        const forme = touches.forme ?? (Object.hasOwn(LIBELLES_FORME, ref?.forme ?? '') ? ref.forme : NATURES.viande.forme);
        for (const radio of radiosForme) radio.input.checked = radio.input.value === forme;
        const role = touches.role ?? (Object.hasOwn(LIBELLES_ROLE, ref?.role ?? '') ? ref.role : NATURES.legume.role);
        for (const radio of radiosRole) radio.input.checked = radio.input.value === role;

        if (!rayonTouche) {
          choixRayon.value = Object.hasOwn(LIBELLES_RAYON, ref?.rayon ?? '') ? ref.rayon : NATURES[nature ?? 'autre'].rayon;
        }
      }

      function montrerErreurs(trouvees) {
        for (const [cle, message] of Object.entries(trouvees)) {
          if (!erreurs[cle]) continue;
          erreurs[cle].textContent = message;
          erreurs[cle].hidden = false;
          const champ = { produit: champProduit, qte: champQte, unite: choixUnite }[cle];
          champ?.setAttribute('aria-invalid', 'true');
          champ?.setAttribute('aria-describedby', erreurs[cle].id);
        }
        if (trouvees.nature) {
          natureDemandee = true;
          majPrecisions();
        }
        const ordre = nouveau ? ['produit', 'qte', 'unite', 'nature'] : ['qte', 'unite', 'produit', 'nature'];
        const premiere = ordre.find((cle) => trouvees[cle]);
        const cible = { produit: champProduit, qte: champQte, unite: choixUnite, nature: radiosNature[0].input }[premiere];
        cible?.focus();
      }

      function valider(evenement) {
        evenement.preventDefault();
        // Seules les cases « Repères » changées sont transmises : un `cafe` ou un `gelatine_porc` non touché reste tel quel.
        const { changements } = etatReperes();
        // Rayon affiché différent de celui de la fiche (absent ou inconnu) : « Valider » enregistre celui affiché.
        const inchange = !nouveau
          && champProduit.value === existant.produit
          && champQte.value === qteSaisie(existant.qte)
          && choixUnite.value === existant.unite
          && choixRayon.value === existant.rayon
          && !rayonTouche && touches.nature === null && touches.forme === null && touches.role === null
          && !changements.length;
        if (inchange) {
          fermer();
          return;
        }
        const resultat = ingredientSaisi({
          produit: champProduit.value,
          qte: champQte.value,
          unite: choixUnite.value,
          rayon: choixRayon.value,
          nature: touches.nature ?? proposition(reference().etat)?.nature ?? '',
          forme: touches.forme ?? '',
          role: touches.role ?? '',
          reperes: changements,
        }, { catalogue, ingredients: saisie.ingredients, index, surveilles });
        if (resultat.erreurs) {
          montrerErreurs(resultat.erreurs);
          return;
        }
        const { ingredient } = resultat;
        const liste = [...saisie.ingredients];
        const position = nouveau ? liste.length : index;
        liste[position] = ingredient;
        saisie.ingredients = liste;
        dessinerIngredients();
        changement();
        focusApres = () => ligneIngredient(position);
        fermer();
        const quantite = quantiteLisible(ingredient.qte, ingredient.unite);
        annoncer(nouveau
          ? `Ingrédient ajouté\u00A0: ${ingredient.produit}, ${quantite}.`
          : `${majuscule(ingredient.produit)}\u00A0: ${quantite}.`);
      }

      function retirer() {
        saisie.ingredients = saisie.ingredients.filter((_, i) => i !== index);
        dessinerIngredients();
        changement();
        focusApres = () => ligneIngredient(index) ?? boutonAjouterIngredient;
        fermer();
        annoncer(`Ingrédient retiré\u00A0: ${existant.produit}.`);
      }

      const ligneQuantite = el('div', { class: 'ligne-champs' },
        el('div', { class: 'champ-groupe' },
          el('label', { class: 'etiquette-champ', for: 'ingredient-qte' }, 'Quantité'),
          champQte),
        el('div', { class: 'champ-groupe' },
          el('label', { class: 'etiquette-champ', for: 'ingredient-unite' }, 'Unité'),
          choixUnite));
      const blocProduit = [
        el('label', { class: 'etiquette-champ', for: 'ingredient-produit' }, 'Ingrédient'),
        champProduit,
        erreurs.produit,
      ];

      majPrecisions();

      return el('form', { class: 'formulaire', novalidate: true, onsubmit: valider },
        ...(nouveau ? [...blocProduit, listeSuggestions, statutSuggestions] : []),
        ligneQuantite,
        erreurs.qte,
        erreurs.unite,
        ...(nouveau ? [] : blocProduit),
        blocNouveau,
        // Sous le bloc teinté, sur le fond de la feuille : contraste suffisant en clair comme en sombre.
        erreurs.nature,
        precisions,
        el('div', { class: 'feuille-pied' },
          el('button', { class: 'bouton bouton-principal bouton-plein', type: 'submit' }, nouveau ? 'Ajouter' : 'Valider')),
        el('div', { class: 'actions-feuille' },
          nouveau ? null : el('button', { class: 'bouton bouton-texte bouton-danger', type: 'button', onclick: retirer }, 'Retirer cet ingrédient'),
          el('button', { class: 'bouton bouton-texte', type: 'button', onclick: fermer }, 'Annuler')));
    }, {
      onFermer: () => {
        feuilleOuverte = null;
        if (detruit) return;
        const cible = focusApres?.();
        if (cible?.isConnected) cible.focus();
      },
    });
    feuilleOuverte = feuille;
  }

  // ——— Feuille d'une étape ———

  function ouvrirEtape(index) {
    if (feuilleOuverte || termine) return;
    const nouveau = index === null;
    let position = index;
    let focusApres = () => (nouveau ? boutonAjouterEtape : ligneEtape(position));
    const titre = () => (nouveau ? 'Nouvelle étape' : `Étape ${position + 1} sur ${saisie.etapes.length}`);

    const feuille = ouvrirFeuille(titre(), (fermer) => {
      const zoneTexte = el('textarea', {
        class: 'champ zone-etape',
        id: 'etape-texte',
        rows: '4',
        enterkeyhint: 'done',
        autofocus: nouveau,
        onkeydown: (evenement) => {
          // Une étape tient en quelques phrases : la touche « OK » du clavier valide.
          if (evenement.key === 'Enter' && !evenement.shiftKey && !evenement.isComposing) {
            evenement.preventDefault();
            formulaireEtape.requestSubmit();
          }
        },
        onbeforeinput: (evenement) => {
          if (evenement.inputType === 'insertLineBreak' || evenement.inputType === 'insertParagraph') {
            evenement.preventDefault();
            formulaireEtape.requestSubmit();
          }
        },
      }, nouveau ? '' : saisie.etapes[index]);
      const statutDeplacement = el('p', { class: 'visuellement-masque', role: 'status' });

      const boutonMonter = el('button', { class: 'bouton bouton-secondaire', type: 'button', onclick: () => bouger(-1) },
        el('span', { 'aria-hidden': 'true' }, '↑'), 'Monter');
      const boutonDescendre = el('button', { class: 'bouton bouton-secondaire', type: 'button', onclick: () => bouger(1) },
        el('span', { 'aria-hidden': 'true' }, '↓'), 'Descendre');

      function majDeplacement() {
        boutonMonter.disabled = position <= 0;
        boutonDescendre.disabled = position >= saisie.etapes.length - 1;
      }

      function bouger(sens) {
        const vers = position + sens;
        if (vers < 0 || vers >= saisie.etapes.length) return;
        saisie.etapes = deplacer(saisie.etapes, position, vers);
        position = vers;
        dessinerEtapes();
        changement();
        feuille.definirTitre(titre());
        majDeplacement();
        // Le bouton touché devient inactif à la première ou à la dernière place : le focus passe à l'autre.
        const presse = sens < 0 ? boutonMonter : boutonDescendre;
        if (presse.disabled) (sens < 0 ? boutonDescendre : boutonMonter).focus();
        // Le message bref de l'app est caché derrière la feuille : l'annonce passe par la feuille.
        statutDeplacement.textContent = `Étape déplacée en ${position + 1}${position === 0 ? 're' : 'e'}\u00A0position.`;
      }

      function retirer() {
        saisie.etapes = saisie.etapes.filter((_, i) => i !== position);
        dessinerEtapes();
        changement();
        focusApres = () => ligneEtape(position) ?? boutonAjouterEtape;
        fermer();
        annoncer('Étape retirée.');
      }

      function valider(evenement) {
        evenement.preventDefault();
        const texte = reduire(zoneTexte.value);
        if (nouveau) {
          // Une nouvelle étape vide n'est pas ajoutée.
          if (texte) {
            saisie.etapes = ajouterEtape(saisie.etapes, texte);
            dessinerEtapes();
            changement();
            const derniere = saisie.etapes.length - 1;
            focusApres = () => ligneEtape(derniere);
          }
          fermer();
          if (texte) annoncer('Étape ajoutée.');
          return;
        }
        if (!texte) {
          retirer();
          return;
        }
        const modifiee = texte !== reduire(saisie.etapes[position]);
        if (modifiee) {
          const liste = [...saisie.etapes];
          liste[position] = texte;
          saisie.etapes = liste;
          dessinerEtapes();
          changement();
        }
        fermer();
        if (modifiee) annoncer('Étape modifiée.');
      }

      majDeplacement();
      const formulaireEtape = el('form', { class: 'formulaire', novalidate: true, onsubmit: valider },
        el('label', { class: 'etiquette-champ', for: 'etape-texte' }, nouveau ? 'Que faut-il faire\u00A0?' : 'Texte de l’étape'),
        zoneTexte,
        nouveau ? null : el('div', { class: 'deplacer' }, boutonMonter, boutonDescendre),
        statutDeplacement,
        el('div', { class: 'feuille-pied' },
          el('button', { class: 'bouton bouton-principal bouton-plein', type: 'submit' }, nouveau ? 'Ajouter' : 'Valider')),
        el('div', { class: 'actions-feuille' },
          nouveau ? null : el('button', { class: 'bouton bouton-texte bouton-danger', type: 'button', onclick: retirer }, 'Retirer cette étape'),
          el('button', { class: 'bouton bouton-texte', type: 'button', onclick: fermer }, 'Annuler')));
      return formulaireEtape;
    }, {
      onFermer: () => {
        feuilleOuverte = null;
        if (detruit) return;
        const cible = focusApres?.();
        if (cible?.isConnected) cible.focus();
      },
    });
    feuilleOuverte = feuille;
  }

  // ——— Aide de la cuisson ———

  let aideCuisson;
  let ligneDuree;

  function majAideCuisson() {
    if (!aideCuisson) return;
    const choisie = indexCuissonChoisie();
    const principale = indexCuissonPrincipale(saisie.cuisson);
    const autre = choisie >= 0 && principale >= 0 && principale !== choisie ? APPAREILS[saisie.cuisson[principale].appareil] : null;
    const texte = autre
      ? `Une autre étape de cuisson dure plus longtemps\u00A0: le pictogramme montrera «\u00A0${autre}\u00A0».`
      : '';
    if (aideCuisson.textContent !== texte) aideCuisson.textContent = texte;
    aideCuisson.hidden = !texte;
    ligneDuree.hidden = typeof choixCuisson.appareil !== 'string';
  }

  // ——— Construction du formulaire (une seule fois) ———

  function zoneErreur(cle) {
    zonesErreur[cle] = el('p', { class: 'erreur-champ', id: `modifier-erreur-${cle}`, hidden: true });
    return zonesErreur[cle];
  }

  function carte(titre, ...contenu) {
    return el('section', { class: 'carte carte-edition' }, titre ? el('h2', {}, titre) : null, ...contenu);
  }

  function construireFormulaire() {
    // Nom et type
    champs.nom = el('input', {
      class: 'champ',
      id: 'modifier-nom',
      value: saisie.nom,
      maxlength: NOM_MAX,
      autocomplete: 'off',
      enterkeyhint: 'done',
      oninput: () => {
        saisie.nom = champs.nom.value;
        changement();
      },
      onkeydown: (evenement) => {
        if (evenement.key === 'Enter' && !evenement.isComposing) champs.nom.blur();
      },
    });
    const radiosType = Object.entries(LIBELLES_TYPE).map(([valeur, libelle]) => choixRadio('modifier-type', valeur, el('span', {}, libelle), {
      coche: saisie.type === valeur,
      surChoix: () => {
        saisie.type = valeur;
        changement();
      },
    }).noeud);

    // Portions
    descriptions.portionsBase = 'modifier-aide-portions';
    const portions = compteur({
      id: 'modifier-portions',
      etiquette: 'Ces quantités sont pour',
      valeur: saisie.portionsBase,
      min: 1,
      max: PORTIONS_MAX,
      singulier: 'portion',
      pluriel: 'portions',
      moins: 'Une portion de moins',
      plus: 'Une portion de plus',
      aide: descriptions.portionsBase,
      surChange: (valeur) => {
        saisie.portionsBase = valeur;
        changement();
      },
    });
    champs.portionsBase = portions.groupe;

    // Ingrédients
    listeIngredients = el('ul', { class: 'lignes-edition' });
    videIngredients = el('p', { class: 'texte-doux', hidden: true }, 'Aucun ingrédient pour l’instant.');
    boutonAjouterIngredient = el('button', {
      class: 'bouton bouton-secondaire bouton-plein',
      type: 'button',
      onclick: () => ouvrirIngredient(null),
    }, el('span', { 'aria-hidden': 'true' }, '＋'), 'Ajouter un ingrédient');
    champs.ingredients = boutonAjouterIngredient;

    // Étapes
    listeEtapes = el('ol', { class: 'lignes-edition' });
    boutonAjouterEtape = el('button', {
      class: 'bouton bouton-secondaire bouton-plein',
      type: 'button',
      onclick: () => ouvrirEtape(null),
    }, el('span', { 'aria-hidden': 'true' }, '＋'), 'Ajouter une étape');

    // Cuisson principale
    initialiserCuisson();
    const tuiles = [...Object.keys(APPAREILS), null].map((appareil) => choixRadio(
      'modifier-appareil',
      appareil ?? 'aucun',
      [appareil ? pictogramme(appareil) : el('span', { class: 'sans-picto', 'aria-hidden': 'true' }, '—'),
        el('span', {}, appareil ? APPAREILS[appareil] : 'Aucun')],
      {
        classe: 'choix choix-appareil',
        coche: choixCuisson.appareil === appareil,
        surChoix: () => {
          choixCuisson = { ...choixCuisson, appareil };
          appliquerCuisson();
          changement();
        },
      },
    ).noeud);
    descriptions.cuisson = 'modifier-aide-cuisson';
    champs.cuisson = el('input', {
      class: 'champ champ-duree',
      id: 'modifier-duree',
      'aria-describedby': descriptions.cuisson,
      value: choixCuisson.dureeMin ?? '',
      inputmode: 'numeric',
      pattern: '[0-9]*',
      maxlength: 4,
      autocomplete: 'off',
      enterkeyhint: 'done',
      oninput: () => {
        const texte = champs.cuisson.value.trim();
        choixCuisson = { ...choixCuisson, dureeMin: /^\d{1,4}$/.test(texte) ? Number(texte) : null };
        appliquerCuisson();
        changement();
      },
      onkeydown: (evenement) => {
        if (evenement.key === 'Enter' && !evenement.isComposing) champs.cuisson.blur();
      },
    });
    ligneDuree = el('div', { class: 'ligne-duree' },
      el('label', { class: 'etiquette-champ', for: 'modifier-duree' },
        'Durée', el('span', { class: 'visuellement-masque' }, ', en minutes')),
      el('div', { class: 'champ-avec-unite' }, champs.cuisson, el('span', { 'aria-hidden': 'true' }, 'min')));
    aideCuisson = el('p', { class: 'aide', id: descriptions.cuisson, hidden: true });

    // Bon à savoir
    const frigo = compteur({
      id: 'modifier-frigo',
      etiquette: 'Jours au frigo',
      valeur: saisie.frigoJours,
      min: 0,
      max: FRIGO_JOURS_MAX,
      singulier: 'jour',
      pluriel: 'jours',
      moins: 'Un jour de moins',
      plus: 'Un jour de plus',
      surChange: (valeur) => {
        saisie.frigoJours = valeur;
        changement();
      },
    });
    champs.frigoJours = frigo.groupe;
    const radiosCongelable = [[true, 'Oui'], [false, 'Non']].map(([valeur, libelle]) => choixRadio('modifier-congelable', String(valeur), el('span', {}, libelle), {
      coche: saisie.congelable === valeur,
      surChoix: () => {
        saisie.congelable = valeur;
        changement();
      },
    }).noeud);
    const radiosEmporter = [[true, 'Se réchauffe bien'], [false, 'Supporte mal']].map(([valeur, libelle]) => choixRadio('modifier-emporter', String(valeur), el('span', {}, libelle), {
      coche: saisie.emporter === valeur,
      surChoix: () => {
        saisie.emporter = valeur;
        changement();
      },
    }).noeud);

    // Recette vérifiée
    descriptions.verifiee = 'modifier-aide-verifiee';
    champs.verifiee = el('input', {
      type: 'checkbox',
      id: 'modifier-verifiee',
      checked: saisie.verifiee,
      'aria-describedby': descriptions.verifiee,
      onchange: () => {
        saisie.verifiee = champs.verifiee.checked;
        changement();
      },
    });

    boutonAnnuler = el('button', { class: 'bouton bouton-texte bouton-annuler', type: 'button', onclick: annuler }, 'Annuler les modifications');

    formulaire.replaceChildren(
      carte(null,
        el('label', { class: 'etiquette-champ', for: 'modifier-nom' }, 'Nom du plat'),
        champs.nom,
        zoneErreur('nom'),
        el('fieldset', { class: 'groupe-choix' },
          el('legend', { class: 'etiquette-champ' }, 'Type'),
          el('div', { class: 'choix-souple' }, radiosType))),

      carte('Ingrédients',
        portions.noeud,
        el('p', { class: 'aide', id: descriptions.portionsBase },
          'Pour cuisiner pour plus de monde, ne changez rien ici\u00A0: la liste de courses s’adapte.'),
        zoneErreur('portionsBase'),
        listeIngredients,
        videIngredients,
        boutonAjouterIngredient,
        zoneErreur('ingredients')),

      carte('Étapes', listeEtapes, boutonAjouterEtape),

      carte('Cuisson',
        el('fieldset', { class: 'groupe-choix' },
          el('legend', { class: 'etiquette-champ' }, 'Cuit surtout au'),
          el('div', { class: 'choix-appareils' }, tuiles)),
        ligneDuree,
        zoneErreur('cuisson'),
        el('div', { role: 'status' }, aideCuisson)),

      carte('Bon à savoir',
        frigo.noeud,
        zoneErreur('frigoJours'),
        el('fieldset', { class: 'groupe-choix' },
          el('legend', { class: 'etiquette-champ' }, 'Se congèle'),
          el('div', { class: 'choix-ligne' }, radiosCongelable)),
        el('fieldset', { class: 'groupe-choix' },
          el('legend', { class: 'etiquette-champ' }, 'Boîte à emporter'),
          el('div', { class: 'choix-souple' }, radiosEmporter))),

      carte(null,
        el('label', { class: 'case-verifiee', for: 'modifier-verifiee' },
          champs.verifiee,
          el('span', {}, 'Recette vérifiée', el('span', { 'aria-hidden': 'true' }, ' ✅'))),
        el('p', { class: 'aide', id: descriptions.verifiee }, 'À cocher quand vous l’avez cuisinée et que tout est juste.'),
        zoneErreur('verifiee')),

      // Erreurs qui ne concernent aucun champ en particulier (dernier filet de la validation).
      el('section', { class: 'carte erreurs-recette', tabindex: '-1', hidden: true },
        el('h2', {}, 'À corriger'),
        (() => {
          zonesErreur.recette = el('ul', { class: 'liste-erreurs', id: 'modifier-erreur-recette', hidden: true });
          return zonesErreur.recette;
        })()),

      boutonAnnuler,
      statutAnnulation,
    );

    dessinerIngredients();
    dessinerEtapes();
    majAideCuisson();
  }

  /** Une seule fois, quand le plat est là : à partir du brouillon s'il existe, sinon de la fiche. */
  function construire(plat) {
    const brouillon = lireBrouillon(uid, id);
    if (brouillon && !egalProfonde(brouillon.saisie, brouillon.base)) {
      base = brouillon.base;
      saisie = brouillon.saisie;
      // Champs pas touchés : ils suivent la fiche actuelle (changée ailleurs depuis, peut-être). Portions et
      // ingrédients vont ensemble : si l'un des deux est touché, les deux restent ceux du brouillon.
      const actuel = normaliserPourEdition(plat, courant.reglages);
      const recetteTouchee = ['portionsBase', 'ingredients'].some((champ) => !egalProfonde(saisie[champ], base[champ]));
      for (const champ of Object.keys(actuel)) {
        if (recetteTouchee && (champ === 'portionsBase' || champ === 'ingredients')) continue;
        if (egalProfonde(saisie[champ], base[champ])) {
          base[champ] = copie(actuel[champ]);
          saisie[champ] = copie(actuel[champ]);
        }
      }
      bandeauRepris.hidden = false;
    } else {
      if (brouillon) effacerBrouillon(uid, id);
      base = normaliserPourEdition(plat, courant.reglages);
      saisie = copie(base);
    }
    construireFormulaire();
    construit = true;
  }

  // ——— Mises à jour en direct : jamais la saisie ———

  function majEtat() {
    if (detruit) return;
    const plat = platCourant();
    const versLaListe = courant.platsCharges && !plat;
    texteRetour.textContent = plat?.nom ?? (versLaListe ? 'Plats' : 'Plat');
    retour.setAttribute('href', versLaListe ? '#/plats' : `#/plat/${encodeURIComponent(id)}`);

    let etat = 'pret';
    if (!courant.platsCharges) etat = 'chargement';
    else if (!plat) etat = 'absent';
    messageChargement.hidden = etat !== 'chargement';
    messageAbsent.hidden = etat !== 'absent';

    if (etat === 'absent') {
      // Supprimé ailleurs : la saisie ne peut plus être enregistrée.
      absent = true;
      feuilleOuverte?.fermer();
      effacerBrouillon(uid, id);
      formulaire.hidden = true;
      bandeauRepris.hidden = true;
      majConflit([]);
      barre.hidden = true;
      return;
    }
    if (etat === 'chargement') {
      formulaire.hidden = true;
      barre.hidden = true;
      return;
    }
    if (!construit) construire(plat);
    if (absent) {
      // Revenu (instantané passager) : la saisie, restée en mémoire, retrouve son brouillon.
      absent = false;
      sauverBrouillon();
    }
    formulaire.hidden = false;
    majBarre();
  }

  majEtat();

  return {
    noeud: el('div', { class: 'vue modifier' },
      retour,
      el('header', { class: 'vue-entete' }, el('h1', {}, 'Modifier la recette')),
      messages,
      formulaire,
      barre),
    maj(nouveau) {
      courant = nouveau;
      majEtat();
    },
    detruire() {
      detruit = true;
      clearTimeout(minuteurAnnulation);
      feuilleOuverte?.fermer();
    },
  };
}
