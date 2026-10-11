// Semaine (T3a, CLAUDE.md §6 et §9) : une période à dates fixes (`semaines/{id}`), du jour où l'on choisit ses plats à
// + 6 jours, montrée jusqu'à sa fin ; les plats choisis, leurs réglages et leurs portions ; les écritures d'un geste.
// Logique pure : ni DOM ni Firebase.
// - Défauts calculés, jamais écrits : qui en mange, la version servie (la mer d'abord) et le nombre de repas prennent
//   leur valeur à la lecture ; seul le nombre de repas touché s'écrit (`plats.<id>.repas`).
// - Écriture par chemin pointé (`plats.<id>.styles.<profilId>`, `coches.<cle>`…), jamais de tableau ni de champ
//   calculé ; retirer un plat écrit `retire: true`, l'entrée n'est jamais supprimée ; une semaine naît avec son
//   premier plat (`set` fusionné de { debut, fin, creePar, creeLe }, jamais de `statut`).
// - La liste de courses ne lit que `plats.<id>` (repas, mange, invites, styles, portionsACongeler) : coeur/liste.js.
import { correspond, slug } from './slug.js';
import { aSaRecette, typeDe } from './plats.js';
import { deNom, noteDe } from './notes.js';
import { trierProfils } from './profils.js';
import { evaluer as evaluerParDefaut, frigoJoursDe, varianteRetenue } from './compatibilite.js';
import { lignePrecautions, precautionsAge, texteBorne } from './age.js';
import { estDansCorbeille } from './corbeille.js';
import { stylesAttendus } from './regles.js';
import { EMOJIS_STYLE, LIBELLES_STYLE, STYLES } from './vocabulaire.js';

/** Valeur d'un champ à effacer : traduite en deleteField() par donnees.js, retirée par appliquerChamps. */
export const EFFACER = Object.freeze({ effacer: true });
/** Rangs figés des statuts (absent = brouillon) ; un statut ne recule jamais sans geste. */
export const RANGS_STATUT = Object.freeze({ brouillon: 0, validee: 1, courses_faites: 2, batch_fait: 3 });
export const DUREE_MAX_JOURS = 14;
/** Durée d'une semaine créée : du jour même (ou du lendemain de la précédente) à + 6 jours. */
export const DUREE_JOURS = 7;
export const REPAS_MAX = 14;
export const INVITES_MAX = 20;
/** Jours au frigo d'un plat sans durée sur sa fiche ni réglage du foyer (CLAUDE.md §2). */
export const FRIGO_JOURS_DEFAUT = 3;
/** Les deux derniers jours d'une semaine (fin aujourd'hui, demain ou après-demain) : la suivante se prépare. */
export const JOURS_AVANT_LA_FIN = 2;
/** Feuille « Ajouter à la semaine » : « Vos préférés » (notés 4 ou 5), 8 au plus. */
export const NOTE_PREFERE = 4;
export const PREFERES_MAX = 8;
/** Puces de la feuille « Ajouter à la semaine » (« Plats » d'avance ; T3e : « Apéro »). */
export const FILTRES_CHOIX = Object.freeze([
  Object.freeze({ id: 'plat', libelle: 'Plats' }),
  Object.freeze({ id: 'dessert', libelle: 'Desserts' }),
  Object.freeze({ id: 'tout', libelle: 'Tout' }),
]);

const ID_SUR = /^[a-z0-9-]+$/;
const JOUR = /^(\d{4})-(\d{2})-(\d{2})$/;
const JOUR_MS = 86_400_000;
const MOIS = ['janvier', 'février', 'mars', 'avril', 'mai', 'juin', 'juillet', 'août', 'septembre', 'octobre',
  'novembre', 'décembre'];
const JOURS_SEMAINE = ['dimanche', 'lundi', 'mardi', 'mercredi', 'jeudi', 'vendredi', 'samedi'];

const estObjet = (valeur) => Boolean(valeur) && typeof valeur === 'object' && !Array.isArray(valeur);
const listeDe = (valeur) => (Array.isArray(valeur) ? valeur : []);
const reduire = (texte) => (typeof texte === 'string' ? texte.replace(/\s+/g, ' ').trim() : '');
/** Comme reduire, mais les espaces insécables d'une quantité (« 30 g ») restent. */
const reduireQuantite = (texte) => (typeof texte === 'string' ? texte.replace(/[ \t\r\n\f\v]+/g, ' ').trim() : '');
const estNombre = (valeur) => typeof valeur === 'number' && Number.isFinite(valeur);
/** Total arrondi au millionième : les sommes flottantes ne laissent aucune trace (0,1 + 0,2). */
const arrondi = (valeur) => Math.round(valeur * 1e6) / 1e6;
const nombre = new Intl.NumberFormat('fr-FR', { maximumFractionDigits: 2 });
// Ordre des identifiants indépendant de la langue du téléphone.
const parId = (a, b) => (a < b ? -1 : a > b ? 1 : 0);
const comparerNoms = new Intl.Collator('fr', { sensitivity: 'base' }).compare;

// ——— Dates (« AAAA-MM-JJ », dates locales du téléphone ; calculs en UTC sur la date seule) ———

/** Instant UTC de minuit d'une date réelle « AAAA-MM-JJ », ou null. */
function instantDe(jour) {
  const m = typeof jour === 'string' ? JOUR.exec(jour) : null;
  if (!m) return null;
  const [a, mo, j] = [Number(m[1]), Number(m[2]), Number(m[3])];
  if (a < 1000) return null;
  const t = Date.UTC(a, mo - 1, j);
  const d = new Date(t);
  return d.getUTCFullYear() === a && d.getUTCMonth() === mo - 1 && d.getUTCDate() === j ? t : null;
}

const deux = (n) => String(n).padStart(2, '0');
function texteDeLInstant(t) {
  const d = new Date(t);
  return `${d.getUTCFullYear()}-${deux(d.getUTCMonth() + 1)}-${deux(d.getUTCDate())}`;
}

/** Vrai pour une date réelle « AAAA-MM-JJ ». */
export function jourValide(jour) {
  return instantDe(jour) !== null;
}

/** « AAAA-MM-JJ » + n jours (calcul en UTC sur la date seule : jamais de décalage d'heure d'été) ; null si illisible. */
export function ajouterJours(jour, n) {
  const t = instantDe(jour);
  if (t === null || !Number.isInteger(n)) return null;
  return texteDeLInstant(t + n * JOUR_MS);
}

/** Nombre de jours de `debut` à `fin` (fin - debut) ; null si une date est illisible. */
export function ecartJours(debut, fin) {
  const a = instantDe(debut);
  const b = instantDe(fin);
  return a === null || b === null ? null : Math.round((b - a) / JOUR_MS);
}

/**
 * Jour écrit en toutes lettres : « 16 octobre », « 1er octobre » ; `jourSemaine` : « vendredi 16 octobre » ;
 * `annee` : « 28 décembre 2026 » ; `mois: false` : « 16 » (« la semaine qui finit le 16 »). '' si illisible.
 */
