// Fiche d'un plat : photo, statut, ingrédients, étapes, cuisson, conservation.
import { el, pastille, annoncer } from './dom.js';
import { choisirImage, preparerPhoto } from './photo.js';
import { copier } from './presse-papiers.js';
import { modeDeCuisson } from './pictos.js';
import { lireBrouillon } from './brouillon.js';
import { sectionNotes } from './notes.js';
import { etatsCompat, estVous, nomDe } from './compat.js';
import { profilsContraints, marqueursDouteux } from '../coeur/compatibilite.js';
import { texteDemandeRecette, texteDemandeVariantes } from '../coeur/claude.js';
import { LIBELLES_TYPE, STATUTS, statutDe, typeDe, quantiteLisible, cuissonLisible, visuelDuPlat } from '../coeur/plats.js';

// Photos en cours de préparation, au niveau du module : une fiche rouverte pendant la compression le sait.
const compressions = new Map(); // platId → jeton du dernier choix
const fichesOuvertes = new Set(); // fonctions de rafraîchissement des fiches affichées
let jetonSuivant = 0;
let dernierAppui = 0; // horodatage de la dernière ouverture du sélecteur

function rafraichirFiches() {
  for (const rafraichir of fichesOuvertes) rafraichir();
}

/** Prend ou choisit, compresse et enregistre une photo. Seul le dernier choix pour un plat est enregistré. */
async function changerPhoto(id, actions, appareil) {
  // Double appui : un seul sélecteur. Le verrou ne dépend pas de la fin du choix (« cancel » peut ne jamais arriver).
  if (Date.now() - dernierAppui < 1000) return;
  dernierAppui = Date.now();
  const fichier = await choisirImage({ appareil });
  if (!fichier) return;
  jetonSuivant += 1;
  const jeton = jetonSuivant;
  compressions.set(id, jeton);
  rafraichirFiches();
  try {
    const donnees = await preparerPhoto(fichier);
    if (compressions.get(id) !== jeton) return; // un choix plus récent l'emporte
    actions.enregistrerPhoto(id, donnees);
    annoncer('Photo enregistrée.');
  } catch {
    if (compressions.get(id) === jeton) annoncer('Cette image n’a pas pu être lue. Essayez une photo JPEG ou PNG.');
  } finally {
    if (compressions.get(id) === jeton) compressions.delete(id);
    rafraichirFiches();
  }
}

function accord(nombre, singulier, pluriel) {
  return `${nombre}\u00A0${nombre > 1 ? pluriel : singulier}`;
}

function section(titre, ...contenu) {
  return el('section', { class: 'fiche-section' }, el('h2', {}, titre), ...contenu);
}

/** « a », « a et b », « a, b et c » */
function enumerer(mots) {
  return mots.length > 1 ? `${mots.slice(0, -1).join(', ')} et ${mots.at(-1)}` : mots.join('');
}

const nomsProduits = (ingredients) => [...new Set((ingredients ?? [])
  .map((ingredient) => String(ingredient?.produit ?? '').replace(/\s+/g, ' ').trim())
  .filter(Boolean))];

/** Contenu d'une version : « Part au thon », « Sans : jambon blanc », « Avec : thon au naturel, 50 g par portion ». */
function detailVersion(variante) {
  const retirer = (Array.isArray(variante?.retirer) ? variante.retirer : []).map((p) => String(p ?? '').trim()).filter(Boolean);
  const ajouter = (Array.isArray(variante?.ajouter) ? variante.ajouter : [])
    .filter((a) => a && typeof a === 'object' && String(a.produit ?? '').trim())
    .map((a) => {
      const quantite = quantiteLisible(a.qtePortion, a.unite);
      return quantite ? `${String(a.produit).trim()}, ${quantite} par portion` : String(a.produit).trim();
    });
  const consigne = typeof variante?.consigne === 'string' ? variante.consigne.trim() : '';
  return [
    consigne ? el('p', { class: 'version-consigne' }, consigne) : null,
    retirer.length ? el('p', {}, el('strong', {}, 'Sans\u00A0:'), ` ${retirer.join(', ')}`) : null,
    ajouter.length ? el('p', {}, el('strong', {}, 'Avec\u00A0:'), ` ${ajouter.join('\u00A0; ')}`) : null,
  ].filter(Boolean);
}

/**
 * Section « Version pour <Prénom> » d'un profil qui a des règles (« Votre version » pour soi, vue « Repas et
 * courses ») : la version qui convient ; sinon ce qui manque, avec ❌ pour le gestionnaire seulement.
 */
