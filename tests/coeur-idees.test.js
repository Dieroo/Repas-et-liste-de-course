// « 💡 Idées de plats » (T2b+) : texte copié pour Claude (DEMANDE-IDEES) et garde-fou à l'ajout de recettes (une idée
// qui existe déjà avec sa recette n'est pas reprise). Fixtures génériques.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  IDEES_ENVIE_MAX, IDEES_NOMBRES, IDEES_NOMBRE_DEFAUT, IDEES_NOMS_MAX, IDEES_PAR_MESSAGE, SOURCE_IDEE, VERSION_INSTRUCTIONS,
  texteCorrectionPourClaude, texteDemandeIdees, texteDemandeRecette,
} from '../js/coeur/claude.js';
import { extrairePaquet, filtrerPreparation, preparerImport, validerPaquet } from '../js/coeur/paquet.js';
import { ecrireRegime } from '../js/coeur/regles.js';

// ——— Fixtures ———

const SANS_VIANDE = ecrireRegime({ regime: 'sans_viande', precisions: new Set() }, []);
const NI_POISSON = ecrireRegime({ regime: 'sans_viande_ni_poisson', precisions: new Set() }, []);
const ADULTE_A = { id: 'profil-a', nom: 'Adulte A', email: 'a@example.com', ordre: 1, coefPortion: 1 };
const ADULTE_B = { id: 'profil-b', nom: 'Adulte B', email: 'b@example.com', ordre: 2, coefPortion: 1, regles: SANS_VIANDE };
const ENFANT = { id: 'enfant', nom: 'Enfant', email: '', ordre: 3, coefPortion: 0.5, regles: NI_POISSON };
const PROFILS = [ENFANT, ADULTE_B, ADULTE_A];

const DEBUT = ['DEMANDE-IDEES paquet@1', `instructions: ${VERSION_INSTRUCTIONS}`];
const CRITERES = 'critères: plats originaux (pas les grands classiques), faciles à faire en batch : préparation simple, se gardent 3 jours au frigo, se réchauffent bien, se congèlent de préférence ; pour toute la famille, jeune enfant compris ; surtout des plats, un ou deux desserts.';
const APPAREILS_DEFAUT = 'appareils: plaque, four, cookeo, airfryer';
const CONSIGNE = '(Rends 5 fiches complètes par message, chacune avec un `id` nouveau (slug du nom), `"statutRecette": "brouillon"` et `"source": "Idée de Claude"`, et leurs variantes comme pour DEMANDE-RECETTE. Aucun nom de la ligne « déjà dans l\'app ». Après chaque message, attends « suite » pour les 5 suivantes. Un seul bloc par message.)';
const VERSION_B = '- pour: profil-b — Ne mange pas de viande (bœuf, porc, volaille, agneau, charcuterie, escargots, grenouilles), ni de bouillon ou de fond de viande ou de volaille, ni de gélatine animale, ni de graisse animale (saindoux, graisse de canard). Mange du poisson, des fruits de mer, du fumet de poisson, des œufs, du fromage (même à présure animale) et du miel. — styles: mer, vegetal';
const VERSION_ENFANT = '- pour: enfant — Ne mange ni viande (bœuf, porc, volaille, agneau, charcuterie, escargots, grenouilles), ni poisson, ni fruits de mer, ni bouillon ou fond de viande, de volaille ou de poisson, ni gélatine animale, ni graisse animale. Mange des œufs, du fromage (même à présure animale) et du miel. — styles: vegetal';

const lignesDe = (texte) => texte.split('\n');
const ligneQuiCommence = (texte, debut) => lignesDe(texte).find((l) => l.startsWith(debut)) ?? null;

