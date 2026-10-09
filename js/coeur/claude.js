// Textes copiés pour le Projet Claude (CLAUDE.md §8, T2b) : demande de recette (avec les versions des profils qui ont
// des règles), demande groupée de versions, demande d'idées de plats (T2b+), corrections. Logique pure : ni DOM ni
// Firebase.
// Chaque texte porte en deuxième ligne la version des instructions attendue (docs/projet-claude.md, section 0).
// Les identifiants de profil et leurs règles ne vont qu'au presse-papiers ; jamais d'adresse, de prénom ni d'âge.
// N'importe jamais paquet.js (qui garde la lecture des réponses) : pas de cycle.
import { decrireRegles, lireRegime, stylesAttendus } from './regles.js';
import { evaluer, profilsContraints } from './compatibilite.js';
import { NOTE_MAX, noteDe } from './notes.js';
import { slug } from './slug.js';
import { estDansCorbeille } from './corbeille.js';
import { VOCABULAIRES, code, texte } from './vocabulaire.js';

const FORMAT = 'paquet@1';

/** Version des instructions du projet Claude (docs/projet-claude.md, en tête) : +1 à chaque modification du fichier. */
export const VERSION_INSTRUCTIONS = 3;
/** Empreinte de docs/projet-claude.md (sha256, 12 premiers caractères hex) : un test échoue si le fichier change sans
 * que VERSION_INSTRUCTIONS augmente. */
export const EMPREINTE_INSTRUCTIONS = '38949d3b1ad5';

/** Deuxième ligne de chaque texte copié : Claude refuse une demande écrite pour d'autres instructions que les siennes. */
const LIGNE_INSTRUCTIONS = `instructions: ${VERSION_INSTRUCTIONS}`;

/** Nombre de plats d'une demande groupée de versions : une réponse plus longue risque d'être coupée. */
export const LOT_VERSIONS = 10;

/** Nombre d'idées proposé par défaut, et choix possibles (feuille « Idées de plats »). */
export const IDEES_NOMBRES = [5, 10, 15];
export const IDEES_NOMBRE_DEFAUT = 15;
/** Recettes par message de Claude : on colle chaque message, puis on écrit « suite » pour les suivantes. */
export const IDEES_PAR_MESSAGE = 5;
/** Longueur de l'envie facultative (une ligne). */
export const IDEES_ENVIE_MAX = 120;
/** Noms au plus des lignes « aimés » et « évités ». */
export const IDEES_NOMS_MAX = 20;
/**
 * `source` d'une fiche rendue pour DEMANDE-IDEES : une idée qui vise un plat qui a déjà sa recette n'est pas reprise
 * (paquet.js › preparerImport, statut `deja`).
 */
export const SOURCE_IDEE = 'Idée de Claude';
// Appareils annoncés quand les réglages n'en disent rien (monsieur_cuisine : seulement s'il est actif).
const APPAREILS_PAR_DEFAUT = ['plaque', 'four', 'cookeo', 'airfryer'];