export function texteJour(jour, { jourSemaine = false, mois = true, annee = false } = {}) {
  const t = instantDe(jour);
  if (t === null) return '';
  const d = new Date(t);
  const numero = d.getUTCDate() === 1 ? '1er' : String(d.getUTCDate());
  let texte = mois ? `${numero} ${MOIS[d.getUTCMonth()]}` : numero;
  if (mois && annee) texte += ` ${d.getUTCFullYear()}`;
  return jourSemaine ? `${JOURS_SEMAINE[d.getUTCDay()]} ${texte}` : texte;
}

/**
 * Dates d'une semaine : « du 10 au 16 octobre », « du 28 octobre au 3 novembre », « du 28 décembre 2026 au 3 janvier
 * 2027 », « le 10 octobre » (un seul jour) ; '' si une date est illisible.
 */
export function texteDates(debut, fin) {
  if (!jourValide(debut) || !jourValide(fin)) return '';
  if (debut === fin) return `le ${texteJour(debut)}`;
  if (debut.slice(0, 4) !== fin.slice(0, 4)) {
    return `du ${texteJour(debut, { annee: true })} au ${texteJour(fin, { annee: true })}`;
  }
  if (debut.slice(5, 7) !== fin.slice(5, 7)) return `du ${texteJour(debut)} au ${texteJour(fin)}`;
  return `du ${texteJour(debut, { mois: false })} au ${texteJour(fin)}`;
}

// ——— Lire les semaines ———

/** Statut lu : celui du document s'il est connu, sinon 'brouillon' (statut absent). */
export function statutSemaine(semaine) {
  return Object.hasOwn(RANGS_STATUT, semaine?.statut ?? '') ? semaine.statut : 'brouillon';
}

/**
 * Semaine propre lue d'un document `{ id, debut, fin, … }`, ou null (identifiant hors `^[a-z0-9-]+$`, dates
 * illisibles, fin avant debut, plus de DUREE_MAX_JOURS jours). Copie de surface : `plats`, `coches` et `racheter`
 * toujours objets ({} par défaut), `creeLe` nombre ou null, `statut` gardé seulement s'il est connu (absent =
 * brouillon, statutSemaine). Lire une semaine déjà lue rend la même chose.
 */
export function lireSemaine(doc) {
  if (!estObjet(doc) || typeof doc.id !== 'string' || !ID_SUR.test(doc.id)) return null;
  const duree = ecartJours(doc.debut, doc.fin);
  if (duree === null || duree < 0 || duree + 1 > DUREE_MAX_JOURS) return null;
  const semaine = {
    ...doc,
    plats: estObjet(doc.plats) ? doc.plats : {},
    coches: estObjet(doc.coches) ? doc.coches : {},
    racheter: estObjet(doc.racheter) ? doc.racheter : {},
    creeLe: estNombre(doc.creeLe) ? doc.creeLe : null,
  };
  if (!Object.hasOwn(RANGS_STATUT, doc.statut ?? '')) delete semaine.statut;
  return semaine;
}

/** Semaines lisibles d'une liste de documents. */
const lisibles = (semaines) => listeDe(semaines).map(lireSemaine).filter(Boolean);

/** Plus récente d'abord : debut le plus grand, puis creeLe le plus grand, puis l'identifiant. */
const plusRecenteDabord = (a, b) => (a.debut < b.debut ? 1 : a.debut > b.debut ? -1 : 0)
  || (b.creeLe ?? -Infinity) - (a.creeLe ?? -Infinity)
  || parId(b.id, a.id);

/** Vrai si au moins un plat est « dans la semaine » (estDansLaSemaine ; corbeille comprise). */
export function aDesPlats(semaine) {
  return estObjet(semaine?.plats) && Object.values(semaine.plats).some(estDansLaSemaine);
}

/**
 * Semaine à préparer, celle que Semaine et Courses montrent : la plus récente (debut le plus grand) dont la fin n'est
 * pas passée (fin ≥ aujourdhui) ; null sinon. Une semaine qui commence plus tard ne passe devant que si elle a un plat
 * (aDesPlats) : dès que la semaine suivante a un plat, les prochaines courses sont pour elle ; vidée (« Annuler », case
 * décochée), elle s'efface et la semaine en cours revient, avec sa liste.
 */
export function semaineAPreparer(semaines, aujourdhui) {
  if (!jourValide(aujourdhui)) return null;
  return lisibles(semaines).filter((s) => s.fin >= aujourdhui && (s.debut <= aujourdhui || aDesPlats(s)))
    .sort(plusRecenteDabord)[0] ?? null;
}

/**
 * Semaine en cours quand une semaine suivante est déjà montrée (ligne « En ce moment, jusqu'au 16 octobre : … ») :
 * celle qui contient aujourd'hui, autre que la semaine montrée ; null sinon (ou si la semaine montrée a commencé).
 */
export function semaineEnCours(semaines, aujourdhui) {
  const montree = semaineAPreparer(semaines, aujourdhui);
  if (!montree || montree.debut <= aujourdhui) return null;
  return lisibles(semaines)
    .filter((s) => s.id !== montree.id && s.debut <= aujourdhui && s.fin >= aujourdhui)
    .sort(plusRecenteDabord)[0] ?? null;
}

/**
 * Nouvelle semaine (§3.2 du plan) → { id, debut, fin } : du jour même à + 6 jours ; `apres` (la semaine affichée) :
 * du lendemain de sa fin à + 6 jours (jamais avant aujourd'hui). Identifiant = la date de début, ou `-2`, `-3`… si un
 * document porte déjà cet identifiant. null si `aujourdhui` est illisible.
 */
export function nouvelleSemaine(semaines, aujourdhui, { apres = null } = {}) {
  if (!jourValide(aujourdhui)) return null;
  let debut = aujourdhui;
  const lendemain = apres ? ajouterJours(apres.fin, 1) : null;
  if (lendemain && lendemain > debut) debut = lendemain;
  const fin = ajouterJours(debut, DUREE_JOURS - 1);
  const pris = new Set(listeDe(semaines).filter(estObjet).map((s) => s.id));
  let id = debut;
  for (let n = 2; pris.has(id); n += 1) id = `${debut}-${n}`;
  return { id, debut, fin };
}

/**
 * Vrai si la semaine finit dans 2 jours au plus (aujourd'hui, demain, après-demain) : « Préparer la semaine
 * suivante » est proposé, et les plats choisis vont à la suivante. Jamais vrai pour la seule raison que les courses
 * sont faites (la semaine qu'on va cuisiner resterait sinon cachée).
 */
export function peutPreparerLaSuivante(semaine, aujourdhui) {
  if (!jourValide(semaine?.fin) || !jourValide(aujourdhui)) return false;
  return semaine.fin >= aujourdhui && semaine.fin <= ajouterJours(aujourdhui, JOURS_AVANT_LA_FIN);
}

