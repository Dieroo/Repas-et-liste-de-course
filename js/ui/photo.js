// Photo d'un plat : choix sur le téléphone, puis compression dans le navigateur (CLAUDE.md §6 `photos`).
import { PHOTO, PHOTO_RECETTE, VIGNETTE, dimensionsReduites, carreCentral, tailleStockee } from '../coeur/photo.js';

/**
 * Ouvre l'appareil photo (`appareil`) ou la galerie du téléphone. À appeler dans un toucher. → File ou null.
 * Pas de délai d'attente : la photo prise peut arriver plusieurs secondes après le retour sur la page.
 */
export function choisirImage({ appareil = false } = {}) {
  return new Promise((resoudre) => {
    const entree = document.createElement('input');
    entree.type = 'file';
    entree.accept = 'image/*';
    if (appareil) entree.setAttribute('capture', 'environment');
    entree.addEventListener('change', () => resoudre(entree.files?.[0] ?? null), { once: true });
    entree.addEventListener('cancel', () => resoudre(null), { once: true });
    entree.click();
  });
}

/**
 * Plusieurs images de la galerie (ou une photo de l'appareil), `max` au plus. À appeler dans un toucher. → File[]
 * (vide si la personne renonce).
 */
export function choisirImages({ appareil = false, max = 1 } = {}) {
  return new Promise((resoudre) => {
    const entree = document.createElement('input');
    entree.type = 'file';
    entree.accept = 'image/*';
    if (appareil) entree.setAttribute('capture', 'environment');
    else if (max > 1) entree.multiple = true;
    entree.addEventListener('change', () => resoudre([...(entree.files ?? [])].slice(0, Math.max(1, max))), { once: true });
    entree.addEventListener('cancel', () => resoudre([]), { once: true });
    entree.click();
  });
}

/**
 * Photo d'une recette jointe à une demande (1600 px, 900 Ko au plus), en adresse de données JPEG. Une image trop
 * chargée pour tenir à 1600 px est réduite à 1200 px.
 */
export async function preparerPhotoRecette(fichier) {
  const image = await createImageBitmap(fichier, { imageOrientation: 'from-image' });
  try {
    for (const cote of [PHOTO_RECETTE.cote, 1200]) {
      const taille = dimensionsReduites(image.width, image.height, cote);
      try {
        return await encoder(image, [0, 0, image.width, image.height], taille.largeur, taille.hauteur, PHOTO_RECETTE);
      } catch (erreur) {
        if (cote === 1200) throw erreur;
      }
    }
    throw new Error('Image trop lourde après compression.');
  } finally {
    image.close();
  }
}

/** Photo (1024 px, ~200 Ko) et vignette carrée (160 px, ~12 Ko), en adresses de données JPEG. */
export async function preparerPhoto(fichier) {
  const image = await createImageBitmap(fichier, { imageOrientation: 'from-image' });
  try {
    const grande = dimensionsReduites(image.width, image.height, PHOTO.cote);
    const carre = carreCentral(image.width, image.height);
    const coteVignette = Math.min(VIGNETTE.cote, carre.cote);
    return {
      image: await encoder(image, [0, 0, image.width, image.height], grande.largeur, grande.hauteur, PHOTO),
      vignette: await encoder(image, [carre.x, carre.y, carre.cote, carre.cote], coteVignette, coteVignette, VIGNETTE),
    };
  } finally {
    image.close();
  }
}

async function encoder(image, [sx, sy, sl, sh], largeur, hauteur, { octetsMax, qualites }) {
  const toile = document.createElement('canvas');
  toile.width = largeur;
  toile.height = hauteur;
  const contexte = toile.getContext('2d');
  contexte.fillStyle = '#ffffff'; // fond blanc pour les images transparentes
  contexte.fillRect(0, 0, largeur, hauteur);
  contexte.imageSmoothingQuality = 'high';
  contexte.drawImage(image, sx, sy, sl, sh, 0, 0, largeur, hauteur);
  let fichier = null;
  for (const qualite of qualites) {
    fichier = await new Promise((resoudre) => toile.toBlob(resoudre, 'image/jpeg', qualite));
    if (fichier && tailleStockee(fichier.size) <= octetsMax) break;
  }
  if (!fichier || tailleStockee(fichier.size) > octetsMax) throw new Error('Image trop lourde après compression.');
  return new Promise((resoudre, rejeter) => {
    const lecteur = new FileReader();
    lecteur.onload = () => resoudre(lecteur.result);
    lecteur.onerror = () => rejeter(lecteur.error);
    lecteur.readAsDataURL(fichier);
  });
}
