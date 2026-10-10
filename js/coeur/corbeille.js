// Corbeille des plats : plats mis de côté par l'un des membres, jamais automatiquement. Logique pure : ni DOM ni
// Firebase. Un plat est dans la corbeille quand sa fiche porte `corbeille { le, par }` (horodatage serveur, adresse de
// la personne) ; sans ce champ, il est actif. Module sans dépendance vers plats.js ni notes.js (plats.js l'importe).
import { normaliserEmail } from './roles.js';

const MOIS = ['janvier', 'février', 'mars', 'avril', 'mai', 'juin', 'juillet', 'août', 'septembre', 'octobre',
  'novembre', 'décembre'];

const estObjet = (valeur) => Boolean(valeur) && typeof valeur === 'object' && !Array.isArray(valeur);
const reduire = (texte) => (typeof texte === 'string' ? texte.replace(/\s+/g, ' ').trim() : '');
const comparerNoms = new Intl.Collator('fr', { sensitivity: 'base' }).compare;
// Ordre des identifiants indépendant de la langue du téléphone.
const parId = (a, b) => (a < b ? -1 : a > b ? 1 : 0);

/** Vrai si le plat est dans la corbeille (champ `corbeille` objet). */
export function estDansCorbeille(plat) {
  return estObjet(plat) && estObjet(plat.corbeille);
}

/**
 * Date tirée d'une Date, d'un horodatage Firestore (`toDate()` ou `{ seconds }`) ou d'un texte ISO ; null sinon.
 * Exportée pour coeur/demandes.js (T2e).
 */
export function versDate(valeur) {
  let date = null;
  if (valeur instanceof Date) date = valeur;
  else if (estObjet(valeur) && typeof valeur.toDate === 'function') {
    try {
      date = valeur.toDate();
    } catch {
      date = null;
    }
  } else if (estObjet(valeur) && typeof valeur.seconds === 'number' && Number.isFinite(valeur.seconds)) {
    const nano = typeof valeur.nanoseconds === 'number' && Number.isFinite(valeur.nanoseconds) ? valeur.nanoseconds : 0;
    date = new Date(valeur.seconds * 1000 + Math.floor(nano / 1e6));
  } else if (typeof valeur === 'string' && valeur.trim()) {
    date = new Date(valeur.trim());
  }
  return date instanceof Date && !Number.isNaN(date.getTime()) ? date : null;
}

/**
 * Date de mise à la corbeille (`corbeille.le` : Date, horodatage Firestore, texte ISO) ; null si le plat n'est pas
 * dans la corbeille ou si la date est illisible (horodatage du serveur encore en attente, hors ligne).
 */
export function dateCorbeille(plat) {
  return estDansCorbeille(plat) ? versDate(plat.corbeille.le) : null;
}

/**
 * Sépare les plats : { actifs, corbeille }. Les actifs gardent l'ordre reçu ; la corbeille est triée du plus récent au
 * plus ancien (`corbeille.le` : Date, horodatage Firestore {toDate()|seconds}, texte ISO ; illisible = en dernier),
 * puis par nom, puis par identifiant. Ce qui n'est pas une fiche est écarté. La liste reçue n'est jamais modifiée.
 */
export function separerCorbeille(plats) {
  const actifs = [];
  const corbeille = [];
  for (const plat of Array.isArray(plats) ? plats : []) {
    if (!estObjet(plat)) continue;
    (estDansCorbeille(plat) ? corbeille : actifs).push(plat);
  }
  const temps = new Map(corbeille.map((plat) => [plat, dateCorbeille(plat)?.getTime() ?? null]));
  corbeille.sort((a, b) => {
    const ta = temps.get(a);
    const tb = temps.get(b);
    if (ta !== tb) {
      if (ta === null) return 1;
      if (tb === null) return -1;
      return tb - ta;
    }
    return comparerNoms(reduire(a.nom), reduire(b.nom)) || parId(String(a.id ?? ''), String(b.id ?? ''));
  });
  return { actifs, corbeille };
}

