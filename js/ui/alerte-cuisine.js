// Alerte « Ma cuisine » (2026-10-20, décision 27) d'une recette, sur la carte du plat de la semaine et sur la fiche :
// « 🍳 Il faut un siphon. Vous l’avez ? » avec « Je l’ai » et « Je ne l’ai pas » (un objet peu courant pas encore dit ;
// « Pas de mixeur plongeant. Vous avez un blender ? » pour un objet qui remplacerait un objet dit absent), ou « 🍳 Il
// faut un siphon : vous n’en avez pas. » et « Changer dans Ma cuisine › » (dit absent, rien qui le remplace). Rien pour
// un objet que la cuisine a, ni pour une recette sans objet peu courant. La réponse vaut pour toutes les recettes
// (actions.repondreCuisine, un seul chemin de `reglages/foyer`, annonce avec « Annuler » ; un second toucher impatient
// est ignoré : la question suivante, ou la carte suivante, arrive sous le doigt).
import { el, ecrireTexte } from './dom.js';
import { alerteDuPlat, libellesReponse, texteManquants, texteQuestion } from '../coeur/ma-cuisine.js';

// Identifiants des textes : une alerte par carte et une sur la fiche.
let compteur = 0;

/**
 * Bloc d'alerte, gardé d'un rendu à l'autre (le focus reste sur le bouton touché tant qu'il existe) → { noeud,
 * maj(plat, ctx, { changer }) }. `plat` : la fiche (null : rien) ; `changer()` (facultatif, appelé seulement quand un
 * objet manque) : vrai si le plat peut encore être changé (la carte dit « Touchez le plat pour en choisir un autre. »).
 * `apresReponse(plat)` : où mettre le focus quand le bloc disparaît (réponse, « Annuler », l'autre téléphone).
 */
export function creerAlerteCuisine({ apresReponse = null } = {}) {
  compteur += 1;
  const idTexte = `alerte-cuisine-${compteur}`;
  const texte = el('p', { class: 'alerte-cuisine-texte', id: idTexte, tabindex: '-1' });
  const oui = el('button', { class: 'bouton bouton-secondaire', type: 'button', 'data-cle': 'cuisine-oui' });
  const non = el('button', { class: 'bouton bouton-secondaire', type: 'button', 'data-cle': 'cuisine-non' });
  // Les deux réponses se lisent avec leur question (« Je l'ai » seul ne dit pas quoi).
  const boutons = el('div', { class: 'alerte-cuisine-boutons', role: 'group', 'aria-labelledby': idTexte }, oui, non);
  const lien = el('a', { class: 'lien-cuisine', href: '#/ma-cuisine', hidden: true }, 'Changer dans Ma cuisine\u00A0›');
  const noeud = el('div', { class: 'alerte-cuisine', hidden: true },
    el('span', { class: 'alerte-cuisine-emoji', 'aria-hidden': 'true' }, '🍳'),
    el('div', { class: 'alerte-cuisine-corps' }, texte, boutons, lien));
  let courant = { plat: null, ctx: null, question: null };

  /** Focus après un changement du bloc : la nouvelle question ou la phrase se lisent ; plus rien : l'écran choisit. */
  function placerLeFocus() {
    if (!noeud.isConnected) return;
    if (noeud.hidden) apresReponse?.(courant.plat);
    else texte.focus();
  }

  function repondre(valeur) {
    const { ctx, question } = courant;
    if (!question || !ctx?.actions?.repondreCuisine) return;
    const avaitLeFocus = noeud.contains(document.activeElement);
    const resultat = ctx.actions.repondreCuisine(question, valeur, { garde: true, apresAnnulation: placerLeFocus });
    // L'écran est rendu à nouveau par l'action (synchrone) : le focus suit, une fois le rendu fini.
    if (resultat?.code === 'ok' && avaitLeFocus) queueMicrotask(placerLeFocus);
  }
  oui.addEventListener('click', () => repondre(true));
  non.addEventListener('click', () => repondre(false));

  function maj(plat, ctx, { changer = null } = {}) {
    const avaitLeFocus = noeud.contains(document.activeElement);
    const focusSurUnBouton = avaitLeFocus && boutons.contains(document.activeElement);
    const alerte = plat ? alerteDuPlat(plat, ctx?.reglages ?? null) : null;
    const question = alerte && !alerte.manquants.length ? alerte.question : null;
    const avant = courant.question;
    courant = { plat, ctx, question };
    noeud.hidden = !alerte;
    if (alerte) {
      if (alerte.manquants.length) {
        ecrireTexte(texte, texteManquants(alerte.manquants, { changer: typeof changer === 'function' && Boolean(changer()) }));
        boutons.hidden = true;
        lien.hidden = false;
      } else {
        const libelles = libellesReponse(question);
        ecrireTexte(texte, texteQuestion(question, alerte.pour));
        ecrireTexte(oui, libelles.oui);
        ecrireTexte(non, libelles.non);
        boutons.hidden = false;
        lien.hidden = true;
      }
    }
    // Réponse venue de l'autre téléphone pendant que le focus était ici : il n'est jamais perdu.
    if (avaitLeFocus && (noeud.hidden || (focusSurUnBouton && (boutons.hidden || question !== avant)))) queueMicrotask(placerLeFocus);
  }

  return { noeud, maj };
}