const ing = (produit, qte, unite, marqueurs = [], extra = {}) => ({ produit, qte, unite, rayon: 'divers', marqueurs, ...extra });
const ajout = (produit, qtePortion, unite, marqueurs = [], extra = {}) => ({ produit, qtePortion, unite, rayon: 'divers', marqueurs, ...extra });
const POULET = ing('haut de cuisse de poulet', 800, 'g', ['viande', 'volaille'], { forme: 'morceaux' });
const PATATE = ing('patate douce', 600, 'g', ['legume'], { role: 'principal' });
const MISO = ing('miso blanc', 2, 'cs');
const RIZ = ing('riz basmati', 300, 'g', ['feculent']);

/** Fiche rendue par Claude pour DEMANDE-IDEES : brouillon, source « Idée de Claude », versions selon `versions:`. */
const idee = (id, nom, extra = {}) => ({
  id,
  nom,
  type: 'plat',
  statutRecette: 'brouillon',
  portionsBase: 4,
  ingredients: [POULET, PATATE, MISO, RIZ],
  etapes: ['Mariner le poulet au miso.', 'Rôtir avec la patate douce.'],
  cuisson: [{ appareil: 'four', tempC: 200, dureeMin: 35 }],
  conservation: { frigoJours: 3, congelable: true },
  variantes: [
    { pour: 'profil-b', style: 'mer', frigoJours: 2, retirer: ['haut de cuisse de poulet'],
      ajouter: [ajout('dos de cabillaud', 130, 'g', ['poisson'])], consigne: 'Rôtir sa part de cabillaud à part, 12 minutes.' },
    { pour: 'profil-b', style: 'vegetal', retirer: ['haut de cuisse de poulet'],
      ajouter: [ajout('tofu ferme', 120, 'g')], consigne: 'Mariner le tofu au miso, rôtir à part.' },
    { pour: 'enfant', style: 'vegetal', retirer: ['haut de cuisse de poulet'],
      ajouter: [ajout('tofu ferme', 120, 'g')], consigne: 'Même part au tofu.' },
  ],
  source: SOURCE_IDEE,
  ...extra,
});

/** Plat de l'app qui a déjà sa recette. */
const platRempli = (id, nom, extra = {}) => ({
  id, nom, type: 'plat', recurrence: 'aucune', statutRecette: 'validee', portionsBase: 4,
  ingredients: [ing('lentille corail', 300, 'g', ['feculent'])], etapes: ['Cuire.', 'Servir.'], ...extra,
});
/** Plat ajouté par son nom (⏳). */
const platAttente = (id, nom) => ({ id, nom });

const paquet = (...plats) => ({ format: 'paquet@1', instructions: VERSION_INSTRUCTIONS, plats });
function valides(...plats) {
  const resultat = validerPaquet([paquet(...plats)], { profils: PROFILS });
  assert.equal(resultat.valide, true, JSON.stringify(resultat.erreurs.concat(resultat.plats.flatMap((p) => p.erreurs))));
  return resultat.plats.map((p) => p.donnees);
}
const importer = (plats, options) => preparerImport(valides(...plats), { demandes: [], profils: PROFILS, ...options });
const ecritureDe = (preparation, id) => preparation.ecritures.find((e) => e.id === id) ?? null;
const elementDe = (preparation, id) => preparation.elements.find((e) => e.id === id) ?? null;

// ——— texteDemandeIdees ———

test('constantes : 5, 10 ou 15 idées (15 par défaut), 5 par message, envie de 120 caractères, 20 noms', () => {
  assert.deepEqual(IDEES_NOMBRES, [5, 10, 15]);
  assert.equal(IDEES_NOMBRE_DEFAUT, 15);
  assert.equal(IDEES_PAR_MESSAGE, 5);
  assert.equal(IDEES_ENVIE_MAX, 120);
  assert.equal(IDEES_NOMS_MAX, 20);
  assert.equal(SOURCE_IDEE, 'Idée de Claude');
});

test('texte exact : sans envie, sans profil contraint, sans plat', () => {
  const attendu = [...DEBUT, 'nombre: 15', CRITERES, APPAREILS_DEFAUT, CONSIGNE].join('\n');
  assert.equal(texteDemandeIdees(), attendu);
  assert.equal(texteDemandeIdees({}), attendu);
  assert.equal(texteDemandeIdees({ profils: [ADULTE_A, { ...ADULTE_B, regles: [] }], plats: [], envie: '   ' }), attendu);
});

