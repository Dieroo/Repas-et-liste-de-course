// T3-0 « Produits courants » : vérifications automatiques du dictionnaire (js/coeur/dictionnaire.js), plan §6.2, points
// 1 à 12 : validité, forme et rôle, repères de préparation, unicité des clés, homographes, cohérence avec les mots qui
// annoncent un repère (reperesAttendus), garde-fous de l'adulte sans viande, faux amis, lait cru, ids figés, couverture
// (exemples, fixtures, corpus figé), budget. Données génériques : aucune donnée du foyer.
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
import { HOMOGRAPHES, natureDe, reconnaitre } from '../js/coeur/produits.js';
import { IDS_DICTIONNAIRE } from './donnees/ids-dictionnaire.js';
import { CORPUS_INGREDIENTS } from './donnees/corpus-ingredients.js';

const lire = (chemin) => readFileSync(fileURLToPath(new URL(`../${chemin}`, import.meta.url)), 'utf8');

/**
 * Budget du fichier (octets UTF-8) : ~117 octets par entrée mesurés sur les 50 premières ; ~70 Ko pour ~580 entrées.
 * La marge sert aux champs réservés à T3 (placard, équivalences, recherche).
 */
const BUDGET_OCTETS = 90_000;

const CHAMPS = ['id', 'nom', 'rayon', 'unite', 'marqueurs', 'forme', 'role', 'alias'];
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
 * saisie sans accent reste reconnue). « Sucre vanillé » / « extrait de vanille ».
 */
const ACCENTUATIONS_SANS_RISQUE = new Set(['vanille']);
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
