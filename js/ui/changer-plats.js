// Feuille « Changer des plats » (2026-10-18, demande du propriétaire après la première semaine de l'utilisatrice des
// courses), ouverte par « 🔄 Changer des plats » sous les plats de la semaine : on coche les plats qu'on ne veut pas,
// on choisit « Par quoi ? » (« Ce que l’app propose », ou « 🐟 Un plat de la mer » et son produit : « Peu importe »,
// « Saumon · 3 »…), puis « Remplacer 2 plats ». La feuille se ferme juste avant l'écriture (un lot,
// actions.changerDesPlats), l'annonce dit combien de plats ont changé, avec « Annuler » 10 s. Sans remplaçant, rien
// n'est écrit et la feuille le dit (« Pas d’autre plat au saumon pour l’instant. »). Rien n'est écrit à l'ouverture.
// Les produits proposés sont figés à l'ouverture (rien ne bouge sous le doigt) ; la liste des plats suit la semaine.
// La feuille se ferme d'elle-même si l'écran montre une autre semaine, ou s'il n'y a plus de plat à changer (courses
// faites sur l'autre téléphone : elle le dit). « Remplacer » est un simple bouton : Entrée sur une case ne remplace rien.
import { annoncer, el, ecrireTexte, reconcilier, vibrer } from './dom.js';
import { ouvrirFeuille } from './feuille.js';
import { RANGS_STATUT, lireSemaine, statutSemaine } from '../coeur/semaine.js';
import { TEXTES_PROPOSER, libelleChanger, libelleFamille, texteAucunChangement } from '../coeur/proposition.js';

const TEXTES = TEXTES_PROPOSER.changer;

// Une seule feuille à la fois ; l'écran Semaine la met à jour à chaque rendu (majChangerDesPlats).
let feuilleOuverte = null;
let numero = 0;

/** Met à jour la feuille ouverte (rendu de Semaine). */
export function majChangerDesPlats(ctx) {
  feuilleOuverte?.maj(ctx);
}

/** Plats changeables de la semaine montrée (actions de app.js) → [{ platId, nom }]. */
function changeablesDe(ctx, semaineId) {
  return ctx?.proposition?.changeables?.(semaineId) ?? [];
}

/**
 * Ouvre « Changer des plats » sur la semaine montrée. `onFermer(suite)` : `suite.viser` = premier plat arrivé (la carte
 * prend le focus) ; null sinon. `apresAnnulation(ancienId)` : passé à l'action (focus après « Annuler »).
 * → { maj(ctx), fermer } | null (pas de semaine lue, ou plus rien à changer).
 */