test('texte exact : envie, appareils, versions avec styles, aimés, évités, déjà dans l’app', () => {
  const plats = [
    platRempli('tajine-legumes', 'Tajine de légumes', { notes: { 'profil-a': 5 } }),
    platRempli('gratin-courge', 'Gratin de courge', { notes: { 'profil-b': 0, 'profil-a': 4 } }),
    platAttente('bo-bun', 'Bò bún'),
    platRempli('chili-doux', 'Chili doux', { notes: { enfant: 5, 'profil-a': 0 } }),
  ];
  const texte = texteDemandeIdees({
    nombre: 10,
    envie: 'Plats d’automne,\n cuisine du monde',
    plats,
    profils: PROFILS,
    appareils: [{ id: 'plaque', actif: true }, { id: 'four', actif: true }, { id: 'cookeo', actif: true },
      { id: 'airfryer', actif: false }, { id: 'monsieur_cuisine', actif: true }],
  });
  assert.equal(texte, [
    ...DEBUT,
    'nombre: 10',
    'envie: Plats d’automne, cuisine du monde',
    CRITERES,
    'appareils: plaque, four, cookeo, monsieur_cuisine',
    'versions:',
    VERSION_B,
    VERSION_ENFANT,
    'aimés: Chili doux ; Tajine de légumes',
    'évités: Chili doux ; Gratin de courge',
    'déjà dans l\'app: Bò bún ; Chili doux ; Gratin de courge ; Tajine de légumes',
    CONSIGNE,
  ].join('\n'));
});

test('bloc versions : exactement celui de DEMANDE-RECETTE pour un plat encore inconnu (tous les styles du profil)', () => {
  const blocVersions = (texte) => lignesDe(texte).filter((l) => l === 'versions:' || l.startsWith('- pour: '));
  const idees = blocVersions(texteDemandeIdees({ profils: PROFILS }));
  assert.deepEqual(idees, ['versions:', VERSION_B, VERSION_ENFANT]);
  assert.deepEqual(idees, blocVersions(texteDemandeRecette({ id: 'plat-inconnu', nom: 'Plat inconnu' }, { profils: PROFILS })));
  // Règles en codes quand l'écran ne sait pas les dire : même ligne que DEMANDE-RECETTE.
  const codes = { id: 'profil-b', regles: [{ type: 'exclureMarqueurs', marqueurs: ['poisson'], severite: 'exclu' }] };
  assert.match(texteDemandeIdees({ profils: [codes] }), /\nversions:\n- pour: profil-b — exclut les marqueurs poisson\.\n/);
});

test('nombre : 5, 10 ou 15 (texte de chiffres compris) ; toute autre valeur donne 15', () => {
  for (const nombre of IDEES_NOMBRES) assert.equal(ligneQuiCommence(texteDemandeIdees({ nombre }), 'nombre: '), `nombre: ${nombre}`);
  assert.equal(ligneQuiCommence(texteDemandeIdees({ nombre: '10' }), 'nombre: '), 'nombre: 10');
  assert.equal(ligneQuiCommence(texteDemandeIdees({ nombre: ' 5 ' }), 'nombre: '), 'nombre: 5');
  for (const nombre of [0, 7, 20, 100, -5, 10.5, '20', '1 0', 'dix', '', null, NaN, Infinity, [10], { n: 10 }]) {
    assert.equal(ligneQuiCommence(texteDemandeIdees({ nombre }), 'nombre: '), 'nombre: 15', String(nombre));
  }
});

