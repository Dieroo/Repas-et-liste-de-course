// Compatibilité d'un plat avec ce que mange un profil (CLAUDE.md §7), et versions à créer. Logique pure : ni DOM
// ni Firebase. En T2, seules les règles `exclureMarqueurs` (avec `saufMarqueurs`) et `exclureProduits` sont
// évaluées ; les autres types restent dans les données, sans effet ici. Les notes ne sont jamais lues par `evaluer`.
import { slug } from './slug.js';
import { IMPLICATIONS, SOUS_TYPES_VIANDE } from './vocabulaire.js';
import { TYPES_A_ADAPTER, aAdapterSelon, compteDansLeBilan } from './plats.js';
import { noteRetenue } from './notes.js';
import { trierProfils } from './profils.js';

export { TYPES_A_ADAPTER };

const TYPES_EVALUES = ['exclureMarqueurs', 'exclureProduits'];
const SEVERITES_EVALUEES = ['exclu', 'adaptable'];
// Ce qui relève d'un repas sans viande : un plat qui n'est exclu que pour eux demande une version « sans viande ».
const MARQUEURS_SANS_VIANDE = ['viande', 'bouillon_viande', 'gelatine_animale', 'graisse_animale'];

const estObjet = (valeur) => Boolean(valeur) && typeof valeur === 'object' && !Array.isArray(valeur);
const textes = (valeurs) => (Array.isArray(valeurs) ? valeurs.filter((v) => typeof v === 'string' && v !== '') : []);
const reduire = (texte) => String(texte ?? '').replace(/\s+/g, ' ').trim();
const comparer = new Intl.Collator('fr', { sensitivity: 'base' }).compare;

// ——— Marqueurs ———

/** Marqueurs d'un ingrédient, plus ceux qu'ils impliquent : `viande` pour un sous-type, `gelatine_animale` pour `gelatine_porc`… */
export function marqueursEffectifs(ingredient) {
  const marqueurs = new Set(textes(ingredient?.marqueurs));
  for (const marqueur of [...marqueurs]) {
    if (SOUS_TYPES_VIANDE.includes(marqueur)) marqueurs.add('viande');
    if (Object.hasOwn(IMPLICATIONS, marqueur)) for (const implique of IMPLICATIONS[marqueur]) marqueurs.add(implique);
  }
  return marqueurs;
}

// ——— Règles ———

/** Ingrédients d'un plat (objets seulement). */
function ingredientsDe(plat) {
  return Array.isArray(plat?.ingredients) ? plat.ingredients.filter(estObjet) : [];
}

/**
 * Ingrédients du plat qui déclenchent la règle. Seuls `exclureMarqueurs` et `exclureProduits` sont évalués ; une
 * règle d'un autre type, désactivée (`actif: false`) ou vide → null.
 * → { fautifs: [ingredient] } ou null
 */
export function declenche(regle, plat) {
  if (!estObjet(regle) || regle.actif === false) return null;
  let touche;
  if (regle.type === 'exclureMarqueurs') {
    const marqueurs = textes(regle.marqueurs);
    const sauf = textes(regle.saufMarqueurs);
    if (!marqueurs.length) return null;
    touche = (ingredient) => {
      const effectifs = marqueursEffectifs(ingredient);
      return marqueurs.some((m) => effectifs.has(m)) && !sauf.some((m) => effectifs.has(m));
    };
  } else if (regle.type === 'exclureProduits') {
    const produits = new Set(textes(regle.produits).map(slug).filter(Boolean));
    if (!produits.size) return null;
    touche = (ingredient) => produits.has(slug(ingredient.produit));
  } else {
    return null;
  }
  const fautifs = ingredientsDe(plat).filter(touche);
  return fautifs.length ? { fautifs } : null;
}

