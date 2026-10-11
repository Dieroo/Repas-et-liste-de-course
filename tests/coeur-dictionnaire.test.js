// T3-0 « Produits courants » : vérifications automatiques du dictionnaire (js/coeur/dictionnaire.js), plan §6.2, points
// 1 à 12 : validité, forme et rôle, repères de préparation, unicité des clés, homographes, cohérence avec les mots qui
// annoncent un repère (reperesAttendus), garde-fous de l'adulte sans viande, faux amis, lait cru, ids figés, couverture
// (exemples, fixtures, corpus figé), budget ; T3a : 13, placard de départ (familles « toujours à la maison », seuils
// gardés) ; 14, écritures courantes. Données génériques : aucune donnée du foyer.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { cleProduit, motsAccentues, slug } from '../js/coeur/slug.js';
import {
  MARQUEURS_PRECAUTION, SOUS_TYPES_VIANDE, VIANDES, marqueursEffectifs, validerIngredient,
} from '../js/coeur/vocabulaire.js';
import { reperesAttendus } from '../js/coeur/compatibilite.js';
import {
  MARQUEURS_PREPARATION, UNITES_EDITION, ingredientSaisi, natureProposee, reperesProposes,
} from '../js/coeur/edition.js';
import { DICTIONNAIRE } from '../js/coeur/dictionnaire.js';
import { HOMOGRAPHES, idProduit, natureDe, reconnaitre } from '../js/coeur/produits.js';
import { VOCABULAIRES } from '../js/coeur/vocabulaire.js';
import { dansLePlacard, listeDeCourses, versBase } from '../js/coeur/liste.js';
import { IDS_DICTIONNAIRE } from './donnees/ids-dictionnaire.js';
import { CORPUS_INGREDIENTS } from './donnees/corpus-ingredients.js';
import { AJOUTEES_AVANT, FORMES_AVANT } from './donnees/formes-avant-placard.js';

const lire = (chemin) => readFileSync(fileURLToPath(new URL(`../${chemin}`, import.meta.url)), 'utf8');

/**
 * Budget du fichier (octets UTF-8) : ~117 octets par entrée mesurés sur les 50 premières ; ~70 Ko pour ~580 entrées.
 * La marge sert aux champs de T3 (placard et équivalences en T3a, produits hors cuisine en T3d).
 */
const BUDGET_OCTETS = 90_000;

const CHAMPS = ['id', 'nom', 'rayon', 'unite', 'marqueurs', 'forme', 'role', 'alias', 'placard', 'equivalences'];
/** Charcuteries qui ne sont pas de porc (point 2) : bœuf séché, merguez (bœuf et mouton), volaille. */
const CHARCUTERIE_SANS_PORC = new Set(['bresaola', 'viande des grisons', 'merguez', 'saucisse de volaille', 'blanc de dinde']);
/** Noms ambigus, jamais une forme du dictionnaire (la question « C'est… ? » reste). */
const AMBIGUS = ['pâte', 'pâté', 'pâtés', 'pate', 'crème', 'fromage', 'bouillon', 'steak', 'saucisse', 'farce'];

/** Noms puis autres écritures d'une entrée. */
const formes = (entree) => [entree.nom, ...(entree.alias ?? [])];
/** Toutes les formes du dictionnaire, avec leur entrée. */
const TOUTES = DICTIONNAIRE.flatMap((entree) => formes(entree).map((forme) => ({ forme, entree })));
/** Mots d'une forme sans accents ni pluriel (clés de mots de cleProduit). */
const motsCles = (texte) => cleProduit(texte).split('-').filter(Boolean);
/** Vrai si la suite de mots (clés) contient l'expression (clés), mots entiers. */
function contient(mots, expression) {
  const cherches = motsCles(expression);
  for (let i = 0; i + cherches.length <= mots.length; i += 1) {
    if (cherches.every((mot, k) => mots[i + k] === mot)) return true;
  }
  return false;
}
/** Marqueurs d'une entrée triés, pour comparer. */
const tries = (marqueurs) => [...(marqueurs ?? [])].sort();

// ——— 1 à 5 ———

test('1. chaque entrée est un ingrédient valide, sans erreur ni avertissement', () => {
  for (const entree of DICTIONNAIRE) {
    const messages = [];
    let inconnu = false;
    const brut = { produit: entree.nom, qte: 1, unite: entree.unite, rayon: entree.rayon, marqueurs: entree.marqueurs ?? [] };
    if (entree.forme) brut.forme = entree.forme;
    if (entree.role) brut.role = entree.role;
    const ingredient = validerIngredient(brut, {
      position: { affiche: entree.id, claude: entree.id }, champQte: 'qte',
      signaler: (message) => messages.push(message), inconnu: () => { inconnu = true; }, prevenir: (message) => messages.push(message),
    });
    assert.deepEqual(messages, [], entree.id);
    assert.equal(inconnu, false, entree.id);
    assert.ok(ingredient, entree.id);
    // Valeurs déjà propres : rien à corriger à la lecture.
    assert.deepEqual(ingredient, brut, entree.id);
    assert.equal(entree.nom, entree.nom.toLocaleLowerCase('fr-FR').replace(/\s+/g, ' ').trim(), `${entree.id} : nom en minuscules`);
    for (const alias of entree.alias ?? []) assert.equal(alias, alias.toLocaleLowerCase('fr-FR').replace(/\s+/g, ' ').trim(), alias);
    // Apostrophes droites, comme Claude les écrit ; jamais d'espace insécable.
    for (const forme of formes(entree)) assert.equal(/[’\u00A0\u202F]/.test(forme), false, `« ${forme} » : apostrophe droite, espaces simples`);
    assert.deepEqual(Object.keys(entree).filter((cle) => !CHAMPS.includes(cle)), [], entree.id);
    // Listes vides omises.
    if ('marqueurs' in entree) assert.ok(entree.marqueurs.length > 0, `${entree.id} : marqueurs vides à omettre`);
    if ('alias' in entree) assert.ok(entree.alias.length > 0, `${entree.id} : alias vides à omettre`);
    assert.ok(Object.isFrozen(entree), entree.id);
  }
  assert.ok(Object.isFrozen(DICTIONNAIRE));
});

test('2. unité de l’écran ; forme si et seulement si viande ; rôle si et seulement si légume ; sous-types', () => {
  for (const entree of DICTIONNAIRE) {
    const marqueurs = entree.marqueurs ?? [];
    const viande = marqueurs.some((m) => VIANDES.includes(m));
    assert.ok(UNITES_EDITION.includes(entree.unite), entree.id);
    assert.equal(Boolean(entree.forme), viande, `${entree.id} : forme si et seulement si viande`);
    assert.equal(Boolean(entree.role), marqueurs.includes('legume'), `${entree.id} : rôle si et seulement si légume`);
    // Légumes « fondus dans le plat » partout (choix du plan) : la recette dit s'il est bien visible.
    if (entree.role) assert.equal(entree.role, 'incorpore', entree.id);
    if (marqueurs.some((m) => SOUS_TYPES_VIANDE.includes(m))) assert.ok(marqueurs.includes('viande'), `${entree.id} : sous-type sans viande`);
    // Une viande porte son sous-type, sauf l'escargot et la grenouille (`viande` seul).
    if (viande && !['escargot', 'cuisse de grenouille'].includes(entree.nom)) {
      assert.ok(marqueurs.some((m) => SOUS_TYPES_VIANDE.includes(m) && m !== 'charcuterie'), `${entree.id} : sous-type de viande attendu`);
    }
    if (marqueurs.includes('charcuterie') && !CHARCUTERIE_SANS_PORC.has(entree.nom)) {
      assert.ok(marqueurs.includes('viande') && marqueurs.includes('porc'), `${entree.id} : charcuterie sans viande ni porc`);
    }
  }
  // Les exceptions nommées existent et sont bien des charcuteries.
  for (const nom of CHARCUTERIE_SANS_PORC) {
    const entree = DICTIONNAIRE.find((e) => e.nom === nom);
    assert.ok(entree?.marqueurs.includes('charcuterie') && !entree.marqueurs.includes('porc'), nom);
  }
});

test('3. aucun repère de préparation (cru, œuf cru, alcool non cuit)', () => {
  for (const entree of DICTIONNAIRE) {
    assert.deepEqual((entree.marqueurs ?? []).filter((m) => MARQUEURS_PREPARATION.includes(m)), [], entree.id);
  }
});

