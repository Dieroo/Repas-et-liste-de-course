// « Cuisiner pas à pas » (T5-1, plan §6.5 et §8.5) : quantités à cuisiner pour la semaine, arrondis de cuisine, étapes
// dans l'ordre de l'ordonnanceur (deroule.js), fins implicites, rappels en tête d'étape (four, part mise de côté, 🧸),
// hygiène, conseils fixes, fin de cuisson et date limite, reprise. Logique pure : ni DOM ni Firebase, aucune écriture.
// N'importe que slug.js, vocabulaire.js, plats.js, semaine.js, realisation.js, deroule.js, et (écart signalé) age.js
// pour les précautions 🧸, notes.js pour « la part d’Adulte B », corbeille.js : aucun d'eux ne l'importe.
// - Formule des quantités RECOPIÉE de liste.js › listeDeCourses (liste.js n'est jamais touché) : facteur =
//   (portions à cuisiner + à congeler − parts dont la version retire l'ingrédient) / portionsBase ; ajouts d'une version
//   = qtePortion × coefPortion × repas. Un test d'accord la tient égale à la liste de courses (tests/coeur-cuisine).
// - Arrondi de cuisine au plus près (jamais 0), seulement quand la quantité n'est pas celle écrite dans la recette.
import { cleProduit, slug } from './slug.js';
import { EMOJIS_STYLE, STYLES, estObjet, marqueursEffectifs, texte } from './vocabulaire.js';
import { aSaRecette, quantiteLisible, statutDe } from './plats.js';
import {
  FRIGO_JOURS_DEFAUT, ajouterJours, coefDe, estDansLaSemaine, jourValide, mangeParDefaut, platsDeLaSemaine,
  semaineAPreparer, semaineEnCours, texteJour, versionServie,
} from './semaine.js';
import { TEXTES_ETAPES, etapesLisibles, ligneAppareil, ligneDuree, texteDuree } from './realisation.js';
import { APPAREILS_A_SORTIR, capacites, etapesDeLaVeille, ordreDUnPlat } from './deroule.js';
import { precautionsAge, profilsAvecAge, texteBorne } from './age.js';
import { deNom } from './notes.js';
import { estDansCorbeille } from './corbeille.js';

const TOLERANCE = 1e-9;
const estNombre = (valeur) => typeof valeur === 'number' && Number.isFinite(valeur);
const listeDe = (valeur) => (Array.isArray(valeur) ? valeur : []);
const propre = (valeur) => Math.round(valeur * 1e6) / 1e6;
const majuscule = (valeur) => (valeur ? `${valeur.charAt(0).toLocaleUpperCase('fr-FR')}${valeur.slice(1)}` : valeur);
const nomDe = (profil) => texte(profil?.nom) || 'Sans prénom';
const estMoi = (profil, moi) => Boolean(moi) && typeof moi.id === 'string' && moi.id === profil?.id;
const guillemets = (valeur) => `«\u00A0${valeur}\u00A0»`;
const nombreFr = new Intl.NumberFormat('fr-FR', { maximumFractionDigits: 2 });
const portionsEnMots = (n) => `${nombreFr.format(n)}\u00A0${n > 1 ? 'portions' : 'portion'}`;
/** Phrase sans sa ponctuation finale (une consigne recopiée suivie d'un point). */
const sansPoint = (valeur) => texte(valeur).replace(/[\s.!…;,:]+$/u, '');
const portionsBaseDe = (plat) => (estNombre(plat?.portionsBase) && plat.portionsBase > 0 ? plat.portionsBase : null);

/** Fin de cuisson → au frigo : deux heures au plus (conseil 4). */
export const AU_FRIGO_AVANT_MIN = 120;
/** Étape et cases gardées sur le téléphone : 12 heures. */
export const REPRISE_HEURES = 12;

// ——— Textes ———

/** Conseils fixes (plan §8.7, textes exacts) et leur moment : avant de commencer, pendant la cuisson, ranger. */
export const CONSEILS = Object.freeze({
  mains: Object.freeze({ moment: 'avant', texte: 'Lavez-vous les mains avant de commencer, et chaque fois que vous avez touché de la viande, du poisson ou des œufs crus.' }),
  planche: Object.freeze({ moment: 'avant', texte: 'Une planche et un couteau pour le cru, d’autres pour les légumes et le cuit.' }),
  coeur: Object.freeze({ moment: 'cuisson', texte: 'Volaille, viande hachée et porc se mangent cuits à cœur\u00A0: plus du tout rosés au centre.' }),
  boites: Object.freeze({ moment: 'ranger', texte: 'Mettez en boîtes peu profondes, couvercle entrouvert, laissez tiédir une heure au plus, puis au frigo en moins de 2\u00A0heures.' }),
  etiquette: Object.freeze({ moment: 'ranger', texte: 'Étiquetez chaque boîte\u00A0: plat, pour qui, date de cuisson et date limite.' }),
  congeler: Object.freeze({ moment: 'ranger', texte: 'Congelez le jour même ce qui ne sera pas mangé à temps.' }),
  decongeler: Object.freeze({ moment: 'ranger', texte: 'Décongelez au frigo, réchauffez une seule fois jusqu’à ce que le centre soit bien chaud, et ne recongelez jamais un plat décongelé.' }),
});

/** Fins implicites (essai du 2026-10-12) : titre et texte selon l'appareil de l'étape d'attente. */
export const FINS_IMPLICITES = Object.freeze({
  four: Object.freeze({ titre: 'Sortir du four', texte: 'Quand c’est prêt, sortez le plat du four avec des maniques et posez-le sur un dessous-de-plat.' }),
  cookeo: Object.freeze({ titre: 'Ouvrir le Cookeo', texte: 'Quand c’est prêt, arrêtez le Cookeo et laissez sortir toute la vapeur avant d’ouvrir le couvercle.' }),
  airfryer: Object.freeze({ titre: 'Sortir de l’airfryer', texte: 'Quand c’est prêt, sortez le panier de l’airfryer avec des maniques\u00A0: il est brûlant.' }),
});

const NOMS_APPAREIL = Object.freeze({ four: 'le four', airfryer: 'l’airfryer' });

/** Textes de l'écran « Cuisiner pas à pas » (plan §8.4 et §8.5). */
export const TEXTES_CUISINE = Object.freeze({
  bouton: '👩‍🍳 Cuisiner pas à pas',
  titrePage: (nom) => `Cuisiner\u00A0: ${nom}`,
  quitter: '✕ Quitter',
  plusGrand: 'A+',
  // Nom accessible qui commence par le libellé visible (« A+ ») : une commande vocale le trouve (WCAG 2.5.3).
  plusGrandNom: 'A+\u00A0: texte plus grand',
  // « sur N » insécable : en police très agrandie, le compteur ne se coupe jamais avant son dernier nombre.
  etapeSur: (rang, total) => `Étape ${rang} sur\u00A0${total}`,
  avantDeCommencer: 'Avant de commencer',
  laVeille: 'La veille',
  // Cuisson de la veille sortie de l'appareil (fin implicite d'une étape « la veille ») : au frigo pour la nuit.
  frigoVeille: '🧊 Laissez tiédir une heure au plus, couvrez, puis au frigo en moins de 2\u00A0heures.',
  // Fin : la date limite d'un plat dont la cuisson s'est faite la veille.
  depuisLaVeille: 'Compté depuis la cuisson de la veille.',
  sortirToutCeQuIlFaut: 'Sortir tout ce qu’il faut',
  etAussi: (noms) => `Et aussi\u00A0: ${noms}`,
  quantitesPour: 'Quantités pour\u00A0:',
  optionSemaine: (n) => `${portionsEnMots(n)} (cette semaine)`,
  optionRecette: (n) => `${portionsEnMots(n)} (la recette)`,
  commencer: 'Commencer ›',
  suivante: 'Suivante ›',
  derniere: 'C’est prêt ›',
  precedente: '‹',
  precedenteNom: 'Étape précédente',
  pendant: 'Pendant que ça cuit\u00A0: passez à l’étape suivante.',
  pretQuand: TEXTES_ETAPES.pretQuand,
  pasCetteFois: 'pas cette fois',
  fin: 'C’est prêt 🎉',
  pourBienConserver: 'Pour bien conserver',
  jourDuRepas: 'Le jour du repas',
  revenir: 'Revenir à la recette',
  ecranAllume: 'L’écran reste allumé.',
  suite: '↓ La suite plus bas',
  reprise: (rang) => `Vous en étiez à l’étape ${rang}.`,
  reprendre: 'Reprendre',
  recommencer: 'Recommencer',
  sansEtapes: 'Cette recette n’a pas encore d’étapes.',
  mains: `🧼 ${CONSEILS.mains.texte}`,
  oeufs: 'Après avoir cassé des œufs, relavez-vous les mains.',
  cuissons: 'Cuissons de la recette\u00A0:',
  frigoAvant: (heure) => `🧊 Au frigo avant ${heure}`,
});

