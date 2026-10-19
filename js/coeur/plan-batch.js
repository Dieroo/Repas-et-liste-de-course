// Plan du batch (2026-10-19, décisions 15 à 23 du propriétaire, après la première semaine de l'utilisatrice des
// courses : 1 kg de pommes de terre cuit en deux fois au Cookeo pour deux plats). Elle demande d'un toucher le plan de
// batch de la semaine ; le gestionnaire envoie la demande à Claude (DEMANDE-BATCH) et colle sa réponse ; elle suit le
// plan étape par étape (#/batch/<semaine>). Claude regroupe ce qui se prépare et cuit de la même façon pour plusieurs
// plats, ordonne les étapes pour une seule personne et donne le récipient de chaque plat et sa taille selon ses
// portions ; l'app affiche les quantités de la semaine (cuisine.js › quantitesACuisiner), les rappels du four et des
// parts à mettre de côté, et la fin de chaque plat. Aucun minuteur (décision du propriétaire). Le plan ne change
// jamais les recettes : il vaut pour la semaine seulement.
// Plats du batch : ceux de la semaine (semaine.js › platsDeLaSemaine) qui ont leur recette et que quelqu'un mange,
// apéros exclus. Le plan vit dans `plansBatch/<semaine>` avec son empreinte (plats, recettes et parts) : un plan dont
// l'empreinte n'est plus celle de la semaine est périmé (« Redemander ») ; des portions changées depuis le plan le
// laissent servir (les quantités suivent), avec une phrase.
// Logique pure : ni DOM ni Firebase, aucune écriture ; rien sur les personnes ne part vers Claude (parts anonymes).
import { cleProduit, slug } from './slug.js';
import { VOCABULAIRES, estObjet, marqueursEffectifs, texte } from './vocabulaire.js';
import { aSaRecette, typeDe } from './plats.js';
import {
  RANGS_STATUT, jourDeDerniereFois, lireSemaine, platsDeLaSemaine, statutSemaine, texteDates, texteJour,
} from './semaine.js';
import {
  CONSEILS, TEXTES_CUISINE, aussiDeLEtape, finDeCuisson, hygieneDuPlat, lignesEnfant, phrasesDeFin, precautionsDuPlat,
  quantitesACuisiner, quantitesDeLEtape, rappelsDuDeroule, texteQuantiteCuisine, arrondiCuisine,
} from './cuisine.js';
import {
  AUSSI_MAX, DUREE_MAX_MIN, FEUX, MODE_MAX, PRET_MAX, TEXTE_LONG, TEXTE_MAX, TITRE_MAX, USTENSILES_MAX, USTENSILE_MAX,
  empreinteEtapes, etapesLisibles, ligneAppareil, ligneDuree, texteDuree,
} from './realisation.js';
import { cuissonEnTexte, empreinteDeTexte } from './empreinte.js';
import { estDansCorbeille } from './corbeille.js';
import { deNom } from './notes.js';
import { VERSION_INSTRUCTIONS, appareilsActifs } from './claude.js';

const FORMAT = 'paquet@1';
/** En-tête du texte copié pour Claude. */
export const ENTETE_DEMANDE_BATCH = `DEMANDE-BATCH ${FORMAT}`;
/** Plats qu'il faut au moins dans la semaine pour qu'un plan de batch ait un sens (décision 23). */
export const PLATS_BATCH_MIN = 2;
/** Étapes d'un plan, au plus. */
export const ETAPES_BATCH_MAX = 60;
/** Récipient et taille : caractères, au plus. */
export const RECIPIENT_MAX = 40;
export const TAILLE_MAX = 60;
/** Températures d'un four ou d'un airfryer acceptées dans un plan. */
const TEMP_MIN = 30;
const TEMP_MAX = 300;
const APPAREILS_A_PRECHAUFFER = ['four', 'airfryer'];
const MODES = ['cookeo', 'airfryer', 'monsieur_cuisine'];

const estNombre = (valeur) => typeof valeur === 'number' && Number.isFinite(valeur);
const estEntier = (valeur, min, max) => Number.isInteger(valeur) && valeur >= min && valeur <= max;
const listeDe = (valeur) => (Array.isArray(valeur) ? valeur : []);
const propre = (valeur) => Math.round(valeur * 1e6) / 1e6;
const majuscule = (valeur) => (valeur ? `${valeur.charAt(0).toLocaleUpperCase('fr-FR')}${valeur.slice(1)}` : valeur);
const guillemets = (valeur) => `« ${valeur} »`;
const nomDe = (profil) => texte(profil?.nom) || 'Sans prénom';
const estMoi = (profil, moi) => Boolean(moi) && typeof moi.id === 'string' && moi.id === profil?.id;
const laPart = (profil, moi) => (estMoi(profil, moi) ? 'votre part' : `la part ${deNom(nomDe(profil))}`);
const sansPoint = (valeur) => texte(valeur).replace(/[\s.!…;,:]+$/u, '');
const nombreFr = new Intl.NumberFormat('fr-FR', { maximumFractionDigits: 2 });
const portionsEnMots = (n) => `${nombreFr.format(n)} ${n > 1 ? 'portions' : 'portion'}`;
/** Une ligne de texte copié : sans retour à la ligne (un nom saisi ne casse jamais la forme du texte). */
const ligne = (valeur) => texte(typeof valeur === 'number' ? String(valeur) : valeur);

// ——— Textes ———

export const TEXTES_PLAN_BATCH = Object.freeze({
  titreCarte: '👩‍🍳 Le batch de la semaine',
  invitation: (n) => `Claude peut organiser vos ${n} plats en un seul batch : les cuissons en commun, l’ordre des étapes et la taille des plats.`,
  invitationGestionnaire: 'Envoyez la demande à Claude, puis collez sa réponse : le plan apparaîtra ici, prêt à suivre.',
  demander: '📬 Demander le plan du batch',
  redemander: '📬 Redemander le plan',
  demande: (quand) => `📬 Demandé ${quand}. Il apparaîtra ici dès qu’il sera prêt.`,
  demandeHorsLigne: '📬 Demandé. La demande partira au retour du réseau.',
  demandePar: (qui, quand) => `📬 Demandé par ${qui} ${quand}.`,
  envoyer: '📤 Envoyer à Claude',
  copier: '📋 Copier la demande',
  coller: 'Coller la réponse',
  pret: '👩‍🍳 Plan du batch prêt',
  commencer: 'Commencer le batch ›',
  portionsChangees: 'Les portions ont changé depuis le plan : les quantités suivent, vérifiez la taille des plats.',
  perime: 'Les plats ont changé depuis le plan : il faut le redemander.',
  notification: 'Plan de batch à préparer',
  // Écran #/batch/<semaine>.
  titrePage: (n) => `Batch : ${n} plats`,
  lesPlats: 'Les plats',
  recipients: 'Les plats de cuisson',
  recipient: (nom, ustensile, taille) => `${nom} : ${ustensile}${taille ? ` · ${taille}` : ''}`,
  pour: (noms) => `Pour : ${noms}`,
  fin: 'Batch terminé 🎉',
  revenir: 'Revenir à la semaine',
  introuvable: 'Ce plan de batch n’est plus là.',
  perimeEcran: 'Les plats de la semaine ont changé depuis ce plan. Demandez-en un nouveau depuis Semaine.',
  // Demandes (gestionnaire).
  sectionDemandes: 'Plan du batch',
  semaineDu: (dates) => `Semaine ${dates}`,
});

