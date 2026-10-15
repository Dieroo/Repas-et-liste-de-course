// Recette demandée en photos (2026-10-16). Feuille « Nouveau plat » de la vue « Repas et courses » : jusqu'à 3 photos
// de la recette (appareil ou galerie), « ⭐ C’est la photo du plat » pour l'une d'elles. Fiche du plat ⏳ : les photos
// de la demande, lues seulement à l'ouverture de la fiche (près de 1 Mo chacune).
import { el } from './dom.js';
import { choisirImages, preparerPhoto, preparerPhotoRecette } from './photo.js';
import { PHOTOS_DEMANDE_MAX } from '../coeur/photos-demande.js';

export const TEXTES_PHOTOS = {
  legende: 'Photos de la recette (facultatif)',
  aide: 'Le titre, les ingrédients, les étapes\u00A0: jusqu’à 3\u00A0photos. Avec des photos, le nom peut attendre\u00A0: Claude le lira.',
  prendre: 'Prendre une photo',
  galerie: 'Depuis la galerie',
  duPlat: 'C’est la photo du plat',
  duPlatChoisie: 'Photo du plat',
  aideDuPlat: 'Une photo du plat terminé\u00A0? Touchez «\u00A0⭐ C’est la photo du plat\u00A0»\u00A0: elle ira sur sa fiche.',
  preparation: 'Préparation de la photo…',
  echec: 'Cette photo n’a pas pu être préparée. Essayez-en une autre.',
  retirer: 'Retirer',
  maximum: '3\u00A0photos\u00A0: c’est le maximum.',
  compte: (n) => `${n}\u00A0photo${n > 1 ? 's' : ''} sur 3.`,
  retiree: 'Photo retirée.',
};

/**
 * Choix des photos d'une demande de recette, dans la feuille « Nouveau plat ». Chaque photo est préparée dès son choix
 * (preparerPhotoRecette) ; celle du plat aussi en photo de fiche et en vignette (preparerPhoto).
 * → { noeud, aDesPhotos(), enCours(), valeurs() } ; valeurs() attend les préparations : { photos: [{ image }],
 *   photoDuPlat: { image, vignette } | null } (les photos qui n'ont pas pu être préparées sont omises).
 */