/**
 * Plats actifs notés « Jamais » (0) par tous les profils donnés (au moins un profil) : la suggestion « Personne n'en
 * veut ». Seuls les profils donnés comptent (la note d'un profil retiré est ignorée) ; un profil qui n'a pas noté le
 * plat suffit à le garder. Ordre : nom, puis identifiant.
 */
export function platsSansPreneur(plats, profils) {
  const ids = [...new Set((Array.isArray(profils) ? profils : [])
    .filter((profil) => estObjet(profil) && typeof profil.id === 'string' && profil.id !== '')
    .map((profil) => profil.id))];
  if (!ids.length) return [];
  return (Array.isArray(plats) ? plats : [])
    .filter((plat) => estObjet(plat) && typeof plat.id === 'string' && plat.id !== '' && !estDansCorbeille(plat))
    .filter((plat) => estObjet(plat.notes)
      && ids.every((id) => Object.hasOwn(plat.notes, id) && plat.notes[id] === 0))
    .sort((a, b) => comparerNoms(reduire(a.nom), reduire(b.nom)) || parId(a.id, b.id));
}

/**
 * Identifiants des demandes ouvertes à clore quand on vide ces plats : celles dont `platId` est l'un de ces plats, ou
 * dont l'identifiant le désigne (`<platId>__recette`, `<platId>__<profilId>`). Demandes traitées ignorées ; chaque
 * identifiant une seule fois, dans l'ordre des demandes.
 */
export function demandesDesPlats(platIds, demandes) {
  const vises = new Set((Array.isArray(platIds) ? platIds : [])
    .filter((id) => typeof id === 'string' && id !== ''));
  const resultat = [];
  for (const demande of Array.isArray(demandes) ? demandes : []) {
    if (!estObjet(demande) || demande.statut !== 'ouverte' || typeof demande.id !== 'string' || demande.id === '') continue;
    const visee = vises.has(demande.platId) || (demande.id.includes('__') && vises.has(demande.id.split('__')[0]));
    if (visee && !resultat.includes(demande.id)) resultat.push(demande.id);
  }
  return resultat;
}

/**
 * « 9 octobre », « 1er mars » ; l'année s'ajoute si elle n'est pas celle de `maintenant`. Date locale. Exportée pour
 * coeur/demandes.js (T2e).
 */
export function jourLisible(date, maintenant) {
  const jour = date.getDate() === 1 ? '1er' : String(date.getDate());
  const annee = date.getFullYear() === maintenant.getFullYear() ? '' : ` ${date.getFullYear()}`;
  return `${jour} ${MOIS[date.getMonth()]}${annee}`;
}

/**
 * Texte d'un plat de la corbeille : « Mis à la corbeille le 9 octobre », suivi de « par <prénom> » si l'adresse
 * (`corbeille.par`) est celle d'un profil, ou de « par vous » si c'est celle de la personne connectée (`moi` : son
 * profil, ou son adresse). Aucune adresse n'est jamais affichée ; date illisible (horodatage du serveur en attente) :
 * « Mis à la corbeille », sans date. '' si le plat n'est pas dans la corbeille.
 */
export function texteCorbeille(plat, { profils = [], moi = null, maintenant = new Date() } = {}) {
  if (!estDansCorbeille(plat)) return '';
  const aujourdhui = versDate(maintenant) ?? new Date();
  const date = dateCorbeille(plat);
  let texte = 'Mis à la corbeille';
  if (date) texte += ` le ${jourLisible(date, aujourdhui)}`;
  const par = normaliserEmail(plat.corbeille.par);
  if (!par) return texte;
  const monAdresse = normaliserEmail(typeof moi === 'string' ? moi : moi?.email);
  if (monAdresse && monAdresse === par) return `${texte} par vous`;
  const auteur = (Array.isArray(profils) ? profils : [])
    .find((profil) => estObjet(profil) && normaliserEmail(profil.email) === par);
  const prenom = reduire(auteur?.nom);
  return prenom ? `${texte} par ${prenom}` : texte;
}