const resumeSemaine = (s) => ({ id: s.id, debut: s.debut, fin: s.fin });

/**
 * Semaine qui suit `apres` (la semaine montrée) → { id, debut, fin } : du lendemain de sa fin à + 6 jours
 * (nouvelleSemaine) ; une semaine déjà créée à ces dates, vidée depuis (« Annuler »), est reprise telle quelle (même
 * identifiant, jamais de « -2 » pour rien). null si `aujourdhui` est illisible.
 */
export function semaineSuivante(semaines, aujourdhui, apres) {
  const nouvelle = nouvelleSemaine(semaines, aujourdhui, { apres });
  if (!nouvelle) return null;
  const existante = lisibles(semaines).filter((s) => s.id !== apres?.id && s.debut === nouvelle.debut)
    .sort(plusRecenteDabord)[0];
  return existante ? resumeSemaine(existante) : nouvelle;
}

/**
 * Où vont les plats choisis (§3.2) → { id, debut, fin, nouvelle, autre } : la semaine montrée, sauf dans ses deux
 * derniers jours (peutPreparerLaSuivante) : alors la suivante (semaineSuivante ; `nouvelle: true` : elle n'a pas
 * encore de plat, elle naîtra ou reprendra avec le premier, et les articles pas pris de la semaine qui finit peuvent
 * la suivre). Aucune semaine à préparer : du jour même à + 6 jours (`nouvelle: true`). `autre` : la semaine qui finit,
 * quand la cible est la suivante (« Ajouter plutôt à la semaine qui finit le 16 ») ; null sinon. L'écran fige le
 * résultat à l'ouverture de la feuille (ou au toucher sur la fiche) et le passe à ecrituresAjout. null si
 * `aujourdhui` est illisible.
 */
export function semaineVisee(semaines, aujourdhui) {
  if (!jourValide(aujourdhui)) return null;
  const montree = semaineAPreparer(semaines, aujourdhui);
  if (!montree) return { ...nouvelleSemaine(semaines, aujourdhui), nouvelle: true, autre: null };
  if (peutPreparerLaSuivante(montree, aujourdhui)) {
    return { ...semaineSuivante(semaines, aujourdhui, montree), nouvelle: true, autre: resumeSemaine(montree) };
  }
  const enCours = semaineEnCours(semaines, aujourdhui);
  const autre = enCours && peutPreparerLaSuivante(enCours, aujourdhui) ? resumeSemaine(enCours) : null;
  return { ...resumeSemaine(montree), nouvelle: false, autre };
}

// ——— Chemins et champs ———

/** Chemin pointé sûr (« plats.gratin.styles.profil-b »), ou null si une clé n'est pas `^[a-z0-9-]+$`. */
export function cheminSur(...cles) {
  if (!cles.length || !cles.every((cle) => typeof cle === 'string' && ID_SUR.test(cle))) return null;
  return cles.join('.');
}

const CLE_DE_CHAMP = /^[A-Za-z0-9-]+$/;
const CLES_INTERDITES = new Set(['__proto__', 'prototype', 'constructor']);
const cleDeChampSure = (cle) => CLE_DE_CHAMP.test(cle) && !CLES_INTERDITES.has(cle);

/** Vrai pour une valeur écrivable : ni undefined, ni NaN, ni tableau vide (à toute profondeur) ; EFFACER permis. */
function valeurSure(valeur) {
  if (valeur === undefined || (typeof valeur === 'number' && !Number.isFinite(valeur))) return false;
  if (valeur === EFFACER) return true;
  if (Array.isArray(valeur)) return valeur.length > 0 && valeur.every(valeurSure);
  if (estObjet(valeur)) return Object.entries(valeur).every(([cle, v]) => cleDeChampSure(cle) && valeurSure(v));
  return true;
}

/**
 * Vrai si chaque champ d'une écriture est sûr : chemin pointé de clés `[A-Za-z0-9-]` (aucune clé vide), valeur ni
 * undefined, ni NaN, ni tableau vide. donnees.js refuse l'écriture avant l'envoi sinon.
 */
export function champsValides(champs) {
  if (!estObjet(champs)) return false;
  return Object.entries(champs).every(([chemin, valeur]) => chemin.split('.').every(cleDeChampSure) && valeurSure(valeur));
}

/**
 * Copie de la semaine avec des champs pointés appliqués (EFFACER retire le champ), pour l'affichage immédiat, comme
 * notes.js › avecNote. L'original reste intact ; un chemin illisible est ignoré.
 */
export function appliquerChamps(semaine, champs) {
  const copie = estObjet(semaine) ? { ...semaine } : {};
  for (const [chemin, valeur] of Object.entries(estObjet(champs) ? champs : {})) {
    const cles = chemin.split('.');
    if (!cles.every(cleDeChampSure)) continue;
    let noeud = copie;
    for (const cle of cles.slice(0, -1)) {
      noeud[cle] = estObjet(noeud[cle]) ? { ...noeud[cle] } : {};
      noeud = noeud[cle];
    }
    const derniere = cles[cles.length - 1];
    if (valeur === EFFACER) delete noeud[derniere];
    else noeud[derniere] = valeur;
  }
  return copie;
}

// ——— Qui en mange, version servie, repas ———

/** Portion d'un profil (1 adulte, 0,5 enfant) ; 1 si elle est illisible. */
export function coefDe(profil) {
  return estNombre(profil?.coefPortion) && profil.coefPortion > 0 ? profil.coefPortion : 1;
}

/**
 * Version servie à ce profil → null (il mange la recette) | { variante (forme de compatibilite.js › varianteRetenue),
 * style, frigoJours (ou null), auChoix: [styles qui conviennent, mer d'abord], nomme }.
 * null dès que `evaluer(plat, profil).variante` est null : un profil sans règle évaluée (passé à « Mange de tout ») ou
 * à qui la recette convient telle quelle (recette rendue sans viande par « Modifier ») mange la recette, même si la
 * fiche garde d'anciennes versions pour lui. Sinon, parmi les versions qui conviennent : le style choisi (`choix`) s'il
 * convient encore, sinon la mer, sinon la première.
 * `style` est toujours là (déduit au besoin : il sert au choix) ; `nomme` dit s'il s'affiche : le profil attend des
 * styles pour ce plat (regles.js › stylesAttendus), ou la version porte un style écrit. Un profil sans styles (une
 * règle « pas de tomate ») a « sa version », jamais une « version végétale » déduite.
 */
export function versionServie(plat, profil, choix = null, evaluer = evaluerParDefaut) {
  const resultat = (typeof evaluer === 'function' ? evaluer : evaluerParDefaut)(plat, profil);
  if (!resultat?.variante) return null;
  const conviennent = listeDe(resultat.versions).filter((v) => v?.convient && estObjet(v.variante));
  if (!conviennent.length) return null;
  const auChoix = STYLES.filter((style) => conviennent.some((v) => v.style === style));
  const retenue = (STYLES.includes(choix) && conviennent.find((v) => v.style === choix))
    || conviennent.find((v) => v.style === 'mer') || conviennent[0];
  const variante = varianteRetenue(retenue.variante);
  const nomme = STYLES.includes(retenue.variante?.style) || stylesAttendus(profil, plat).length > 0;
  return { variante, style: variante.style, frigoJours: frigoJoursDe(retenue.variante), auChoix, nomme };
}

