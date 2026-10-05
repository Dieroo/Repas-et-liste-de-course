// Fiche d'un plat : photo, statut, ingrédients, étapes, cuisson, conservation.
import { el, pastille, annoncer } from './dom.js';
import { choisirImage, preparerPhoto } from './photo.js';
import { LIBELLES_TYPE, STATUTS, quantiteLisible, cuissonLisible, visuelDuPlat } from '../coeur/plats.js';

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
  let photoEnCours = false;
  let retraitAConfirmer = false;
  let minuteurRetrait = null;

  const figure = el('figure', { class: 'photo-plat' });
  const contenu = el('div', { class: 'fiche-contenu' });
  const arreterPhoto = ctx.actions.suivrePhoto(id, (donnees) => {
    photo = donnees;
    dessinerPhoto();
  });

  const platCourant = () => courant.plats.find((plat) => plat.id === id);

  function dessinerPhoto() {
    const plat = platCourant();
    if (!plat) {
      figure.replaceChildren();
      figure.hidden = true;
      return;
    }
    figure.hidden = false;
    const source = photo?.image ?? plat.vignette;
    figure.classList.toggle('sans-photo', !source);
    if (source) {
      figure.replaceChildren(el('img', {
        src: source,
        alt: `Photo du plat\u00A0: ${plat.nom}`,
        class: photo?.image ? '' : 'en-attente',
      }));
    } else {
      const { emoji, teinte } = visuelDuPlat(plat);
      figure.replaceChildren(pastille(emoji, teinte, true));
    }
  }

  async function changerPhoto() {
    const fichier = await choisirImage();
    if (!fichier) return;
    photoEnCours = true;
    dessiner();
    try {
      const donnees = await preparerPhoto(fichier);
      courant.actions.enregistrerPhoto(id, donnees);
      photo = { image: donnees.image };
      annoncer('Photo enregistrée.');
    } catch {
      annoncer('Cette image n’a pas pu être lue. Essayez une photo JPEG ou PNG.');
    } finally {
      photoEnCours = false;
      dessinerPhoto();
      dessiner();
    }
  }

  function retirer() {
    if (!retraitAConfirmer) {
      retraitAConfirmer = true;
      dessiner();
      clearTimeout(minuteurRetrait);
      minuteurRetrait = setTimeout(() => {
        retraitAConfirmer = false;
        dessiner();
      }, 4000);
      return;
    }
    clearTimeout(minuteurRetrait);
    retraitAConfirmer = false;
    courant.actions.retirerPhoto(id);
    photo = null;
    annoncer('Photo retirée.');
    dessinerPhoto();
    dessiner();
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

    const statut = STATUTS[plat.statutRecette];
    const aPhoto = Boolean(plat.vignette);
    const nomsProfils = new Map((courant.profils ?? []).map((p) => [p.id, p.nom]));
    const ingredients = plat.ingredients ?? [];
    const etapes = plat.etapes ?? [];
    const cuissons = plat.cuisson ?? [];
    const variantes = plat.variantes ?? [];
    const conservation = plat.conservation
      ? [
        typeof plat.conservation.frigoJours === 'number' ? `${plat.conservation.frigoJours}\u00A0jours au frigo` : null,
        plat.conservation.congelable === true ? 'se congèle' : plat.conservation.congelable === false ? 'ne se congèle pas' : null,
      ].filter(Boolean).join(' · ')
      : '';

    // replaceChildren écrirait « null » : les blocs absents sont retirés.
    contenu.replaceChildren(...[
      el('div', { class: 'actions-photo' },
        el('button', {
          class: 'bouton bouton-secondaire',
          type: 'button',
          disabled: photoEnCours,
          onclick: changerPhoto,
        }, photoEnCours ? 'Photo en cours…' : aPhoto ? '📷 Changer la photo' : '📷 Ajouter une photo'),
        aPhoto && !photoEnCours
          ? el('button', { class: 'bouton bouton-texte', type: 'button', onclick: retirer },
            retraitAConfirmer ? 'Confirmer le retrait' : 'Retirer la photo')
          : null,
      ),

      el('header', { class: 'vue-entete' },
        el('h1', {}, plat.nom),
        el('p', { class: 'badges' },
          el('span', { class: 'badge' }, LIBELLES_TYPE[plat.type] ?? 'Plat'),
          statut ? el('span', { class: `badge badge-${plat.statutRecette}` }, `${statut.emoji}\u00A0${statut.libelle}`) : null,
          typeof plat.portionsBase === 'number' ? el('span', { class: 'badge' }, `${plat.portionsBase}\u00A0portions`) : null,
        ),
      ),

      plat.statutRecette === 'attente'
        ? el('section', { class: 'carte carte-ligne' },
          pastille('⏳', 'ocre'),
          el('div', { class: 'carte-texte' },
            el('h2', {}, 'Recette à ajouter'),
            el('p', {}, courant.roleReel === 'gestionnaire'
              ? 'Ajoutez-la avec «\u00A0Ajouter des recettes\u00A0», bientôt disponible.'
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
          el('strong', {}, nomsProfils.get(v.pour) ?? v.pour ?? ''),
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
    ].filter(Boolean));
  }

  dessinerPhoto();
  dessiner();

  return {
    noeud: el('div', { class: 'vue fiche' },
      el('a', { class: 'retour', href: '#/plats' }, el('span', { 'aria-hidden': 'true' }, '‹'), 'Plats'),
      figure,
      contenu,
    ),
    maj(nouveau) {
      courant = nouveau;
      dessinerPhoto();
      dessiner();
    },
    detruire() {
      arreterPhoto();
      clearTimeout(minuteurRetrait);
    },
  };
}
