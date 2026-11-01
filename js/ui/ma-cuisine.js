// Écran « 🍳 Ma cuisine » (`#/ma-cuisine`, 2026-10-20, les deux rôles, aperçu compris) : ce que la cuisine du foyer a.
// « Vos recettes demandent » (objets peu courants que des recettes du foyer utilisent, avec « Pour : … »), « Pour
// cuire » (les cinq appareils de cuisson), « Autres objets » (replié), « Mes plats et moules » (liste libre). Deux
// réponses par objet, « Je l’ai » et « Je ne l’ai pas » (boutons à bascule) ; chaque toucher écrit un seul chemin de
// `reglages/foyer` (actions.repondreCuisine, sans annonce ici : le bouton enfoncé le dit), hors ligne compris. Rien
// n'est écrit à l'ouverture.
// Les listes ne sont redessinées que si leur contenu change (signature) ; le focus est retrouvé par `data-cle`. Le
// champ d'ajout n'est jamais redessiné (la saisie reste).
import { el, enteteVue } from './dom.js';
import {
  ERREURS_PLAT_ET_MOULE, PLAT_ET_MOULE_MAX, TEXTES_MA_CUISINE, libellesReponse, lignesMaCuisine, textePour,
} from '../coeur/ma-cuisine.js';

/** Ligne d'un objet : son nom, « Pour : … », puis « Je l'ai » et « Je ne l'ai pas » (aria-pressed). */
function ligneObjet(ligne, repondre) {
  const idNom = `objet-${ligne.id}`;
  const libelles = libellesReponse(ligne.id);
  const bouton = (valeur, libelle) => el('button', {
    class: `bouton bouton-reponse${ligne.etat === (valeur ? 'oui' : 'non') ? ' bouton-reponse-choisie' : ''}`,
    type: 'button',
    'aria-pressed': String(ligne.etat === (valeur ? 'oui' : 'non')),
    'data-cle': `${valeur ? 'oui' : 'non'}:${ligne.id}`,
    onclick: () => repondre(ligne.id, valeur),
  }, libelle);
  const pour = textePour(ligne.pour);
  return el('li', { class: 'objet-cuisine' },
    el('p', { class: 'objet-cuisine-nom', id: idNom }, ligne.nom),
    pour ? el('p', { class: 'aide objet-cuisine-pour' }, pour) : null,
    el('div', { class: 'objet-cuisine-reponses', role: 'group', 'aria-labelledby': idNom },
      bouton(true, libelles.oui), bouton(false, libelles.non)));
}

