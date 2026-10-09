// T2a « Ce que <Prénom> mange » : vocabulaire.js, compatibilite.js, regles.js, et les ajustements de paquet.js,
// edition.js, notes.js, plats.js, sauvegarde.js et roles.js. Fixtures génériques (aucune donnée du foyer).
process.env.TZ = 'Europe/Paris';

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile, readdir } from 'node:fs/promises';
import * as vocabulaire from '../js/coeur/vocabulaire.js';
import * as paquet from '../js/coeur/paquet.js';
import {
  TYPES_A_ADAPTER, marqueursEffectifs, declenche, evaluer, profilsContraints, aAdapterPour, bilanCompatibilite,
  platsSansVersion, marqueursDouteux, MOTS_DOUTEUX, repereAttendu,
} from '../js/coeur/compatibilite.js';
import { REGIMES, PRECISIONS, lireRegime, ecrireRegime, validerRegles, decrireRegles } from '../js/coeur/regles.js';
import { fileDecouverte, completerFile, nombreANoter, suivant } from '../js/coeur/notes.js';
import { FILTRES, filtresPour, filtreRetenu, filtrerPlats } from '../js/coeur/plats.js';
import { ingredientSaisi, natureProposee, reperesDe, REPERES, preparerModification, normaliserPourEdition } from '../js/coeur/edition.js';
import {
  creerSauvegarde, lireSauvegarde, validerSauvegarde, preparerRestauration, appliquerConditions,
} from '../js/coeur/sauvegarde.js';
import { resoudreRoute, routeAutorisee, parametreDe } from '../js/coeur/roles.js';

// ——— Fixtures ———

const ing = (produit, marqueurs = [], extra = {}) => ({ produit, qte: 1, unite: 'pc', rayon: 'divers', marqueurs, ...extra });
const viande = (produit, marqueurs = ['viande']) => ing(produit, marqueurs, { forme: 'morceaux' });
const plat = (id, ingredients, extra = {}) => ({
  id, nom: extra.nom ?? `Plat ${id}`, type: 'plat', statutRecette: 'brouillon', portionsBase: 4, ingredients, ...extra,
});

const BOEUF = viande('bœuf à braiser', ['viande', 'boeuf']);
const JAMBON = viande('jambon blanc', ['viande', 'porc', 'charcuterie']);
const LARDONS = viande('lardons', ['viande', 'porc', 'charcuterie']);
const ESCARGOTS = viande('escargots');
const FOND_VOLAILLE = ing('fond de volaille', ['bouillon_viande']);
const GELATINE_PORC = ing('gélatine', ['gelatine_porc']);
const GELATINE_BOEUF = ing('gélatine de bœuf', ['gelatine_animale']);
const SAINDOUX = ing('saindoux', ['graisse_animale']);
const OEUF = ing('œuf', ['oeuf']);
const COMTE = ing('comté', ['laitier']);
const CAMEMBERT = ing('camembert', ['laitier']);
const FUMET = ing('fumet de poisson', ['poisson']);
const SAUMON = ing('saumon', ['poisson']);
const CREVETTES = ing('crevettes', ['fruits_de_mer']);
const MIEL = ing('miel');
const BEURRE = ing('beurre', ['laitier']);
const PATES = ing('pâtes', ['feculent']);

const SANS_VIANDE = ecrireRegime({ regime: 'sans_viande', precisions: new Set() }, []);
const NI_POISSON = ecrireRegime({ regime: 'sans_viande_ni_poisson', precisions: new Set() }, []);
const ADULTE_A = { id: 'profil-a', nom: 'Adulte A', email: 'a@example.com', ordre: 1, coefPortion: 1 };
const ADULTE_B = { id: 'profil-b', nom: 'Adulte B', email: '', ordre: 2, coefPortion: 1, regles: SANS_VIANDE };
const ENFANT = { id: 'enfant', nom: 'Enfant', email: '', ordre: 3, coefPortion: 0.5 };
const PROFILS = [ENFANT, ADULTE_B, ADULTE_A];

const avecRegles = (regles) => ({ ...ADULTE_B, regles });
const niveau = (p, profil = ADULTE_B) => evaluer(p, profil).niveau;
const version = (pour, retirer, ajouter = [], consigne = 'Part à part.') => ({ pour, retirer, ajouter, consigne });
const THON = { produit: 'thon au naturel', qtePortion: 50, unite: 'g', rayon: 'epicerie_salee', marqueurs: ['poisson'] };

/** Vrai si la valeur contient undefined, à quelque profondeur que ce soit. */
function contientUndefined(valeur) {
  if (valeur === undefined) return true;
  if (Array.isArray(valeur)) return valeur.some(contientUndefined);
  if (valeur && typeof valeur === 'object') return Object.values(valeur).some(contientUndefined);
  return false;
}

// ——— vocabulaire.js ———

test('vocabulaire : mêmes valeurs qu’avant le déplacement, plus graisse_animale et gelatine_animale (et ceux de T2c)', () => {
  const avant = ['viande', 'boeuf', 'porc', 'volaille', 'agneau', 'charcuterie', 'poisson', 'fruits_de_mer',
    'bouillon_viande', 'gelatine_porc', 'oeuf', 'oeuf_cru', 'laitier', 'alcool_cru', 'cafe', 'legume', 'feculent'];
  // T2c : le vocabulaire ne fait que s'agrandir (précautions d'un jeune enfant).
  const t2c = ['cru', 'lait_cru', 'fruit_coque', 'cafeine', 'miel', 'poisson_predateur', 'soja'];
  assert.deepEqual(vocabulaire.VOCABULAIRES.marqueurs, [...avant, 'graisse_animale', 'gelatine_animale', ...t2c]);
  assert.deepEqual(vocabulaire.VOCABULAIRES.unite, ['g', 'kg', 'ml', 'cl', 'l', 'pc', 'cs', 'cc', 'pincee', 'botte', 'sachet', 'boite', 'tranche']);
  assert.deepEqual(vocabulaire.VOCABULAIRES.forme, ['hachee', 'fine', 'morceaux', 'effilochable']);
  assert.deepEqual(vocabulaire.SOUS_TYPES_VIANDE, ['boeuf', 'porc', 'volaille', 'agneau', 'charcuterie']);
  assert.deepEqual(vocabulaire.VIANDES, ['viande', 'boeuf', 'porc', 'volaille', 'agneau', 'charcuterie']);
  assert.deepEqual(vocabulaire.IMPLICATIONS, { gelatine_porc: ['gelatine_animale'], cafe: ['cafeine'], poisson_predateur: ['poisson'] });
  // Toujours importables depuis paquet.js.
  assert.equal(paquet.VOCABULAIRES, vocabulaire.VOCABULAIRES);
  assert.equal(paquet.code, vocabulaire.code);
  assert.equal(paquet.validerIngredient, vocabulaire.validerIngredient);
  assert.equal(paquet.code('Graisse animale'), 'graisse_animale');
});