// Critères de toute demande d'idées (décision du propriétaire) : plats originaux, faciles à faire en batch.
const CRITERES_IDEES = 'plats originaux (pas les grands classiques), faciles à faire en batch : préparation simple, se gardent 3 jours au frigo, se réchauffent bien, se congèlent de préférence ; pour toute la famille, jeune enfant compris ; surtout des plats, un ou deux desserts.';
// Dernière ligne d'une demande d'idées.
const CONSIGNE_IDEES = `(Rends ${IDEES_PAR_MESSAGE} fiches complètes par message, chacune avec un \`id\` nouveau (slug du nom), \`"statutRecette": "brouillon"\` et \`"source": "${SOURCE_IDEE}"\`, et leurs variantes comme pour DEMANDE-RECETTE. Aucun nom de la ligne « déjà dans l'app ». Après chaque message, attends « suite » pour les ${IDEES_PAR_MESSAGE} suivantes. Un seul bloc par message.)`;
// Dernière ligne d'une demande de recette avec des versions.
const CONSIGNE_RECETTE = '(Si le plat contient ce qu\'un de ces profils ne mange pas, ajoute sa variante — une par style indiqué, avec `style` (et `frigoJours` pour `mer`) : remplace ce qui est retiré par une vraie alternative, riche en goût et en texture (section 4). Rends la fiche complète, en un seul bloc.)';
// Consigne d'une demande groupée de versions : une seule version par plat (profil sans style attendu)…
const CONSIGNE_VARIANTES = '(Pour chaque plat, rends seulement { "id", "nom", "variantes": [la variante pour ce profil] }, jamais la recette entière. Remplace ce qui est retiré par une vraie alternative, riche en goût et en texture (section 4). Tous les plats dans un seul bloc paquet@1. Un plat impossible à adapter : ne le rends pas, et dis-le en une phrase.)';
// … ou une par style de sa ligne « à faire » (fusion par style : les autres versions restent).
const CONSIGNE_STYLES = '(Pour chaque plat, rends seulement { "id", "nom", "variantes": [les versions de sa ligne « à faire »] }, jamais la recette entière. Une version par style, avec `style` (et `frigoJours` pour `mer`) ; une version que tu rends remplace celle du même style, les autres restent. Remplace ce qui est retiré par une vraie alternative, riche en goût et en texture (section 4). Tous les plats dans un seul bloc paquet@1. Un plat impossible à adapter : ne le rends pas, et dis-le en une phrase.)';

const estObjet = (valeur) => Boolean(valeur) && typeof valeur === 'object' && !Array.isArray(valeur);

/** Une ligne de texte, sans retour à la ligne (un nom saisi ne casse jamais la forme du texte copié). */
const ligne = (valeur) => texte(typeof valeur === 'number' ? String(valeur) : valeur);

/** Règles actives d'exclusion d'un profil, en codes, pour le cas où decrireRegles ne sait pas les dire en clair. */
function reglesEnCodes(profil) {
  const morceaux = [];
  for (const regle of Array.isArray(profil?.regles) ? profil.regles : []) {
    if (!estObjet(regle) || regle.actif === false || regle.severite === 'preference') continue;
    if (regle.type === 'exclureMarqueurs' && Array.isArray(regle.marqueurs) && regle.marqueurs.length) {
      const sauf = Array.isArray(regle.saufMarqueurs) && regle.saufMarqueurs.length ? ` (sauf ${regle.saufMarqueurs.join(', ')})` : '';
      morceaux.push(`exclut les marqueurs ${regle.marqueurs.join(', ')}${sauf}`);
    } else if (regle.type === 'exclureProduits' && Array.isArray(regle.produits) && regle.produits.length) {
      morceaux.push(`évite ${regle.produits.map(ligne).filter(Boolean).join(', ')}`);
    }
  }
  return morceaux.length ? `${morceaux.join(' ; ')}.` : '';
}

/**
 * Ce que mange le profil, pour Claude : la phrase de l'écran du régime (régime reconnu, produits évités), puis, en
 * codes, toute autre règle d'exclusion active qu'elle ne dit pas (règle gardée telle quelle, profil restauré, règle
 * d'âge…) : evaluer les applique, Claude doit les connaître.
 */
function reglesPourClaude(profil) {
  const phrase = ligne(decrireRegles(profil));
  const { autres } = lireRegime(profil?.regles);
  const nonDites = reglesEnCodes({ regles: autres.filter((regle) => !estObjet(regle) || regle.type !== 'exclureProduits') });
  if (!phrase) return reglesEnCodes(profil);
  return nonDites ? `${phrase} ${nonDites.charAt(0).toLocaleUpperCase('fr-FR')}${nonDites.slice(1)}` : phrase;
}

/** « 800 g bœuf à braiser », « 2 oignon jaune » (l'unité « pc » est sous-entendue). */
function quantite(ingredient, champ = 'qte') {
  const unite = ligne(ingredient?.unite);
  return [ligne(ingredient?.[champ]), unite === 'pc' ? '' : unite, ligne(ingredient?.produit)].filter(Boolean).join(' ');
}

/**
 * Bloc `versions:` d'une demande de fiche complète (DEMANDE-RECETTE, DEMANDE-IDEES) : une ligne par profil contraint
 * (ordre d'affichage) ; un profil qui attend des styles (regles.js › stylesAttendus) les annonce en fin de ligne
 * (« — styles: mer, vegetal » ; « — styles: vegetal » pour un plat déjà connu comme dessert ou accompagnement ; sans
 * plat connu, tous les styles du profil). [] sans profil contraint.
 */
