// Textes copiés pour le Projet Claude (CLAUDE.md §8, T2b) : demande de recette (avec les versions des profils qui ont
// des règles), demande groupée de versions, corrections. Logique pure : ni DOM ni Firebase.
// Les identifiants de profil et leurs règles ne vont qu'au presse-papiers ; jamais d'adresse, de prénom ni d'âge.
// N'importe jamais paquet.js (qui garde la lecture des réponses) : pas de cycle.
import { decrireRegles, lireRegime } from './regles.js';
import { evaluer, profilsContraints } from './compatibilite.js';
import { texte } from './vocabulaire.js';

const FORMAT = 'paquet@1';

/** Nombre de plats d'une demande groupée de versions : une réponse plus longue risque d'être coupée. */
export const LOT_VERSIONS = 10;

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
 * (a) Texte copié par « Demander à Claude » pour une recette à ajouter. Sans profil qui a des règles : texte de T1b,
 * à l'identique. Sinon, une ligne `versions:` par profil contraint (ordre d'affichage), pour que Claude rende la
 * fiche complète avec leurs variantes.
 */
export function texteDemandeRecette(plat, { profils = [] } = {}) {
  const contraints = profilsContraints(profils).filter((profil) => typeof profil.id === 'string' && profil.id);
  const lignes = [
    `DEMANDE-RECETTE ${FORMAT}`,
    `id: ${ligne(plat?.id)}`,
    `nom: ${ligne(plat?.nom)}`,
  ];
  if (contraints.length) {
    lignes.push('versions:');
    for (const profil of contraints) lignes.push(`- pour: ${profil.id} — ${reglesPourClaude(profil)}`);
  }
  lignes.push('(Ajoute un lien, une photo ou la recette dictée.)');
  if (contraints.length) {
    lignes.push('(Si le plat contient ce qu\'un de ces profils ne mange pas, ajoute sa variante. Rends la fiche complète, en un seul bloc.)');
  }
  return lignes.join('\n');
}

/** Ingrédients que les règles du profil excluent (même calcul qu'evaluer). */
function exclusPour(ingredients, profil) {
  const resultat = evaluer({ ingredients }, profil);
  return resultat.niveau === 'exclu' ? new Set(resultat.fautifs) : new Set();
}

/**
 * (b) Texte copié pour demander à Claude les versions d'un ou plusieurs plats pour un profil (LOT_VERSIONS au plus ;
 * les suivants sont laissés de côté). `plats` : fiches, ou éléments de compatibilite.js › platsSansVersion ({ plat }).
 * Les ingrédients fautifs portent ✗ (Claude reprend leur nom exact dans `retirer`) ; un plat dont la version est à
 * revoir est envoyé avec sa version actuelle. `besoin` : celui du lot si tous les plats ont le même, sinon omis.
 */
export function texteDemandeVariantes(plats, profil) {
  const fiches = (Array.isArray(plats) ? plats : [])
    .map((element) => (estObjet(element?.plat) ? element.plat : element))
    .filter(estObjet)
    .slice(0, LOT_VERSIONS);
  const evaluations = fiches.map((plat) => evaluer(plat, profil));
  const besoins = new Set(evaluations.map((r) => r.besoin));
  const [besoin] = besoins;
  const lignes = [
    `DEMANDE-VARIANTES ${FORMAT}`,
    `pour: ${ligne(profil?.id)}`,
  ];
  if (besoins.size === 1 && besoin) lignes.push(`besoin: ${besoin}`);
  lignes.push(`règles: ${reglesPourClaude(profil)}`);
  lignes.push('(Pour chaque plat, rends seulement { "id", "nom", "variantes": [la variante pour ce profil] }, jamais la recette entière. Tous les plats dans un seul bloc paquet@1. Un plat impossible à adapter : ne le rends pas, et dis-le en une phrase.)');
  lignes.push('plats:');
  fiches.forEach((plat, i) => {
    const fautifs = new Set(evaluations[i].fautifs);
    const ingredients = (Array.isArray(plat.ingredients) ? plat.ingredients : []).filter(estObjet);
    lignes.push(`- id: ${ligne(plat.id)}`);
    lignes.push(`  nom: ${ligne(plat.nom)}`);
    if (plat.portionsBase != null) lignes.push(`  portions: ${ligne(plat.portionsBase)}`);
    lignes.push(`  ingrédients: ${ingredients.map((ingredient) => `${quantite(ingredient)}${fautifs.has(ingredient) ? ' ✗' : ''}`).join(' ; ')}`);
    if (evaluations[i].aRevoir) {
      const version = (Array.isArray(plat.variantes) ? plat.variantes : [])
        .find((v) => estObjet(v) && v.pour === profil?.id);
      const ajouts = (Array.isArray(version?.ajouter) ? version.ajouter : []).filter(estObjet);
      const exclus = exclusPour(ajouts, profil);
      const morceaux = [
        `retirer: ${(Array.isArray(version?.retirer) ? version.retirer : []).map(ligne).filter(Boolean).join(', ') || 'rien'}`,
        `ajouter: ${ajouts.map((a) => `${quantite(a, 'qtePortion')} par portion${exclus.has(a) ? ' ✗' : ''}`).join(', ') || 'rien'}`,
      ];
      const consigne = ligne(version?.consigne);
      if (consigne) morceaux.push(`consigne: ${consigne}`);
      lignes.push(`  version actuelle: ${morceaux.join(' ; ')}`);
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
  const lignes = [`CORRECTION ${FORMAT}`];
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
