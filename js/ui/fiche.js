// Fiche d'un plat : photo, statut, ingrédients, étapes, cuisson, conservation.
import { el, pastille, annoncer } from './dom.js';
import { choisirImage, preparerPhoto } from './photo.js';
import { copier } from './presse-papiers.js';
import { modeDeCuisson } from './pictos.js';
import { texteDemandeRecette } from '../coeur/paquet.js';
import { LIBELLES_TYPE, STATUTS, statutDe, typeDe, quantiteLisible, cuissonLisible, visuelDuPlat } from '../coeur/plats.js';

// Photos en cours de préparation, au niveau du module : une fiche rouverte pendant la compression le sait.
const compressions = new Map(); // platId → jeton du dernier choix
const fichesOuvertes = new Set(); // fonctions de rafraîchissement des fiches affichées
let jetonSuivant = 0;
let dernierAppui = 0; // horodatage de la dernière ouverture du sélecteur

function rafraichirFiches() {
  for (const rafraichir of fichesOuvertes) rafraichir();
}

/** Prend ou choisit, compresse et enregistre une photo. Seul le dernier choix pour un plat est enregistré. */
async function changerPhoto(id, actions, appareil) {
  // Double appui : un seul sélecteur. Le verrou ne dépend pas de la fin du choix (« cancel » peut ne jamais arriver).
  if (Date.now() - dernierAppui < 1000) return;
  dernierAppui = Date.now();
  const fichier = await choisirImage({ appareil });
  if (!fichier) return;
  jetonSuivant += 1;
  const jeton = jetonSuivant;
  compressions.set(id, jeton);
  rafraichirFiches();
  try {
    const donnees = await preparerPhoto(fichier);
    if (compressions.get(id) !== jeton) return; // un choix plus récent l'emporte
    actions.enregistrerPhoto(id, donnees);
    annoncer('Photo enregistrée.');
  } catch {
    if (compressions.get(id) === jeton) annoncer('Cette image n’a pas pu être lue. Essayez une photo JPEG ou PNG.');
  } finally {
    if (compressions.get(id) === jeton) compressions.delete(id);
    rafraichirFiches();
  }
}

function accord(nombre, singulier, pluriel) {
  return `${nombre}\u00A0${nombre > 1 ? pluriel : singulier}`;
}

function section(titre, ...contenu) {
  return el('section', { class: 'fiche-section' }, el('h2', {}, titre), ...contenu);
}

function ligneInfo(terme, definition) {
  return definition ? el('div', { class: 'ligne-info' }, el('dt', {}, terme), el('dd', {}, definition)) : null;
}

