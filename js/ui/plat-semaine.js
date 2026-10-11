// Plat de la semaine (T3a) : feuille du plat (« Pour combien de repas ? », Mer / Végétale, conservation, « Voir la
// recette », « Retirer de la semaine »), et ce que la carte du plat sur Semaine partage avec elle : le choix de la
// version (« Pour Adulte B : 🐟 Mer · 🌿 Végétale », mer d'avance, seulement quand deux versions conviennent), la
// version unique (« Pour vous : version mer 🐟 ») et la conservation de la part la plus fragile (non bloquant).
// Rien n'est écrit à l'ouverture : le compteur écrit `plats.<id>.repas` quand on le touche (touchers regroupés 0,8 s,
// affichage immédiat), et un choix de version écrit `plats.<id>.styles.<profilId>`. T3c complétera la feuille (« Qui en
// mange ? », invités, « 📬 Demander ma version »).
import { el, annoncer, ecrireTexte, reconcilier } from './dom.js';
import { ouvrirFeuille } from './feuille.js';
import {
  REPAS_MAX, TEXTE_SANS_RECETTE, appliquerChamps, estDansLaSemaine, legendeVersion, libelleStyle, lireSemaine,
  phrasePortions, platsDeLaSemaine, raisonsEcartes, resumePlat, texteConservation, texteVersionUnique,
} from '../coeur/semaine.js';
import { listeDeCourses, restes } from '../coeur/liste.js';
import { STYLES } from '../coeur/vocabulaire.js';