/** Règles du profil qu'evaluer applique : type évalué, sévérité « exclu » ou « adaptable », active, non vide. */
function reglesEvaluees(profil) {
  return (Array.isArray(profil?.regles) ? profil.regles : []).filter((regle) => estObjet(regle)
    && regle.actif !== false
    && TYPES_EVALUES.includes(regle.type)
    && SEVERITES_EVALUEES.includes(regle.severite)
    && (regle.type === 'exclureMarqueurs' ? textes(regle.marqueurs).length : textes(regle.produits).length) > 0);
}

/** Ingrédients de `liste` qui déclenchent au moins une des règles, sans doublon, dans leur ordre. */
function fautifsDe(regles, ingredients) {
  const touches = new Set(regles.flatMap((regle) => declenche(regle, { ingredients })?.fautifs ?? []));
  return ingredients.filter((ingredient) => touches.has(ingredient));
}

/** 'sans_viande' si tous ces ingrédients relèvent de la viande (bouillon, gélatine, graisse compris) ; sinon 'adapter'. */
function besoinDe(ingredients) {
  const sansViande = ingredients.length > 0 && ingredients.every((ingredient) => {
    const effectifs = marqueursEffectifs(ingredient);
    return MARQUEURS_SANS_VIANDE.some((m) => effectifs.has(m));
  });
  return sansViande ? 'sans_viande' : 'adapter';
}

const nomsDe = (ingredients) => [...new Set(ingredients.map((i) => reduire(i.produit)).filter(Boolean))];

// ——— Évaluer un plat pour un profil ———

/**
 * Ce que le plat donne pour ce profil.
 * → { niveau: 'ok' | 'adaptable' | 'exclu' | 'inconnu' (plat sans ingrédients),
 *     variante: null | { source: 'fiche', retirer, ajouter, consigne } (version de la fiche qui convient),
 *     fautifs: [ingredient] (ingrédients du plat qui l'excluent, ou le rendent adaptable),
 *     restants: [texte] (ce que la version laisse ou ajoute d'exclu), aCreer, aRevoir,
 *     besoin: null | 'sans_viande' | 'adapter' }
 */
export function evaluer(plat, profil) {
  const resultat = { niveau: 'ok', variante: null, fautifs: [], restants: [], aCreer: false, aRevoir: false, besoin: null };
  const ingredients = ingredientsDe(plat);
  if (!ingredients.length) return { ...resultat, niveau: 'inconnu' };
  const regles = reglesEvaluees(profil);
  if (!regles.length) return resultat;

  const exclus = fautifsDe(regles.filter((r) => r.severite === 'exclu'), ingredients);
  if (!exclus.length) {
    const adaptables = fautifsDe(regles, ingredients);
    return adaptables.length ? { ...resultat, niveau: 'adaptable', fautifs: adaptables } : resultat;
  }

  // Exclu : la version de la fiche pour ce profil (la première s'il y en a deux) le rend-elle mangeable ?
  const version = (Array.isArray(plat.variantes) ? plat.variantes : [])
    .find((v) => estObjet(v) && typeof profil?.id === 'string' && v.pour === profil.id);
  if (!version) return { ...resultat, niveau: 'exclu', fautifs: exclus, aCreer: true, besoin: besoinDe(exclus) };

  const retires = new Set(textes(version.retirer).map(slug));
  const ajouts = Array.isArray(version.ajouter) ? version.ajouter.filter(estObjet) : [];
  const problemes = [
    ...exclus.filter((ingredient) => !retires.has(slug(ingredient.produit))),
    ...fautifsDe(regles, ajouts),
  ];
  if (problemes.length) {
    return { ...resultat, niveau: 'exclu', fautifs: exclus, restants: nomsDe(problemes), aRevoir: true, besoin: besoinDe(problemes) };
  }
  return {
    ...resultat,
    niveau: 'adaptable',
    variante: {
      source: 'fiche',
      retirer: textes(version.retirer),
      ajouter: ajouts,
      consigne: typeof version.consigne === 'string' ? version.consigne : '',
    },
    fautifs: exclus,
  };
}

// ——— Profils et plats concernés ———

