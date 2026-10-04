// Petits outils DOM partagés par les écrans. Le texte passe toujours par des nœuds texte (jamais innerHTML).

/**
 * Crée un élément : el('p', { class: 'x', onclick: f }, 'texte', autreNoeud).
 * Attributs null, undefined ou false ignorés ; true → attribut vide ; on… → écouteur.
 */
export function el(balise, attributs = {}, ...enfants) {
  const noeud = document.createElement(balise);
  for (const [nom, valeur] of Object.entries(attributs ?? {})) {
    if (valeur == null || valeur === false) continue;
    if (nom.startsWith('on') && typeof valeur === 'function') {
      noeud.addEventListener(nom.slice(2), valeur);
    } else if (nom === 'class') {
      noeud.className = valeur;
    } else {
      noeud.setAttribute(nom, valeur === true ? '' : String(valeur));
    }
  }
  for (const enfant of enfants.flat()) {
    if (enfant == null || enfant === false) continue;
    noeud.append(enfant instanceof Node ? enfant : document.createTextNode(String(enfant)));
  }
  return noeud;
}

/** Grand emoji sur pastille teintée (teinte : '', 'olive', 'ocre', 'bleu'). */
export function pastille(emoji, teinte = '', grande = false) {
  const classes = ['pastille', teinte, grande ? 'grande' : ''].filter(Boolean).join(' ');
  return el('div', { class: classes, 'aria-hidden': 'true' }, emoji);
}

/** Carte d'état vide : pastille, titre, phrase, contenu facultatif. */
export function etatVide({ emoji, teinte, titre, texte }, ...contenu) {
  return el('section', { class: 'carte etat-vide' },
    pastille(emoji, teinte, true),
    el('h2', {}, titre),
    texte ? el('p', {}, texte) : null,
    ...contenu,
  );
}

/** En-tête d'écran : titre (h1) et sous-titre facultatif. */
export function enteteVue(titre, sousTitre) {
  return el('header', { class: 'vue-entete' },
    el('h1', {}, titre),
    sousTitre ? el('p', { class: 'sous-titre' }, sousTitre) : null,
  );
}

/** Logo de l'app (bol fumant), en SVG construit nœud par nœud. */
export function logo(classe = 'logo') {
  const ns = 'http://www.w3.org/2000/svg';
  const creer = (balise, attributs) => {
    const noeud = document.createElementNS(ns, balise);
    for (const [nom, valeur] of Object.entries(attributs)) noeud.setAttribute(nom, valeur);
    return noeud;
  };
  const svg = creer('svg', { viewBox: '0 0 512 512', class: classe, 'aria-hidden': 'true' });
  svg.append(
    creer('rect', { width: '512', height: '512', rx: '112', fill: 'currentColor' }),
    creer('path', {
      d: 'M206 196c-16-20 16-34 0-58M256 196c-16-20 16-34 0-58M306 196c-16-20 16-34 0-58',
      fill: 'none', stroke: '#fff', 'stroke-linecap': 'round', 'stroke-width': '28',
    }),
    creer('path', {
      d: 'M126 236h260a10 10 0 0 1 10 10v8a10 10 0 0 1-10 10h-6a124 124 0 0 1-248 0h-6a10 10 0 0 1-10-10v-8a10 10 0 0 1 10-10Z',
      fill: '#fff',
    }),
  );
  return svg;
}
