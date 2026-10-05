// Fiche d'un plat : photo, statut, ingrédients, étapes, cuisson, conservation.
import { el, pastille, annoncer } from './dom.js';
import { choisirImage, preparerPhoto } from './photo.js';
import { LIBELLES_TYPE, STATUTS, statutDe, typeDe, quantiteLisible, cuissonLisible, visuelDuPlat } from '../coeur/plats.js';

// Photos en cours de préparation, au niveau du module : une fiche rouverte pendant la compression le sait.
const compressions = new Map(); // platId → jeton du dernier choix
const fichesOuvertes = new Set(); // fonctions de rafraîchissement des fiches affichées
let jetonSuivant = 0;
let choixOuvert = false;

function rafraichirFiches() {
  for (const rafraichir of fichesOuvertes) rafraichir();
}

/** Choisit, compresse et enregistre une photo. Seul le dernier choix pour un plat est enregistré. */
async function changerPhoto(id, actions) {
  if (choixOuvert) return; // sélecteur déjà ouvert (double appui)
  choixOuvert = true;
  const fichier = await choisirImage();
  choixOuvert = false;
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
  return `${nombre} ${nombre > 1 ? pluriel : singulier}`;
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
  const boutonPhoto = el('button', { class: 'bouton bouton-secondaire', type: 'button', onclick: () => changerPhoto(id, courant.actions) });
  const boutonRetrait = el('button', { class: 'bouton bouton-texte', type: 'button', onclick: retirer });
  const actionsPhoto = el('div', { class: 'actions-photo' }, boutonPhoto, boutonRetrait);

  const platCourant = () => courant.plats.find((plat) => plat.id === id);
  const aUnePhoto = (plat) => Boolean(plat?.vignette || photo?.image);

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
      image.alt = `Photo du plat : ${plat.nom}`;
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
    boutonPhoto.disabled = enCours;
    boutonPhoto.textContent = enCours ? 'Photo en cours…' : avecPhoto ? '📷 Changer la photo' : '📷 Ajouter une photo';
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
    boutonPhoto.focus();
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

    // replaceChildren écrirait « null » : les blocs absents sont retirés.
    contenu.replaceChildren(...[
      el('header', { class: 'vue-entete' },
        el('h1', {}, plat.nom),
        el('p', { class: 'badges' },
          el('span', { class: 'badge' }, LIBELLES_TYPE[typeDe(plat)] ?? 'Plat'),
          el('span', { class: `badge badge-${statut}` }, `${STATUTS[statut].emoji} ${STATUTS[statut].libelle}`),
          typeof plat.portionsBase === 'number'
            ? el('span', { class: 'badge' }, accord(plat.portionsBase, 'portion', 'portions'))
            : null,
        ),
      ),

      statut === 'attente'
        ? el('section', { class: 'carte carte-ligne' },
          pastille('⏳', 'ocre'),
          el('div', { class: 'carte-texte' },
            el('h2', {}, 'Recette à ajouter'),
            el('p', {}, courant.roleReel === 'gestionnaire'
              ? 'Ajoutez-la avec « Ajouter des recettes », bientôt disponible.'
              : 'Elle a été demandée. Elle apparaîtra ici dès qu’elle sera ajoutée.'),
          ))
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
          v.consigne ? ` : ${v.consigne}` : '',
        )))))
        : null,

      (conservation || typeof plat.tempsActifMin === 'number' || typeof plat.emporter === 'boolean' || plat.source)
        ? section('Bon à savoir', el('dl', { class: 'infos' },
          ligneInfo('Préparation', typeof plat.tempsActifMin === 'number' ? `${plat.tempsActifMin} min de travail` : ''),
          ligneInfo('Conservation', conservation),
          ligneInfo('Boîte à emporter', plat.emporter === false ? 'Supporte mal la boîte' : plat.emporter === true ? 'Se réchauffe bien' : ''),
          ligneInfo('Source', plat.source ? String(plat.source) : ''),
        ))
        : null,
    ].filter(Boolean));
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