test('4. unicité : les clés de tous les noms et autres écritures sont uniques ; ids uniques, tirés du nom', () => {
  const vues = new Map();
  const conflits = [];
  for (const { forme, entree } of TOUTES) {
    const cle = cleProduit(forme);
    assert.ok(cle, `${entree.id} : « ${forme} » sans clé`);
    if (vues.has(cle)) conflits.push(`« ${vues.get(cle)} » et « ${forme} » (${cle})`);
    else vues.set(cle, forme);
  }
  assert.deepEqual(conflits, [], 'deux formes du dictionnaire ont la même clé');
  const ids = DICTIONNAIRE.map((entree) => entree.id);
  assert.equal(new Set(ids).size, ids.length, 'ids en double');
  for (const entree of DICTIONNAIRE) {
    assert.match(entree.id, /^[a-z0-9]+(-[a-z0-9]+)*$/, entree.id);
    // À la création, id = cleProduit(nom) ; un nom corrigé plus tard garde son id (ancien nom en alias).
    assert.ok(entree.id === cleProduit(entree.nom) || (entree.alias ?? []).some((alias) => cleProduit(alias) === entree.id),
      `${entree.id} : id tiré du nom (gardez l’id, mettez l’ancien nom en alias)`);
  }
});

test('4. les noms ambigus ne sont jamais une forme du dictionnaire', () => {
  const ecritures = new Set(TOUTES.map(({ forme }) => motsAccentues(forme).join(' ')));
  for (const ambigu of AMBIGUS) {
    for (const ecriture of [ambigu, `${ambigu}s`]) {
      if (ecriture === 'pâtes' || ecriture === 'pates') continue; // des pâtes (décision du propriétaire)
      assert.equal(ecritures.has(ecriture), false, `« ${ecriture} » est ambigu : hors du dictionnaire`);
    }
    const r = reconnaitre(ambigu);
    assert.ok(r === null || r.ambigu === true, ambigu);
  }
});

/**
 * Mots dont deux accentuations ont le même sens, sans produit à confondre : jamais à ajouter à HOMOGRAPHES (la
 * saisie sans accent reste reconnue, et l'identifiant d'un nom inconnu qui les contient ne change pas). « Sucre
 * vanillé » / « extrait de vanille » ; « pâtes sèches » / « thym séché » (sec, dans les deux cas).
 */
const ACCENTUATIONS_SANS_RISQUE = new Set(['vanille', 'seche']);
/**
 * Saisies hors du dictionnaire dont la clé, accents ôtés, serait celle d'un autre produit : comptées comme des formes
 * pour le calcul des homographes, elles font échouer le point 5 si ce produit entre au dictionnaire sans que sa clé
 * soit dans HOMOGRAPHES. « Pralines » (amandes entières enrobées de sucre : fruits à coque) n'est pas « praliné » (une
 * pâte, sans repère) : lu comme du praliné, la précaution des fruits à coque disparaîtrait sans rien dire.
 */
const AUTRES_ACCENTUATIONS = ['pralines'];

test('5. homographes : toute clé de mot écrite avec deux accentuations est dans HOMOGRAPHES', () => {
  const parCle = new Map();
  // Les formes du dictionnaire, plus les noms ambigus laissés dehors (« pâte », « pâté ») et les autres accentuations.
  for (const forme of [...TOUTES.map((t) => t.forme), ...AMBIGUS, ...AUTRES_ACCENTUATIONS]) {
    const cles = cleProduit(forme).split('-');
    motsAccentues(forme, { pluriel: false }).forEach((mot, i) => {
      if (!parCle.has(cles[i])) parCle.set(cles[i], new Map());
      if (!parCle.get(cles[i]).has(mot)) parCle.get(cles[i]).set(mot, forme);
    });
  }
  const manquants = [...parCle]
    .filter(([cle, mots]) => mots.size > 1 && !HOMOGRAPHES.has(cle) && !ACCENTUATIONS_SANS_RISQUE.has(cle))
    .map(([cle, mots]) => `${cle} : ${[...mots.values()].map((f) => `« ${f} »`).join(' / ')}`);
  assert.deepEqual(manquants, [], 'ajoutez ces clés à HOMOGRAPHES (js/coeur/produits.js)');
  assert.ok(parCle.get('pate').size >= 2, 'pâte et pâté forment une paire');
  for (const cle of ACCENTUATIONS_SANS_RISQUE) assert.ok(parCle.get(cle)?.size > 1, `${cle} : exception devenue inutile`);
  // Paires de formes entières (plan §4.2) : même clé, accents différents → la clé touche un homographe.
  const formesParCle = new Map();
  for (const forme of [...TOUTES.map((t) => t.forme), ...AMBIGUS, ...AUTRES_ACCENTUATIONS]) {
    const cle = cleProduit(forme);
    if (!formesParCle.has(cle)) formesParCle.set(cle, new Set());
    formesParCle.get(cle).add(motsAccentues(forme, { pluriel: false }).join(' '));
  }
  for (const [cle, ecritures] of formesParCle) {
    if (ecritures.size > 1) assert.ok(cle.split('-').some((mot) => HOMOGRAPHES.has(mot)), `${cle} : ${[...ecritures].join(' / ')}`);
  }
  // Chaque clé de HOMOGRAPHES est une clé de mot (pas de tiret, déjà réduite).
  for (const cle of HOMOGRAPHES) assert.equal(cleProduit(cle), cle);
  for (const cle of HOMOGRAPHES) assert.equal(slug(cle), cle);
});

// ——— 6. Cohérence avec les mots qui annoncent un repère ———

/**
 * Repères de précaution portés sans que le nom les annonce (reperesAttendus), voulus : le dictionnaire en sait plus que
 * les mots. `lait_cru` n'y figure pas : il est couvert par la liste « dans le doute » du point 9.
 */
const REPERES_NON_ANNONCES = new Map([
  ["pain d'épices", ['miel']], // toujours au miel
  ['siki', ['poisson_predateur']], // requin (ANSES), le mot n'est pas dans MOTS_DOUTEUX
  ['lamproie', ['poisson_predateur']],
  ['bouillon de poule', ['bouillon_viande']], // « poule » ne suit pas « bouillon » dans MOTS_DOUTEUX
]);

test('6. cohérence avec reperesAttendus, dans les deux sens, pour chaque nom et chaque autre écriture', () => {
  const ecarts = [];
  const utilisees = new Set();
  for (const { forme, entree } of TOUTES) {
    const effectifs = marqueursEffectifs(entree);
    const annonces = reperesAttendus(forme).filter((m) => !MARQUEURS_PREPARATION.includes(m));
    // a. Ce que le nom annonce, le produit le porte (sinon une précaution disparaîtrait avec le produit connu).
    for (const m of annonces) if (!effectifs.has(m)) ecarts.push(`« ${forme} » : ${m} annoncé par le nom, absent`);
    // b. Un repère de précaution porté (autre que lait_cru) est annoncé par le nom, lui ou ce qu'il implique
    //    (`gelatine_porc` → gélatine animale, `cafe` → caféine), sinon il figure dans les exceptions nommées.
    const annoncesEffectifs = marqueursEffectifs({ marqueurs: annonces });
    const exceptions = REPERES_NON_ANNONCES.get(forme) ?? [];
    for (const m of (entree.marqueurs ?? []).filter((x) => MARQUEURS_PRECAUTION.includes(x) && x !== 'lait_cru')) {
      if ([...marqueursEffectifs({ marqueurs: [m] })].some((x) => annoncesEffectifs.has(x))) continue;
      if (exceptions.includes(m)) utilisees.add(forme);
      else ecarts.push(`« ${forme} » : ${m} porté sans être annoncé par le nom (exception à nommer)`);
    }
    // c. La nature que le nom laisse attendre, si elle existe, est celle du produit.
    const annoncee = natureProposee(forme)?.nature;
    if (annoncee && annoncee !== natureDe(entree)) ecarts.push(`« ${forme} » : nature ${natureDe(entree)}, le nom annonce ${annoncee}`);
  }
  assert.deepEqual(ecarts, []);
  assert.deepEqual([...REPERES_NON_ANNONCES.keys()].filter((forme) => !utilisees.has(forme)), [], 'exceptions devenues inutiles');
});

// ——— 7. Garde-fous pour l'adulte sans viande ———

/** Mots carnés, comparés avec leurs accents et sans pluriel (« pâtes » ne contient pas « pâté »). */
const MOTS_CARNES = ['boeuf', 'veau', 'porc', 'poulet', 'dinde', 'canard', 'agneau', 'lapin', 'jambon', 'lardon', 'saucisse',
  'saucisson', 'chorizo', 'bacon', 'pâté', 'rillette', 'merguez', 'escargot', 'grenouille', 'gésier', 'foie'];