/** « aujourd’hui », « hier », « le 24 octobre » (jour 'AAAA-MM-JJ' de la demande, aujourd'hui en 'AAAA-MM-JJ'). */
export function quandDemande(jour, aujourdhui) {
  if (typeof jour !== 'string' || !texteJour(jour)) return '';
  if (jour === aujourdhui) return 'aujourd’hui';
  return `le ${texteJour(jour)}`;
}

// ——— Plats du batch ———

/**
 * Plats du batch d'une semaine → [{ platId, plat, element, quantites }] dans l'ordre de la semaine : plats présents,
 * avec leur recette, que quelqu'un mange (portions à cuisiner ou à congeler), hors apéros et corbeille ; `element` :
 * celui de semaine.js › platsDeLaSemaine, avec `semaine: { id, debut, fin }` (comme cuisine.js › elementPourCuisiner) ;
 * `quantites` : cuisine.js › quantitesACuisiner pour la semaine. Semaine illisible : [].
 */
export function platsDuBatch(semaine, { tousLesPlats = [], profils = [], evaluer = undefined, reglages = null } = {}) {
  const lue = lireSemaine(semaine);
  if (!lue) return [];
  return platsDeLaSemaine(lue, { tousLesPlats, profils, evaluer, reglages })
    .filter((e) => e.etat === 'ok' && estObjet(e.plat) && aSaRecette(e.plat) && !estDansCorbeille(e.plat)
      && typeDe(e.plat) !== 'apero' && estNombre(e.aCuire) && estNombre(e.aCongeler) && e.aCuire + e.aCongeler > 0)
    .map((e) => {
      const element = { ...e, semaine: { id: lue.id, debut: lue.debut, fin: lue.fin } };
      return { platId: e.platId, plat: e.plat, element, quantites: quantitesACuisiner(e.plat, element) };
    });
}

/** Parts d'un plat du batch, anonymes : « sans jambon blanc (avec thon au naturel) », dans l'ordre des versions. */
function partsAnonymes(quantites) {
  const sortie = [];
  for (const part of listeDe(quantites?.parts)) {
    const sans = part.retirer.length ? `sans ${part.retirer.join(', ')}` : '';
    const avec = part.ajouts.length ? `avec ${part.ajouts.map((a) => a.produit).join(', ')}` : '';
    const morceau = sans && avec ? `${sans} (${avec})` : sans || avec;
    if (morceau && !sortie.includes(morceau)) sortie.push(morceau);
  }
  return sortie;
}

/**
 * Empreinte d'un plan de batch (6 caractères), ou null sans plat : les plats (identifiant), leurs recettes
 * (realisation.js › empreinteEtapes : portions de la recette, produits et repères, étapes, cuisson) et leurs parts
 * (ce qu'elles retirent et ajoutent), jamais les portions de la semaine : un invité de plus garde le plan (les
 * quantités suivent). Un ordre différent des plats donne la même empreinte.
 */
export function empreintePlanBatch(elements) {
  const lignes = listeDe(elements).filter((e) => estObjet(e) && typeof e.platId === 'string').map((e) => [
    e.platId, empreinteEtapes(e.plat), partsAnonymes(e.quantites).join(';'),
  ].join('|')).sort();
  return lignes.length ? empreinteDeTexte(lignes.join('\n')) : null;
}

/** Portions de chaque plat du batch : { platId: portions }. */
export function portionsDuBatch(elements) {
  const sortie = {};
  for (const e of listeDe(elements)) if (estObjet(e) && typeof e.platId === 'string') sortie[e.platId] = propre(e.quantites?.portions ?? 0);
  return sortie;
}

// ——— Demande pour Claude ———

const CONSIGNE_BATCH = '(Organise le batch de ces plats pour une seule personne, selon la section « Le plan de batch » : regroupe ce qui se prépare et cuit de la même façon pour plusieurs plats, fais avancer les plats en même temps selon les appareils, et donne le récipient de chaque plat et sa taille pour ses portions. Ne change ni les ingrédients, ni les quantités, ni la manière de cuire. Nomme chaque ingrédient exactement comme dans sa ligne `ingrédients:`, avec l\'`id` de son plat. Rends seulement { "format", "instructions", "batch": { "semaine", "empreinte", "dureeTotale", "travail", "recipients", "etapes" } }, `semaine` et `empreinte` recopiées telles quelles, en un seul bloc.)';

/** « 600 g pâtes courtes », « 3 oignon jaune » (pièces sans unité), « sel fin » sans mesure. */
function quantitePourClaude(ligneQte) {
  const unite = ligneQte.unite === 'pc' ? '' : ligne(ligneQte.unite);
  const qte = estNombre(ligneQte.qte) && ligneQte.qte > 0 ? nombreFr.format(ligneQte.qte).replace(/\s/g, '') : '';
  return [qte, unite, ligne(ligneQte.produit)].filter(Boolean).join(' ');
}

/** « 10 min dont 1 min de travail ; plaque, feu vif ; ingrédients : oignon jaune ; la veille » */
function detailEtape(etape) {
  const morceaux = [];
  if (estNombre(etape.duree)) {
    const actif = estNombre(etape.actif) ? etape.actif : etape.duree;
    morceaux.push(actif < etape.duree ? `${etape.duree} min dont ${actif} min de travail` : `${etape.duree} min`);
  }
  const appareil = [etape.appareil, etape.feu ? `feu ${etape.feu}` : '', estNombre(etape.tempC) ? `${etape.tempC} °C` : '', etape.mode ?? '']
    .filter(Boolean).join(', ');
  if (appareil) morceaux.push(appareil);
  const cites = listeDe(etape.ingredients).map((i) => ligne(i.produit)).filter(Boolean);
  if (cites.length) morceaux.push(`ingrédients : ${cites.join(', ')}`);
  if (listeDe(etape.ustensiles).length) morceaux.push(`ustensiles : ${etape.ustensiles.map(ligne).join(', ')}`);
  if (etape.veille) morceaux.push('la veille');
  if (etape.partAvant) morceaux.push('parts mises de côté avant');
  return morceaux.join(' ; ');
}

