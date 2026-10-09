// Lignes « 🌿 Version pour <Prénom> » / « ❌ Version pour <Prénom> à créer » partout où un plat apparaît (liste,
// fiche, Découvrir). Seuls les profils qui ont des règles, et dont le plat n'est pas simplement « ok », ont une
// ligne ; un plat ⏳ n'en a jamais. Toujours un texte, jamais la couleur seule. Dans la vue « Repas et courses », ni
// croix ni alerte : « Pas encore de version pour vous », en texte discret (décision 6 du plan T2).
// Un profil qui attend des versions de styles (« Pas de viande » : mer et végétale ; regles.js › stylesAttendus) voit
// ses versions nommées par leur style (« 🌿 Versions pour <Prénom> : mer et végétale ») ; une version d'avant les
// styles porte son style déduit (compatibilite.js › styleDe, déjà dans `evaluer(…).versions`). Une version qui manque
// encore (plat « à compléter ») n'est annoncée qu'au gestionnaire : « · végétale à demander ».
// Précautions selon l'âge (T2c, coeur/age.js) : une ligne 🧸 par profil qui a une précaution d'âge active, sous la
// ligne 🌿 / ❌ (« 🧸 ❌ Pas avant 18 ans : alcool », « 🧸 ! Déconseillé avant 15 ans : viande crue ») ; dans la vue
// « Repas et courses », ni ❌ ni ! : la gravité passe par « Pas avant » et « Déconseillé ». Ces règles ne passent
// jamais par `evaluer` : un enfant qui n'a que des précautions d'âge n'a ni ligne 🌿 / ❌ ni version.
import { el } from './dom.js';
import { profilsContraints } from '../coeur/compatibilite.js';
import { stylesAttendus } from '../coeur/regles.js';
import { aCompleterSelon } from '../coeur/plats.js';
import { LIBELLES_STYLE, STYLES } from '../coeur/vocabulaire.js';
import { lignePrecautions as resumePrecautions, precautionsAge, profilsAvecAge, texteBorne } from '../coeur/age.js';

/** Prénom affiché d'un profil. */
export function nomDe(profil) {
  return String(profil?.nom ?? '').replace(/\s+/g, ' ').trim() || 'ce profil';
}

/** Styles rangés dans l'ordre d'affichage (mer, puis végétale), sans doublon ni style inconnu. */
export function rangerStyles(styles) {
  const presents = new Set(Array.isArray(styles) ? styles : []);
  return STYLES.filter((style) => presents.has(style));
}

/** « mer », « végétale », « mer et végétale » (ou « mer ou végétale » avec `liaison` = 'ou'). */
export function libellesStyles(styles, liaison = 'et') {
  const mots = rangerStyles(styles).map((style) => LIBELLES_STYLE[style] ?? style);
  return mots.length > 1 ? `${mots.slice(0, -1).join(', ')} ${liaison} ${mots.at(-1)}` : mots.join('');
}

/**
 * Styles des versions qui conviennent à ce profil (résultat de compatibilite.js › evaluer), mer puis végétale ;
 * [] pour un profil qui n'attend aucun style : sa version unique est nommée sans style, comme avant.
 */
export function stylesConvenant(profil, resultat) {
  if (!stylesAttendus(profil).length) return [];
  const versions = Array.isArray(resultat?.versions) ? resultat.versions : [];
  return rangerStyles(versions.filter((version) => version?.convient).map((version) => version.style));
}

/**
 * Ce que le plat donne pour chaque profil contraint, dans l'ordre d'affichage : seulement les profils pour lesquels
 * il y a quelque chose à dire (version qui convient, à compléter, à créer ou à revoir). « À compléter » : une version
 * convient, mais il en manque d'un style attendu ; mêmes plats que le bandeau « Versions pour <Prénom> » de Plats
 * (plats.js › aCompleterSelon : ni apéro, ni préparation, ni plat noté « Jamais » par ce profil).
 * → [{ profil, resultat, cas: 'version' | 'aCompleter' | 'aCreer' | 'aRevoir' }]
 */
export function etatsCompat(plat, ctx) {
  if (!plat) return [];
  const evaluer = ctx?.compat;
  if (typeof evaluer !== 'function') return [];
  const etats = [];
  for (const profil of profilsContraints(ctx.profils)) {
    const resultat = evaluer(plat, profil);
    if (!resultat || resultat.niveau === 'inconnu') continue;
    let cas = null;
    if (resultat.aRevoir) cas = 'aRevoir';
    else if (resultat.aCreer) cas = 'aCreer';
    else if (resultat.variante) cas = aCompleterSelon(plat, profil, resultat) ? 'aCompleter' : 'version';
    if (cas) etats.push({ profil, resultat, cas });
  }
  return etats;
}

/** Vrai si ce profil est la personne connectée, vue « Repas et courses » : on lui dit « vous ». */
export function estVous(profil, { moi, role } = {}) {
  return role !== 'gestionnaire' && Boolean(moi) && moi.id === profil?.id;
}

