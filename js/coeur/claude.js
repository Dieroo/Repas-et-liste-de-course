// Textes copiés pour le Projet Claude (CLAUDE.md §8, T2b) : demande de recette (avec les versions des profils qui ont
// des règles), demande groupée de versions, corrections. Logique pure : ni DOM ni Firebase.
// Chaque texte porte en deuxième ligne la version des instructions attendue (docs/projet-claude.md, section 0).
// Les identifiants de profil et leurs règles ne vont qu'au presse-papiers ; jamais d'adresse, de prénom ni d'âge.
// N'importe jamais paquet.js (qui garde la lecture des réponses) : pas de cycle.
import { decrireRegles, lireRegime, stylesAttendus } from './regles.js';
import { evaluer, profilsContraints } from './compatibilite.js';
import { texte } from './vocabulaire.js';

const FORMAT = 'paquet@1';

/** Version des instructions du projet Claude (docs/projet-claude.md, en tête) : +1 à chaque modification du fichier. */
export const VERSION_INSTRUCTIONS = 2;
/** Empreinte de docs/projet-claude.md (sha256, 12 premiers caractères hex) : un test échoue si le fichier change sans
 * que VERSION_INSTRUCTIONS augmente. */
export const EMPREINTE_INSTRUCTIONS = '49a2dbbaf3bd';

/** Deuxième ligne de chaque texte copié : Claude refuse une demande écrite pour d'autres instructions que les siennes. */
const LIGNE_INSTRUCTIONS = `instructions: ${VERSION_INSTRUCTIONS}`;

/** Nombre de plats d'une demande groupée de versions : une réponse plus longue risque d'être coupée. */
export const LOT_VERSIONS = 10;

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
 * (a) Texte copié par « Demander à Claude » pour une recette à ajouter. Sans profil qui a des règles : texte de T1b
 * (plus la ligne de version des instructions). Sinon, une ligne `versions:` par profil contraint (ordre
 * d'affichage), pour que Claude rende la fiche complète avec leurs variantes ; un profil qui attend des styles
 * (regles.js › stylesAttendus) les annonce en fin de ligne (« — styles: mer, vegetal » ; « — styles: vegetal » pour un
 * plat déjà connu comme dessert ou accompagnement).
 */
export function texteDemandeRecette(plat, { profils = [] } = {}) {
  const contraints = profilsContraints(profils).filter((profil) => typeof profil.id === 'string' && profil.id);
  const lignes = [
    `DEMANDE-RECETTE ${FORMAT}`,
    LIGNE_INSTRUCTIONS,
    `id: ${ligne(plat?.id)}`,
    `nom: ${ligne(plat?.nom)}`,
  ];
  if (contraints.length) {
    lignes.push('versions:');
    for (const profil of contraints) {
      const styles = stylesAttendus(profil, plat);
      lignes.push(`- pour: ${profil.id} — ${reglesPourClaude(profil)}${styles.length ? ` — styles: ${styles.join(', ')}` : ''}`);
    }
  }
  lignes.push('(Ajoute un lien, une photo ou la recette dictée.)');
  if (contraints.length) lignes.push(CONSIGNE_RECETTE);
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
 * entières (il les inventerait).
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
  if (lotDeVersions) {
    const autres = plats.filter((plat) => !plat.erreurs?.length && plat.id).map((plat) => ligne(plat.id));
    if (autres.length) lignes.push(`- Rien n’a été enregistré : rends aussi, telles quelles, les versions des autres plats du lot (${autres.join(', ')}).`);
    lignes.push('(Rends seulement { "id", "nom", "variantes" } de chaque plat du lot, corrigé, en un seul bloc.)');
  } else {
    lignes.push(!erreurs && corrections.length
      ? '(Rends seulement { "id", "nom", "variantes" } de chaque plat corrigé, en un seul bloc.)'
      : '(Rends la fiche complète corrigée, en un seul bloc.)');
  }
  return lignes.join('\n');
}
