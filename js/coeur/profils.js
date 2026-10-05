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
  return PORTIONS.find((p) => p.valeur === coefPortion)?.libelle ?? `Portion ${coefPortion}`;
}

/**
 * Vérifie un profil saisi dans Réglages.
 * → { profil } prêt à enregistrer, ou { erreurs: { nom?, email?, coefPortion? } }.
 * `id` : profil modifié (absent pour un nouveau profil).
 */
export function preparerProfil({ nom, email, coefPortion }, { profils = [], id = null } = {}) {
  const erreurs = {};
  const nomPropre = String(nom ?? '').replace(/\s+/g, ' ').trim();
  const emailPropre = normaliserEmail(email);
  const autres = profils.filter((profil) => profil.id !== id);

  if (!nomPropre) erreurs.nom = 'Indiquez un prénom.';
  else if (nomPropre.length > NOM_PROFIL_MAX) erreurs.nom = `${NOM_PROFIL_MAX} caractères au plus.`;

  if (emailPropre && !FORME_EMAIL.test(emailPropre)) erreurs.email = 'Cette adresse ne semble pas valide.';
  else if (emailPropre && autres.some((p) => normaliserEmail(p.email) === emailPropre)) {
    erreurs.email = 'Cette adresse est déjà celle d’un autre profil.';
  }

  if (!PORTIONS.some((p) => p.valeur === coefPortion)) erreurs.coefPortion = 'Choisissez une portion.';

  if (Object.keys(erreurs).length) return { erreurs };

  const existant = profils.find((profil) => profil.id === id);
  return {
    profil: {
      id: existant ? existant.id : idLibre(slug(nomPropre) || 'profil', profils),
      nom: nomPropre,
      email: emailPropre,
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