test('envie : une ligne, espaces réduits, 120 caractères au plus, jamais un emoji coupé ; vide ou absente : pas de ligne', () => {
  // Coupée après une espace : l'espace finale part aussi.
  const longue = `${'a'.repeat(119)}   ${'b'.repeat(50)}`;
  const envie = ligneQuiCommence(texteDemandeIdees({ envie: longue }), 'envie: ').slice('envie: '.length);
  assert.equal(envie, 'a'.repeat(119));
  assert.ok([...envie].length <= IDEES_ENVIE_MAX);
  const exacte = 'c'.repeat(IDEES_ENVIE_MAX + 30);
  assert.equal(ligneQuiCommence(texteDemandeIdees({ envie: exacte }), 'envie: '), `envie: ${'c'.repeat(IDEES_ENVIE_MAX)}`);
  // Un emoji (deux unités de code) à la limite reste entier.
  const emojis = `${'d'.repeat(119)}🍂🍂`;
  assert.equal(ligneQuiCommence(texteDemandeIdees({ envie: emojis }), 'envie: '), `envie: ${'d'.repeat(119)}🍂`);
  // Retours à la ligne et tabulations : une seule ligne, rien n'est ajouté au texte.
  const texte = texteDemandeIdees({ envie: '\n  Mijotés\r\n\tet  épices  \n' });
  assert.equal(ligneQuiCommence(texte, 'envie: '), 'envie: Mijotés et épices');
  assert.equal(lignesDe(texte).length, lignesDe(texteDemandeIdees()).length + 1);
  for (const vide of ['', '   ', '\n\n', null, undefined, 42, { texte: 'x' }]) {
    assert.equal(ligneQuiCommence(texteDemandeIdees({ envie: vide }), 'envie'), null, String(vide));
  }
});

test('aimés et évités : notes des profils de l’app seulement, 20 au plus, les plus partagés d’abord, rendus par ordre alphabétique', () => {
  const lettres = 'ABCDEFGHIJKLMNOPQRSTUVWXY'; // 25 plats
  const plats = [...lettres].map((lettre) => platRempli(`plat-${lettre.toLowerCase()}`, `Plat ${lettre}`, { notes: { 'profil-a': 5, 'profil-b': 0 } }));
  // Notés par deux profils : passent avant les autres, même en fin d'alphabet.
  plats.push(platRempli('zeste-double', 'Zeste double', { notes: { 'profil-a': 5, enfant: 5, 'profil-b': 0 } }));
  plats.push(platRempli('zut-double', 'Zut double', { notes: { 'profil-b': 0, enfant: 0 } }));
  // Profil retiré : ses notes sont ignorées ; note 4 ou 1 : ni aimé ni évité ; note abîmée ignorée.
  plats.push(platRempli('ancien-profil', 'Ancien profil', { notes: { 'profil-retire': 5 } }));
  plats.push(platRempli('aime-bien', 'Aime bien', { notes: { 'profil-a': 4, enfant: 1 } }));
  plats.push(platRempli('note-abimee', 'Note abîmée', { notes: { 'profil-a': '5', enfant: -1 } }));
  const texte = texteDemandeIdees({ plats, profils: PROFILS });
  const aimes = ligneQuiCommence(texte, 'aimés: ').slice('aimés: '.length).split(' ; ');
  const evites = ligneQuiCommence(texte, 'évités: ').slice('évités: '.length).split(' ; ');
  assert.equal(aimes.length, IDEES_NOMS_MAX);
  assert.equal(evites.length, IDEES_NOMS_MAX);
  assert.deepEqual(aimes, [...[...lettres].slice(0, 19).map((l) => `Plat ${l}`), 'Zeste double']);
  assert.deepEqual(evites, [...[...lettres].slice(0, 19).map((l) => `Plat ${l}`), 'Zut double']);
  for (const nom of ['Ancien profil', 'Aime bien', 'Note abîmée']) {
    assert.ok(!aimes.includes(nom) && !evites.includes(nom), nom);
  }
  // Sans profil : aucune note n'est lue.
  assert.equal(ligneQuiCommence(texteDemandeIdees({ plats }), 'aimés'), null);
  assert.equal(ligneQuiCommence(texteDemandeIdees({ plats }), 'évités'), null);
});