// ——— Quantités ———

/** Vrai pour un produit qui ne se coupe pas : repère `oeuf`, nom qui commence par « gousse », ou l'ail (en gousses). */
function neSeCoupePas(produit) {
  const ingredient = estObjet(produit) ? produit : { produit };
  const effectifs = marqueursEffectifs(ingredient);
  const cle = cleProduit(typeof ingredient.produit === 'string' ? ingredient.produit : '');
  return effectifs.has('oeuf') || effectifs.has('oeuf_cru') || /(^|-)oeuf(-|$)/.test(cle) || cle.startsWith('gousse')
    || cle === 'ail';
}

/** Pas d'arrondi d'une quantité de cuisine (plan §6.5), ou null pour une unité inconnue. */
function pasDe(qte, unite, produit) {
  switch (unite) {
    case 'g': return qte < 20 ? 1 : qte < 200 ? 5 : 10;
    case 'kg': return 0.05;
    case 'ml': return qte < 200 ? 5 : 10;
    case 'cl': return 0.5;
    case 'l': return 0.05;
    case 'cs': case 'cc': return 0.5;
    case 'pc': return neSeCoupePas(produit) ? 1 : 0.5;
    case 'sachet': case 'boite': case 'tranche': case 'pincee': case 'botte': return 1;
    default: return null;
  }
}

/**
 * Arrondi de cuisine, au plus près, jamais 0 (au moins un pas) : g 1 sous 20, 5 sous 200, 10 ensuite ; kg au 0,05 ;
 * ml 5 sous 200, 10 ensuite ; cl au 0,5 ; l au 0,05 ; c. à soupe et c. à café au demi ; pièces au demi (« 1,5 oignon »),
 * sauf un produit qui ne se coupe pas (œuf, gousse, ail : entier) ; sachet, boîte, tranche, pincée, botte : entier.
 * Idempotent ; unité inconnue : au centième. `produit` : l'ingrédient (pour ses repères) ou son nom. Quantité nulle,
 * négative ou illisible : rendue telle quelle.
 */
export function arrondiCuisine(qte, unite, produit = null) {
  if (!estNombre(qte) || qte <= 0) return qte;
  const pas = pasDe(qte, unite, produit);
  if (pas === null) return Math.max(0.01, Math.round(qte * 100) / 100);
  return propre(Math.max(pas, Math.round(qte / pas) * pas));
}

/** « 600 g », « 1,5 » (pièces), « 2 c. à soupe » ; '' sans quantité lisible (jamais d'espace insécable écrite telle quelle). */
export function texteQuantiteCuisine(qte, unite) {
  return quantiteLisible(qte, unite ?? 'pc');
}

const texteMesure = (produit, qte, unite) => {
  const mesure = estNombre(qte) && qte > 0 ? texteQuantiteCuisine(qte, unite) : '';
  return mesure ? `${majuscule(produit)} · ${mesure}` : majuscule(produit);
};

/** Vrai si l'élément de la semaine donne des portions à cuisiner (plat présent, avec sa recette, quelqu'un en mange). */
const semaineUtile = (element) => Boolean(estObjet(element) && element.etat === 'ok'
  && estNombre(element.aCuire) && estNombre(element.aCongeler) && element.aCuire + element.aCongeler > 0);

/**
 * Quantités à cuisiner (formule de liste.js › listeDeCourses, recopiée) → { portions, base, facteur, sansBase, semaine,
 *   lignes: [{ produit, qte, qteExacte, unite, facteur, arrondie, personne, texte, retirePour: [profilId], ingredient }],
 *   parts: [{ profilId, profil, style, nomme, portions, retirer: [produit], ajouts: [{ produit, qte, qteExacte, unite,
 *     texte }], consigne }] }.
 * `element` : élément de semaine.js › platsDeLaSemaine (versions servies, repas, invités, portions à congeler) ; null
 * (ou plat que personne ne mange) : quantités de la recette, inchangées au bit près. Une ligne par ingrédient de la
 * fiche, dans son ordre ; `qteExacte` : quantité exacte, dans l'unité de la recette (null si elle est illisible ; 0 si
 * toutes les parts retirent l'ingrédient : `personne`) ; `qte` : arrondie (arrondiCuisine) si le facteur de la ligne
 * n'est pas 1 ; `texte` : « Pâtes courtes · 600 g ». Sans portionsBase lisible : facteur 1 (`sansBase`), comme la liste.
 * `profils` : inutilisé pour le calcul (les profils viennent de l'élément), gardé pour la signature du plan.
 */
export function quantitesACuisiner(plat, element = null, profils = []) {
  void profils;
  const base = portionsBaseDe(plat);
  const semaine = semaineUtile(element);
  const total = semaine ? element.aCuire + element.aCongeler : base;
  const facteur = base === null || !semaine ? 1 : total / base;
  const versions = semaine ? listeDe(element.versions).filter((v) => estObjet(v?.variante) && estObjet(v?.profil)) : [];
  const repas = semaine && estNombre(element.repas) ? element.repas : 0;
  const lignes = listeDe(plat?.ingredients).filter(estObjet).map((ingredient) => {
    const produit = texte(ingredient.produit);
    const cle = slug(produit);
    const retirent = versions.filter((v) => new Set(listeDe(v.variante.retirer).map(slug).filter(Boolean)).has(cle));
    const retire = retirent.reduce((somme, v) => somme + coefDe(v.profil) * repas, 0);
    const f = base === null || !semaine ? 1 : Math.max(0, total - retire) / base;
    const unite = typeof ingredient.unite === 'string' ? ingredient.unite : null;
    const lue = estNombre(ingredient.qte) && ingredient.qte > 0 ? ingredient.qte : null;
    const personne = semaine && f <= TOLERANCE;
    const qteExacte = lue === null ? null : (personne ? 0 : lue * f);
    const arrondie = qteExacte !== null && qteExacte > 0 && Math.abs(f - 1) > TOLERANCE;
    const qte = arrondie ? arrondiCuisine(qteExacte, unite, ingredient) : qteExacte;
    return {
      produit, qte, qteExacte, unite, facteur: f, arrondie, personne,
      texte: personne ? `${majuscule(produit)} · ${TEXTES_CUISINE.pasCetteFois}` : texteMesure(produit, qte, unite),
      retirePour: [...new Set(retirent.map((v) => v.profil.id))], ingredient,
    };
  });
  const parts = versions.map((version) => {
    const portions = propre(coefDe(version.profil) * repas);
    const ajouts = listeDe(version.variante.ajouter).filter(estObjet).map((ajout) => {
      const produit = texte(ajout.produit);
      const unite = typeof ajout.unite === 'string' ? ajout.unite : null;
      const qteExacte = estNombre(ajout.qtePortion) && ajout.qtePortion > 0 ? ajout.qtePortion * portions : null;
      const arrondie = qteExacte !== null && Math.abs(portions - 1) > TOLERANCE;
      const qte = arrondie ? arrondiCuisine(qteExacte, unite, ajout) : qteExacte;
      return { produit, qte, qteExacte, unite, texte: texteMesure(produit, qte, unite) };
    });
    return {
      profilId: version.profil.id, profil: version.profil, style: version.style ?? null, nomme: version.nomme !== false,
      portions, retirer: listeDe(version.variante.retirer).map(texte).filter(Boolean), ajouts,
      consigne: texte(version.variante.consigne),
    };
  });
  return { portions: total, base, facteur, sansBase: base === null, semaine, lignes, parts };
}

