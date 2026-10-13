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

// Clé de chaque nœud posé par reconcilier (hors du DOM : aucun attribut à lire ni à garder propre).
const clesDesNoeuds = new WeakMap();

/** Déplace `noeud` avant `reference` (à la fin si null) en gardant son focus : moveBefore s'il existe, sinon remis. */
function placer(parent, noeud, reference) {
  const actif = document.activeElement;
  const avaitLeFocus = Boolean(actif && actif !== document.body && noeud.contains(actif));
  if (avaitLeFocus && noeud.isConnected && typeof parent.moveBefore === 'function') {
    try {
      parent.moveBefore(noeud, reference);
      return;
    } catch {
      // moveBefore refusé (nœud venu d'ailleurs) : déplacement ordinaire, puis focus rendu.
    }
  }
  parent.insertBefore(noeud, reference);
  if (avaitLeFocus && actif.isConnected && document.activeElement !== actif) actif.focus({ preventScroll: true });
}

/**
 * Met à jour les enfants de `parent` d'après `elements`, sans rien reconstruire de ce qui existe déjà : chaque nœud est
 * retrouvé par sa clé (`cle(element)`), mis à jour par `maj(noeud, element)` et déplacé seulement s'il n'est pas à sa
 * place ; les clés disparues sont retirées, les nouvelles créées par `creer(element)`. Le focus et le défilement ne sont
 * jamais perdus par une mise à jour (l'ancrage de défilement du navigateur garde la ligne sous le doigt quand une ligne
 * apparaît au-dessus). `parent` ne contient que des nœuds posés ici ; les clés doivent être uniques.
 * `noeuds` (facultatif) : Map clé → nœud partagée par plusieurs parents, pour qu'un nœud passe de l'un à l'autre sans
 * être recréé (une ligne cochée qui rejoint « Dans le panier ») ; tenue à jour ici, à l'appelant d'en retirer les clés
 * disparues de tous les parents.
 * → les nœuds, dans l'ordre.
 */
export function reconcilier(parent, elements, { cle, creer, maj = null, noeuds = null } = {}) {
  const presents = new Map();
  for (const enfant of [...parent.children]) {
    if (clesDesNoeuds.has(enfant)) presents.set(clesDesNoeuds.get(enfant), enfant);
  }
  const voulus = (Array.isArray(elements) ? elements : []).map((element) => {
    const k = String(cle(element));
    let noeud = presents.get(k) ?? noeuds?.get(k) ?? null;
    if (noeud) {
      maj?.(noeud, element);
    } else {
      noeud = creer(element);
      clesDesNoeuds.set(noeud, k);
    }
    noeuds?.set(k, noeud);
    return noeud;
  });
  const gardes = new Set(voulus);
  for (const enfant of [...parent.children]) {
    if (!gardes.has(enfant)) enfant.remove();
  }
  voulus.forEach((noeud, i) => {
    const reference = parent.children[i] ?? null;
    if (reference !== noeud) placer(parent, noeud, reference);
  });
  return voulus;
}

/** Remplace un texte seulement s'il change (un lecteur d'écran ne relit pas un texte inchangé). */
export function ecrireTexte(noeud, texte) {
  const valeur = String(texte ?? '');
  if (noeud.textContent !== valeur) noeud.textContent = valeur;
}