test('déjà dans l’app : tous les noms, ⏳ compris, sur une ligne, sans doublon, triés sans tenir compte des accents ni de la casse', () => {
  const plats = [
    platRempli('zeste', 'Zeste'),
    platAttente('eclair', 'éclair'),
    platRempli('quiche', 'Quiche\n  aux poireaux'),
    platRempli('quiche-2', 'quiche aux poireaux'),
    platRempli('agneau', 'Agneau'),
    { id: 'sans-nom' },
    null,
    'texte',
  ];
  const texte = texteDemandeIdees({ plats, profils: PROFILS });
  assert.equal(ligneQuiCommence(texte, 'déjà dans l\'app: '), 'déjà dans l\'app: Agneau ; éclair ; Quiche aux poireaux ; Zeste');
  assert.equal(ligneQuiCommence(texteDemandeIdees({ plats: [] }), 'déjà'), null);
  // Catalogue entier, jamais tronqué.
  const nombreux = Array.from({ length: 120 }, (_, i) => platRempli(`plat-${i}`, `Plat ${String(i).padStart(3, '0')}`));
  assert.equal(ligneQuiCommence(texteDemandeIdees({ plats: nombreux }), 'déjà').split(' ; ').length, 120);
});

test('appareils : actifs des réglages dans l’ordre du vocabulaire, monsieur_cuisine seulement s’il est actif ; sinon le défaut', () => {
  const appareils = (valeur) => ligneQuiCommence(texteDemandeIdees({ appareils: valeur }), 'appareils: ');
  for (const absent of [null, undefined, [], 'four', {}, [{ id: 'four', actif: false }], ['grille-pain'], [null, 3]]) {
    assert.equal(appareils(absent), APPAREILS_DEFAUT, JSON.stringify(absent));
  }
  assert.equal(appareils(['four', 'plaque']), 'appareils: plaque, four');
  assert.equal(appareils(['Monsieur Cuisine', 'airfryer', 'airfryer']), 'appareils: airfryer, monsieur_cuisine');
  assert.equal(appareils([{ appareil: 'cookeo' }, { code: 'four', nombre: 1 }, { id: 'monsieur_cuisine', actif: false }]), 'appareils: four, cookeo');
  // Réglages de départ (CLAUDE.md §6) : monsieur_cuisine inactif.
  const depart = [{ id: 'plaque', nombre: 4 }, { id: 'four', nombre: 1 }, { id: 'cookeo', nombre: 1 }, { id: 'airfryer', nombre: 1 },
    { id: 'monsieur_cuisine', actif: false }];
  assert.equal(appareils(depart), APPAREILS_DEFAUT);
});

test('une demande d’idées recollée n’est jamais prise pour une réponse', () => {
  assert.equal(extrairePaquet(texteDemandeIdees({ profils: PROFILS, plats: [platRempli('x', 'X')] })).erreur, 'demande');
});

test('aucune donnée personnelle : ni adresse, ni prénom, ni nom saisi sur plusieurs lignes', () => {
  const profils = [{ ...ADULTE_B, nom: 'Prénom Secret', email: 'secret@example.com' }, ENFANT, ADULTE_A];
  const texte = texteDemandeIdees({
    profils,
    plats: [platRempli('x', 'Plat\nX', { notes: { 'profil-b': 5 } })],
    envie: 'Une envie',
  });
  assert.doesNotMatch(texte, /@example|Prénom Secret|Adulte|Enfant/);
  assert.doesNotMatch(texte, /Plat\nX/);
  assert.match(texte, /aimés: Plat X\n/);
});

// ——— Garde-fou : une idée déjà dans les plats n'est pas reprise ———