export function creerChoixPhotos() {
  const photos = []; // { cle, fichier, image: Promise, lue, echec, li, duPlat: Promise | null }
  let compteur = 0;
  const liste = el('ul', { class: 'photos-choisies' });
  const statut = el('p', { class: 'aide', role: 'status' });
  const aideDuPlat = el('p', { class: 'aide', hidden: true }, TEXTES_PHOTOS.aideDuPlat);
  const boutonAppareil = el('button', { class: 'bouton bouton-secondaire', type: 'button', onclick: () => ajouter(true) },
    el('span', { 'aria-hidden': 'true' }, '📷\u00A0'), TEXTES_PHOTOS.prendre);
  const boutonGalerie = el('button', { class: 'bouton bouton-secondaire', type: 'button', onclick: () => ajouter(false) },
    el('span', { 'aria-hidden': 'true' }, '🖼️\u00A0'), TEXTES_PHOTOS.galerie);
  const boutons = el('div', { class: 'choix-photo' }, boutonAppareil, boutonGalerie);
  const noeud = el('fieldset', { class: 'photos-recette' },
    el('legend', { class: 'etiquette-champ' }, TEXTES_PHOTOS.legende),
    el('p', { class: 'aide' }, TEXTES_PHOTOS.aide),
    liste, aideDuPlat, boutons, statut);

  async function ajouter(appareil) {
    const place = PHOTOS_DEMANDE_MAX - photos.length;
    if (place <= 0) return;
    const fichiers = await choisirImages({ appareil, max: place });
    const nouvelles = fichiers.slice(0, PHOTOS_DEMANDE_MAX - photos.length).map((fichier) => {
      compteur += 1;
      const photo = { cle: compteur, fichier, lue: null, echec: false, li: null, duPlat: null };
      photo.image = preparerPhotoRecette(fichier).then((image) => {
        photo.lue = image;
        dessiner(photo);
        return image;
      }, () => {
        photo.echec = true;
        dessiner(photo);
        return null;
      });
      photos.push(photo);
      return photo;
    });
    if (!nouvelles.length) return;
    for (const photo of nouvelles) dessiner(photo);
    majCompte();
    const suivant = photos.length < PHOTOS_DEMANDE_MAX ? (appareil ? boutonAppareil : boutonGalerie) : nouvelles.at(-1).li.querySelector('button');
    suivant?.focus();
  }

  function retirer(photo) {
    const rang = photos.indexOf(photo);
    if (rang < 0) return;
    photos.splice(rang, 1);
    photo.li?.remove();
    photos.forEach((p) => dessiner(p));
    majCompte();
    statut.textContent = TEXTES_PHOTOS.retiree;
    const voisine = photos[rang] ?? photos[rang - 1];
    (voisine?.li?.querySelector('button') ?? boutonAppareil).focus();
  }

  function choisirDuPlat(photo) {
    const deja = Boolean(photo.duPlat);
    for (const p of photos) p.duPlat = null;
    if (!deja) photo.duPlat = preparerPhoto(photo.fichier).catch(() => null);
    photos.forEach((p) => dessiner(p));
  }

  /** Ligne d'une photo, gardée d'un dessin à l'autre (le focus n'est pas perdu). */
  function dessiner(photo) {
    if (!photos.includes(photo)) return;
    const rang = photos.indexOf(photo) + 1;
    if (!photo.li) {
      photo.li = el('li', { class: 'photo-choisie' });
      liste.append(photo.li);
    }
    const apercu = photo.lue
      ? el('img', { src: photo.lue, alt: `Photo ${rang}`, class: 'photo-choisie-image' })
      : el('span', { class: 'photo-choisie-image photo-choisie-attente', 'aria-hidden': 'true' }, photo.echec ? '⚠️' : '…');
    const texte = photo.echec ? TEXTES_PHOTOS.echec : photo.lue ? null : TEXTES_PHOTOS.preparation;
    const etoile = photo.echec ? null : el('button', {
      class: `bouton ${photo.duPlat ? 'bouton-principal' : 'bouton-secondaire'} bouton-etoile`,
      type: 'button',
      'aria-pressed': photo.duPlat ? 'true' : 'false',
      'data-role': 'etoile',
      onclick: () => choisirDuPlat(photo),
    }, el('span', { 'aria-hidden': 'true' }, '⭐\u00A0'), photo.duPlat ? TEXTES_PHOTOS.duPlatChoisie : TEXTES_PHOTOS.duPlat);
    const boutonRetirer = el('button', {
      class: 'bouton bouton-texte',
      type: 'button',
      'aria-label': `Retirer la photo ${rang}`,
      'data-role': 'retirer',
      onclick: () => retirer(photo),
    }, TEXTES_PHOTOS.retirer);
    // Le bouton qui avait le focus est remplacé par son jumeau, qui le reprend.
    const focus = photo.li.contains(document.activeElement) ? document.activeElement.dataset?.role : null;
    photo.li.replaceChildren(apercu,
      el('div', { class: 'photo-choisie-texte' },
        texte ? el('p', { class: 'aide' }, texte) : null,
        etoile,
        boutonRetirer));
    if (focus) photo.li.querySelector(`[data-role="${focus}"]`)?.focus();
    aideDuPlat.hidden = photos.length === 0;
  }

  function majCompte() {
    const plein = photos.length >= PHOTOS_DEMANDE_MAX;
    boutons.hidden = plein;
    statut.textContent = plein ? TEXTES_PHOTOS.maximum : photos.length ? TEXTES_PHOTOS.compte(photos.length) : '';
    aideDuPlat.hidden = photos.length === 0;
  }

  return {
    noeud,
    aDesPhotos: () => photos.length > 0,
    enCours: () => photos.some((photo) => !photo.lue && !photo.echec),
    async valeurs() {
      const images = await Promise.all(photos.map((photo) => photo.image));
      const choisie = photos.find((photo) => photo.duPlat);
      const duPlat = choisie ? await choisie.duPlat : null;
      return {
        photos: images.filter(Boolean).map((image) => ({ image })),
        photoDuPlat: duPlat?.image && duPlat?.vignette ? duPlat : null,
      };
    },
  };
}

/**
 * Photos de la demande de recette d'un plat, sur sa fiche (les deux rôles) : lues tant que la fiche est ouverte et que
 * la demande en porte. `suivre(platId, nombre, rappel)` : actions.suivrePhotosDemande.
 * → { noeud, suivre(platId, nombre), images(), complet(), arreter() } ; `surChangement()` après chaque lecture.
 */
export function creerPhotosDeLaDemande(suivre, surChangement = () => {}) {
  let cle = null;
  let arret = () => {};
  let lues = [];
  let attendues = 0;
  const legende = el('p', { class: 'photos-demande-legende' });
  const liste = el('ul', { class: 'photos-demande-liste' });
  const noeud = el('div', { class: 'photos-demande' }, legende, liste);

  function dessiner() {
    legende.replaceChildren(el('span', { 'aria-hidden': 'true' }, '📷\u00A0'),
      attendues === 1 ? 'La photo de la recette' : `Les ${attendues}\u00A0photos de la recette`,
      lues.length < attendues ? ' (chargement…)' : '');
    liste.replaceChildren(...lues.map(({ rang, image }) => el('li', {},
      el('img', { src: image, alt: `Photo ${rang} de la recette`, loading: 'lazy' }))));
  }

  return {
    noeud,
    suivre(platId, nombre) {
      const nouvelle = nombre > 0 ? `${platId}:${nombre}` : null;
      if (nouvelle === cle) return;
      arret();
      arret = () => {};
      cle = nouvelle;
      lues = [];
      attendues = nombre > 0 ? nombre : 0;
      if (cle) {
        arret = suivre(platId, nombre, (photos) => {
          lues = photos;
          dessiner();
          surChangement();
        });
      }
      dessiner();
    },
    images: () => lues,
    complet: () => attendues > 0 && lues.length >= attendues,
    arreter() {
      arret();
      arret = () => {};
      cle = null;
    },
  };
}