/**
 * Le profil en mange-t-il, par défaut ? Dans cet ordre : noté « Jamais » → { mange: false, raison: 'jamais' } ; plat
 * avec recette et `evaluer` exclu (aucune version ne convient) → 'version' ; précaution d'âge « Pas avant… » sur le
 * plat tel qu'il lui est servi (age.js › precautionsAge, avec la version servie) → 'age', avec `precautions` (celles
 * qui l'écartent) ; sinon { mange: true, raison: null }. Plat ⏳ (sans recette) : tout le monde, sauf « Jamais ».
 * `choix` : le style choisi pour lui dans la semaine (version servie).
 */
export function mangeParDefaut(plat, profil, { evaluer = evaluerParDefaut, choix = null } = {}) {
  if (typeof profil?.id === 'string' && noteDe(plat, profil.id) === 0) return { mange: false, raison: 'jamais' };
  if (!aSaRecette(plat)) return { mange: true, raison: null };
  const evaluation = typeof evaluer === 'function' ? evaluer : evaluerParDefaut;
  if (evaluation(plat, profil)?.niveau === 'exclu') return { mange: false, raison: 'version' };
  const servie = versionServie(plat, profil, choix, evaluation);
  const exclues = precautionsAge(plat, profil, { variante: servie?.variante ?? null }).filter((p) => p.severite === 'exclu');
  if (exclues.length) return { mange: false, raison: 'age', precautions: exclues };
  return { mange: true, raison: null };
}

/** Portions de base lisibles d'une recette, ou null. */
function portionsBaseDe(plat) {
  return estNombre(plat?.portionsBase) && plat.portionsBase > 0 ? plat.portionsBase : null;
}

/**
 * Repas par défaut : la recette telle quelle pour le foyer, arrondie au repas, entre 1 et REPAS_MAX :
 * round(portionsBase ÷ parRepasFoyer), où parRepasFoyer = Σ coefPortion des profils qui en mangent, sans les invités
 * (un invité ajoute des portions, jamais ne retire un repas) ; 1 sans portionsBase ou si aucun profil n'en mange.
 */
export function repasParDefaut(plat, parRepasFoyer) {
  const base = portionsBaseDe(plat);
  if (base === null || !estNombre(parRepasFoyer) || parRepasFoyer <= 0) return 1;
  return Math.min(REPAS_MAX, Math.max(1, Math.round(arrondi(base / parRepasFoyer))));
}

/** Entier borné, ou null s'il est illisible. */
function entierBorne(valeur, min, max) {
  if (!estNombre(valeur)) return null;
  return Math.min(max, Math.max(min, Math.round(valeur)));
}

/** Vrai si l'entrée d'un plat est « dans la semaine » : `ajouteLe` est un nombre et `retire` n'est pas vrai. */
export function estDansLaSemaine(entree) {
  return estObjet(entree) && estNombre(entree.ajouteLe) && entree.retire !== true;
}

/** Identifiants des plats dans la semaine (pastille « 🗓️ Au menu » de Plats), corbeille comprise. */
export function idsDansLaSemaine(semaine) {
  const plats = estObjet(semaine?.plats) ? semaine.plats : {};
  return new Set(Object.keys(plats).filter((id) => ID_SUR.test(id) && estDansLaSemaine(plats[id])));
}

/** Jours au frigo d'une fiche : entier de 1 à 30, sinon null. */
function frigoJoursDuPlat(plat) {
  const jours = plat?.conservation?.frigoJours;
  return Number.isInteger(jours) && jours >= 1 && jours <= 30 ? jours : null;
}

/** Jours au frigo par défaut du foyer (`reglages.frigoJoursDefaut`, sinon 3). */
function frigoJoursDuFoyer(reglages) {
  const jours = reglages?.frigoJoursDefaut;
  return Number.isInteger(jours) && jours >= 1 && jours <= 30 ? jours : FRIGO_JOURS_DEFAUT;
}

/**
 * Plats de la semaine, prêts pour l'écran et la liste, dans l'ordre d'ajout (`ajouteLe`, puis l'identifiant) ; seules
 * les entrées « dans la semaine » (estDansLaSemaine). `tousLesPlats` : corbeille comprise. Chaque élément :
 * { platId, plat (null si introuvable), etat: 'ok' | 'sansRecette' | 'corbeille' | 'absent', ajouteLe,
 *   mangeurs: [{ profil, mange, parDefaut, raison, precautions? }] (ordre de trierProfils ; `mange` : le choix écrit
 *     `mange.<p>` (T3c) s'il existe, sinon le défaut ; `raison` : celle du défaut, mangeParDefaut),
 *   invites: { adultes, enfants }, repas, repasParDefaut, repasTouche (repas écrit),
 *   parRepasFoyer (Σ coefPortion des profils qui en mangent), parRepas (+ invités adultes + 0,5 × invités enfants),
 *   aCuire (parRepas × repas), aCongeler (portionsACongeler, 0 si absent),
 *   versions: [{ profil, variante, style, frigoJours, auChoix }] (profils qui en mangent avec une version servie),
 *   conservation: { jours, limite: null | { profil, style, jours } } }.
 * Plat de la corbeille ou introuvable : aucun mangeur, aucune portion, `conservation` null (il revient avec ses
 * réglages s'il est remis). Plat ⏳ : tout le monde (sauf « Jamais »), aucune version.
 */
