// Carte d'une étape à cuisiner (T5-1, plan §8.5), partagée par « Cuisiner pas à pas » et, plus tard, le batch guidé
// (T5-2). Ordre fixe, lisible téléphone posé : rappels en tête (four et part sur un bandeau terracotta, avec le
// dessin du four ou de l'assiette : « Allumez le four… », « Mettez de côté la part… » et sa case ; sur fond ocre :
// « 🧸 Pour Enfant : … »), titre, quantités de l'étape en gras et « Et aussi : … », texte,
// « ✓ Prêt quand : … », puces de durée et d'appareil, ce que demande la part mise de côté (sa consigne et ses ajouts,
// déjà dits dans « Avant de commencer » : sous le texte, pour que l'étape tienne sur l'écran), conseil de cuisson à
// cœur, « Pendant que ça cuit… ». Le titre est décrit par les rappels (lecteur d'écran : ils sont lus avec lui).
// Une étape vient de coeur/cuisine.js › pasAPas (`etapes[i]`). Rien n'est écrit : la case de la part se garde sur le
// téléphone par l'écran qui l'affiche (`surCase`). Texte inséré par nœuds texte seulement.
import { el } from './dom.js';
import { TEXTES_CUISINE } from '../coeur/cuisine.js';
import { pictoRappel } from './pictos.js';

// Pictogramme en tête d'un texte (« 🔥 », « ✂\uFE0F », « 🧸 », « ⏱ », « ✓ ») : montré, jamais lu (il ne porte pas le sens).
const EN_TETE = /^((?:\p{Extended_Pictographic}|[✓⏱])\uFE0F?(?:\u200D\p{Extended_Pictographic}\uFE0F?)*)\s*/u;

/** Texte dont le pictogramme de tête est à part (`span aria-hidden`) : [pictogramme, reste] en nœuds. */
export function avecPictogramme(texte) {
  const valeur = String(texte ?? '');
  const trouve = valeur.match(EN_TETE);
  if (!trouve) return [valeur];
  return [el('span', { 'aria-hidden': 'true', class: 'picto-texte' }, `${trouve[1]}\u00A0`), valeur.slice(trouve[0].length)];
}

/**
 * Texte d'un rappel (2026-10-15, demande du propriétaire) : le four et la part à mettre de côté portent un dessin au
 * trait de l'app (four, assiette) à la place de leur emoji de tête ; les autres gardent leur pictogramme.
 */
export function texteRappel(texte, genre, appareil) {
  const dessin = pictoRappel(genre, appareil);
  if (!dessin) return avecPictogramme(texte);
  const valeur = String(texte ?? '');
  const trouve = valeur.match(EN_TETE);
  return [dessin, el('span', {}, trouve ? valeur.slice(trouve[0].length) : valeur)];
}

/** Ce qui se voit d'une étape (pour ne rien redessiner quand rien ne change : un lecteur d'écran ne relit pas). */
function signature(etape, cases) {
  const casesVues = (etape?.rappels ?? []).filter((r) => r.case).map((r) => `${r.case.cle}:${cases.has(r.case.cle)}`);
  return JSON.stringify([
    etape?.cle, etape?.titre, etape?.texte, etape?.pret, etape?.ligneDuree, etape?.ligneAppareil, etape?.pendant,
    (etape?.quantites ?? []).map((q) => q.texte), etape?.aussi, etape?.conseils,
    (etape?.rappels ?? []).map((r) => [r.genre, r.texte, r.consigne, r.ajouts, r.case?.libelle]), casesVues,
  ]);
}

let compteur = 0;

/**
 * Carte d'étape. `surCase(cle, cochee)` : une case touchée (part mise de côté) ; `niveauTitre` : balise du titre
 * ('h1' pour un écran d'une étape à la fois).
 * → { noeud, titre (à focaliser après un changement d'étape), maj(etape, { cases: Set des clés cochées }) }
 */