function lignesVersions(profils, plat = null) {
  const contraints = profilsContraints(profils).filter((profil) => typeof profil.id === 'string' && profil.id);
  if (!contraints.length) return [];
  return ['versions:', ...contraints.map((profil) => {
    const styles = stylesAttendus(profil, plat);
    return `- pour: ${profil.id} — ${reglesPourClaude(profil)}${styles.length ? ` — styles: ${styles.join(', ')}` : ''}`;
  })];
}

/**
 * (a) Texte copié par « Demander à Claude » pour une recette à ajouter. Sans profil qui a des règles : texte de T1b
 * (plus la ligne de version des instructions). Sinon, une ligne `versions:` par profil contraint (lignesVersions),
 * pour que Claude rende la fiche complète avec leurs variantes.
 */
export function texteDemandeRecette(plat, { profils = [] } = {}) {
  const versions = lignesVersions(profils, plat);
  const lignes = [
    `DEMANDE-RECETTE ${FORMAT}`,
    LIGNE_INSTRUCTIONS,
    `id: ${ligne(plat?.id)}`,
    `nom: ${ligne(plat?.nom)}`,
    ...versions,
  ];
  lignes.push('(Ajoute un lien, une photo ou la recette dictée.)');
  if (versions.length) lignes.push(CONSIGNE_RECETTE);
  return lignes.join('\n');
}

const comparerNoms = new Intl.Collator('fr', { sensitivity: 'base' }).compare;

/** Noms sur une ligne, non vides, sans doublon (même nom à la casse et aux accents près), dans l'ordre reçu. */
function nomsDistincts(noms) {
  const vus = new Set();
  const distincts = [];
  for (const nom of noms.map(ligne)) {
    const cle = slug(nom);
    if (!nom || vus.has(cle)) continue;
    vus.add(cle);
    distincts.push(nom);
  }
  return distincts;
}

/**
 * Noms des plats notés `note` par au moins un des profils de l'app (les notes d'un profil retiré sont ignorées),
 * IDEES_NOMS_MAX au plus : d'abord ceux qu'ont notés ainsi le plus de profils, puis par nom ; rendus dans l'ordre
 * alphabétique.
 */
function nomsNotes(plats, profils, note) {
  const ids = profils.filter(estObjet).map((profil) => profil.id).filter((id) => typeof id === 'string' && id);
  const comptes = [];
  for (const plat of plats) {
    const combien = ids.filter((id) => noteDe(plat, id) === note).length;
    if (combien) comptes.push({ nom: ligne(plat.nom), combien });
  }
  comptes.sort((a, b) => b.combien - a.combien || comparerNoms(a.nom, b.nom));
  return nomsDistincts(comptes.map((c) => c.nom)).slice(0, IDEES_NOMS_MAX).sort(comparerNoms);
}

/**
 * Codes des appareils actifs des réglages (`reglages/foyer.appareils` : codes, ou objets { id | appareil | code,
 * actif }), dans l'ordre du vocabulaire ; `monsieur_cuisine` seulement s'il est actif. Sans liste lisible ni appareil
 * actif : plaque, four, cookeo, airfryer.
 */
function appareilsActifs(appareils) {
  const actifs = new Set();
  for (const appareil of Array.isArray(appareils) ? appareils : []) {
    if (estObjet(appareil) && appareil.actif === false) continue;
    const brut = estObjet(appareil) ? [appareil.id, appareil.appareil, appareil.code].find((v) => typeof v === 'string') : appareil;
    const valeur = code(brut);
    if (VOCABULAIRES.appareil.includes(valeur)) actifs.add(valeur);
  }
  const ordonnes = VOCABULAIRES.appareil.filter((valeur) => actifs.has(valeur));
  return ordonnes.length ? ordonnes : APPAREILS_PAR_DEFAUT;
}

/** Envie facultative (texte) : une ligne, espaces réduits, IDEES_ENVIE_MAX caractères au plus (jamais un emoji coupé). */
function envieLue(envie) {
  return [...texte(envie)].slice(0, IDEES_ENVIE_MAX).join('').trim();
}