export function platsDeLaSemaine(semaine, { tousLesPlats = [], profils = [], evaluer = evaluerParDefaut, reglages = null } = {}) {
  const entrees = estObjet(semaine?.plats) ? semaine.plats : {};
  const parIdentifiant = new Map(listeDe(tousLesPlats).filter((p) => estObjet(p) && typeof p.id === 'string')
    .map((p) => [p.id, p]));
  const tries = trierProfils(listeDe(profils).filter((p) => estObjet(p) && typeof p.id === 'string' && p.id !== ''));
  const joursDuFoyer = frigoJoursDuFoyer(reglages);
  const elements = [];
  for (const [platId, entree] of Object.entries(entrees)) {
    if (!ID_SUR.test(platId) || !estDansLaSemaine(entree)) continue;
    const plat = parIdentifiant.get(platId) ?? null;
    let etat = 'ok';
    if (!plat) etat = 'absent';
    else if (estDansCorbeille(plat)) etat = 'corbeille';
    else if (!aSaRecette(plat)) etat = 'sansRecette';
    const element = {
      platId, plat, etat, ajouteLe: entree.ajouteLe,
      mangeurs: [], invites: { adultes: 0, enfants: 0 }, repas: 0, repasParDefaut: 0, repasTouche: false,
      parRepasFoyer: 0, parRepas: 0, aCuire: 0, aCongeler: 0, versions: [], conservation: null,
    };
    if (etat === 'absent' || etat === 'corbeille') {
      elements.push(element);
      continue;
    }
    const styles = estObjet(entree.styles) ? entree.styles : {};
    const choixMange = estObjet(entree.mange) ? entree.mange : {};
    element.mangeurs = tries.map((profil) => {
      const defaut = mangeParDefaut(plat, profil, { evaluer, choix: styles[profil.id] ?? null });
      const ecrit = typeof choixMange[profil.id] === 'boolean' ? choixMange[profil.id] : null;
      return {
        profil, mange: ecrit ?? defaut.mange, parDefaut: defaut.mange, raison: defaut.raison,
        ...(defaut.precautions ? { precautions: defaut.precautions } : {}),
      };
    });
    const invites = estObjet(entree.invites) ? entree.invites : {};
    element.invites = {
      adultes: entierBorne(invites.adultes, 0, INVITES_MAX) ?? 0,
      enfants: entierBorne(invites.enfants, 0, INVITES_MAX) ?? 0,
    };
    element.parRepasFoyer = arrondi(element.mangeurs.filter((m) => m.mange).reduce((s, m) => s + coefDe(m.profil), 0));
    element.parRepas = arrondi(element.parRepasFoyer + element.invites.adultes + 0.5 * element.invites.enfants);
    element.repasParDefaut = repasParDefaut(plat, element.parRepasFoyer);
    const repasEcrit = entierBorne(entree.repas, 1, REPAS_MAX);
    element.repasTouche = repasEcrit !== null;
    element.repas = repasEcrit ?? element.repasParDefaut;
    element.aCuire = arrondi(element.parRepas * element.repas);
    element.aCongeler = estNombre(entree.portionsACongeler) && entree.portionsACongeler > 0 ? arrondi(entree.portionsACongeler) : 0;
    for (const mangeur of element.mangeurs) {
      if (!mangeur.mange) continue;
      const servie = versionServie(plat, mangeur.profil, styles[mangeur.profil.id] ?? null, evaluer);
      if (servie) element.versions.push({ profil: mangeur.profil, ...servie });
    }
    const jours = frigoJoursDuPlat(plat) ?? joursDuFoyer;
    let limite = null;
    for (const version of element.versions) {
      if (version.frigoJours !== null && version.frigoJours < jours && (!limite || version.frigoJours < limite.jours)) {
        limite = { profil: version.profil, style: version.nomme ? version.style : null, jours: version.frigoJours };
      }
    }
    element.conservation = { jours, limite };
    elements.push(element);
  }
  return elements.sort((a, b) => a.ajouteLe - b.ajouteLe || parId(a.platId, b.platId));
}

// ——— Écritures d'un geste ———

/** Préfixe des articles nés des restes d'une semaine : `reste--<semaine>--<produit>`. */
export const PREFIXE_RESTE = 'reste--';

/**
 * Identifiant d'un article des restes, fixé par la semaine qui le reçoit et le produit (`reste--2026-10-17--beurre`) :
 * deux téléphones qui créent la même semaine écrivent le même document (set fusionné), jamais deux. '' si une clé est
 * hors `^[a-z0-9-]+$`.
 */
export function idReste(semaineId, produitId) {
  return typeof semaineId === 'string' && ID_SUR.test(semaineId) && typeof produitId === 'string' && ID_SUR.test(produitId)
    ? `${PREFIXE_RESTE}${semaineId}--${produitId}` : '';
}

/**
 * Articles des restes gardés (liste.js › restes) : { id, libelle, precision?, creePar?, creeLe } ; `id` : idReste
 * (absent sans produit lisible : identifiant tiré par donnees.js) ; un produit n'apparaît qu'une fois.
 */
function articlesDesRestes(restes, { semaineId, auteur, maintenant }) {
  const articles = [];
  const vus = new Set();
  for (const reste of listeDe(restes)) {
    const libelle = reduire(reste?.libelle).slice(0, 60).trim();
    if (!libelle) continue;
    const id = idReste(semaineId, reste?.produitId);
    if (id && vus.has(id)) continue;
    if (id) vus.add(id);
    const precision = reduireQuantite(reste?.precision).slice(0, 40).trim();
    articles.push({
      ...(id ? { id } : {}),
      libelle,
      ...(precision ? { precision } : {}),
      ...(reduire(auteur) ? { creePar: reduire(auteur) } : {}),
      creeLe: maintenant,
    });
  }
  return articles;
}

/**
 * Vrai si ce plat peut aller dans la semaine par « ＋ Ajouter à la semaine » et la feuille de choix : un plat actif
 * (jamais de la corbeille), avec un nom, ni apéro (T3e), ni préparation de chaque semaine (T3d) ; les ⏳ permis.
 */
export function peutAllerDansLaSemaine(plat) {
  if (!estObjet(plat) || typeof plat.id !== 'string' || reduire(plat.nom) === '' || estDansCorbeille(plat)) return false;
  const type = typeDe(plat);
  return type !== 'apero' && !(type === 'preparation' && plat.recurrence === 'hebdo');
}

/**
 * Écritures de l'ajout d'un plat → { creation?: { id, donnees }, id, champs, articles?: [{ id?, ...donnees }] }, ou
 * { code } : 'chargement' (semaines pas encore lues : jamais de nouvelle semaine sans elles), 'invalide' (identifiant,
 * cible ou heure illisible ; `plat` donné qui ne peut pas aller dans la semaine : peutAllerDansLaSemaine), 'deja'
 * (déjà dans la semaine visée ; `id`).
 * `cible` : la semaine visée, figée par l'écran (semaineVisee) ; sans elle, semaineVisee(semaines, aujourdhui). Le plat
 * va toujours dans la cible, même si une autre semaine est apparue entre-temps. Si aucune semaine lisible ne porte
 * l'identifiant de la cible, elle est créée dans le même lot : `creation.donnees` = { debut, fin, creePar, creeLe }
 * seulement (set fusionné, jamais de statut). Si la cible n'a encore aucun plat (créée ici, ou vidée depuis), les
 * `restes` (liste.js › restes) deviennent des articles du même lot, d'identifiant fixe (idReste : un second envoi
 * réécrit les mêmes documents). `champs` : `plats.<id>.ajouteLe` (maintenant, l'heure du téléphone) et
 * `plats.<id>.retire` effacé (un plat retiré revient avec ses réglages).
 */
