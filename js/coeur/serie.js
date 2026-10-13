// « Coller la suite » (T5-0a) : l'écran « Ajouter des recettes » reste ouvert après un message d'idées de Claude
// (DEMANDE-IDEES) ou d'étapes détaillées (DEMANDE-ETAPES, T5-0b), plusieurs messages de suite. Logique pure :
// n'importe rien, aucun état sur le téléphone ; le compte « depuis l'ouverture de cet écran » et les recettes refusées
// de la visite vivent dans la vue et se passent en entrée ; le reste à détailler se lit dans la base (partagé).

/** `source` d'une idée de Claude : la valeur de claude.js › SOURCE_IDEE (un test les tient égales). */
export const SOURCE_IDEE_SERIE = 'Idée de Claude';

/** Réponses d'étapes collées dans une visite avant le conseil d'ouvrir une nouvelle conversation (T5-0b). */
export const CONSEIL_NOUVELLE_CONVERSATION = 5;

const estObjet = (valeur) => valeur !== null && typeof valeur === 'object' && !Array.isArray(valeur);
const texte = (valeur) => (typeof valeur === 'string' ? valeur.trim() : '');

/** Entrées d'un message : un tableau d'objets, ou `{ plats: [...] }` (validation de paquet.js : `donnees` de chacun). */
function entreesDe(resultat) {
  const liste = Array.isArray(resultat) ? resultat : Array.isArray(resultat?.plats) ? resultat.plats : [];
  return liste.map((entree) => (estObjet(entree?.donnees) ? entree.donnees : entree)).filter(estObjet);
}

/**
 * Nature d'un message collé : 'idees' (au moins une fiche complète de source « Idée de Claude »), 'etapes' (lot
 * d'étapes, T5-0b : une entrée porte `empreinte` et `realisation`, aucune `precautions`), sinon null (recette seule,
 * versions, relecture, sauvegarde : le chemin d'aujourd'hui).
 */
export function natureDuMessage(resultat) {
  // Validation ou préparation d'un lot d'étapes (paquet.js), même si aucune entrée n'a été reprise.
  if (resultat?.lotDEtapes === true) return 'etapes';
  const entrees = entreesDe(resultat);
  if (!entrees.length) return null;
  if (entrees.some((entree) => Array.isArray(entree.precautions))) return null;
  if (entrees.some((entree) => Object.hasOwn(entree, 'empreinte') && Object.hasOwn(entree, 'realisation'))) return 'etapes';
  const recue = (entree) => Array.isArray(entree.ingredients) && entree.ingredients.length > 0;
  if (entrees.some((entree) => recue(entree) && texte(entree.source) === SOURCE_IDEE_SERIE)) return 'idees';
  return null;
}

/** Statuts d'une fiche écrite qu'une idée de Claude peut donner (paquet.js : idée nouvelle, plat ⏳ complété). */
const STATUTS_IDEE = new Set(['nouveau', 'complete']);

/**
 * Ce qu'un enregistrement apporte, d'après la préparation enregistrée (paquet.js › preparerImport, filtrée des plats
 * décochés) :
 * - `ajoutes` : idées de Claude dont la recette est écrite ({ id, nom }, dans l'ordre de l'aperçu ; statut `nouveau`
 *   ou `complete` et `source` « Idée de Claude ») ;
 * - `autres` : autres fiches écrites du même message ({ id, nom, statut }, par exemple une recette du foyer remplacée
 *   par une fiche qui n'est pas une idée), annoncées à part, jamais comptées comme idées ;
 * - `nonRepris` : entrées ni écrites ni identiques (idée déjà dans les plats, plat de la corbeille), avec la raison de
 *   l'aperçu et `remettable` (plat de la corbeille qui, remis, prendrait la recette).
 */
export function bilanDuMessage(preparation) {
  if (preparation?.lotDEtapes === true) return bilanDesEtapes(preparation);
  const ecrites = new Map((Array.isArray(preparation?.ecritures) ? preparation.ecritures : [])
    .filter((ecriture) => estObjet(ecriture) && !ecriture.mode)
    .map((ecriture) => [ecriture.id, ecriture]));
  const elements = (Array.isArray(preparation?.elements) ? preparation.elements : []).filter(estObjet);
  const ajoutes = [];
  const autres = [];
  const vus = new Set();
  for (const element of elements) {
    if (!ecrites.has(element.id) || vus.has(element.id) || element.retenu === false) continue;
    vus.add(element.id);
    const nom = texte(element.nom) || element.id;
    const idee = texte(ecrites.get(element.id)?.donnees?.source) === SOURCE_IDEE_SERIE;
    if (idee && STATUTS_IDEE.has(element.statut)) ajoutes.push({ id: element.id, nom });
    else autres.push({ id: element.id, nom, statut: element.statut });
  }
  const nonRepris = elements
    .filter((element) => element.statut === 'deja' || element.statut === 'corbeille')
    .map((element) => {
      const avertissements = Array.isArray(element.avertissements) ? element.avertissements : [];
      return {
        id: element.id,
        nom: texte(element.nom) || element.id,
        raison: texte(avertissements.at(-1)),
        remettable: element.statut === 'corbeille' && element.remettable === true,
      };
    });
  return { ajoutes, autres, nonRepris };
}