export function creer(ctx) {
  const id = ctx.parametre;
  let courant = ctx;
  let photo; // undefined : en cours de lecture ; null : pas de photo ; { image } sinon
  let retraitAConfirmer = false;
  let minuteurRetrait = null;

  const figure = el('figure', { class: 'photo-plat' });
  const contenu = el('div', { class: 'fiche-contenu' });
  // Boutons gardés d'un rendu à l'autre : le focus (clavier, TalkBack) n'est pas perdu.
  const boutonAppareil = el('button', { class: 'bouton bouton-secondaire', type: 'button', onclick: () => changerPhoto(id, courant.actions, true) });
  const boutonGalerie = el('button', { class: 'bouton bouton-secondaire', type: 'button', onclick: () => changerPhoto(id, courant.actions, false) }, '🖼️ Depuis la galerie');
  const boutonRetrait = el('button', { class: 'bouton bouton-texte', type: 'button', onclick: retirer });
  const actionsPhoto = el('div', { class: 'actions-photo' },
    el('div', { class: 'choix-photo' }, boutonAppareil, boutonGalerie),
    boutonRetrait);

  // Recette (gestionnaire) : « Demander à Claude » copie la demande, « Coller la recette » ouvre l'ajout pour ce plat.
  // Gardés d'un rendu à l'autre, comme les boutons de la photo.
  let demandeCopiee = false;
  const boutonDemander = el('button', { class: 'bouton bouton-plein', type: 'button', onclick: demanderAClaude }, '📋 Demander à Claude');
  const lienColler = el('a', { class: 'bouton bouton-plein', href: `#/import/${encodeURIComponent(id)}` }, 'Coller la recette');
  const messageCopie = el('p', { class: 'aide', role: 'status' });
  const actionsRecette = el('div', { class: 'actions-recette' }, messageCopie, boutonDemander, lienColler);

  const platCourant = () => courant.plats.find((plat) => plat.id === id);
  const aUnePhoto = (plat) => Boolean(plat?.vignette || photo?.image);

  async function demanderAClaude() {
    const plat = platCourant();
    if (!plat) return;
    const reussi = await copier(texteDemandeRecette(plat));
    demandeCopiee = demandeCopiee || reussi;
    messageCopie.textContent = reussi
      ? 'Copié. Collez-le dans votre projet Claude, puis revenez ici et touchez «\u00A0Coller la recette\u00A0».'
      : 'La copie n’a pas marché. Réessayez.';
    majActionsRecette();
  }

  /** Avant la copie, l'action principale est « Demander à Claude » ; ensuite, « Coller la recette ». */
  function majActionsRecette() {
    boutonDemander.className = `bouton bouton-plein ${demandeCopiee ? 'bouton-secondaire' : 'bouton-principal'}`;
    lienColler.className = `bouton bouton-plein ${demandeCopiee ? 'bouton-principal' : 'bouton-secondaire'}`;
    messageCopie.hidden = !messageCopie.textContent;
  }

  const arreterPhoto = ctx.actions.suivrePhoto(id, (donnees) => {
    photo = donnees;
    dessinerPhoto();
    majBoutonsPhoto();
  });

  function dessinerPhoto() {
    const plat = platCourant();
    figure.hidden = !plat;
    if (!plat) {
      figure.replaceChildren();
      return;
    }
    const source = photo?.image ?? plat.vignette;
    figure.classList.toggle('sans-photo', !source);
    if (source) {
      const image = figure.querySelector('img') ?? el('img', {});
      image.src = source;
      image.alt = `Photo du plat\u00A0: ${plat.nom}`;
      image.classList.toggle('en-attente', !photo?.image);
      if (!image.isConnected) figure.replaceChildren(image);
    } else {
      const { emoji, teinte } = visuelDuPlat(plat);
      figure.replaceChildren(pastille(emoji, teinte, true));
    }
  }

  function majBoutonsPhoto() {
    const plat = platCourant();
    actionsPhoto.hidden = !plat;
    if (!plat) return;
    const enCours = compressions.has(id);
    const avecPhoto = aUnePhoto(plat);
    boutonAppareil.disabled = enCours;
    boutonGalerie.disabled = enCours;
    boutonAppareil.textContent = enCours ? 'Photo en cours…' : '📷 Prendre une photo';
    boutonRetrait.hidden = !avecPhoto || enCours;
    boutonRetrait.textContent = retraitAConfirmer ? 'Toucher pour confirmer le retrait' : 'Retirer la photo';
  }

  function retirer() {
    clearTimeout(minuteurRetrait);
    if (!retraitAConfirmer) {
      retraitAConfirmer = true;
      annoncer('Touchez à nouveau pour retirer la photo.');
      minuteurRetrait = setTimeout(() => {
        retraitAConfirmer = false;
        majBoutonsPhoto();
      }, 8000);
      majBoutonsPhoto();
      return;
    }
    retraitAConfirmer = false;
    courant.actions.retirerPhoto(id);
    photo = null;
    annoncer('Photo retirée.');
    dessinerPhoto();
    majBoutonsPhoto();
    boutonAppareil.focus();
  }

  function dessiner() {
    const plat = platCourant();
    if (!plat) {
      contenu.replaceChildren(courant.platsCharges
        ? el('div', { class: 'carte etat-vide compact' },
          el('p', {}, 'Ce plat n’existe plus.'),
          el('a', { class: 'bouton bouton-secondaire', href: '#/plats' }, 'Voir les plats'))
        : el('p', { class: 'texte-doux', role: 'status' }, 'Chargement…'));
      return;
    }

    const statut = statutDe(plat);
    const gestionnaire = courant.role === 'gestionnaire';
    const nomsProfils = new Map((courant.profils ?? []).map((p) => [p.id, p.nom]));
    const ingredients = plat.ingredients ?? [];
    const etapes = plat.etapes ?? [];
    const cuissons = plat.cuisson ?? [];
    const variantes = plat.variantes ?? [];
    const frigo = plat.conservation?.frigoJours;
    const congelable = plat.conservation?.congelable;
    const conservation = [
      typeof frigo === 'number' ? `${accord(frigo, 'jour', 'jours')} au frigo` : null,
      congelable === true ? 'se congèle' : congelable === false ? 'ne se congèle pas' : null,
    ].filter(Boolean).join(' · ');

    const focusRecette = actionsRecette.contains(document.activeElement) ? document.activeElement : null;
    majActionsRecette();
    // replaceChildren écrirait « null » : les blocs absents sont retirés.
    contenu.replaceChildren(...[
      el('header', { class: 'vue-entete' },
        el('h1', {}, plat.nom),
        el('p', { class: 'badges' },
          el('span', { class: 'badge' }, LIBELLES_TYPE[typeDe(plat)] ?? 'Plat'),
          el('span', { class: `badge badge-${statut}` }, `${STATUTS[statut].emoji}\u00A0${STATUTS[statut].libelle}`),
          modeDeCuisson(plat, { duree: true, classe: 'badge badge-cuisson' }),
          typeof plat.portionsBase === 'number'
            ? el('span', { class: 'badge' }, accord(plat.portionsBase, 'portion', 'portions'))
            : null,
        ),
      ),

      statut === 'attente'
        ? el('section', { class: 'carte' },
          el('div', { class: 'carte-ligne' },
            pastille('⏳', 'ocre'),
            el('div', { class: 'carte-texte' },
              el('h2', {}, 'Recette à ajouter'),
              el('p', {}, gestionnaire
                ? 'Demandez-la à votre projet Claude, puis collez sa réponse ici.'
                : 'Elle a été demandée. Elle apparaîtra ici dès qu’elle sera ajoutée.'),
            )),
          gestionnaire ? actionsRecette : null)
        : null,

      ingredients.length
        ? section('Ingrédients', el('ul', { class: 'liste-ingredients' }, ingredients.map((ingredient) => el('li', {},
          el('span', { class: 'quantite' }, quantiteLisible(ingredient.qte, ingredient.unite)),
          el('span', {}, ingredient.produit ?? ''),
        ))))
        : null,

      etapes.length
        ? section('Étapes', el('ol', { class: 'liste-etapes' }, etapes.map((etape) => el('li', {}, String(etape)))))
        : null,

      cuissons.length
        ? section('Cuisson', el('ul', { class: 'liste-simple' }, cuissons.map((c) => el('li', {}, cuissonLisible(c)))))
        : null,

      variantes.length
        ? section('Variantes', el('ul', { class: 'liste-simple' }, variantes.map((v) => el('li', {}, el('span', {},
          el('strong', {}, nomsProfils.get(v.pour) ?? 'Autre profil'),
          v.consigne ? `\u00A0: ${v.consigne}` : '',
        )))))
        : null,

      (conservation || typeof plat.tempsActifMin === 'number' || typeof plat.emporter === 'boolean' || plat.source)
        ? section('Bon à savoir', el('dl', { class: 'infos' },
          ligneInfo('Préparation', typeof plat.tempsActifMin === 'number' ? `${plat.tempsActifMin}\u00A0min de travail` : ''),
          ligneInfo('Conservation', conservation),
          ligneInfo('Boîte à emporter', plat.emporter === false ? 'Supporte mal la boîte' : plat.emporter === true ? 'Se réchauffe bien' : ''),
          ligneInfo('Source', plat.source ? String(plat.source) : ''),
        ))
        : null,

      gestionnaire && statut !== 'attente'
        ? section('Nouvelle version', el('p', { class: 'texte-doux' }, 'Pour corriger la recette, demandez-en une nouvelle version à votre projet Claude.'), actionsRecette)
        : null,
    ].filter(Boolean));
    // Bouton de la recette qui avait le focus : il le retrouve après la mise à jour.
    if (focusRecette && !actionsRecette.contains(document.activeElement)) focusRecette.focus({ preventScroll: true });
  }

  function toutDessiner() {
    dessinerPhoto();
    majBoutonsPhoto();
    dessiner();
  }

  toutDessiner();
  fichesOuvertes.add(majBoutonsPhoto);

  const retour = el('a', {
    class: 'retour',
    href: '#/plats',
    onclick: (evenement) => {
      // Venu de la liste : on y revient dans l'historique, pour que le geste retour d'Android reste naturel.
      if (courant.routePrecedente === 'plats' && history.length > 1) {
        evenement.preventDefault();
        history.back();
      }
    },
  }, el('span', { 'aria-hidden': 'true' }, '‹'), 'Plats');

  return {
    noeud: el('div', { class: 'vue fiche' }, retour, figure, actionsPhoto, contenu),
    maj(nouveau) {
      courant = nouveau;
      toutDessiner();
    },
    detruire() {
      arreterPhoto();
      clearTimeout(minuteurRetrait);
      fichesOuvertes.delete(majBoutonsPhoto);
    },
  };
}