/** Formes qui contiennent un mot carné sans être de la viande : le repère attendu à la place. */
const LISTE_BLANCHE_CARNEE = new Map([
  ['bouillon de bœuf', 'bouillon_viande'], ['cube de bouillon de bœuf', 'bouillon_viande'], ['bouillon de poulet', 'bouillon_viande'],
  ['fond de veau', 'bouillon_viande'], ['graisse de canard', 'graisse_animale'], ['gélatine de porc', 'gelatine_animale'],
  ['gélatine de bœuf', 'gelatine_animale'],
  // Écritures courantes du 2026-10-11 : des bouillons, jamais de la viande.
  ['cube de bouillon de poulet', 'bouillon_viande'], ['bouillon de poulet en cube', 'bouillon_viande'],
  ['bouillon de bœuf en cube', 'bouillon_viande'], ['bouillon cube de bœuf', 'bouillon_viande'],
  ['bouillon de bœuf déshydraté', 'bouillon_viande'], ['bouillon de bœuf en poudre', 'bouillon_viande'],
  ['fond de veau déshydraté', 'bouillon_viande'], ['fond de veau en poudre', 'bouillon_viande'],
]);
/** Mots de poisson ou de fruits de mer (clés de mots, sans accents ni pluriel). */
const MOTS_POISSON = ['poisson', 'saumon', 'thon', 'cabillaud', 'colin', 'lieu', 'merlu', 'lotte', 'sole', 'dorade', 'daurade',
  'bar', 'truite', 'maquereau', 'sardine', 'hareng', 'haddock', 'morue', 'anchois', 'espadon', 'requin', 'marlin', 'siki',
  'lamproie', 'surimi', 'tarama', 'crevette', 'gambas', 'langoustine', 'moule', 'palourde', 'huître', 'jacques', 'calamar',
  'calmar', 'encornet', 'seiche', 'poulpe', 'crabe'].map(cleProduit);
/** Charcuteries crues ou sèches : `cru` proposé d'après le nom, même pour un produit connu. */
const CHARCUTERIES_CRUES = ['chorizo', 'rosette', 'saucisson sec', 'serrano', 'pancetta', 'grisons', 'lonzo', 'coppa', 'bresaola',
  'jambon cru', 'jambon de bayonne', 'jambon de parme'];

test('7. garde-fous de l’adulte sans viande : viande, poisson, gélatine, bouillon, charcuterie crue', () => {
  const ecarts = [];
  const blanches = new Set();
  for (const { forme, entree } of TOUTES) {
    const effectifs = marqueursEffectifs(entree);
    const accentues = motsAccentues(forme, { pluriel: false });
    const mots = motsCles(forme);
    if (MOTS_CARNES.some((mot) => accentues.includes(mot)) && !effectifs.has('viande')) {
      const attendu = LISTE_BLANCHE_CARNEE.get(forme);
      if (attendu && effectifs.has(attendu)) blanches.add(forme);
      else ecarts.push(`« ${forme} » : mot carné sans viande`);
    }
    if (mots.some((mot) => MOTS_POISSON.includes(mot)) && !effectifs.has('poisson') && !effectifs.has('fruits_de_mer')) {
      ecarts.push(`« ${forme} » : mot de poisson sans poisson ni fruits de mer`);
    }
    if (mots.includes('gelatine') && !mots.some((mot) => ['vegetal', 'vegetale'].includes(mot)) && !effectifs.has('gelatine_animale')) {
      ecarts.push(`« ${forme} » : gélatine sans gélatine animale`);
    }
    const bouillon = mots.includes('bouillon') && !mots.includes('legume');
    const fond = ['veau', 'volaille', 'blanc', 'brun', 'boeuf', 'gibier'].some((suite) => contient(mots, `fond de ${suite}`) || contient(mots, `fond ${suite}`));
    if ((bouillon || fond) && !effectifs.has('bouillon_viande') && !effectifs.has('poisson')) {
      ecarts.push(`« ${forme} » : bouillon ou fond sans bouillon de viande ni poisson`);
    }
    if (CHARCUTERIES_CRUES.some((expression) => contient(mots, expression))) {
      if (!effectifs.has('viande')) ecarts.push(`« ${forme} » : charcuterie sans viande`);
      if (!reperesProposes(forme, { connu: true }).includes('cru')) ecarts.push(`« ${forme} » : « cru » non proposé d'après le nom`);
    }
  }
  assert.deepEqual(ecarts, []);
  assert.deepEqual([...LISTE_BLANCHE_CARNEE.keys()].filter((forme) => !blanches.has(forme)), [], 'liste blanche à jour');
  // « fond de tarte » n'est pas un fond de viande ; chaque charcuterie crue de la liste est bien connue.
  assert.deepEqual(reconnaitre('fond de tarte').element.marqueurs, []);
  for (const nom of ['chorizo', 'rosette', 'saucisson sec', 'jambon serrano', 'pancetta', 'viande des grisons', 'lonzo', 'coppa',
    'bresaola', 'jambon cru', 'jambon de bayonne', 'jambon de parme']) {
    assert.equal(reconnaitre(nom)?.origine, 'dictionnaire', nom);
  }
  // Au pluriel, chaque mot compris : la même entrée, `cru` toujours proposé d'après le nom.
  for (const nom of ['jambons crus', 'saucissons secs', 'jambons de bayonne', 'viande de grison']) {
    assert.equal(reconnaitre(nom)?.origine, 'dictionnaire', nom);
    assert.ok(reperesProposes(nom, { connu: true }).includes('cru'), nom);
  }
});

// ——— 8. Faux amis ———

/** Noms trompeurs et ce que l'app doit en comprendre (marqueurs exacts). */
const FAUX_AMIS = {
  pâtes: ['feculent'],
  pates: ['feculent'],
  'pâtes fraîches': ['feculent'],
  'pâté de campagne': ['viande', 'porc', 'charcuterie'],
  'pâte feuilletée': [],
  'pâte brisée': [],
  'fond de tarte': [],
  "pâte d'amande": [],
  'lait de coco': [],
  'crème de coco': [],
  'noix de coco': [],
  'noix de coco râpée': [],
  'noix de muscade': [],
  'noix de saint-jacques': ['fruits_de_mer'],
  'noix de veau': ['viande', 'boeuf'],
  'pomme noisette': ['feculent'],
  "poudre d'amande": [],
  'beurre de cacahuète': [],
  "lait d'amande": [],
  'huile de noix': [],
  'crème de marrons': [],
  châtaigne: [],
  'sauce soja': [],
  'pousse de soja': ['legume'],
  'germe de soja': ['legume'],
  tofu: ['soja'],
  'lait de soja': ['soja'],
  'steak de soja': ['soja'],
  seitan: [],
  'fumet de poisson': ['poisson'],
  'bouillon de volaille': ['bouillon_viande'],
  'bouillon de poule': ['bouillon_viande'],
  'bouillon de légumes': [],
  'fond de veau': ['bouillon_viande'],
  'graisse de canard': ['graisse_animale'],
  saindoux: ['graisse_animale'],
  beurre: ['laitier'],
  lait: ['laitier'],
  gélatine: ['gelatine_animale', 'gelatine_porc'],
  'gélatine végétale': [],
  'agar-agar': [],
  'sauce worcestershire': ['poisson'],
  'nuoc-mâm': ['poisson'],
  thon: ['poisson'],
  espadon: ['poisson', 'poisson_predateur'],
  escargots: ['viande'],
  'cuisses de grenouille': ['viande'],
  mayonnaise: ['oeuf'],
  'chocolat noir': [],
  'cacao en poudre': [],
  café: ['cafe'],
  thé: ['cafeine'],
  "pain d'épices": ['miel'],
  'pomme de terre': ['feculent'],
  'patate douce': ['feculent'],
  'maïs doux': ['feculent'],
  'petits pois': ['legume'],
  'vin blanc': [],
  rhum: [],
  'sauce de poisson': ['poisson'], // nuoc-mâm
  pignons: ['fruit_coque'],
};

/** Absents voulus : un nom trompeur que l'app ne saurait pas lire sans se tromper ; la question reste. */
const ABSENTS_VOULUS = [
  'tapenade', // souvent des anchois, pas toujours
  'saucisse végétale', // « saucisse » annonce une viande (MOTS_DOUTEUX)
  'tomate cœur de bœuf', // « bœuf » annonce une viande (MOTS_DOUTEUX)
  'jambon de pays', 'salami', // charcuteries crues que MOTS_DOUTEUX ne signale pas (« cru » non proposé)
  'pâte de curry', // parfois à la crevette
  'lasagnes', 'cannelloni', 'ravioli', 'wrap', // feuilles ou plat tout prêt (souvent à la viande) ?
  'jambon', 'bouillon cube', 'fruits de mer', 'pecorino',
  'praliné', 'pralines', 'praline', // la pâte et les amandes enrobées de sucre (fruits à coque) ont la même clé
];