/** Citations d'une étape lue (etapesLisibles) ou brute : [{ produit, part }], sans doublon de produit. */
function citations(etape) {
  const vues = new Set();
  const sortie = [];
  for (const cite of listeDe(etape?.ingredients)) {
    const produit = texte(typeof cite === 'string' ? cite : cite?.produit);
    const cle = cleProduit(produit);
    if (!cle || vues.has(cle)) continue;
    vues.add(cle);
    const part = estObjet(cite) && estNombre(cite.part) && cite.part > 0 && cite.part <= 1 ? cite.part : 1;
    sortie.push({ produit, part, cle });
  }
  return sortie;
}

/**
 * Arrondi d'une quantité d'étape : celui de la cuisine (arrondiCuisine) ; quand seule la `part` la change (recette
 * telle quelle), au gramme ou au millilitre près pour une masse ou un volume en g ou ml (« 28 g », pas « 30 g »).
 */
function arrondiDeLaPart(qte, unite, ingredient, seulePart) {
  if (seulePart && (unite === 'g' || unite === 'ml')) return Math.max(1, Math.round(qte));
  return arrondiCuisine(qte, unite, ingredient);
}

/**
 * Quantités d'une étape → [{ produit, texte, qte, unite }] (une entrée par produit cité ; plusieurs unités : « Beurre ·
 * 30 g + 1 c. à soupe »). `part` appliquée avant l'arrondi ; un produit présent deux fois dans la fiche : quantités
 * additionnées (même unité). Arrondi seulement si la quantité n'est pas celle de la recette (facteur ou part ≠ 1 ;
 * seule la part : arrondiDeLaPart).
 * Produit introuvable ou sans quantité : son nom seul ; retiré par toutes les parts : « … · pas cette fois ».
 */
export function quantitesDeLEtape(etape, quantites) {
  const lignes = listeDe(quantites?.lignes);
  return citations(etape).map(({ produit, part, cle }) => {
    const memes = lignes.filter((l) => cleProduit(l.produit) === cle);
    const nom = memes[0]?.produit || produit;
    if (!memes.length) return { produit: nom, texte: majuscule(nom), qte: null, unite: null };
    if (memes.every((l) => l.personne)) {
      return { produit: nom, texte: `${majuscule(nom)} · ${TEXTES_CUISINE.pasCetteFois}`, qte: 0, unite: memes[0].unite };
    }
    const parUnite = new Map();
    for (const ligne of memes) {
      if (!estNombre(ligne.qteExacte) || ligne.qteExacte <= 0) continue;
      const unite = ligne.unite ?? 'pc';
      const deja = parUnite.get(unite) ?? { qte: 0, arrondie: false, seulePart: true, ingredient: ligne.ingredient };
      deja.qte += ligne.qteExacte * part;
      deja.arrondie = deja.arrondie || ligne.arrondie || Math.abs(part - 1) > TOLERANCE;
      if (ligne.arrondie) deja.seulePart = false;
      parUnite.set(unite, deja);
    }
    if (!parUnite.size) return { produit: nom, texte: majuscule(nom), qte: null, unite: null };
    const mesures = [...parUnite].map(([unite, { qte, arrondie, seulePart, ingredient }]) => ({
      unite, qte: arrondie ? arrondiDeLaPart(qte, unite, ingredient, seulePart) : propre(qte),
    }));
    return {
      produit: nom,
      texte: `${majuscule(nom)} · ${mesures.map((m) => texteQuantiteCuisine(m.qte, m.unite)).join(' + ')}`,
      qte: mesures[0].qte,
      unite: mesures[0].unite,
    };
  });
}

/**
 * « Et aussi » d'une étape → [{ produit, texte }] : « Gros sel · 1 c. à soupe », « Poivre noir » ; une mesure suit le
 * `facteur` (portions ÷ portionsBase), arrondie si le facteur n'est pas 1 ; `fixe` (eau de cuisson et son sel) jamais
 * mise à l'échelle.
 */
export function aussiDeLEtape(etape, facteur = 1) {
  const f = estNombre(facteur) && facteur > 0 ? facteur : 1;
  return listeDe(etape?.aussi).map((element) => {
    if (typeof element === 'string') return { produit: texte(element), texte: majuscule(texte(element)) };
    const produit = texte(element?.produit);
    if (!estNombre(element?.qte) || element.qte <= 0) return { produit, texte: majuscule(produit) };
    const unite = element.unite ?? null;
    const echelle = !element.fixe && Math.abs(f - 1) > TOLERANCE;
    const qte = echelle ? arrondiCuisine(element.qte * f, unite ?? 'pc', produit) : element.qte;
    return { produit, texte: texteMesure(produit, qte, unite) };
  }).filter((a) => a.produit);
}

// ——— Hygiène ———

const FUME = /(^|-)fume(e|s|es)?(-|$)/;

/**
 * Gestes d'hygiène utiles au plat → ['mains', 'planche'?, 'oeufs'?, 'coeur'?] : `mains` toujours ; `planche` si un
 * ingrédient est une viande (hors charcuterie), une volaille, du porc, du bœuf, de l'agneau, un poisson ou des fruits
 * de mer (« fumé » dans le nom exclu) ; `oeufs` si `oeuf` ; `coeur` si volaille, porc (hors charcuterie) ou viande
 * hachée (forme `hachee`). `ajouts` : ingrédients ajoutés par les versions servies (la part d'Adulte B au saumon),
 * jugés de la même façon.
 */
export function hygieneDuPlat(plat, ajouts = []) {
  let planche = false;
  let oeufs = false;
  let coeur = false;
  for (const ingredient of [...listeDe(plat?.ingredients), ...listeDe(ajouts)].filter(estObjet)) {
    const m = marqueursEffectifs(ingredient);
    const fume = FUME.test(slug(ingredient.produit));
    const charcuterie = m.has('charcuterie');
    if ((m.has('viande') && !charcuterie) || ((m.has('poisson') || m.has('fruits_de_mer')) && !fume)) planche = true;
    if (m.has('oeuf') || m.has('oeuf_cru')) oeufs = true;
    if (!charcuterie && (m.has('volaille') || m.has('porc') || (m.has('viande') && ingredient.forme === 'hachee'))) coeur = true;
  }
  return ['mains', ...(planche ? ['planche'] : []), ...(oeufs ? ['oeufs'] : []), ...(coeur ? ['coeur'] : [])];
}

/** Ingrédients de la fiche qui demandent une cuisson à cœur (volaille, porc hors charcuterie, viande hachée). */
function produitsACoeur(plat) {
  return listeDe(plat?.ingredients).filter(estObjet).filter((ingredient) => {
    const m = marqueursEffectifs(ingredient);
    return !m.has('charcuterie') && (m.has('volaille') || m.has('porc') || (m.has('viande') && ingredient.forme === 'hachee'));
  }).map((ingredient) => cleProduit(ingredient.produit)).filter(Boolean);
}

/**
 * Numéros des étapes qui portent le conseil 3 (cuisson à cœur) : pour chaque produit concerné, à partir de la première
 * étape qui le cite, la première étape (elle ou une étape qui l'attend, directement ou non) qui a un appareil et un
 * signe `pret` ; sinon la première qui a un appareil ; sinon l'étape qui le cite.
 */
export function etapesDuCoeur(etapes, plat) {
  const lues = listeDe(etapes).filter((e) => estObjet(e) && estNombre(e.n) && !e.auService);
  const cles = produitsACoeur(plat);
  const numeros = new Set();
  if (!cles.length) return numeros;
  const enfants = new Map(lues.map((e) => [e.n, []]));
  for (const e of lues) for (const k of listeDe(e.apres)) enfants.get(k)?.push(e.n);
  for (const cle of new Set(cles)) {
    const premiere = lues.find((e) => citations(e).some((c) => c.cle === cle));
    if (!premiere) continue;
    const suite = new Set([premiere.n]);
    const pile = [premiere.n];
    while (pile.length) for (const k of enfants.get(pile.pop()) ?? []) if (!suite.has(k)) { suite.add(k); pile.push(k); }
    const candidates = lues.filter((e) => suite.has(e.n)).sort((a, b) => a.n - b.n);
    const choisie = candidates.find((e) => e.appareil && e.pret) ?? candidates.find((e) => e.appareil) ?? premiere;
    numeros.add(choisie.n);
  }
  return numeros;
}

