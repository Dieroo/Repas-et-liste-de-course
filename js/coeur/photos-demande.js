// Recette demandée en photos (2026-10-16) : la personne joint jusqu'à 3 photos d'une recette (carte, page de livre,
// écran) à sa demande de recette ; le gestionnaire les envoie à Claude avec la demande. Logique pure : identifiants des
// photos, nom par défaut quand la personne n'en donne pas, nom libre quand celui que Claude trouve est déjà pris.
// Photos dans `photosDemandes/<platId>__recette--<rang>` (une par document : une photo lisible pèse près de 1 Mo),
// jamais dans la sauvegarde, effacées quand la recette est enregistrée. N'importe que plats.js et slug.js.
import { NOM_MAX, nouveauPlatParNom } from './plats.js';
import { slug } from './slug.js';

/** Photos d'une demande, au plus. */
export const PHOTOS_DEMANDE_MAX = 3;

const ID_PLAT = /^[a-z0-9-]+$/;
const MOIS = ['janvier', 'février', 'mars', 'avril', 'mai', 'juin', 'juillet', 'août', 'septembre', 'octobre', 'novembre', 'décembre'];

/** Nombre de photos d'une demande (champ `photos`, entier de 1 à 3) ; 0 sinon. */
export function nombrePhotos(demande) {
  const n = demande?.photos;
  return Number.isInteger(n) && n >= 1 && n <= PHOTOS_DEMANDE_MAX ? n : 0;
}

/** Identifiant du document de la photo `rang` (1 à 3) de la demande de recette d'un plat ; null si illisible. */
export function idPhotoDemande(platId, rang) {
  if (typeof platId !== 'string' || !ID_PLAT.test(platId)) return null;
  if (!Number.isInteger(rang) || rang < 1 || rang > PHOTOS_DEMANDE_MAX) return null;
  return `${platId}__recette--${rang}`;
}

/**
 * Identifiants de toutes les photos possibles d'une demande de recette (`<platId>__recette`) : les trois rangs, pour
 * effacer sans savoir combien il y en a. [] pour une autre demande (version) ou un identifiant illisible.
 */
export function idsPhotosDeLaDemande(demandeId) {
  const trouve = /^([a-z0-9-]+)__recette$/.exec(String(demandeId ?? ''));
  if (!trouve) return [];
  return Array.from({ length: PHOTOS_DEMANDE_MAX }, (_, i) => idPhotoDemande(trouve[1], i + 1));
}

/**
 * Demande de recette d'un plat en attente de ses photos : la demande ouverte `<platId>__recette` qui en porte (null
 * sinon). `demandes` : documents { id, statut, photos, nomATrouver? }.
 */
export function demandeEnPhotos(platId, demandes = []) {
  const demande = (Array.isArray(demandes) ? demandes : [])
    .find((d) => d?.id === `${platId}__recette` && d.statut === 'ouverte');
  return demande && nombrePhotos(demande) ? demande : null;
}

/** « 16 octobre », « 1er novembre » d'une date 'AAAA-MM-JJ' ; null si illisible. */
function jourDuMois(jour) {
  const trouve = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(jour ?? ''));
  if (!trouve) return null;
  const mois = Number(trouve[2]);
  const quantieme = Number(trouve[3]);
  if (mois < 1 || mois > 12 || quantieme < 1 || quantieme > 31) return null;
  return `${quantieme === 1 ? '1er' : quantieme} ${MOIS[mois - 1]}`;
}

/**
 * Nom libre pour un plat : `nom` s'il est libre (aucun plat, corbeille comprise, n'a le même nom au slug près), sinon
 * « <nom> (2) », « (3) »… ; le nom est raccourci s'il le faut pour tenir dans NOM_MAX. null si le nom est vide.
 */
export function nomLibre(nom, plats = []) {
  const propre = String(nom ?? '').replace(/\s+/g, ' ').trim();
  if (!slug(propre)) return null;
  if (!nouveauPlatParNom(propre, plats).erreur) return propre;
  for (let n = 2; n < 1000; n += 1) {
    const suffixe = ` (${n})`;
    const essai = `${propre.slice(0, NOM_MAX - suffixe.length).trim()}${suffixe}`;
    if (!nouveauPlatParNom(essai, plats).erreur) return essai;
  }
  return null;
}

/**
 * Nom d'un plat demandé en photos sans nom : « Recette en photo du 16 octobre », ou « … (2) » s'il est pris (Claude
 * le remplacera par le titre de la recette). `aujourdhui` : 'AAAA-MM-JJ' du téléphone.
 */
export function nomParDefaut(aujourdhui, plats = []) {
  const jour = jourDuMois(aujourdhui);
  return nomLibre(jour ? `Recette en photo du ${jour}` : 'Recette en photo', plats);
}

/**
 * Champs de la demande de recette qui accompagnent des photos : `photos` (nombre) et, si la personne n'a pas donné de
 * nom, `nomATrouver: true` (Claude le lira sur les photos). {} sans photo.
 */
export function champsDemandePhotos({ photos = 0, nomATrouver = false } = {}) {
  const n = Number.isInteger(photos) ? Math.min(Math.max(photos, 0), PHOTOS_DEMANDE_MAX) : 0;
  if (!n) return {};
  return { photos: n, ...(nomATrouver ? { nomATrouver: true } : {}) };
}

/** Nom de fichier d'une photo téléchargée ou envoyée : « <platId>-photo-1.jpg ». */
export function nomFichierPhoto(platId, rang) {
  return `${slug(String(platId ?? '')) || 'recette'}-photo-${rang}.jpg`;
}
