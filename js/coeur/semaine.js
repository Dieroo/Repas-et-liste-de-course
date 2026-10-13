// Semaine (T3a, CLAUDE.md §6 et §9) : une période à dates fixes (`semaines/{id}`), du jour où l'on choisit ses plats à
// + 6 jours, montrée jusqu'à sa fin ; les plats choisis, leurs réglages et leurs portions ; les écritures d'un geste.
// Logique pure : ni DOM ni Firebase.
// - Défauts calculés, jamais écrits : qui en mange, la version servie (la mer d'abord) et le nombre de repas prennent
//   leur valeur à la lecture ; seul le nombre de repas touché s'écrit (`plats.<id>.repas`).
// - Écriture par chemin pointé (`plats.<id>.styles.<profilId>`, `coches.<cle>`…), jamais de tableau ni de champ
//   calculé ; retirer un plat écrit `retire: true`, l'entrée n'est jamais supprimée ; une semaine naît avec son
//   premier plat (`set` fusionné de { debut, fin, creePar, creeLe }, jamais de `statut`).
// - La liste de courses ne lit que `plats.<id>` (repas, mange, invites, styles, portionsACongeler) : coeur/liste.js.
// - T3b : « Courses terminées » (liste.js › preparerFinDesCourses) écrit `statut: 'courses_faites'` et `statutAvant` ;
//   « Rouvrir la liste » (ecrituresRouvrir) remet le statut d'avant, jamais plus loin ; ce qui manquait, gardé pour la
//   prochaine fois, devient des articles `garde--<semaine>--<produit>` (idGarde).
// - T3c « Ajuster la semaine » : « Qui en mange ? » (`plats.<id>.mange.<profilId>`, une valeur égale au défaut du moment
//   efface le chemin), invités (`plats.<id>.invites.adultes|enfants`, 0 efface), Mer / Végétale et repas par
//   ecrituresReglage ; « Revenir aux réglages de départ » (ecrituresDepart) ; dates de la semaine (validerDates :
//   `debut` et `fin` seulement, jamais le statut ni les traces de « Courses terminées ») ; modèle de la feuille du plat
//   (feuillePlat). Un invité ajoute des portions, jamais ne retire un repas : le repas par défaut se calcule sur le
//   foyer seul.
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

/**
 * Date « AAAA-MM-JJ » d'une `derniereFois` lue (texte, ou horodatage à sa date locale) ; null sinon. Déplacée de
 * liste.js (T4-0) : la proposition s'en sert aussi (proposition.js › historiqueDesPlats).
 */
