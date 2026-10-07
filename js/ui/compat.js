// Lignes « 🌿 Version pour <Prénom> » / « ❌ Version pour <Prénom> à créer » partout où un plat apparaît (liste,
// fiche, Découvrir). Seuls les profils qui ont des règles, et dont le plat n'est pas simplement « ok », ont une
// ligne ; un plat ⏳ n'en a jamais. Toujours un texte, jamais la couleur seule. Dans la vue « Repas et courses », ni
// croix ni alerte : « Pas encore de version pour vous », en texte discret (décision 6 du plan T2).
import { el } from './dom.js';
import { profilsContraints } from '../coeur/compatibilite.js';

/** Prénom affiché d'un profil. */
export function nomDe(profil) {
  return String(profil?.nom ?? '').replace(/\s+/g, ' ').trim() || 'ce profil';
}

/**
 * Ce que le plat donne pour chaque profil contraint, dans l'ordre d'affichage : seulement les profils pour lesquels
 * il y a quelque chose à dire (version qui convient, à créer ou à revoir).
 * → [{ profil, resultat, cas: 'version' | 'aCreer' | 'aRevoir' }]
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
    else if (resultat.variante) cas = 'version';
    if (cas) etats.push({ profil, resultat, cas });
  }
  return etats;
}

/** Vrai si ce profil est la personne connectée, vue « Repas et courses » : on lui dit « vous ». */
export function estVous(profil, { moi, role } = {}) {
  return role !== 'gestionnaire' && Boolean(moi) && moi.id === profil?.id;
}

/** Texte d'une ligne, selon le cas et le rôle (tableau du plan T2a). → { emoji, texte, classe } */
export function texteCompat({ profil, cas }, { moi, role } = {}) {
  const nom = nomDe(profil);
  const vous = estVous(profil, { moi, role });
  if (cas === 'version') {
    return { emoji: '🌿', texte: vous ? 'Votre version' : `Version pour ${nom}`, classe: 'compat-version' };
  }
  if (role === 'gestionnaire') {
    return {
      emoji: '❌',
      texte: cas === 'aRevoir' ? `Version pour ${nom} à revoir` : `Version pour ${nom} à créer`,
      classe: 'compat-exclu',
    };
  }
  return { emoji: '', texte: vous ? 'Pas encore de version pour vous' : `Pas encore de version pour ${nom}`, classe: 'compat-discret' };
}

/** Un morceau de ligne : « 🌿 Version pour X », emoji masqué aux lecteurs d'écran (le texte suffit). */
export function morceauCompat({ emoji, texte, classe }, suite = '') {
  return el('span', { class: `compat-morceau ${classe}` },
    emoji ? el('span', { 'aria-hidden': 'true' }, `${emoji}\u00A0`) : null,
    texte,
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
 * Filtre de Découvrir (et du nombre de plats à noter) pour un profil : écarte les plats qui attendent encore sa
 * version (à créer ou à revoir). Null pour un profil sans règle : la file reste celle de T1d.
 */
export function garderPour(ctx, profilId) {
  const profil = profilsContraints(ctx?.profils).find((p) => p.id === profilId);
  if (!profil || typeof ctx?.compat !== 'function') return null;
  return (plat) => {
    const resultat = ctx.compat(plat, profil);
    return !(resultat?.aCreer || resultat?.aRevoir);
  };
}