// ——— Précautions 🧸 ———

/** « Pas avant 5 ans », « Déconseillé avant 15 ans » (sans borne : « À éviter », « Déconseillé »). */
function texteSeverite(severite, jusquAMois) {
  const borne = estNombre(jusquAMois) && jusquAMois > 0 ? texteBorne(jusquAMois) : '';
  if (severite === 'exclu') return borne ? `Pas avant ${borne}` : 'À éviter';
  return borne ? `Déconseillé avant ${borne}` : 'Déconseillé';
}

/**
 * Précautions selon l'âge du plat tel qu'il sera servi → [{ profil, precautions }] : profils qui ont une règle d'âge
 * active (age.js › profilsAvecAge), dans l'ordre ; avec un élément de la semaine, seulement ceux qui en mangent, avec
 * leur version servie ; sinon tous, avec la version que evaluer retient.
 */
export function precautionsDuPlat(plat, { element = null, profils = [], evaluer = undefined } = {}) {
  const sortie = [];
  const mangeurs = semaineUtile(element) ? new Map(listeDe(element.mangeurs).map((m) => [m.profil?.id, m])) : null;
  for (const profil of profilsAvecAge(profils)) {
    let variante = null;
    if (mangeurs) {
      if (!mangeurs.get(profil.id)?.mange) continue;
      variante = listeDe(element.versions).find((v) => v.profil?.id === profil.id)?.variante ?? null;
    } else {
      variante = versionServie(plat, profil, null, evaluer)?.variante ?? null;
    }
    const precautions = precautionsAge(plat, profil, { variante });
    if (precautions.length) sortie.push({ profil, precautions });
  }
  return sortie;
}

/**
 * Lignes 🧸 de « Avant de commencer » → [{ profilId, symbole ('❌', '!' ou null), corps, texte }] : une par précaution,
 * « 🧸 Pour Enfant : ❌ Pas avant 5 ans : lait cru (camembert). <conseil> » ; ni ❌ ni ! hors du gestionnaire.
 */
export function lignesEnfant(precautionsParProfil, { role = null } = {}) {
  const lignes = [];
  for (const { profil, precautions } of listeDe(precautionsParProfil)) {
    for (const precaution of listeDe(precautions)) {
      const produits = listeDe(precaution.produits).filter(Boolean);
      const consigne = texte(precaution.consigne);
      const corps = `${texteSeverite(precaution.severite, precaution.jusquAMois)}\u00A0: ${precaution.court ?? ''}${produits.length ? ` (${produits.join(', ')})` : ''}.${consigne ? ` ${consigne}` : ''}`;
      const symbole = role === 'gestionnaire' ? (precaution.severite === 'exclu' ? '❌' : '!') : null;
      lignes.push({ profilId: profil.id, symbole, corps, texte: `🧸 Pour ${nomDe(profil)}\u00A0: ${symbole ? `${symbole} ` : ''}${corps}` });
    }
  }
  return lignes;
}

// ——— Rappels ———

/** « la part d’Adulte B » ; « votre part ». */
const laPart = (profil, moi) => (estMoi(profil, moi) ? 'votre part' : `la part ${deNom(nomDe(profil))}`);

/**
 * Rappels en tête des étapes d'un déroulé → Map cle → [{ genre: 'four' | 'part' | 'enfant', texte, … }], dans cet
 * ordre pour une étape. `sequence` : étapes dans l'ordre affiché ([{ cle, n, rang, titre, implicite, citations? }]) ;
 * `prechauffages` : ceux de deroule.js › ordreDUnPlat (chacun sur l'étape `avant`) ; `parts` : [{ profil, retirer,
 * consigne, ajouts: [texte] }] ; `precautions` : precautionsDuPlat ; `cible` : rang affiché de chaque étape.
 * - four : « 🔥 Allumez le four à 200 °C maintenant : il servira à « Gratiner au four ». » (« Réglez le four à … »
 *   s'il est encore chaud, « Rallumez le four à … » s'il a été éteint depuis ; « 🔥 Dès que le four est libre,
 *   réglez-le à … » quand un plat l'occupe encore) ;
 * - part : sur l'étape `partAvant`, sinon la première qui cite un ingrédient que la version retire : « ✂️ Mettez de
 *   côté la part d’Adulte B maintenant, avec une cuillère propre. », case { cle: 'part:<profilId>', libelle } ;
 * - enfant : sur la première étape qui cite un produit en cause : « 🧸 Pour Enfant : <conseil> », sinon la gravité.
 */
export function rappelsDuDeroule({ sequence = [], prechauffages = [], parts = [], precautions = [], role = null, moi = null } = {}) {
  const rappels = new Map(listeDe(sequence).map((e) => [e.cle, []]));
  const ajouter = (cle, rappel) => rappels.get(cle)?.push(rappel);
  const vus = new Set();
  for (const prechauffage of listeDe(prechauffages)) {
    const servie = listeDe(sequence).find((e) => e.cle === prechauffage.pour);
    const nom = NOMS_APPAREIL[prechauffage.appareil] ?? 'l’appareil';
    // « Allumez » la première fois, « Réglez » un appareil encore chaud, « Rallumez » un appareil éteint depuis
    // (deroule.js › ordreDUnPlat, `etat`) ; sans `etat` : « Réglez » au second préchauffage du même appareil.
    const verbe = { allume: 'Allumez', regle: 'Réglez', rallume: 'Rallumez' }[prechauffage.etat]
      ?? (vus.has(prechauffage.appareil) ? 'Réglez' : 'Allumez');
    vus.add(prechauffage.appareil);
    const temperature = estNombre(prechauffage.tempC) ? ` à ${prechauffage.tempC}\u00A0°C` : '';
    const titreServi = servie?.titre ?? prechauffage.titre;
    const usage = titreServi ? `\u00A0: il servira à ${guillemets(titreServi)}` : '';
    ajouter(prechauffage.avant, {
      genre: 'four', appareil: prechauffage.appareil,
      // Un plat occupe encore l'appareil quand on arrive sur cet écran : pas « maintenant ».
      texte: prechauffage.quandLibre
        ? `🔥 Dès que ${nom} est libre, ${verbe.toLowerCase()}-le${temperature}${usage}.`
        : `🔥 ${verbe} ${nom}${temperature} maintenant${usage}.`,
    });
  }
  for (const part of listeDe(parts)) {
    const cle = part.etape ?? null;
    if (!cle) continue;
    const moiMeme = estMoi(part.profil, moi);
    ajouter(cle, {
      genre: 'part', profilId: part.profil.id,
      texte: `✂️ Mettez de côté ${laPart(part.profil, moi)} maintenant, avec une cuillère propre.`,
      consigne: [part.consigne ? `${sansPoint(part.consigne)}.` : '', part.conseil ?? ''].filter(Boolean).join(' '),
      ajouts: listeDe(part.ajouts),
      case: { cle: `part:${part.profil.id}`, libelle: moiMeme ? 'Votre part mise de côté' : `Part ${deNom(nomDe(part.profil))} mise de côté` },
    });
  }
  for (const { profil, precautions: liste } of listeDe(precautions)) {
    for (const precaution of listeDe(liste)) {
      const cles = new Set(listeDe(precaution.produits).map(cleProduit));
      const etape = listeDe(sequence).find((e) => listeDe(e.citations).some((c) => cles.has(c.cle)));
      if (!etape) continue;
      const consigne = texte(precaution.consigne);
      const symbole = role === 'gestionnaire' ? (precaution.severite === 'exclu' ? '❌' : '!') : null;
      const produits = listeDe(precaution.produits).filter(Boolean);
      const corps = consigne
        || `${texteSeverite(precaution.severite, precaution.jusquAMois)}\u00A0: ${precaution.court ?? ''}${produits.length ? ` (${produits.join(', ')})` : ''}.`;
      ajouter(etape.cle, {
        genre: 'enfant', profilId: profil.id, symbole, corps,
        texte: `🧸 Pour ${nomDe(profil)}\u00A0: ${symbole ? `${symbole} ` : ''}${corps}`,
      });
    }
  }
  const rang = { four: 0, part: 1, enfant: 2 };
  for (const liste of rappels.values()) liste.sort((a, b) => rang[a.genre] - rang[b.genre]);
  return rappels;
}

