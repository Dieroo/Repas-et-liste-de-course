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

// ——— Produits (T3-0) ———

/** Mot d'un nom de produit sans son pluriel : plus de 2 lettres, « s » ou « x » final retiré (« œufs » → oeuf). */
const sansPluriel = (mot) => (mot.length > 2 ? mot.replace(/[sx]$/, '') : mot);

/**
 * Clé d'un produit, seule règle d'identité d'un produit (CLAUDE.md §6) : slug, chaque mot de plus de 2 lettres sans
 * « s » ni « x » final, dans les deux sens. « Pommes de terre » → 'pomme-de-terre' ; « Œufs » → 'oeuf' ; « radis » →
 * 'radi' (la même règle partout suffit) ; '' si le nom ne contient ni lettre ni chiffre.
 */
export function cleProduit(nom) {
  return slug(nom).split('-').filter(Boolean).map(sansPluriel).join('-');
}

const LETTRE_OU_CHIFFRE = /[a-z0-9]/;
const ACCENT = /[\u0300-\u036f]/;

/**
 * Mots d'un texte en minuscules, accents gardés, découpés exactement comme slug (un mot de slug par mot, même ordre) :
 * « Pâté de campagne » → ['pâté', 'de', 'campagne'] ; « Œufs » → ['oeufs']. `pluriel: false` : chaque mot de plus de
 * 2 lettres sans « s » ni « x » final, comme cleProduit (« pâtes » → pâte). Sert à distinguer les homographes
 * (« pâte » et « pâté », produits.js).
 */
export function motsAccentues(texte, { pluriel = true } = {}) {
  const mots = [];
  let lettres = ''; // lettres du mot sans accents, comme slug
  let mot = ''; // le même mot, accents gardés (décomposés)
  const finir = () => {
    if (lettres) {
      const garde = pluriel || lettres.length <= 2 ? mot : mot.replace(/[sx][\u0300-\u036f]*$/, '');
      mots.push(garde.normalize('NFC'));
    }
    lettres = '';
    mot = '';
  };
  for (const c of String(texte ?? '').normalize('NFD').toLowerCase()) {
    if (c === 'œ' || c === 'æ') {
      const developpe = c === 'œ' ? 'oe' : 'ae';
      lettres += developpe;
      mot += developpe;
    } else if (LETTRE_OU_CHIFFRE.test(c)) {
      lettres += c;
      mot += c;
    } else if (ACCENT.test(c)) {
      // Accent d'une lettre : il ne coupe pas le mot (slug l'efface sans couper).
      if (lettres) mot += c;
    } else {
      finir();
    }
  }
  finir();
  return mots;
}

/** Mots d'un texte : sans accents, apostrophes, tirets ni ponctuation. */
function mots(texte) {
  return sansAccents(texte).replace(/[^a-z0-9]+/g, ' ').trim();
}

/** Vrai si chaque mot recherché apparaît dans le texte (casse, accents, apostrophes et tirets ignorés). */
export function correspond(texte, recherche) {
  const cible = mots(texte);
  return mots(recherche).split(' ').filter(Boolean).every((mot) => cible.includes(mot));
}