test('8. faux amis : ce que l’app comprend des noms trompeurs', () => {
  for (const [nom, attendus] of Object.entries(FAUX_AMIS)) {
    const r = reconnaitre(nom);
    assert.equal(r?.origine, 'dictionnaire', nom);
    assert.deepEqual(tries(r.element.marqueurs), tries(attendus), nom);
  }
  for (const nom of ABSENTS_VOULUS) assert.equal(reconnaitre(nom), null, nom);
  // Charcuterie sèche : `cru` proposé d'après le nom (case cochée si une règle le surveille).
  for (const nom of ['chorizo', 'rosette']) {
    assert.ok(ingredientSaisi({ produit: nom, qte: 1, unite: 'g' }, { dictionnaire: true }).ingredient.marqueurs.includes('cru'), nom);
  }
  // Le thon n'est pas un poisson prédateur ; l'œuf de la mayonnaise du commerce n'est pas cru.
  assert.equal(reconnaitre('thon au naturel').element.marqueurs.includes('poisson_predateur'), false);
});

// ——— 9. Lait cru ———

/** Pâtes pressées cuites : jamais `lait_cru`, même au lait cru (exception officielle). */
const PATES_PRESSEES_CUITES = ['comté', 'beaufort', 'emmental', 'gruyère', 'parmesan', 'grana padano'];
/** Fromages souvent au lait cru, marqués « dans le doute » (décision du propriétaire, 2026-10-10). */
const DANS_LE_DOUTE = ['camembert', 'brie', 'reblochon', "mont-d'or", 'saint-nectaire', 'morbier', 'tomme', 'chèvre', 'roquefort',
  'raclette', 'munster', 'vacherin'];

test('9. lait cru : jamais sur les pâtes pressées cuites, toujours sur les fromages « dans le doute »', () => {
  for (const { forme, entree } of TOUTES) {
    const mots = motsCles(forme);
    const marqueurs = entree.marqueurs ?? [];
    if (PATES_PRESSEES_CUITES.some((nom) => contient(mots, nom))) assert.equal(marqueurs.includes('lait_cru'), false, forme);
    if (DANS_LE_DOUTE.some((nom) => contient(mots, nom))) assert.ok(marqueurs.includes('lait_cru'), forme);
    if (marqueurs.includes('lait_cru')) {
      assert.ok(marqueurs.includes('laitier'), `${forme} : lait cru sans laitier`);
      assert.ok(['fromages', 'cremerie'].includes(entree.rayon), forme);
    }
  }
  for (const nom of [...PATES_PRESSEES_CUITES, 'comté râpé', 'parmesan râpé', 'gruyère râpé', 'emmental râpé']) {
    const r = reconnaitre(nom);
    assert.equal(r?.origine, 'dictionnaire', nom);
    assert.deepEqual(tries(r.element.marqueurs), ['laitier'], nom);
  }
  for (const nom of DANS_LE_DOUTE) {
    const r = reconnaitre(nom);
    assert.equal(r?.origine, 'dictionnaire', nom);
    assert.deepEqual(tries(r.element.marqueurs), ['lait_cru', 'laitier'], nom);
  }
});

// ——— 10. Ids figés ———

test('10. ids figés : un id livré ne disparaît jamais ; tout id est listé', () => {
  const ids = new Set(DICTIONNAIRE.map((entree) => entree.id));
  const disparus = IDS_DICTIONNAIRE.filter((id) => !ids.has(id));
  assert.deepEqual(disparus, [], 'id livré disparu : gardez l’id, mettez l’ancien nom en alias');
  const livres = new Set(IDS_DICTIONNAIRE);
  assert.equal(livres.size, IDS_DICTIONNAIRE.length, 'ids livrés en double');
  const nouveaux = [...ids].filter((id) => !livres.has(id));
  assert.deepEqual(nouveaux, [], 'ajoutez ces ids à tests/donnees/ids-dictionnaire.js (ids livrés)');
  assert.ok(Object.isFrozen(IDS_DICTIONNAIRE));
});

// ——— 11. Couverture ———

/**
 * Produits écrits à la main en plus de ceux des fixtures (casse et accents de saisie) : ils doivent être reconnus.
 */
const AUTRES_SAISIES = ['marsala sec', 'café fort', 'café soluble', 'sel fin', 'gros sel', 'lardon fumé', 'lardons fumés', 'œufs',
  'echalote', 'gélatine en feuilles', 'crevette décortiquée', 'vin blanc sec', 'Sel FIN', 'Riz ARBORIO', 'Pave de saumon',
  'Oignon Jaune'];

/**
 * Noms des fixtures de tests/ qui ne sont pas des produits courants, chacun avec sa raison : tout autre nom des
 * fixtures doit être reconnu. Les saisies d'essai de moins de deux lettres (« x », « !!! ») et les messages (texte qui
 * finit par un point) sont écartés par règle (voir produitsDesFixtures).
 */
const HORS_FIXTURES = new Map([
  ['tomate farcie', 'plat'], ['courgette au thon', 'plat'], ['carpaccio de courgettes', 'plat'],
  ['tartare de saumon', 'plat'], ['fond de veau au miel', 'nom inventé pour un essai de repères'],
  ['jambon', 'ambigu exprès : cuit ou cru'], ['rôti', 'ambigu exprès : la viande n’est pas dite'],
  ['crème', 'ambigu exprès'], ['fromage', 'ambigu exprès'], ['tartare', 'ambigu exprès : viande ou poisson'],
  ['pâte', 'homographe exprès (T3a : clé de repli)'], ['pâté', 'homographe exprès (T3a : clé de repli)'],
  ['pate', 'homographe exprès (T3a : clé de repli)'], ['the', 'thé sans accent, exprès (T3a : clé de repli)'],
  ['pate brisee', 'pâte brisée sans accents, exprès (T3a : clé de repli)'],
]);

/**
 * Produits des fixtures, tirés des fichiers de tests eux-mêmes (`produit: '…'`, `"produit": "…"`, `ing('…'`), sauf
 * ceux du dictionnaire et des produits courants ; sans les saisies d'essai (moins de deux lettres) ni les messages
 * (texte qui finit par un point). → Map nom → fichier
 */