/** Rappels d'une étape (clé) d'un déroulé : rappelsDuDeroule(contexte).get(cle), [] sinon. */
export function rappelsDeLEtape(contexte, cle) {
  return rappelsDuDeroule(contexte).get(cle) ?? [];
}

// ——— Fin de cuisson ———

/** Jours au frigo d'une fiche : entier de 1 à 30, sinon null. */
const frigoJoursDuPlat = (plat) => {
  const jours = plat?.conservation?.frigoJours;
  return Number.isInteger(jours) && jours >= 1 && jours <= 30 ? jours : null;
};

/**
 * Fin de cuisson (cuit le `jour`, 'AAAA-MM-JJ') → { jour, jours, auFrigo, aCongeler, auPlusTard, partFragile: null |
 * { profil, style, jours, auPlusTard }, congelerSiApres: null | date, aFinirAvant: null | date }.
 * `auPlusTard` = jour + jours au frigo (compris) : jours de l'élément de la semaine (conservation), sinon de la fiche,
 * sinon `reglages.frigoJoursDefaut`, sinon 3 ; la même date que le rappel « À congeler » (T4). `auFrigo` : portions à
 * cuisiner de la semaine (sans élément : `portions`, sinon portionsBase) ; `aCongeler` : portions à congeler ;
 * `partFragile` : la version qui se garde moins longtemps (semaine.js › conservation.limite ; sans élément, celle des
 * `versions` mises de côté) ; `congelerSiApres` :
 * `auPlusTard` si la semaine (`finSemaine`) finit après, pour un plat qui se congèle ; `aFinirAvant` : la même date pour
 * un plat qui ne se congèle pas (`conservation.congelable: false`), jamais conseillé au congélateur.
 */
export function finDeCuisson(plat, element, jour, { finSemaine = null, reglages = null, portions = null, versions = null } = {}) {
  const semaine = semaineUtile(element);
  const duFoyer = Number.isInteger(reglages?.frigoJoursDefaut) && reglages.frigoJoursDefaut >= 1 && reglages.frigoJoursDefaut <= 30
    ? reglages.frigoJoursDefaut : FRIGO_JOURS_DEFAUT;
  const jours = (semaine && Number.isInteger(element.conservation?.jours) ? element.conservation.jours : null)
    ?? frigoJoursDuPlat(plat) ?? duFoyer;
  const auPlusTard = jourValide(jour) ? ajouterJours(jour, jours) : null;
  const apres = auPlusTard && jourValide(finSemaine) && finSemaine > auPlusTard ? auPlusTard : null;
  const congelable = plat?.conservation?.congelable !== false;
  // Sans élément de la semaine (« la recette », ou hors semaine) : la version mise de côté qui se garde le moins (`versions`
  // de pasAPas : [{ profil, style, nomme, frigoJours | variante }]), comme semaine.js › conservation.limite.
  let limite = semaine ? element.conservation?.limite ?? null : null;
  if (!semaine) {
    for (const version of listeDe(versions).filter(estObjet)) {
      const ecrits = version.frigoJours ?? version.variante?.frigoJours;
      const joursVersion = Number.isInteger(ecrits) && ecrits >= 1 && ecrits <= 30 ? ecrits : null;
      if (joursVersion !== null && joursVersion < jours && (!limite || joursVersion < limite.jours)) {
        limite = { profil: version.profil, style: version.nomme ? version.style ?? null : null, jours: joursVersion };
      }
    }
  }
  const partFragile = limite && jourValide(jour)
    ? { profil: limite.profil, style: limite.style ?? null, jours: limite.jours, auPlusTard: ajouterJours(jour, limite.jours) } : null;
  return {
    jour: jourValide(jour) ? jour : null,
    jours,
    auFrigo: semaine ? element.aCuire : (estNombre(portions) && portions > 0 ? portions : portionsBaseDe(plat)),
    aCongeler: semaine ? element.aCongeler : 0,
    auPlusTard,
    partFragile,
    // Un plat qui ne se congèle pas (`conservation.congelable: false`) n'est jamais à congeler : la phrase dit alors de
    // le finir à temps (`aFinirAvant`). Absent : le plat est tenu pour congelable, comme avant.
    congelerSiApres: congelable ? apres : null,
    aFinirAvant: congelable ? null : apres,
  };
}

/** « au plus tard le mercredi 21 octobre » ('' si la date est illisible). */
export function texteDateLimite(jour) {
  return jourValide(jour) ? `au plus tard le ${texteJour(jour, { jourSemaine: true })}` : '';
}

/** « 14 h 30 », « 14 h 05 », « 14 h » d'une Date (heure locale du téléphone). */
export function texteHeure(date) {
  if (!(date instanceof Date) || Number.isNaN(date.getTime())) return '';
  const minutes = date.getMinutes();
  return minutes ? `${date.getHours()}\u00A0h\u00A0${String(minutes).padStart(2, '0')}` : `${date.getHours()}\u00A0h`;
}

/** « 🧊 Au frigo avant 14 h 30 » : deux heures (AU_FRIGO_AVANT_MIN) après `finCuisson` (Date). */
export function texteFrigoAvant(finCuisson) {
  if (!(finCuisson instanceof Date) || Number.isNaN(finCuisson.getTime())) return '';
  return TEXTES_CUISINE.frigoAvant(texteHeure(new Date(finCuisson.getTime() + AU_FRIGO_AVANT_MIN * 60_000)));
}

/**
 * Phrases de l'écran de fin (plan §8.5) → { titre, portions, partFragile, congeler, conseils: [texte] } :
 * « 6 portions : 4 au frigo, au plus tard le mercredi 21 octobre ; 2 au congélateur. » ; « 4 portions au frigo, au
 * plus tard le … » ; « 🐟 La part d’Adulte B : au plus tard le lundi 20 octobre. » ; « Si vous en mangez après le
 * mercredi 21 : congelez ces portions aujourd’hui, sortez-les au frigo la veille. » (plat qui ne se congèle pas :
 * « Ce plat ne se congèle pas : prévoyez de le finir au plus tard le mercredi 21. ») ; conseils 4 et 5, puis 6 (congeler
 * utile) et 7 (une portion va au congélateur).
 */
export function phrasesDeFin(fin, { moi = null } = {}) {
  const limite = texteDateLimite(fin?.auPlusTard);
  let portions = null;
  if (limite && estNombre(fin.auFrigo) && fin.auFrigo > 0) {
    portions = fin.aCongeler > 0
      ? `${portionsEnMots(propre(fin.auFrigo + fin.aCongeler))}\u00A0: ${nombreFr.format(fin.auFrigo)} au frigo, ${limite}\u00A0; ${nombreFr.format(fin.aCongeler)} au congélateur.`
      : `${portionsEnMots(fin.auFrigo)} au frigo, ${limite}.`;
  } else if (fin?.aCongeler > 0) {
    portions = `${portionsEnMots(fin.aCongeler)} au congélateur.`;
  }
  if (portions && fin?.depuisLaVeille) portions = `${portions} ${TEXTES_CUISINE.depuisLaVeille}`;
  let partFragile = null;
  if (fin?.partFragile && jourValide(fin.partFragile.auPlusTard)) {
    const emoji = STYLES.includes(fin.partFragile.style) ? `${EMOJIS_STYLE[fin.partFragile.style]} ` : '';
    partFragile = `${emoji}${majuscule(laPart(fin.partFragile.profil, moi))}\u00A0: ${texteDateLimite(fin.partFragile.auPlusTard)}.`;
  }
  let congeler = null;
  if (fin?.congelerSiApres) {
    congeler = `Si vous en mangez après le ${texteJour(fin.congelerSiApres, { jourSemaine: true, mois: false })}\u00A0: congelez ces portions aujourd’hui, sortez-les au frigo la veille.`;
  } else if (fin?.aFinirAvant) {
    congeler = `Ce plat ne se congèle pas\u00A0: prévoyez de le finir au plus tard le ${texteJour(fin.aFinirAvant, { jourSemaine: true, mois: false })}.`;
  }
  const conseils = [CONSEILS.boites.texte, CONSEILS.etiquette.texte];
  if (fin?.congelerSiApres) conseils.push(CONSEILS.congeler.texte);
  if (fin?.aCongeler > 0 || fin?.congelerSiApres) conseils.push(CONSEILS.decongeler.texte);
  return { titre: TEXTES_CUISINE.fin, portions, partFragile, congeler, conseils };
}

