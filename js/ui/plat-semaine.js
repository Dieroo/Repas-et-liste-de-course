// Plat de la semaine (T3a, complété en T3c) : feuille du plat (« Qui en mange ? », « 📬 Demander ma version », « Des
// invités ? », « Pour combien de repas ? », Mer / Végétale, conservation, « Revenir aux réglages de départ », « Voir la
// recette », « Retirer de la semaine »), et ce que la carte du plat sur Semaine partage avec elle : le choix de la
// version (« Pour Adulte B : 🐟 Mer · 🌿 Végétale », mer d'avance, seulement quand deux versions conviennent), la
// version unique (« Pour vous : version mer 🐟 ») et la conservation de la part la plus fragile (non bloquant).
// Rien n'est écrit à l'ouverture : chaque case et chaque compteur écrit son seul chemin quand on le touche
// (`plats.<id>.mange.<p>`, `.invites.adultes`, `.invites.enfants`, `.repas` ; touchers regroupés 0,8 s, affichage
// immédiat), un choix de version écrit `plats.<id>.styles.<profilId>`. Une demande ne part jamais seule : « 📬 Demander
// ma version » est un geste (vue « Repas et courses », gestionnaire en aperçu compris, règles de T2e).
// T4-0 : en tête de la feuille, « ✨ Proposé : … » (raison gardée sur le téléphone qui a proposé) et « 🔄 Une autre
// idée » (un autre plat du même type prend sa place, en un lot ; « Annuler » rend l'ancien avec ses réglages).
import { el, annoncer, ecrireTexte, reconcilier, vibrer } from './dom.js';
import { ouvrirFeuille } from './feuille.js';
import {
  COMPTEURS, TEXTES_PLAT_SEMAINE, TEXTE_SANS_RECETTE, appliquerChamps, ecrituresReglage, estDansLaSemaine,
  feuillePlat, fusionnerReglages, legendeVersion, libelleStyle, lireSemaine, platsDeLaSemaine, texteConservation,
  texteVersionUnique,
} from '../coeur/semaine.js';
import { listeDeCourses, restes } from '../coeur/liste.js';
import { dateDemande, etatDemande, texteDemandee } from '../coeur/demandes.js';
import { STYLES } from '../coeur/vocabulaire.js';
import { TEXTES_PROPOSER, nomAutreIdee, texteRaison } from '../coeur/proposition.js';
// T5-1 « Cuisiner pas à pas » : sous « Voir la recette › ».
import { TEXTES_CUISINE, peutCuisiner } from '../coeur/cuisine.js';
import { avecPictogramme } from './etape.js';

/** Touchers rapides sur les cases et les compteurs : une seule écriture, 0,8 s après le dernier. */
const DELAI_REGROUPEMENT_MS = 800;

// ——— Plats de la semaine montrée, gardés tant que leurs sources sont les mêmes objets ———

let memoPlats = { semaine: undefined, plats: null, profils: null, compat: null, reglages: undefined, resultat: [] };

function calculerPlats(ctx, semaine) {
  const lue = lireSemaine(semaine);
  if (!lue) return [];
  return platsDeLaSemaine(lue, {
    tousLesPlats: ctx?.tousLesPlats ?? ctx?.plats ?? [],
    profils: ctx?.profils ?? [],
    ...(typeof ctx?.compat === 'function' ? { evaluer: ctx.compat } : {}),
    reglages: ctx?.reglages ?? null,
  });
}

/**
 * Plats d'une semaine (la semaine montrée, `ctx.semaine`, par défaut), prêts pour l'écran (coeur/semaine.js ›
 * platsDeLaSemaine). Ceux de la semaine montrée sont gardés tant que la semaine, les plats, les profils, `compat` et
 * les réglages sont les mêmes objets. [] sans semaine lisible.
 */
export function platsDeLaSemaineDe(ctx, semaine = ctx?.semaine) {
  if (semaine !== ctx?.semaine) return calculerPlats(ctx, semaine);
  const m = memoPlats;
  if (m.semaine === semaine && m.plats === ctx.tousLesPlats && m.profils === ctx.profils && m.compat === ctx.compat
    && m.reglages === ctx.reglages) {
    return m.resultat;
  }
  const resultat = calculerPlats(ctx, semaine);
  memoPlats = { semaine, plats: ctx.tousLesPlats, profils: ctx.profils, compat: ctx.compat, reglages: ctx.reglages, resultat };
  return resultat;
}

let memoListe = { semaine: undefined, plats: null, profils: null, articles: null, reglages: undefined, compat: null, resultat: null };