/**
 * (c) Texte copié par « Demander des idées » (Semaine, gestionnaire ; T2b+) : Claude propose des plats originaux,
 * faciles à faire en batch, IDEES_PAR_MESSAGE fiches complètes par message (on écrit « suite » pour les suivantes).
 * `nombre` ∈ IDEES_NOMBRES (nombre ou texte de chiffres ; sinon IDEES_NOMBRE_DEFAUT) ; `envie` : texte libre
 * facultatif (une ligne, IDEES_ENVIE_MAX caractères au plus) ; `plats` : tous les plats de l'app (noms à éviter, ⏳ et
 * corbeille compris ; notes « J'adore » et « Jamais » des profils de l'app, un plat de la corbeille n'étant jamais
 * « aimé ») ; `profils` : profils de l'app (bloc `versions:`, comme DEMANDE-RECETTE, plat inconnu : tous les styles du
 * profil ; notes) ; `appareils` : reglages.appareils (appareils actifs, sinon plaque, four, cookeo, airfryer). Lignes `envie`, `versions`, `aimés`, `évités` et `déjà dans l'app`
 * omises quand elles sont vides.
 */
export function texteDemandeIdees({ nombre = IDEES_NOMBRE_DEFAUT, envie = '', plats = [], profils = [], appareils = null } = {}) {
  const lu = typeof nombre === 'string' && /^\s*\d+\s*$/.test(nombre) ? Number(nombre) : nombre;
  const combien = IDEES_NOMBRES.includes(lu) ? lu : IDEES_NOMBRE_DEFAUT;
  const fiches = (Array.isArray(plats) ? plats : []).filter(estObjet);
  const lesProfils = Array.isArray(profils) ? profils : [];
  const souhait = envieLue(envie);
  // Un plat mis à la corbeille n'est plus un modèle à suivre, même noté « J'adore » ; il reste dans « évités » et « déjà ».
  const aimes = nomsNotes(fiches.filter((plat) => !estDansCorbeille(plat)), lesProfils, NOTE_MAX);
  const evites = nomsNotes(fiches, lesProfils, 0);
  const deja = nomsDistincts(fiches.map((plat) => plat.nom)).sort(comparerNoms);
  const lignes = [
    `DEMANDE-IDEES ${FORMAT}`,
    LIGNE_INSTRUCTIONS,
    `nombre: ${combien}`,
  ];
  if (souhait) lignes.push(`envie: ${souhait}`);
  lignes.push(`critères: ${CRITERES_IDEES}`);
  lignes.push(`appareils: ${appareilsActifs(appareils).join(', ')}`);
  lignes.push(...lignesVersions(lesProfils));
  if (aimes.length) lignes.push(`aimés: ${aimes.join(' ; ')}`);
  if (evites.length) lignes.push(`évités: ${evites.join(' ; ')}`);
  if (deja.length) lignes.push(`déjà dans l'app: ${deja.join(' ; ')}`);
  lignes.push(CONSIGNE_IDEES);
  return lignes.join('\n');
}

/** Ingrédients que les règles du profil excluent (même calcul qu'evaluer). */
function exclusPour(ingredients, profil) {
  const resultat = evaluer({ ingredients }, profil);
  return resultat.niveau === 'exclu' ? new Set(resultat.fautifs) : new Set();
}

/** Version actuelle d'un plat, pour Claude : « retirer: … ; ajouter: … par portion ✗ ; consigne: … ». */
function versionActuelle(version, profil) {
  const ajouts = (Array.isArray(version?.ajouter) ? version.ajouter : []).filter(estObjet);
  const exclus = exclusPour(ajouts, profil);
  const morceaux = [
    `retirer: ${(Array.isArray(version?.retirer) ? version.retirer : []).map(ligne).filter(Boolean).join(', ') || 'rien'}`,
    `ajouter: ${ajouts.map((a) => `${quantite(a, 'qtePortion')} par portion${exclus.has(a) ? ' ✗' : ''}`).join(', ') || 'rien'}`,
  ];
  const consigne = ligne(version?.consigne);
  if (consigne) morceaux.push(`consigne: ${consigne}`);
  return morceaux.join(' ; ');
}