// ——— Semaine ———

/** 'AAAA-MM-JJ' d'une Date (heure locale) ou le texte tel quel. */
function jourDe(valeur) {
  if (typeof valeur === 'string') return valeur;
  const date = valeur instanceof Date ? valeur : new Date();
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
}

/**
 * Élément de la semaine pour cuisiner ce plat : celui de la semaine montrée (semaine.js › semaineAPreparer) si le plat
 * y est (pas retiré), sinon de la semaine en cours (semaineEnCours), sinon null. → l'élément de platsDeLaSemaine, avec
 * `semaine: { id, debut, fin }`.
 */
export function elementPourCuisiner(platId, { semaines = [], aujourdhui = new Date(), tousLesPlats = [], profils = [], evaluer = undefined, reglages = null } = {}) {
  const jour = jourDe(aujourdhui);
  const montree = semaineAPreparer(semaines, jour);
  const candidates = [montree, semaineEnCours(semaines, jour)].filter(Boolean);
  for (const semaine of candidates) {
    if (!estDansLaSemaine(semaine.plats?.[platId])) continue;
    const options = { tousLesPlats, profils, reglages, ...(typeof evaluer === 'function' ? { evaluer } : {}) };
    const element = platsDeLaSemaine(semaine, options).find((e) => e.platId === platId);
    if (element) return { ...element, semaine: { id: semaine.id, debut: semaine.debut, fin: semaine.fin } };
  }
  return null;
}

/** Vrai si le plat peut se cuisiner pas à pas : présent, hors corbeille, avec sa recette et au moins une étape. */
export function peutCuisiner(plat) {
  if (!estObjet(plat) || estDansCorbeille(plat) || statutDe(plat) === 'attente' || !aSaRecette(plat)) return false;
  return etapesLisibles(plat).etapes.length > 0;
}

/**
 * Bouton « 👩‍🍳 Cuisiner pas à pas » de la fiche et de la feuille du plat de la semaine → { visible, principal, libelle,
 * lien } : visible si peutCuisiner ; principal si le plat est dans la semaine montrée ou en cours (pas retiré).
 */
export function boutonCuisiner(plat, { semaines = [], aujourdhui = new Date() } = {}) {
  const visible = peutCuisiner(plat);
  let principal = false;
  if (visible) {
    const jour = jourDe(aujourdhui);
    principal = [semaineAPreparer(semaines, jour), semaineEnCours(semaines, jour)]
      .some((s) => s && estDansLaSemaine(s.plats?.[plat.id]));
  }
  return { visible, principal, libelle: TEXTES_CUISINE.bouton, lien: visible ? `#/cuisiner/${encodeURIComponent(plat.id)}` : null };
}

// ——— Reprise (téléphone) ———

/** Clé `localStorage` de la reprise : `repas-courses:cuisine:<uid>:<platId>`. */
export function cleReprise(uid, platId) {
  return `repas-courses:cuisine:${uid}:${platId}`;
}

/** Clé `localStorage` de la taille du texte (« A+ ») : `repas-courses:texte-cuisine:<uid>`. */
export function cleTexteCuisine(uid) {
  return `repas-courses:texte-cuisine:${uid}`;
}

/**
 * Valeur à garder : { etape (clé d'étape, ou 'avant' / 'fin'), titre? (celui de l'étape : sa clé est un numéro, qui
 * peut désigner une autre étape si l'autre téléphone en retire une), debut? (heure où l'on a commencé : l'élément de la
 * semaine est pris ce jour-là, même repris après minuit), portions ('semaine' | 'recette'), cases: [cle], le }.
 */
export function valeurReprise({ etape = 'avant', titre = null, portions = 'semaine', cases = [], debut = null, maintenant = Date.now() } = {}) {
  return {
    etape: typeof etape === 'string' ? etape : 'avant',
    ...(estNombre(debut) ? { debut } : {}),
    ...(typeof titre === 'string' && titre ? { titre } : {}),
    portions: portions === 'recette' ? 'recette' : 'semaine',
    cases: [...new Set(listeDe(cases).filter((c) => typeof c === 'string'))],
    le: maintenant,
  };
}

/**
 * Reprise lue (texte JSON ou objet) → { etape, portions, cases, le, debut? } ou null : illisible, plus vieille que
 * REPRISE_HEURES, ou d'une étape qui n'existe plus (`cles` : clés des étapes du déroulé, plus 'avant' et 'fin' ;
 * alors la reprise repart de « Avant de commencer » en gardant les cases). `etapes` ([{ cle, titre }] du déroulé) :
 * une étape gardée avec son titre est retrouvée par son titre si sa clé désigne désormais une autre étape, sinon
 * « Avant de commencer ».
 */
export function lireReprise(valeur, { maintenant = Date.now(), cles = null, etapes = null } = {}) {
  let lue = valeur;
  if (typeof valeur === 'string') {
    try {
      lue = JSON.parse(valeur);
    } catch {
      return null;
    }
  }
  if (!estObjet(lue) || !estNombre(lue.le) || maintenant - lue.le > REPRISE_HEURES * 3_600_000 || lue.le > maintenant + 60_000) return null;
  const connues = Array.isArray(cles) ? new Set([...cles, 'avant', 'fin']) : null;
  let etape = typeof lue.etape === 'string' && (!connues || connues.has(lue.etape)) ? lue.etape : 'avant';
  if (Array.isArray(etapes) && typeof lue.titre === 'string' && etape !== 'avant' && etape !== 'fin') {
    const liste = etapes.filter(estObjet);
    const meme = liste.find((e) => e.cle === etape && e.titre === lue.titre) ?? liste.find((e) => e.titre === lue.titre);
    etape = meme?.cle ?? 'avant';
  }
  return {
    etape, portions: lue.portions === 'recette' ? 'recette' : 'semaine',
    cases: [...new Set(listeDe(lue.cases).filter((c) => typeof c === 'string'))], le: lue.le,
    ...(estNombre(lue.debut) && lue.debut <= lue.le ? { debut: lue.debut } : {}),
  };
}

// ——— Le pas à pas ———

const nomDUstensile = (nom) => majuscule(texte(nom));

/** Étape affichée (étape de la recette ou fin implicite) avec ses quantités, ce qui sert aussi « Avant de commencer ». */
function etapeAffichee(etape, { quantites, facteurAussi }) {
  return {
    titre: etape.titre,
    texte: etape.texte ?? '',
    pret: etape.pret ?? null,
    duree: etape.duree ?? null,
    actif: etape.actif ?? null,
    ligneDuree: ligneDuree(etape),
    ligneAppareil: ligneAppareil(etape),
    quantites: quantitesDeLEtape(etape, quantites).map(({ produit, texte: t }) => ({ produit, texte: t })),
    aussi: aussiDeLEtape(etape, facteurAussi).map((a) => a.texte),
    ustensiles: listeDe(etape.ustensiles).map(nomDUstensile),
    citations: citations(etape),
  };
}

/**
 * Versions servies hors semaine (plat cuisiné depuis sa fiche) → [{ profil, variante, style, nomme }] : pour chaque
 * profil qui a une version servie (versionServie) et n'a pas dit « Jamais » (ni écarté autrement : mangeParDefaut).
 */
function versionsHorsSemaine(plat, profils, evaluer) {
  const sortie = [];
  for (const profil of listeDe(profils).filter(estObjet)) {
    if (!mangeParDefaut(plat, profil, { evaluer }).mange) continue;
    const servie = versionServie(plat, profil, null, evaluer);
    if (servie?.variante) {
      sortie.push({ profil, variante: servie.variante, style: servie.style ?? null, nomme: servie.nomme, frigoJours: servie.frigoJours ?? null });
    }
  }
  return sortie;
}

/** « Environ 1 h 05, dont 21 min de travail » ; « Environ 1 h 05 » ; null. */
function texteEnviron(total, travail) {
  if (!estNombre(total) || total <= 0) return null;
  return estNombre(travail) && travail > 0 && travail < total
    ? `Environ ${texteDuree(total)}, dont ${texteDuree(travail)} de travail`
    : `Environ ${texteDuree(total)}`;
}

