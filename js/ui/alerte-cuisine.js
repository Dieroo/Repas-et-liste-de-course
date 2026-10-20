// Alerte « Ma cuisine » (2026-10-20, décision 27) d'une recette, sur la carte du plat de la semaine et sur la fiche :
// « 🍳 Il faut un siphon. Vous l’avez ? » avec « Je l’ai » et « Je ne l’ai pas » (un objet peu courant pas encore dit),
// ou « 🍳 Il faut un siphon : vous n’en avez pas. » (dit absent, rien qui le remplace). Rien pour un objet que la
// cuisine a, ni pour une recette sans objet peu courant. La réponse vaut pour toutes les recettes (actions.repondreCuisine,
// un seul chemin de `reglages/foyer`, annonce avec « Annuler »).
import { el, ecrireTexte } from './dom.js';
import { alerteDuPlat, libellesReponse, texteManquants, texteQuestion } from '../coeur/ma-cuisine.js';

// Identifiants des textes : une alerte par carte et une sur la fiche.
let compteur = 0;

/**
 * Bloc d'alerte, gardé d'un rendu à l'autre (le focus reste sur le bouton touché tant qu'il existe) → { noeud,
 * maj(plat, ctx, { changer }) }. `plat` : la fiche (null : rien) ; `changer` : la carte dit « Touchez le plat pour en
 * choisir un autre. » (plat qu'on peut encore changer). `apresReponse()` (facultatif) : où mettre le focus quand le
 * bloc disparaît après une réponse.
 */
export function creerAlerteCuisine({ apresReponse = null } = {}) {
  compteur += 1;
  const idTexte = `alerte-cuisine-${compteur}`;
  const texte = el('p', { class: 'alerte-cuisine-texte', id: idTexte, tabindex: '-1' });
  const oui = el('button', { class: 'bouton bouton-secondaire', type: 'button', 'data-cle': 'cuisine-oui' });
  const non = el('button', { class: 'bouton bouton-secondaire', type: 'button', 'data-cle': 'cuisine-non' });
  // Les deux réponses se lisent avec leur question (« Je l'ai » seul ne dit pas quoi).
  const boutons = el('div', { class: 'alerte-cuisine-boutons', role: 'group', 'aria-labelledby': idTexte }, oui, non);
  const noeud = el('div', { class: 'alerte-cuisine', hidden: true },
    el('span', { class: 'alerte-cuisine-emoji', 'aria-hidden': 'true' }, '🍳'),
    el('div', { class: 'alerte-cuisine-corps' }, texte, boutons));
  let courant = { plat: null, ctx: null, question: null };

  function repondre(valeur) {
    const { plat, ctx, question } = courant;
    if (!question || !ctx?.actions?.repondreCuisine) return;
    const avaitLeFocus = noeud.contains(document.activeElement);
    const resultat = ctx.actions.repondreCuisine(question, valeur);
    if (resultat?.code !== 'ok' || !avaitLeFocus) return;
    // L'écran est rendu à nouveau par l'action : une autre question prend le focus sur « Je l'ai », une phrase le prend
    // sur son texte ; sinon (plus rien à dire), l'écran choisit (la carte du plat).
    queueMicrotask(() => {
      if (!noeud.isConnected) return;
      if (noeud.hidden) apresReponse?.(plat);
      else if (!boutons.hidden) oui.focus();
      else texte.focus();
    });
  }
  oui.addEventListener('click', () => repondre(true));
  non.addEventListener('click', () => repondre(false));

  function maj(plat, ctx, { changer = false } = {}) {
    const alerte = plat ? alerteDuPlat(plat, ctx?.reglages ?? null) : null;
    courant = { plat, ctx, question: alerte && !alerte.manquants.length ? alerte.question : null };
    noeud.hidden = !alerte;
    if (!alerte) return;
    if (alerte.manquants.length) {
      ecrireTexte(texte, texteManquants(alerte.manquants, { changer }));
      boutons.hidden = true;
      return;
    }
    const libelles = libellesReponse(alerte.question);
    ecrireTexte(texte, texteQuestion(alerte.question));
    ecrireTexte(oui, libelles.oui);
    ecrireTexte(non, libelles.non);
    boutons.hidden = false;
  }

  return { noeud, maj };
}