export function ecrituresAjout(semaines, platId, {
  cible = null, semainesChargees = false, aujourdhui = null, auteur = null, maintenant = null, restes = [], plat = null,
} = {}) {
  if (!semainesChargees) return { code: 'chargement' };
  if (!cheminSur('plats', platId) || !estNombre(maintenant)) return { code: 'invalide' };
  if (plat !== null && (plat?.id !== platId || !peutAllerDansLaSemaine(plat))) return { code: 'invalide' };
  const visee = cible ?? semaineVisee(semaines, aujourdhui);
  const dureeVisee = ecartJours(visee?.debut, visee?.fin);
  if (!visee || typeof visee.id !== 'string' || !ID_SUR.test(visee.id) || dureeVisee === null || dureeVisee < 0
    || dureeVisee + 1 > DUREE_MAX_JOURS) {
    return { code: 'invalide' };
  }
  const existante = lisibles(semaines).find((s) => s.id === visee.id) ?? null;
  if (existante && estDansLaSemaine(existante.plats[platId])) return { code: 'deja', id: visee.id };
  const resultat = {
    id: visee.id,
    champs: { [`plats.${platId}.ajouteLe`]: maintenant, [`plats.${platId}.retire`]: EFFACER },
  };
  if (!existante) {
    const donnees = { debut: visee.debut, fin: visee.fin };
    if (reduire(auteur)) donnees.creePar = reduire(auteur);
    donnees.creeLe = maintenant;
    resultat.creation = { id: visee.id, donnees };
  }
  if (!existante || !aDesPlats(existante)) {
    const articles = articlesDesRestes(restes, { semaineId: visee.id, auteur, maintenant });
    if (articles.length) resultat.articles = articles;
  }
  return resultat;
}

/**
 * Articles des restes d'une semaine encore à acheter (identifiant `reste--<semaine>--…`, pas cochés) : ceux qu'un
 * retrait qui la vide emporte avec lui. → [identifiant]
 */
export function restesDeLaSemaine(semaine, articles) {
  const prefixe = typeof semaine?.id === 'string' && ID_SUR.test(semaine.id) ? `${PREFIXE_RESTE}${semaine.id}--` : null;
  if (!prefixe) return [];
  return listeDe(articles).filter((a) => estObjet(a) && typeof a.id === 'string' && a.id.startsWith(prefixe) && !estObjet(a.coche))
    .map((a) => a.id);
}

/**
 * Retirer un plat (« Retirer de la semaine », « Annuler » d'un ajout, case décochée) → { id, champs:
 * { plats.<id>.retire: true }, supprimer? } ; l'entrée reste. Si ce retrait vide une semaine qui commence plus tard
 * (`aujourdhui`), elle s'efface de l'écran (semaineAPreparer) : ses articles des restes pas encore cochés (`articles`,
 * restesDeLaSemaine) partent avec elle (`supprimer`), sinon ils doubleraient la liste de la semaine en cours qui
 * revient ; un ajout les rapporte.
 */
export function ecrituresRetrait(semaine, platId, { articles = [], aujourdhui = null } = {}) {
  const lue = lireSemaine(semaine);
  if (!lue || !cheminSur('plats', platId) || !estObjet(lue.plats[platId])) return { code: 'invalide' };
  const resultat = { id: lue.id, champs: { [`plats.${platId}.retire`]: true } };
  const apres = appliquerChamps(lue, resultat.champs);
  if (jourValide(aujourdhui) && lue.debut > aujourdhui && !aDesPlats(apres)) {
    const supprimer = restesDeLaSemaine(lue, articles);
    if (supprimer.length) resultat.supprimer = supprimer;
  }
  return resultat;
}

/**
 * Remettre un plat retiré (« Annuler ») : nouvel `ajouteLe`, `retire` effacé, réglages gardés ; `remettre` : les
 * articles des restes que le retrait avait emportés ({ id, ...donnees }), rendus tels quels dans le même lot.
 */
export function ecrituresRemise(semaine, platId, { maintenant = null, remettre = [] } = {}) {
  const lue = lireSemaine(semaine);
  if (!lue || !cheminSur('plats', platId) || !estNombre(maintenant)) return { code: 'invalide' };
  const resultat = { id: lue.id, champs: { [`plats.${platId}.ajouteLe`]: maintenant, [`plats.${platId}.retire`]: EFFACER } };
  const articles = listeDe(remettre).filter((a) => estObjet(a) && typeof a.id === 'string' && a.id.startsWith(PREFIXE_RESTE))
    .map(({ id, libelle, precision, creePar, creeLe }) => ({
      id, libelle,
      ...(typeof precision === 'string' && precision ? { precision } : {}),
      ...(typeof creePar === 'string' && creePar ? { creePar } : {}),
      creeLe,
    }))
    .filter((a) => typeof a.libelle === 'string' && a.libelle.trim() !== '' && estNombre(a.creeLe));
  if (articles.length) resultat.articles = articles;
  return resultat;
}

/**
 * Mer / Végétale pour un profil → { id, champs: { plats.<id>.styles.<p>: style | EFFACER } } : le style par défaut
 * (la mer si elle convient, sinon la seule version) efface le chemin. Avec `profils` et `tousLesPlats`, un style qui ne
 * convient pas est refusé ({ code: 'style' }) ; sans eux, seule la mer efface.
 */
export function ecrituresStyle(semaine, platId, profilId, style, { evaluer = evaluerParDefaut, tousLesPlats = [], profils = [] } = {}) {
  const lue = lireSemaine(semaine);
  const chemin = cheminSur('plats', platId, 'styles', profilId);
  if (!lue || !chemin || !STYLES.includes(style)) return { code: 'invalide' };
  const plat = listeDe(tousLesPlats).find((p) => p?.id === platId) ?? null;
  const profil = listeDe(profils).find((p) => p?.id === profilId) ?? null;
  let defaut = 'mer';
  if (plat && profil) {
    const servie = versionServie(plat, profil, null, evaluer);
    if (servie) {
      if (!servie.auChoix.includes(style)) return { code: 'style' };
      defaut = servie.style;
    }
  }
  return { id: lue.id, champs: { [chemin]: style === defaut ? EFFACER : style } };
}

/**
 * Réglage d'un plat de la semaine → { id, champs }. T3a : seulement `repas` (entier borné de 1 à REPAS_MAX, écrit
 * même s'il vaut le défaut du moment : un profil ajouté ou écarté ensuite ne le fait plus bouger ; null → EFFACER,
 * revenir au défaut). T3c y ajoute `mange` et `invites`. { code: 'invalide' } sinon.
 */
export function ecrituresReglage(semaine, platId, reglage, { evaluer = evaluerParDefaut, tousLesPlats = [], profils = [] } = {}) {
  const lue = lireSemaine(semaine);
  if (!lue || !cheminSur('plats', platId) || !estObjet(reglage)) return { code: 'invalide' };
  const champs = {};
  if (Object.hasOwn(reglage, 'repas')) {
    if (reglage.repas === null) champs[`plats.${platId}.repas`] = EFFACER;
    else if (estNombre(reglage.repas)) champs[`plats.${platId}.repas`] = entierBorne(reglage.repas, 1, REPAS_MAX);
    else return { code: 'invalide' };
  }
  if (!Object.keys(champs).length) return { code: 'invalide' };
  return { id: lue.id, champs };
}

