// Empreintes courtes et texte de cuisson (T5-0b), partagés par la relecture des repères (relecture.js) et les étapes
// détaillées (realisation.js) : une seule définition, sans dépendance (aucun cycle possible). Logique pure.

/**
 * Empreinte d'un texte : 6 caractères [0-9a-z], hachage FNV-1a 32 bits des octets UTF-8 du texte (le hachage de
 * relecture.js › empreinteRelecture, dont les valeurs figées ne changent pas).
 */
export function empreinteDeTexte(texte) {
  let h = 0x811c9dc5;
  for (const octet of new TextEncoder().encode(String(texte ?? ''))) {
    h ^= octet;
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return (h % (36 ** 6)).toString(36).padStart(6, '0');
}

/** Une ligne de texte, espaces réduits ; un nombre devient son texte. */
const ligne = (valeur) => {
  const brut = typeof valeur === 'number' ? String(valeur) : valeur;
  return typeof brut === 'string' ? brut.replace(/\s+/g, ' ').trim() : '';
};
const estObjet = (valeur) => Boolean(valeur) && typeof valeur === 'object' && !Array.isArray(valeur);

/**
 * Une étape de cuisson en texte : « four 200 °C 20 min », « cookeo sous pression 25 min » (espaces ordinaires : texte
 * copié pour Claude). `mode: false` : sans le mode (texte de la relecture des repères, dont l'empreinte est figée).
 */
export function etapeDeCuissonEnTexte(etape, { mode = true } = {}) {
  if (!estObjet(etape)) return '';
  return [
    ligne(etape.appareil),
    mode ? ligne(etape.mode) : '',
    etape.tempC != null ? `${ligne(etape.tempC)} °C` : '',
    etape.dureeMin != null ? `${ligne(etape.dureeMin)} min` : '',
  ].filter(Boolean).join(' ');
}

/**
 * Cuisson d'une fiche en texte : « plaque 12 min ; four 200 °C 20 min » ('' sans cuisson lisible). `mode: false` :
 * sans le mode de chaque étape (relecture.js).
 */
export function cuissonEnTexte(cuisson, { mode = true } = {}) {
  return (Array.isArray(cuisson) ? cuisson : [])
    .map((etape) => etapeDeCuissonEnTexte(etape, { mode }))
    .filter(Boolean)
    .join(' ; ');
}