function produitsDesFixtures() {
  const dossier = fileURLToPath(new URL('./', import.meta.url));
  const noms = new Map();
  const motifs = [/produit:\s*'((?:[^'\\]|\\.)*)'/g, /"produit":\s*"((?:[^"\\]|\\.)*)"/g, /produit:\s*"((?:[^"\\]|\\.)*)"/g,
    /\bing\(\s*'((?:[^'\\]|\\.)*)'/g];
  for (const fichier of readdirSync(dossier).filter((f) => f.endsWith('.test.js') && !/dictionnaire|produits/.test(f)).sort()) {
    const texte = readFileSync(`${dossier}${fichier}`, 'utf8');
    for (const motif of motifs) {
      for (const [, brut] of texte.matchAll(motif)) {
        const nom = brut.replace(/\\(['"])/g, '$1');
        if (cleProduit(nom).replace(/-/g, '').length < 2 || /\.\s*$/.test(nom)) continue;
        if (!noms.has(nom)) noms.set(nom, fichier);
      }
    }
  }
  return noms;
}

/** Produits des exemples JSON d'un fichier (`"produit": "…"`). */
const produitsDesExemples = (texte) => [...texte.matchAll(/"produit":\s*"([^"]+)"/g)].map((m) => m[1]);
const nonReconnus = (noms) => noms.filter((nom) => reconnaitre(nom)?.origine !== 'dictionnaire');

test('11. couverture : exemples des instructions et de CLAUDE.md, fixtures, corpus figé (90 % au moins)', () => {
  const exemples = [...new Set([...produitsDesExemples(lire('docs/projet-claude.md')), ...produitsDesExemples(lire('CLAUDE.md'))])];
  assert.ok(exemples.length >= 20, 'exemples introuvables');
  assert.deepEqual(nonReconnus(exemples), [], 'produits des exemples non reconnus');
  const fixtures = produitsDesFixtures();
  assert.ok(fixtures.size >= 100, `fixtures introuvables (${fixtures.size})`);
  const aReconnaitre = [...[...fixtures.keys()].filter((nom) => !HORS_FIXTURES.has(nom)), ...AUTRES_SAISIES];
  assert.deepEqual(nonReconnus(aReconnaitre).map((nom) => `${nom} (${fixtures.get(nom) ?? 'AUTRES_SAISIES'})`), [],
    'produits des fixtures non reconnus : ajoutez-les au dictionnaire, ou à HORS_FIXTURES avec leur raison');
  // Chaque exclusion sert encore : présente dans les fixtures, et non reconnue.
  assert.deepEqual([...HORS_FIXTURES.keys()].filter((nom) => !fixtures.has(nom) || reconnaitre(nom)?.origine === 'dictionnaire'), [],
    'exclusions devenues inutiles');
  const absents = nonReconnus(CORPUS_INGREDIENTS);
  const taux = 1 - absents.length / CORPUS_INGREDIENTS.length;
  assert.ok(taux >= 0.9, `corpus reconnu à ${Math.round(taux * 100)} % ; non reconnus : ${absents.join(', ')}`);
  // Chaque nom reconnu s'enregistre sans question de nature.
  for (const nom of [...exemples, ...aReconnaitre, ...CORPUS_INGREDIENTS].filter((n) => reconnaitre(n)?.origine === 'dictionnaire')) {
    assert.equal(ingredientSaisi({ produit: nom, qte: 1, unite: 'g' }, { dictionnaire: true }).erreurs, undefined, nom);
  }
});

// ——— 12. Budget ———

test('12. budget : le fichier reste léger ; les deux modules sont dans le précache', () => {
  const taille = statSync(fileURLToPath(new URL('../js/coeur/dictionnaire.js', import.meta.url))).size;
  assert.ok(taille <= BUDGET_OCTETS, `dictionnaire.js pèse ${taille} octets, au-delà du budget de ${BUDGET_OCTETS}`);
  const sw = lire('sw.js');
  for (const chemin of ['./js/coeur/dictionnaire.js', './js/coeur/produits.js']) assert.ok(sw.includes(`'${chemin}'`), chemin);
});

// ——— 13. Placard de départ et équivalences (T3a) ———

/**
 * Placard de départ (CLAUDE.md §9.9 ; décision du propriétaire du 2026-10-11, qui remplace les seuils de T3a pour ces
 * familles) : les produits qui durent plusieurs semaines sont TOUJOURS à la maison (`{}`), par familles entières :
 * jamais ajoutés d'eux-mêmes à la liste, listés dans « Déjà à la maison ? », « À racheter » d'un toucher.
 */
const TOUJOURS = {
  huiles: ['huile', 'huile-d-olive', 'huile-neutre', 'huile-de-tournesol', 'huile-de-colza', 'huile-de-sesame', 'huile-de-noi',
    'huile-d-arachide', 'huile-de-pepin-de-raisin', 'huile-de-coco', 'huile-de-noisette'],
  vinaigres: ['vinaigre', 'vinaigre-de-vin', 'vinaigre-de-vin-rouge', 'vinaigre-de-vin-blanc', 'vinaigre-balsamique',
    'vinaigre-balsamique-blanc', 'vinaigre-de-cidre', 'vinaigre-de-xere', 'vinaigre-de-riz', 'vinaigre-blanc',
    'vinaigre-de-framboise'],
  'sauces en bouteille': ['sauce-soja', 'tamari', 'nuoc-mam', 'sauce-worcestershire', 'sauce-d-huitre', 'mirin',
    'sauce-piquante'],
  moutardes: ['moutarde', 'moutarde-a-l-ancienne', 'moutarde-douce'],
  'bouillons, fonds et fumets': ['bouillon-de-volaille', 'bouillon-de-boeuf', 'bouillon-de-legume', 'fond-de-veau',
    'fond-de-volaille', 'fumet-de-poisson'],
  'sels et poivres': ['sel', 'gro-sel', 'fleur-de-sel', 'poivre', 'poivre-blanc', 'baie-rose'],
  épices: ['paprika', 'paprika-fume', 'paprika-fort', 'cumin', 'graine-de-cumin', 'curry', 'curcuma', 'cannelle',
    'baton-de-cannelle', 'noi-de-muscade', 'piment-d-espelette', 'piment-de-cayenne', 'piment-en-poudre', 'gingembre-moulu',
    'quatre-epice', 'ra-el-hanout', 'garam-masala', 'cardamome', 'clou-de-girofle', 'ani-etoile', 'coriandre-moulue',
    'graine-de-coriandre', 'graine-de-moutarde', 'safran', 'ail-en-poudre', 'baie-de-genievre', 'carvi', 'cinq-epice',
    'poivre-de-sichuan', 'melange-cinq-baie', 'piment-seche', 'flocon-de-piment', 'graine-de-fenouil'],
  'herbes sèches': ['herbe-de-provence', 'laurier', 'basilic-seche', 'persil-seche', 'romarin-seche', 'menthe-sechee',
    'estragon-seche', 'aneth-seche', 'ciboulette-sechee', 'sauge-sechee'],
  eau: ['eau'],
};
/** Seuils gardés (tableau du §9 inchangé pour eux) : id → seuil exact. */
const SEUILS_GARDES = {
  beurre: { seuil: 30, unite: 'g' },
  lait: { seuil: 10, unite: 'cl' }, 'lait-entier': { seuil: 10, unite: 'cl' }, 'lait-demi-ecreme': { seuil: 10, unite: 'cl' },
  'lait-ecreme': { seuil: 10, unite: 'cl' },
  farine: { seuil: 50, unite: 'g' }, sucre: { seuil: 30, unite: 'g' }, 'sucre-rou': { seuil: 30, unite: 'g' },
  ail: { seuil: 2, unite: 'pc' },
  'concentre-de-tomate': { seuil: 2, unite: 'cs' }, 'fecule-de-mai': { seuil: 2, unite: 'cs' }, chapelure: { seuil: 2, unite: 'cs' },
  miel: { seuil: 2, unite: 'cs' },
  'levure-chimique': { seuil: 1, unite: 'sachet' }, 'sucre-vanille': { seuil: 1, unite: 'sachet' },
  'extrait-de-vanille': { seuil: 1, unite: 'cc' },
};
/**
 * Herbes sèches dont le nom seul se dit aussi de l'herbe fraîche (« thym, 2 pc » : deux branches) : un seuil en
 * cuillères si large qu'en cuillères ou en pincées elles sont toujours à la maison, mais en pièces (branches) ou en
 * bottes, impossibles à comparer, elles s'achètent (dans le doute, on l'achète ; jamais une herbe fraîche).
 */
const HERBES_NOM_NU = {
  thym: { seuil: 4, unite: 'cs' }, origan: { seuil: 4, unite: 'cs' }, sarriette: { seuil: 4, unite: 'cs' },
  marjolaine: { seuil: 4, unite: 'cs' },
};
/**
 * Jamais de placard : herbes fraîches et aromates frais, produits consommés à la quantité, et faux voisins des
 * familles (« fond de tarte » est une pâte, « thon à l'huile » une conserve, « lait cru » s'achète exprès).
 */
const JAMAIS = ['coriandre-fraiche', 'thym-frai', 'gingembre-frai', 'romarin', 'basilic-frai', 'menthe-fraiche', 'persil',
  'bouquet-garni', 'piment-rouge', 'sauce-tomate', 'couli-de-tomate', 'pesto', 'ketchup', 'mayonnaise', 'tahini',
  'lait-de-coco', 'creme-de-coco', 'capre', 'cornichon', 'olive-noire', 'olive-verte', 'fond-de-tarte', 'thon-a-l-huile',
  'sardine-a-l-huile', 'lait-cru'];
/**
 * Cas limites laissés SANS placard (dans le doute, on l'achète), en attente d'une décision du propriétaire : chacun
 * avec sa raison. Un changement ici est une décision, jamais un ajustement de test.
 */
const DOUTEUX = new Map([
  ['sauce-soja-sucree', 'souvent employée en quantité pour laquer'],
  ['sauce-hoisin', 'souvent employée en quantité pour laquer, comme la sauce soja sucrée'],
  ['creme-de-balsamique', 'sauce de finition, pas un vinaigre'],
  ['harissa', 'pâte en tube ou en pot, au frigo une fois ouverte'],
  ['graine-de-sesame', 'parfois en garniture abondante'],
  ['gousse-de-vanille', 'chère, souvent achetée pour une recette'],
  ['eau-de-fleur-d-oranger', 'arôme hors des familles'],
  ['bicarbonate-de-soude', 'hors des familles et du tableau'],
  ['levure-de-boulanger', 'la levure fraîche ne se garde pas'],
  ['fecule-de-pomme-de-terre', 'hors du tableau'],
  ['panko', 'souvent en quantité pour paner'],
  ['sucre-glace', 'hors du tableau (sucre blanc et roux seulement)'],
  ['vergeoise', 'hors du tableau'],
  ['beurre-demi-sel', 'le seuil du beurre ne vise que le beurre doux'],
  ['beurre-sale', 'le seuil du beurre ne vise que le beurre doux'],
  ['beurre-clarifie', 'hors du tableau'],
  ['graisse-de-canard', 'graisse, pas une huile'],
  ['graisse-d-oie', 'graisse, pas une huile'],
  ['saindou', 'graisse, pas une huile'],
  ['miso', 'pâte, pas une sauce en bouteille'],
  ['miso-blanc', 'pâte, pas une sauce en bouteille'],
  ['cacao-en-poudre', 'hors des familles et du tableau'],
]);
const TOUS_TOUJOURS = Object.values(TOUJOURS).flat();

test('13. placard : un seuil > 0 et une unité du vocabulaire, ou aucun des deux ; équivalences vers g ou ml', () => {
  for (const entree of DICTIONNAIRE) {
    if ('placard' in entree) {
      const { placard } = entree;
      assert.ok(placard && typeof placard === 'object' && !Array.isArray(placard), entree.id);
      assert.deepEqual(Object.keys(placard).filter((cle) => !['seuil', 'unite'].includes(cle)), [], entree.id);
      if ('seuil' in placard || 'unite' in placard) {
        assert.ok(typeof placard.seuil === 'number' && placard.seuil > 0, `${entree.id} : seuil`);
        assert.ok(VOCABULAIRES.unite.includes(placard.unite), `${entree.id} : unité du seuil`);
      }
    }
    if ('equivalences' in entree) {
      assert.ok('placard' in entree, `${entree.id} : équivalences sans placard (elles ne servent qu'au seuil)`);
      const paires = Object.entries(entree.equivalences);
      assert.ok(paires.length > 0, entree.id);
      for (const [unite, valeur] of paires) {
        assert.ok(VOCABULAIRES.unite.includes(unite), `${entree.id} : ${unite}`);
        assert.ok(['g', 'ml'].includes(valeur?.unite), `${entree.id} : équivalence vers g ou ml`);
        assert.ok(typeof valeur.qte === 'number' && valeur.qte > 0, entree.id);
      }
    }
  }
});

test('13. placard : familles « toujours à la maison » ({}), seuils gardés exacts, et rien d’autre n’est mis de côté', () => {
  assert.equal(new Set(TOUS_TOUJOURS).size, TOUS_TOUJOURS.length, 'id listé deux fois');
  const avecPlacard = DICTIONNAIRE.filter((entree) => 'placard' in entree);
  assert.deepEqual(avecPlacard.map((e) => e.id).sort(),
    [...TOUS_TOUJOURS, ...Object.keys(SEUILS_GARDES), ...Object.keys(HERBES_NOM_NU)].sort());
  for (const id of TOUS_TOUJOURS) assert.deepEqual(DICTIONNAIRE.find((e) => e.id === id).placard, {}, `${id} : toujours à la maison`);
  for (const [id, seuil] of Object.entries({ ...SEUILS_GARDES, ...HERBES_NOM_NU })) {
    assert.deepEqual(DICTIONNAIRE.find((e) => e.id === id).placard, seuil, id);
  }
  // Herbes au nom nu : toujours à la maison en cuillères ou en pincées (bien au-delà d'un usage réel), achetées en
  // branches ou en bottes.
  for (const id of Object.keys(HERBES_NOM_NU)) {
    const { placard } = DICTIONNAIRE.find((e) => e.id === id);
    for (const [quantite, unite] of [[1, 'cc'], [6, 'cc'], [3, 'cs'], [4, 'pincee']]) {
      const { famille, qte } = versBase(quantite, unite);
      assert.equal(dansLePlacard({ [famille]: qte }, placard), true, `${id} ${quantite} ${unite}`);
    }
    for (const unite of ['pc', 'botte']) {
      const { famille, qte } = versBase(2, unite);
      assert.equal(dansLePlacard({ [famille]: qte }, placard), false, `${id} 2 ${unite}`);
    }
  }
  // Seuils comparables à l'unité courante du produit (sinon il serait toujours sur la liste).
  for (const entree of avecPlacard.filter((e) => 'seuil' in e.placard)) {
    const recette = { [versBase(1, entree.unite).famille]: versBase(1, entree.unite).qte };
    assert.equal(typeof dansLePlacard(recette, entree.placard, entree.equivalences ?? null), 'boolean', entree.id);
    assert.ok(dansLePlacard({ [versBase(entree.placard.seuil, entree.placard.unite).famille]: versBase(entree.placard.seuil, entree.placard.unite).qte },
      entree.placard, entree.equivalences ?? null), `${entree.id} : le seuil lui-même est à la maison`);
  }
  // Toujours à la maison : quelle que soit la quantité, même illisible ; jamais en bottes (une botte est fraîche).
  for (const id of TOUS_TOUJOURS) {
    const { placard } = DICTIONNAIRE.find((e) => e.id === id);
    assert.equal(dansLePlacard({ volume: 1600, cs: 10.5, pc: 12 }, placard), true, id);
    assert.equal(dansLePlacard({}, placard), true, id);
    assert.equal(dansLePlacard({ [versBase(1, 'botte').famille]: 1 }, placard), false, `${id} en botte`);
    assert.equal(dansLePlacard({ [versBase(1, 'botte').famille]: 1, cc: 1 }, placard), false, `${id} en botte et en cuillère`);
  }
  // Équivalences propres, seulement là où un seuil les utilise : levure (11 g), sucre vanillé (7,5 g), ail (5 g la gousse).
  const equivalences = Object.fromEntries(DICTIONNAIRE.filter((e) => 'equivalences' in e).map((e) => [e.id, e.equivalences]));
  assert.deepEqual(equivalences, {
    'levure-chimique': { sachet: { qte: 11, unite: 'g' } }, 'sucre-vanille': { sachet: { qte: 7.5, unite: 'g' } },
    ail: { pc: { qte: 5, unite: 'g' } },
  });
  for (const id of Object.keys(equivalences)) assert.ok('seuil' in DICTIONNAIRE.find((e) => e.id === id).placard, `${id} : équivalences sans seuil`);
});

test('13. placard : familles complètes ; jamais une herbe fraîche ni un produit consommé à la quantité ; cas douteux sans placard', () => {
  const parId = new Map(DICTIONNAIRE.map((e) => [e.id, e]));
  for (const id of [...JAMAIS, ...DOUTEUX.keys()]) {
    assert.ok(parId.has(id), `${id} : id inconnu`);
    assert.equal('placard' in parId.get(id), false, `${id} : jamais de placard${DOUTEUX.has(id) ? ` (${DOUTEUX.get(id)})` : ''}`);
  }
  // Familles par le DÉBUT du nom, jamais par un mot (« beurre demi-sel », « pain d'épices », « fond de tarte »,
  // « thon à l'huile ») : toute entrée d'épicerie salée qui en relève est toujours à la maison.
  const debut = /^(huile|vinaigre|moutarde|bouillon |fumet|fond de |sel( |$)|gros sel|fleur de sel|poivre( |$)|sauce (soja|worcestershire|d'huître)( |$))/;
  const horsFamille = DICTIONNAIRE.filter((e) => e.rayon === 'epicerie_salee' && debut.test(e.nom))
    .filter((e) => !TOUS_TOUJOURS.includes(e.id) && !DOUTEUX.has(e.id)).map((e) => e.id);
  assert.deepEqual(horsFamille, [], 'famille incomplète : toujours à la maison, ou cas douteux avec sa raison');
  // Épicerie salée mesurée à la pincée ou à la cuillère à café : épices, herbes sèches, sels et poivres, sauf exceptions.
  const petites = DICTIONNAIRE.filter((e) => e.rayon === 'epicerie_salee' && ['pincee', 'cc'].includes(e.unite))
    .filter((e) => !TOUS_TOUJOURS.includes(e.id) && !Object.hasOwn(HERBES_NOM_NU, e.id)).map((e) => e.id).sort();
  assert.deepEqual(petites, ['capre', 'harissa'], 'épice ou herbe sèche oubliée');
  // Aucune herbe fraîche ni aucun légume n'est « toujours » (l'ail garde son seuil de 2 gousses).
  assert.deepEqual(DICTIONNAIRE.filter((e) => e.rayon === 'fruits_legumes' && 'placard' in e).map((e) => e.id), ['ail']);
  for (const id of [...TOUS_TOUJOURS, ...Object.keys(HERBES_NOM_NU)]) {
    assert.ok(['epicerie_salee', 'boissons'].includes(parId.get(id).rayon), id);
  }
});

test('13. entrées neuves : « eau » (toujours à la maison), « vinaigre de vin », « fumet » ; ids figés', () => {
  for (const nom of ['eau', 'Eau froide', 'eau chaude', 'eau tiède', 'eau bouillante']) {
    assert.equal(reconnaitre(nom)?.entree?.id ?? reconnaitre(nom)?.element?.id, 'eau', nom);
  }
  assert.equal(reconnaitre('eau')?.element.rayon, 'boissons');
  assert.equal(reconnaitre('vinaigre de vin')?.element.id, 'vinaigre-de-vin');
  assert.equal(reconnaitre('fumet')?.element.id, 'fumet-de-poisson');
  assert.deepEqual(reconnaitre('fumet').element.marqueurs, ['poisson']);
  for (const id of ['eau', 'vinaigre-de-vin']) assert.ok(IDS_DICTIONNAIRE.includes(id), id);
  // Les autres eaux restent des produits à acheter.
  assert.equal(reconnaitre('eau gazeuse')?.element.id, 'eau-gazeuse');
  assert.equal('placard' in DICTIONNAIRE.find((e) => e.id === 'eau-gazeuse'), false);
});

test('13. une recette avec « eau 1 l » ne met une ligne que dans « Déjà à la maison ? »', () => {
  const soupe = {
    id: 'soupe-essai', nom: 'Soupe essai', type: 'plat', statutRecette: 'brouillon', portionsBase: 2,
    ingredients: [
      { produit: 'eau', qte: 1, unite: 'l', rayon: 'boissons', marqueurs: [] },
      { produit: 'eau tiède', qte: 20, unite: 'cl', rayon: 'boissons', marqueurs: [] },
      { produit: 'carotte', qte: 3, unite: 'pc', rayon: 'fruits_legumes', marqueurs: ['legume'], role: 'incorpore' },
    ],
  };
  const semaine = { id: '2026-10-10', debut: '2026-10-10', fin: '2026-10-16', creeLe: 0, plats: { 'soupe-essai': { ajouteLe: 1 } } };
  const liste = listeDeCourses(semaine, { tousLesPlats: [soupe], profils: [{ id: 'profil-a', nom: 'Adulte A', ordre: 1, coefPortion: 1 }] });
  assert.deepEqual(liste.lignes.map((l) => l.produitId), ['carotte']);
  assert.deepEqual(liste.maison.map((l) => l.produitId), ['eau']);
  // Un adulte, recette pour 2 : 2 repas, la recette telle quelle (1 l + 20 cl).
  assert.deepEqual(liste.maison[0].totaux, { volume: 1200 });
});

// ——— 14. Écritures courantes (2026-10-11) ———

/**
 * Écritures ajoutées le 2026-10-11 (constat de l'essai : « cannelle moulue », « thym séché », « huile végétale »…) :
 * id visé → formes. Noms exacts seulement, jamais de ressemblance. « bouillon cube » et « cube de bouillon » restent
 * dehors (bouillon non dit : la question « C'est… ? » reste, point 8).
 */
const ECRITURES_AJOUTEES = [
  ['ail', ['ail écrasé', 'ail émincé', 'ail frais', 'ail râpé', "gousse d'ail écrasée", "gousse d'ail hachée",
    "gousse d'ail émincée"]],
  ['beurre', ['beurre mou', 'beurre fondu', 'beurre pommade', 'beurre froid', 'beurre ramolli', 'beurre noisette']],
  ['lait', ['lait froid', 'lait tiède', 'lait chaud', 'lait de vache']],
  ['moutarde', ['moutarde forte', 'moutarde forte de dijon', 'moutarde de dijon forte']],
  ['moutarde-a-l-ancienne', ['moutarde en grains', 'moutarde à grains', 'moutarde de meaux']],
  ['moutarde-douce', ['moutarde douce']],
  ['sauce-soja', ['sauce de soja', 'sauce soja claire', 'sauce soja légère']],
  ['sauce-soja-sucree', ['sauce de soja sucrée', 'kecap manis']],
  ['tamari', ['tamari', 'sauce tamari']],
  ['sauce-worcestershire', ['sauce worcester', 'worcestershire']],
  ['sauce-d-huitre', ["sauce d'huître", 'sauce huître']],
  ['huile-d-olive', ["huile d'olive vierge extra", "huile d'olive extra vierge", "huile d'olive vierge"]],
  ['huile-neutre', ['huile végétale', 'huile de cuisson']],
  ['huile-de-sesame', ['huile de sésame grillé', 'huile de sésame toasté']],
  ['huile-d-arachide', ["huile d'arachide"]],
  ['huile-de-pepin-de-raisin', ['huile de pépins de raisin']],
  ['huile-de-coco', ['huile de coco', 'huile de noix de coco']],
  ['vinaigre-balsamique', ['vinaigre balsamique de modène', 'vinaigre de modène']],
  ['vinaigre-balsamique-blanc', ['vinaigre balsamique blanc']],
  ['vinaigre-de-cidre', ['vinaigre de cidre de pomme']],
  ['vinaigre-de-xere', ['vinaigre de vin de xérès', 'vinaigre de jerez']],
  ['vinaigre-blanc', ["vinaigre d'alcool blanc"]],
  ['sel', ['sel de mer', 'sel marin', 'sel fin de mer', 'sel iodé', 'sel de guérande', 'sel gris']],
  ['gro-sel', ['gros sel de mer', 'gros sel marin', 'gros sel de guérande', 'gros sel gris']],
  ['fleur-de-sel', ['fleur de sel de guérande']],
  ['poivre', ['poivre du moulin', 'poivre noir du moulin', 'poivre noir moulu', 'poivre en grains',
    'poivre noir en grains', 'grain de poivre', 'poivre concassé', 'poivre noir concassé', 'poivre mignonnette',
    'poivre en poudre', 'poivre noir en poudre', 'poivre fraîchement moulu', 'poivre noir fraîchement moulu']],
  ['poivre-blanc', ['poivre blanc', 'poivre blanc moulu']],
  ['paprika', ['paprika doux', 'paprika en poudre', 'paprika moulu']],
  ['paprika-fume', ['paprika fumé doux']],
  ['paprika-fort', ['paprika fort', 'paprika piquant']],
  ['cumin', ['cumin moulu', 'cumin en poudre']],
  ['graine-de-cumin', ['graine de cumin', 'cumin en grains', 'cumin en graines']],
  ['curry', ['poudre de curry', 'curry doux']],
  ['curcuma', ['curcuma moulu', 'curcuma en poudre']],
  ['cannelle', ['cannelle moulue']],
  ['baton-de-cannelle', ['bâton de cannelle', 'cannelle en bâton']],
  ['noi-de-muscade', ['muscade râpée', 'noix de muscade râpée', 'muscade moulue', 'muscade en poudre',
    'noix de muscade moulue', 'noix de muscade en poudre']],
  ['piment-d-espelette', ["piment d'espelette en poudre", "piment d'espelette moulu", 'espelette']],
  ['piment-de-cayenne', ['poivre de cayenne', 'cayenne', 'piment de cayenne en poudre', 'piment de cayenne moulu']],
  ['piment-en-poudre', ['piment en poudre', 'piment moulu']],
  ['cardamome', ['cardamome moulue', 'cardamome en poudre', 'gousse de cardamome', 'cardamome verte']],
  ['clou-de-girofle', ['girofle']],
  ['graine-de-coriandre', ['graine de coriandre', 'coriandre en grains']],
  ['graine-de-moutarde', ['graine de moutarde']],
  ['safran', ['safran en poudre', 'pistil de safran', 'filament de safran', 'dose de safran']],
  ['ail-en-poudre', ['ail en poudre', 'ail semoule']],
  ['herbe-de-provence', ['herbes de provence séchées']],
  ['thym', ['thym séché', 'thym sec']],
  ['laurier', ['laurier sauce', 'laurier séché', 'feuille de laurier séchée']],
  ['origan', ['origan séché']],
  ['basilic-seche', ['basilic séché']],
  ['persil-seche', ['persil séché']],
  ['romarin-seche', ['romarin séché']],
  ['menthe-sechee', ['menthe séchée']],
  ['estragon-seche', ['estragon séché']],
  ['aneth-seche', ['aneth séché']],
  ['ciboulette-sechee', ['ciboulette séchée']],
  ['sauge-sechee', ['sauge séchée']],
  ['sarriette', ['sarriette', 'sarriette séchée']],
  ['marjolaine', ['marjolaine', 'marjolaine séchée']],
  ['baie-de-genievre', ['baie de genièvre', 'baie de genévrier']],
  ['carvi', ['carvi', 'graine de carvi']],
  ['cinq-epice', ['cinq-épices', '5 épices']],
  ['poivre-de-sichuan', ['poivre de sichuan', 'poivre du sichuan', 'baie de sichuan']],
  ['melange-cinq-baie', ['mélange cinq baies', 'mélange 5 baies', 'cinq baies', '5 baies', 'poivre cinq baies',
    'poivre 5 baies']],
  ['piment-seche', ['piment séché', 'piment sec']],
  ['flocon-de-piment', ['flocon de piment', 'piment en flocons']],
  ['graine-de-fenouil', ['graine de fenouil', 'fenouil en graines']],
  ['huile-de-noisette', ['huile de noisette']],
  ['vinaigre-de-framboise', ['vinaigre de framboise']],
  ['mirin', ['mirin']],
  ['sauce-piquante', ['sauce piquante', 'sauce pimentée', 'sauce au piment']],
  ['sauce-hoisin', ['sauce hoisin']],
  ['bouillon-de-volaille', ['bouillon de volaille en cube', 'bouillon cube de volaille',
    'bouillon de volaille déshydraté', 'bouillon de volaille en poudre', 'cube de bouillon de poulet',
    'bouillon de poulet en cube']],
  ['bouillon-de-boeuf', ['bouillon de bœuf en cube', 'bouillon cube de bœuf', 'bouillon de bœuf déshydraté',
    'bouillon de bœuf en poudre']],
  ['fond-de-veau', ['fond de veau déshydraté', 'fond de veau en poudre']],
  ['bouillon-de-legume', ['bouillon de légumes en cube', 'bouillon cube de légumes', 'bouillon de légumes déshydraté',
    'bouillon de légumes en poudre']],
  ['fond-de-volaille', ['fond de volaille déshydraté']],
  ['fumet-de-poisson', ['fumet de poisson déshydraté', 'fumet de poisson en poudre']],
  ['sucre', ['sucre semoule', 'sucre cristal', 'sucre cristallisé']],
  ['sucre-rou', ['sucre blond', 'sucre roux de canne', 'sucre brun']],
  ['sucre-vanille', ['sucre vanilliné']],
  ['farine', ['farine t45', 'farine t55', 'farine de blé t45', 'farine de blé t55', 'farine type 45',
    'farine type 55', 'farine fluide', 'farine blanche', 'farine de froment']],
  ['levure-chimique', ['levure chimique en poudre']],
  ['extrait-de-vanille', ['arôme vanille', 'arôme de vanille', 'vanille liquide', 'extrait de vanille liquide',
    'essence de vanille']],
  ['miel', ['miel liquide', "miel d'acacia", 'miel de fleurs', 'miel crémeux']],
];
/** Entrées neuves du 2026-10-11 (autre article acheté : autre pot, autre bouteille, herbe sèche dont le nom seul est frais). */
const ENTREES_NEUVES = new Set(['poivre-blanc', 'paprika-fort', 'graine-de-cumin', 'baton-de-cannelle', 'piment-en-poudre',
  'graine-de-coriandre', 'graine-de-moutarde', 'ail-en-poudre', 'basilic-seche', 'persil-seche', 'romarin-seche',
  'menthe-sechee', 'huile-d-arachide', 'huile-de-pepin-de-raisin', 'huile-de-coco', 'vinaigre-balsamique-blanc', 'tamari',
  'sauce-d-huitre', 'moutarde-douce', 'estragon-seche', 'aneth-seche', 'ciboulette-sechee', 'sauge-sechee', 'sarriette',
  'marjolaine', 'baie-de-genievre', 'carvi', 'cinq-epice', 'poivre-de-sichuan', 'melange-cinq-baie', 'piment-seche',
  'flocon-de-piment', 'graine-de-fenouil', 'huile-de-noisette', 'vinaigre-de-framboise', 'mirin', 'sauce-piquante',
  'sauce-hoisin']);

test('14. écritures d’avant : chaque forme du dictionnaire au 2026-10-10 garde son idProduit (table figée)', () => {
  assert.ok(FORMES_AVANT.size >= 700, `${FORMES_AVANT.size} formes`);
  const changees = [...FORMES_AVANT].filter(([forme, id]) => idProduit(forme) !== id).map(([forme, id]) => `${forme} : ${id} → ${idProduit(forme)}`);
  assert.deepEqual(changees, [], 'une coche, un « à racheter » ou un produit du foyer rangé sous l’ancien id serait perdu');
  // Le corpus figé ne change pas d'identité non plus (aucun de ses noms n'est une écriture ajoutée).
  const ajoutees = new Set(ECRITURES_AJOUTEES.flatMap(([, formesAjoutees]) => formesAjoutees));
  for (const nom of CORPUS_INGREDIENTS) {
    if (FORMES_AVANT.has(nom)) assert.equal(idProduit(nom), FORMES_AVANT.get(nom), nom);
    assert.equal(ajoutees.has(nom), false, `${nom} : nom du corpus réécrit`);
  }
});

test('14. écritures courantes : avant, un nom inconnu (sa propre clé, jamais un autre produit) ; après, l’id de l’entrée', () => {
  const ancienIds = new Set(IDS_DICTIONNAIRE.filter((id) => !ENTREES_NEUVES.has(id)));
  for (const id of ENTREES_NEUVES) assert.ok(IDS_DICTIONNAIRE.includes(id), `${id} : id figé`);
  // ECRITURES_AJOUTEES est exactement la liste des formes ajoutées depuis la table figée, et la table d'avant les
  // donnait toutes inconnues (calculée avec le code d'alors : sa propre clé, jamais un autre produit).
  const actuelles = TOUTES.map(({ forme }) => forme).filter((forme) => !FORMES_AVANT.has(forme)).sort();
  assert.deepEqual(ECRITURES_AJOUTEES.flatMap(([, formesAjoutees]) => formesAjoutees).sort(), actuelles, 'ECRITURES_AJOUTEES à jour');
  assert.deepEqual([...AJOUTEES_AVANT.keys()].sort(), actuelles, 'AJOUTEES_AVANT (tests/donnees/formes-avant-placard.js) à jour');
  for (const [forme, avant] of AJOUTEES_AVANT) assert.equal(avant, cleProduit(forme), `${forme} : était déjà « ${avant} » avant`);
  const vues = new Set();
  for (const [id, formesAjoutees] of ECRITURES_AJOUTEES) {
    const entree = DICTIONNAIRE.find((e) => e.id === id);
    assert.ok(entree, id);
    for (const forme of formesAjoutees) {
      assert.ok(formes(entree).includes(forme), `${forme} : forme de ${id}`);
      assert.equal(vues.has(forme), false, forme);
      vues.add(forme);
      // Avant : clé seule (aucun mot homographe), qui n'était l'id d'aucun produit courant ni d'une autre entrée.
      const avant = cleProduit(forme);
      assert.equal(avant.split('-').some((mot) => HOMOGRAPHES.has(mot)), false, `${forme} : touche un homographe`);
      assert.equal(ancienIds.has(avant) && avant !== id, false, `${forme} : était déjà « ${avant} »`);
      // Après : l'entrée visée, sans question de nature.
      assert.equal(idProduit(forme), id, forme);
      const r = reconnaitre(forme);
      assert.equal(r?.entree?.id, id, forme);
      assert.notEqual(r?.ambigu, true, forme);
    }
  }
  assert.ok(vues.size >= 150, `${vues.size} écritures`);
  // Le constat de l'essai, nom par nom (avant → après).
  for (const [nom, avant, apres] of [
    ['Cannelle moulue', 'cannelle-moulue', 'cannelle'], ['poivre du moulin', 'poivre-du-moulin', 'poivre'],
    ['poivre noir du moulin', 'poivre-noir-du-moulin', 'poivre'],
    ['huile d’olive vierge extra', 'huile-d-olive-vierge-extra', 'huile-d-olive'],
    ['HUILE D\'OLIVE EXTRA-VIERGE', 'huile-d-olive-extra-vierge', 'huile-d-olive'], ['huile végétale', 'huile-vegetale', 'huile-neutre'],
    ['thym séché', 'thym-seche', 'thym'], ['Thyms séchés', 'thym-seche', 'thym'], ['cumin moulu', 'cumin-moulu', 'cumin'],
    ['origan séché', 'origan-seche', 'origan'],
  ]) {
    assert.equal(cleProduit(nom), avant, nom);
    assert.equal(idProduit(nom), apres, nom);
  }
  // Rien ne bouge pour les noms voisins : « pâtes sèches » reste des pâtes ; les herbes fraîches restent fraîches.
  assert.equal(idProduit('pâtes sèches'), 'pate');
  assert.equal(idProduit('pates seches'), 'pate');
  assert.equal(idProduit('coriandre'), 'coriandre-fraiche');
  assert.equal(idProduit('gingembre'), 'gingembre-frai');
  assert.equal(idProduit('romarin'), 'romarin');
  assert.equal(idProduit('basilic'), 'basilic-frai');
  assert.equal(idProduit('crème de balsamique'), 'creme-de-balsamique');
  // Un bouillon non dit reste une question ; la sauce d'huître est un fruit de mer (version végétale).
  assert.equal(reconnaitre('bouillon cube'), null);
  assert.deepEqual(DICTIONNAIRE.find((e) => e.id === 'sauce-d-huitre').marqueurs, ['fruits_de_mer']);
});