/**
 * Modèle complet de l'écran « Cuisiner pas à pas » (#/cuisiner/<id>) → objet décrit plus bas ; rien n'est écrit.
 * Options : `element` (elementPourCuisiner, ou null hors semaine), `profils`, `moi` (profil de la personne), `role`
 * ('gestionnaire' : ❌ et ! des précautions), `portions` ('semaine' d'avance, ou 'recette'), `reglages` (appareils,
 * jours au frigo), `evaluer`, `aujourdhui` (jour de cuisson, Date ou 'AAAA-MM-JJ').
 * → { etat: 'ok' | 'introuvable' | 'corbeille' | 'sansRecette' | 'sansEtapes', nom, titrePage, detaillee, estime,
 *     portions: { choisies, semaine, recette, bascule, legende, options: [{ valeur, libelle }] },
 *     duree: { totale, travail, texte },
 *     avant: { hygiene: [texte], enfant: [ligne 🧸], parts: [texte], veille: [étape], reunir: { ingredients: [{ cle,
 *       texte }], aussi: texte|null, ustensiles: [{ cle, nom }] } },
 *     etapes: [{ cle, n, rang, implicite, titre, texte, pret, duree, actif, ligneDuree, ligneAppareil, quantites: [{
 *       produit, texte }], aussi: [texte], ustensiles: [nom], rappels: [rappel], conseils: [texte], pendant, debut, fin }],
 *     total, service: [étape « le jour du repas »], fin: { titre, portions, partFragile, congeler, conseils, details } }
 */