/**
 * Liste de courses de la semaine montrée : `ctx.liste` (calculée et gardée par l'app) ; à défaut, calculée ici
 * (coeur/liste.js › listeDeCourses) et gardée tant que ses sources sont les mêmes objets.
 */
export function listeCourante(ctx) {
  if (ctx?.liste) return ctx.liste;
  const m = memoListe;
  if (m.resultat && m.semaine === ctx?.semaine && m.plats === ctx?.tousLesPlats && m.profils === ctx?.profils
    && m.articles === ctx?.articles && m.reglages === ctx?.reglages && m.compat === ctx?.compat
    && m.produits === ctx?.produitsFoyer) {
    return m.resultat;
  }
  const resultat = listeDeCourses(ctx?.semaine ?? null, {
    tousLesPlats: ctx?.tousLesPlats ?? ctx?.plats ?? [],
    profils: ctx?.profils ?? [],
    articles: ctx?.articles ?? [],
    reglages: ctx?.reglages ?? null,
    produitsFoyer: ctx?.produitsFoyer ?? {},
    ...(typeof ctx?.compat === 'function' ? { evaluer: ctx.compat } : {}),
    maintenant: Date.now(),
  });
  memoListe = {
    semaine: ctx?.semaine, plats: ctx?.tousLesPlats, profils: ctx?.profils, articles: ctx?.articles,
    reglages: ctx?.reglages, compat: ctx?.compat, produits: ctx?.produitsFoyer, resultat,
  };
  return resultat;
}

/**
 * Articles pas pris de la semaine qui finit (coeur/liste.js › restes), qui passeront sur la semaine `cible` : seulement
 * quand elle n'a pas encore de plat (`cible.nouvelle` : elle naîtra, ou reprendra après « Annuler », avec ce plat) à la
 * suite de la semaine montrée, dont les courses ont commencé. → [{ libelle, precision, produitId }]
 */
export function restesPour(ctx, cible) {
  if (!cible?.nouvelle || !ctx?.semaine) return [];
  return restes(listeCourante(ctx), ctx.semaine);
}

/** Nom d'un plat pour un texte d'écran : espaces resserrés. */
export const nomDuPlat = (plat) => String(plat?.nom ?? '').replace(/\s+/g, ' ').trim() || 'Plat sans nom';

// ——— Version servie : choix Mer / Végétale, ou version unique ———

let numeroGroupe = 0;

/**
 * Choix de la version d'un profil (deux versions conviennent) : `fieldset` « Pour Adulte B : » avec « 🐟 Mer » et
 * « 🌿 Végétale », la version servie cochée (la mer d'avance). Nœuds gardés d'un rendu à l'autre (le focus reste sur
 * l'option touchée) ; `maj(version, ctx)` les remet à jour. `surChoix(style)` : le style touché.
 * → { noeud, maj }
 */
function creerChoixVersion(surChoix) {
  numeroGroupe += 1;
  const nom = `version-${numeroGroupe}`;
  const legende = el('legend', { class: 'legende-version' });
  const options = new Map(STYLES.map((style) => {
    const input = el('input', {
      type: 'radio',
      name: nom,
      value: style,
      onchange: () => {
        if (input.checked) surChoix(style);
      },
    });
    return [style, { input, label: el('label', { class: 'choix choix-style' }, input, el('span', {}, libelleStyle(style))) }];
  }));
  const noeud = el('fieldset', { class: 'groupe-choix choix-version' },
    legende,
    el('div', { class: 'choix-styles' }, [...options.values()].map((o) => o.label)));
  function maj(version, ctx) {
    ecrireTexte(legende, legendeVersion(version.profil, { moi: ctx?.moi ?? null }));
    for (const [style, { input, label }] of options) {
      label.hidden = !version.auChoix.includes(style);
      if (input.checked !== (version.style === style)) input.checked = version.style === style;
    }
  }
  return { noeud, maj };
}

/**
 * Versions servies d'un plat de la semaine, une par profil : un choix (deux versions conviennent) ou une phrase
 * (« Pour Adulte B : version végétale 🌿 ») ; rien pour un profil sans styles attendus (sa version n'a pas de style).
 * Zone gardée d'un rendu à l'autre. `choisir(profilId, style)` : un toucher sur une option.
 * → { noeud, maj(element, ctx) }
 */