/** Statuts d'un élément d'un lot d'étapes qui reste à détailler (paquet.js › preparerImport, branche étapes). */
const STATUTS_NON_REPRIS = new Set(['refusee', 'change', 'inconnu', 'attente', 'corbeille']);

/**
 * Bilan d'un lot d'étapes enregistré (T5-0b) : `ajoutes` (recettes dont les étapes sont écrites : { id, nom }),
 * `autres` ([]), `nonRepris` (recettes qui restent à détailler : { id, nom, raison, remettable: false, aCorriger }
 * (codes pour la ligne `à corriger:` de la demande redemandée)). « Identique » et « déjà détaillé » ne sont ni l'un
 * ni l'autre : rien à écrire, la recette est faite.
 */
function bilanDesEtapes(preparation) {
  const ecrites = new Set((Array.isArray(preparation?.ecritures) ? preparation.ecritures : [])
    .filter((ecriture) => estObjet(ecriture) && ecriture.mode === 'etapes')
    .map((ecriture) => ecriture.id));
  const elements = (Array.isArray(preparation?.elements) ? preparation.elements : []).filter(estObjet);
  const ajoutes = [];
  const nonRepris = [];
  const vus = new Set();
  for (const element of elements) {
    const nom = texte(element.nom) || String(element.id ?? '');
    if (element.statut === 'etapes' && ecrites.has(element.id) && element.retenu !== false && !vus.has(element.id)) {
      vus.add(element.id);
      ajoutes.push({ id: element.id, nom });
    } else if (STATUTS_NON_REPRIS.has(element.statut) && !(element.id != null && ecrites.has(element.id))) {
      // Une entrée rendue deux fois dont la première est écrite n'est pas « non reprise » : la recette est faite.
      nonRepris.push({
        id: element.id ?? null,
        nom,
        raison: texte(element.raison),
        remettable: false,
        aCorriger: Array.isArray(element.aCorriger) ? element.aCorriger.filter((c) => typeof c === 'string') : [],
      });
    }
  }
  return { ajoutes, autres: [], nonRepris };
}

/**
 * Message recollé : rien de nouveau et aucune demande à clore. Chaque entrée est déjà dans les plats (à l'identique,
 * ou idée non reprise), ou vise un plat de la corbeille qui n'en prendrait rien même remis (`remettable` faux) ; et
 * au moins une vise un plat écrit pendant la visite (`idsDeLaVisite`) : un message jamais collé, fait seulement de
 * plats que le foyer avait déjà, garde son aperçu (« Ces idées sont déjà dans vos plats. » et chaque raison). Un plat
 * de la corbeille remettable n'en est pas : l'aperçu propose de le remettre.
 */
export function dejaEnregistre(preparation, idsDeLaVisite = []) {
  const elements = (Array.isArray(preparation?.elements) ? preparation.elements : []).filter(estObjet);
  if (!elements.length) return false;
  if ((preparation?.ecritures ?? []).length || (preparation?.demandesAClore ?? []).length) return false;
  const visite = new Set(Array.isArray(idsDeLaVisite) ? idsDeLaVisite : []);
  const dejaLa = (element) => element.statut === 'deja' || element.statut === 'identique' || element.statut === 'dejaDetaille';
  const rienAPrendre = (element) => element.statut === 'corbeille' && element.remettable === false;
  return elements.every((element) => dejaLa(element) || rienAPrendre(element))
    && elements.some((element) => dejaLa(element) && visite.has(element.id));
}

/** Liste sans doublon d'identifiant, dans l'ordre. */
function uniques(plats) {
  const vus = new Set();
  const resultat = [];
  for (const plat of Array.isArray(plats) ? plats : []) {
    const id = estObjet(plat) ? plat.id : plat;
    if (id === undefined || id === null || vus.has(id)) continue;
    vus.add(id);
    resultat.push(estObjet(plat) ? { id, nom: texte(plat.nom) || String(id) } : { id, nom: String(id) });
  }
  return resultat;
}