function sectionVersion({ profil, resultat, cas }, plat, { moi, role }, actions = null) {
  const nom = nomDe(profil);
  const vous = estVous(profil, { moi, role });
  const gestionnaire = role === 'gestionnaire';
  // Tant que la version manque, le titre ne l'annonce pas (« Pour vous » plutôt que « Votre version »).
  const titre = cas === 'version' ? (vous ? 'Votre version' : `Version pour ${nom}`) : (vous ? 'Pour vous' : `Pour ${nom}`);
  const variante = (plat.variantes ?? []).find((v) => v && v.pour === profil.id);
  let contenu;
  if (cas === 'version') {
    contenu = detailVersion(resultat.variante ?? variante);
  } else if (cas === 'aRevoir' && gestionnaire) {
    const restants = (resultat.restants ?? []).filter(Boolean);
    contenu = [
      el('p', { class: 'compat-texte compat-exclu' }, el('span', { 'aria-hidden': 'true' }, '❌\u00A0'),
        restants.length
          ? `La version pour ${nom} contient encore\u00A0: ${enumerer(restants)}.`
          : `La version pour ${nom} est à revoir.`),
      ...detailVersion(variante),
    ];
  } else {
    const noms = nomsProduits(cas === 'aRevoir' && resultat.restants?.length
      ? resultat.restants.map((produit) => ({ produit }))
      : resultat.fautifs);
    const entre = noms.length ? ` (${enumerer(noms)})` : '';
    contenu = [el('p', { class: `compat-texte ${gestionnaire ? 'compat-exclu' : 'compat-discret'}` },
      gestionnaire ? el('span', { 'aria-hidden': 'true' }, '❌\u00A0') : null,
      `Pas encore de version pour ${vous ? 'vous' : nom}${entre}.`)];
  }
  return el('section', { class: 'fiche-section section-version' },
    el('h2', {}, cas === 'version' ? el('span', { 'aria-hidden': 'true' }, '🌿\u00A0') : null, titre),
    ...contenu,
    actions);
}

// Ce que le nom d'un ingrédient laisse penser, pour la ligne « à vérifier » (gestionnaire).
const SOUPCONS = {
  viande: 'de la viande',
  bouillon_viande: 'de la viande',
  gelatine_animale: 'de la gélatine animale',
  graisse_animale: 'de la graisse animale',
};

/** « « bouillon de volaille » contient peut-être de la viande : vérifiez-le dans Modifier. » (gestionnaire) */
function carteDouteux(plat) {
  const douteux = marqueursDouteux(plat);
  if (!douteux.length) return null;
  return el('section', { class: 'bandeau bandeau-alerte bandeau-colonne compat-douteux' },
    douteux.map(({ produit, attendu }) => el('p', {},
      el('span', { 'aria-hidden': 'true' }, '⚠️\u00A0'),
      `«\u00A0${produit}\u00A0» contient peut-être ${SOUPCONS[attendu] ?? 'un ingrédient à vérifier'}\u00A0: vérifiez-le dans Modifier.`)),
    el('a', { class: 'lien-fiche', href: `#/modifier/${encodeURIComponent(plat.id)}` }, 'Modifier ›'));
}

function ligneInfo(terme, definition) {
  return definition ? el('div', { class: 'ligne-info' }, el('dt', {}, terme), el('dd', {}, definition)) : null;
}