/**
 * Texte copié pour demander à Claude le plan de batch d'une semaine (DEMANDE-BATCH) : semaine (identifiant, que Claude
 * recopie), empreinte (empreintePlanBatch, recopiée), appareils actifs (claude.js › appareilsActifs), nombre de plats,
 * consigne, puis pour chaque plat du batch (platsDuBatch, dans l'ordre de la semaine) : `id`, `nom`, `portions à
 * cuisiner` (de la semaine, congélation comprise), `ingrédients:` (quantités de la semaine, arrondies ; un ingrédient que
 * toutes les parts retirent est omis), `étapes:` (une ligne par étape de la recette, « le jour du repas » exclues),
 * `cuisson:`, `se garde:`, `parts à mettre de côté:` (anonymes). Rien sur les personnes : ni profil, ni prénom.
 */
export function texteDemandeBatch(elements, { semaine = null, appareils = null } = {}) {
  const lue = lireSemaine(semaine);
  const plats = listeDe(elements).filter((e) => estObjet(e) && estObjet(e.plat));
  const lignes = [
    ENTETE_DEMANDE_BATCH,
    `instructions: ${VERSION_INSTRUCTIONS}`,
    `semaine: ${ligne(lue?.id ?? '')}`,
    `empreinte: ${empreintePlanBatch(plats) ?? ''}`,
    `appareils: ${appareilsActifs(appareils).join(', ')}`,
    `nombre: ${plats.length}`,
    CONSIGNE_BATCH,
    'plats:',
  ];
  for (const { platId, plat, quantites } of plats) {
    lignes.push(`- id: ${ligne(platId)}`);
    lignes.push(`  nom: ${ligne(plat.nom)}`);
    lignes.push(`  portions à cuisiner: ${nombreFr.format(propre(quantites.portions)).replace(/\s/g, '')}`);
    const ingredients = listeDe(quantites.lignes).filter((l) => !l.personne && texte(l.produit)).map(quantitePourClaude);
    lignes.push(`  ingrédients: ${ingredients.join(' ; ')}`);
    const etapes = etapesLisibles(plat).etapes.filter((e) => !e.auService);
    if (etapes.length) {
      lignes.push('  étapes:');
      etapes.forEach((etape, i) => {
        const detail = detailEtape(etape);
        const corps = ligne(etape.texte);
        lignes.push(`    ${i + 1}. ${ligne(etape.titre)}${detail ? ` (${detail})` : ''}${corps ? ` : ${corps}` : ''}`);
      });
    }
    const cuisson = cuissonEnTexte(plat.cuisson);
    if (cuisson) lignes.push(`  cuisson: ${cuisson}`);
    const garde = [];
    if (Number.isInteger(plat.conservation?.frigoJours)) garde.push(`${plat.conservation.frigoJours} jours au frigo`);
    if (plat.conservation?.congelable === false) garde.push('ne se congèle pas');
    else if (plat.conservation?.congelable === true) garde.push('se congèle');
    if (garde.length) lignes.push(`  se garde: ${garde.join(' ; ')}`);
    const parts = partsAnonymes(quantites);
    if (parts.length) lignes.push(`  parts à mettre de côté: ${parts.join(' ; ')}`);
  }
  return lignes.join('\n');
}

// ——— Réponse de Claude ———

/** Plan de batch d'une réponse collée (objets paquet@1 extraits) → { batch, instructions } du premier objet qui porte `batch`, sinon null. */
export function planDeLaReponse(paquets) {
  for (const paquet of listeDe(paquets)) {
    if (estObjet(paquet) && Object.hasOwn(paquet, 'batch')) return { batch: paquet.batch, instructions: paquet.instructions ?? null };
  }
  return null;
}

/** Vrai si une réponse collée porte un plan de batch (clé `batch` à la racine d'un objet). */
export const estReponseBatch = (paquets) => planDeLaReponse(paquets) !== null;

const erreur = (message, pourClaude) => ({ message, pourClaude });
const avertissement = (message) => ({ message });

/** Ingrédients citables d'un plat du batch : Map clé produit → nom (lignes que quelqu'un mange). */
function citables(element) {
  const sortie = new Map();
  for (const l of listeDe(element.quantites?.lignes)) {
    if (l.personne) continue;
    const cle = cleProduit(l.produit);
    if (cle && !sortie.has(cle)) sortie.set(cle, l.produit);
  }
  return sortie;
}

/** Texte court d'une réponse : texte non vide de `max` caractères au plus, sinon null. */
function texteBorne(valeur, max) {
  const lu = texte(valeur);
  return lu && [...lu].length <= max ? lu : null;
}

/**
 * Valide un plan de batch reçu → { plan | null, erreurs: [{ message, pourClaude }], avertissements: [{ message }],
 * refus: null | 'semaine' | 'perime' }.
 * `brut` : la valeur de `batch` ; `elements` : platsDuBatch de la semaine ; `semaineId`, `empreinte` : ceux de la
 * semaine montrée ; `appareils` : reglages.appareils (un appareil absent du foyer : avertissement).
 * Refus (rien n'est enregistrable, et rien n'est à corriger par Claude) : plan d'une autre semaine (`semaine`), ou
 * d'avant un changement des plats (`perime` : empreinte différente). Erreurs (à faire corriger : « Copier les
 * corrections pour Claude ») : forme, durées, plats inconnus ou absents des étapes, ingrédient inconnu de son plat ou
 * cité nulle part. Avertissements : champs facultatifs fautifs (retirés), récipient manquant, part sans étape, texte
 * long. Plan normalisé : { semaine, empreinte, dureeTotale, travail, recipients: [{ plat, ustensile, taille }],
 * etapes: [{ titre, texte, duree, actif, appareil, mode, tempC, feu, ustensiles, plats, ingredients: [{ produit, plat,
 * part }], aussi, pret, prechauffer, partAvant, veille }] }.
 */
