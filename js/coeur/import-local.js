// Ajout de recettes et de versions (CLAUDE.md §8, T2b) : ce que l'app affiche tout de suite sur ce téléphone, avant
// la copie de Firestore, et l'annonce qui suit l'enregistrement des versions. Logique pure : ni DOM ni Firebase.
import { fusionnerVariantes } from './paquet.js';

const estObjet = (valeur) => valeur !== null && typeof valeur === 'object' && !Array.isArray(valeur);

/**
 * Plats du téléphone après un import préparé par coeur/paquet.js › preparerImport (nouvelle liste, `plats` intact).
 * - écriture `{ id, mode: 'versions', variantes, attendus? }` : les versions reçues sont fusionnées par profil et par
 *   style dans celles du plat (coeur/paquet.js › fusionnerVariantes, comme à l'écriture, avec les mêmes styles
 *   attendus) ; rien d'autre ne change. Plat absent :
 *   ignorée, **jamais** de plat créé ;
 * - écriture complète `{ id, donnees, effacerModification? }` (chemin T1b, `donnees.variantes` déjà fusionnée) :
 *   champs reçus posés sur le plat, ou nouveau plat ajouté à la fin ; `effacerModification` retire la marque
 *   « modifiée à la main » (`modifieeLe`, `modifieePar`).
 */
export function appliquerImport(plats, ecritures) {
  const liste = Array.isArray(plats) ? plats : [];
  const versions = new Map();
  const completes = new Map();
  for (const ecriture of Array.isArray(ecritures) ? ecritures : []) {
    if (!estObjet(ecriture) || typeof ecriture.id !== 'string') continue;
    if (ecriture.mode === 'versions') {
      // Deux écritures de versions pour un même plat (ne devrait pas arriver) : la seconde complète la première.
      const deja = versions.get(ecriture.id) ?? { variantes: [], attendus: null };
      const attendus = estObjet(ecriture.attendus) ? { ...deja.attendus, ...ecriture.attendus } : deja.attendus;
      versions.set(ecriture.id, {
        variantes: fusionnerVariantes(deja.variantes, Array.isArray(ecriture.variantes) ? ecriture.variantes : []),
        attendus,
      });
    } else if (estObjet(ecriture.donnees)) {
      completes.set(ecriture.id, ecriture);
    }
  }
  const connus = new Set(liste.map((plat) => plat?.id));
  const resultat = liste.map((plat) => {
    if (!estObjet(plat)) return plat;
    let maj = plat;
    const complete = completes.get(plat.id);
    if (complete) {
      maj = { ...maj, ...complete.donnees, id: plat.id };
      if (complete.effacerModification) {
        delete maj.modifieeLe;
        delete maj.modifieePar;
      }
    }
    if (versions.has(plat.id)) {
      const { variantes, attendus } = versions.get(plat.id);
      maj = { ...maj, variantes: fusionnerVariantes(Array.isArray(maj.variantes) ? maj.variantes : [], variantes, { attendus }) };
    }
    return maj;
  });
  for (const [id, { donnees }] of completes) {
    if (!connus.has(id)) resultat.push({ ...donnees, id });
  }
  return resultat;
}

/** Identifiants des profils visés par les écritures de versions, dans l'ordre d'arrivée, sans doublon. */
export function profilsDesVersions(ecritures) {
  const ids = [];
  for (const ecriture of Array.isArray(ecritures) ? ecritures : []) {
    if (!estObjet(ecriture) || ecriture.mode !== 'versions') continue;
    for (const variante of Array.isArray(ecriture.variantes) ? ecriture.variantes : []) {
      const pour = variante?.pour;
      if (typeof pour === 'string' && pour && !ids.includes(pour)) ids.push(pour);
    }
  }
  return ids;
}

/**
 * Nombre de versions reçues pour ce profil dans les écritures de versions (chacune compte : une version mer et une
 * version végétale du même plat font deux), sans compter les plats `manquants` (identifiants des plats disparus avant
 * l'envoi : rien n'y a été écrit).
 */
export function versionsEcrites(ecritures, profilId, manquants = []) {
  const absents = new Set(Array.isArray(manquants) ? manquants : []);
  let total = 0;
  for (const ecriture of Array.isArray(ecritures) ? ecritures : []) {
    if (!estObjet(ecriture) || ecriture.mode !== 'versions' || absents.has(ecriture.id)) continue;
    for (const variante of Array.isArray(ecriture.variantes) ? ecriture.variantes : []) {
      if (variante?.pour === profilId) total += 1;
    }
  }
  return total;
}

/**
 * Annonce qui suit l'enregistrement des versions :
 * « 9 versions ajoutées. 14 plats attendent encore une version pour <Prénom>. » (une phrase par profil ; suivie de
 * « 3 plats à compléter pour <Prénom>. » si `aCompleter` est donné et non nul), puis
 * « «X» n'est plus dans vos plats : sa version n'a pas été enregistrée. » pour chaque plat disparu entre-temps.
 * `parProfil` : [{ nom, ajoutees, restants, aCompleter? }] (`aCompleter` : plats qui ont une version qui convient,
 * mais pas encore de chaque style attendu, compatibilite.js › bilanCompatibilite) ; `manquants` : noms des plats
 * disparus. → texte ('' si rien à dire).
 */
export function annonceVersions(parProfil, manquants = []) {
  const phrases = [];
  for (const { nom, ajoutees, restants, aCompleter } of Array.isArray(parProfil) ? parProfil : []) {
    if (!ajoutees) continue;
    phrases.push(ajoutees > 1 ? `${ajoutees} versions ajoutées.` : '1 version ajoutée.');
    const prenom = String(nom ?? '').trim();
    if (!prenom) continue;
    if (!restants) phrases.push(`Plus aucun plat n’attend de version pour ${prenom}.`);
    else if (restants === 1) phrases.push(`1 plat attend encore une version pour ${prenom}.`);
    else phrases.push(`${restants} plats attendent encore une version pour ${prenom}.`);
    if (Number.isInteger(aCompleter) && aCompleter > 0) {
      phrases.push(aCompleter === 1 ? `1 plat à compléter pour ${prenom}.` : `${aCompleter} plats à compléter pour ${prenom}.`);
    }
  }
  for (const nom of Array.isArray(manquants) ? manquants : []) {
    phrases.push(`«\u00A0${nom}\u00A0» n’est plus dans vos plats\u00A0: sa version n’a pas été enregistrée.`);
  }
  return phrases.join(' ');
}
