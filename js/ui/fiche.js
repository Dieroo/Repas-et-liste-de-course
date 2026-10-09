// Fiche d'un plat : photo, statut, ingrédients, étapes, cuisson, conservation ; en bas, « Mettre à la corbeille ».
// Un plat de la corbeille (fiche ouverte par un lien) se lit sans rien pouvoir y changer : seul « Remettre » agit.
import { el, pastille, annoncer } from './dom.js';
import { choisirImage, preparerPhoto } from './photo.js';
import { copier } from './presse-papiers.js';
import { modeDeCuisson } from './pictos.js';
import { lireBrouillon } from './brouillon.js';
import { sectionNotes } from './notes.js';
import { etatsCompat, estVous, nomDe, rangerStyles } from './compat.js';
import { profilsContraints, marqueursDouteux } from '../coeur/compatibilite.js';
import { texteDemandeRecette, texteDemandeVariantes } from '../coeur/claude.js';
import { stylesAttendus } from '../coeur/regles.js';
import { EMOJIS_STYLE, LIBELLES_STYLE, STYLES } from '../coeur/vocabulaire.js';
import { LIBELLES_TYPE, STATUTS, statutDe, typeDe, quantiteLisible, cuissonLisible, visuelDuPlat } from '../coeur/plats.js';
import { estDansCorbeille, platsSansPreneur, texteCorbeille } from '../coeur/corbeille.js';

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

/** « À manger dans les 2 jours après cuisson » (part au poisson d'une version mer, surtout) ; null sans durée valide. */
function texteFrigo(jours) {
  if (!Number.isInteger(jours) || jours < 1) return null;
  return jours === 1 ? 'À manger dans le jour qui suit la cuisson' : `À manger dans les ${jours}\u00A0jours après cuisson`;
}

/**
 * Contenu d'une version : « Part au thon », « Sans : jambon blanc », « Avec : thon au naturel, 50 g par portion »,
 * « À manger dans les 2 jours après cuisson ».
 */
function detailVersion(variante) {
  const retirer = (Array.isArray(variante?.retirer) ? variante.retirer : []).map((p) => String(p ?? '').trim()).filter(Boolean);
  const ajouter = (Array.isArray(variante?.ajouter) ? variante.ajouter : [])
    .filter((a) => a && typeof a === 'object' && String(a.produit ?? '').trim())
    .map((a) => {
      const quantite = quantiteLisible(a.qtePortion, a.unite);
      return quantite ? `${String(a.produit).trim()}, ${quantite} par portion` : String(a.produit).trim();
    });
  const consigne = typeof variante?.consigne === 'string' ? variante.consigne.trim() : '';
  const frigo = texteFrigo(variante?.frigoJours);
  return [
    consigne ? el('p', { class: 'version-consigne' }, consigne) : null,
    retirer.length ? el('p', {}, el('strong', {}, 'Sans\u00A0:'), ` ${retirer.join(', ')}`) : null,
    ajouter.length ? el('p', {}, el('strong', {}, 'Avec\u00A0:'), ` ${ajouter.join('\u00A0; ')}`) : null,
    frigo ? el('p', { class: 'version-frigo' }, frigo) : null,
  ].filter(Boolean);
}

/** Style écrit d'une version (`mer`, `vegetal`) ; null sinon. */
const styleEcrit = (variante) => (STYLES.includes(variante?.style) ? variante.style : null);

// « pas de version mer pour un dessert » : types qui n'attendent pas de version mer (regles.js › TYPES_SANS_MER).
const POUR_UN = { dessert: 'un dessert', accompagnement: 'un accompagnement' };

/**
 * Une version dans la section d'un profil : titre « 🐟 Version mer », « 🌿 Version végétale » (ou « Version » pour un
 * profil sans style attendu), « ❌ À revoir » si elle ne convient pas (gestionnaire seul : l'autre membre ne voit que
 * les versions qui conviennent), puis son contenu. `version` : élément de evaluer(…).versions. `plusUtilisee` : texte
 * discret, sans croix, d'une version d'un style que le profil n'attend plus et qu'une autre version remplace déjà
 * (rien à redemander : la prochaine version reçue pour ce profil la retire).
 */