export function creerVersions(choisir) {
  const noeud = el('div', { class: 'versions-plat', hidden: true });
  const choixDesNoeuds = new WeakMap(); // fieldset → sa fonction maj
  function maj(element, ctx) {
    const moi = ctx?.moi ?? null;
    const montrees = (element?.versions ?? []).filter((v) => v.auChoix.length > 1 || texteVersionUnique(v, { moi }));
    reconcilier(noeud, montrees, {
      cle: (v) => `${v.profil.id}|${v.auChoix.length > 1 ? 'choix' : 'texte'}`,
      creer: (v) => {
        if (v.auChoix.length > 1) {
          const choix = creerChoixVersion((style) => choisir(v.profil.id, style));
          choixDesNoeuds.set(choix.noeud, choix.maj);
          choix.maj(v, ctx);
          return choix.noeud;
        }
        return el('p', { class: 'version-unique' }, texteVersionUnique(v, { moi }));
      },
      maj: (n, v) => {
        if (choixDesNoeuds.has(n)) choixDesNoeuds.get(n)(v, ctx);
        else ecrireTexte(n, texteVersionUnique(v, { moi }));
      },
    });
    noeud.hidden = !montrees.length;
  }
  return { noeud, maj };
}

/** Phrase de conservation (« 🐟 La part d'Adulte B se garde 2 jours après cuisson (le plat : 3). ») ; gardée. */
export function creerConservation() {
  const noeud = el('p', { class: 'conservation-plat', hidden: true });
  return {
    noeud,
    maj(element, ctx) {
      const texte = (element ? texteConservation(element, { moi: ctx?.moi ?? null }) : null) ?? '';
      ecrireTexte(noeud, texte);
      noeud.hidden = !texte;
    },
  };
}


// ——— Demandes (T2e) : phrase « 📬 Demandée… », partagée avec la fiche ———

// Suites de la phrase « 📬 Demandée… » : une version (sauf hors ligne, avant le serveur : la phrase dit alors que la
// demande partira au retour du réseau), la recette d'un plat ⏳ (toujours).
const SUITE_VERSION = ' Elle apparaîtra ici dès qu’elle sera prête.';
const SUITE_RECETTE = ' Vous pouvez aussi l’écrire vous-même.';

/**
 * Phrase « 📬 Demandée… » d'une demande ouverte (coeur/demandes.js › texteDemandee), suite comprise (fiche, feuille du
 * plat de la semaine). `pourVersion` : « Elle apparaîtra ici dès qu’elle sera prête. » ; sinon « Vous pouvez aussi
 * l’écrire vous-même. ».
 */
export function phraseDemandee(demande, { pourVersion, horsLigne }) {
  const base = texteDemandee(demande, { horsLigne });
  if (!pourVersion) return `${base}${SUITE_RECETTE}`;
  return dateDemande(demande).enAttente && horsLigne ? base : `${base}${SUITE_VERSION}`;
}

// ——— Feuille du plat de la semaine ———

// Feuilles ouvertes : l'écran qui en a ouvert une (Semaine, fiche) la met à jour à chaque rendu.
const feuillesOuvertes = new Set();

/** Met à jour les feuilles du plat ouvertes avec le contexte du moment. */
export function majPlatsDeLaSemaine(ctx) {
  for (const feuille of [...feuillesOuvertes]) feuille.maj(ctx);
}

let numeroFeuille = 0;

/** Une action peut rendre une valeur ou une promesse : `suite` reçoit la valeur (une promesse rejetée : null). */
function quand(resultat, suite) {
  if (resultat && typeof resultat.then === 'function') resultat.then(suite, () => suite(null));
  else suite(resultat);
}

/**
 * Compteur [−] n [+] nommé (coeur/semaine.js › COMPTEURS : « Repas : 2 », « Adultes invités : 0 ») : étiquette
 * visible (cachée aux lecteurs d'écran : le groupe porte le nom et la valeur), boutons « Un repas de plus »… Nœuds
 * gardés d'un rendu à l'autre : le focus reste sur le bouton touché. `surPas(type, pas)` : un toucher.
 * → { noeud, moins, plus, maj(compteur) }
 */
function creerCompteur(type, surPas) {
  const def = COMPTEURS[type];
  const valeur = el('span', { class: 'compteur-valeur', 'aria-hidden': 'true' });
  const moins = el('button', {
    class: 'compteur-bouton', type: 'button', 'aria-label': def.moins, onclick: () => surPas(type, -1),
  }, el('span', { 'aria-hidden': 'true' }, '−'));
  const plus = el('button', {
    class: 'compteur-bouton', type: 'button', 'aria-label': def.plus, onclick: () => surPas(type, 1),
  }, el('span', { 'aria-hidden': 'true' }, '+'));
  const groupe = el('div', { class: `compteur compteur-${type}`, role: 'group', tabindex: '-1' }, moins, valeur, plus);
  const noeud = el('div', { class: 'ligne-compteur' },
    el('span', { class: 'etiquette-compteur', 'aria-hidden': 'true' }, def.etiquette),
    groupe);
  return {
    noeud,
    moins,
    plus,
    maj(compteur) {
      ecrireTexte(valeur, String(compteur.valeur));
      if (groupe.getAttribute('aria-label') !== compteur.nom) groupe.setAttribute('aria-label', compteur.nom);
      moins.disabled = compteur.valeur <= compteur.min;
      plus.disabled = compteur.valeur >= compteur.max;
    },
  };
}