/** Vibration légère (CLAUDE.md §4) : 40 ms, comme Découvrir ; ignorée si le téléphone la refuse. */
export function vibrer() {
  try {
    navigator.vibrate?.(40);
  } catch {
    // Vibration refusée ou absente : le geste compte quand même.
  }
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

// Durée d'affichage d'un message, et d'un message avec un bouton (« Annuler ») : le temps de le toucher.
const DUREE_ANNONCE_MS = 3500;
const DUREE_ANNONCE_ACTION_MS = 8000;
// Le bouton part après le fondu du message (transition de .annonce), pour que le bandeau ne change pas de taille.
const DUREE_FONDU_MS = 250;

let minuteurAnnonce = null;
let minuteurBouton = null;
let numeroAnnonce = 0;

/**
 * Annonce avec un bouton : « Annuler » à droite du texte, ou dessous (classe `annonce-dessous`) si le bandeau en est
 * moins haut. À côté du bouton, un texte long en police agrandie tient dans une colonne d'une vingtaine de lettres
 * (10 lignes de 2 ou 3 mots) ; dessous, il prend toute la largeur. Mesuré une fois, à l'affichage ; à hauteur égale,
 * le bouton reste à droite du texte.
 */
function placerLeBouton(zone, texte, bouton) {
  const hauteur = () => {
    // Le texte entier (même coupé par sa hauteur maximale), puis le bouton à côté de lui ou dessous.
    const dessous = bouton.offsetTop >= texte.offsetTop + texte.offsetHeight - 1;
    return dessous ? texte.scrollHeight + bouton.offsetHeight : Math.max(texte.scrollHeight, bouton.offsetHeight);
  };
  zone.classList.remove('annonce-dessous');
  const aCote = hauteur();
  zone.classList.add('annonce-dessous');
  if (hauteur() >= aCote) zone.classList.remove('annonce-dessous');
}

/**
 * Message bref en bas de l'écran (« Photo enregistrée. »), lu par les lecteurs d'écran.
 * `action` : { libelle, faire } ajoute au message un bouton (« Annuler ») ; le message reste alors 8 s au lieu de
 * 3,5 s, et tant que le bouton a le focus (clavier, lecteur d'écran) ou qu'un doigt est posé dessus. Le bouton
 * disparaît avec le message ; un toucher cache le message puis appelle `faire()`, une seule fois. Sans action : le
 * comportement d'avant, à l'identique.
 * `duree` (ms, facultative) : temps d'affichage voulu (T4-0 : « Annuler » d'une proposition, 10 s) ; une nouvelle
 * annonce remplace celle-ci, donc un autre geste la ferme.
 */
export function annoncer(texte, options = {}) {
  const zone = document.getElementById('annonce');
  if (!zone) return;
  const action = options?.action;
  const avecAction = Boolean(action && typeof action.faire === 'function' && String(action.libelle ?? '').trim());
  const numero = ++numeroAnnonce;
  clearTimeout(minuteurAnnonce);
  clearTimeout(minuteurBouton);
  zone.textContent = texte;
  zone.classList.toggle('avec-action', avecAction);
  zone.classList.remove('annonce-dessous');

  const cacher = () => {
    if (numero !== numeroAnnonce) return;
    clearTimeout(minuteurAnnonce);
    zone.classList.remove('visible');
    const bouton = zone.querySelector('.annonce-action');
    if (!bouton) return;
    // Caché : plus touchable ni atteignable au clavier, puis retiré une fois le fondu fini.
    bouton.inert = true;
    minuteurBouton = setTimeout(() => {
      if (numero !== numeroAnnonce) return;
      bouton.remove();
      zone.classList.remove('avec-action', 'annonce-dessous');
    }, DUREE_FONDU_MS);
  };
  const programmer = (duree) => {
    clearTimeout(minuteurAnnonce);
    minuteurAnnonce = setTimeout(cacher, duree);
  };

  if (avecAction) {
    let fait = false;
    // Doigt levé sans toucher le bouton (glissé ailleurs, défilement) : le message repart pour 3,5 s, comme quand le
    // focus le quitte ; un vrai toucher lui donne ensuite le focus, puis le clic le ferme.
    const relancer = () => {
      if (numero === numeroAnnonce && bouton.isConnected && !bouton.inert && document.activeElement !== bouton) {
        programmer(DUREE_ANNONCE_MS);
      }
    };
    const bouton = el('button', {
      type: 'button',
      class: 'annonce-action',
      onclick: () => {
        if (fait || numero !== numeroAnnonce) return;
        fait = true;
        // Caché d'abord : si `faire()` annonce à son tour, son message reste.
        cacher();
        action.faire();
      },
      // Le message ne part pas sous le doigt ni sous le focus ; il repart pour 3,5 s quand le focus le quitte. Un
      // toucher ne donne le focus qu'au lever du doigt : le minuteur s'arrête dès que le doigt se pose, sinon un
      // toucher commencé juste avant la fin tomberait sur un bouton déjà caché.
      onpointerdown: () => {
        if (numero === numeroAnnonce && !bouton.inert) clearTimeout(minuteurAnnonce);
      },
      onpointerup: relancer,
      onpointercancel: relancer,
      onfocus: () => {
        if (numero === numeroAnnonce) clearTimeout(minuteurAnnonce);
      },
      onblur: () => {
        if (numero === numeroAnnonce && bouton.isConnected && !bouton.inert) programmer(DUREE_ANNONCE_MS);
      },
    }, String(action.libelle));
    // Le bandeau ne capte pas les touchers (.annonce : pointer-events: none) ; son bouton, si.
    bouton.style.pointerEvents = 'auto';
    // Le texte dans son propre bloc, qui seul se coupe : le bouton reste entier et touchable, même en police agrandie.
    const bloc = el('span', { class: 'annonce-texte' }, texte);
    zone.textContent = '';
    zone.append(bloc, ' ', bouton);
    placerLeBouton(zone, bloc, bouton);
  }

  zone.classList.add('visible');
  const voulue = Number.isFinite(options?.duree) && options.duree > 0 ? options.duree : null;
  programmer(voulue ?? (avecAction ? DUREE_ANNONCE_ACTION_MS : DUREE_ANNONCE_MS));
}

/**
 * Fait défiler la page juste assez pour que `noeud` (la carte que l'annonce désigne : premier plat proposé, plat
 * remplacé) soit entièrement visible au-dessus du bandeau d'annonce et des onglets, sans passer sous l'en-tête (ni
 * sous le bandeau d'aperçu) ; trop haut pour tenir entre les deux, il s'arrête sous l'en-tête. Le focus ne bouge pas ;
 * rien si la carte est déjà en vue ou si la page ne défile pas plus loin.
 */
export function montrerAuDessusDeLAnnonce(noeud) {
  if (!noeud?.isConnected) return;
  const MARGE = 8;
  let limite = window.innerHeight;
  const onglets = document.getElementById('onglets');
  if (onglets && !onglets.hidden) limite = Math.min(limite, onglets.getBoundingClientRect().top);
  const zone = document.getElementById('annonce');
  if (zone?.classList.contains('visible')) {
    // Place d'arrivée du bandeau (son entrée le glisse encore de quelques pixels) : `bottom` calculé, sans la transition.
    const bas = parseFloat(getComputedStyle(zone).bottom);
    limite = Math.min(limite, Number.isFinite(bas) ? window.innerHeight - bas - zone.offsetHeight : zone.getBoundingClientRect().top);
  }
  const plafond = Math.max(0, ...[...document.querySelectorAll('.entete, .bandeau-apercu:not([hidden])')]
    .map((n) => n.getBoundingClientRect().bottom)) + MARGE;
  const boite = noeud.getBoundingClientRect();
  const descente = Math.min(boite.bottom + MARGE - limite, boite.top - plafond);
  if (descente > 0) window.scrollBy(0, descente);
}