function partieVersion({ variante, style, convient, restants }, { avecStyles, gestionnaire, plusUtilisee = '' }) {
  const nomme = avecStyles || styleEcrit(variante) ? style : null;
  const emoji = nomme ? EMOJIS_STYLE[nomme] : convient ? '🌿' : '';
  const noms = (restants ?? []).filter(Boolean);
  let etat = null;
  if (!convient && gestionnaire) {
    etat = plusUtilisee
      ? el('p', { class: 'compat-texte compat-discret' }, plusUtilisee)
      : el('p', { class: 'compat-texte compat-exclu' }, el('span', { 'aria-hidden': 'true' }, '❌\u00A0'),
        noms.length ? `À revoir\u00A0: elle contient encore ${enumerer(noms)}.` : 'À revoir.');
  }
  return el('div', { class: 'version-style' },
    el('h3', {}, emoji ? el('span', { 'aria-hidden': 'true' }, `${emoji}\u00A0`) : null,
      nomme ? `Version ${LIBELLES_STYLE[nomme]}` : 'Version'),
    etat,
    ...detailVersion(variante));
}

/**
 * « Plus utilisée : <Prénom> ne mange pas de poisson. » ou « Plus utilisée : pas de version mer pour un dessert. »,
 * pour une version qui ne convient pas, d'un style que le profil n'attend pas pour ce plat (regles.js ›
 * stylesAttendus), quand une autre de ses versions convient ; '' sinon (elle reste « À revoir »).
 */
function textePlusUtilisee(version, profil, plat, { avecStyles, autreConvient }) {
  if (!avecStyles || version.convient || !autreConvient || stylesAttendus(profil, plat).includes(version.style)) return '';
  const pourUn = POUR_UN[typeDe(plat)];
  return stylesAttendus(profil).includes(version.style) && pourUn
    ? `Plus utilisée\u00A0: pas de version ${LIBELLES_STYLE[version.style] ?? version.style} pour ${pourUn}.`
    : `Plus utilisée\u00A0: ${nomDe(profil)} ne mange pas de poisson.`;
}

/** « 🌿 Version végétale à demander » (gestionnaire) : un style attendu sans aucune version sur la fiche. */
function ligneADemander(style) {
  return el('p', { class: 'version-a-demander' }, el('span', { 'aria-hidden': 'true' }, `${EMOJIS_STYLE[style]}\u00A0`),
    `Version ${LIBELLES_STYLE[style]} à demander`);
}

/**
 * Section « Version pour <Prénom> » d'un profil qui a des règles (« Votre version » pour soi, vue « Repas et
 * courses ») : la version qui convient ; sinon ce qui manque, avec ❌ pour le gestionnaire seulement.
 * Profil qui attend des styles (« Pas de viande » : mer et végétale), ou qui a plusieurs versions : une partie par
 * version (« 🐟 Version mer », « 🌿 Version végétale »), puis, pour le gestionnaire, les styles qui manquent encore
 * (« 🌿 Version végétale à demander »). L'autre membre ne voit que les versions qui conviennent.
 */