/**
 * Nom des versions qui conviennent : « Version pour X » (profil sans style attendu), « Version mer pour X »,
 * « Versions pour X : mer et végétale » ; pour soi (vue « Repas et courses ») : « Votre version », « Votre version :
 * mer », « Vos versions : mer et végétale ».
 */
export function nomDesVersions(profil, resultat, { moi, role } = {}) {
  const nom = nomDe(profil);
  const vous = estVous(profil, { moi, role });
  const styles = stylesConvenant(profil, resultat);
  const libelles = libellesStyles(styles);
  if (!styles.length) return vous ? 'Votre version' : `Version pour ${nom}`;
  if (styles.length > 1) return vous ? `Vos versions\u00A0: ${libelles}` : `Versions pour ${nom}\u00A0: ${libelles}`;
  return vous ? `Votre version\u00A0: ${libelles}` : `Version ${libelles} pour ${nom}`;
}

/**
 * Texte d'une ligne, selon le cas et le rôle (tableau du plan T2a). `aDemander` : styles qui manquent encore, dits au
 * gestionnaire seul (« végétale à demander »). → { emoji, texte, classe, aDemander }
 */
export function texteCompat({ profil, resultat, cas }, { moi, role } = {}) {
  const nom = nomDe(profil);
  const vous = estVous(profil, { moi, role });
  if (cas === 'version' || cas === 'aCompleter') {
    const manquants = cas === 'aCompleter' && role === 'gestionnaire' ? rangerStyles(resultat?.manquants) : [];
    return {
      emoji: '🌿',
      texte: nomDesVersions(profil, resultat, { moi, role }),
      classe: 'compat-version',
      aDemander: manquants.length ? `${libellesStyles(manquants)} à demander` : '',
    };
  }
  if (role === 'gestionnaire') {
    return {
      emoji: '❌',
      texte: cas === 'aRevoir' ? `Version pour ${nom} à revoir` : `Version pour ${nom} à créer`,
      classe: 'compat-exclu',
      aDemander: '',
    };
  }
  return {
    emoji: '',
    texte: vous ? 'Pas encore de version pour vous' : `Pas encore de version pour ${nom}`,
    classe: 'compat-discret',
    aDemander: '',
  };
}

/**
 * Un morceau de ligne : « 🌿 Version pour X », emoji masqué aux lecteurs d'écran (le texte suffit). La suite « · mer
 * à demander » reste collée au prénom qui la précède (espace insécable avant le point médian).
 */
export function morceauCompat({ emoji, texte, classe, aDemander = '' }, suite = '') {
  return el('span', { class: `compat-morceau ${classe}` },
    emoji ? el('span', { 'aria-hidden': 'true' }, `${emoji}\u00A0`) : null,
    texte,
    aDemander ? el('span', { class: 'compat-a-demander' }, `\u00A0· ${aDemander}`) : null,
    suite);
}

/**
 * Ligne de compatibilité d'un plat, sous la ligne de notes : un morceau par profil concerné. `role` : rôle
 * effectif ; `moi` : profil de la personne connectée. → Node ou null (rien à dire).
 */
export function ligneCompat(plat, ctx, { moi = ctx?.moi ?? null, role = ctx?.role ?? null } = {}) {
  const etats = etatsCompat(plat, ctx);
  if (!etats.length) return null;
  return el('span', { class: 'compat' }, etats.map((etat) => morceauCompat(texteCompat(etat, { moi, role }))));
}

/**
 * Filtre des versions pour un profil qui a des règles (régime) : écarte les plats qui attendent encore sa version (à
 * créer ou à revoir). Un plat à compléter reste : une de ses versions convient déjà. Null pour un profil sans règle de
 * régime (un enfant qui n'a que des précautions d'âge compris).
 */
export function garderVersions(ctx, profilId) {
  const profil = profilsContraints(ctx?.profils).find((p) => p.id === profilId);
  if (!profil || typeof ctx?.compat !== 'function') return null;
  return (plat) => {
    const resultat = ctx.compat(plat, profil);
    return !(resultat?.aCreer || resultat?.aRevoir);
  };
}

/** Profils qui ont au moins une précaution d'âge active, dans l'ordre d'affichage (`ctx.profilsAvecAge`, sinon calculés). */
export function profilsAgeDe(ctx) {
  if (Array.isArray(ctx?.profilsAvecAge)) return ctx.profilsAvecAge;
  return profilsAvecAge(ctx?.profils ?? []);
}

/**
 * Précautions d'âge d'un plat pour un profil, sur le plat tel qu'il lui serait servi (`ctx.precautions`, mémorisé par
 * l'app ; sinon calculées ici, avec la version que `ctx.compat` retient pour lui). → [précaution] (coeur/age.js)
 */