export function ouvrirChangerDesPlats(lireCtx, { onFermer, apresAnnulation = null } = {}) {
  if (feuilleOuverte) return feuilleOuverte;
  let courant = lireCtx();
  const semaineId = lireSemaine(courant?.semaine)?.id ?? null;
  if (!semaineId || !changeablesDe(courant, semaineId).length) return null;
  numero += 1;
  const nomQuoi = `changer-quoi-${numero}`;
  const nomProduit = `changer-produit-${numero}`;
  let ouverte = true;
  let suite = null;
  const coches = new Set();
  // Produits de la mer proposables, figés à l'ouverture.
  const mer = courant.proposition?.choixDeLaMer?.(semaineId) ?? { total: 0, familles: [] };

  // ——— Quels plats ? ———

  const liste = el('ul', { class: 'liste-choix' });
  const lignes = new WeakMap(); // li → { input, nom }

  function creerLigne(changeable) {
    const input = el('input', { class: 'case-choix', type: 'checkbox', 'data-plat': changeable.platId });
    input.addEventListener('change', () => {
      if (input.checked) coches.add(changeable.platId);
      else coches.delete(changeable.platId);
      dire(null);
      dessiner();
    });
    const nom = el('span', { class: 'choix-plat-nom' });
    const li = el('li', {}, el('label', { class: 'ligne-choix' }, input, el('span', { class: 'choix-plat-texte' }, nom)));
    lignes.set(li, { input, nom });
    majLigne(li, changeable);
    return li;
  }

  function majLigne(li, changeable) {
    const ligne = lignes.get(li);
    ecrireTexte(ligne.nom, changeable.nom);
    ligne.input.checked = coches.has(changeable.platId);
  }

  // ——— Par quoi ? ———

  const radioApp = el('input', { type: 'radio', name: nomQuoi, value: 'app', checked: true });
  const radioMer = el('input', { type: 'radio', name: nomQuoi, value: 'mer' });
  const radiosProduit = [
    { value: 'tout', texte: libelleFamille({ nom: TEXTES.peuImporte, nombre: mer.total }) },
    ...mer.familles.map((f) => ({ value: f.id, texte: libelleFamille(f) })),
  ].map(({ value, texte }, i) => {
    const input = el('input', { type: 'radio', name: nomProduit, value, checked: i === 0 });
    return { input, noeud: el('label', { class: 'choix' }, input, el('span', {}, texte)) };
  });
  const blocProduits = el('fieldset', { class: 'groupe-choix', hidden: true },
    el('legend', { class: 'etiquette-champ' }, TEXTES.produit),
    el('div', { class: 'choix-souple' }, radiosProduit.map((r) => r.noeud)),
    el('p', { class: 'aide' }, TEXTES.autrePlat));
  const blocQuoi = el('fieldset', { class: 'groupe-choix' },
    el('legend', { class: 'etiquette-champ' }, TEXTES.parQuoi),
    el('div', { class: 'choix-ligne' },
      el('label', { class: 'choix' }, radioApp, el('span', {}, TEXTES.app)),
      mer.total > 0
        ? el('label', { class: 'choix' }, radioMer, el('span', {}, el('span', { 'aria-hidden': 'true' }, `${TEXTES.merEmoji} `), TEXTES.mer))
        : null),
    mer.total > 0 ? null : el('p', { class: 'aide' }, `${TEXTES.sansMer} ${TEXTES.autrePlat}`));

  // ——— Bas de la feuille ———

  const libelle = el('span', {});
  const boutonRemplacer = el('button', { class: 'bouton bouton-principal bouton-plein', type: 'button', onclick: remplacer },
    el('span', { 'aria-hidden': 'true' }, TEXTES.emoji), libelle);
  const statut = el('p', { class: 'message-proposer', role: 'status', hidden: true });

  /** Choix de la mer : null (« Ce que l’app propose »), 'tout' ou l'id d'une famille. */
  function merChoisie() {
    if (!radioMer.checked) return null;
    return radiosProduit.find((r) => r.input.checked)?.input.value ?? 'tout';
  }

  function dire(texte) {
    ecrireTexte(statut, texte ?? '');
    statut.hidden = !texte;
  }

  function dessiner() {
    ecrireTexte(libelle, libelleChanger(coches.size));
    if (coches.size) boutonRemplacer.removeAttribute('aria-disabled');
    else boutonRemplacer.setAttribute('aria-disabled', 'true');
    blocProduits.hidden = !radioMer.checked;
  }

  function fermer() {
    if (ouverte) feuille.fermer();
  }

  function remplacer(evenement) {
    evenement?.preventDefault();
    if (!coches.size) {
      dire(TEXTES.aucunCoche);
      return;
    }
    dire(null);
    const choix = merChoisie();
    const resultat = courant.actions?.changerDesPlats?.([...coches], {
      semaineId,
      mer: choix,
      apresAnnulation,
      avant: (premier) => {
        suite = premier ? { viser: premier } : null;
        fermer();
      },
    });
    if (resultat?.code === 'ok') {
      vibrer();
      return;
    }
    if (!ouverte) return;
    if (resultat?.code === 'aucune') dire(texteAucunChangement(choix));
    else if (resultat?.code === 'faites' || resultat?.code === 'invalide') fermer();
  }

  function majListe() {
    const lue = lireSemaine(courant?.semaine);
    // L'écran montre une autre semaine (dates changées, semaine suivante remplie sur l'autre téléphone) : la feuille,
    // qui changerait des plats qu'on ne voit plus, se ferme.
    if (lue?.id !== semaineId) {
      fermer();
      return;
    }
    const changeables = changeablesDe(courant, semaineId);
    if (!changeables.length) {
      const faites = RANGS_STATUT[statutSemaine(lue)] >= RANGS_STATUT.courses_faites;
      fermer();
      if (faites) annoncer(TEXTES.faites);
      return;
    }
    const presents = new Set(changeables.map((c) => c.platId));
    for (const platId of [...coches]) if (!presents.has(platId)) coches.delete(platId);
    reconcilier(liste, changeables, { cle: (c) => c.platId, creer: creerLigne, maj: majLigne });
  }

  const feuille = ouvrirFeuille(TEXTES.titre, () => el('form', {
    class: 'formulaire feuille-changer',
    novalidate: true,
    onsubmit: (evenement) => evenement.preventDefault(),
    onchange: (evenement) => {
      if (evenement.target?.name === nomQuoi || evenement.target?.name === nomProduit) {
        dire(null);
        dessiner();
      }
    },
  },
  el('fieldset', { class: 'groupe-choix' },
    el('legend', { class: 'etiquette-champ' }, TEXTES.quels),
    liste),
  blocQuoi,
  blocProduits,
  el('div', { class: 'actions-feuille' },
    boutonRemplacer,
    statut,
    el('button', { class: 'bouton bouton-texte', type: 'button', onclick: () => fermer() }, TEXTES.fermer))), {
    onFermer: () => {
      ouverte = false;
      if (feuilleOuverte === handle) feuilleOuverte = null;
      onFermer?.(suite);
    },
  });

  const handle = {
    maj(ctx) {
      if (!ouverte) return;
      courant = ctx;
      majListe();
      if (ouverte) dessiner();
    },
    fermer,
  };
  feuilleOuverte = handle;
  majListe();
  dessiner();
  return handle;
}
