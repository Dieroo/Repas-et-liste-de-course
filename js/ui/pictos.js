// Pictogrammes des appareils de cuisson (CLAUDE.md §4), dessinés pour l'app au trait, comme les icônes des onglets.
// Toujours accompagnés du nom de l'appareil : le dessin est décoratif (aria-hidden).
import { el } from './dom.js';
import { APPAREILS, cuissonPrincipale } from '../coeur/plats.js';

const NS = 'http://www.w3.org/2000/svg';

// Formes de chaque pictogramme (viewBox 24 × 24), silhouettes bien distinctes à petite taille.
const FORMES = {
  // Casserole à manche sur trois petites flammes.
  plaque: [
    ['path', { d: 'M3 4.5h14V10a4 4 0 0 1-4 4H7a4 4 0 0 1-4-4V4.5Z' }],
    ['path', { d: 'M17 6.5h4.5' }],
    ['path', { d: 'M6 21.5c-1.4-1-1.4-3 0-4.4 1.4 1.4 1.4 3.4 0 4.4Z' }],
    ['path', { d: 'M10 21.5c-1.4-1-1.4-3 0-4.4 1.4 1.4 1.4 3.4 0 4.4Z' }],
    ['path', { d: 'M14 21.5c-1.4-1-1.4-3 0-4.4 1.4 1.4 1.4 3.4 0 4.4Z' }],
  ],
  // Façade : bandeau à deux boutons, porte à hublot.
  four: [
    ['rect', { x: '3.5', y: '3.5', width: '17', height: '17', rx: '2.5' }],
    ['path', { d: 'M3.5 8h17' }],
    ['circle', { cx: '7', cy: '5.75', r: '.6' }],
    ['circle', { cx: '10', cy: '5.75', r: '.6' }],
    ['rect', { x: '7', y: '11', width: '10', height: '6.5', rx: '1.5' }],
  ],
  // Multicuiseur : cuve basse, couvercle bombé, soupape, petit écran.
  cookeo: [
    ['path', { d: 'M4.5 12.5h15v5a2.5 2.5 0 0 1-2.5 2.5H7a2.5 2.5 0 0 1-2.5-2.5v-5Z' }],
    ['path', { d: 'M3.5 12.5c0-3.9 3.8-6.5 8.5-6.5s8.5 2.6 8.5 6.5' }],
    ['path', { d: 'M12 6V3.5M10.5 3.5h3' }],
    ['rect', { x: '10', y: '14.75', width: '4', height: '2.5', rx: '.8' }],
  ],
  // Friteuse à air : appareil haut et arrondi, tiroir-panier, poignée en bas.
  airfryer: [
    ['path', { d: 'M6 20.5V9a6 6 0 0 1 6-6 6 6 0 0 1 6 6v11.5H6Z' }],
    ['path', { d: 'M6 13.5h12' }],
    ['path', { d: 'M9.5 17h5' }],
    ['circle', { cx: '12', cy: '8.5', r: '1.5' }],
  ],
  // Robot cuiseur : bocal haut à poignée, posé sur un socle à molette.
  monsieur_cuisine: [
    ['path', { d: 'M3.5 21h17l-1.5-5h-14l-1.5 5Z' }],
    ['circle', { cx: '12', cy: '18.5', r: '1.2' }],
    ['path', { d: 'M7.5 16 6.8 6h10.4l-.7 10' }],
    ['path', { d: 'M8 6V4h8v2' }],
    ['path', { d: 'M17.1 8h1.4a1 1 0 0 1 1 1v3.5a1 1 0 0 1-1 1h-1.7' }],
  ],
};

/** Pictogramme d'un appareil (SVG décoratif), ou null si l'appareil est inconnu. */
export function pictogramme(appareil, classe = 'picto') {
  if (!Object.hasOwn(FORMES, appareil ?? '')) return null;
  const formes = FORMES[appareil];
  const svg = document.createElementNS(NS, 'svg');
  for (const [nom, valeur] of Object.entries({ viewBox: '0 0 24 24', class: classe, 'aria-hidden': 'true', focusable: 'false' })) {
    svg.setAttribute(nom, valeur);
  }
  for (const [balise, attributs] of formes) {
    const forme = document.createElementNS(NS, balise);
    for (const [nom, valeur] of Object.entries(attributs)) forme.setAttribute(nom, valeur);
    svg.append(forme);
  }
  return svg;
}

/**
 * Mode de cuisson principal d'un plat : pictogramme suivi du nom de l'appareil (« Four »), et de la durée si demandé
 * (« Cookeo · 15 min »). → élément, ou null si le plat n'a pas de cuisson connue.
 */
export function modeDeCuisson(plat, { duree = false, classe = 'mode-cuisson' } = {}) {
  const principale = cuissonPrincipale(plat);
  if (!principale) return null;
  const texte = duree && principale.dureeMin > 0
    ? `${APPAREILS[principale.appareil]} · ${principale.dureeMin}\u00A0min`
    : APPAREILS[principale.appareil];
  return el('span', { class: classe }, pictogramme(principale.appareil), texte);
}
