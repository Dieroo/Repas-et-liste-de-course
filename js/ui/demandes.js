// Écran Demandes (`#/demandes`, gestionnaire hors aperçu « Repas et courses », T2e) : les recettes et les versions
// demandées dans l'app et encore utiles (`ctx.aTraiter`, coeur/demandes.js › demandesATraiter), rangées par sorte
// (grouperDemandes). Chaque plat ouvre sa fiche, où « Demander à Claude » existe déjà ; « Retirer la demande » pour une
// demande que l'on ne traitera pas (annonce avec « Annuler ») ; pour les versions d'une personne, un seul « 📋 Demander
// à Claude ces 3 versions », puis « Coller la réponse de Claude ». Une demande se ferme d'elle-même quand la recette ou
// la version arrive : l'écran finit sur « Aucune demande ».
// La liste n'est redessinée que si son contenu change (signature) ; le focus est retrouvé par `data-cle`, et une ligne
// qui disparaît pendant qu'elle a le focus le passe au lien de la ligne suivante, sinon de la précédente, sinon au
// titre (ou à « Aucune demande »).
import { el, etatVide } from './dom.js';
import { ouvrirSurNotifications } from './reglages.js';
import { copier } from './presse-papiers.js';
import { vignetteDuPlat } from './plats.js';
import { nomDe } from './compat.js';
import { grouperDemandes, texteDemandee } from '../coeur/demandes.js';
import { LOT_VERSIONS, texteDemandeVariantes } from '../coeur/claude.js';
import { sujetValide } from '../coeur/ntfy.js';
import { visuelDuPlat } from '../coeur/plats.js';

const MESSAGE_COPIE = 'Copié. Collez-le dans votre projet Claude, puis revenez ici et touchez «\u00A0Coller la réponse de Claude\u00A0».';
const MESSAGE_ECHEC_COPIE = 'La copie n’a pas marché. Réessayez.';

/** « Demander à Claude cette version », « … ces 3 versions », au-delà d'un lot « … les 10 premières ». */
function libelleCopie(nombre) {
  if (nombre > LOT_VERSIONS) return `Demander à Claude les ${LOT_VERSIONS}\u00A0premières`;
  return nombre > 1 ? `Demander à Claude ces ${nombre}\u00A0versions` : 'Demander à Claude cette version';
}

/** Vrai quand demandes, plats et profils sont lus : avant, `ctx.aTraiter` est vide sans que rien ne soit traité. */
const charge = (ctx) => Boolean(ctx.demandesChargees && ctx.platsCharges && ctx.profilsCharges);

/**
 * Ce que l'écran montre, en données simples : sa signature (JSON) dit si la liste doit être redessinée.
 * → { chargement: true } | { total, recettes: [ligne], versions: [{ profilId, nom, lignes: [ligne] }] }
 * ligne : { id (de la demande), platId, nom, visuel (emoji et teinte), vignette, texte (« Demandée par Adulte B le
 * 8 octobre. ») }. `plats` (Map identifiant de la demande → fiche) reçoit les fiches, pour leur vignette.
 */
function modele(ctx, plats) {
  if (!charge(ctx)) return { chargement: true };
  const { recettes, versions } = grouperDemandes(Array.isArray(ctx.aTraiter) ? ctx.aTraiter : []);
  const options = {
    profils: ctx.profils ?? [],
    moi: ctx.utilisateur?.email ?? ctx.moi,
    avecAuteur: true,
    horsLigne: !navigator.onLine,
  };
  const ligne = ({ demande, plat }) => {
    plats.set(demande.id, plat);
    return {
      id: demande.id,
      platId: plat.id,
      nom: String(plat.nom ?? ''),
      visuel: visuelDuPlat(plat),
      vignette: plat.vignette ?? '',
      texte: texteDemandee(demande, options),
    };
  };
  const groupes = versions.map(({ profil, elements }) => ({ profilId: profil.id, nom: nomDe(profil), lignes: elements.map(ligne) }));
  const lignesRecettes = recettes.map(ligne);
  return {
    total: lignesRecettes.length + groupes.reduce((somme, groupe) => somme + groupe.lignes.length, 0),
    recettes: lignesRecettes,
    versions: groupes,
  };
}