/** Touchers rapides sur le compteur : une seule écriture, 0,8 s après le dernier. */
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
    && m.articles === ctx?.articles && m.reglages === ctx?.reglages && m.compat === ctx?.compat) {
    return m.resultat;
  }
  const resultat = listeDeCourses(ctx?.semaine ?? null, {
    tousLesPlats: ctx?.tousLesPlats ?? ctx?.plats ?? [],
    profils: ctx?.profils ?? [],
    articles: ctx?.articles ?? [],
    reglages: ctx?.reglages ?? null,
    ...(typeof ctx?.compat === 'function' ? { evaluer: ctx.compat } : {}),
    maintenant: Date.now(),
  });
  memoListe = {
    semaine: ctx?.semaine, plats: ctx?.tousLesPlats, profils: ctx?.profils, articles: ctx?.articles,
    reglages: ctx?.reglages, compat: ctx?.compat, resultat,
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

// ——— Feuille du plat de la semaine ———

// Feuilles ouvertes : l'écran qui en a ouvert une (Semaine, fiche) la met à jour à chaque rendu.
const feuillesOuvertes = new Set();

/** Met à jour les feuilles du plat ouvertes avec le contexte du moment. */
export function majPlatsDeLaSemaine(ctx) {
  for (const feuille of [...feuillesOuvertes]) feuille.maj(ctx);
}

/**
 * Feuille du plat de la semaine montrée (`ctx.semaine`) : titre = le nom du plat ; résumé, une ligne par profil
 * écarté avec sa raison, « Pour combien de repas ? » [−] 2 [+] (compteur « Repas : 2 », de 1 à 14) et la phrase des
 * portions (`role="status"`), la version (même choix que la carte), la conservation, « Voir la recette › » et
 * « Retirer de la semaine ». Un plat retiré ailleurs ferme la feuille (« Ce plat a été retiré de la semaine. »).
 * Le compteur écrit dès qu'il est touché, même s'il revient au défaut du moment (touchers regroupés 0,8 s, écriture
 * faite aussi à la fermeture et quand l'app passe en arrière-plan) ; la valeur touchée est montrée tout de suite.
 * `lireCtx()` : le contexte du moment ; `onFermer` : après la fermeture (rendre le focus).
 * → { maj(ctx), fermer }
 */
export function ouvrirPlatDeLaSemaine(lireCtx, platId, { onFermer } = {}) {
  let courant = lireCtx();
  const semaineId = lireSemaine(courant.semaine)?.id ?? null;
  let repasEnAttente = null; // nombre de repas touché, pas encore écrit
  // Nombre de repas écrit, montré tant que la semaine reçue est celle d'avant l'écriture (rien ne revient en arrière
  // sous les yeux en attendant que l'écriture apparaisse dans la semaine).
  let repasEnvoye = null;
  let semaineAvantEnvoi = null;
  let minuteur = null;
  let ouverte = true;
  let parti = false; // fermée par « Retirer de la semaine » : pas d'annonce « retiré ailleurs »

  const resume = el('p', { class: 'resume-plat-feuille' });
  const ecartes = el('ul', { class: 'liste-ecartes' });
  const sansRecette = el('p', { class: 'bandeau bandeau-alerte', hidden: true }, el('span', {}, TEXTE_SANS_RECETTE));
  const valeur = el('span', { class: 'compteur-valeur', 'aria-hidden': 'true' });
  const boutonMoins = el('button', {
    class: 'compteur-bouton', type: 'button', 'aria-label': 'Un repas de moins', onclick: () => regler(-1),
  }, el('span', { 'aria-hidden': 'true' }, '−'));
  const boutonPlus = el('button', {
    class: 'compteur-bouton', type: 'button', 'aria-label': 'Un repas de plus', onclick: () => regler(1),
  }, el('span', { 'aria-hidden': 'true' }, '+'));
  // Le compteur se nomme « Repas : 2 » ; la nouvelle valeur est annoncée après un toucher, puis la phrase des portions.
  const groupe = el('div', { class: 'compteur', role: 'group', tabindex: '-1' }, boutonMoins, valeur, boutonPlus);
  const nomCompteur = el('span', { class: 'visuellement-masque', 'aria-live': 'polite' });
  const portions = el('p', { class: 'phrase-portions', role: 'status' });
  const blocRepas = el('div', { class: 'bloc-repas' },
    el('div', { class: 'ligne-compteur' },
      el('span', { class: 'etiquette-compteur', 'aria-hidden': 'true' }, 'Pour combien de repas\u00A0?'),
      groupe),
    nomCompteur,
    portions);
  const versions = creerVersions((profilId, style) => courant.actions?.choisirStyle?.(platId, profilId, style, { semaineId }));
  const conservation = creerConservation();
  const lienRecette = el('a', {
    class: 'bouton bouton-secondaire bouton-plein',
    href: `#/plat/${encodeURIComponent(platId)}`,
    onclick: () => fermer(),
  }, 'Voir la recette ›');
  const boutonRetirer = el('button', { class: 'bouton bouton-texte', type: 'button', onclick: retirer }, 'Retirer de la semaine');

  const feuille = ouvrirFeuille(nomDuPlat(platCourant()), () => el('div', { class: 'feuille-plat-semaine' },
    resume, sansRecette, ecartes, blocRepas, versions.noeud, conservation.noeud,
    el('div', { class: 'actions-feuille' }, lienRecette, boutonRetirer)), {
    onFermer: () => {
      ouverte = false;
      envoyerRepas();
      feuillesOuvertes.delete(handle);
      document.removeEventListener('visibilitychange', surVisibilite);
      onFermer?.();
    },
  });

  function platCourant() {
    return (courant.tousLesPlats ?? courant.plats ?? []).find((p) => p?.id === platId) ?? null;
  }

  /**
   * Élément du plat dans la semaine montrée, avec le nombre de repas touché (pas encore écrit, ou écrit mais pas encore
   * revenu dans la semaine reçue) : affichage immédiat (appliquerChamps). null si le plat n'y est plus.
   */
  function elementCourant() {
    const lue = lireSemaine(courant.semaine);
    if (!lue || lue.id !== semaineId || !estDansLaSemaine(lue.plats[platId])) return null;
    if (repasEnvoye !== null && courant.semaine !== semaineAvantEnvoi) repasEnvoye = null;
    const affiche = repasEnAttente ?? repasEnvoye;
    const elements = affiche === null ? platsDeLaSemaineDe(courant)
      : platsDeLaSemaineDe(courant, appliquerChamps(courant.semaine, { [`plats.${platId}.repas`]: affiche }));
    return elements.find((e) => e.platId === platId) ?? null;
  }

  function envoyerRepas() {
    clearTimeout(minuteur);
    minuteur = null;
    if (repasEnAttente === null) return;
    const repas = repasEnAttente;
    repasEnAttente = null;
    repasEnvoye = repas;
    semaineAvantEnvoi = courant.semaine;
    courant.actions?.reglerPlat?.(platId, { repas }, { semaineId });
  }

  function surVisibilite() {
    if (document.visibilityState === 'hidden') envoyerRepas();
  }
  document.addEventListener('visibilitychange', surVisibilite);

  function regler(pas) {
    const element = elementCourant();
    if (!element || element.etat !== 'ok') return;
    const depart = element.repas;
    const nouveau = Math.min(REPAS_MAX, Math.max(1, depart + pas));
    if (nouveau === depart) return;
    repasEnAttente = nouveau;
    clearTimeout(minuteur);
    minuteur = setTimeout(envoyerRepas, DELAI_REGROUPEMENT_MS);
    dessiner({ annoncerRepas: true });
    // Borne atteinte : le focus passe à l'autre bouton, il n'est pas perdu.
    const presse = pas < 0 ? boutonMoins : boutonPlus;
    if (presse.disabled) (pas < 0 ? boutonPlus : boutonMoins).focus();
  }

  function retirer() {
    parti = true;
    envoyerRepas();
    fermer();
    courant.actions?.retirerDeLaSemaine?.(platId, { semaineId });
  }

  function fermer() {
    if (ouverte) feuille.fermer();
  }

  function dessiner({ annoncerRepas = false } = {}) {
    const plat = platCourant();
    const element = elementCourant();
    if (!element || !plat) {
      // Retiré ailleurs (ou la semaine montrée a changé) : la feuille n'a plus d'objet.
      const memeSemaine = lireSemaine(courant.semaine)?.id === semaineId;
      fermer();
      if (!parti && memeSemaine) annoncer('Ce plat a été retiré de la semaine.');
      return;
    }
    feuille.definirTitre(nomDuPlat(plat));
    const ok = element.etat === 'ok';
    const texteResume = resumePlat(element) ?? '';
    ecrireTexte(resume, texteResume);
    resume.hidden = !texteResume;
    sansRecette.hidden = element.etat !== 'sansRecette';
    reconcilier(ecartes, raisonsEcartes(element, { moi: courant.moi ?? null, role: courant.role ?? null }), {
      cle: (r) => r.profil.id,
      creer: (r) => el('li', {}, r.texte),
      maj: (n, r) => ecrireTexte(n, r.texte),
    });
    ecartes.hidden = !ecartes.children.length;
    blocRepas.hidden = !ok;
    if (ok) {
      const nom = `Repas\u00A0: ${element.repas}`;
      ecrireTexte(valeur, String(element.repas));
      if (groupe.getAttribute('aria-label') !== nom) groupe.setAttribute('aria-label', nom);
      if (annoncerRepas) ecrireTexte(nomCompteur, nom);
      boutonMoins.disabled = element.repas <= 1;
      boutonPlus.disabled = element.repas >= REPAS_MAX;
      ecrireTexte(portions, phrasePortions(element) ?? '');
    }
    versions.maj(ok ? element : null, courant);
    conservation.maj(ok ? element : null, courant);
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