/**
 * (b) Texte copié pour demander à Claude les versions d'un ou plusieurs plats pour un profil (LOT_VERSIONS au plus ;
 * les suivants sont laissés de côté). `plats` : fiches, ou éléments de compatibilite.js › platsSansVersion ({ plat }).
 * Les ingrédients fautifs portent ✗ (Claude reprend leur nom exact dans `retirer`). `besoin` : celui du lot si tous
 * les plats ont le même, sinon omis.
 * - Profil sans style attendu : un plat dont la version est à revoir est envoyé avec sa version actuelle (texte de
 *   T2b à l'identique).
 * - Profil qui attend des styles (regles.js › stylesAttendus) : ligne `styles:` en tête ; pour chaque plat, la version
 *   actuelle de chaque style à refaire qui ne convient pas (« version actuelle (mer): … »), puis « à faire: » (styles
 *   qui manquent, compatibilite.js › evaluer ; tous les styles attendus pour ce plat si rien ne manque : jamais `mer`
 *   pour un dessert ou un accompagnement). Une version qui convient n'est jamais renvoyée : elle reste (fusion par
 *   style). Une version d'un style que le profil n'attend pas (mer pour « Ni viande ni poisson ») et qui ne convient
 *   pas est montrée sous un style qui manque encore, s'il n'a pas déjà sa version à revoir : Claude la refait, et la
 *   version rendue la remplace. Le `besoin` d'un plat à revoir vient de cette version montrée (compatibilite.js ›
 *   evaluer).
 */
export function texteDemandeVariantes(plats, profil) {
  const fiches = (Array.isArray(plats) ? plats : [])
    .map((element) => (estObjet(element?.plat) ? element.plat : element))
    .filter(estObjet)
    .slice(0, LOT_VERSIONS);
  const evaluations = fiches.map((plat) => evaluer(plat, profil));
  const styles = stylesAttendus(profil);
  const besoins = new Set(evaluations.map((r) => r.besoin));
  const [besoin] = besoins;
  const lignes = [
    `DEMANDE-VARIANTES ${FORMAT}`,
    LIGNE_INSTRUCTIONS,
    `pour: ${ligne(profil?.id)}`,
  ];
  if (styles.length) lignes.push(`styles: ${styles.join(', ')}`);
  if (besoins.size === 1 && besoin) lignes.push(`besoin: ${besoin}`);
  lignes.push(`règles: ${reglesPourClaude(profil)}`);
  lignes.push(styles.length ? CONSIGNE_STYLES : CONSIGNE_VARIANTES);
  lignes.push('plats:');
  fiches.forEach((plat, i) => {
    const resultat = evaluations[i];
    const fautifs = new Set(resultat.fautifs);
    const ingredients = (Array.isArray(plat.ingredients) ? plat.ingredients : []).filter(estObjet);
    lignes.push(`- id: ${ligne(plat.id)}`);
    lignes.push(`  nom: ${ligne(plat.nom)}`);
    if (plat.portionsBase != null) lignes.push(`  portions: ${ligne(plat.portionsBase)}`);
    lignes.push(`  ingrédients: ${ingredients.map((ingredient) => `${quantite(ingredient)}${fautifs.has(ingredient) ? ' ✗' : ''}`).join(' ; ')}`);
    if (styles.length) {
      const attendus = stylesAttendus(profil, plat);
      const aFaire = resultat.manquants.length ? resultat.manquants : attendus;
      // Version à revoir de chaque style à faire ; puis une version d'un style que le profil n'attend pas (mer pour
      // « Ni viande ni poisson », ou pour un dessert), montrée sous un style qui manque encore : la version rendue la
      // remplace (paquet.js › fusionnerVariantes, styles attendus).
      const actuelles = new Map();
      for (const { variante, style, convient } of resultat.versions) {
        if (!convient && aFaire.includes(style) && !actuelles.has(style)) actuelles.set(style, variante);
      }
      for (const { variante, style, convient } of resultat.versions) {
        if (convient || attendus.includes(style)) continue;
        const libre = resultat.manquants.find((manquant) => !actuelles.has(manquant));
        if (libre) actuelles.set(libre, variante);
      }
      for (const style of aFaire) {
        if (actuelles.has(style)) lignes.push(`  version actuelle (${style}): ${versionActuelle(actuelles.get(style), profil)}`);
      }
      lignes.push(`  à faire: ${aFaire.join(', ')}`);
    } else if (resultat.aRevoir) {
      const version = resultat.versions.find((v) => !v.convient)?.variante;
      lignes.push(`  version actuelle: ${versionActuelle(version, profil)}`);
    }
  });
  return lignes.join('\n');
}

