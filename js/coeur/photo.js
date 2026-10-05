// Photos des plats : tailles et réglages de compression (CLAUDE.md §6 `photos`). Logique pure.

// Plafonds sur la taille stockée (adresse de données en base64), pas sur le JPEG brut.
// Photo de la fiche : 1024 px au plus, 200 Ko au plus.
export const PHOTO = { cote: 1024, octetsMax: 200_000, qualites: [0.82, 0.72, 0.62, 0.52, 0.42] };

// Vignette carrée des listes : 10 Ko au plus.
export const VIGNETTE = { cote: 160, octetsMax: 10_000, qualites: [0.72, 0.6, 0.48, 0.36] };

/** Taille d'un JPEG de `octets` une fois écrit en adresse de données (« data:image/jpeg;base64,… »). */
export function tailleStockee(octets) {
  return 'data:image/jpeg;base64,'.length + Math.ceil(octets / 3) * 4;
}

/** Dimensions réduites pour que le plus grand côté tienne dans `cote` (jamais agrandies). */
export function dimensionsReduites(largeur, hauteur, cote) {
  const echelle = Math.min(1, cote / Math.max(largeur, hauteur));
  return {
    largeur: Math.max(1, Math.round(largeur * echelle)),
    hauteur: Math.max(1, Math.round(hauteur * echelle)),
  };
}

/** Carré central d'une image : { x, y, cote } dans l'image d'origine. */
export function carreCentral(largeur, hauteur) {
  const cote = Math.min(largeur, hauteur);
  return { x: Math.floor((largeur - cote) / 2), y: Math.floor((hauteur - cote) / 2), cote };
}