/**
 * Feuille du plat de la semaine montrée (`ctx.semaine`), modèle de coeur/semaine.js › feuillePlat ; titre = le nom du
 * plat :
 * - « Qui en mange ? » : une case par profil (ordre des profils), cochée selon le réglage du moment ; sous les cases,
 *   la phrase de chacun (« Adulte B : pas encore de version. », « Pas encore de version pour vous : votre part suit la
 *   recette. », « Adulte A a dit « Jamais ». », « Enfant : 🧸 pas avant 1 an (miel). »), reliée à sa case ; dans la vue
 *   « Repas et courses » (gestionnaire en aperçu compris), sous un profil sans version qui convient, « 📬 Demander ma
 *   version » ou « 📬 Demander une version pour Adulte B » si coeur/demandes.js › etatDemande le permet (la feuille se
 *   ferme, puis actions.demander : annonce « C’est demandé. » avec « Annuler », 8 s), sinon la phrase « 📬 Demandée… » ;
 *   jamais pour le gestionnaire hors aperçu ;
 * - « Des invités ? » (replié, ouvert d'avance s'il y a déjà un invité) : « Adultes » et « Enfants » [−] 0 [+] ;
 * - « Pour combien de repas ? » [−] 2 [+], puis la phrase des portions (`role="status"`) ;
 * - Mer / Végétale (même choix que la carte), la conservation ;
 * - « Revenir aux réglages de départ » (bouton texte, si un réglage est écrit), « Voir la recette › », « Retirer de la
 *   semaine ».
 * Plat ⏳ : seulement le bandeau, « Voir la recette › » et « Retirer de la semaine ». Un plat retiré ailleurs ferme la
 * feuille (« Ce plat a été retiré de la semaine. »).
 * Chaque case et chaque compteur écrit son seul chemin (actions.reglerPlat) ; les touchers rapides sont réunis
 * (coeur/semaine.js › fusionnerReglages) et écrits 0,8 s après le dernier, à la fermeture de la feuille et quand l'app
 * passe en arrière-plan ; ce qui est touché se voit tout de suite (appliquerChamps), et rien de ce qui est au-dessus du
 * doigt ne change de hauteur. Un invité ajoute des portions, jamais ne retire un repas. « Revenir aux réglages de
 * départ » part tout de suite (`{ depart: true }`).
 * T4-0, en tête : « ✨ Proposé : vous l’aimez. » (raison retenue sur ce téléphone, ctx.proposition.raison) et
 * « 🔄 Une autre idée » (plat ou dessert avec sa recette, avant les courses faites, s'il y a un remplaçant à
 * l'ouverture ; il reste ensuite tant que la feuille est ouverte) : actions.autreIdee ferme la feuille juste avant
 * d'écrire, puis `onFermer({ viser })` reçoit le nouveau plat (sa carte prend la place de l'ancienne) ; sans autre idée
 * au toucher, « Plus d’autre idée pour l’instant. » sous le bouton, qui garde le focus.
 * `lireCtx()` : le contexte du moment ; `onFermer(suite)` : après la fermeture (rendre le focus ; `suite` : { viser }
 * après « 🔄 », sinon null) ; `apresAnnulation(platId)` : après « Annuler » de « 🔄 » (l'ancien plat revenu).
 * → { maj(ctx), fermer }
 */