export function pasAPas(plat, {
  element = null, profils = [], moi = null, role = null, portions: choix = 'semaine', reglages = null, evaluer = undefined,
  aujourdhui = new Date(),
} = {}) {
  const nom = texte(plat?.nom);
  const sortie = { etat: 'ok', nom, titrePage: TEXTES_CUISINE.titrePage(nom) };
  if (!estObjet(plat)) return { ...sortie, etat: 'introuvable' };
  if (estDansCorbeille(plat)) return { ...sortie, etat: 'corbeille' };
  if (statutDe(plat) === 'attente' || !aSaRecette(plat)) return { ...sortie, etat: 'sansRecette' };
  const lecture = etapesLisibles(plat);
  if (!lecture.etapes.length) return { ...sortie, etat: 'sansEtapes' };

  // Portions : celles de la semaine d'avance, « la recette » d'un toucher.
  const semaine = semaineUtile(element);
  const base = portionsBaseDe(plat);
  const totalSemaine = semaine ? propre(element.aCuire + element.aCongeler) : null;
  const bascule = semaine && base !== null && Math.abs(totalSemaine - base) > TOLERANCE;
  const choisies = semaine && choix === 'recette' ? 'recette' : (semaine ? 'semaine' : 'recette');
  const quantites = quantitesACuisiner(plat, choisies === 'semaine' ? element : null, profils);
  const facteurAussi = quantites.facteur;

  // Ordre de l'ordonnanceur (fins implicites comprises). Recette pas détaillée (repli) : les phrases dans leur ordre,
  // les cuissons de la fiche en puces dans « Avant de commencer » (jamais en étapes après les phrases, qui les
  // décrivent déjà), puis « Sortir du four » après la dernière phrase si la dernière cuisson en demande une.
  const avecPhrases = lecture.etapes.some((e) => !e.estime);
  const cuissonsRepli = lecture.detaillee || !avecPhrases ? [] : lecture.etapes.filter((e) => e.estime && e.appareil);
  const cuissons = cuissonsRepli.map((e) => e.titre);
  const etapesDuJour = lecture.detaillee ? lecture.etapes : lecture.etapes.filter((e) => !cuissonsRepli.includes(e));
  const deroule = ordreDUnPlat(etapesDuJour, capacites(reglages));
  const aSortir = [...cuissonsRepli].reverse().find((e) => APPAREILS_A_SORTIR.includes(e.appareil));
  const derniere = etapesDuJour.at(-1);
  if (!lecture.detaillee && aSortir && derniere && !deroule.ordre.some((o) => o.implicite)) {
    deroule.ordre.push({ cle: `${derniere.n}-fin`, n: derniere.n, implicite: aSortir.appareil, pour: String(derniere.n), debut: null, finActif: null, fin: null });
  }
  const parN = new Map(lecture.etapes.map((e) => [e.n, e]));
  const coeur = etapesDuCoeur(lecture.etapes, plat);
  const sequence = deroule.ordre.map((o, i) => {
    const source = parN.get(o.n);
    const fin = o.implicite ? FINS_IMPLICITES[o.implicite] : null;
    const affichee = fin
      ? { ...etapeAffichee({ titre: fin.titre, texte: fin.texte, pret: source?.pret ?? null, duree: 1, actif: 1 }, { quantites, facteurAussi }), ligneAppareil: '' }
      : etapeAffichee(source, { quantites, facteurAussi });
    return {
      cle: o.cle, n: o.implicite ? null : o.n, rang: i + 1, implicite: o.implicite ?? null, ...affichee,
      conseils: !o.implicite && coeur.has(o.n) ? [CONSEILS.coeur.texte] : [],
      debut: o.debut, fin: o.fin,
    };
  });
  sequence.forEach((etape, i) => {
    const suivante = sequence[i + 1];
    etape.pendant = Boolean(!deroule.estime && suivante && estNombre(etape.duree) && estNombre(etape.actif)
      && etape.duree > etape.actif && estNombre(suivante.debut) && suivante.debut < etape.fin);
  });

  // Préchauffage : celui de l'ordonnanceur ; sans durées (repli), sur la première étape.
  let prechauffages = deroule.prechauffages;
  const deLaVeilleRepli = etapesDeLaVeille(lecture.etapes);
  if (deroule.estime) {
    const chaude = lecture.etapes.find((e) => !e.auService && !deLaVeilleRepli.has(e.n) && (e.appareil === 'four' || e.appareil === 'airfryer'));
    prechauffages = chaude && sequence.length
      ? [{ appareil: chaude.appareil, tempC: chaude.tempC ?? (chaude.appareil === 'four' ? 180 : null), pour: String(chaude.n), avant: sequence[0].cle, titre: chaude.titre }]
      : [];
  }

  // « La veille » : les étapes `veille` et celles dont elles dépendent, dans l'ordre de la recette ; une attente au four,
  // au Cookeo ou à l'airfryer qu'aucune étape de la veille n'attend reçoit sa fin implicite (« Sortir du four ») et le
  // conseil de la mettre au frigo pour la nuit.
  const deLaVeille = etapesDeLaVeille(lecture.etapes);
  const veilleLues = lecture.etapes.filter((e) => deLaVeille.has(e.n));
  const attenduesVeille = new Set();
  for (const e of veilleLues) for (const k of (Array.isArray(e.apres) ? e.apres : (e.n > 1 ? [e.n - 1] : []))) attenduesVeille.add(k);
  const veille = [];
  for (const e of veilleLues) {
    veille.push({
      cle: String(e.n), n: e.n, implicite: null, ...etapeAffichee(e, { quantites, facteurAussi }),
      conseils: coeur.has(e.n) ? [CONSEILS.coeur.texte] : [],
    });
    const attente = estNombre(e.duree) && e.duree > (estNombre(e.actif) ? e.actif : e.duree);
    if (APPAREILS_A_SORTIR.includes(e.appareil) && attente && !attenduesVeille.has(e.n)) {
      const finVeille = FINS_IMPLICITES[e.appareil];
      veille.push({
        cle: `${e.n}-fin`, n: null, implicite: e.appareil,
        ...etapeAffichee({ titre: finVeille.titre, texte: finVeille.texte, pret: e.pret ?? null, duree: 1, actif: 1 }, { quantites, facteurAussi }),
        ligneAppareil: '', conseils: [TEXTES_CUISINE.frigoVeille],
      });
    }
  }

  // Parts mises de côté : étape `partAvant`, sinon la première qui cite un ingrédient retiré, dans les étapes de la veille
  // puis dans celles du jour. Hors semaine, la version que chaque profil aurait (versionServie), sauf pour qui a dit
  // « Jamais » : sa part n'a pas de quantité.
  const versions = semaine
    ? listeDe(element.versions).filter((v) => estObjet(v?.variante) && estObjet(v?.profil))
    : versionsHorsSemaine(plat, profils, evaluer);
  const toutes = [...veille, ...sequence];
  const avecPart = toutes.find((e) => e.n !== null && parN.get(e.n)?.partAvant);
  const ajoutsDe = new Map(quantites.parts.map((p) => [p.profilId, p.ajouts.map((a) => a.texte)]));
  const parts = versions.map((version) => {
    const retires = new Set(listeDe(version.variante.retirer).map(cleProduit));
    const etape = avecPart ?? toutes.find((e) => e.n !== null && e.citations.some((c) => retires.has(c.cle))) ?? null;
    const laVeille = Boolean(etape) && deLaVeille.has(etape.n);
    // Une version qui ajoute une volaille, du porc ou de la viande hachée : le conseil de cuisson à cœur va avec sa part.
    const coeurDeLaPart = hygieneDuPlat({ ingredients: [] }, listeDe(version.variante.ajouter)).includes('coeur');
    return {
      profil: version.profil, consigne: texte(version.variante.consigne), etape: etape?.cle ?? null,
      rang: laVeille ? null : etape?.rang ?? null, veille: laVeille ? etape.titre : null,
      conseil: coeurDeLaPart ? CONSEILS.coeur.texte : null,
      ajouts: ajoutsDe.get(version.profil.id) ?? listeDe(version.variante.ajouter).filter(estObjet).map((a) => majuscule(texte(a.produit))),
    };
  });
  const precautions = precautionsDuPlat(plat, { element, profils, evaluer });
  const rappels = rappelsDuDeroule({ sequence: toutes, prechauffages, parts, precautions, role, moi });
  for (const etape of toutes) etape.rappels = rappels.get(etape.cle) ?? [];

  // Avant de commencer.
  const hygiene = hygieneDuPlat(plat, versions.flatMap((v) => listeDe(v.variante.ajouter)));
  const lignesParts = parts.map((part) => {
    const qui = majuscule(laPart(part.profil, moi));
    const consigne = part.consigne ? `\u00A0: ${sansPoint(part.consigne)}` : '';
    const conseil = part.conseil ? ` ${part.conseil}` : '';
    if (part.veille) return `✂️ ${qui} se met de côté la veille, avant ${guillemets(part.veille)}${consigne}.${conseil}`;
    return part.rang !== null
      ? `✂️ ${qui} se met de côté avant l’étape ${part.rang}${consigne}.${conseil}`
      : `✂️ ${qui} se prépare à part${consigne}.${conseil}`;
  });
  const service = lecture.etapes.filter((e) => e.auService).map((e) => ({ cle: String(e.n), n: e.n, ...etapeAffichee(e, { quantites, facteurAussi }) }));
  const reunir = { ingredients: [], aussi: null, ustensiles: [] };
  // Ce que seules les étapes de la veille utilisent (déjà fait, avec ses quantités dans « La veille ») ne se sort pas.
  const citesLeJour = new Set(lecture.etapes.filter((e) => !deLaVeille.has(e.n)).flatMap((e) => citations(e).map((c) => c.cle)));
  const citesLaVeille = new Set(veilleLues.flatMap((e) => citations(e).map((c) => c.cle)));
  const parProduit = new Map();
  for (const ligne of quantites.lignes) {
    if (ligne.personne || !ligne.produit) continue;
    const cle = cleProduit(ligne.produit);
    if (citesLaVeille.has(cle) && !citesLeJour.has(cle)) continue;
    const deja = parProduit.get(cle);
    if (!deja) {
      parProduit.set(cle, { cle: `ing:${cle}`, produit: ligne.produit, mesures: new Map() });
    }
    if (estNombre(ligne.qteExacte) && ligne.qteExacte > 0) {
      const entree = parProduit.get(cle);
      const unite = ligne.unite ?? 'pc';
      const mesure = entree.mesures.get(unite) ?? { qte: 0, arrondie: false, ingredient: ligne.ingredient };
      mesure.qte += ligne.qteExacte;
      mesure.arrondie = mesure.arrondie || ligne.arrondie;
      entree.mesures.set(unite, mesure);
    }
  }
  for (const { cle, produit, mesures } of parProduit.values()) {
    const textes = [...mesures].map(([unite, m]) => texteQuantiteCuisine(m.arrondie ? arrondiCuisine(m.qte, unite, m.ingredient) : propre(m.qte), unite)).filter(Boolean);
    reunir.ingredients.push({ cle, texte: textes.length ? `${majuscule(produit)} · ${textes.join(' + ')}` : majuscule(produit) });
  }
  for (const part of parts) {
    const qui = estMoi(part.profil, moi) ? 'votre part' : `part ${deNom(nomDe(part.profil))}`;
    part.ajouts.forEach((ajout, i) => reunir.ingredients.push({ cle: `part:${part.profil.id}:${i}`, texte: `${ajout} (${qui})` }));
  }
  const aussi = [];
  const ustensiles = new Map();
  for (const etape of lecture.etapes.filter((e) => !e.auService && !deLaVeille.has(e.n))) {
    for (const chose of listeDe(etape.aussi)) {
      const produit = texte(typeof chose === 'string' ? chose : chose?.produit);
      if (produit && !aussi.some((a) => slug(a) === slug(produit))) aussi.push(produit);
    }
    for (const ustensile of listeDe(etape.ustensiles)) {
      const cle = slug(ustensile);
      if (cle && !ustensiles.has(cle)) ustensiles.set(cle, { cle: `ust:${cle}`, nom: nomDUstensile(ustensile) });
    }
  }
  reunir.aussi = aussi.length ? TEXTES_CUISINE.etAussi(aussi.join(', ')) : null;
  reunir.ustensiles = [...ustensiles.values()];

  // Durée : celle de l'ordonnanceur ; sans durées, travail de la fiche + cuissons.
  let totale = deroule.finMin;
  let travail = deroule.travailMin;
  if (deroule.estime) {
    const cuissons = listeDe(plat.cuisson).filter((c) => estObjet(c) && estNombre(c.dureeMin) && c.dureeMin > 0)
      .reduce((somme, c) => somme + c.dureeMin, 0);
    travail = estNombre(plat.tempsActifMin) && plat.tempsActifMin > 0 ? plat.tempsActifMin : null;
    totale = (travail ?? 0) + cuissons || null;
  }

  // Fin.
  // Une cuisson (étape avec un appareil) faite la veille : la date limite se compte depuis la veille.
  const cuitLaVeille = veilleLues.some((e) => e.appareil);
  const jour = cuitLaVeille ? ajouterJours(jourDe(aujourdhui), -1) ?? jourDe(aujourdhui) : jourDe(aujourdhui);
  const fin = {
    ...finDeCuisson(plat, choisies === 'semaine' ? element : null, jour, {
      finSemaine: semaine ? element.semaine?.fin ?? null : null, reglages, portions: choisies === 'recette' ? base : null,
      versions,
    }),
    ...(cuitLaVeille ? { depuisLaVeille: true } : {}),
  };

  return {
    ...sortie,
    detaillee: lecture.detaillee,
    estime: deroule.estime,
    portions: {
      choisies,
      semaine: totalSemaine,
      recette: base,
      bascule,
      legende: TEXTES_CUISINE.quantitesPour,
      options: bascule ? [
        { valeur: 'semaine', libelle: TEXTES_CUISINE.optionSemaine(totalSemaine) },
        { valeur: 'recette', libelle: TEXTES_CUISINE.optionRecette(base) },
      ] : [],
    },
    duree: { totale, travail, texte: texteEnviron(totale, travail) },
    avant: {
      hygiene: [
        TEXTES_CUISINE.mains,
        ...(hygiene.includes('planche') ? [CONSEILS.planche.texte] : []),
        ...(hygiene.includes('oeufs') ? [TEXTES_CUISINE.oeufs] : []),
      ],
      cuissons,
      enfant: lignesEnfant(precautions, { role }),
      parts: lignesParts,
      veille: veille.map(({ citations: _c, ...etape }) => etape),
      reunir,
    },
    etapes: sequence.map(({ citations: _c, ...etape }) => etape),
    total: sequence.length,
    service: service.map(({ citations: _c, ...etape }) => etape),
    fin: { ...phrasesDeFin(fin, { moi }), details: fin },
  };
}
