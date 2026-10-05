// Textes comparables : identifiants (slug) et recherche sans accents. Logique pure.

/** Texte sans accents, en minuscules, « œ » et « æ » développés, espaces réduits. */
export function sansAccents(texte) {
  return String(texte ?? '')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/œ/g, 'oe')
    .replace(/æ/g, 'ae')
    .replace(/\s+/g, ' ')
    .trim();
}

/** Identifiant stable tiré d'un nom : « Carbonade flamande » → « carbonade-flamande ». */
export function slug(texte) {
  return sansAccents(texte)
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

/** Vrai si chaque mot recherché apparaît dans le texte (casse et accents ignorés). */
export function correspond(texte, recherche) {
  const cible = sansAccents(texte);
  return sansAccents(recherche).split(' ').filter(Boolean).every((mot) => cible.includes(mot));
}