export function creer(ctx) {
  const id = ctx.parametre;
  let courant = ctx;
  let photo; // undefined : en cours de lecture ; null : pas de photo ; { image } sinon
  let retraitAConfirmer = false;
  let minuteurRetrait = null;

  const figure = el('figure', { class: 'photo-plat' });
  const contenu = el('div', { class: 'fiche-contenu' });
  // Boutons gardés d'un rendu à l'autre : le focus (clavier, TalkBack) n'est pas perdu.
  const boutonAppareil = el('button', { class: 'bouton bouton-secondaire', type: 'button', onclick: () => changerPhoto(id, courant.actions, true) });
  const boutonGalerie = el('button', { class: 'bouton bouton-secondaire', type: 'button', onclick: () => changerPhoto(id, courant.actions, false) }, '🖼️ Depuis la galerie');
  const boutonRetrait = el('button', { class: 'bouton bouton-texte', type: 'button', onclick: retirer });
  const actionsPhoto = el('div', { class: 'actions-photo' },
    el('div', { class: 'choix-photo' }, boutonAppareil, boutonGalerie),
    boutonRetrait);

  // Claude (gestionnaire) : un seul « Demander à Claude », dont le texte dépend du plat (demandeDuPlat), et « Coller la
  // réponse », qui ouvre l'ajout pour ce plat. Gardés d'un rendu à l'autre, comme les boutons de la photo.
  let demandeCopiee = false;
  const boutonDemander = el('button', { class: 'bouton bouton-plein', type: 'button', onclick: demanderAClaude }, '📋 Demander à Claude');
  const lienColler = el('a', { class: 'bouton bouton-plein', href: `#/import/${encodeURIComponent(id)}` }, 'Coller la réponse');
  const messageCopie = el('p', { class: 'aide', role: 'status' });
  const actionsRecette = el('div', { class: 'actions-recette' }, messageCopie, boutonDemander, lienColler);

  // « Modifier la recette » (les deux membres), ou « Reprendre » si une modification attend sur ce téléphone.
  const lienModifier = el('a', { class: 'bouton bouton-secondaire bouton-plein', href: `#/modifier/${encodeURIComponent(id)}` });
  const carteReprise = el('section', { class: 'carte carte-reprise' },
    el('div', { class: 'carte-ligne' },
      pastille('✏️', 'ocre'),
      el('div', { class: 'carte-texte' },
        el('h2', {}, 'Modifications pas encore enregistrées'),
        el('p', {}, 'Reprenez là où vous en étiez.'))),
    el('a', { class: 'bouton bouton-principal bouton-plein', href: `#/modifier/${encodeURIComponent(id)}` }, 'Reprendre'));

  // Notes de chaque profil : section gardée d'un rendu à l'autre, mise à jour en place (focus conservé).
  const notes = sectionNotes(ctx, id);

  const platCourant = () => courant.plats.find((plat) => plat.id === id);
  const aUnePhoto = (plat) => Boolean(plat?.vignette || photo?.image);

  /**
   * Texte copié par « Demander à Claude » : plat ⏳ → la recette, avec les versions des profils qui ont des règles ;
   * plat dont la version manque ou est à revoir pour un profil (le premier dans l'ordre des profils) → sa version
   * seule ; sinon → une nouvelle recette, comme en T1b (avec les versions des profils qui ont des règles).
   */
  function demandeDuPlat(plat) {
    if (statutDe(plat) !== 'attente') {
      const manque = etatsCompat(plat, courant).find((etat) => etat.cas === 'aCreer' || etat.cas === 'aRevoir');
      if (manque) return texteDemandeVariantes([plat], manque.profil);
    }
    return texteDemandeRecette(plat, { profils: courant.profils ?? [] });
  }

  async function demanderAClaude() {
    const plat = platCourant();
    if (!plat) return;
    // Texte calculé dans le toucher, avant toute attente : la copie de repli reste permise.
    const reussi = await copier(demandeDuPlat(plat));
    demandeCopiee = demandeCopiee || reussi;
    messageCopie.textContent = reussi
      ? 'Copié. Collez-le dans votre projet Claude, puis revenez ici et touchez «\u00A0Coller la réponse\u00A0».'
      : 'La copie n’a pas marché. Réessayez.';
    majActionsRecette();
  }

  /** Avant la copie, l'action principale est « Demander à Claude » ; ensuite, « Coller la réponse ». */
  function majActionsRecette() {
    boutonDemander.className = `bouton bouton-plein ${demandeCopiee ? 'bouton-secondaire' : 'bouton-principal'}`;
    lienColler.className = `bouton bouton-plein ${demandeCopiee ? 'bouton-principal' : 'bouton-secondaire'}`;
    messageCopie.hidden = !messageCopie.textContent;
  }

  const arreterPhoto = ctx.actions.suivrePhoto(id, (donnees) => {
    photo = donnees;
    dessinerPhoto();
    majBoutonsPhoto();
  });

  function dessinerPhoto() {
    const plat = platCourant();
    figure.hidden = !plat;
    if (!plat) {
      figure.replaceChildren();
      return;
    }
    const source = photo?.image ?? plat.vignette;
    figure.classList.toggle('sans-photo', !source);
    if (source) {
      const image = figure.querySelector('img') ?? el('img', {});
      image.src = source;
      image.alt = `Photo du plat\u00A0: ${plat.nom}`;
      image.classList.toggle('en-attente', !photo?.image);
      if (!image.isConnected) figure.replaceChildren(image);
    } else {
      const { emoji, teinte } = visuelDuPlat(plat);
      figure.replaceChildren(pastille(emoji, teinte, true));
    }
  }

  function majBoutonsPhoto() {
    const plat = platCourant();
    actionsPhoto.hidden = !plat;
    if (!plat) return;
    const enCours = compressions.has(id);
    const avecPhoto = aUnePhoto(plat);
    boutonAppareil.disabled = enCours;
    boutonGalerie.disabled = enCours;
    boutonAppareil.textContent = enCours ? 'Photo en cours…' : '📷 Prendre une photo';
    boutonRetrait.hidden = !avecPhoto || enCours;
    boutonRetrait.textContent = retraitAConfirmer ? 'Toucher pour confirmer le retrait' : 'Retirer la photo';
  }

  function retirer() {
    clearTimeout(minuteurRetrait);
    if (!retraitAConfirmer) {
      retraitAConfirmer = true;
      annoncer('Touchez à nouveau pour retirer la photo.');
      minuteurRetrait = setTimeout(() => {
        retraitAConfirmer = false;
        majBoutonsPhoto();
      }, 8000);
      majBoutonsPhoto();
      return;
    }
    retraitAConfirmer = false;
    courant.actions.retirerPhoto(id);
    photo = null;
    annoncer('Photo retirée.');
    dessinerPhoto();
    majBoutonsPhoto();
    boutonAppareil.focus();
  }

  function dessiner() {
    const plat = platCourant();
    if (!plat) {
      contenu.replaceChildren(courant.platsCharges
        ? el('div', { class: 'carte etat-vide compact' },
          el('p', {}, 'Ce plat n’existe plus.'),
          el('a', { class: 'bouton bouton-secondaire', href: '#/plats' }, 'Voir les plats'))
        : el('p', { class: 'texte-doux', role: 'status' }, 'Chargement…'));
      return;
    }

    const statut = statutDe(plat);
    const gestionnaire = courant.role === 'gestionnaire';
    const nomsProfils = new Map((courant.profils ?? []).map((p) => [p.id, p.nom]));
    // Versions par profil qui a des règles ; les autres versions (profil sans règle, ou inconnu) restent à part.
    const etats = etatsCompat(plat, courant);
    const versionsMontrees = new Set(etats.filter((e) => e.cas !== 'aCreer').map((e) => e.profil.id));
    const contraints = profilsContraints(courant.profils);
    // Première version à créer ou à revoir : le bouton unique « Demander à Claude » la demande (demandeDuPlat).
    const versionManquante = gestionnaire && statut !== 'attente'
      ? etats.find((etat) => etat.cas === 'aCreer' || etat.cas === 'aRevoir') ?? null
      : null;
    const ingredients = plat.ingredients ?? [];
    const etapes = plat.etapes ?? [];
    const cuissons = plat.cuisson ?? [];
    const variantes = (plat.variantes ?? []).filter((v) => !versionsMontrees.has(v?.pour));
    const frigo = plat.conservation?.frigoJours;
    const congelable = plat.conservation?.congelable;
    const conservation = [
      typeof frigo === 'number' ? `${accord(frigo, 'jour', 'jours')} au frigo` : null,
      congelable === true ? 'se congèle' : congelable === false ? 'ne se congèle pas' : null,
    ].filter(Boolean).join(' · ');

    // Mise à jour des notes d'abord : si ses lignes sont reconstruites, l'élément qui reprend le focus est le nouveau.
    notes.maj(courant);
    // Boutons gardés d'un rendu à l'autre : celui qui avait le focus le retrouve après la mise à jour.
    const focusGarde = [actionsRecette, lienModifier, carteReprise, notes.noeud].some((n) => n.contains(document.activeElement))
      ? document.activeElement
      : null;
    // Lien « Modifier › » de l'ingrédient douteux : reconstruit à chaque rendu, son remplaçant reprend le focus.
    const focusDouteux = Boolean(document.activeElement?.closest?.('.compat-douteux'));
    majActionsRecette();
    const brouillon = lireBrouillon(courant.utilisateur?.uid, id);
    lienModifier.replaceChildren(
      el('span', { 'aria-hidden': 'true' }, '✏️'),
      statut === 'attente' ? 'Écrire la recette moi-même' : 'Modifier la recette',
    );
    // replaceChildren écrirait « null » : les blocs absents sont retirés.
    contenu.replaceChildren(...[
      el('header', { class: 'vue-entete' },
        el('h1', {}, plat.nom),
        el('p', { class: 'badges' },
          el('span', { class: 'badge' }, LIBELLES_TYPE[typeDe(plat)] ?? 'Plat'),
          el('span', { class: `badge badge-${statut}` }, `${STATUTS[statut].emoji}\u00A0${STATUTS[statut].libelle}`),
          modeDeCuisson(plat, { duree: true, classe: 'badge badge-cuisson' }),
          typeof plat.portionsBase === 'number'
            ? el('span', { class: 'badge' }, accord(plat.portionsBase, 'portion', 'portions'))
            : null,
        ),
      ),

      brouillon ? carteReprise : lienModifier,

      // Version qui manque (gestionnaire) : « Demander à Claude » se place sous la première, et demande sa version.
      ...etats.map((etat) => sectionVersion(etat, plat, { moi: courant.moi, role: courant.role },
        etat === versionManquante ? actionsRecette : null)),

      gestionnaire && contraints.length && statut !== 'attente' ? carteDouteux(plat) : null,

      statut === 'attente'
        ? el('section', { class: 'carte' },
          el('div', { class: 'carte-ligne' },
            pastille('⏳', 'ocre'),
            el('div', { class: 'carte-texte' },
              el('h2', {}, 'Recette à ajouter'),
              el('p', {}, gestionnaire
                ? 'Demandez-la à votre projet Claude, puis collez sa réponse ici.'
                : 'Elle a été demandée. Vous pouvez aussi l’écrire vous-même.'),
            )),
          gestionnaire ? actionsRecette : null)
        : null,

      // Absente tant qu'aucun profil n'existe ; aussi pour un plat ⏳ (le nom suffit pour donner un avis).
      (courant.profils ?? []).length ? notes.noeud : null,

      ingredients.length
        ? section('Ingrédients', el('ul', { class: 'liste-ingredients' }, ingredients.map((ingredient) => el('li', {},
          el('span', { class: 'quantite' }, quantiteLisible(ingredient.qte, ingredient.unite)),
          el('span', {}, ingredient.produit ?? ''),
        ))))
        : null,

      etapes.length
        ? section('Étapes', el('ol', { class: 'liste-etapes' }, etapes.map((etape) => el('li', {}, String(etape)))))
        : null,

      cuissons.length
        ? section('Cuisson', el('ul', { class: 'liste-simple' }, cuissons.map((c) => el('li', {}, cuissonLisible(c)))))
        : null,

      variantes.length
        ? section(etats.length ? 'Autres versions' : 'Versions', el('ul', { class: 'liste-simple' }, variantes.map((v) => el('li', {}, el('span', {},
          el('strong', {}, nomsProfils.get(v.pour) ?? 'Autre profil'),
          v.consigne ? `\u00A0: ${v.consigne}` : '',
        )))))
        : null,

      (conservation || typeof plat.tempsActifMin === 'number' || typeof plat.emporter === 'boolean' || plat.source)
        ? section('Bon à savoir', el('dl', { class: 'infos' },
          ligneInfo('Préparation', typeof plat.tempsActifMin === 'number' ? `${plat.tempsActifMin}\u00A0min de travail` : ''),
          ligneInfo('Conservation', conservation),
          ligneInfo('Boîte à emporter', plat.emporter === false ? 'Supporte mal la boîte' : plat.emporter === true ? 'Se réchauffe bien' : ''),
          ligneInfo('Source', plat.source ? String(plat.source) : ''),
        ))
        : null,

      gestionnaire && statut !== 'attente' && !versionManquante
        ? section('Nouvelle version', el('p', { class: 'texte-doux' },
          'Pour une recette entièrement refaite, demandez une nouvelle version à votre projet Claude. Elle remplacera vos modifications.'),
        actionsRecette)
        : null,
    ].filter(Boolean));
    if (focusGarde?.isConnected && document.activeElement !== focusGarde) focusGarde.focus({ preventScroll: true });
    else if (focusDouteux) contenu.querySelector('.compat-douteux a')?.focus({ preventScroll: true });
  }

  function toutDessiner() {
    dessinerPhoto();
    majBoutonsPhoto();
    dessiner();
  }

  toutDessiner();
  fichesOuvertes.add(majBoutonsPhoto);

  const retour = el('a', {
    class: 'retour',
    href: '#/plats',
    onclick: (evenement) => {
      // Venu de la liste : on y revient dans l'historique, pour que le geste retour d'Android reste naturel.
      if (courant.routePrecedente === 'plats' && history.length > 1) {
        evenement.preventDefault();
        history.back();
      }
    },
  }, el('span', { 'aria-hidden': 'true' }, '‹'), 'Plats');

  return {
    noeud: el('div', { class: 'vue fiche' }, retour, figure, actionsPhoto, contenu),
    maj(nouveau) {
      courant = nouveau;
      toutDessiner();
    },
    detruire() {
      arreterPhoto();
      clearTimeout(minuteurRetrait);
      fichesOuvertes.delete(majBoutonsPhoto);
    },
  };
}