export function ouvrirPlatDeLaSemaine(lireCtx, platId, { onFermer, apresAnnulation = null } = {}) {
  let courant = lireCtx();
  const semaineId = lireSemaine(courant.semaine)?.id ?? null;
  numeroFeuille += 1;
  const base = `plat-semaine-${numeroFeuille}`;
  let enAttente = null; // réglage touché, pas encore écrit (touchers réunis)
  // Réglage écrit, montré tant que la semaine reçue est celle d'avant l'écriture (rien ne revient en arrière sous les
  // yeux en attendant que l'écriture apparaisse dans la semaine).
  let envoye = null;
  let semaineAvantEnvoi = null;
  let minuteur = null;
  let ouverte = true;
  let parti = false; // fermée par « Retirer de la semaine » : pas d'annonce « retiré ailleurs »
  let premierDessin = true;
  let titre = '';
  let suite = null; // transmis à onFermer : { viser } après « 🔄 Une autre idée »

  // « ✨ Proposé : … » et « 🔄 Une autre idée » (présence figée à l'ouverture : rien ne disparaît sous le doigt).
  const texteRaisonNoeud = el('span', {});
  const raison = el('p', { class: 'raison-proposee', hidden: true },
    el('span', { 'aria-hidden': 'true' }, `${TEXTES_PROPOSER.emoji}\u00A0`), texteRaisonNoeud);
  const libelleAutre = el('span', {}, TEXTES_PROPOSER.autreIdee.libelle);
  const boutonAutreIdee = el('button', {
    class: 'bouton bouton-secondaire bouton-plein bouton-autre-idee', type: 'button', onclick: toucherAutreIdee,
  }, el('span', { 'aria-hidden': 'true' }, TEXTES_PROPOSER.autreIdee.emoji), libelleAutre);
  boutonAutreIdee.hidden = !courant.proposition?.autreIdee?.(semaineId, platId);
  const statutAutreIdee = el('p', { class: 'message-proposer', role: 'status', hidden: true });

  const sansRecette = el('p', { class: 'bandeau bandeau-alerte', hidden: true }, el('span', {}, TEXTE_SANS_RECETTE));

  // « Qui en mange ? »
  const cases = el('div', { class: 'choix-mangeurs' });
  const phrases = el('div', { class: 'details-mangeurs' });
  const blocQui = el('fieldset', { class: 'groupe-choix qui-en-mange', hidden: true },
    el('legend', { class: 'etiquette-champ' }, TEXTES_PLAT_SEMAINE.quiEnMange),
    cases,
    phrases);
  const partiesCases = new WeakMap(); // label → { input, nom }
  const partiesPhrases = new WeakMap(); // div → { phrase, bloc }
  const idPhrase = (profilId) => `${base}-qui-${profilId}`;

  // Annonce du compteur touché (« Adultes invités : 1 »), puis la phrase des portions (role="status").
  const annonceCompteur = el('span', { class: 'visuellement-masque', 'aria-live': 'polite' });

  // « Des invités ? »
  const compteurs = {
    adultes: creerCompteur('adultes', regler),
    enfants: creerCompteur('enfants', regler),
    repas: creerCompteur('repas', regler),
  };
  const blocInvites = el('details', { class: 'depliable details-invites', hidden: true },
    el('summary', {}, TEXTES_PLAT_SEMAINE.invites),
    el('div', { class: 'depliable-contenu' }, compteurs.adultes.noeud, compteurs.enfants.noeud));

  // « Pour combien de repas ? »
  const portions = el('p', { class: 'phrase-portions', role: 'status' });
  const blocRepas = el('div', { class: 'bloc-repas', hidden: true }, compteurs.repas.noeud, portions);

  const versions = creerVersions((profilId, style) => courant.actions?.choisirStyle?.(platId, profilId, style, { semaineId }));
  const conservation = creerConservation();
  const boutonDepart = el('button', { class: 'bouton bouton-texte', type: 'button', hidden: true, onclick: revenir },
    TEXTES_PLAT_SEMAINE.depart);
  const lienRecette = el('a', {
    class: 'bouton bouton-secondaire bouton-plein',
    href: `#/plat/${encodeURIComponent(platId)}`,
    onclick: () => fermer(),
  }, 'Voir la recette ›');
  // « 👩‍🍳 Cuisiner pas à pas » (T5-1) : plat qui a sa recette et ses étapes ; secondaire, comme « Voir la recette › ».
  const lienCuisiner = el('a', {
    class: 'bouton bouton-secondaire bouton-plein bouton-cuisiner',
    href: `#/cuisiner/${encodeURIComponent(platId)}`,
    'data-action': 'cuisiner',
    hidden: true,
    onclick: () => fermer(),
  }, avecPictogramme(TEXTES_CUISINE.bouton));
  const boutonRetirer = el('button', { class: 'bouton bouton-texte', type: 'button', onclick: retirer }, 'Retirer de la semaine');

  const feuille = ouvrirFeuille(nomDuPlat(platCourant()), () => el('div', { class: 'feuille-plat-semaine' },
    raison, boutonAutreIdee, statutAutreIdee,
    sansRecette, blocQui, blocInvites, blocRepas, annonceCompteur, versions.noeud, conservation.noeud,
    el('div', { class: 'actions-feuille' }, boutonDepart, lienRecette, lienCuisiner, boutonRetirer)), {
    onFermer: () => {
      ouverte = false;
      envoyer();
      feuillesOuvertes.delete(handle);
      document.removeEventListener('visibilitychange', surVisibilite);
      onFermer?.(suite);
    },
  });

  function platCourant() {
    return (courant.tousLesPlats ?? courant.plats ?? []).find((p) => p?.id === platId) ?? null;
  }

  const optionsReglage = () => ({
    ...(typeof courant.compat === 'function' ? { evaluer: courant.compat } : {}),
    tousLesPlats: courant.tousLesPlats ?? courant.plats ?? [],
    profils: courant.profils ?? [],
  });

  /** Semaine `semaine` avec un réglage appliqué (affichage seulement) ; inchangée si le réglage n'écrit rien. */
  function avecReglage(semaine, reglage) {
    if (!reglage) return semaine;
    const ecritures = ecrituresReglage(semaine, platId, reglage, optionsReglage());
    return ecritures.champs ? appliquerChamps(semaine, ecritures.champs) : semaine;
  }

  /**
   * Élément du plat dans la semaine montrée, avec ce qui a été touché (pas encore écrit, ou écrit mais pas encore revenu
   * dans la semaine reçue) : affichage immédiat (appliquerChamps). null si le plat n'y est plus.
   */
  function elementCourant() {
    const lue = lireSemaine(courant.semaine);
    if (!lue || lue.id !== semaineId || !estDansLaSemaine(lue.plats[platId])) return null;
    if (envoye !== null && courant.semaine !== semaineAvantEnvoi) envoye = null;
    const montree = avecReglage(avecReglage(courant.semaine, envoye), enAttente);
    const elements = montree === courant.semaine ? platsDeLaSemaineDe(courant) : platsDeLaSemaineDe(courant, montree);
    return elements.find((e) => e.platId === platId) ?? null;
  }

  /** Modèle de la feuille du moment (coeur/semaine.js › feuillePlat), ou null (plat ⏳, de la corbeille, parti). */
  function modeleCourant() {
    const element = elementCourant();
    return element ? feuillePlat(element, { moi: courant.moi ?? null, role: courant.role ?? null }) : null;
  }

  /** Écrit ce qui a été touché (un seul lot) ; rien s'il n'y a rien. Un réglage refusé n'est plus montré. */
  function envoyer() {
    clearTimeout(minuteur);
    minuteur = null;
    if (enAttente === null) return;
    const reglage = enAttente;
    enAttente = null;
    envoye = reglage;
    semaineAvantEnvoi = courant.semaine;
    quand(courant.actions?.reglerPlat?.(platId, reglage, { semaineId }), (resultat) => {
      if (resultat?.code === 'ok' || envoye !== reglage) return;
      envoye = null;
      if (ouverte) dessiner();
    });
  }

  function surVisibilite() {
    if (document.visibilityState === 'hidden') envoyer();
  }
  document.addEventListener('visibilitychange', surVisibilite);

  /** Un toucher : réuni à ceux qui attendent, écrit 0,8 s après le dernier. */
  function toucher(reglage) {
    enAttente = fusionnerReglages(enAttente, reglage);
    clearTimeout(minuteur);
    minuteur = setTimeout(envoyer, DELAI_REGROUPEMENT_MS);
  }

  /** Case « Qui en mange ? » touchée : `plats.<id>.mange.<profilId>` (le défaut du moment efface le chemin). */
  function toucherCase(profilId, input) {
    if (!modeleCourant()) {
      dessiner();
      return;
    }
    vibrer();
    toucher({ mange: { [profilId]: input.checked } });
    dessiner();
  }

  /** Compteur touché (repas, invités adultes ou enfants) : la nouvelle valeur, bornée, montrée tout de suite. */
  function regler(type, pas) {
    const modele = modeleCourant();
    const compteur = modele?.compteurs[type];
    if (!compteur) return;
    const nouveau = Math.min(compteur.max, Math.max(compteur.min, compteur.valeur + pas));
    if (nouveau === compteur.valeur) return;
    toucher(type === 'repas' ? { repas: nouveau } : { invites: { [type]: nouveau } });
    dessiner({ annonce: type });
    // Borne atteinte : le focus passe à l'autre bouton du même compteur, il n'est pas perdu.
    const { moins, plus } = compteurs[type];
    const presse = pas < 0 ? moins : plus;
    if (presse.disabled) (pas < 0 ? plus : moins).focus();
  }

  /** « Revenir aux réglages de départ » : tous les réglages écrits du plat effacés, tout de suite. */
  function revenir() {
    enAttente = fusionnerReglages(enAttente, { depart: true });
    envoyer();
    if (!ouverte) return;
    dessiner();
    // Le bouton disparaît avec les réglages : le focus passe à « Voir la recette › », juste après lui.
    if (boutonDepart.hidden) lienRecette.focus();
  }

  function retirer() {
    parti = true;
    envoyer();
    fermer();
    courant.actions?.retirerDeLaSemaine?.(platId, { semaineId });
  }

  function fermer() {
    if (ouverte) feuille.fermer();
  }

  /**
   * « 🔄 Une autre idée » : ce qui a été touché part d'abord, puis l'action écrit l'échange ; la feuille se ferme juste
   * avant (le focus ira à la carte du nouveau plat). Sans autre idée : la phrase sous le bouton, le focus y reste.
   */
  function toucherAutreIdee() {
    if (typeof courant.actions?.autreIdee !== 'function') return;
    ecrireTexte(statutAutreIdee, '');
    statutAutreIdee.hidden = true;
    envoyer();
    const resultat = courant.actions.autreIdee(platId, {
      semaineId,
      apresAnnulation,
      avant: (nouveau) => {
        parti = true;
        suite = { viser: nouveau };
        fermer();
      },
    });
    if (resultat?.code === 'ok') {
      vibrer();
      return;
    }
    if (!ouverte || !feuille.dialogue.open) return;
    parti = false;
    suite = null;
    if (resultat?.code === 'aucune') {
      ecrireTexte(statutAutreIdee, TEXTES_PROPOSER.autreIdee.aucune);
      statutAutreIdee.hidden = false;
      boutonAutreIdee.focus();
    }
  }

  // ——— « 📬 Demander ma version » (vue « Repas et courses ») ———

  /** Bloc d'une demande de version : le bouton, ou à sa place la phrase « 📬 Demandée… » ; gardé par profil. */
  function creerBlocDemande(profilId) {
    const libelle = el('span', {});
    const bouton = el('button', {
      class: 'bouton bouton-secondaire bouton-plein', type: 'button', onclick: () => demander(profilId),
    }, el('span', { 'aria-hidden': 'true' }, '📬'), libelle);
    const texte = el('span', {});
    const phrase = el('p', { class: 'demande-etat' }, el('span', { 'aria-hidden': 'true' }, '📬\u00A0'), texte);
    return { noeud: el('div', { class: 'bloc-demande' }, bouton, phrase), bouton, libelle, phrase, texte };
  }

  /** Textes du bloc, réécrits seulement s'ils changent ; rien à montrer : bloc caché. */
  function ecrireBloc(bloc, { libelle = null, phrase = null }) {
    ecrireTexte(bloc.libelle, libelle ?? '');
    ecrireTexte(bloc.texte, phrase ?? '');
    bloc.bouton.hidden = libelle === null;
    bloc.phrase.hidden = phrase === null;
    bloc.noeud.hidden = libelle === null && phrase === null;
  }

  /**
   * « 📬 Demander… » : la feuille se ferme d'abord (tant qu'une feuille est ouverte, le reste de l'écran est inerte :
   * l'annonce « C’est demandé. » et son « Annuler » ne seraient ni touchables ni lus), puis l'app écrit la demande et
   * l'annonce ; « Annuler » rend le focus là où la fermeture l'avait mis (la carte du plat, le bouton de la fiche). La
   * feuille rouverte montre la phrase « 📬 Demandée… ».
   */
  function demander(profilId) {
    const actions = courant.actions;
    if (typeof actions?.demander !== 'function') return;
    fermer();
    actions.demander({ platId, profilId, apresAnnulation: () => onFermer?.() });
  }

  /**
   * Demande de version possible ou ouverte pour chaque case qui peut en porter une (feuillePlat › `demande` : vue
   * « Repas et courses », profil sans version qui convient), une fois les demandes chargées : Map profilId → null |
   * { possible, id } | { ouverte }.
   */
  function situationsDemande(plat, qui) {
    if (!courant.demandesChargees) return new Map();
    const options = { demandes: courant.demandes ?? [], ...(typeof courant.compat === 'function' ? { evaluer: courant.compat } : {}) };
    return new Map(qui.filter((q) => q.demande).map((q) => [q.profil.id, etatDemande(plat, q.profil, options)]));
  }

  // ——— Dessin ———

  function creerCase(q) {
    const input = el('input', { class: 'case-choix', type: 'checkbox' });
    input.addEventListener('change', () => toucherCase(q.profil.id, input));
    const nom = el('span', { class: 'choix-mangeur-nom' });
    const label = el('label', { class: 'choix choix-mangeur' }, input, nom);
    partiesCases.set(label, { input, nom });
    majCase(label, q);
    return label;
  }

  function majCase(label, q) {
    const { input, nom } = partiesCases.get(label);
    ecrireTexte(nom, q.libelle);
    if (input.checked !== q.coche) input.checked = q.coche;
    const decrit = q.texte ? idPhrase(q.profil.id) : null;
    if (decrit) {
      if (input.getAttribute('aria-describedby') !== decrit) input.setAttribute('aria-describedby', decrit);
    } else input.removeAttribute('aria-describedby');
  }

  function creerPhrase({ q, situation }) {
    const phrase = el('p', { class: 'phrase-mangeur', id: idPhrase(q.profil.id) });
    const bloc = creerBlocDemande(q.profil.id);
    const noeud = el('div', { class: 'detail-mangeur', 'data-profil': q.profil.id }, phrase, bloc.noeud);
    partiesPhrases.set(noeud, { phrase, bloc });
    majPhrase(noeud, { q, situation });
    return noeud;
  }

  function majPhrase(noeud, { q, situation }) {
    const { phrase, bloc } = partiesPhrases.get(noeud);
    ecrireTexte(phrase, q.texte ?? '');
    phrase.hidden = !q.texte;
    const horsLigne = !(courant.enLigne ?? navigator.onLine);
    if (situation?.ouverte) ecrireBloc(bloc, { phrase: phraseDemandee(situation.ouverte, { pourVersion: true, horsLigne }) });
    else if (situation?.possible) ecrireBloc(bloc, { libelle: q.libelleDemande });
    else ecrireBloc(bloc, {});
  }

  function dessiner({ annonce = null } = {}) {
    const plat = platCourant();
    const element = elementCourant();
    if (!element || !plat) {
      // Retiré ailleurs (ou la semaine montrée a changé) : la feuille n'a plus d'objet.
      const memeSemaine = lireSemaine(courant.semaine)?.id === semaineId;
      fermer();
      if (!parti && memeSemaine) annoncer('Ce plat a été retiré de la semaine.');
      return;
    }
    const nom = nomDuPlat(plat);
    if (nom !== titre) {
      titre = nom;
      feuille.definirTitre(nom);
      boutonAutreIdee.setAttribute('aria-label', nomAutreIdee(nom));
    }
    const texteProposee = texteRaison(courant.proposition?.raison?.(semaineId, platId) ?? null, {
      moi: courant.moi ?? null, profils: courant.profils ?? [],
    });
    // L'emoji est à part (span aria-hidden) : « Proposé : vous l’aimez. » pour les lecteurs d'écran.
    const debutRaison = `${TEXTES_PROPOSER.emoji} `;
    const sansEmoji = texteProposee?.startsWith(debutRaison) ? texteProposee.slice(debutRaison.length) : texteProposee;
    ecrireTexte(texteRaisonNoeud, sansEmoji ?? '');
    raison.hidden = !sansEmoji;
    const modele = feuillePlat(element, { moi: courant.moi ?? null, role: courant.role ?? null });
    sansRecette.hidden = element.etat !== 'sansRecette';

    // « Qui en mange ? » : cases, puis la phrase et la demande de chacun.
    const qui = modele?.qui ?? [];
    const situations = modele ? situationsDemande(element.plat, qui) : new Map();
    reconcilier(cases, qui, { cle: (q) => q.profil.id, creer: creerCase, maj: majCase });
    const details = qui.map((q) => ({ q, situation: situations.get(q.profil.id) ?? null }))
      .filter(({ q, situation }) => q.texte || situation?.ouverte || situation?.possible);
    reconcilier(phrases, details, { cle: ({ q }) => q.profil.id, creer: creerPhrase, maj: majPhrase });
    phrases.hidden = !details.length;
    blocQui.hidden = !qui.length;

    // « Des invités ? », « Pour combien de repas ? », phrase des portions.
    blocInvites.hidden = !modele;
    blocRepas.hidden = !modele;
    if (modele) {
      if (premierDessin && modele.invites.ouvert) blocInvites.open = true;
      premierDessin = false;
      for (const type of Object.keys(compteurs)) compteurs[type].maj(modele.compteurs[type]);
      if (annonce) ecrireTexte(annonceCompteur, modele.compteurs[annonce]?.nom ?? '');
      ecrireTexte(portions, modele.portions ?? '');
    }
    versions.maj(modele ? element : null, courant);
    conservation.maj(modele ? element : null, courant);
    boutonDepart.hidden = !modele?.depart;
    lienCuisiner.hidden = !peutCuisiner(plat);
  }

  const handle = {
    maj(ctx) {
      if (!ouverte) return;
      courant = ctx;
      dessiner();
    },
    fermer,
  };
  feuillesOuvertes.add(handle);
  dessiner();
  return handle;
}