export function creer(ctx) {
  let courant = ctx;
  let signature = '';
  let ordre = []; // identifiants des demandes affichées, dans l'ordre de l'écran
  // Copie des versions d'une personne : { copie, message } par profil, gardé d'un dessin à l'autre (« Coller la
  // réponse de Claude » devient l'action principale après une copie réussie).
  const copies = new Map();
  // Nœuds de chaque groupe de versions affiché : { message, boutonCopier, lienColler } par profil.
  const groupesAffiches = new Map();
  let plats = new Map(); // identifiant de la demande → fiche du plat (vignette), relue à chaque mise à jour

  const titre = el('h1', { tabindex: '-1' }, 'Demandes');
  const sousTitre = el('p', { class: 'sous-titre', hidden: true });
  const lienNotifications = el('a', {
    class: 'lien-fiche lien-notifications', href: '#/reglages', hidden: true, onclick: () => ouvrirSurNotifications(),
  },
    el('span', { 'aria-hidden': 'true' }, '🔔\u00A0'), 'Être prévenu sur votre téléphone ›');
  const contenu = el('div', { class: 'contenu-demandes' });

  // Venu de Semaine (carte 📬) : retour dans l'historique, pour que le geste retour d'Android reste naturel.
  const retour = el('a', {
    class: 'retour',
    href: '#/semaine',
    onclick: (evenement) => {
      if (courant.routePrecedente === 'semaine' && history.length > 1) {
        evenement.preventDefault();
        history.back();
      }
    },
  }, el('span', { 'aria-hidden': 'true' }, '‹'), 'Semaine');

  /** « Retirer la demande » : l'app la passe traitée et redessine (la ligne disparaît, le focus va à sa voisine). */
  function retirer(id) {
    courant.actions?.retirerDemande?.(id, {
      // « Annuler » : la ligne revient, et son bouton « Retirer la demande » reprend le focus.
      apresAnnulation: () => contenu.querySelector(`[data-cle="${CSS.escape(`retirer:${id}`)}"]`)?.focus(),
    });
  }

  /**
   * « 📋 Demander à Claude ces 3 versions » : DEMANDE-VARIANTES des plats demandés pour cette personne (LOT_VERSIONS
   * au plus), calculé dans le toucher, avant toute attente (la copie de repli reste permise) ; les plats copiés sont
   * notés comme envoyés (le bandeau de Plats propose ensuite les suivants).
   */
  async function copierVersions(profilId) {
    const groupe = grouperDemandes(Array.isArray(courant.aTraiter) ? courant.aTraiter : [])
      .versions.find((g) => g.profil.id === profilId);
    if (!groupe) return;
    const lot = groupe.elements.slice(0, LOT_VERSIONS).map((element) => element.plat);
    const actions = courant.actions;
    const reussi = await copier(texteDemandeVariantes(lot, groupe.profil));
    const etat = copies.get(profilId) ?? { copie: false, message: '' };
    if (reussi) {
      etat.copie = true;
      etat.message = MESSAGE_COPIE;
      actions?.noterEnvoyes?.(lot.map((plat) => plat.id));
    } else {
      etat.message = MESSAGE_ECHEC_COPIE;
    }
    copies.set(profilId, etat);
    majGroupe(profilId);
  }

  /** Avant la copie, l'action principale est « Demander à Claude » ; ensuite, « Coller la réponse de Claude ». */
  function majGroupe(profilId) {
    const noeuds = groupesAffiches.get(profilId);
    if (!noeuds) return;
    const { copie = false, message = '' } = copies.get(profilId) ?? {};
    noeuds.boutonCopier.className = `bouton bouton-plein ${copie ? 'bouton-secondaire' : 'bouton-principal'}`;
    noeuds.lienColler.className = `bouton bouton-plein ${copie ? 'bouton-principal' : 'bouton-secondaire'}`;
    if (noeuds.message.textContent !== message) noeuds.message.textContent = message;
    noeuds.message.hidden = !message;
  }

  /** Une demande : le plat (lien vers sa fiche), qui l'a demandée et quand, puis « Retirer la demande ». */
  function ligneDemande(ligne) {
    const plat = plats.get(ligne.id) ?? { id: ligne.platId, nom: ligne.nom };
    return el('li', { class: 'ligne-demande', 'data-demande': ligne.id },
      el('a', { class: 'carte-plat', href: `#/plat/${encodeURIComponent(ligne.platId)}`, 'data-cle': `fiche:${ligne.id}` },
        vignetteDuPlat(plat),
        el('span', { class: 'carte-plat-texte' },
          el('span', { class: 'carte-plat-nom' }, ligne.nom),
          el('span', { class: 'carte-plat-detail' }, ligne.texte)),
        el('span', { class: 'chevron', 'aria-hidden': 'true' }, '›')),
      el('button', {
        class: 'bouton bouton-texte bouton-retirer-demande',
        type: 'button',
        'data-cle': `retirer:${ligne.id}`,
        'aria-label': `Retirer la demande\u00A0: ${ligne.nom}`,
        onclick: () => retirer(ligne.id),
      }, 'Retirer la demande'));
  }

  /** « Versions pour Adulte B » : ses demandes, puis la copie pour Claude et « Coller la réponse de Claude ». */
  function groupeVersions({ profilId, nom, lignes }) {
    const idTitre = `titre-versions-${profilId}`;
    const message = el('p', { class: 'aide', role: 'status' });
    const boutonCopier = el('button', {
      class: 'bouton bouton-plein bouton-principal',
      type: 'button',
      'data-cle': `copier:${profilId}`,
      onclick: () => copierVersions(profilId),
    }, el('span', { 'aria-hidden': 'true' }, '📋'), libelleCopie(lignes.length));
    const lienColler = el('a', { class: 'bouton bouton-plein bouton-secondaire', href: '#/import', 'data-cle': `coller:${profilId}` },
      'Coller la réponse de Claude');
    groupesAffiches.set(profilId, { message, boutonCopier, lienColler });
    majGroupe(profilId);
    return el('section', { class: 'section groupe-demandes', 'aria-labelledby': idTitre },
      el('h2', { id: idTitre }, `Versions pour ${nom}`),
      el('ul', { class: 'liste-demandes' }, lignes.map(ligneDemande)),
      message,
      el('div', { class: 'actions-recette' }, boutonCopier, lienColler));
  }

  function dessiner(m) {
    groupesAffiches.clear();
    if (m.chargement) {
      ordre = [];
      contenu.replaceChildren(el('p', { class: 'texte-doux', role: 'status' }, 'Chargement…'));
      return;
    }
    // Copies des personnes qui n'ont plus de demande : oubliées.
    for (const profilId of [...copies.keys()]) {
      if (!m.versions.some((groupe) => groupe.profilId === profilId)) copies.delete(profilId);
    }
    ordre = [...m.recettes, ...m.versions.flatMap((groupe) => groupe.lignes)].map((ligne) => ligne.id);
    if (!m.total) {
      const vide = etatVide({
        emoji: '🎉',
        teinte: 'olive',
        titre: 'Aucune demande',
        texte: 'Les recettes et les versions demandées dans l’app arrivent ici.',
      });
      vide.querySelector('h2')?.setAttribute('tabindex', '-1');
      contenu.replaceChildren(vide);
      return;
    }
    contenu.replaceChildren(...[
      m.recettes.length
        ? el('section', { class: 'section groupe-demandes', 'aria-labelledby': 'titre-recettes-demandees' },
          el('h2', { id: 'titre-recettes-demandees' }, 'Recettes à ajouter'),
          el('ul', { class: 'liste-demandes' }, m.recettes.map(ligneDemande)),
          el('p', { class: 'aide' }, 'Ouvrez le plat pour demander sa recette à Claude.'))
        : null,
      ...m.versions.map(groupeVersions),
    ].filter(Boolean));
  }

  /**
   * Focus après un nouveau dessin : le même élément (`data-cle`) s'il existe encore ; sinon, si sa ligne a disparu, le
   * lien de la ligne suivante, sinon de la précédente ; sinon « Aucune demande », ou le titre.
   */
  function rendreLeFocus({ cle, demande, ordreAvant }) {
    const parCle = (valeur) => contenu.querySelector(`[data-cle="${CSS.escape(valeur)}"]`);
    const meme = cle ? parCle(cle) : null;
    if (meme) {
      meme.focus({ preventScroll: true });
      return;
    }
    const position = demande ? ordreAvant.indexOf(demande) : -1;
    if (position >= 0) {
      const restants = new Set(ordre);
      const voisine = ordreAvant.slice(position + 1).find((id) => restants.has(id))
        ?? ordreAvant.slice(0, position).reverse().find((id) => restants.has(id));
      if (voisine) {
        parCle(`fiche:${voisine}`)?.focus();
        return;
      }
    }
    (contenu.querySelector('.etat-vide h2') ?? titre).focus();
  }

  function maj(nouveau) {
    courant = nouveau;
    plats = new Map();
    const m = modele(nouveau, plats);
    const n = m.chargement ? 0 : m.total;
    const texteSousTitre = n ? `${n}\u00A0à traiter` : '';
    if (sousTitre.textContent !== texteSousTitre) sousTitre.textContent = texteSousTitre;
    sousTitre.hidden = !texteSousTitre;
    // Sans sujet ntfy valide : « 🔔 Être prévenu sur votre téléphone › », vers la carte « 🔔 Notifications » de Réglages.
    lienNotifications.hidden = sujetValide(nouveau.reglages?.notifications?.ntfySujet);

    const nouvelle = JSON.stringify(m);
    if (nouvelle === signature) return;
    signature = nouvelle;
    const actif = contenu.contains(document.activeElement) ? document.activeElement : null;
    const avant = {
      cle: actif?.dataset?.cle ?? null,
      demande: actif?.closest?.('.ligne-demande')?.dataset.demande ?? null,
      ordreAvant: ordre,
    };
    dessiner(m);
    if (actif) rendreLeFocus(avant);
  }

  maj(ctx);

  return {
    noeud: el('div', { class: 'vue demandes' },
      retour,
      el('header', { class: 'vue-entete' }, titre, sousTitre),
      lienNotifications,
      contenu),
    maj,
  };
}