export function jourDeDerniereFois(valeur) {
  if (typeof valeur === 'string') return jourValide(valeur) ? valeur : null;
  let date = null;
  if (valeur instanceof Date) date = valeur;
  else if (estObjet(valeur) && typeof valeur.toDate === 'function') {
    try {
      date = valeur.toDate();
    } catch {
      date = null;
    }
  } else if (estObjet(valeur) && estNombre(valeur.seconds)) date = new Date(valeur.seconds * 1000);
  if (!(date instanceof Date) || Number.isNaN(date.getTime())) return null;
  return `${date.getFullYear()}-${deux(date.getMonth() + 1)}-${deux(date.getDate())}`;
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
 * Une semaine qui a des plats d'abord, puis la plus récente (plusRecenteDabord) : une semaine sans plat (vidée) ne
 * passe jamais devant une semaine qui a des plats, même si leurs dates se touchent (dates changées, création hors
 * ligne) ; elle ne cache jamais ses plats, sa liste ni ses coches.
 */
const avecPlatsDabord = (a, b) => Number(aDesPlats(b)) - Number(aDesPlats(a)) || plusRecenteDabord(a, b);

/** Jours communs entre une semaine et les dates `debut`–`fin` (bornes comprises). */
const touche = (s, debut, fin) => s.debut <= fin && s.fin >= debut;

/**
 * Semaine à préparer, celle que Semaine et Courses montrent : la plus récente (debut le plus grand) dont la fin n'est
 * pas passée (fin ≥ aujourdhui) ; null sinon. Une semaine qui commence plus tard ne passe devant que si elle a un plat
 * (aDesPlats) : dès que la semaine suivante a un plat, les prochaines courses sont pour elle ; vidée (« Annuler », case
 * décochée), elle s'efface et la semaine en cours revient, avec sa liste. Une semaine sans plat ne passe jamais devant
 * une semaine qui a des plats (T3c : des dates changées peuvent faire se toucher une semaine vidée et une autre).
 */
export function semaineAPreparer(semaines, aujourdhui) {
  if (!jourValide(aujourdhui)) return null;
  return lisibles(semaines).filter((s) => s.fin >= aujourdhui && (s.debut <= aujourdhui || aDesPlats(s)))
    .sort(avecPlatsDabord)[0] ?? null;
}

/**
 * Semaine en cours quand une semaine suivante est déjà montrée (ligne « En ce moment, jusqu'au 16 octobre : … ») :
 * celle qui contient aujourd'hui, autre que la semaine montrée (une semaine qui a des plats d'abord) ; null sinon (ou
 * si la semaine montrée a commencé).
 */
export function semaineEnCours(semaines, aujourdhui) {
  const montree = semaineAPreparer(semaines, aujourdhui);
  if (!montree || montree.debut <= aujourdhui) return null;
  return lisibles(semaines)
    .filter((s) => s.id !== montree.id && s.debut <= aujourdhui && s.fin >= aujourdhui)
    .sort(avecPlatsDabord)[0] ?? null;
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
 * Nouvelle semaine (nouvelleSemaine) → { id, debut, fin }, ou reprise d'une semaine sans plat (vidée : « Annuler »,
 * case décochée, dernier plat retiré) qui touche ses dates, autre que `apres` : la première par date de début, sous
 * son identifiant, aux nouvelles dates (ecrituresAjout les écrit avec le premier plat). Une semaine sans plat n'existe
 * pas pour la personne (jamais montrée devant une semaine qui a des plats, ignorée par validerDates) : elle est reprise
 * au lieu d'être chevauchée, jamais de « -2 » pour rien. null si `aujourdhui` est illisible.
 */
function nouvelleOuReprise(semaines, aujourdhui, apres = null) {
  const nouvelle = nouvelleSemaine(semaines, aujourdhui, { apres });
  if (!nouvelle) return null;
  const vide = lisibles(semaines)
    .filter((s) => s.id !== apres?.id && !aDesPlats(s) && touche(s, nouvelle.debut, nouvelle.fin))
    .sort((a, b) => parId(a.debut, b.debut) || parId(a.id, b.id))[0];
  return vide ? { id: vide.id, debut: nouvelle.debut, fin: nouvelle.fin } : nouvelle;
}

/**
 * Semaine qui suit `apres` (la semaine montrée) → { id, debut, fin } : du lendemain de sa fin à + 6 jours
 * (nouvelleSemaine) ; une semaine sans plat qui touche ces dates (créée puis vidée par « Annuler », ou dont les dates
 * ont changé) est reprise sous son identifiant, à ces dates (jamais de « -2 » pour rien, jamais deux semaines qui se
 * chevauchent). null si `aujourdhui` est illisible.
 */
export function semaineSuivante(semaines, aujourdhui, apres) {
  return nouvelleOuReprise(semaines, aujourdhui, apres);
}

/**
 * Où vont les plats choisis (§3.2) → { id, debut, fin, nouvelle, autre } : la semaine montrée, sauf dans ses deux
 * derniers jours (peutPreparerLaSuivante) : alors la suivante (semaineSuivante ; `nouvelle: true` : elle n'a pas
 * encore de plat, elle naîtra ou reprendra avec le premier, et les articles pas pris de la semaine qui finit peuvent
 * la suivre). Aucune semaine à préparer : du jour même à + 6 jours (`nouvelle: true` ; une semaine sans plat qui touche
 * ces dates est reprise sous son identifiant, nouvelleOuReprise). `autre` : la semaine qui finit,
 * quand la cible est la suivante (« Ajouter plutôt à la semaine qui finit le 16 ») ; null sinon. L'écran fige le
 * résultat à l'ouverture de la feuille (ou au toucher sur la fiche) et le passe à ecrituresAjout. null si
 * `aujourdhui` est illisible.
 */
export function semaineVisee(semaines, aujourdhui) {
  if (!jourValide(aujourdhui)) return null;
  const montree = semaineAPreparer(semaines, aujourdhui);
  if (!montree) return { ...nouvelleOuReprise(semaines, aujourdhui), nouvelle: true, autre: null };
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

/**
 * Réglages d'un plat de la semaine qu'un geste écrit, et que « Revenir aux réglages de départ » efface (T3c) : le nombre
 * de repas, qui en mange, les invités, Mer / Végétale. Jamais `ajouteLe`, `retire`, ni ce que T4 et T5 écriront
 * (`portionsACongeler`, `verrou`).
 */
export const CHAMPS_REGLAGE = Object.freeze(['repas', 'mange', 'invites', 'styles']);

/** Vrai si ce champ de l'entrée porte un réglage écrit : présent, ni null, ni table vide. */
function reglageEcrit(entree, champ) {
  if (!estObjet(entree) || !Object.hasOwn(entree, champ)) return false;
  const valeur = entree[champ];
  return valeur !== null && valeur !== undefined && !(estObjet(valeur) && !Object.keys(valeur).length);
}

/**
 * Vrai si l'entrée d'un plat de la semaine porte au moins un réglage écrit (CHAMPS_REGLAGE : repas touché, une case
 * « Qui en mange ? », un invité, un choix Mer / Végétale) : la feuille du plat propose alors « Revenir aux réglages de
 * départ ».
 */
export function aDesReglagesEcrits(entree) {
  return CHAMPS_REGLAGE.some((champ) => reglageEcrit(entree, champ));
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
 *   conservation: { jours, limite: null | { profil, style, jours } },
 *   reglagesEcrits (T3c : aDesReglagesEcrits de l'entrée, « Revenir aux réglages de départ ») }.
 * Plat de la corbeille ou introuvable : aucun mangeur, aucune portion, `conservation` null (il revient avec ses
 * réglages s'il est remis). Plat ⏳ : tout le monde (sauf « Jamais »), aucune version.
 * Invariant (T3c) : un invité ajoute des portions, jamais ne retire un repas ; le repas par défaut se calcule sur le
 * foyer seul (parRepasFoyer), que le compteur ait été touché ou non.
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
      reglagesEcrits: aDesReglagesEcrits(entree),
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
 * Préfixe des articles gardés par « Courses terminées » (T3b, « Les garder pour la prochaine fois ») :
 * `garde--<semaine>--<produit>`, la semaine dont les courses sont terminées. Distinct des restes : vider une semaine qui
 * commence plus tard n'emporte jamais ce qui a été gardé pour la prochaine fois.
 */
export const PREFIXE_GARDE = 'garde--';

/** `<prefixe><semaine>--<produit>`, ou '' si une clé est hors `^[a-z0-9-]+$`. */
function idDArticle(prefixe, semaineId, produitId) {
  return typeof semaineId === 'string' && ID_SUR.test(semaineId) && typeof produitId === 'string' && ID_SUR.test(produitId)
    ? `${prefixe}${semaineId}--${produitId}` : '';
}

/**
 * Identifiant d'un article des restes, fixé par la semaine qui le reçoit et le produit (`reste--2026-10-17--beurre`) :
 * deux téléphones qui créent la même semaine écrivent le même document (set fusionné), jamais deux. '' si une clé est
 * hors `^[a-z0-9-]+$`.
 */
export function idReste(semaineId, produitId) {
  return idDArticle(PREFIXE_RESTE, semaineId, produitId);
}

/**
 * Identifiant d'un article gardé par « Courses terminées » (`garde--2026-10-10--beurre`), fixé par la semaine dont les
 * courses sont terminées et le produit : deux téléphones qui terminent les mêmes courses écrivent le même document.
 * '' si une clé est hors `^[a-z0-9-]+$`.
 */
export function idGarde(semaineId, produitId) {
  return idDArticle(PREFIXE_GARDE, semaineId, produitId);
}

/**
 * Articles des restes gardés (liste.js › restes), ou des lignes gardées par « Courses terminées » (`garde: true`) →
 * [{ id?, libelle, precision?, creePar?, creeLe }] ; `id` : idReste (idGarde avec `garde`), absent sans produit
 * lisible (identifiant tiré par donnees.js) ; un produit n'apparaît qu'une fois ; libellé de 60 caractères au plus,
 * précision de 40 au plus.
 */
export function articlesDesRestes(restes, { semaineId, auteur, maintenant, garde = false }) {
  const articles = [];
  const vus = new Set();
  for (const reste of listeDe(restes)) {
    const libelle = reduire(reste?.libelle).slice(0, 60).trim();
    if (!libelle) continue;
    const id = (garde ? idGarde : idReste)(semaineId, reste?.produitId);
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
 * (déjà dans la semaine visée ; `id`), 'chevauche' (T3c : la cible n'a encore aucun plat et ses dates touchent une
 * autre semaine qui a des plats, dont les dates ont changé entre-temps ; rien n'est écrit, l'écran recalcule la
 * semaine visée).
 * `cible` : la semaine visée, figée par l'écran (semaineVisee) ; sans elle, semaineVisee(semaines, aujourdhui). Le plat
 * va toujours dans la cible, même si une autre semaine (sans plat, ou qui ne la touche pas) est apparue entre-temps.
 * Si aucune semaine lisible ne porte l'identifiant de la cible, elle est créée dans le même lot : `creation.donnees` =
 * { debut, fin, creePar, creeLe } seulement (set fusionné, jamais de statut) ; une semaine sans plat reprise à d'autres
 * dates (nouvelleOuReprise) reçoit la même `creation`, à ses nouvelles dates. Si la cible n'a encore aucun plat (créée ici, ou vidée depuis), les
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
  const toutes = lisibles(semaines);
  const existante = toutes.find((s) => s.id === visee.id) ?? null;
  if (existante && estDansLaSemaine(existante.plats[platId])) return { code: 'deja', id: visee.id };
  const premierPlat = !existante || !aDesPlats(existante);
  // Une semaine qui reçoit son premier plat ne touche jamais une semaine qui a des plats (dates changées sur l'autre
  // téléphone pendant que la feuille était ouverte) : elle la cacherait. L'écran recalcule la semaine visée.
  if (premierPlat && toutes.some((s) => s.id !== visee.id && aDesPlats(s) && touche(s, visee.debut, visee.fin))) {
    return { code: 'chevauche' };
  }
  const resultat = {
    id: visee.id,
    champs: { [`plats.${platId}.ajouteLe`]: maintenant, [`plats.${platId}.retire`]: EFFACER },
  };
  // Créée, ou reprise sans plat à d'autres dates (nouvelleOuReprise) : mêmes champs que la création, set fusionné.
  if (!existante || (premierPlat && (existante.debut !== visee.debut || existante.fin !== visee.fin))) {
    const donnees = { debut: visee.debut, fin: visee.fin };
    if (reduire(auteur)) donnees.creePar = reduire(auteur);
    donnees.creeLe = maintenant;
    resultat.creation = { id: visee.id, donnees };
  }
  if (premierPlat) {
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
 * Articles gardés par « Courses terminées » de cette semaine (identifiant `garde--<semaine>--…`), pas cochés :
 * ceux que « Rouvrir la liste » retire (ses lignes reviennent à acheter). → [identifiant]
 */
export function gardesDeLaSemaine(semaine, articles) {
  const prefixe = typeof semaine?.id === 'string' && ID_SUR.test(semaine.id) ? `${PREFIXE_GARDE}${semaine.id}--` : null;
  if (!prefixe) return [];
  return listeDe(articles).filter((a) => estObjet(a) && typeof a.id === 'string' && a.id.startsWith(prefixe) && !estObjet(a.coche))
    .map((a) => a.id);
}

/**
 * « Rouvrir la liste » (T3b, un geste) → { id, champs: { statut: statutAvant | EFFACER, statutAvant: EFFACER },
 * supprimer? } : le statut d'avant « Courses terminées » revient (une semaine `validee` redevient `validee`, jamais
 * brouillon ; brouillon ou absent : EFFACER), jamais plus loin. `supprimer` : les articles gardés pour la prochaine
 * fois par ces courses et pas encore cochés (gardesDeLaSemaine) : leurs lignes reviennent à acheter, elles ne
 * doivent pas apparaître deux fois. { code: 'invalide' } pour une semaine illisible ; { code: 'statut' } si ses
 * courses ne sont pas terminées (statut autre que `courses_faites`).
 */
export function ecrituresRouvrir(semaine, { articles = [] } = {}) {
  const lue = lireSemaine(semaine);
  if (!lue) return { code: 'invalide' };
  if (statutSemaine(lue) !== 'courses_faites') return { code: 'statut' };
  const avant = lue.statutAvant;
  const remis = Object.hasOwn(RANGS_STATUT, avant ?? '') && RANGS_STATUT[avant] > RANGS_STATUT.brouillon
    && RANGS_STATUT[avant] < RANGS_STATUT.courses_faites ? avant : EFFACER;
  const resultat = { id: lue.id, champs: { statut: remis, statutAvant: EFFACER } };
  const supprimer = gardesDeLaSemaine(lue, articles);
  if (supprimer.length) resultat.supprimer = supprimer;
  return resultat;
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

// ——— Écritures groupées (T4-0 « Proposer les plats de la semaine ») ———

/**
 * Plusieurs plats en UN lot (« ✨ Proposer 4 plats », « 🍰 Proposer des desserts ») → { creation?, id, champs,
 * articles?, ajoutes: [{ platId, ajouteLe }], deja: [platId] }, ou { code } : ecrituresAjout appliqué plat par plat sur
 * une copie des semaines (appliquerChamps), donc une seule `creation` et les restes avec le premier plat seulement,
 * si la cible n'avait encore aucun plat (comme une case cochée). `ajouteLe` = maintenant + rang : l'ordre de la
 * proposition est gardé (ordre des cartes). Mêmes chemins qu'une case cochée (`plats.<id>.ajouteLe`, `plats.<id>.retire`
 * effacé), jamais un réglage ni un statut. Un plat déjà dans la cible (ajouté entre-temps sur l'autre téléphone) va
 * dans `deja` ; un plat introuvable dans `tousLesPlats` (quand la liste est donnée) ou qui ne peut plus aller dans la
 * semaine (peutAllerDansLaSemaine) est sauté. Les codes 'chargement', 'invalide' (cible ou heure illisible) et
 * 'chevauche' du premier plat écrit arrêtent tout : rien n'est écrit. { code: 'vide', deja } si aucun plat n'entre.
 */
export function ecrituresAjoutGroupe(semaines, platIds, {
  cible = null, semainesChargees = false, aujourdhui = null, auteur = null, maintenant = null, restes = [],
  tousLesPlats = null,
} = {}) {
  if (!semainesChargees) return { code: 'chargement' };
  if (!estNombre(maintenant)) return { code: 'invalide' };
  const parIdentifiant = Array.isArray(tousLesPlats)
    ? new Map(tousLesPlats.filter((p) => estObjet(p) && typeof p.id === 'string').map((p) => [p.id, p])) : null;
  let copie = listeDe(semaines).filter(estObjet);
  const resultat = { id: null, champs: {}, ajoutes: [], deja: [] };
  const vus = new Set();
  for (const platId of listeDe(platIds)) {
    if (typeof platId !== 'string' || vus.has(platId) || !cheminSur('plats', platId)) continue;
    vus.add(platId);
    const plat = parIdentifiant ? parIdentifiant.get(platId) ?? null : null;
    if (parIdentifiant && (!plat || !peutAllerDansLaSemaine(plat))) continue;
    const ajouteLe = maintenant + resultat.ajoutes.length;
    const un = ecrituresAjout(copie, platId, {
      cible, semainesChargees: true, aujourdhui, auteur, maintenant: ajouteLe, restes, plat,
    });
    if (un.code === 'deja') {
      resultat.deja.push(platId);
      resultat.id = un.id;
      continue;
    }
    if (un.code) {
      if (!resultat.ajoutes.length) return { code: un.code };
      continue;
    }
    resultat.id = un.id;
    Object.assign(resultat.champs, un.champs);
    if (un.creation && !resultat.creation) resultat.creation = un.creation;
    if (un.articles && !resultat.articles) resultat.articles = un.articles;
    resultat.ajoutes.push({ platId, ajouteLe });
    // La copie suit le lot : le plat suivant voit la semaine créée (ou reprise) et son premier plat.
    const avant = copie.find((s) => s.id === un.id);
    const base = { ...(avant ?? { id: un.id, plats: {} }), ...(un.creation?.donnees ?? {}) };
    copie = [...copie.filter((s) => s.id !== un.id), appliquerChamps(base, un.champs)];
  }
  if (!resultat.ajoutes.length) return { code: 'vide', deja: resultat.deja };
  return resultat;
}

/**
 * « Annuler » d'une proposition → { id, champs: { plats.<id>.retire: true… }, supprimer?, vide }, ou { code } : ne
 * retire que les plats dont l'entrée garde l'`ajouteLe` écrit par le geste et n'est pas retirée (un plat repris ou
 * réglé entre-temps sur l'autre téléphone reste) ; { code: 'inutile' } si aucun. Une semaine qui commence plus tard
 * (`aujourdhui`) et que ce retrait vide emporte ses articles des restes pas cochés (`supprimer`, comme
 * ecrituresRetrait). `vide` : la semaine n'a plus de plat. Rien n'est écarté pour la suite. { code: 'invalide' } pour
 * une semaine illisible.
 */
export function ecrituresRetraitGroupe(semaine, ajoutes, { articles = [], aujourdhui = null } = {}) {
  const lue = lireSemaine(semaine);
  if (!lue) return { code: 'invalide' };
  const champs = {};
  for (const ajout of listeDe(ajoutes)) {
    const chemin = cheminSur('plats', ajout?.platId);
    const entree = chemin ? lue.plats[ajout.platId] : null;
    if (estDansLaSemaine(entree) && entree.ajouteLe === ajout.ajouteLe) champs[`${chemin}.retire`] = true;
  }
  if (!Object.keys(champs).length) return { code: 'inutile' };
  const vide = !aDesPlats(appliquerChamps(lue, champs));
  const resultat = { id: lue.id, champs, vide };
  if (vide && jourValide(aujourdhui) && lue.debut > aujourdhui) {
    const supprimer = restesDeLaSemaine(lue, articles);
    if (supprimer.length) resultat.supprimer = supprimer;
  }
  return resultat;
}

/**
 * « 🔄 Une autre idée », en un lot → { id, champs }, ou { code } : le nouveau plat entre à la place de l'ancien (même
 * `ajouteLe` : même place ; `retire` effacé ; un plat retiré plus tôt repart de ses réglages de départ : ceux qu'il
 * avait gardés sont effacés chemin par chemin, comme ecrituresDepart) et l'ancien passe `retire: true` (ses réglages
 * restent dans son entrée) ; la semaine n'est jamais vide entre les deux, aucun reste ne bouge.
 * `inverse` (« Annuler ») : l'ancien revient (`retire` effacé, son `ajouteLe` gardé) et le nouveau passe `retire:
 * true`, seulement si le nouveau est toujours à la place de l'ancien (même `ajouteLe`). Codes : 'invalide'
 * (semaine ou identifiants illisibles, ou identiques), 'faites' (courses faites ou au-delà : les ingrédients sont
 * achetés), 'inutile' (l'ancien n'est plus dans la semaine ou le nouveau y est déjà ; en sens inverse, l'échange a
 * changé sur l'autre téléphone).
 */
export function ecrituresRemplacement(semaine, ancienId, nouveauId, { inverse = false } = {}) {
  const lue = lireSemaine(semaine);
  const ancien = cheminSur('plats', ancienId);
  const nouveau = cheminSur('plats', nouveauId);
  if (!lue || !ancien || !nouveau || ancienId === nouveauId) return { code: 'invalide' };
  if (RANGS_STATUT[statutSemaine(lue)] >= RANGS_STATUT.courses_faites) return { code: 'faites' };
  const entreeAncien = lue.plats[ancienId];
  const entreeNouveau = lue.plats[nouveauId];
  if (!inverse) {
    if (!estDansLaSemaine(entreeAncien) || estDansLaSemaine(entreeNouveau)) return { code: 'inutile' };
    const depart = estObjet(entreeNouveau) ? ecrituresDepart(lue, nouveauId) : null;
    return {
      id: lue.id,
      champs: {
        ...(depart?.champs ?? {}),
        [`${nouveau}.ajouteLe`]: entreeAncien.ajouteLe, [`${nouveau}.retire`]: EFFACER, [`${ancien}.retire`]: true,
      },
    };
  }
  if (!estDansLaSemaine(entreeNouveau) || !estObjet(entreeAncien) || !estNombre(entreeAncien.ajouteLe)
    || estDansLaSemaine(entreeAncien) || entreeNouveau.ajouteLe !== entreeAncien.ajouteLe) {
    return { code: 'inutile' };
  }
  return { id: lue.id, champs: { [`${ancien}.retire`]: EFFACER, [`${nouveau}.retire`]: true } };
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

/** Clés d'un réglage (ecrituresReglage) : les champs de CHAMPS_REGLAGE, et `depart`. */
const CLES_REGLAGE = new Set([...CHAMPS_REGLAGE, 'depart']);
const CLES_INVITES = Object.freeze(['adultes', 'enfants']);

/**
 * Réglage d'un plat de la semaine (feuille du plat, carte du plat) → { id, champs } ; chaque clé de chemin vérifiée,
 * chaque champ écrit seul (`update` par chemin pointé, en lot) ; null = revenir au défaut (EFFACER). `reglage` :
 * - `repas` (T3a) : entier borné de 1 à REPAS_MAX, écrit même s'il vaut le défaut du moment (un profil ajouté ou écarté
 *   ensuite ne le fait plus bouger) ;
 * - `mange: { profilId: bool | null }` (T3c, « Qui en mange ? ») : `plats.<id>.mange.<p>` ; une valeur égale au défaut
 *   du moment (mangeParDefaut, avec le style qu'il recevra) efface le chemin : une version arrivée plus tard fera
 *   entrer le profil toute seule. `true` pour un profil sans version qui convient : il mange la recette telle quelle ;
 *   `false` : sa part et sa version sortent de la liste. Profil absent de `profils` : refusé. Plat absent de
 *   `tousLesPlats` : la valeur est écrite telle quelle (défaut inconnu) ;
 * - `invites: { adultes?, enfants? }` (T3c) : entiers bornés de 0 à INVITES_MAX, chacun son chemin
 *   (`plats.<id>.invites.adultes`) ; 0 efface. Un invité n'écrit jamais `repas` : il ajoute des portions, sans retirer
 *   de repas ;
 * - `styles: { profilId: 'mer' | 'vegetal' | null }` : comme ecrituresStyle (le style par défaut efface ; un style qui
 *   ne convient pas → { code: 'style' }) ;
 * - `depart: true` : « Revenir aux réglages de départ » (ecrituresDepart) ; avec d'autres clés (touchers réunis après
 *   lui, fusionnerReglages), ils s'appliquent par-dessus, dans la même écriture.
 * { code: 'invalide' } : semaine, plat ou réglage illisible, clé inconnue, rien à écrire ; { code: 'style' } ;
 * { code: 'inutile' } : `depart` seul sur un plat sans réglage écrit.
 */
export function ecrituresReglage(semaine, platId, reglage, { evaluer = evaluerParDefaut, tousLesPlats = [], profils = [] } = {}) {
  const lue = lireSemaine(semaine);
  if (!lue || !cheminSur('plats', platId) || !estObjet(reglage)) return { code: 'invalide' };
  const cles = Object.keys(reglage);
  if (!cles.length || !cles.every((cle) => CLES_REGLAGE.has(cle))) return { code: 'invalide' };
  const entree = estObjet(lue.plats[platId]) ? lue.plats[platId] : {};
  let champs = {};
  let styles = { ...(estObjet(entree.styles) ? entree.styles : {}) };
  if (Object.hasOwn(reglage, 'depart')) {
    if (reglage.depart !== true) return { code: 'invalide' };
    const depart = ecrituresDepart(lue, platId);
    if (depart.code === 'invalide' || (depart.code && cles.length === 1)) return depart;
    champs = { ...(depart.champs ?? {}) };
    styles = {};
  }
  if (Object.hasOwn(reglage, 'repas')) {
    if (reglage.repas === null) champs[`plats.${platId}.repas`] = EFFACER;
    else if (estNombre(reglage.repas)) champs[`plats.${platId}.repas`] = entierBorne(reglage.repas, 1, REPAS_MAX);
    else return { code: 'invalide' };
  }
  // Styles d'abord : le défaut de `mange` se juge sur la version que le profil recevra.
  if (Object.hasOwn(reglage, 'styles')) {
    if (!estObjet(reglage.styles)) return { code: 'invalide' };
    for (const [profilId, style] of Object.entries(reglage.styles)) {
      const chemin = cheminSur('plats', platId, 'styles', profilId);
      if (!chemin) return { code: 'invalide' };
      if (style === null) {
        champs[chemin] = EFFACER;
        delete styles[profilId];
        continue;
      }
      const ecritures = ecrituresStyle(lue, platId, profilId, style, { evaluer, tousLesPlats, profils });
      if (ecritures.code) return ecritures;
      Object.assign(champs, ecritures.champs);
      styles[profilId] = style;
    }
  }
  if (Object.hasOwn(reglage, 'mange')) {
    if (!estObjet(reglage.mange)) return { code: 'invalide' };
    const plat = listeDe(tousLesPlats).find((p) => estObjet(p) && p.id === platId) ?? null;
    for (const [profilId, valeur] of Object.entries(reglage.mange)) {
      const chemin = cheminSur('plats', platId, 'mange', profilId);
      const profil = listeDe(profils).find((p) => estObjet(p) && p.id === profilId) ?? null;
      if (!chemin || !profil || (valeur !== null && typeof valeur !== 'boolean')) return { code: 'invalide' };
      if (valeur === null) {
        champs[chemin] = EFFACER;
        continue;
      }
      const choix = STYLES.includes(styles[profilId]) ? styles[profilId] : null;
      const defaut = plat ? mangeParDefaut(plat, profil, { evaluer, choix }).mange : null;
      champs[chemin] = valeur === defaut ? EFFACER : valeur;
    }
  }
  if (Object.hasOwn(reglage, 'invites')) {
    if (!estObjet(reglage.invites)) return { code: 'invalide' };
    for (const [qui, valeur] of Object.entries(reglage.invites)) {
      if (!CLES_INVITES.includes(qui)) return { code: 'invalide' };
      const chemin = `plats.${platId}.invites.${qui}`;
      if (valeur === null) champs[chemin] = EFFACER;
      else if (estNombre(valeur)) {
        const nombreInvites = entierBorne(valeur, 0, INVITES_MAX);
        champs[chemin] = nombreInvites === 0 ? EFFACER : nombreInvites;
      } else return { code: 'invalide' };
    }
  }
  // Un réglage illisible effacé en entier par « Revenir » (table qui n'en est pas une) l'emporte sur un toucher qui
  // écrirait dedans : deux chemins dont l'un contient l'autre sont refusés dans la même écriture.
  for (const chemin of Object.keys(champs)) {
    if (Object.keys(champs).some((autre) => autre !== chemin && chemin.startsWith(`${autre}.`))) delete champs[chemin];
  }
  if (!Object.keys(champs).length) return { code: 'invalide' };
  return { id: lue.id, champs };
}

/**
 * « Revenir aux réglages de départ » (T3c, un geste) → { id, champs } : chaque réglage écrit du plat (CHAMPS_REGLAGE)
 * effacé, chemin par chemin (`plats.<id>.repas`, `plats.<id>.mange.<p>`, `plats.<id>.invites.adultes`,
 * `plats.<id>.styles.<p>`), comme chaque toucher les avait écrits ; une table illisible est effacée entière. Tout
 * reprend son défaut calculé à la lecture. Jamais `ajouteLe`, `retire`, `portionsACongeler` ni `verrou`.
 * { code: 'inutile' } : aucun réglage écrit (aDesReglagesEcrits) ; { code: 'invalide' } : semaine ou plat illisible,
 * plat absent du document de la semaine.
 */
export function ecrituresDepart(semaine, platId) {
  const lue = lireSemaine(semaine);
  if (!lue || !cheminSur('plats', platId) || !estObjet(lue.plats[platId])) return { code: 'invalide' };
  const entree = lue.plats[platId];
  const champs = {};
  for (const champ of CHAMPS_REGLAGE) {
    if (!reglageEcrit(entree, champ)) continue;
    const valeur = entree[champ];
    const feuilles = estObjet(valeur) ? Object.keys(valeur) : [];
    if (champ !== 'repas' && feuilles.length && feuilles.every((cle) => ID_SUR.test(cle))) {
      for (const cle of feuilles) champs[`plats.${platId}.${champ}.${cle}`] = EFFACER;
    } else champs[`plats.${platId}.${champ}`] = EFFACER;
  }
  return Object.keys(champs).length ? { id: lue.id, champs } : { code: 'inutile' };
}

/**
 * Réglages touchés en rafale, réunis avant l'écriture (l'écran regroupe les touchers 0,8 s) → réglage
 * (ecrituresReglage) : le plus récent l'emporte, champ par champ et profil par profil (`mange`, `invites`, `styles`
 * fusionnés ; `repas` remplacé) ; « Revenir aux réglages de départ » (`depart`) remplace ce qui attendait (tout est
 * effacé), et un toucher qui le suit s'y ajoute. Rien n'est modifié en entrée.
 */
export function fusionnerReglages(avant, apres) {
  const a = estObjet(avant) ? avant : {};
  const b = estObjet(apres) ? apres : {};
  if (b.depart === true) return { ...b };
  const resultat = { ...a };
  for (const [cle, valeur] of Object.entries(b)) {
    if ((cle === 'mange' || cle === 'invites' || cle === 'styles') && estObjet(valeur) && estObjet(a[cle])) {
      resultat[cle] = { ...a[cle], ...valeur };
    } else resultat[cle] = estObjet(valeur) ? { ...valeur } : valeur;
  }
  return resultat;
}

// ——— Dates de la semaine (T3c, feuille « Les dates de la semaine ») ———

/**
 * Nouvelles dates de la semaine `id` (« Changer » à côté de « Du 10 au 16 octobre ») → { id, champs: { debut, fin } } :
 * les deux dates ensemble dès que l'une change (deux téléphones qui changeraient l'un le début, l'autre la fin
 * pourraient sinon laisser une semaine de plus de 14 jours, illisible, qui disparaîtrait avec ses plats ; donnees.js
 * refuse une date écrite seule) ; jamais l'identifiant (figé), le statut ni les traces de « Courses terminées » (une
 * semaine aux courses faites garde ses dates modifiables, rien d'autre ne change). Sinon :
 * - { erreur: 'vide' } : une date manque ou est illisible (un champ de date vidé) ;
 * - { code: 'inchange' } : mêmes dates, rien à écrire ;
 * - { erreur: 'ordre' } : la fin vient avant le début (un seul jour est permis) ;
 * - { erreur: 'duree' } : plus de DUREE_MAX_JOURS jours ;
 * - { erreur: 'passee' } : avec `aujourdhui`, la fin est déjà passée (la semaine et sa liste disparaîtraient) ;
 * - { erreur: 'chevauche', avec: { debut, fin } } : une autre semaine lisible qui a des plats (passée, en cours ou
 *   suivante) a au moins un jour commun (la première par date de début). Une semaine sans plat (vidée par « Annuler »
 *   ou une case décochée) ne compte pas : la personne ne la voit nulle part, elle ne passe jamais devant une semaine
 *   qui a des plats (semaineAPreparer), et la prochaine semaine créée la reprend à ses propres dates
 *   (nouvelleOuReprise) ;
 * - { code: 'invalide' } : `id` n'est pas une semaine lisible de `semaines`.
 */
export function validerDates({ debut = null, fin = null } = {}, { semaines = [], id = null, aujourdhui = null } = {}) {
  const toutes = lisibles(semaines);
  const actuelle = typeof id === 'string' ? toutes.find((s) => s.id === id) ?? null : null;
  if (!actuelle) return { code: 'invalide' };
  if (!jourValide(debut) || !jourValide(fin)) return { erreur: 'vide' };
  if (debut === actuelle.debut && fin === actuelle.fin) return { code: 'inchange' };
  if (fin < debut) return { erreur: 'ordre' };
  if (ecartJours(debut, fin) + 1 > DUREE_MAX_JOURS) return { erreur: 'duree' };
  if (jourValide(aujourdhui) && fin < aujourdhui) return { erreur: 'passee' };
  const touchee = toutes.filter((s) => s.id !== actuelle.id && aDesPlats(s) && touche(s, debut, fin))
    .sort((a, b) => parId(a.debut, b.debut) || parId(a.id, b.id))[0];
  if (touchee) return { erreur: 'chevauche', avec: { debut: touchee.debut, fin: touchee.fin } };
  return { id: actuelle.id, champs: { debut, fin } };
}

/** Textes de la feuille « Les dates de la semaine » (`input type=date` natifs). */
export const TEXTES_DATES = Object.freeze({
  changer: 'Changer',
  titre: 'Les dates de la semaine',
  du: 'Du',
  au: 'Au',
  aide: 'Deux semaines au plus.',
  enregistrer: 'Enregistrer',
});

/**
 * Phrase d'erreur de validerDates : « La fin doit venir après le début. », « Deux semaines au plus. », « Ces dates
 * touchent la semaine du 3 au 9 octobre : choisissez d'autres dates. », « Choisissez les deux dates. », « La semaine
 * doit finir aujourd'hui ou plus tard. » ; '' sans erreur.
 */
export function texteErreurDates(resultat) {
  switch (resultat?.erreur) {
    case 'vide': return 'Choisissez les deux dates.';
    case 'ordre': return 'La fin doit venir après le début.';
    case 'duree': return 'Deux semaines au plus.';
    case 'passee': return 'La semaine doit finir aujourd’hui ou plus tard.';
    case 'chevauche': {
      const { debut, fin } = resultat.avec ?? {};
      const dates = !jourValide(debut) || !jourValide(fin) ? '' : debut === fin ? `du ${texteJour(debut)}` : texteDates(debut, fin);
      return dates ? `Ces dates touchent la semaine ${dates}\u00A0: choisissez d’autres dates.`
        : 'Ces dates touchent une autre semaine\u00A0: choisissez d’autres dates.';
    }
    default: return '';
  }
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
 * et 2 invités · … », « Adulte A, Enfant et 1 invité · … », « 2 invités · … » (personne du foyer). null pour un plat
 * ⏳, de la corbeille ou introuvable (pas de résumé de portions).
 */
export function resumePlat(element) {
  if (!element || element.etat !== 'ok') return null;
  const mangent = listeDe(element.mangeurs).filter((m) => m.mange);
  const nbInvites = (element.invites?.adultes ?? 0) + (element.invites?.enfants ?? 0);
  if (!(element.aCuire > 0)) return TEXTE_PERSONNE;
  const qui = [];
  if (mangent.length && mangent.length === element.mangeurs.length) qui.push('Tout le monde');
  else qui.push(...mangent.map((m) => nomDe(m.profil)));
  if (nbInvites) qui.push(`${nbInvites}\u00A0${nbInvites > 1 ? 'invités' : 'invité'}`);
  return `${enumerer(qui)} · ${texteRepas(element.repas)} · ${textePortions(element.aCuire)}`;
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
    const texte = phraseRaison(m, { moi, role }) ?? (moiMeme ? 'Vous n’en mangez pas.' : `${nom} n’en mange pas.`);
    return { profil: m.profil, texte };
  });
}

/**
 * Phrase de la raison par défaut d'un profil (mangeParDefaut), quel que soit son choix : « Adulte B : pas encore de
 * version. » (pour soi : « Pas encore de version pour vous. ») ; « Adulte A a dit « Jamais ». » (« Vous avez dit
 * « Jamais ». ») ; « Enfant : 🧸 pas avant 1 an (miel). » (gestionnaire : « Enfant : 🧸 ❌ Pas avant 1 an : miel. ») ;
 * null sans raison. Coché à la main sans version : « Pas encore de version pour Adulte B : sa part suit la recette. »
 * (« Pas encore de version pour vous : votre part suit la recette. »).
 */
function phraseRaison(mangeur, { moi = null, role = null } = {}) {
  const moiMeme = estMoi(mangeur.profil, moi);
  const nom = nomDe(mangeur.profil);
  if (mangeur.raison === 'version') {
    if (mangeur.mange) {
      return moiMeme ? 'Pas encore de version pour vous\u00A0: votre part suit la recette.'
        : `Pas encore de version pour ${nom}\u00A0: sa part suit la recette.`;
    }
    return moiMeme ? 'Pas encore de version pour vous.' : `${nom}\u00A0: pas encore de version.`;
  }
  if (mangeur.raison === 'jamais') return moiMeme ? 'Vous avez dit «\u00A0Jamais\u00A0».' : `${nom} a dit «\u00A0Jamais\u00A0».`;
  if (mangeur.raison === 'age') {
    const age = texteEcarteAge(mangeur.precautions, role);
    if (age) return `${moiMeme ? 'Vous' : nom}\u00A0: 🧸 ${age}.`;
  }
  return null;
}

/** Textes de la feuille du plat de la semaine (T3c). */
export const TEXTES_PLAT_SEMAINE = Object.freeze({
  quiEnMange: 'Qui en mange\u00A0?',
  invites: 'Des invités\u00A0?',
  depart: 'Revenir aux réglages de départ',
});

/**
 * Compteurs de la feuille du plat : étiquette visible, nom du groupe (nomCompteur : « Repas : 2 », « Adultes invités :
 * 0 », « Enfants invités : 0 »), noms des boutons, bornes.
 */
export const COMPTEURS = Object.freeze({
  repas: Object.freeze({
    etiquette: 'Pour combien de repas\u00A0?', nom: 'Repas', plus: 'Un repas de plus', moins: 'Un repas de moins',
    min: 1, max: REPAS_MAX,
  }),
  adultes: Object.freeze({
    etiquette: 'Adultes', nom: 'Adultes invités', plus: 'Un adulte invité de plus', moins: 'Un adulte invité de moins',
    min: 0, max: INVITES_MAX,
  }),
  enfants: Object.freeze({
    etiquette: 'Enfants', nom: 'Enfants invités', plus: 'Un enfant invité de plus', moins: 'Un enfant invité de moins',
    min: 0, max: INVITES_MAX,
  }),
});

/** Nom d'un compteur avec sa valeur : « Repas : 2 », « Adultes invités : 0 » ; '' pour un compteur inconnu. */
export function nomCompteur(type, valeur) {
  return Object.hasOwn(COMPTEURS, type) ? `${COMPTEURS[type].nom}\u00A0: ${valeur}` : '';
}

/**
 * Ce que montre la feuille du plat de la semaine (T3c), pour un élément de platsDeLaSemaine → null (plat ⏳, de la
 * corbeille ou introuvable : la feuille garde seulement son bandeau, « Voir la recette › » et « Retirer de la
 * semaine ») | {
 *   qui: [{ profil, libelle (prénom), coche (il en mange), parDefaut, raison (celle du défaut : null, 'version',
 *     'jamais', 'age'), texte (phrase sous la case, ou null : phraseRaison), demande (vue « Repas et courses » et
 *     raison 'version' : la case peut porter « 📬 Demander… », selon demandes.js › etatDemande), libelleDemande
 *     ('Demander ma version' pour soi, 'Demander une version pour Adulte B' ; null sans demande ; l'écran met 📬
 *     devant) }] (ordre de trierProfils) ;
 *   compteurs: { repas, adultes, enfants } : chacun { valeur, nom (« Repas : 2 »), etiquette, plus, moins, min, max } ;
 *   invites: { adultes, enfants, ouvert (au moins un invité : « Des invités ? » s'ouvre) } ;
 *   repas: { valeur, parDefaut, touche } ; resume (resumePlat) ; portions (phrasePortions) ;
 *   versions (element.versions : choix Mer / Végétale ou version unique) ; conservation (texteConservation) ;
 *   depart (un réglage est écrit : « Revenir aux réglages de départ ») }.
 * Jamais de croix dans la vue « Repas et courses » (`role` autre que 'gestionnaire').
 */
export function feuillePlat(element, { moi = null, role = null } = {}) {
  if (!element || element.etat !== 'ok') return null;
  const vueCourses = role !== 'gestionnaire';
  const qui = listeDe(element.mangeurs).map((m) => {
    const moiMeme = estMoi(m.profil, moi);
    const demande = vueCourses && m.raison === 'version';
    return {
      profil: m.profil,
      libelle: nomDe(m.profil),
      coche: m.mange,
      parDefaut: m.parDefaut,
      raison: m.raison,
      texte: phraseRaison(m, { moi, role }),
      demande,
      libelleDemande: demande ? (moiMeme ? 'Demander ma version' : `Demander une version pour ${nomDe(m.profil)}`) : null,
    };
  });
  const compteur = (type, valeur) => ({ ...COMPTEURS[type], valeur, nom: nomCompteur(type, valeur) });
  const adultes = element.invites?.adultes ?? 0;
  const enfants = element.invites?.enfants ?? 0;
  return {
    qui,
    compteurs: { repas: compteur('repas', element.repas), adultes: compteur('adultes', adultes), enfants: compteur('enfants', enfants) },
    invites: { adultes, enfants, ouvert: adultes + enfants > 0 },
    repas: { valeur: element.repas, parDefaut: element.repasParDefaut, touche: element.repasTouche === true },
    resume: resumePlat(element),
    portions: phrasePortions(element),
    versions: listeDe(element.versions),
    conservation: texteConservation(element, { moi }),
    depart: element.reglagesEcrits === true,
  };
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