export function validerPlanBatch(brut, { elements = [], semaineId = null, empreinte = null, appareils = null } = {}) {
  const erreurs = [];
  const avertissements = [];
  const sortie = (plan, refus = null) => ({ plan: erreurs.length || refus ? null : plan, erreurs, avertissements, refus });
  if (!estObjet(brut)) {
    erreurs.push(erreur('Le plan de batch est illisible.', 'batch : objet attendu'));
    return sortie(null);
  }
  if (texte(brut.semaine) !== texte(semaineId)) {
    if (!texte(brut.semaine)) erreurs.push(erreur('Le plan ne dit pas pour quelle semaine il est.', `batch.semaine : « ${semaineId} » attendu`));
    else return sortie(null, 'semaine');
  }
  if (texte(brut.empreinte) !== texte(empreinte)) {
    if (!texte(brut.empreinte)) erreurs.push(erreur('Le plan n’a pas recopié l’empreinte de la demande.', `batch.empreinte : « ${empreinte} » attendu`));
    else return sortie(null, 'perime');
  }
  const parId = new Map(listeDe(elements).filter((e) => estObjet(e) && typeof e.platId === 'string').map((e) => [e.platId, e]));
  const nom = (platId) => texte(parId.get(platId)?.plat?.nom) || platId;
  const actifs = new Set(appareilsActifs(appareils));

  if (!estEntier(brut.dureeTotale, 1, DUREE_MAX_MIN)) {
    erreurs.push(erreur('La durée du batch manque.', `batch.dureeTotale : entier de 1 à ${DUREE_MAX_MIN} attendu`));
  }
  if (!estEntier(brut.travail, 1, estEntier(brut.dureeTotale, 1, DUREE_MAX_MIN) ? brut.dureeTotale : DUREE_MAX_MIN)) {
    erreurs.push(erreur('Le temps de travail du batch manque.', 'batch.travail : entier de 1 à dureeTotale attendu'));
  }

  // Récipients.
  const recipients = [];
  if (brut.recipients !== undefined && !Array.isArray(brut.recipients)) {
    erreurs.push(erreur('Les plats de cuisson sont illisibles.', 'batch.recipients : liste attendue'));
  }
  listeDe(brut.recipients).forEach((r, i) => {
    const code = `batch.recipients[${i}]`;
    if (!estObjet(r) || typeof r.plat !== 'string') {
      erreurs.push(erreur('Un plat de cuisson est illisible.', `${code} : { "plat", "ustensile", "taille" } attendu`));
      return;
    }
    if (!parId.has(r.plat)) {
      erreurs.push(erreur('Un plat de cuisson est donné pour un plat qui n’est pas dans la semaine.', `${code}.plat : « ${ligne(r.plat)} » n'est pas un plat de la demande`));
      return;
    }
    const ustensile = texteBorne(r.ustensile, RECIPIENT_MAX);
    if (!ustensile) {
      erreurs.push(erreur(`Le plat de cuisson de ${guillemets(nom(r.plat))} n’est pas nommé.`, `${code}.ustensile : texte de 1 à ${RECIPIENT_MAX} caractères attendu`));
      return;
    }
    const taille = texteBorne(r.taille, TAILLE_MAX);
    if (r.taille !== undefined && !taille) avertissements.push(avertissement(`La taille du plat de cuisson de ${guillemets(nom(r.plat))} est illisible\u00A0: elle n’est pas reprise.`));
    recipients.push({ plat: r.plat, ustensile, taille });
  });

  // Étapes.
  const etapes = [];
  if (!Array.isArray(brut.etapes) || !brut.etapes.length || brut.etapes.length > ETAPES_BATCH_MAX) {
    erreurs.push(erreur('Le plan n’a pas d’étapes lisibles.', `batch.etapes : liste de 1 à ${ETAPES_BATCH_MAX} étapes attendue`));
  } else {
    brut.etapes.forEach((e, i) => {
      const n = i + 1;
      const code = `batch.etapes[${i}]`;
      if (!estObjet(e)) {
        erreurs.push(erreur(`L’étape ${n} est illisible.`, `${code} : objet attendu`));
        return;
      }
      const titre = texteBorne(e.titre, TITRE_MAX);
      if (!titre) erreurs.push(erreur(`L’étape ${n} n’a pas de titre.`, `${code}.titre : texte de 1 à ${TITRE_MAX} caractères attendu`));
      const corps = texteBorne(e.texte, TEXTE_MAX);
      if (!corps) erreurs.push(erreur(`L’étape ${n} n’a pas de texte.`, `${code}.texte : texte de 1 à ${TEXTE_MAX} caractères attendu`));
      else if ([...corps].length > TEXTE_LONG) avertissements.push(avertissement(`Le texte de l’étape ${n} est long.`));
      if (!estEntier(e.duree, 1, DUREE_MAX_MIN)) erreurs.push(erreur(`L’étape ${n} n’a pas de durée.`, `${code}.duree : entier de 1 à ${DUREE_MAX_MIN} attendu`));
      // Plats de l'étape.
      const plats = [];
      if (!Array.isArray(e.plats) || !e.plats.length) {
        erreurs.push(erreur(`L’étape ${n} ne dit pas pour quels plats elle est.`, `${code}.plats : identifiants des plats de la demande attendus`));
      } else {
        for (const p of e.plats) {
          if (typeof p === 'string' && parId.has(p)) {
            if (!plats.includes(p)) plats.push(p);
          } else {
            erreurs.push(erreur(`L’étape ${n} parle d’un plat qui n’est pas dans la semaine.`, `${code}.plats : « ${ligne(p)} » n'est pas un plat de la demande`));
          }
        }
      }
      // Ingrédients cités : { produit, plat, part? } ; le plat d'un ingrédient rejoint ceux de l'étape.
      const ingredients = [];
      if (e.ingredients !== undefined && !Array.isArray(e.ingredients)) {
        erreurs.push(erreur(`Les ingrédients de l’étape ${n} sont illisibles.`, `${code}.ingredients : liste de { "produit", "plat" } attendue`));
      }
      listeDe(e.ingredients).forEach((c, j) => {
        const codeC = `${code}.ingredients[${j}]`;
        if (!estObjet(c) || typeof c.produit !== 'string' || typeof c.plat !== 'string') {
          erreurs.push(erreur(`Un ingrédient de l’étape ${n} est illisible.`, `${codeC} : { "produit", "plat" } attendu`));
          return;
        }
        const element = parId.get(c.plat);
        if (!element) {
          erreurs.push(erreur(`L’étape ${n} cite un ingrédient d’un plat qui n’est pas dans la semaine.`, `${codeC}.plat : « ${ligne(c.plat)} » n'est pas un plat de la demande`));
          return;
        }
        if (!citables(element).has(cleProduit(c.produit))) {
          erreurs.push(erreur(`L’étape ${n} cite ${guillemets(texte(c.produit))}, qui n’est pas dans ${guillemets(nom(c.plat))}.`, `${codeC} : « ${ligne(c.produit)} » n'est pas un ingrédient de ${c.plat}`));
          return;
        }
        const part = c.part === undefined ? 1 : (estNombre(c.part) && c.part > 0 && c.part <= 1 ? c.part : null);
        if (part === null) avertissements.push(avertissement(`Une part d’ingrédient de l’étape ${n} est illisible\u00A0: tout l’ingrédient est compté.`));
        ingredients.push({ produit: texte(c.produit), plat: c.plat, part: part ?? 1 });
        if (!plats.includes(c.plat)) plats.push(c.plat);
      });
      // Champs facultatifs : retirés avec un avertissement s'ils sont fautifs.
      const duree = estEntier(e.duree, 1, DUREE_MAX_MIN) ? e.duree : null;
      let actif = null;
      if (e.actif !== undefined) {
        if (estEntier(e.actif, 0, duree ?? DUREE_MAX_MIN)) actif = e.actif;
        else avertissements.push(avertissement(`Le temps de travail de l’étape ${n} est illisible\u00A0: toute l’étape compte comme du travail.`));
      }
      let appareil = null;
      if (e.appareil !== undefined) {
        if (VOCABULAIRES.appareil.includes(e.appareil)) {
          appareil = e.appareil;
          if (!actifs.has(appareil)) avertissements.push(avertissement(`L’étape ${n} utilise un appareil que vos réglages n’ont pas.`));
        } else {
          avertissements.push(avertissement(`L’appareil de l’étape ${n} est inconnu\u00A0: il n’est pas repris.`));
        }
      }
      const mode = appareil && MODES.includes(appareil) ? texteBorne(e.mode, MODE_MAX) : null;
      const tempC = appareil && APPAREILS_A_PRECHAUFFER.includes(appareil) && estEntier(e.tempC, TEMP_MIN, TEMP_MAX) ? e.tempC : null;
      if (e.tempC !== undefined && tempC === null) avertissements.push(avertissement(`La température de l’étape ${n} est illisible\u00A0: elle n’est pas reprise.`));
      const feu = appareil === 'plaque' && FEUX.includes(e.feu) ? e.feu : null;
      const ustensiles = listeDe(e.ustensiles).map((u) => texteBorne(u, USTENSILE_MAX)).filter(Boolean).slice(0, USTENSILES_MAX);
      const aussi = listeDe(e.aussi).filter((a) => typeof a === 'string' ? texte(a) : estObjet(a) && texte(a.produit)).slice(0, AUSSI_MAX)
        .map((a) => (typeof a === 'string' ? texte(a) : { produit: texte(a.produit), ...(estNombre(a.qte) && a.qte > 0 ? { qte: a.qte } : {}), ...(typeof a.unite === 'string' ? { unite: a.unite } : {}) }));
      const pret = e.pret === undefined ? null : texteBorne(e.pret, PRET_MAX);
      if (e.pret !== undefined && !pret) avertissements.push(avertissement(`Le signe «\u00A0prêt\u00A0» de l’étape ${n} est illisible\u00A0: il n’est pas repris.`));
      let prechauffer = false;
      if (e.prechauffer === true) {
        if (appareil && APPAREILS_A_PRECHAUFFER.includes(appareil) && tempC !== null) prechauffer = true;
        else avertissements.push(avertissement(`L’étape ${n} allume un appareil sans dire lequel ni à quelle température.`));
      }
      let partAvant = null;
      if (e.partAvant !== undefined) {
        const element = typeof e.partAvant === 'string' ? parId.get(e.partAvant) : null;
        if (element && listeDe(element.quantites?.parts).length) partAvant = e.partAvant;
        else avertissements.push(avertissement(`L’étape ${n} met de côté une part qui n’existe pas\u00A0: ce n’est pas repris.`));
      }
      if (partAvant && !plats.includes(partAvant)) plats.push(partAvant);
      etapes.push({
        titre, texte: corps, duree, actif, appareil, mode, tempC, feu, ustensiles, plats, ingredients, aussi, pret,
        prechauffer, partAvant, veille: e.veille === true,
      });
    });

    // Chaque plat est dans une étape ; chaque ingrédient de chaque plat est cité.
    for (const [platId, element] of parId) {
      if (!etapes.some((e) => e.plats.includes(platId))) {
        erreurs.push(erreur(`${guillemets(nom(platId))} n’apparaît dans aucune étape.`, `batch.etapes : le plat ${platId} n'apparaît dans aucune étape`));
        continue;
      }
      const cites = new Set(etapes.flatMap((e) => e.ingredients.filter((c) => c.plat === platId).map((c) => cleProduit(c.produit))));
      for (const [cle, produit] of citables(element)) {
        if (!cites.has(cle)) {
          erreurs.push(erreur(`${guillemets(majuscule(produit))} de ${guillemets(nom(platId))} n’est cité dans aucune étape.`, `batch.etapes : « ${ligne(produit)} » de ${platId} n'est cité dans aucune étape`));
        }
      }
      if (!recipients.some((r) => r.plat === platId)) {
        avertissements.push(avertissement(`Pas de plat de cuisson donné pour ${guillemets(nom(platId))}.`));
      }
      if (listeDe(element.quantites?.parts).length && !etapes.some((e) => e.partAvant === platId)) {
        avertissements.push(avertissement(`La part à mettre de côté de ${guillemets(nom(platId))} n’a pas d’étape\u00A0: elle se prépare à part.`));
      }
    }
  }
  return sortie({
    semaine: texte(semaineId),
    empreinte: texte(empreinte),
    dureeTotale: brut.dureeTotale,
    travail: brut.travail,
    recipients,
    etapes,
  });
}