/**
 * État de la carte de série.
 * - `nature` : 'idees' ou 'etapes' ;
 * - `ajoutesDepuisOuverture` : plats écrits depuis l'ouverture de l'écran ({ id, nom } ou identifiants) ;
 * - `dernier` : idées écrites par le dernier message ; `autres` : ses autres fiches écrites ({ nom, statut }) ;
 *   `nonRepris` : ses entrées non reprises ({ id, nom, raison, remettable }) ;
 * - `recolle` : le dernier collage n'apportait rien de nouveau ;
 * - `aDetailler` (étapes) : plats encore à détailler, lus dans la base (partagés entre appareils) ;
 * - `reponses` (étapes) : réponses collées dans la visite ;
 * - `refuses` (étapes) : recettes pas reprises pendant la visite et toujours à détailler ({ id, nom }), pour
 *   « Redemander ces 2 recettes » ; une recette détaillée depuis (absente de `aDetailler`, quand il est une liste)
 *   n'en est plus.
 * → idées : { nature, faits, total: null, dernier, autres, nonRepris, recolle } ;
 *   étapes : { nature, faits, restants, dernier, autres, nonRepris, recolle, conseil, refuses }.
 * Ne dépend que de ses entrées : une copie faite sur l'ordinateur et collée sur le téléphone donne le même écran.
 */
export function etatSerie({
  nature, ajoutesDepuisOuverture = [], dernier = [], autres = [], nonRepris = [], recolle = false, aDetailler = [],
  reponses = 0, refuses = [],
} = {}) {
  const commun = {
    nature,
    faits: uniques(ajoutesDepuisOuverture).length,
    dernier: uniques(dernier),
    autres: (Array.isArray(autres) ? autres : []).filter(estObjet)
      .map((entree) => ({ nom: texte(entree.nom), statut: texte(entree.statut) })),
    nonRepris: (Array.isArray(nonRepris) ? nonRepris : []).filter(estObjet)
      .map((entree) => ({
        id: entree.id ?? null, nom: texte(entree.nom), raison: texte(entree.raison), remettable: entree.remettable === true,
      })),
    recolle: Boolean(recolle),
  };
  if (nature === 'etapes') {
    const restants = Array.isArray(aDetailler) ? aDetailler.length : Math.max(0, Number(aDetailler) || 0);
    const encore = Array.isArray(aDetailler)
      ? new Set(aDetailler.map((plat) => (estObjet(plat) ? plat.id : plat)))
      : null;
    return {
      ...commun,
      restants,
      conseil: Number(reponses) >= CONSEIL_NOUVELLE_CONVERSATION && restants > 0,
      refuses: uniques(refuses).filter((plat) => !encore || encore.has(plat.id)),
    };
  }
  return { ...commun, total: null };
}

const nombre = (n, singulier, pluriel) => `${n}\u00A0${n > 1 ? pluriel : singulier}`;

export const TEXTES_SERIE = {
  aide: 'Écrivez «\u00A0suite\u00A0» à Claude, copiez toute sa réponse, puis touchez «\u00A0Coller la suite\u00A0».',
  recolle: 'Ce message est déjà enregistré.',
  recolleSuite: 'Écrivez «\u00A0suite\u00A0» à Claude pour le suivant.',
  collerLaSuite: '📋 Coller la suite',
  termine: 'Terminé',
  voirLesPlats: 'Voir les plats ›',
  zone: 'Collez la réponse ici',
  conseil: 'La conversation devient longue\u00A0: pour la suite, ouvrez une nouvelle conversation Claude.',
  fin: '✓ Toutes vos recettes sont détaillées 🎉',
  aucuneIdee: 'Aucune idée ajoutée.',
  remettre: 'Remettre',
  // Étapes détaillées (T5-0b).
  aucuneRecette: 'Aucune recette détaillée.',
  recopier: (n) => (n > 1 ? `📋 Recopier la demande pour les ${n}\u00A0restantes` : '📋 Recopier la demande pour la dernière'),
  redemander: (n) => (n > 1 ? `📋 Redemander ces ${n}\u00A0recettes` : '📋 Redemander cette recette'),
};