export function precautionsDe(plat, profil, ctx) {
  if (!plat || !profil) return [];
  if (typeof ctx?.precautions === 'function') return ctx.precautions(plat, profil) ?? [];
  const variante = typeof ctx?.compat === 'function' ? ctx.compat(plat, profil)?.variante ?? null : null;
  return precautionsAge(plat, profil, { variante });
}

/**
 * Filtre de l'âge pour un profil qui a des précautions d'âge actives : écarte les plats repérés comme pas encore pour
 * lui (au moins une précaution « Pas avant… »). Un plat « Déconseillé… » reste, avec sa ligne. Null sinon.
 */
export function garderAge(ctx, profilId) {
  const profil = profilsAgeDe(ctx).find((p) => p.id === profilId);
  if (!profil) return null;
  return (plat) => !precautionsDe(plat, profil, ctx).some((precaution) => precaution?.severite === 'exclu');
}

/**
 * Filtre de Découvrir (file, nombre de plats à noter) et de l'invitation de Plats pour un profil : les versions
 * (garderVersions) et l'âge (garderAge) à la fois. Null si aucun ne s'applique : la file reste celle de T1d.
 */
export function garderPour(ctx, profilId) {
  const versions = garderVersions(ctx, profilId);
  const age = garderAge(ctx, profilId);
  if (!versions || !age) return versions ?? age;
  return (plat) => versions(plat) && age(plat);
}

/** « Pas avant 5 ans » ou « Déconseillé avant 15 ans » (sans borne lisible : « À éviter », « Déconseillé »). */
export function texteSeverite(severite, jusquAMois) {
  const borne = Number.isFinite(jusquAMois) && jusquAMois > 0 ? texteBorne(jusquAMois) : '';
  if (severite === 'exclu') return borne ? `Pas avant ${borne}` : 'À éviter';
  return borne ? `Déconseillé avant ${borne}` : 'Déconseillé';
}

/** « 🧸 » masqué aux lecteurs d'écran (le texte suffit). */
const nounours = () => el('span', { 'aria-hidden': 'true' }, '🧸\u00A0');

/**
 * Symbole de gravité, gestionnaire seulement : « ❌ » (pas avant) ou « ! » dans une pastille (déconseillé), masqués aux
 * lecteurs d'écran. Null dans la vue « Repas et courses ».
 */
export function symboleGravite(severite, role) {
  if (role !== 'gestionnaire') return null;
  if (severite === 'exclu') return el('span', { 'aria-hidden': 'true' }, '❌\u00A0');
  return [el('span', { class: 'compat-attention', 'aria-hidden': 'true' }, '!'), ' '];
}

/**
 * Ligne 🧸 d'un profil : « 🧸 ❌ Pas avant 18 ans : alcool + 1 autre » (gestionnaire), « 🧸 Pas avant 18 ans :
 * alcool + 1 autre » (vue « Repas et courses »). Un texte masqué « Pour <Enfant> : » ouvre la ligne ; avec deux
 * enfants ou plus, le prénom s'affiche aussi (« 🧸 <Prénom> · … »). Null sans précaution.
 */
function morceauAge(profil, precautions, { role, plusieurs }) {
  const resume = resumePrecautions(precautions);
  if (!resume) return null;
  const nom = nomDe(profil);
  const gestionnaire = role === 'gestionnaire';
  const courts = (resume.courts ?? []).filter(Boolean).join(', ');
  const autres = resume.autres > 1 ? ` + ${resume.autres}\u00A0autres` : resume.autres === 1 ? ' + 1\u00A0autre' : '';
  let classe = 'compat-enfant';
  if (gestionnaire) classe = resume.severite === 'exclu' ? 'compat-exclu' : 'compat-age-attention';
  return el('span', { class: `compat-morceau compat-age ${classe}` },
    el('span', { class: 'visuellement-masque' }, `Pour ${nom}\u00A0: `),
    nounours(),
    plusieurs ? el('span', { 'aria-hidden': 'true' }, `${nom}\u00A0· `) : null,
    symboleGravite(resume.severite, role),
    `${texteSeverite(resume.severite, resume.jusquAMois)}\u00A0: ${courts}${autres}`);
}

/**
 * Lignes 🧸 d'un plat (liste des plats, carte de Découvrir, quel que soit le profil noté), sous la ligne 🌿 / ❌ : une
 * par profil qui a une précaution d'âge active et que le plat déclenche (sur le plat tel qu'il lui serait servi).
 * `role` : rôle effectif (sans ❌ ni ! hors gestionnaire).
 * → Node ou null (rien à dire)
 */
export function lignePrecautions(plat, ctx, { role = ctx?.role ?? null } = {}) {
  if (!plat) return null;
  const avecAge = profilsAgeDe(ctx);
  if (!avecAge.length) return null;
  const plusieurs = avecAge.length > 1;
  const morceaux = avecAge
    .map((profil) => morceauAge(profil, precautionsDe(plat, profil, ctx), { role, plusieurs }))
    .filter(Boolean);
  return morceaux.length ? el('span', { class: 'compat-lignes-age' }, morceaux) : null;
}