/**
 * Texte copié par « Copier les corrections pour Claude » pour un plan de batch refusé : CORRECTION paquet@1, la
 * version des instructions, la semaine, une ligne par erreur (codes exacts), puis la formule qui redemande le plan
 * entier (rien n'a été enregistré).
 */
export function texteCorrectionBatch({ erreurs = [], semaineId = null } = {}) {
  return [
    `CORRECTION ${FORMAT}`,
    `instructions: ${VERSION_INSTRUCTIONS}`,
    `semaine: ${ligne(semaineId ?? '')}`,
    ...listeDe(erreurs).filter((e) => e?.pourClaude).map((e) => `- ${ligne(e.pourClaude)}`),
    '(Rends le plan de batch entier, corrigé, { "format", "instructions", "batch" }, en un seul bloc.)',
  ].join('\n');
}

// ——— État de la carte ———

/**
 * Carte « 👩‍🍳 Le batch de la semaine » → { visible, etat: 'pret' | 'perime' | 'demande' | 'aDemander', nombre,
 * duree (texte), portionsChangees, demande: null | { par (adresse), quand (« aujourd’hui », « le 24 octobre », ''
 * tant que le serveur ne l'a pas datée), horsLigne } }.
 * `doc` : `plansBatch/<semaine>` lu (ou null) ; `elements` : platsDuBatch ; `semaine` : la semaine montrée ;
 * `aujourdhui` : 'AAAA-MM-JJ'.
 * Visible dès que la semaine a PLATS_BATCH_MIN plats du batch (décision 23 : avant comme après les courses), jusqu'à
 * sa fin ; `pret` : un plan à l'empreinte de la semaine ; `perime` : un plan d'avant un changement des plats ;
 * `demande` : demande ouverte sans plan à jour ; sinon `aDemander`.
 */