/** Profils qui ont au moins une règle évaluée, dans l'ordre d'affichage. Un profil sans règle n'affiche jamais rien. */
export function profilsContraints(profils) {
  return trierProfils((Array.isArray(profils) ? profils : []).filter((p) => estObjet(p) && reglesEvaluees(p).length));
}

/**
 * Vrai si le plat attend une version pour ce profil : plat, accompagnement ou dessert, recette remplie, à créer ou à
 * revoir, et pas noté « Jamais » par ce profil. `evaluer` : fonction d'évaluation à utiliser (par défaut celle d'ici ;
 * l'app passe sa version mémorisée).
 */
export function aAdapterPour(plat, profil, { evaluer: evaluation = evaluer } = {}) {
  if (!compteDansLeBilan(plat, profil)) return false;
  return aAdapterSelon(plat, profil, evaluation(plat, profil));
}

/**
 * Bilan d'un profil, sur les mêmes plats que aAdapterPour : { convient, avecVersion, aCreer, orphelines }.
 * `aCreer` compte aussi les versions à revoir. `orphelines` : versions des fiches rangées sous un profil qui
 * n'existe pas (seulement si `profils` est donné).
 */
export function bilanCompatibilite(plats, profil, { profils = null, evaluer: evaluation = evaluer } = {}) {
  const bilan = { convient: 0, avecVersion: 0, aCreer: 0, orphelines: 0 };
  const liste = Array.isArray(plats) ? plats.filter(estObjet) : [];
  for (const plat of liste) {
    if (!compteDansLeBilan(plat, profil)) continue;
    const resultat = evaluation(plat, profil);
    if (aAdapterSelon(plat, profil, resultat)) bilan.aCreer += 1;
    else if (resultat?.variante) bilan.avecVersion += 1;
    else if (resultat?.niveau === 'ok' || resultat?.niveau === 'adaptable') bilan.convient += 1;
  }
  if (Array.isArray(profils)) {
    const ids = new Set(profils.filter(estObjet).map((p) => p.id));
    for (const plat of liste) {
      for (const variante of Array.isArray(plat.variantes) ? plat.variantes : []) {
        if (estObjet(variante) && !ids.has(variante.pour)) bilan.orphelines += 1;
      }
    }
  }
  return bilan;
}

/**
 * Plats qui attendent une version pour ce profil (mêmes plats que aAdapterPour), dans l'ordre où les demander :
 * demande ouverte d'abord, puis meilleure note des autres profils (non noté = 3), puis nom ; les plats de `envoyes`
 * (identifiants déjà copiés pour Claude) passent en fin de liste, dans le même ordre. `profils` : tous les profils
 * (sans eux, seules les notes présentes des autres comptent).
 * → [{ plat, fautifs, besoin, aRevoir }]
 */
export function platsSansVersion(plats, profil, { demandes = [], envoyes = [], profils = null, evaluer: evaluation = evaluer } = {}) {
  const ouvertes = new Set((Array.isArray(demandes) ? demandes : [])
    .filter((d) => estObjet(d) && d.statut === 'ouverte' && typeof d.id === 'string').map((d) => d.id));
  const dejaEnvoyes = new Set(Array.isArray(envoyes) ? envoyes : []);
  const autres = Array.isArray(profils) ? profils.filter((p) => estObjet(p) && p.id !== profil?.id) : null;
  const meilleureNote = (plat) => {
    if (autres) return autres.length ? Math.max(...autres.map((p) => noteRetenue(plat, p.id))) : 3;
    const notes = estObjet(plat.notes) ? plat.notes : {};
    const valides = Object.entries(notes)
      .filter(([id, note]) => id !== profil?.id && Number.isInteger(note) && note >= 0 && note <= 5)
      .map(([, note]) => note);
    return valides.length ? Math.max(...valides) : 3;
  };

  const elements = [];
  for (const plat of Array.isArray(plats) ? plats.filter(estObjet) : []) {
    if (!compteDansLeBilan(plat, profil)) continue;
    const resultat = evaluation(plat, profil);
    if (!aAdapterSelon(plat, profil, resultat)) continue;
    elements.push({
      element: { plat, fautifs: resultat.fautifs ?? [], besoin: resultat.besoin ?? null, aRevoir: Boolean(resultat.aRevoir) },
      envoye: dejaEnvoyes.has(plat.id),
      demande: ouvertes.has(`${plat.id}__${profil?.id}`),
      note: meilleureNote(plat),
    });
  }
  elements.sort((a, b) => Number(a.envoye) - Number(b.envoye)
    || Number(b.demande) - Number(a.demande)
    || b.note - a.note
    || comparer(String(a.element.plat.nom ?? ''), String(b.element.plat.nom ?? ''))
    || (a.element.plat.id < b.element.plat.id ? -1 : a.element.plat.id > b.element.plat.id ? 1 : 0));
  return elements.map((e) => e.element);
}