test('idée nouvelle : écrite comme un nouveau plat, avec ses versions mer et végétale', () => {
  const plats = [platRempli('dahl-corail', 'Dahl corail')];
  const r = importer([idee('poulet-miso-patate-douce', 'Poulet miso et patate douce')], { plats });
  assert.deepEqual(r.erreurs, []);
  const element = elementDe(r, 'poulet-miso-patate-douce');
  assert.equal(element.statut, 'nouveau');
  assert.deepEqual(element.versions.map((v) => [v.pour, v.style, v.action, v.convient]), [
    ['profil-b', 'mer', 'ajoutee', true],
    ['profil-b', 'vegetal', 'ajoutee', true],
    ['enfant', 'vegetal', 'ajoutee', true],
  ]);
  const { donnees } = ecritureDe(r, 'poulet-miso-patate-douce');
  assert.equal(donnees.source, 'Idée de Claude');
  assert.equal(donnees.statutRecette, 'brouillon');
  assert.deepEqual(donnees.variantes.map((v) => [v.pour, v.style]), [['profil-b', 'mer'], ['profil-b', 'vegetal'], ['enfant', 'vegetal']]);
  assert.equal(donnees.variantes[0].frigoJours, 2);
});

test('idée dont le nom est déjà dans les plats, avec sa recette : rien n’est écrit, un avertissement, le reste du lot s’enregistre', () => {
  const existant = platRempli('dahl-corail', 'Dahl corail', { notes: { 'profil-a': 5 } });
  const plats = [existant];
  const r = importer([
    idee('dahl-de-lentilles-corail', 'Dahl  Corail'),
    idee('poulet-miso-patate-douce', 'Poulet miso et patate douce'),
  ], { plats });
  assert.deepEqual(r.erreurs, []);
  assert.deepEqual(r.corrections, []);
  const deja = r.elements[0];
  assert.equal(deja.statut, 'deja');
  assert.equal(deja.id, 'dahl-corail');
  assert.equal(deja.nom, 'Dahl Corail');
  assert.equal(deja.index, 0);
  assert.equal(deja.ingredients, 1);
  assert.equal(deja.etapes, 2);
  assert.deepEqual(deja.versions, []);
  assert.deepEqual(deja.avertissements, ['«\u00A0Dahl corail\u00A0» est déjà dans vos plats\u00A0: cette idée n’est pas reprise.']);
  assert.equal(ecritureDe(r, 'dahl-corail'), null);
  assert.equal(ecritureDe(r, 'dahl-de-lentilles-corail'), null);
  // L'autre idée du lot : écrite.
  assert.equal(r.elements[1].statut, 'nouveau');
  assert.equal(r.elements[1].index, 1);
  assert.deepEqual(r.ecritures.map((e) => e.id), ['poulet-miso-patate-douce']);
  // Décocher l'idée gardée ne change rien.
  assert.deepEqual(filtrerPreparation(r, ['dahl-corail']).ecritures.map((e) => e.id), ['poulet-miso-patate-douce']);
});

test('idée de même identifiant et même nom qu’un plat rempli : pas reprise, demandes laissées telles quelles', () => {
  const existant = platRempli('poulet-miso-patate-douce', 'Poulet miso et patate douce');
  const demandes = [{ id: 'poulet-miso-patate-douce__profil-b', statut: 'ouverte' }];
  const r = importer([idee('poulet-miso-patate-douce', 'Poulet miso et patate douce')], { plats: [existant], demandes });
  assert.equal(r.elements[0].statut, 'deja');
  assert.deepEqual(r.ecritures, []);
  assert.deepEqual(r.demandesAClore, []);
  // Recollée à l'identique d'une idée déjà enregistrée : pas reprise non plus.
  const enregistree = { ...valides(idee('poulet-miso-patate-douce', 'Poulet miso et patate douce'))[0], modifieePar: 'a@example.com' };
  const encore = importer([idee('poulet-miso-patate-douce', 'Poulet miso et patate douce')], { plats: [enregistree] });
  assert.equal(encore.elements[0].statut, 'deja');
  assert.deepEqual(encore.ecritures, []);
});