export function etatCarteBatch({ doc = null, elements = [], semaine = null, aujourdhui = null } = {}) {
  const lue = lireSemaine(semaine);
  const nombre = listeDe(elements).length;
  const masquee = { visible: false, etat: null, nombre, duree: null, portionsChangees: false, demande: null };
  if (!lue || nombre < PLATS_BATCH_MIN) return masquee;
  const empreinte = empreintePlanBatch(elements);
  const plan = estObjet(doc?.plan) && Array.isArray(doc.plan.etapes) ? doc.plan : null;
  const aJour = Boolean(plan) && doc.empreinte === empreinte;
  const demande = estObjet(doc?.demande) && doc.demande.statut === 'ouverte' && !aJour
    ? {
      par: texte(doc.demande.creePar) || null,
      quand: quandDemande(jourDeDerniereFois(doc.demande.creeLe), aujourdhui),
      horsLigne: doc.demande.creeLe == null,
    }
    : null;
  let etat = 'aDemander';
  if (aJour) etat = 'pret';
  else if (demande) etat = 'demande';
  else if (plan) etat = 'perime';
  const portions = portionsDuBatch(elements);
  const portionsChangees = aJour && estObjet(doc.portions)
    && Object.keys(portions).some((id) => Math.abs((doc.portions[id] ?? 0) - portions[id]) > 1e-6);
  return {
    visible: true, etat, nombre,
    duree: aJour ? texteEnviron(plan.dureeTotale, plan.travail) : null,
    portionsChangees, demande,
  };
}

/** Vrai si une demande de plan reste à traiter (écran Demandes, compte du gestionnaire). */
export function demandeBatchATraiter({ doc = null, elements = [], semaine = null } = {}) {
  return etatCarteBatch({ doc, elements, semaine }).etat === 'demande';
}

/** « Environ 2 h 30, dont 1 h 10 de travail » ; « Environ 2 h 30 » ; null. */
export function texteEnviron(total, travail) {
  if (!estNombre(total) || total <= 0) return null;
  return estNombre(travail) && travail > 0 && travail < total
    ? `Environ ${texteDuree(total)}, dont ${texteDuree(travail)} de travail`
    : `Environ ${texteDuree(total)}`;
}

/** Statut de la semaine assez avancé pour que le plan soit l'action du moment (courses faites). */
export const coursesFaites = (semaine) => {
  const lue = lireSemaine(semaine);
  return Boolean(lue) && RANGS_STATUT[statutSemaine(lue)] >= RANGS_STATUT.courses_faites;
};

/** Dates de la semaine pour l'écran Demandes : « Semaine du 24 au 30 octobre ». */
export function texteSemaineDuPlan(semaine) {
  const lue = lireSemaine(semaine);
  return lue ? TEXTES_PLAN_BATCH.semaineDu(texteDates(lue.debut, lue.fin)) : '';
}

// ——— L'écran du batch ———

/** Ingrédient d'une version qui demande une cuisson à cœur (volaille, porc hors charcuterie, viande hachée). */
function aCuireACoeur(ingredient) {
  const m = marqueursEffectifs(ingredient);
  return !m.has('charcuterie') && (m.has('volaille') || m.has('porc') || (m.has('viande') && ingredient?.forme === 'hachee'));
}

/** Familles d'unités qui s'additionnent (comme la liste de courses) : masse en grammes, volume en millilitres. */
const FAMILLES_UNITES = Object.freeze({ g: ['masse', 1], kg: ['masse', 1000], ml: ['volume', 1], cl: ['volume', 10], l: ['volume', 1000] });

/**
 * Total de plusieurs mesures d'un même produit → { qte, unite } (en kg au-delà de 1 000 g, en litres au-delà de
 * 1 000 ml, en cl au-delà de 100 ml), ou null si elles ne s'additionnent pas (unités de familles différentes,
 * mesure absente). Même unité hors familles (pièces, c. à soupe) : la somme dans cette unité.
 */
function totalDesMesures(mesures) {
  if (!mesures.every((m) => estNombre(m.qte) && m.qte > 0 && m.unite)) return null;
  const unite = mesures[0].unite;
  if (mesures.every((m) => m.unite === unite) && !FAMILLES_UNITES[unite]) {
    return { qte: propre(mesures.reduce((s, m) => s + m.qte, 0)), unite };
  }
  const familles = mesures.map((m) => FAMILLES_UNITES[m.unite]);
  if (familles.some((f) => !f) || familles.some((f) => f[0] !== familles[0][0])) return null;
  const base = propre(mesures.reduce((s, m, i) => s + m.qte * familles[i][1], 0));
  if (familles[0][0] === 'masse') return base >= 1000 ? { qte: propre(base / 1000), unite: 'kg' } : { qte: base, unite: 'g' };
  if (base >= 1000) return { qte: propre(base / 1000), unite: 'l' };
  return base >= 100 ? { qte: propre(base / 10), unite: 'cl' } : { qte: base, unite: 'ml' };
}

/** Quantités d'une étape du plan, ingrédients de plusieurs plats réunis par produit : « Pomme de terre · 1 kg (600 g pour Gratin, 400 g pour Salade) ». */
function quantitesDuPlan(etape, parId) {
  const parProduit = new Map();
  const ordre = [];
  for (const cite of etape.ingredients) {
    const element = parId.get(cite.plat);
    if (!element) continue;
    const [lue] = quantitesDeLEtape({ ingredients: [{ produit: cite.produit, part: cite.part }] }, element.quantites);
    if (!lue) continue;
    const cle = cleProduit(cite.produit);
    if (!parProduit.has(cle)) {
      parProduit.set(cle, []);
      ordre.push(cle);
    }
    parProduit.get(cle).push({ ...lue, plat: texte(element.plat.nom) });
  }
  return ordre.map((cle) => {
    const lues = parProduit.get(cle);
    if (lues.length === 1) return { produit: lues[0].produit, texte: lues[0].texte };
    const nom = majuscule(lues[0].produit);
    const detail = lues.map((l) => `${estNombre(l.qte) && l.qte > 0 ? `${texteQuantiteCuisine(l.qte, l.unite)} ` : ''}pour ${l.plat}`).join(', ');
    const total = totalDesMesures(lues);
    return total
      ? { produit: lues[0].produit, texte: `${nom} · ${texteQuantiteCuisine(arrondiCuisine(total.qte, total.unite, lues[0].produit), total.unite)} (${detail})` }
      : { produit: lues[0].produit, texte: `${nom} (${detail})` };
  });
}