test('vocabulaire : une fiche marquée graisse_animale et gelatine_animale passe validerPaquet', () => {
  const r = paquet.validerPaquet({
    format: 'paquet@1',
    plats: [plat('confit', [ing('Saindoux', ['Graisse animale']), ing('gélatine', ['gelatine_animale'])])],
  });
  assert.equal(r.valide, true);
  assert.deepEqual(r.plats[0].donnees.ingredients.map((i) => i.marqueurs), [['graisse_animale'], ['gelatine_animale']]);
});

test('validerIngredient : exporté, mêmes erreurs qu’avant', () => {
  const erreurs = [];
  const r = vocabulaire.validerIngredient({ produit: 'Bœuf', qte: 1, unite: 'kg', rayon: 'boucherie', marqueurs: ['viande'] }, {
    position: { affiche: 'Ingrédient 1', claude: 'ingredients[0]' }, champQte: 'qte',
    signaler: (message, pourClaude) => erreurs.push({ message, pourClaude }), inconnu: () => {},
  });
  assert.equal(r, null);
  assert.match(erreurs[0].message, /forme de la viande/);
});

test('graphe d’import de js/coeur/ sans cycle ; compatibilite.js et regles.js n’importent pas paquet.js', async () => {
  const dossier = new URL('../js/coeur/', import.meta.url);
  const fichiers = (await readdir(dossier)).filter((f) => f.endsWith('.js'));
  const graphe = new Map();
  for (const fichier of fichiers) {
    const source = await readFile(new URL(fichier, dossier), 'utf8');
    graphe.set(fichier, [...source.matchAll(/(?:import|export)\s[^;]*?from\s+'\.\/([^']+)'/g)].map((m) => m[1]));
  }
  const etat = new Map();
  const visiter = (fichier, chemin) => {
    if (etat.get(fichier) === 'fini') return;
    assert.notEqual(etat.get(fichier), 'en cours', `cycle : ${[...chemin, fichier].join(' → ')}`);
    etat.set(fichier, 'en cours');
    for (const suivantFichier of graphe.get(fichier) ?? []) visiter(suivantFichier, [...chemin, fichier]);
    etat.set(fichier, 'fini');
  };
  for (const fichier of fichiers) visiter(fichier, []);
  assert.ok(!graphe.get('compatibilite.js').includes('paquet.js'));
  assert.ok(!graphe.get('regles.js').includes('paquet.js'));
  assert.ok(graphe.get('compatibilite.js').includes('vocabulaire.js'));
  assert.ok(graphe.get('regles.js').includes('vocabulaire.js'));
  assert.deepEqual(graphe.get('vocabulaire.js'), ['slug.js']);
});

// ——— Adulte sans viande, cas un par un ———

test('Pas de viande : bœuf, jambon, lardons, escargots, fond de volaille, gélatines, saindoux exclus', () => {
  for (const ingredient of [BOEUF, JAMBON, LARDONS, ESCARGOTS, FOND_VOLAILLE, GELATINE_PORC, GELATINE_BOEUF, SAINDOUX]) {
    const r = evaluer(plat('x', [PATES, ingredient]), ADULTE_B);
    assert.equal(r.niveau, 'exclu', ingredient.produit);
    assert.deepEqual(r.fautifs, [ingredient], ingredient.produit);
    assert.equal(r.aCreer, true);
    assert.equal(r.besoin, 'sans_viande');
  }
});

test('Pas de viande : œuf, comté, camembert, fumet de poisson, saumon, crevettes, miel, beurre conviennent', () => {
  for (const ingredient of [OEUF, COMTE, CAMEMBERT, FUMET, SAUMON, CREVETTES, MIEL, BEURRE]) {
    const r = evaluer(plat('x', [PATES, ingredient]), ADULTE_B);
    assert.equal(r.niveau, 'ok', ingredient.produit);
    assert.deepEqual(r.fautifs, []);
    assert.equal(r.besoin, null);
  }
});

test('Ni viande ni poisson : fumet de poisson et crevettes exclus, œuf et fromage conviennent', () => {
  const profil = avecRegles(NI_POISSON);
  assert.equal(niveau(plat('x', [FUMET]), profil), 'exclu');
  assert.equal(niveau(plat('x', [CREVETTES]), profil), 'exclu');
  assert.equal(niveau(plat('x', [BOEUF]), profil), 'exclu');
  assert.equal(niveau(plat('x', [OEUF, COMTE, MIEL]), profil), 'ok');
  // Un poisson seul demande une adaptation, pas une version « sans viande ».
  assert.equal(evaluer(plat('x', [SAUMON]), profil).besoin, 'adapter');
  assert.equal(evaluer(plat('x', [SAUMON, BOEUF]), profil).besoin, 'adapter');
});

test('marqueursEffectifs : sous-types → viande, gelatine_porc → gelatine_animale, rien d’écrit', () => {
  assert.deepEqual([...marqueursEffectifs(JAMBON)].sort(), ['charcuterie', 'porc', 'viande']);
  assert.deepEqual([...marqueursEffectifs(ing('rôti', ['volaille']))].sort(), ['viande', 'volaille']);
  assert.deepEqual([...marqueursEffectifs(GELATINE_PORC)].sort(), ['gelatine_animale', 'gelatine_porc']);
  assert.deepEqual(GELATINE_PORC.marqueurs, ['gelatine_porc']);
  assert.deepEqual([...marqueursEffectifs({})], []);
  assert.deepEqual([...marqueursEffectifs({ marqueurs: ['constructor'] })], ['constructor']);
});

test('declenche : exclureMarqueurs et exclureProduits, déclenchés ou non ; autres types → null', () => {
  const p = plat('x', [PATES, ing('Lardons', ['viande', 'porc', 'charcuterie'], { forme: 'fine' }), ing('navet')]);
  assert.deepEqual(declenche({ type: 'exclureMarqueurs', marqueurs: ['viande'], severite: 'exclu' }, p).fautifs.map((i) => i.produit), ['Lardons']);
  assert.equal(declenche({ type: 'exclureMarqueurs', marqueurs: ['poisson'], severite: 'exclu' }, p), null);
  // Produits comparés par slug : casse, accents et tirets ignorés.
  assert.deepEqual(declenche({ type: 'exclureProduits', produits: ['lardons', 'NAVET'], severite: 'exclu' }, p).fautifs.map((i) => i.produit), ['Lardons', 'navet']);
  assert.equal(declenche({ type: 'exclureProduits', produits: ['céleri'], severite: 'exclu' }, p), null);
  assert.equal(declenche({ type: 'legumePrincipal', severite: 'exclu' }, p), null);
  assert.equal(declenche({ type: 'exclureMarqueurs', marqueurs: ['viande'], severite: 'exclu', actif: false }, p), null);
  assert.equal(declenche({ type: 'exclureMarqueurs', marqueurs: [], severite: 'exclu' }, p), null);
  assert.equal(declenche(null, p), null);
});

test('saufMarqueurs : le jambon passe ; jambon + bœuf reste exclu, le bœuf seul fautif', () => {
  const profil = avecRegles(ecrireRegime({ regime: 'sans_viande', precisions: new Set(['charcuterie']) }, []));
  assert.equal(niveau(plat('x', [PATES, JAMBON]), profil), 'ok');
  assert.equal(niveau(plat('x', [LARDONS]), profil), 'ok');
  const r = evaluer(plat('x', [JAMBON, BOEUF]), profil);
  assert.equal(r.niveau, 'exclu');
  assert.deepEqual(r.fautifs, [BOEUF]);
});

test('exclureProduits : « Lardons » = « lardons » ; sévérité adaptable → adaptable sans version', () => {
  const profil = avecRegles([{ type: 'exclureProduits', produits: ['Lardons'], severite: 'exclu' }]);
  assert.equal(niveau(plat('x', [LARDONS]), profil), 'exclu');
  assert.equal(niveau(plat('x', [JAMBON]), profil), 'ok');
  const adaptable = avecRegles([{ type: 'exclureProduits', produits: ['navet'], severite: 'adaptable', consigne: 'Retirer' }]);
  const r = evaluer(plat('x', [ing('navet')]), adaptable);
  assert.equal(r.niveau, 'adaptable');
  assert.equal(r.aCreer, false);
  assert.equal(r.variante, null);
});

test('types non évalués gardés et sans effet ; regles absent ou null ; préférence sans effet', () => {
  const autres = [
    { type: 'formeViande', autorisees: ['hachee'], severite: 'exclu' },
    { type: 'legumePrincipal', severite: 'exclu' },
    { type: 'proteineChaqueRepas', severite: 'preference' },
    { type: 'aEmporter', severite: 'preference' },
    { type: 'substitution', si: { produits: ['lardons'] }, par: [], consigne: 'Saumon' },
    { type: 'exclureMarqueurs', marqueurs: ['viande'], severite: 'preference' },
  ];
  const p = plat('x', [BOEUF, ing('courgette', ['legume'], { role: 'principal' })], { emporter: false });
  assert.equal(niveau(p, avecRegles(autres)), 'ok');
  assert.deepEqual(profilsContraints([avecRegles(autres)]), []);
  assert.equal(niveau(p, { ...ADULTE_B, regles: undefined }), 'ok');
  assert.equal(niveau(p, { ...ADULTE_B, regles: null }), 'ok');
  assert.equal(niveau(p, { ...ADULTE_B, regles: 'abîmé' }), 'ok');
  assert.equal(niveau(p, null), 'ok');
});

test('plat ⏳ → inconnu ; dessert à la gélatine exclu ; evaluer ne lit pas les notes', () => {
  const attente = { id: 'a', nom: 'Plat sans recette' };
  assert.deepEqual(evaluer(attente, ADULTE_B), {
    niveau: 'inconnu', variante: null, fautifs: [], restants: [], aCreer: false, aRevoir: false, besoin: null,
    versions: [], manquants: [], aCompleter: false,
  });
  assert.equal(niveau({ ...attente, ingredients: [] }), 'inconnu');
  assert.equal(niveau(plat('panna', [GELATINE_BOEUF, ing('crème', ['laitier'])], { type: 'dessert' })), 'exclu');
  const note = plat('x', [BOEUF], { notes: { 'profil-b': 0 } });
  assert.deepEqual(evaluer(note, ADULTE_B), evaluer(plat('x', [BOEUF]), ADULTE_B));
});

// ——— Versions de la fiche ———

test('version qui couvre tout → adaptable, source fiche', () => {
  const p = plat('gratin', [PATES, JAMBON], { variantes: [version('profil-b', ['Jambon blanc'], [THON], 'Part au thon')] });
  const r = evaluer(p, ADULTE_B);
  assert.equal(r.niveau, 'adaptable');
  assert.deepEqual(r.variante, { source: 'fiche', retirer: ['Jambon blanc'], ajouter: [THON], consigne: 'Part au thon', style: 'mer' });
  assert.deepEqual(r.fautifs, [JAMBON]);
  assert.equal(r.aCreer, false);
  assert.equal(r.aRevoir, false);
  // « Pas de viande » attend aussi une version végétale : le plat est à compléter (besoin de la version qui manque).
  assert.deepEqual(r.manquants, ['vegetal']);
  assert.equal(r.aCompleter, true);
  assert.equal(r.besoin, 'sans_viande');
  // Profil sans style attendu (règles hors régime de l'écran) : comme avant, rien ne manque.
  const seul = evaluer(p, avecRegles([{ type: 'exclureMarqueurs', marqueurs: ['viande'], severite: 'exclu' }]));
  assert.equal(seul.niveau, 'adaptable');
  assert.deepEqual(seul.manquants, []);
  assert.equal(seul.aCompleter, false);
  assert.equal(seul.besoin, null);
  // La version d'un autre profil ne compte pas.
  assert.equal(evaluer({ ...p, variantes: [version('profil-a', ['jambon blanc'])] }, ADULTE_B).aCreer, true);
});

test('ingrédient ajouté par « Modifier », non couvert → à revoir, avec ce qui reste', () => {
  const p = plat('gratin', [PATES, JAMBON, ing('bouillon de bœuf', ['bouillon_viande'])], {
    variantes: [version('profil-b', ['jambon blanc'], [THON])],
  });
  const r = evaluer(p, ADULTE_B);
  assert.equal(r.niveau, 'exclu');
  assert.equal(r.aRevoir, true);
  assert.equal(r.aCreer, false);
  assert.deepEqual(r.restants, ['bouillon de bœuf']);
  assert.equal(r.besoin, 'sans_viande');
  assert.equal(r.variante, null);
});

test('version qui ajoute du saumon pour « ni poisson » → à revoir', () => {
  const profil = avecRegles(NI_POISSON);
  const ajout = { produit: 'saumon', qtePortion: 100, unite: 'g', rayon: 'poissonnerie', marqueurs: ['poisson'] };
  const r = evaluer(plat('x', [LARDONS], { variantes: [version('profil-b', ['lardons'], [ajout])] }), profil);
  assert.equal(r.niveau, 'exclu');
  assert.equal(r.aRevoir, true);
  assert.deepEqual(r.restants, ['saumon']);
  assert.equal(r.besoin, 'adapter');
});

test('deux versions pour un profil → celle qui convient ; plat ok avec une version → ok', () => {
  const p = plat('x', [LARDONS], { variantes: [version('profil-b', ['lardons']), version('profil-b', [])] });
  assert.equal(evaluer(p, ADULTE_B).niveau, 'adaptable');
  // Chaque version est jugée : la seconde convient, le plat n'est plus à revoir.
  const inverse = { ...p, variantes: [...p.variantes].reverse() };
  const r = evaluer(inverse, ADULTE_B);
  assert.equal(r.niveau, 'adaptable');
  assert.equal(r.aRevoir, false);
  assert.equal(r.variante.retirer[0], 'lardons');
  assert.deepEqual(r.versions.map((v) => v.convient), [false, true]);
  const ok = plat('x', [PATES], { variantes: [version('profil-b', ['pâtes'])] });
  assert.deepEqual(evaluer(ok, ADULTE_B), {
    niveau: 'ok', variante: null, fautifs: [], restants: [], aCreer: false, aRevoir: false, besoin: null,
    versions: [{ variante: ok.variantes[0], style: 'vegetal', convient: true, restants: [] }], manquants: [], aCompleter: false,
  });
});

// ——— Profils et plats concernés ———

test('profilsContraints : au moins une règle évaluée, ordre d’affichage', () => {
  const autre = { ...ADULTE_A, regles: NI_POISSON };
  assert.deepEqual(profilsContraints([ADULTE_B, ENFANT, autre]).map((p) => p.id), ['profil-a', 'profil-b']);
  assert.deepEqual(profilsContraints([ADULTE_A, ENFANT, { ...ADULTE_B, regles: [] }]), []);
  assert.deepEqual(profilsContraints(undefined), []);
});

const CATALOGUE = [
  plat('boeuf-carottes', [BOEUF], { nom: 'Bœuf carottes' }),
  plat('gratin', [PATES, JAMBON], { nom: 'Gratin', variantes: [version('profil-b', ['jambon blanc'], [THON])] }),
  plat('quiche', [OEUF, LARDONS], { nom: 'Quiche', notes: { 'profil-a': 5 } }),
  plat('risotto', [PATES, FOND_VOLAILLE], { nom: 'Risotto', notes: { 'profil-a': 1 } }),
  plat('pates-saumon', [PATES, SAUMON], { nom: 'Pâtes au saumon' }),
  plat('panna', [GELATINE_BOEUF], { nom: 'Panna cotta', type: 'dessert' }),
  plat('puree', [ing('pomme de terre', ['legume'], { role: 'principal' })], { nom: 'Purée', type: 'accompagnement' }),
  plat('rillettes', [viande('porc', ['porc'])], { nom: 'Rillettes', type: 'apero' }),
  plat('fond-maison', [BOEUF], { nom: 'Fond maison', type: 'preparation' }),
  { id: 'attente', nom: 'Plat à venir' },
  plat('jamais', [BOEUF], { nom: 'Jamais', notes: { 'profil-b': 0 } }),
  plat('orphelin', [PATES], { nom: 'Orphelin', variantes: [version('profil-inconnu', [])] }),
];

test('aAdapterPour, bilanCompatibilite, platsSansVersion : un seul filtre, même nombre', () => {
  const aAdapter = CATALOGUE.filter((p) => aAdapterPour(p, ADULTE_B)).map((p) => p.id);
  assert.deepEqual(aAdapter, ['boeuf-carottes', 'quiche', 'risotto', 'panna']);
  const bilan = bilanCompatibilite(CATALOGUE, ADULTE_B, { profils: PROFILS });
  // Le gratin a sa version mer (thon) : il compte avec les versions, et à compléter (végétale).
  assert.deepEqual(bilan, { convient: 3, avecVersion: 1, aCreer: 4, aCompleter: 1, orphelines: 1 });
  assert.equal(platsSansVersion(CATALOGUE, ADULTE_B).length, bilan.aCreer + bilan.aCompleter);
  // Apéro, préparations, ⏳ et « Jamais » exclus partout.
  for (const id of ['rillettes', 'fond-maison', 'attente', 'jamais']) {
    assert.equal(aAdapterPour(CATALOGUE.find((p) => p.id === id), ADULTE_B), false, id);
  }
  // Sans profils donnés, pas d'orphelines comptées ; un profil sans règle : tout convient.
  assert.equal(bilanCompatibilite(CATALOGUE, ADULTE_B).orphelines, 0);
  assert.deepEqual(bilanCompatibilite(CATALOGUE, ADULTE_A), { convient: 9, avecVersion: 0, aCreer: 0, aCompleter: 0, orphelines: 0 });
  // Une fonction d'évaluation fournie (mémorisée par l'app) est utilisée.
  let appels = 0;
  const memorisee = (p, profil) => { appels += 1; return evaluer(p, profil); };
  assert.equal(aAdapterPour(CATALOGUE[0], ADULTE_B, { evaluer: memorisee }), true);
  assert.equal(appels, 1);
});

test('platsSansVersion : demande ouverte, puis notes des autres, puis nom, envoyés en fin', () => {
  const ids = (options) => platsSansVersion(CATALOGUE, ADULTE_B, { profils: PROFILS, ...options }).map((e) => e.plat.id);
  // Notes des autres (non noté = 3) : quiche 5 ; bœuf carottes, panna 3 ; risotto max(1, 3 de l'enfant) = 3.
  // Le gratin (à compléter : version mer seule) vient après tous les plats à créer.
  assert.deepEqual(ids(), ['quiche', 'boeuf-carottes', 'panna', 'risotto', 'gratin']);
  // Sans les profils, seules les notes présentes : risotto 1 passe en dernier.
  assert.deepEqual(platsSansVersion(CATALOGUE, ADULTE_B).map((e) => e.plat.id), ['quiche', 'boeuf-carottes', 'panna', 'risotto', 'gratin']);
  assert.deepEqual(platsSansVersion(CATALOGUE, ADULTE_B, { profils: [ADULTE_A, ADULTE_B] }).map((e) => e.plat.id),
    ['quiche', 'boeuf-carottes', 'panna', 'risotto', 'gratin']);
  const demandes = [
    { id: 'risotto__profil-b', statut: 'ouverte' },
    { id: 'panna__profil-b', statut: 'traitee' },
    { id: 'boeuf-carottes__profil-a', statut: 'ouverte' },
    { id: 'gratin__profil-b', statut: 'ouverte' },
  ];
  assert.deepEqual(ids({ demandes }), ['risotto', 'quiche', 'boeuf-carottes', 'panna', 'gratin']);
  assert.deepEqual(ids({ demandes, envoyes: ['risotto', 'quiche'] }), ['boeuf-carottes', 'panna', 'risotto', 'quiche', 'gratin']);
  const premier = platsSansVersion(CATALOGUE, ADULTE_B, { profils: PROFILS })[0];
  assert.deepEqual(premier, {
    plat: CATALOGUE[2], fautifs: [LARDONS], besoin: 'sans_viande', aRevoir: false, manquants: ['mer', 'vegetal'], aCompleter: false,
  });
});

test('marqueursDouteux : mots de viande, bouillons, gélatine, graisses ; fumet de poisson jamais', () => {
  const p = plat('x', [
    ing('lardons fumés'), ing('bouillon de volaille'), ing('fond de veau'), ing('fumet de poisson'),
    ing('gélatine en feuilles'), ing('graisse de canard'), ing("graisse d'oie"), ing('suif'), ing('escargots'),
    ing('cuisses de grenouille'), ing('bouillon de légumes'), ing('pâtes'), JAMBON, FOND_VOLAILLE, GELATINE_PORC,
    ing('bouillon de bœuf', ['viande']),
  ]);
  assert.deepEqual(marqueursDouteux(p), [
    { produit: 'lardons fumés', attendu: 'viande' },
    { produit: 'bouillon de volaille', attendu: 'bouillon_viande' },
    { produit: 'fond de veau', attendu: 'bouillon_viande' },
    { produit: 'gélatine en feuilles', attendu: 'gelatine_animale' },
    { produit: 'graisse de canard', attendu: 'graisse_animale' },
    { produit: "graisse d'oie", attendu: 'graisse_animale' },
    { produit: 'suif', attendu: 'graisse_animale' },
    { produit: 'escargots', attendu: 'viande' },
    { produit: 'cuisses de grenouille', attendu: 'viande' },
    { produit: 'bouillon de bœuf', attendu: 'bouillon_viande' },
  ]);
  // Ne change jamais le niveau.
  assert.equal(niveau(plat('x', [ing('bouillon de volaille')])), 'ok');
  assert.equal(repereAttendu('porcini'), null);
  assert.equal(repereAttendu(''), null);
  assert.ok(MOTS_DOUTEUX.every((e) => vocabulaire.VOCABULAIRES.marqueurs.includes(e.attendu)));
  assert.deepEqual(TYPES_A_ADAPTER, ['plat', 'accompagnement', 'dessert']);
});

// ——— regles.js ———

test('ecrireRegime : textes de la règle « regime », triés, sans clé vide', () => {
  assert.deepEqual(SANS_VIANDE, [{
    id: 'regime', type: 'exclureMarqueurs', marqueurs: ['bouillon_viande', 'gelatine_animale', 'graisse_animale', 'viande'], severite: 'exclu',
  }]);
  assert.deepEqual(ecrireRegime({ regime: 'sans_viande', precisions: new Set(['charcuterie']) }, []), [{
    id: 'regime', type: 'exclureMarqueurs', marqueurs: ['bouillon_viande', 'gelatine_animale', 'graisse_animale', 'viande'],
    saufMarqueurs: ['charcuterie'], severite: 'exclu',
  }]);
  assert.deepEqual(ecrireRegime({ regime: 'sans_viande', precisions: ['bouillon', 'gelatine', 'graisse'] }, [])[0].marqueurs, ['viande']);
  assert.deepEqual(NI_POISSON[0].marqueurs, ['bouillon_viande', 'fruits_de_mer', 'gelatine_animale', 'graisse_animale', 'poisson', 'viande']);
  const autres = [{ type: 'exclureProduits', produits: ['navet'], severite: 'exclu' }];
  assert.deepEqual(ecrireRegime({ regime: 'tout', precisions: new Set(['charcuterie']) }, autres), autres);
  assert.notEqual(ecrireRegime({ regime: 'tout' }, autres)[0], autres[0]); // copie
  assert.deepEqual(ecrireRegime({ regime: 'tout' }), []);
  assert.ok(!JSON.stringify(SANS_VIANDE).includes('gelatine_porc'));
  // Même entrée, même sortie ; jamais de valeur undefined.
  for (const regime of Object.keys(REGIMES)) {
    for (const precisions of [new Set(), new Set(PRECISIONS.map((p) => p.id))]) {
      const a = ecrireRegime({ regime, precisions }, autres);
      assert.deepEqual(ecrireRegime({ regime, precisions: new Set([...precisions].reverse()) }, autres), a);
      assert.equal(contientUndefined(a), false);
    }
  }
});

test('lireRegime ∘ ecrireRegime = identité ; autres conservées à leur place', () => {
  const autres = [
    { type: 'exclureProduits', produits: ['céleri', 'navet'], severite: 'exclu' },
    { type: 'substitution', si: { produits: ['lardons'], marqueurs: ['charcuterie'] }, par: [], consigne: 'Part au saumon', sauf: [] },
    { type: 'typeAVenir', truc: 1 },
  ];
  const cas = [];
  for (const regime of Object.keys(REGIMES)) {
    for (const precisions of [[], ['charcuterie'], ['bouillon', 'graisse'], PRECISIONS.map((p) => p.id)]) {
      cas.push(ecrireRegime({ regime, precisions }, autres));
      cas.push(ecrireRegime({ regime, precisions, position: 2 }, autres));
    }
  }
  cas.push([], [{ id: 'regime', type: 'exclureMarqueurs', marqueurs: ['viande'], severite: 'adaptable' }]);
  for (const regles of cas) {
    const lu = lireRegime(regles);
    assert.deepEqual(ecrireRegime(lu, lu.autres), regles);
  }
  const lu = lireRegime([autres[0], ...ecrireRegime({ regime: 'sans_viande', precisions: ['gelatine'] }, [])]);
  assert.equal(lu.regime, 'sans_viande');
  assert.deepEqual([...lu.precisions], ['gelatine']);
  assert.deepEqual(lu.autres, [autres[0]]);
  assert.equal(lu.position, 1);
  // Règle « regime » modifiée ailleurs : pas reconnue, gardée telle quelle.
  const modifiee = [{ id: 'regime', type: 'exclureMarqueurs', marqueurs: ['viande', 'oeuf'], severite: 'exclu' }];
  assert.deepEqual(lireRegime(modifiee), { regime: 'tout', precisions: new Set(), autres: modifiee, position: 0 });
  assert.equal(lireRegime(undefined).regime, 'tout');
  assert.equal(lireRegime(null).autres.length, 0);
});

test('decrireRegles : textes exacts', () => {
  const texte = (regime, precisions = [], autres = []) => decrireRegles({ regles: ecrireRegime({ regime, precisions }, autres) });
  assert.equal(texte('sans_viande'), 'Ne mange pas de viande (bœuf, porc, volaille, agneau, charcuterie, escargots, grenouilles), '
    + 'ni de bouillon ou de fond de viande ou de volaille, ni de gélatine animale, ni de graisse animale (saindoux, graisse de canard). '
    + 'Mange du poisson, des fruits de mer, du fumet de poisson, des œufs, du fromage (même à présure animale) et du miel.');
  assert.equal(texte('sans_viande', ['charcuterie']), 'Ne mange pas de viande (bœuf, porc, volaille, agneau, escargots, grenouilles), '
    + 'ni de bouillon ou de fond de viande ou de volaille, ni de gélatine animale, ni de graisse animale (saindoux, graisse de canard). '
    + 'Mange de la charcuterie, du poisson, des fruits de mer, du fumet de poisson, des œufs, du fromage (même à présure animale) et du miel.');
  assert.equal(texte('sans_viande', ['bouillon', 'gelatine', 'graisse']), 'Ne mange pas de viande (bœuf, porc, volaille, agneau, charcuterie, escargots, grenouilles). '
    + 'Mange des plats cuits avec un bouillon de viande, de la gélatine, de la graisse animale, du poisson, des fruits de mer, '
    + 'du fumet de poisson, des œufs, du fromage (même à présure animale) et du miel.');
  assert.equal(texte('sans_viande_ni_poisson'), 'Ne mange ni viande (bœuf, porc, volaille, agneau, charcuterie, escargots, grenouilles), '
    + 'ni poisson, ni fruits de mer, ni bouillon ou fond de viande, de volaille ou de poisson, ni gélatine animale, ni graisse animale. '
    + 'Mange des œufs, du fromage (même à présure animale) et du miel.');
  const navet = [{ type: 'exclureProduits', produits: ['céleri', 'navet'], severite: 'exclu' }];
  assert.equal(texte('tout', [], navet), 'Évite aussi\u00A0: céleri, navet.');
  assert.match(texte('sans_viande', [], navet), /et du miel\. Évite aussi\u00A0: céleri, navet\.$/);
  assert.equal(texte('tout'), '');
  assert.equal(decrireRegles({}), '');
  assert.ok(!/Adulte/.test(texte('sans_viande')));
});

test('validerRegles : absent → [], types connus, inconnue gardée, abîmée retirée, bornes', () => {
  assert.deepEqual(validerRegles(undefined), { regles: [], avertissements: [] });
  assert.deepEqual(validerRegles(null), { regles: [], avertissements: [] });
  assert.deepEqual(validerRegles({ type: 'x' }), { regles: [], avertissements: [] });
  const r = validerRegles([
    { id: 'regime', type: 'exclureMarqueurs', marqueurs: ['Viande', 'viande', 'graisse animale'], saufMarqueurs: [], severite: 'Exclu' },
    { type: 'exclureProduits', produits: [' Céleri ', 'celeri', 'navet'], severite: 'exclu' },
    { type: 'formeViande', autorisees: ['hachee'], severite: 'adaptable', consigne: 'Couper fin' },
    { type: 'substitution', si: { produits: ['lardons'] }, par: [], sauf: [] },
    { type: 'typeAVenir', truc: 1 },
    { type: 'exclureMarqueurs', marqueurs: ['inconnu'], severite: 'exclu' }, // abîmée
    { type: 'aEmporter' }, // sans sévérité
    'texte',
  ], { nom: 'Adulte B' });
  assert.deepEqual(r.regles, [
    { id: 'regime', type: 'exclureMarqueurs', marqueurs: ['viande', 'graisse_animale'], severite: 'exclu' },
    { type: 'exclureProduits', produits: ['céleri', 'navet'], severite: 'exclu' },
    { type: 'formeViande', autorisees: ['hachee'], severite: 'adaptable', consigne: 'Couper fin' },
    { type: 'substitution', si: { produits: ['lardons'] }, par: [], sauf: [] },
    { type: 'typeAVenir', truc: 1 },
  ]);
  assert.deepEqual(r.avertissements, [
    '3 règles abîmées d’Adulte B ont été ignorées.',
    'Une règle n’est pas comprise par cette version de l’app.',
  ]);
  assert.deepEqual(validerRegles([{ type: 'legumePrincipal' }], { nom: 'Paul' }).avertissements, ['Une règle abîmée de Paul a été ignorée.']);
  const trop = validerRegles(Array.from({ length: 31 }, () => ({ type: 'aEmporter', severite: 'preference' })));
  assert.equal(trop.regles.length, 30);
  assert.equal(trop.avertissements.length, 1);
  const produits = Array.from({ length: 51 }, (_, i) => `produit ${i}`);
  assert.deepEqual(validerRegles([{ type: 'exclureProduits', produits, severite: 'exclu' }]).regles, []);
  assert.equal(validerRegles([{ type: 'exclureProduits', produits: produits.slice(0, 50), severite: 'exclu' }]).regles.length, 1);
  assert.equal(contientUndefined(validerRegles([{ type: 'exclureProduits', produits: ['navet'], severite: 'exclu', x: undefined }]).regles), false);
});

// ——— Découvrir ———

const DECOUVERTE = [
  plat('a', [PATES]), plat('b', [BOEUF]), plat('c', [SAUMON]), plat('d', [JAMBON], { type: 'dessert' }),
  plat('e', [OEUF], { type: 'apero' }), { id: 'f', nom: 'F' },
];

test('fileDecouverte, completerFile, nombreANoter : sans garder, identiques à T1d', () => {
  const graine = 'profil-b:2026-10-07';
  const sans = fileDecouverte(DECOUVERTE, 'profil-b', { graine });
  assert.deepEqual(fileDecouverte(DECOUVERTE, 'profil-b', { graine, garder: null }), sans);
  assert.deepEqual(fileDecouverte(DECOUVERTE, 'profil-b', { graine, garder: () => true }), sans);
  assert.deepEqual(completerFile(sans.slice(0, 2), 1, DECOUVERTE, 'profil-b', { graine }),
    completerFile(sans.slice(0, 2), 1, DECOUVERTE, 'profil-b', { graine, garder: () => true }));
  assert.equal(nombreANoter(DECOUVERTE, 'profil-b'), 6);
  assert.equal(nombreANoter(DECOUVERTE, 'profil-b', {}), 6);
});

test('Découvrir : un profil contraint ne voit pas les plats sans version ; la version arrivée, le plat entre en fin de file', () => {
  const graine = 'g';
  const garder = (p) => { const r = evaluer(p, ADULTE_B); return !r.aCreer && !r.aRevoir; };
  const file = fileDecouverte(DECOUVERTE, 'profil-b', { graine, garder });
  assert.deepEqual([...file].sort(), ['a', 'c', 'e', 'f']);
  assert.equal(nombreANoter(DECOUVERTE, 'profil-b', { garder }), 4);
  // Le bœuf reçoit sa version : il revient à la fin, une seule fois.
  const apres = DECOUVERTE.map((p) => (p.id === 'b' ? { ...p, variantes: [version('profil-b', ['bœuf à braiser'], [THON])] } : p));
  const complete = completerFile(file, 0, apres, 'profil-b', { graine, garder });
  assert.deepEqual(complete.slice(0, file.length), file);
  assert.deepEqual(complete.slice(file.length), ['b']);
  assert.deepEqual(completerFile(complete, 0, apres, 'profil-b', { graine, garder }), complete);
  // Une version retirée entre-temps : la carte est sautée.
  assert.equal(suivant(['b', 'a'], 0, DECOUVERTE, 'profil-b', { garder }), 1);
  assert.equal(suivant(['b', 'a'], 0, DECOUVERTE, 'profil-b'), 0);
});

// ——— Filtres de la liste ———

test('filtresPour : cinq filtres, « Pour <Prénom> » / « Pour moi », « Versions à créer » au gestionnaire seul', () => {
  const contraints = profilsContraints(PROFILS);
  assert.deepEqual(filtresPour([], {}).map((f) => f.id), FILTRES.map((f) => f.id));
  const gestion = filtresPour(contraints, { moi: ADULTE_A, role: 'gestionnaire' });
  assert.deepEqual(gestion.map((f) => f.libelle).slice(5), ['🌿 Pour Adulte B', '❌ Versions à créer']);
  assert.deepEqual(gestion.map((f) => f.id).slice(5), ['pour-profil-b', 'a-creer']);
  const elle = filtresPour(contraints, { moi: ADULTE_B, role: 'courses' });
  assert.deepEqual(elle.map((f) => f.libelle).slice(5), ['🌿 Pour moi']);
  assert.equal(filtresPour(contraints, { role: 'gestionnaire' }).at(-1).id, 'a-creer');
  assert.deepEqual(filtresPour([], { role: 'gestionnaire' }).map((f) => f.id), FILTRES.map((f) => f.id));
  // Filtre mémorisé disparu → « Tous ».
  assert.equal(filtreRetenu(elle, 'a-creer').id, 'tous');
  assert.equal(filtreRetenu(elle, 'pour-profil-x').id, 'tous');
  assert.equal(filtreRetenu(elle, 'pour-profil-b').profil, ADULTE_B);
});

test('filtrerPlats : « Pour <Prénom> » (ok + adaptable, ⏳ exclus), « Versions à créer », filtres de T1 inchangés', () => {
  const filtres = filtresPour(profilsContraints(PROFILS), { role: 'gestionnaire' });
  const ids = (id, options = {}) => filtrerPlats(CATALOGUE, { filtre: filtreRetenu(filtres, id), evaluer, ...options }).map((p) => p.id);
  assert.deepEqual(ids('pour-profil-b'), ['gratin', 'orphelin', 'pates-saumon', 'puree']);
  // « Versions à créer » garde aussi le gratin, à compléter (version végétale).
  assert.deepEqual(ids('a-creer'), ['boeuf-carottes', 'gratin', 'panna', 'quiche', 'risotto']);
  assert.deepEqual(ids('a-creer', { recherche: 'pan' }), ['panna']);
  assert.deepEqual(filtrerPlats(CATALOGUE, { filtre: 'attente' }).map((p) => p.id), ['attente']);
  assert.deepEqual(filtrerPlats(CATALOGUE, { filtre: 'apero', evaluer }).map((p) => p.id), ['rillettes']);
  // Sans profil (identifiant seul) ou sans evaluer : tous les plats.
  assert.equal(filtrerPlats(CATALOGUE, { filtre: 'pour-profil-b', evaluer }).length, CATALOGUE.length);
  assert.equal(filtrerPlats(CATALOGUE, { filtre: filtreRetenu(filtres, 'a-creer') }).length, CATALOGUE.length);
});

// ——— « Modifier » : présélection de la nature ———

test('natureProposee : Viande pour un mot de viande, Autre + repère pour bouillon, gélatine, graisse', () => {
  assert.deepEqual(natureProposee('Escargots de Bourgogne'), { nature: 'viande' });
  assert.deepEqual(natureProposee('bouillon de volaille'), { nature: 'autre', repere: 'bouillon_viande' });
  assert.deepEqual(natureProposee('fond de veau'), { nature: 'autre', repere: 'bouillon_viande' });
  assert.deepEqual(natureProposee('gélatine'), { nature: 'autre', repere: 'gelatine_animale' });
  assert.deepEqual(natureProposee('saindoux'), { nature: 'autre', repere: 'graisse_animale' });
  assert.deepEqual(natureProposee('graisse de canard'), { nature: 'autre', repere: 'graisse_animale' });
  assert.equal(natureProposee('fumet de poisson'), null);
  assert.equal(natureProposee('courgette'), null);
  // Produit déjà connu : sa nature vient du catalogue, rien n'est présélectionné.
  assert.equal(natureProposee('bouillon de volaille', [{ produit: 'Bouillon de volaille', marqueurs: [] }]), null);
  assert.deepEqual(REPERES.bouillon_viande, 'Bouillon de viande');
  assert.deepEqual(REPERES.gelatine_animale, 'Gélatine animale');
  assert.deepEqual(REPERES.graisse_animale, 'Graisse animale');
});

test('ingredientSaisi : le repère d’un produit jamais vu est posé ; « Retirer » l’enlève ; toujours modifiable', () => {
  const champs = { produit: 'Bouillon de volaille', qte: '50', unite: 'cl', nature: 'autre' };
  const { ingredient } = ingredientSaisi(champs);
  assert.deepEqual(ingredient.marqueurs, ['bouillon_viande']);
  assert.deepEqual(reperesDe(ingredient), ['bouillon_viande']);
  assert.deepEqual(ingredientSaisi({ ...champs, reperes: [] }).ingredient.marqueurs, []);
  assert.deepEqual(ingredientSaisi({ ...champs, produit: 'saindoux', unite: 'g' }).ingredient.marqueurs, ['graisse_animale']);
  assert.deepEqual(ingredientSaisi({ ...champs, produit: 'gélatine', unite: 'g' }).ingredient.marqueurs, ['gelatine_animale']);
  // Viande présélectionnée puis choisie : forme « en morceaux », sans repère.
  const escargots = ingredientSaisi({ produit: 'escargots', qte: '12', unite: 'pc', nature: 'viande' }).ingredient;
  assert.deepEqual(escargots.marqueurs, ['viande']);
  assert.equal(escargots.forme, 'morceaux');
  // Produit connu : ses marqueurs, sans repère ajouté.
  const catalogue = [{ produit: 'bouillon de volaille', unite: 'cl', rayon: 'epicerie_salee', marqueurs: [] }];
  assert.deepEqual(ingredientSaisi({ produit: 'bouillon de volaille', qte: '50', unite: 'cl' }, { catalogue }).ingredient.marqueurs, []);
  // Ingrédient modifié qui porte un repère : gardé, sauf « Retirer ».
  const ingredients = [{ ...FOND_VOLAILLE, qte: 1 }];
  assert.deepEqual(ingredientSaisi({ produit: 'fond de volaille', qte: '2', unite: 'pc' }, { ingredients, index: 0 }).ingredient.marqueurs, ['bouillon_viande']);
  assert.deepEqual(ingredientSaisi({ produit: 'fond de volaille', qte: '2', unite: 'pc', reperes: [] }, { ingredients, index: 0 }).ingredient.marqueurs, []);
});

test('Modifier : un bouillon de volaille ajouté rend le plat exclu pour un profil sans viande', () => {
  const avant = plat('risotto', [PATES], { statutRecette: 'brouillon' });
  const base = normaliserPourEdition(avant);
  const { ingredient } = ingredientSaisi({ produit: 'bouillon de volaille', qte: '1', unite: 'l', nature: 'autre' });
  const r = preparerModification(base, { ...base, ingredients: [...base.ingredients, ingredient] }, avant);
  assert.deepEqual(r.erreurs, []);
  assert.equal(niveau({ ...avant, ...r.champs }), 'exclu');
});

// ——— Sauvegarde et restauration ———

const REGLES_COMPLETES = [
  ...ecrireRegime({ regime: 'sans_viande', precisions: ['charcuterie'] }, []),
  { type: 'substitution', si: { produits: ['lardons'], marqueurs: ['charcuterie'] }, par: [{ produit: 'saumon fumé', qtePortion: 2, unite: 'tranche', rayon: 'poissonnerie', marqueurs: ['poisson'] }], alternatives: [], consigne: 'Part au saumon', sauf: [] },
  { type: 'typeAVenir', truc: 1 },
];

const relire = (profils, plats = []) => {
  const { texte } = creerSauvegarde({ plats, profils }, { maintenant: new Date('2026-10-07T10:00:00Z') });
  return validerSauvegarde(lireSauvegarde(texte).sauvegarde);
};

test('sauvegarde : aller-retour des règles (saufMarqueurs, substitution, type inconnu) ; absent ≠ []', () => {
  const v = relire([{ ...ADULTE_B, regles: REGLES_COMPLETES }, { ...ADULTE_A, regles: [] }, ENFANT]);
  const parId = new Map(v.profils.map((p) => [p.id, p]));
  assert.deepEqual(parId.get('profil-b').regles, REGLES_COMPLETES);
  assert.deepEqual(parId.get('profil-a').regles, []);
  assert.equal(Object.hasOwn(parId.get('enfant'), 'regles'), false);
  assert.ok(v.avertissements.includes('Une règle n’est pas comprise par cette version de l’app.'));
  assert.ok(!v.avertissements.some((a) => /non reconnues/.test(a)));
});

test('sauvegarde : règles abîmées retirées avec un avertissement ; liste illisible ignorée', () => {
  const v = validerSauvegarde({
    format: 'paquet@1', sauvegardeLe: '2026-10-07T10:00:00.000Z', plats: [],
    profils: [
      { ...ADULTE_B, regles: [...SANS_VIANDE, { type: 'exclureMarqueurs', marqueurs: [], severite: 'exclu' }] },
      { ...ADULTE_A, regles: 'abîmé' },
    ],
  });
  assert.deepEqual(v.profils.find((p) => p.id === 'profil-b').regles, SANS_VIANDE);
  assert.ok(v.avertissements.includes('Une règle abîmée d’Adulte B a été ignorée.'));
  assert.equal(Object.hasOwn(v.profils.find((p) => p.id === 'profil-a'), 'regles'), false);
  assert.ok(v.avertissements.some((a) => /Adulte A.*règles sont abîmées/.test(a)));
});

test('restauration : profil absent revient avec ses règles ; présent sans règles : elles reviennent (reglesAbsentes)', () => {
  const v = relire([{ ...ADULTE_B, regles: REGLES_COMPLETES }, { ...ADULTE_A, regles: SANS_VIANDE }]);
  // Profil B absent de l'app ; profil A présent sans champ regles.
  const r = preparerRestauration(v, { plats: [], profils: [{ ...ADULTE_A }] });
  const ecritures = r.lots.flat();
  const b = ecritures.find((e) => e.id === 'profil-b');
  assert.deepEqual(b.condition, { absent: true });
  assert.deepEqual(b.donnees.regles, REGLES_COMPLETES);
  const a = ecritures.find((e) => e.id === 'profil-a');
  assert.deepEqual(a, { collection: 'profils', id: 'profil-a', mode: 'update', donnees: { regles: SANS_VIANDE }, condition: { reglesAbsentes: true } });
  assert.deepEqual(r.resume.reglesRemises, ['Adulte A']);
  assert.deepEqual(r.resume.profilsRemis, ['Adulte B']);
  // À l'envoi : écrites seulement si le profil n'a toujours pas de règles.
  assert.deepEqual(appliquerConditions(a, { ...ADULTE_A }), a);
  assert.equal(appliquerConditions(a, { ...ADULTE_A, regles: [] }), null);
  assert.equal(appliquerConditions(a, { ...ADULTE_A, regles: NI_POISSON }), null);
  assert.equal(appliquerConditions(a, null), null);
  assert.equal(contientUndefined(r.lots), false);
});

test('restauration : un profil qui a des règles (même []) n’est jamais touché', () => {
  const v = relire([{ ...ADULTE_A, regles: SANS_VIANDE }, { ...ADULTE_B, regles: NI_POISSON }]);
  const r = preparerRestauration(v, { plats: [], profils: [{ ...ADULTE_A, regles: [] }, { ...ADULTE_B, regles: SANS_VIANDE }] });
  assert.equal(r.rien, true);
  assert.deepEqual(r.resume.reglesRemises, []);
  // Fichier sans règles pour un profil présent sans règles : rien.
  const sans = preparerRestauration(relire([ADULTE_A]), { plats: [], profils: [ADULTE_A] });
  assert.equal(sans.rien, true);
});

// ——— roles.js ———

test('route regime : réservée au gestionnaire, refusée en aperçu, repli sur Réglages', () => {
  assert.equal(routeAutorisee('regime', 'gestionnaire'), true);
  assert.equal(routeAutorisee('regime', 'courses'), false);
  assert.equal(resoudreRoute('#/regime/profil-b', 'gestionnaire'), 'regime');
  assert.equal(resoudreRoute('#/regime/profil-b', 'courses'), 'semaine'); // aperçu « Repas et courses » : rôle effectif
  assert.equal(resoudreRoute('#/regime/', 'gestionnaire'), 'reglages');
  assert.equal(resoudreRoute('#/regime', 'gestionnaire'), 'reglages');
  assert.equal(resoudreRoute('#/regime/Majuscules', 'gestionnaire'), 'reglages');
  assert.equal(resoudreRoute('#/regime/', 'courses'), 'semaine');
  assert.equal(resoudreRoute('#/regime/profil-x', 'gestionnaire', { profils: PROFILS }), 'reglages');
  assert.equal(resoudreRoute('#/regime/profil-b', 'gestionnaire', { profils: PROFILS }), 'regime');
  assert.equal(parametreDe('#/regime/profil-b', 'regime'), 'profil-b');
  // Rien ne change pour les fiches.
  assert.equal(resoudreRoute('#/plat/', 'gestionnaire'), 'plats');
  assert.equal(resoudreRoute('#/modifier/', 'courses'), 'plats');
});