function sectionVersion({ profil, resultat, cas }, plat, { moi, role }, actions = null) {
  const nom = nomDe(profil);
  const vous = estVous(profil, { moi, role });
  const gestionnaire = role === 'gestionnaire';
  const avecStyles = stylesAttendus(profil).length > 0;
  const toutes = (Array.isArray(resultat.versions) ? resultat.versions : []).filter((v) => v && v.variante);
  const autreConvient = toutes.some((v) => v.convient);
  const plusUtilisee = (v) => textePlusUtilisee(v, profil, plat, { avecStyles, autreConvient });
  // Mer puis végétale, une version plus utilisée en dernier (tri stable : l'ordre de la fiche pour le reste).
  const rang = (v) => (avecStyles ? (plusUtilisee(v) ? STYLES.length : Math.max(0, STYLES.indexOf(v.style))) : 0);
  const versions = (gestionnaire ? toutes : toutes.filter((v) => v.convient)).sort((a, b) => rang(a) - rang(b));
  // Styles attendus sans aucune version sur la fiche (une version à revoir est déjà montrée) : gestionnaire seul.
  const aDemander = gestionnaire && avecStyles && cas !== 'version'
    ? rangerStyles(resultat.manquants).filter((style) => !toutes.some((v) => v.style === style))
    : [];
  const variante = (plat.variantes ?? []).find((v) => v && v.pour === profil.id);
  const parParties = (avecStyles || versions.length > 1) && (cas === 'version' || cas === 'aCompleter' || (cas === 'aRevoir' && gestionnaire));
  let titre;
  let contenu;
  let emojiTitre = false;
  if (parParties) {
    const convient = versions.some((v) => v.convient);
    const n = versions.length;
    // Tant qu'aucune version ne convient, le titre ne l'annonce pas (« Pour vous » plutôt que « Votre version »).
    if (!convient) titre = vous ? 'Pour vous' : `Pour ${nom}`;
    else if (vous) titre = n > 1 ? 'Vos versions' : 'Votre version';
    else titre = n > 1 ? `Versions pour ${nom}` : `Version pour ${nom}`;
    contenu = [
      ...versions.map((version) => partieVersion(version, { avecStyles, gestionnaire, plusUtilisee: plusUtilisee(version) })),
      ...aDemander.map(ligneADemander),
    ];
  } else if (cas === 'version' || cas === 'aCompleter') {
    // Profil sans style attendu, une seule version : comme avant les styles.
    titre = vous ? 'Votre version' : `Version pour ${nom}`;
    emojiTitre = true;
    contenu = detailVersion(resultat.variante ?? variante);
  } else if (cas === 'aRevoir' && gestionnaire) {
    titre = `Pour ${nom}`;
    const restants = (resultat.restants ?? []).filter(Boolean);
    contenu = [
      el('p', { class: 'compat-texte compat-exclu' }, el('span', { 'aria-hidden': 'true' }, '❌\u00A0'),
        restants.length
          ? `La version pour ${nom} contient encore\u00A0: ${enumerer(restants)}.`
          : `La version pour ${nom} est à revoir.`),
      ...detailVersion(variante),
    ];
  } else {
    titre = vous ? 'Pour vous' : `Pour ${nom}`;
    const noms = nomsProduits(cas === 'aRevoir' && resultat.restants?.length
      ? resultat.restants.map((produit) => ({ produit }))
      : resultat.fautifs);
    const entre = noms.length ? ` (${enumerer(noms)})` : '';
    contenu = [
      el('p', { class: `compat-texte ${gestionnaire ? 'compat-exclu' : 'compat-discret'}` },
        gestionnaire ? el('span', { 'aria-hidden': 'true' }, '❌\u00A0') : null,
        `Pas encore de version pour ${vous ? 'vous' : nom}${entre}.`),
      // À créer (gestionnaire) : les versions que « Demander à Claude » demandera.
      ...aDemander.map(ligneADemander),
    ];
  }
  return el('section', { class: 'fiche-section section-version' },
    el('h2', {}, emojiTitre ? el('span', { 'aria-hidden': 'true' }, '🌿\u00A0') : null, titre),
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

/**
 * Profil dont une version manque, dans l'ordre des profils : à créer ou à revoir d'abord, sinon à compléter (une
 * version convient, il en manque d'un style attendu). → état de etatsCompat, ou null.
 */
function versionAttendue(etats) {
  return etats.find((etat) => etat.cas === 'aCreer' || etat.cas === 'aRevoir')
    ?? etats.find((etat) => etat.cas === 'aCompleter')
    ?? null;
}

/**
 * Carte « Personne n'en veut » (les deux membres) : plat noté « Jamais » par tous les profils (coeur/corbeille.js ›
 * platsSansPreneur). La corbeille est seulement proposée : un toucher, et l'annonce permet d'annuler. Créée une fois
 * par fiche, son texte mis à jour à chaque rendu (`maj(profils)`) : son bouton garde le focus.
 * → { noeud, bouton, maj }
 */
function creerCarteSansPreneur(mettreALaCorbeille) {
  const texte = el('p', {});
  const bouton = el('button', { class: 'bouton bouton-secondaire bouton-plein', type: 'button', onclick: mettreALaCorbeille },
    el('span', { 'aria-hidden': 'true' }, '🗑️'), 'Le mettre à la corbeille');
  const noeud = el('section', { class: 'carte carte-sans-preneur' },
    el('div', { class: 'carte-ligne' },
      pastille('👎', 'ocre'),
      el('div', { class: 'carte-texte' }, el('h2', {}, 'Personne n’en veut'), texte)),
    bouton);
  function maj(profils) {
    const seul = profils.length === 1 ? nomDe(profils[0]) : null;
    texte.textContent = `${seul ? `${seul} l’a noté` : 'Tout le monde l’a noté'} «\u00A0Jamais\u00A0». Le mettre à la corbeille\u202F?`;
  }
  return { noeud, bouton, maj };
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

  // Corbeille : « Remettre » d'un plat de la corbeille, gardé d'un rendu à l'autre (focus conservé).
  const texteJete = el('p', {});
  const boutonRemettre = el('button', { class: 'bouton bouton-principal bouton-plein', type: 'button', onclick: remettre }, 'Remettre');
  const carteJete = el('section', { class: 'carte carte-corbeille' },
    el('div', { class: 'carte-ligne' },
      pastille('🗑️', 'ocre'),
      el('div', { class: 'carte-texte' },
        el('h2', {}, 'Ce plat est dans la corbeille'),
        texteJete,
        el('p', {}, 'Il n’apparaît plus dans vos plats. Remettez-le pour le retrouver.'))),
    boutonRemettre);
  let depart = false; // vrai dès que la fiche part vers la liste, après « Mettre à la corbeille »
  // « Mettre à la corbeille » (bouton discret) et carte « Personne n'en veut » : gardés d'un rendu à l'autre, comme
  // « Modifier », pour qu'une mise à jour venue de l'autre téléphone ne leur fasse pas perdre le focus.
  const boutonCorbeille = el('button', { class: 'bouton bouton-texte bouton-corbeille', type: 'button', onclick: mettreALaCorbeille },
    el('span', { 'aria-hidden': 'true' }, '🗑️'), 'Mettre à la corbeille');
  const carteSansPreneur = creerCarteSansPreneur(mettreALaCorbeille);

  // La corbeille comprise : un plat de la corbeille garde sa fiche, ouverte par un lien (sinon « n'existe plus »).
  const platCourant = () => (courant.tousLesPlats ?? courant.plats).find((plat) => plat.id === id);
  const aUnePhoto = (plat) => Boolean(plat?.vignette || photo?.image);

  /**
   * Texte copié par « Demander à Claude » : plat ⏳ → la recette, avec les versions des profils qui ont des règles ;
   * plat dont une version manque pour un profil (versionAttendue) → ses versions seules (celles « à faire » : à
   * créer, à revoir ou à compléter) ; sinon → une nouvelle recette, comme en T1b (avec les versions des profils qui
   * ont des règles).
   */
  function demandeDuPlat(plat) {
    if (statutDe(plat) !== 'attente') {
      const manque = versionAttendue(etatsCompat(plat, courant));
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

  /**
   * « Mettre à la corbeille » (les deux membres ; aussi depuis la carte « Personne n'en veut ») : retour à la liste des
   * plats, puis l'action, qui annonce « « X » est dans la corbeille » avec « Annuler ». Venu de la liste (l'entrée
   * d'historique le dit aussi : une fiche ouverte depuis une autre fiche n'y revient pas) : un pas en arrière ; sinon
   * la fiche est remplacée (le geste retour ne ramène pas à un plat jeté).
   */
  function mettreALaCorbeille() {
    const plat = platCourant();
    if (!plat || estDansCorbeille(plat) || depart) return;
    depart = true;
    if (courant.routePrecedente === 'plats' && history.state?.precedente === 'plats' && history.length > 1) history.back();
    else location.replace('#/plats');
    courant.actions.mettreALaCorbeille([id]);
  }

  /** « Remettre » : le plat revient dans les plats ; la fiche redevient complète, le focus passe à « Modifier ». */
  function remettre() {
    const plat = platCourant();
    if (!plat || !estDansCorbeille(plat)) return;
    courant.actions.remettreDeLaCorbeille([id]);
    const suivant = lienModifier.isConnected ? lienModifier : carteReprise.querySelector('a');
    if (suivant?.isConnected) suivant.focus();
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
    // Plat de la corbeille : photo visible, mais rien à y changer.
    actionsPhoto.hidden = !plat || estDansCorbeille(plat);
    if (actionsPhoto.hidden) return;
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
    // Plat de la corbeille : recette en lecture seule, sous la carte « Remettre » (ni notes, ni Claude, ni Modifier).
    const jete = estDansCorbeille(plat);
    const gestionnaire = courant.role === 'gestionnaire' && !jete;
    const nomsProfils = new Map((courant.profils ?? []).map((p) => [p.id, p.nom]));
    // Versions par profil qui a des règles ; les autres versions (profil sans règle, ou inconnu) restent à part. Plat
    // de la corbeille : toutes ses versions dans la simple liste « Versions », sans rien à demander.
    const etats = jete ? [] : etatsCompat(plat, courant);
    const versionsMontrees = new Set(etats.filter((e) => e.cas !== 'aCreer').map((e) => e.profil.id));
    const contraints = profilsContraints(courant.profils);
    // Première version qui manque : le bouton unique « Demander à Claude » la demande (demandeDuPlat).
    const versionManquante = gestionnaire && statut !== 'attente' ? versionAttendue(etats) : null;
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
    if (!jete) notes.maj(courant);
    // Boutons gardés d'un rendu à l'autre : celui qui avait le focus le retrouve après la mise à jour.
    const focusGarde = [actionsRecette, lienModifier, carteReprise, notes.noeud, carteJete, boutonCorbeille, carteSansPreneur.noeud]
      .some((n) => n.contains(document.activeElement))
      ? document.activeElement
      : null;
    texteJete.textContent = jete
      ? `${texteCorbeille(plat, { profils: courant.profils ?? [], moi: courant.utilisateur?.email ?? courant.moi })}.`
      : '';
    // Personne n'en veut (tous les profils l'ont noté « Jamais ») : la corbeille est suggérée, jamais automatique.
    const sansPreneur = !jete && platsSansPreneur([plat], courant.profils ?? []).length > 0;
    if (sansPreneur) carteSansPreneur.maj(courant.profils ?? []);
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

      jete ? carteJete : brouillon ? carteReprise : lienModifier,

      // Version qui manque (gestionnaire) : « Demander à Claude » se place sous la première, et demande sa version.
      ...etats.map((etat) => sectionVersion(etat, plat, { moi: courant.moi, role: courant.role },
        etat === versionManquante ? actionsRecette : null)),

      gestionnaire && contraints.length && statut !== 'attente' ? carteDouteux(plat) : null,

      statut === 'attente' && !jete
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
      (courant.profils ?? []).length && !jete ? notes.noeud : null,

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
          styleEcrit(v) ? `, version ${LIBELLES_STYLE[styleEcrit(v)]}` : '',
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

      // Tout en bas, pour les deux membres : la suggestion « Personne n'en veut », sinon un simple bouton discret.
      sansPreneur ? carteSansPreneur.noeud : null,
      !jete && !sansPreneur ? boutonCorbeille : null,
    ].filter(Boolean));
    if (focusGarde?.isConnected) {
      if (document.activeElement !== focusGarde) focusGarde.focus({ preventScroll: true });
    } else if (focusGarde === boutonCorbeille || focusGarde === carteSansPreneur.bouton) {
      // La carte « Personne n'en veut » a remplacé le bouton discret (ou l'inverse) : le focus passe à l'autre.
      const autre = focusGarde === boutonCorbeille ? carteSansPreneur.bouton : boutonCorbeille;
      if (autre.isConnected) autre.focus({ preventScroll: true });
    } else if (focusDouteux) contenu.querySelector('.compat-douteux a')?.focus({ preventScroll: true });
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
      // Plat mis à la corbeille : la fiche s'en va vers la liste, elle ne se redessine plus d'ici là.
      if (depart) return;
      toutDessiner();
    },
    detruire() {
      arreterPhoto();
      clearTimeout(minuteurRetrait);
      fichesOuvertes.delete(majBoutonsPhoto);
    },
  };
}