test('idée qui vise un plat ⏳ (par son nom ou son identifiant) : elle le complète normalement', () => {
  const attente = platAttente('poulet-miso', 'Poulet miso et patate douce');
  const demandes = [{ id: 'poulet-miso__recette', statut: 'ouverte' }];
  const r = importer([idee('poulet-miso-patate-douce', 'Poulet miso et patate douce')], { plats: [attente], demandes });
  assert.deepEqual(r.erreurs, []);
  assert.equal(r.elements[0].statut, 'complete');
  assert.equal(r.elements[0].id, 'poulet-miso');
  assert.equal(ecritureDe(r, 'poulet-miso').donnees.source, 'Idée de Claude');
  assert.deepEqual(r.demandesAClore, ['poulet-miso__recette']);
  // Même identifiant, plat ⏳ d'un autre nom : complété aussi.
  const parId = importer([idee('poulet-miso', 'Poulet au miso')], { plats: [attente] });
  assert.equal(parId.elements[0].statut, 'complete');
  // Plat sans statut ni ingrédients (ajouté par son nom) : complété.
  const brouillonVide = importer([idee('poulet-miso', 'Poulet miso et patate douce')], { plats: [{ ...attente, statutRecette: 'attente' }] });
  assert.equal(brouillonVide.elements[0].statut, 'complete');
});

test('identifiant pris par un autre plat, d’un autre nom : l’idée est un nouveau plat (identifiant libre)', () => {
  const autre = platRempli('curry-doux', 'Curry de patate douce');
  const r = importer([idee('curry-doux', 'Curry doux aux pois chiches')], { plats: [autre] });
  assert.equal(r.elements[0].statut, 'nouveau');
  assert.equal(r.elements[0].id, 'curry-doux-2');
  assert.deepEqual(r.ecritures.map((e) => e.id), ['curry-doux-2']);
});

test('sans la source « Idée de Claude », ou collée depuis la fiche, le flux habituel ne change pas', () => {
  const existant = platRempli('dahl-corail', 'Dahl corail', { statutRecette: 'brouillon' });
  // Recette demandée (DEMANDE-RECETTE) : elle remplace la recette, comme avant.
  for (const source of [undefined, 'Version classique', 'Idée de Claude ?', 'idée de claude']) {
    const r = importer([idee('dahl-corail', 'Dahl corail', { source })], { plats: [existant] });
    assert.equal(r.elements[0].statut, 'remplace', String(source));
    assert.equal(r.ecritures.length, 1);
  }
  // Espaces en trop : c'est bien une idée.
  assert.equal(importer([idee('dahl-corail', 'Dahl corail', { source: '  Idée   de Claude ' })], { plats: [existant] }).elements[0].statut, 'deja');
  // « Coller la recette » depuis la fiche : la personne a choisi ce plat.
  const cible = importer([idee('dahl-corail', 'Dahl corail')], { plats: [existant], cible: 'dahl-corail' });
  assert.equal(cible.elements[0].statut, 'remplace');
});

test('réponse entière de Claude : texte, bloc, idée déjà là et idée nouvelle', () => {
  const plats = [platRempli('dahl-corail', 'Dahl corail')];
  const reponse = `Voici 2 idées.\n\n\`\`\`json\n${JSON.stringify(paquet(idee('dahl-corail', 'Dahl corail'), idee('poulet-miso-patate-douce', 'Poulet miso et patate douce')), null, 2)}\n\`\`\`\n\nÉcrivez « suite » pour les suivantes.`;
  const extrait = extrairePaquet(reponse);
  assert.ok(extrait.paquets);
  const validation = validerPaquet(extrait.paquets, { profils: PROFILS });
  assert.equal(validation.valide, true);
  assert.deepEqual(validation.plats.flatMap((p) => p.avertissements), []);
  const r = preparerImport(validation.plats.map((p) => p.donnees), { plats, demandes: [], profils: PROFILS });
  assert.deepEqual(r.elements.map((e) => e.statut), ['deja', 'nouveau']);
  assert.deepEqual(r.ecritures.map((e) => e.id), ['poulet-miso-patate-douce']);
  assert.deepEqual(r.erreurs, []);
});

// ——— Correction d'un message d'idées ———