export function creer(ctx) {
  let courant = ctx;
  const gestionnaire = ctx.role === 'gestionnaire';

  const listeDemandes = el('ul', { class: 'liste-objets' });
  const videDemandes = el('p', { class: 'texte-doux', hidden: true }, TEXTES_MA_CUISINE.demandesVide);
  const listeCuire = el('ul', { class: 'liste-objets' });
  const listeAutres = el('ul', { class: 'liste-objets' });
  const autres = el('details', { class: 'carte details-objets' },
    el('summary', {}, el('h2', {}, TEXTES_MA_CUISINE.autres)),
    el('p', { class: 'aide' }, TEXTES_MA_CUISINE.autresAide),
    listeAutres);

  // « Mes plats et moules » : la liste (redessinée) et le formulaire d'ajout (jamais redessiné).
  const listePlatsEtMoules = el('ul', { class: 'liste-plats-moules' });
  const videPlatsEtMoules = el('p', { class: 'texte-doux', hidden: true }, TEXTES_MA_CUISINE.platsEtMoulesVide);
  const erreur = el('p', { class: 'message-erreur', id: 'plat-moule-erreur', role: 'alert', hidden: true });
  const champ = el('input', {
    class: 'champ',
    id: 'plat-moule',
    name: 'plat-moule',
    maxlength: PLAT_ET_MOULE_MAX,
    autocomplete: 'off',
    enterkeyhint: 'done',
    'aria-describedby': 'plat-moule-aide',
    oninput: () => {
      erreur.hidden = true;
      champ.removeAttribute('aria-invalid');
    },
  });
  const formulaire = el('form', {
    class: 'formulaire formulaire-plat-moule',
    novalidate: true,
    onsubmit: (evenement) => {
      evenement.preventDefault();
      const resultat = courant.actions?.ajouterPlatEtMoule?.(champ.value);
      // Seule une saisie refusée se dit sous le champ (un échec d'envoi est annoncé par l'app).
      if (!resultat || (resultat.code !== 'ok' && resultat.code !== 'erreur')) return;
      if (resultat.code === 'erreur') {
        erreur.textContent = resultat.message ?? ERREURS_PLAT_ET_MOULE.vide;
        erreur.hidden = false;
        champ.setAttribute('aria-invalid', 'true');
        champ.setAttribute('aria-describedby', 'plat-moule-aide plat-moule-erreur');
        champ.focus();
        return;
      }
      champ.value = '';
      champ.setAttribute('aria-describedby', 'plat-moule-aide');
      champ.focus();
    },
  },
  el('label', { class: 'etiquette-champ', for: 'plat-moule' }, TEXTES_MA_CUISINE.champ),
  el('div', { class: 'champ-et-bouton' },
    champ,
    el('button', { class: 'bouton bouton-secondaire', type: 'submit' }, TEXTES_MA_CUISINE.ajouter)),
  erreur);

  const titre = el('h1', { tabindex: '-1' }, TEXTES_MA_CUISINE.titre);
  const noeud = el('div', { class: 'vue vue-ma-cuisine' },
    el('header', { class: 'vue-entete' }, titre,
      el('p', { class: 'sous-titre' }, gestionnaire ? TEXTES_MA_CUISINE.intro : TEXTES_MA_CUISINE.introCourses)),
    el('section', { class: 'carte', 'aria-labelledby': 'cuisine-demandes' },
      el('h2', { id: 'cuisine-demandes' }, TEXTES_MA_CUISINE.demandes), videDemandes, listeDemandes),
    el('section', { class: 'carte', 'aria-labelledby': 'cuisine-cuire' },
      el('h2', { id: 'cuisine-cuire' }, TEXTES_MA_CUISINE.cuire), listeCuire),
    autres,
    el('section', { class: 'carte', 'aria-labelledby': 'cuisine-plats-moules' },
      el('h2', { id: 'cuisine-plats-moules' }, TEXTES_MA_CUISINE.platsEtMoules),
      el('p', { class: 'aide', id: 'plat-moule-aide' }, TEXTES_MA_CUISINE.platsEtMoulesAide),
      videPlatsEtMoules, listePlatsEtMoules, formulaire),
  );

  const repondre = (id, valeur) => courant.actions?.repondreCuisine?.(id, valeur, { annonce: false });

  /** Retrait d'un plat ou d'un moule ; le focus passe à la ligne voisine, sinon au champ. */
  function retirer(id) {
    const lignes = [...listePlatsEtMoules.querySelectorAll('[data-cle^="retirer:"]')];
    const i = lignes.findIndex((n) => n.dataset.cle === `retirer:${id}`);
    const voisine = (lignes[i + 1] ?? lignes[i - 1])?.dataset.cle ?? null;
    const resultat = courant.actions?.retirerPlatEtMoule?.(id, { apresAnnulation: () => champ.focus() });
    if (resultat?.code !== 'ok') return;
    const cible = voisine ? listePlatsEtMoules.querySelector(`[data-cle="${CSS.escape(voisine)}"]`) : null;
    (cible ?? champ).focus();
  }

  let signature = '';
  function maj(nouveau) {
    courant = nouveau;
    const lignes = lignesMaCuisine(courant.reglages ?? null, courant.plats ?? []);
    const suivante = JSON.stringify(lignes);
    if (suivante === signature) return;
    signature = suivante;
    const focus = noeud.contains(document.activeElement) ? document.activeElement?.dataset?.cle ?? null : null;
    listeDemandes.replaceChildren(...lignes.demandes.map((l) => ligneObjet(l, repondre)));
    videDemandes.hidden = lignes.demandes.length > 0;
    listeDemandes.hidden = !lignes.demandes.length;
    listeCuire.replaceChildren(...lignes.cuire.map((l) => ligneObjet(l, repondre)));
    listeAutres.replaceChildren(...lignes.autres.map((l) => ligneObjet(l, repondre)));
    listePlatsEtMoules.replaceChildren(...lignes.platsEtMoules.map(({ id, nom }) => el('li', { class: 'plat-moule' },
      el('span', {}, nom),
      el('button', {
        class: 'bouton bouton-texte',
        type: 'button',
        'data-cle': `retirer:${id}`,
        'aria-label': `Retirer «\u00A0${nom}\u00A0»`,
        onclick: () => retirer(id),
      }, TEXTES_MA_CUISINE.retirer))));
    videPlatsEtMoules.hidden = lignes.platsEtMoules.length > 0;
    listePlatsEtMoules.hidden = !lignes.platsEtMoules.length;
    if (focus) noeud.querySelector(`[data-cle="${CSS.escape(focus)}"]`)?.focus();
  }

  maj(ctx);
  return { noeud, maj };
}