/**
 * Modèle de l'écran du batch (#/batch/<semaine>) → { etat: 'ok' | 'introuvable', titrePage, duree, avant: { plats:
 * [texte], recipients: [texte], hygiene: [texte], enfant: [ligne 🧸], parts: [texte], veille: [étape], reunir: [{ platId,
 * nom, ingredients: [{ cle, texte }] }], aussi: texte | null, ustensiles: [{ cle, nom }] }, etapes: [{ cle, n, rang,
 * titre, texte, pret, duree, actif, ligneDuree, ligneAppareil, plats: [nom], pour, quantites: [{ produit, texte }],
 * aussi: [texte], ustensiles: [nom], rappels, conseils: [texte], pendant }], total, fin: { titre, plats: [{ nom,
 * portions, partFragile, congeler }], conseils: [texte] } }. Rien n'est écrit.
 * `plan` : plan normalisé (validerPlanBatch) ; `elements` : platsDuBatch (une étape qui ne vise plus aucun plat de la
 * semaine n'est pas montrée) ; `aujourdhui` : jour de cuisson ('AAAA-MM-JJ' ou Date).
 */
export function pasAPasBatch(plan, { elements = [], profils = [], moi = null, role = null, reglages = null, evaluer = undefined, aujourdhui = new Date() } = {}) {
  if (!estObjet(plan) || !Array.isArray(plan.etapes)) return { etat: 'introuvable', titrePage: TEXTES_PLAN_BATCH.titrePage(0) };
  const parId = new Map(listeDe(elements).filter((e) => estObjet(e) && typeof e.platId === 'string').map((e) => [e.platId, e]));
  const nomDuPlat = (platId) => texte(parId.get(platId)?.plat?.nom) || platId;
  const lues = plan.etapes.filter((e) => estObjet(e) && listeDe(e.plats).some((p) => parId.has(p)));

  // Étapes affichées : la veille d'abord (dans « Avant de commencer »), puis le jour même.
  const affichee = (etape, i, prefixe) => ({
    cle: `${prefixe}${i + 1}`,
    n: i + 1,
    titre: etape.titre,
    texte: etape.texte ?? '',
    pret: etape.pret ?? null,
    duree: etape.duree ?? null,
    actif: etape.actif ?? etape.duree ?? null,
    ligneDuree: ligneDuree({ duree: etape.duree, actif: etape.actif ?? etape.duree }),
    ligneAppareil: ligneAppareil(etape),
    plats: listeDe(etape.plats).filter((p) => parId.has(p)).map(nomDuPlat),
    quantites: quantitesDuPlan(etape, parId),
    aussi: aussiDeLEtape(etape, 1).map((a) => a.texte),
    ustensiles: listeDe(etape.ustensiles).map((u) => majuscule(texte(u))),
    citations: etape.ingredients.map((c) => ({ cle: cleProduit(c.produit), plat: c.plat })),
    source: etape,
  });
  const veille = lues.filter((e) => e.veille).map((e, i) => affichee(e, i, 'v'));
  const jour = lues.filter((e) => !e.veille).map((e, i) => affichee(e, i, 'b'));
  jour.forEach((etape, i) => {
    etape.rang = i + 1;
    etape.pour = etape.plats.length ? TEXTES_PLAN_BATCH.pour(etape.plats.join(', ')) : null;
    etape.pendant = Boolean(jour[i + 1] && estNombre(etape.duree) && estNombre(etape.actif) && etape.duree > etape.actif);
  });
  for (const etape of veille) {
    etape.rang = null;
    etape.pour = etape.plats.length ? TEXTES_PLAN_BATCH.pour(etape.plats.join(', ')) : null;
    etape.pendant = false;
  }
  const toutes = [...veille, ...jour];

  // Rappels : four (étape « prechauffer » : il servira à la prochaine étape qui l'utilise), parts, 🧸.
  const prechauffages = [];
  toutes.forEach((etape, i) => {
    const source = etape.source;
    if (!source.prechauffer) return;
    const servie = toutes.slice(i + 1).find((e) => e.source.appareil === source.appareil && !e.source.prechauffer);
    prechauffages.push({ appareil: source.appareil, tempC: source.tempC, avant: etape.cle, pour: servie?.cle ?? null, titre: servie?.titre ?? null });
  });
  const rappelsFour = rappelsDuDeroule({ sequence: toutes.map((e) => ({ cle: e.cle, titre: e.titre })), prechauffages });
  for (const etape of toutes) etape.rappels = [...(rappelsFour.get(etape.cle) ?? [])];

  const lignesParts = [];
  const hygiene = new Set();
  const enfant = [];
  const reunir = [];
  const fin = [];
  const conseilsFin = [];
  const jourCuisson = typeof aujourdhui === 'string' ? aujourdhui : (() => {
    const d = aujourdhui instanceof Date ? aujourdhui : new Date();
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  })();
  for (const [platId, element] of parId) {
    const { plat, quantites } = element;
    const nom = texte(plat.nom);
    const versions = listeDe(element.element?.versions).filter((v) => estObjet(v?.variante) && estObjet(v?.profil));
    const ajoutsVersions = versions.flatMap((v) => listeDe(v.variante.ajouter));
    for (const geste of hygieneDuPlat(plat, ajoutsVersions)) hygiene.add(geste);
    // Parts : sur l'étape `partAvant` de ce plat, sinon la première de ce plat qui cite un ingrédient que la version retire.
    for (const part of listeDe(quantites.parts)) {
      const retires = new Set(part.retirer.map(cleProduit));
      const etape = toutes.find((e) => e.source.partAvant === platId)
        ?? toutes.find((e) => e.citations.some((c) => c.plat === platId && retires.has(c.cle))) ?? null;
      const qui = laPart(part.profil, moi);
      const consigne = part.consigne ? ` : ${sansPoint(part.consigne)}` : '';
      const coeur = part.ajouts.length && versions.some((v) => v.profil.id === part.profilId && listeDe(v.variante.ajouter).some(aCuireACoeur))
        ? ` ${CONSEILS.coeur.texte}` : '';
      if (etape) {
        etape.rappels.push({
          genre: 'part', profilId: part.profilId,
          texte: `✂️ Mettez de côté ${qui} de ${guillemets(nom)} maintenant, avec une cuillère propre.`,
          consigne: [part.consigne ? `${sansPoint(part.consigne)}.` : '', coeur.trim()].filter(Boolean).join(' '),
          ajouts: part.ajouts.map((a) => a.texte),
          case: { cle: `part:${platId}:${part.profilId}`, libelle: estMoi(part.profil, moi) ? `Votre part de ${guillemets(nom)} mise de côté` : `Part ${deNom(nomDe(part.profil))} de ${guillemets(nom)} mise de côté` },
        });
      }
      const ou = etape?.rang ? ` se met de côté avant l’étape ${etape.rang}` : (etape ? ' se met de côté la veille' : ' se prépare à part');
      lignesParts.push(`✂️ ${majuscule(qui)} de ${guillemets(nom)}${ou}${consigne}.${coeur}`);
    }
    // 🧸 : sur la première étape qui cite, pour ce plat, un produit en cause.
    const precautions = precautionsDuPlat(plat, { element: element.element, profils, evaluer });
    enfant.push(...lignesEnfant(precautions, { role }).map((l) => ({ ...l, texte: `${l.texte} (${nom})` })));
    const rappelsEnfant = rappelsDuDeroule({
      sequence: toutes.map((e) => ({ cle: e.cle, titre: e.titre, citations: e.citations.filter((c) => c.plat === platId) })),
      precautions, role, moi,
    });
    for (const etape of toutes) etape.rappels.push(...(rappelsEnfant.get(etape.cle) ?? []).filter((r) => r.genre === 'enfant'));
    // Sortir tout ce qu'il faut : les ingrédients de ce plat (quantités de la semaine), puis les ajouts de ses parts.
    const ingredients = listeDe(quantites.lignes).filter((l) => !l.personne && texte(l.produit))
      .map((l) => ({ cle: `ing:${platId}:${cleProduit(l.produit)}`, texte: l.texte }));
    const vues = new Set();
    const uniques = ingredients.filter((i) => (vues.has(i.cle) ? false : vues.add(i.cle)));
    for (const part of listeDe(quantites.parts)) {
      const qui = estMoi(part.profil, moi) ? 'votre part' : `part ${deNom(nomDe(part.profil))}`;
      part.ajouts.forEach((ajout, i) => uniques.push({ cle: `part:${platId}:${part.profilId}:${i}`, texte: `${ajout.texte} (${qui})` }));
    }
    reunir.push({ platId, nom, ingredients: uniques });
    // Fin : portions au frigo et au congélateur, date limite, part la plus fragile.
    const finDuPlat = finDeCuisson(plat, element.element, jourCuisson, { finSemaine: element.element?.semaine?.fin ?? null, reglages });
    const phrases = phrasesDeFin(finDuPlat, { moi });
    fin.push({ platId, nom, portions: phrases.portions, partFragile: phrases.partFragile, congeler: phrases.congeler });
    for (const c of phrases.conseils) if (!conseilsFin.includes(c)) conseilsFin.push(c);
  }
  // Rappels d'une étape : four, part, 🧸 (comme « Cuisiner pas à pas »).
  const rang = { four: 0, part: 1, enfant: 2 };
  for (const etape of toutes) etape.rappels.sort((a, b) => rang[a.genre] - rang[b.genre]);
  // Conseil de cuisson à cœur (comme cuisine.js › etapesDuCoeur) : pour chaque ingrédient à cuire à cœur, à partir de
  // la première étape qui le cite, la première étape de son plat qui a un appareil et un signe « prêt », sinon la
  // première qui a un appareil, sinon l'étape qui le cite.
  for (const etape of toutes) etape.conseils = [];
  for (const [platId, element] of parId) {
    for (const ingredient of listeDe(element.plat.ingredients).filter((i) => estObjet(i) && aCuireACoeur(i))) {
      const cle = cleProduit(ingredient.produit);
      const debut = toutes.findIndex((e) => e.citations.some((c) => c.plat === platId && c.cle === cle));
      if (debut < 0) continue;
      const suite = toutes.slice(debut).filter((e) => e.source.plats.includes(platId));
      const choisie = suite.find((e) => e.source.appareil && e.source.pret) ?? suite.find((e) => e.source.appareil) ?? toutes[debut];
      if (!choisie.conseils.includes(CONSEILS.coeur.texte)) choisie.conseils.push(CONSEILS.coeur.texte);
    }
  }

  // Ce qu'on sort : « Et aussi » et ustensiles de toutes les étapes du jour, plats de cuisson.
  const aussi = [];
  const ustensiles = new Map();
  for (const etape of jour) {
    for (const chose of listeDe(etape.source.aussi)) {
      const produit = texte(typeof chose === 'string' ? chose : chose?.produit);
      if (produit && !aussi.some((a) => slug(a) === slug(produit))) aussi.push(produit);
    }
    for (const ustensile of listeDe(etape.source.ustensiles)) {
      const cle = slug(ustensile);
      if (cle && !ustensiles.has(cle)) ustensiles.set(cle, { cle: `ust:${cle}`, nom: majuscule(texte(ustensile)) });
    }
  }
  const recipients = listeDe(plan.recipients).filter((r) => parId.has(r.plat))
    .map((r) => TEXTES_PLAN_BATCH.recipient(nomDuPlat(r.plat), majuscule(r.ustensile), r.taille));
  const nettoyer = ({ citations: _c, source: _s, ...etape }) => etape;
  return {
    etat: 'ok',
    titrePage: TEXTES_PLAN_BATCH.titrePage(parId.size),
    duree: texteEnviron(plan.dureeTotale, plan.travail),
    avant: {
      plats: [...parId.values()].map((e) => `${texte(e.plat.nom)} · ${portionsEnMots(propre(e.quantites.portions))}`),
      recipients,
      hygiene: [
        TEXTES_CUISINE.mains,
        ...(hygiene.has('planche') ? [CONSEILS.planche.texte] : []),
        ...(hygiene.has('oeufs') ? [TEXTES_CUISINE.oeufs] : []),
      ],
      enfant,
      parts: lignesParts,
      veille: veille.map(nettoyer),
      reunir,
      aussi: aussi.length ? TEXTES_CUISINE.etAussi(aussi.join(', ')) : null,
      ustensiles: [...ustensiles.values()],
    },
    etapes: jour.map(nettoyer),
    total: jour.length,
    fin: { titre: TEXTES_PLAN_BATCH.fin, plats: fin, conseils: conseilsFin },
  };
}

/** Clé de la reprise du batch sur le téléphone (étape, cases, 12 h, comme « Cuisiner pas à pas ») : par compte et par semaine. */
export function cleRepriseBatch(uid, semaineId) {
  return `repas-courses:batch:${uid}:${semaineId}`;
}
