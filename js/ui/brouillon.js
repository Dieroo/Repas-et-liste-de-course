// Brouillon durable de l'écran « Modifier » : la saisie en cours survit à la fermeture de l'app.
// localStorage et non sessionStorage : Android efface ce dernier quand l'app est fermée depuis les applis récentes.
// Le stockage est partagé avec les autres sites du même domaine github.io, d'où le préfixe ; tout accès peut échouer
// (stockage plein ou bloqué) : le brouillon est alors simplement perdu, l'écran marche quand même.
import { brouillonValide } from '../coeur/edition.js';

const PREFIXE = 'repas-courses:brouillon:';
const DUREE_MAX_MS = 30 * 24 * 60 * 60 * 1000; // au-delà de 30 jours, un brouillon est oublié

const cle = (uid, platId) => `${PREFIXE}${uid}:${platId}`;

/** Brouillon { v, base, saisie, depuis } de cette personne pour ce plat, ou null (abîmé ou trop ancien : effacé). */
export function lireBrouillon(uid, platId) {
  if (!uid || !platId) return null;
  try {
    const brut = localStorage.getItem(cle(uid, platId));
    if (brut === null) return null;
    let brouillon = null;
    try {
      brouillon = JSON.parse(brut);
    } catch {
      brouillon = null;
    }
    if (!brouillonValide(brouillon) || Date.now() - brouillon.depuis > DUREE_MAX_MS) {
      localStorage.removeItem(cle(uid, platId));
      return null;
    }
    return brouillon;
  } catch {
    return null;
  }
}

/** Enregistre la saisie en cours (et la fiche telle qu'elle était à l'ouverture). Échec silencieux. */
export function ecrireBrouillon(uid, platId, { base, saisie }) {
  if (!uid || !platId) return;
  try {
    localStorage.setItem(cle(uid, platId), JSON.stringify({ v: 1, base, saisie, depuis: Date.now() }));
  } catch {
    // Stockage plein ou bloqué : la saisie reste à l'écran. L'ancien brouillon, devenu périmé, est effacé pour ne
    // pas être repris à la place de la saisie récente.
    try {
      localStorage.removeItem(cle(uid, platId));
    } catch {
      // Stockage inaccessible : rien à faire.
    }
  }
}

export function effacerBrouillon(uid, platId) {
  if (!uid || !platId) return;
  try {
    localStorage.removeItem(cle(uid, platId));
  } catch {
    // Rien à faire.
  }
}

/** Efface tous les brouillons de l'app (déconnexion) : rien ne reste sur le téléphone. */
export function effacerBrouillons() {
  try {
    const cles = [];
    for (let i = 0; i < localStorage.length; i += 1) {
      const nom = localStorage.key(i);
      if (nom?.startsWith(PREFIXE)) cles.push(nom);
    }
    for (const nom of cles) localStorage.removeItem(nom);
  } catch {
    // Rien à faire.
  }
}
