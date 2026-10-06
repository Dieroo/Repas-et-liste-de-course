// Profils du foyer : validation, ordre, personne connectée. Logique pure.
import { slug } from './slug.js';
import { normaliserEmail } from './roles.js';

export const PORTIONS = [
  { valeur: 1, libelle: 'Adulte' },
  { valeur: 0.5, libelle: 'Enfant' },
];

export const NOM_PROFIL_MAX = 40;

const FORME_EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/** Profils dans l'ordre d'affichage (ordre, puis nom). */
export function trierProfils(profils) {
  return [...(profils ?? [])].sort((a, b) => (a.ordre ?? 0) - (b.ordre ?? 0)
    || String(a.nom ?? '').localeCompare(String(b.nom ?? ''), 'fr'));
}

/** Profil de la personne connectée, reconnue par son adresse ; null sinon. */
export function profilDeLEmail(profils, email) {
  const moi = normaliserEmail(email);
  if (!moi) return null;
  return (profils ?? []).find((profil) => normaliserEmail(profil.email) === moi) ?? null;
}

export function libellePortion(coefPortion) {
  const connue = PORTIONS.find((p) => p.valeur === coefPortion);
  if (connue) return connue.libelle;
  if (typeof coefPortion !== 'number' || !Number.isFinite(coefPortion)) return 'Portion à choisir';
  return `Portion ${new Intl.NumberFormat('fr-FR').format(coefPortion)}`;
}

/**
 * Vérifie un profil saisi dans Réglages.
 * → { profil } prêt à enregistrer, ou { erreurs: { nom?, email?, coefPortion? } }.
 * `id` : profil modifié (absent pour un nouveau profil).
 * `emailOuverture` : adresse affichée à l'ouverture du formulaire d'un profil existant. Si le champ n'a pas été
 * changé, `email` est absent du profil rendu (ni validé ni écrit) : une liaison « C'est moi » faite entre-temps
 * ailleurs, ou une adresse déliée, reste telle quelle.
 */
export function preparerProfil({ nom, email, coefPortion }, { profils = [], id = null, emailOuverture } = {}) {
  const erreurs = {};
  const nomPropre = String(nom ?? '').replace(/\s+/g, ' ').trim();
  const emailPropre = normaliserEmail(email);
  const autres = profils.filter((profil) => profil.id !== id);
  const existant = profils.find((profil) => profil.id === id);
  const emailInchange = Boolean(existant) && emailOuverture !== undefined
    && emailPropre === normaliserEmail(emailOuverture);

  if (!nomPropre) erreurs.nom = 'Indiquez un prénom.';
  else if (nomPropre.length > NOM_PROFIL_MAX) erreurs.nom = `${NOM_PROFIL_MAX} caractères au plus.`;

  if (emailInchange) {
    // Rien à vérifier : l'adresse ne sera pas écrite.
  } else if (emailPropre && !FORME_EMAIL.test(emailPropre)) erreurs.email = 'Cette adresse ne semble pas valide.';
  else if (emailPropre && autres.some((p) => normaliserEmail(p.email) === emailPropre)) {
    erreurs.email = 'Cette adresse est déjà celle d’un autre profil.';
  }

  if (!PORTIONS.some((p) => p.valeur === coefPortion)) erreurs.coefPortion = 'Choisissez une portion.';

  if (Object.keys(erreurs).length) return { erreurs };

  return {
    profil: {
      id: existant ? existant.id : idLibre(slug(nomPropre) || 'profil', profils),
      nom: nomPropre,
      ...(emailInchange ? {} : { email: emailPropre }),
      coefPortion,
      ordre: existant ? existant.ordre ?? 0 : Math.max(0, ...profils.map((p) => p.ordre ?? 0)) + 1,
    },
  };
}

function idLibre(base, profils) {
  const pris = new Set(profils.map((p) => p.id));
  if (!pris.has(base)) return base;
  let n = 2;
  while (pris.has(`${base}-${n}`)) n += 1;
  return `${base}-${n}`;
}

// ——— Personne connectée reliée à son profil (« Qui êtes-vous ? », « Ce n'est pas moi ») ———

/** Vrai pour un profil à portion d'enfant (moins d'une portion adulte). */
export function estEnfant(profil) {
  return typeof profil?.coefPortion === 'number' && profil.coefPortion < 1;
}

/** Vrai si le profil porte l'adresse du gestionnaire (`reglages/foyer.gestionnaire`, la seule sûre d'être active). */
function estDuGestionnaire(profil, gestionnaire) {
  const adresse = normaliserEmail(gestionnaire);
  return adresse !== '' && normaliserEmail(profil?.email) === adresse;
}

/**
 * Prénoms proposés par « Qui êtes-vous ? » : les adultes, dans l'ordre d'affichage, sauf le profil du gestionnaire.
 * `autreAdresse` : le profil porte déjà une adresse (faute de frappe probable), à confirmer avant de le relier.
 * → [{ profil, autreAdresse }]
 */
export function profilsARelier(profils, { gestionnaire } = {}) {
  return trierProfils(profils)
    .filter((profil) => profil && !estEnfant(profil) && !estDuGestionnaire(profil, gestionnaire))
    .map((profil) => ({ profil, autreAdresse: normaliserEmail(profil.email) !== '' }));
}

/**
 * « C'est moi » : relie le profil choisi à l'adresse de la personne connectée, et à elle seule.
 * `vu` (facultatif) : adresse du profil telle que l'écran l'a montrée au moment du choix ('' : sans adresse).
 * `attendu` : adresse actuelle du profil ('' s'il n'en a pas), comparée de nouveau au moment d'écrire.
 * → { id, email, attendu }, ou { erreur } : 'inconnu' (profil absent, ou personne sans adresse), 'enfant',
 *   'change' (l'adresse du profil n'est plus celle montrée : la personne n'a pas confirmé ce qu'elle remplace),
 *   'gestionnaire' (profil du gestionnaire), 'adresse_prise' (un autre profil porte déjà cette adresse ; `nom` dit
 *   lequel).
 */
export function preparerReliure(profils, profilId, email, { gestionnaire, vu } = {}) {
  const liste = Array.isArray(profils) ? profils : [];
  const adresse = normaliserEmail(email);
  const profil = liste.find((p) => p?.id === profilId);
  if (!profil || !adresse) return { erreur: 'inconnu' };
  if (estEnfant(profil)) return { erreur: 'enfant' };
  const attendu = normaliserEmail(profil.email);
  if (vu !== undefined && vu !== null && normaliserEmail(vu) !== attendu) return { erreur: 'change' };
  // Le profil du gestionnaire reste à lui ; le gestionnaire lui-même peut le reprendre.
  if (attendu !== adresse && estDuGestionnaire(profil, gestionnaire)) return { erreur: 'gestionnaire' };
  const autre = liste.find((p) => p && p.id !== profil.id && normaliserEmail(p.email) === adresse);
  if (autre) return { erreur: 'adresse_prise', nom: String(autre.nom ?? '') };
  return { id: profil.id, email: adresse, attendu };
}

/**
 * « Ce n'est pas moi » : retire l'adresse de la personne connectée de son profil.
 * → { id, attendu } (adresse actuelle, comparée de nouveau au moment d'écrire), ou { erreur: 'non_relie' }.
 */
export function preparerDeliure(profils, email) {
  const profil = profilDeLEmail(profils, email);
  if (!profil) return { erreur: 'non_relie' };
  return { id: profil.id, attendu: normaliserEmail(profil.email) };
}