// ——— Feuille « Ajouter à la semaine » ———

/**
 * Plats proposés par la feuille « Ajouter à la semaine » → { titrePreferes, preferes, tous, nouveau, corbeille,
 * aucun } :
 * - candidats : plats qui peuvent aller dans la semaine (peutAllerDansLaSemaine : jamais la corbeille, ni apéro, ni
 *   préparation de chaque semaine ; les ⏳ permis) ; puce `filtre` ('plat', 'dessert' ou 'tout') sans recherche ; une
 *   recherche (sans accents, slug.js › correspond) cherche dans tous les types, la puce n'y change rien (un dessert
 *   tapé sous « Plats » est trouvé) ;
 * - « Vos préférés » : notés 4 ou 5 par `moi`, par note puis par nom, 8 au plus ; sans `moi`, « Les préférés de la
 *   maison » : notés 4 ou 5 par un profil du foyer (meilleure note) ;
 * - `tous` : les autres, de A à Z (un plat n'apparaît qu'une fois) ;
 * - `nouveau` : la recherche, si aucun plat, corbeille comprise, ne porte exactement ce nom (« ＋ Nouveau plat :
 *   « Tarte tatin » ») ;
 * - `corbeille` : le plat de la corbeille qui porte exactement ce nom (« « X » est dans la corbeille… »), sinon null ;
 * - `aucun` : une recherche que rien ne trouve, ni plat actif ni plat de la corbeille de ce nom (« Aucun plat ne
 *   s'appelle ainsi. »).
 */
export function platsAChoisir(plats, { moi = null, profils = [], recherche = '', filtre = 'plat' } = {}) {
  const nommes = listeDe(plats).filter((p) => estObjet(p) && typeof p.id === 'string' && reduire(p.nom) !== '');
  const actifs = nommes.filter((p) => !estDansCorbeille(p));
  const cherche = reduire(recherche);
  const candidats = actifs.filter((p) => {
    if (!peutAllerDansLaSemaine(p)) return false;
    if (!cherche && (filtre === 'plat' || filtre === 'dessert')) return typeDe(p) === filtre;
    return true;
  }).filter((p) => correspond(p.nom, recherche));
  const ids = moi && typeof moi.id === 'string' ? [moi.id]
    : listeDe(profils).filter((p) => estObjet(p) && typeof p.id === 'string').map((p) => p.id);
  const noteDuPlat = (plat) => Math.max(-1, ...ids.map((id) => noteDe(plat, id) ?? -1));
  const parNom = (a, b) => comparerNoms(reduire(a.nom), reduire(b.nom)) || parId(a.id, b.id);
  const preferes = candidats.filter((p) => noteDuPlat(p) >= NOTE_PREFERE)
    .sort((a, b) => noteDuPlat(b) - noteDuPlat(a) || parNom(a, b)).slice(0, PREFERES_MAX);
  const dansPreferes = new Set(preferes.map((p) => p.id));
  const tous = candidats.filter((p) => !dansPreferes.has(p.id)).sort(parNom);
  const cle = cherche ? slug(cherche) : '';
  const nouveau = cle && !nommes.some((p) => slug(p.nom) === cle) ? cherche : null;
  const corbeille = cle && !actifs.some((p) => slug(p.nom) === cle)
    ? nommes.find((p) => estDansCorbeille(p) && slug(p.nom) === cle) ?? null : null;
  return {
    titrePreferes: moi ? 'Vos préférés' : 'Les préférés de la maison',
    preferes,
    tous,
    nouveau,
    corbeille,
    aucun: Boolean(cherche) && !candidats.length && !corbeille && !actifs.some((p) => correspond(p.nom, recherche)),
  };
}

// ——— Textes de la carte d'un plat et de sa feuille ———

const nomDe = (profil) => reduire(profil?.nom) || 'Sans prénom';
const estMoi = (profil, moi) => Boolean(moi) && typeof moi.id === 'string' && moi.id === profil?.id;
/** « a et b », « a, b et c » ; `ni` : « a ni b », « a, b ni c ». */
function enumerer(mots, lien = 'et') {
  return mots.length > 1 ? `${mots.slice(0, -1).join(', ')} ${lien} ${mots[mots.length - 1]}` : mots.join('');
}
/** « 1,5 portion », « 5 portions » (singulier sous 2). */
const textePortions = (n) => `${nombre.format(n)}\u00A0${n < 2 ? 'portion' : 'portions'}`;
const texteRepas = (n) => `${nombre.format(n)}\u00A0repas`;
const majuscule = (texte) => texte.charAt(0).toUpperCase() + texte.slice(1);

export const TEXTE_PERSONNE = 'Personne n’en mange\u00A0: il n’est pas dans les courses.';
export const TEXTE_SANS_RECETTE = '⏳ Pas encore de recette\u00A0: ajoutez ses ingrédients à la main dans les courses.';

/**
 * Résumé d'un plat de la semaine (carte) : « Tout le monde · 2 repas · 5 portions », « Adulte A et Enfant · 3 repas ·
 * 4,5 portions », « Personne n'en mange : il n'est pas dans les courses. » ; avec des invités (T3c) : « Tout le monde
 * et 2 invités · … ». null pour un plat ⏳, de la corbeille ou introuvable (pas de résumé de portions).
 */
export function resumePlat(element) {
  if (!element || element.etat !== 'ok') return null;
  const mangent = listeDe(element.mangeurs).filter((m) => m.mange);
  const nbInvites = (element.invites?.adultes ?? 0) + (element.invites?.enfants ?? 0);
  if (!(element.aCuire > 0)) return TEXTE_PERSONNE;
  const qui = [];
  if (mangent.length && mangent.length === element.mangeurs.length) qui.push('Tout le monde');
  else if (mangent.length) qui.push(enumerer(mangent.map((m) => nomDe(m.profil))));
  if (nbInvites) qui.push(`${nbInvites}\u00A0${nbInvites > 1 ? 'invités' : 'invité'}`);
  return `${qui.join(' et ')} · ${texteRepas(element.repas)} · ${textePortions(element.aCuire)}`;
}

/**
 * Phrase des portions de la feuille du plat (`role="status"`) : « 5 portions à cuisiner. La recette en fait 4 : les
 * quantités suivent. » ; « 4 portions à cuisiner, comme la recette. » ; « Personne n'en mange : il n'est pas dans les
 * courses. ». null pour un plat ⏳, de la corbeille ou introuvable.
 */
export function phrasePortions(element) {
  if (!element || element.etat !== 'ok') return null;
  if (!(element.aCuire > 0)) return TEXTE_PERSONNE;
  const base = portionsBaseDe(element.plat);
  const aCuire = `${textePortions(element.aCuire)} à cuisiner`;
  if (base === null) return `${aCuire}.`;
  if (element.aCuire === base) return `${aCuire}, comme la recette.`;
  return `${aCuire}. La recette en fait ${nombre.format(base)}\u00A0: les quantités suivent.`;
}