/**
 * Texte copié par « Copier les corrections pour Claude ».
 * `probleme` : { erreur } (texte illisible), résultat de validerPaquet ({ plats, erreurs }) ou de preparerImport
 * ({ erreurs, corrections }). `corrections` : versions importées qui ne conviennent pas encore
 * ([{ pourClaude }], identifiant du plat compris) ; seules, elles demandent les versions corrigées plutôt que les
 * fiches entières. Une réponse « versions seules » refusée (chaque plat validé porte `versionsSeules`) redemande les
 * seules versions, et celles de tout le lot : rien n'a été enregistré, et Claude n'a jamais reçu les recettes
 * entières (il les inventerait). Plusieurs fiches refusées ensemble (un message de DEMANDE-IDEES, en général) :
 * toutes celles du message sont redemandées, les autres telles quelles, car rien n'a été enregistré (tout ou rien) et
 * recoller le message bute sur la même erreur.
 */
export function texteCorrectionPourClaude(probleme) {
  const lignes = [`CORRECTION ${FORMAT}`, LIGNE_INSTRUCTIONS];
  let erreurs = 0;
  if (probleme?.erreur) {
    erreurs += 1;
    lignes.push(probleme.erreur === 'coupee'
      ? '- La réponse précédente est coupée ou illisible : la fiche n’a pas pu être lue.'
      : '- Aucune fiche lisible dans la réponse précédente.');
  } else {
    for (const erreur of probleme?.erreurs ?? []) {
      erreurs += 1;
      lignes.push(`- ${erreur.pourClaude}`);
    }
    for (const plat of probleme?.plats ?? []) {
      if (!plat.erreurs?.length) continue;
      if (plat.id) lignes.push(`id: ${plat.id}`);
      for (const erreur of plat.erreurs) {
        erreurs += 1;
        lignes.push(`- ${erreur.pourClaude}`);
      }
    }
  }
  const corrections = Array.isArray(probleme?.corrections) ? probleme.corrections.filter((c) => c?.pourClaude) : [];
  for (const correction of corrections) lignes.push(`- ${correction.pourClaude}`);
  const plats = Array.isArray(probleme?.plats) ? probleme.plats.filter(estObjet) : [];
  const lotDeVersions = !probleme?.erreur && plats.length > 0 && plats.every((plat) => plat.versionsSeules);
  // Plats sans erreur à eux : rien n'a été enregistré, Claude les rend aussi, tels quels.
  const autres = plats.filter((plat) => !plat.erreurs?.length && plat.id).map((plat) => ligne(plat.id));
  if (lotDeVersions) {
    if (autres.length) lignes.push(`- Rien n’a été enregistré : rends aussi, telles quelles, les versions des autres plats du lot (${autres.join(', ')}).`);
    lignes.push('(Rends seulement { "id", "nom", "variantes" } de chaque plat du lot, corrigé, en un seul bloc.)');
  } else if (!probleme?.erreur && erreurs && plats.length > 1) {
    // Message de plusieurs fiches (DEMANDE-IDEES) : sans cela, Claude ne rendrait que la fiche fautive, et les
    // autres seraient perdues (le message recollé bute sur la même erreur ; « suite » passe aux idées suivantes).
    if (autres.length) lignes.push(`- Rien n’a été enregistré : rends aussi, telles quelles, les autres fiches du message (${autres.join(', ')}).`);
    lignes.push('(Rends toutes les fiches du message, corrigées, en un seul bloc.)');
  } else {
    lignes.push(!erreurs && corrections.length
      ? '(Rends seulement { "id", "nom", "variantes" } de chaque plat corrigé, en un seul bloc.)'
      : '(Rends la fiche complète corrigée, en un seul bloc.)');
  }
  return lignes.join('\n');
}