// ——— Repères peut-être oubliés ———

/**
 * Mots qui annoncent un repère, comparés en slug (mot entier, pluriel en s ou x accepté), dans l'ordre de lecture :
 * le premier qui convient l'emporte (« bouillon de bœuf » attend `bouillon_viande`, pas `viande`). Table enrichie en
 * T2c. `apres` : un de ces mots doit suivre (« fumet de poisson » n'est jamais douteux).
 */
export const MOTS_DOUTEUX = [
  { attendu: 'bouillon_viande', mots: ['bouillon', 'fond', 'fumet'], apres: ['boeuf', 'volaille', 'poulet', 'veau', 'viande'] },
  { attendu: 'graisse_animale', mots: ['saindoux', 'suif', 'graisse de canard', 'graisse d oie'] },
  { attendu: 'gelatine_animale', mots: ['gelatine'] },
  {
    attendu: 'viande',
    mots: ['lardon', 'jambon', 'poulet', 'boeuf', 'porc', 'veau', 'dinde', 'canard', 'agneau', 'saucisse', 'chorizo',
      'bacon', 'merguez', 'escargot', 'grenouille'],
  },
];

/** Position du mot (ou de l'expression) dans la suite de mots, pluriel accepté ; -1 s'il n'y est pas. */
function positionDe(mots, expression) {
  const cherches = slug(expression).split('-').filter(Boolean);
  const dernier = cherches.length - 1;
  for (let i = 0; i + dernier < mots.length; i += 1) {
    const ok = cherches.every((mot, k) => {
      const lu = mots[i + k];
      return lu === mot || (k === dernier && (lu === `${mot}s` || lu === `${mot}x`));
    });
    if (ok) return i;
  }
  return -1;
}

/** Repère qu'annonce le nom d'un produit (« bouillon de volaille » → 'bouillon_viande'), ou null. */
export function repereAttendu(produit) {
  const mots = slug(produit).split('-').filter(Boolean);
  if (!mots.length) return null;
  for (const entree of MOTS_DOUTEUX) {
    for (const mot of entree.mots) {
      const position = positionDe(mots, mot);
      if (position === -1) continue;
      if (!entree.apres) return entree.attendu;
      const suite = mots.slice(position + 1);
      if (entree.apres.some((apres) => positionDe(suite, apres) !== -1)) return entree.attendu;
    }
  }
  return null;
}

/**
 * Ingrédients dont le nom annonce un repère qu'ils ne portent pas (« bouillon de volaille » sans `bouillon_viande`).
 * Ne change jamais le niveau : sert à la ligne « à vérifier » de la fiche.
 * → [{ produit, attendu }]
 */
export function marqueursDouteux(plat) {
  const douteux = [];
  for (const ingredient of ingredientsDe(plat)) {
    if (typeof ingredient.produit !== 'string') continue;
    const attendu = repereAttendu(ingredient.produit);
    if (attendu && !marqueursEffectifs(ingredient).has(attendu)) douteux.push({ produit: reduire(ingredient.produit), attendu });
  }
  return douteux;
}