/** « pas avant 1 an (miel) » ; gestionnaire : « ❌ Pas avant 1 an : miel ». */
function texteEcarteAge(precautions, role) {
  const resume = lignePrecautions(precautions);
  if (!resume) return '';
  const borne = estNombre(resume.jusquAMois) && resume.jusquAMois > 0 ? texteBorne(resume.jusquAMois) : '';
  const courts = listeDe(resume.courts).filter(Boolean).join(', ');
  const autres = resume.autres > 1 ? ` + ${resume.autres}\u00A0autres` : resume.autres === 1 ? ' + 1\u00A0autre' : '';
  if (role === 'gestionnaire') return `❌ ${borne ? `Pas avant ${borne}` : 'À éviter'}\u00A0: ${courts}${autres}`;
  return `${borne ? `pas avant ${borne}` : 'à éviter'} (${courts}${autres})`;
}

/**
 * Ligne d'exception de la carte d'un plat (une seule, ou null), dans cet ordre :
 * - ⏳ : « ⏳ Pas encore de recette : ajoutez ses ingrédients à la main dans les courses. » ;
 * - un profil écarté : « Sans Adulte B : pas encore de version. » (pour soi : « Sans vous : pas encore de version pour
 *   vous. ») ; « Sans Adulte A (« Jamais »). » ; « 🧸 Sans Enfant : pas avant 1 an (miel). » (gestionnaire : « 🧸 Sans
 *   Enfant : ❌ Pas avant 1 an : miel. ») ; écarté à la main (T3c) : « Sans Adulte A. » ;
 * - plusieurs : « Sans Adulte A ni Enfant. Touchez le plat pour voir pourquoi. ».
 * Jamais de croix dans la vue « Repas et courses » (`role` autre que 'gestionnaire').
 */
export function exceptionPlat(element, { moi = null, role = null } = {}) {
  if (!element) return null;
  if (element.etat === 'sansRecette') return TEXTE_SANS_RECETTE;
  if (element.etat !== 'ok') return null;
  const ecartes = listeDe(element.mangeurs).filter((m) => !m.mange);
  if (!ecartes.length) return null;
  const qui = (m) => (estMoi(m.profil, moi) ? 'vous' : nomDe(m.profil));
  if (ecartes.length > 1) return `Sans ${enumerer(ecartes.map(qui), 'ni')}. Touchez le plat pour voir pourquoi.`;
  const [m] = ecartes;
  const moiMeme = estMoi(m.profil, moi);
  if (m.raison === 'version') {
    return moiMeme ? 'Sans vous\u00A0: pas encore de version pour vous.' : `Sans ${qui(m)}\u00A0: pas encore de version.`;
  }
  if (m.raison === 'jamais') return `Sans ${qui(m)} («\u00A0Jamais\u00A0»).`;
  if (m.raison === 'age') {
    const age = texteEcarteAge(m.precautions, role);
    if (age) return `🧸 Sans ${qui(m)}\u00A0: ${age}.`;
  }
  return `Sans ${qui(m)}.`;
}

/**
 * Raisons des profils écartés, une phrase chacun (feuille du plat) : « Adulte B : pas encore de version. »,
 * « Enfant : 🧸 pas avant 1 an (miel). » (gestionnaire : « Enfant : 🧸 ❌ Pas avant 1 an : miel. »), « Adulte A a dit
 * « Jamais ». », écarté à la main : « Adulte A n'en mange pas. » ; pour soi : « Pas encore de version pour vous. »,
 * « Vous avez dit « Jamais ». », « Vous n'en mangez pas. ». → [{ profil, texte }]
 */
export function raisonsEcartes(element, { moi = null, role = null } = {}) {
  if (!element || element.etat !== 'ok') return [];
  return listeDe(element.mangeurs).filter((m) => !m.mange).map((m) => {
    const moiMeme = estMoi(m.profil, moi);
    const nom = nomDe(m.profil);
    let texte;
    if (m.raison === 'version') texte = moiMeme ? 'Pas encore de version pour vous.' : `${nom}\u00A0: pas encore de version.`;
    else if (m.raison === 'jamais') texte = moiMeme ? 'Vous avez dit «\u00A0Jamais\u00A0».' : `${nom} a dit «\u00A0Jamais\u00A0».`;
    else if (m.raison === 'age' && texteEcarteAge(m.precautions, role)) {
      texte = `${moiMeme ? 'Vous' : nom}\u00A0: 🧸 ${texteEcarteAge(m.precautions, role)}.`;
    } else texte = moiMeme ? 'Vous n’en mangez pas.' : `${nom} n’en mange pas.`;
    return { profil: m.profil, texte };
  });
}

/** Légende du choix de version : « Pour Adulte B : », « Pour vous : ». */
export function legendeVersion(profil, { moi = null } = {}) {
  return estMoi(profil, moi) ? 'Pour vous\u00A0:' : `Pour ${nomDe(profil)}\u00A0:`;
}

/** Libellé d'une option : « 🐟 Mer », « 🌿 Végétale ». */
export function libelleStyle(style) {
  return STYLES.includes(style) ? `${EMOJIS_STYLE[style]} ${majuscule(LIBELLES_STYLE[style])}` : '';
}

/**
 * Version d'un profil quand une seule convient (pas de choix) : « Pour Adulte B : version végétale 🌿 », « Pour vous :
 * version mer 🐟 ». `version` : élément de `versions` (platsDeLaSemaine). '' si deux versions sont au choix, ou pour
 * un profil sans styles (`nomme` faux : rien sur la carte).
 */
export function texteVersionUnique(version, { moi = null } = {}) {
  if (!version || listeDe(version.auChoix).length > 1 || !STYLES.includes(version.style) || version.nomme === false) return '';
  return `${legendeVersion(version.profil, { moi })} version ${LIBELLES_STYLE[version.style]} ${EMOJIS_STYLE[version.style]}`;
}

/**
 * Conservation (non bloquant), si une version servie se garde moins longtemps que le plat : « 🐟 La part d'Adulte B
 * se garde 2 jours après cuisson (le plat : 3). » ; pour soi : « 🐟 Votre part se garde… » ; 🌿 pour une version
 * végétale ; sans emoji pour la version d'un profil sans styles (`limite.style` null). null sinon.
 */
export function texteConservation(element, { moi = null } = {}) {
  const limite = element?.conservation?.limite;
  if (!limite) return null;
  const emoji = EMOJIS_STYLE[limite.style] ? `${EMOJIS_STYLE[limite.style]} ` : '';
  const part = estMoi(limite.profil, moi) ? 'Votre part' : `La part ${deNom(nomDe(limite.profil))}`;
  const jours = `${limite.jours}\u00A0${limite.jours > 1 ? 'jours' : 'jour'}`;
  return `${emoji}${part} se garde ${jours} après cuisson (le plat\u00A0: ${element.conservation.jours}).`;
}