export function creerCarteEtape({ surCase = () => {}, niveauTitre = 'h1' } = {}) {
  compteur += 1;
  const base = `etape-${compteur}`;
  const rappels = el('div', { class: 'etape-rappels', id: `${base}-rappels` });
  const titre = el(niveauTitre, { class: 'etape-cuisine-titre', tabindex: '-1', id: `${base}-titre` });
  const quantites = el('ul', { class: 'etape-cuisine-quantites' });
  const aussi = el('p', { class: 'etape-cuisine-aussi' });
  const texte = el('p', { class: 'etape-cuisine-texte' });
  const pret = el('p', { class: 'etape-cuisine-pret' });
  const puces = el('p', { class: 'etape-cuisine-puces' });
  const conseils = el('div', { class: 'etape-cuisine-conseils' });
  const parts = el('div', { class: 'etape-cuisine-parts' });
  const pendant = el('p', { class: 'etape-cuisine-pendant' }, TEXTES_CUISINE.pendant);
  const noeud = el('article', { class: 'carte-etape-cuisine', 'aria-labelledby': titre.id },
    rappels, titre, quantites, aussi, texte, pret, puces, parts, conseils, pendant);
  let vue = null;

  /** Ce que demande une part mise de côté (consigne, ajouts), sous le texte de l'étape. */
  function partDetaillee(r) {
    if (!r.consigne && !r.ajouts?.length) return null;
    return el('div', { class: 'etape-part' },
      r.consigne ? el('p', { class: 'etape-rappel-consigne' }, r.consigne) : null,
      r.ajouts?.length ? el('ul', { class: 'etape-rappel-ajouts' }, r.ajouts.map((a) => el('li', {}, a))) : null);
  }

  function rappel(r, cases) {
    const morceaux = [el('p', { class: 'etape-rappel-texte' }, texteRappel(r.texte, r.genre, r.appareil))];
    if (r.genre === 'part') {
      if (r.case) {
        const input = el('input', { type: 'checkbox', 'data-cle': r.case.cle });
        input.checked = cases.has(r.case.cle);
        input.addEventListener('change', () => surCase(r.case.cle, input.checked));
        morceaux.push(el('label', { class: 'case-cuisine' }, input, el('span', {}, r.case.libelle)));
      }
    }
    return el('div', { class: `etape-rappel etape-rappel-${r.genre}` }, ...morceaux);
  }

  function maj(etape, { cases = new Set() } = {}) {
    const nouvelle = signature(etape, cases);
    if (nouvelle === vue) return;
    vue = nouvelle;
    // Le focus sur une case de la carte la retrouve après la mise à jour.
    const focus = noeud.contains(document.activeElement) ? document.activeElement.dataset?.cle ?? null : null;
    const liste = etape?.rappels ?? [];
    rappels.replaceChildren(...liste.map((r) => rappel(r, cases)));
    rappels.hidden = !liste.length;
    if (liste.length) titre.setAttribute('aria-describedby', rappels.id);
    else titre.removeAttribute('aria-describedby');
    const detailsParts = liste.filter((r) => r.genre === 'part').map(partDetaillee).filter(Boolean);
    parts.replaceChildren(...detailsParts);
    parts.hidden = !detailsParts.length;
    titre.textContent = etape?.titre ?? '';
    const qte = etape?.quantites ?? [];
    quantites.replaceChildren(...qte.map((q) => el('li', {}, q.texte)));
    quantites.hidden = !qte.length;
    const autres = etape?.aussi ?? [];
    aussi.textContent = autres.length ? TEXTES_CUISINE.etAussi(autres.join(', ')) : '';
    aussi.hidden = !autres.length;
    texte.textContent = etape?.texte ?? '';
    texte.hidden = !etape?.texte;
    pret.replaceChildren(...(etape?.pret ? avecPictogramme(TEXTES_CUISINE.pretQuand(etape.pret)) : []));
    pret.hidden = !etape?.pret;
    const lignes = [etape?.ligneDuree, etape?.ligneAppareil].filter(Boolean);
    puces.replaceChildren(...lignes.map((ligne) => el('span', { class: 'puce-cuisine' }, avecPictogramme(ligne))));
    puces.hidden = !lignes.length;
    const fixes = etape?.conseils ?? [];
    conseils.replaceChildren(...fixes.map((c) => el('p', {}, c)));
    conseils.hidden = !fixes.length;
    pendant.hidden = !etape?.pendant;
    if (focus) noeud.querySelector(`[data-cle="${CSS.escape(focus)}"]`)?.focus({ preventScroll: true });
  }

  return { noeud, titre, maj };
}