test('message d’idées refusé : la correction redemande toutes les fiches du message, les autres telles quelles', () => {
  const sansForme = idee('poulet-sans-forme', 'Poulet sans forme', { ingredients: [{ ...POULET, forme: undefined }, PATATE, MISO, RIZ] });
  const message = [idee('idee-a', 'Idée A'), idee('idee-b', 'Idée B'), sansForme, idee('idee-d', 'Idée D'), idee('idee-e', 'Idée E')];
  assert.equal(message.length, IDEES_PAR_MESSAGE);
  const v = validerPaquet([paquet(...message)], { profils: PROFILS });
  assert.equal(v.valide, false);
  assert.equal(texteCorrectionPourClaude(v), [
    'CORRECTION paquet@1',
    `instructions: ${VERSION_INSTRUCTIONS}`,
    'id: poulet-sans-forme',
    '- plats[2] (poulet-sans-forme) ingredients[0] « haut de cuisse de poulet » : forme manquante ou inconnue pour une viande : `hachee`, `fine`, `morceaux`, `effilochable`',
    '- Rien n’a été enregistré : rends aussi, telles quelles, les autres fiches du message (idee-a, idee-b, idee-d, idee-e).',
    '(Rends toutes les fiches du message, corrigées, en un seul bloc.)',
  ].join('\n'));
  // Recoller le message d'origine bute sur la même erreur ; le message rendu corrigé s'enregistre en entier.
  assert.equal(validerPaquet([paquet(...message)], { profils: PROFILS }).valide, false);
  const corrige = importer([...message.slice(0, 2), { ...sansForme, ingredients: [POULET, PATATE, MISO, RIZ] }, ...message.slice(3)], { plats: [] });
  assert.deepEqual(corrige.erreurs, []);
  assert.deepEqual(corrige.ecritures.map((e) => e.id), ['idee-a', 'idee-b', 'poulet-sans-forme', 'idee-d', 'idee-e']);
});

test('message d’idées refusé à l’ajout (deux idées pour le même plat) : tout le message redemandé', () => {
  const v = validerPaquet([paquet(idee('idee-a', 'Idée A'), idee('idee-b', 'Idée B'))], { profils: PROFILS });
  // Forme rendue par l'écran pour une erreur de preparerImport : plats sans erreur à eux, erreur du lot.
  const probleme = { ...v, plats: v.plats.map((plat) => ({ ...plat, erreurs: [] })), erreurs: [{ pourClaude: 'id idee-a : deux recettes pour le même plat' }] };
  const lignes = texteCorrectionPourClaude(probleme).split('\n');
  assert.deepEqual(lignes.slice(2), [
    '- id idee-a : deux recettes pour le même plat',
    '- Rien n’a été enregistré : rends aussi, telles quelles, les autres fiches du message (idee-a, idee-b).',
    '(Rends toutes les fiches du message, corrigées, en un seul bloc.)',
  ]);
});

test('une seule fiche, ou des versions à revoir dans un lot enregistré : consignes inchangées', () => {
  const seule = validerPaquet([paquet(idee('poulet-sans-forme', 'Poulet sans forme', { ingredients: [{ ...POULET, forme: undefined }] }))], { profils: PROFILS });
  assert.equal(seule.valide, false);
  const texte = texteCorrectionPourClaude(seule);
  assert.doesNotMatch(texte, /Rien n’a été enregistré/);
  assert.equal(texte.split('\n').at(-1), '(Rends la fiche complète corrigée, en un seul bloc.)');
  // Versions à revoir d'un message enregistré (aperçu prêt) : seules les versions sont redemandées.
  const versions = texteCorrectionPourClaude({ corrections: [{ pourClaude: 'id idee-a variantes[pour=profil-b, style=vegetal] : contient thon (poisson)' }] });
  assert.doesNotMatch(versions, /Rien n’a été enregistré/);
  assert.equal(versions.split('\n').at(-1), '(Rends seulement { "id", "nom", "variantes" } de chaque plat corrigé, en un seul bloc.)');
});