/**
 * Phrases de la carte (CLAUDE.md §8 « Ajouter des recettes » en série) :
 * → { titre, noms, autres, nonRepris, depuis, restants, aide, conseil }, chaque phrase null quand elle ne se montre
 *   pas ; `nonRepris[i]` répond à `etat.nonRepris[i]` (la vue y met « Remettre »).
 * - autres fiches écrites du message : « « Chili doux » : recette remplacée. », « « Soupe » : recette enregistrée. » ;
 * - idées : « ✓ 3 idées ajoutées », « 6 depuis l’ouverture de cet écran. » (seulement au-delà du dernier message ;
 *   jamais pour les étapes) ;
 * - message recollé : « Ce message est déjà enregistré. » et « Écrivez « suite » à Claude pour le suivant. » à la
 *   place de l'aide ;
 * - étapes (T5-0b) : « ✓ 3 recettes détaillées », « Encore 38 recettes à détailler. », fin « ✓ Toutes vos recettes
 *   sont détaillées 🎉 », « « Gratin » n’a pas été repris : il restera à détailler. » ; après
 *   CONSEIL_NOUVELLE_CONVERSATION réponses, le conseil et « 📋 Recopier la demande pour les 38 restantes »
 *   (`recopier`) ; recettes refusées dans la visite : « 2 recettes n’ont pas été reprises : « Gratin », « Velouté ». »
 *   (`refuses`) et « 📋 Redemander ces 2 recettes » (`redemander`).
 * → étapes : en plus { recopier, refuses, redemander } (null quand ils ne se montrent pas).
 */
export function texteSerie(etat) {
  const { nature, faits = 0, dernier = [], autres = [], nonRepris = [], recolle = false } = etat ?? {};
  const etapes = nature === 'etapes';
  const n = dernier.length;
  let titre;
  if (recolle) titre = TEXTES_SERIE.recolle;
  else if (etapes) titre = n ? `✓ ${nombre(n, 'recette détaillée', 'recettes détaillées')}` : TEXTES_SERIE.aucuneRecette;
  else if (n) titre = `✓ ${nombre(n, 'idée ajoutée', 'idées ajoutées')}`;
  else if (autres.length) titre = `✓ ${nombre(autres.length, 'recette enregistrée', 'recettes enregistrées')}`;
  else titre = TEXTES_SERIE.aucuneIdee;
  const restants = etapes ? Number(etat.restants) || 0 : null;
  return {
    titre,
    noms: recolle ? [] : dernier.map((plat) => plat.nom),
    // Toujours à part de la liste des idées : une recette remplacée ne passe jamais pour une idée ajoutée.
    autres: recolle ? [] : autres.map(({ nom, statut }) => (statut === 'remplace'
      ? `«\u00A0${nom}\u00A0»\u00A0: recette remplacée.`
      : `«\u00A0${nom}\u00A0»\u00A0: recette enregistrée.`)),
    nonRepris: recolle ? [] : nonRepris.map(({ nom, raison }) => (etapes
      ? `«\u00A0${nom}\u00A0» n’a pas été repris\u00A0: il restera à détailler.`
      : raison || `«\u00A0${nom}\u00A0» n’est pas repris.`)),
    // Idées seulement : sous les étapes, le compte se confondrait avec « Encore N recettes à détailler ».
    depuis: !etapes && faits > (recolle ? 0 : n) ? `${faits}\u00A0depuis l’ouverture de cet écran.` : null,
    restants: !etapes ? null
      : restants > 0 ? `Encore ${nombre(restants, 'recette', 'recettes')} à détailler.` : TEXTES_SERIE.fin,
    aide: recolle ? TEXTES_SERIE.recolleSuite : etapes && restants === 0 ? null : TEXTES_SERIE.aide,
    conseil: etapes && etat.conseil ? TEXTES_SERIE.conseil : null,
    ...(etapes ? textesDesEtapes(etat, restants) : {}),
  };
}

/** Phrases propres à une série d'étapes : recopier la demande, recettes refusées dans la visite. */
function textesDesEtapes(etat, restants) {
  const refuses = (Array.isArray(etat?.refuses) ? etat.refuses : []).filter(estObjet);
  const noms = refuses.map((plat) => `«\u00A0${plat.nom}\u00A0»`);
  return {
    recopier: etat?.conseil && restants > 0 ? TEXTES_SERIE.recopier(restants) : null,
    refuses: !refuses.length ? null
      : refuses.length > 1
        ? `${refuses.length}\u00A0recettes n’ont pas été reprises\u00A0: ${noms.join(', ')}.`
        : `1\u00A0recette n’a pas été reprise\u00A0: ${noms[0]}.`,
    redemander: refuses.length ? TEXTES_SERIE.redemander(refuses.length) : null,
  };
}
