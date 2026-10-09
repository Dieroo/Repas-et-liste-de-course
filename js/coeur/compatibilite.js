// Compatibilité d'un plat avec ce que mange un profil (CLAUDE.md §7), et versions à créer. Logique pure : ni DOM
// ni Firebase. En T2, seules les règles `exclureMarqueurs` (avec `saufMarqueurs`) et `exclureProduits` sont
// évaluées ; les autres types restent dans les données, sans effet ici. Les notes ne sont jamais lues par `evaluer`.
// Un profil peut avoir plusieurs versions d'un plat, une par style (`mer`, `vegetal`) : les styles attendus viennent
// de son régime (regles.js › stylesAttendus) ; une version sans `style` reçoit un style déduit à la lecture (styleDe),
// jamais écrit.
import { slug } from './slug.js';
import { STYLES, marqueursEffectifs } from './vocabulaire.js';
import { TYPES_A_ADAPTER, aAdapterSelon, aCompleterSelon, compteDansLeBilan } from './plats.js';
import { noteRetenue } from './notes.js';
import { trierProfils } from './profils.js';
import { stylesAttendus } from './regles.js';

export { TYPES_A_ADAPTER };
// Déplacé dans vocabulaire.js (T2c, pour coeur/age.js) ; toujours importable d'ici.
export { marqueursEffectifs };

const TYPES_EVALUES = ['exclureMarqueurs', 'exclureProduits'];
const SEVERITES_EVALUEES = ['exclu', 'adaptable'];
// Ce qui relève d'un repas sans viande : un plat qui n'est exclu que pour eux demande une version « sans viande ».
const MARQUEURS_SANS_VIANDE = ['viande', 'bouillon_viande', 'gelatine_animale', 'graisse_animale'];
// Ce qui fait d'une version une version « mer ».
const MARQUEURS_MER = ['poisson', 'fruits_de_mer'];
// Jours au frigo d'une version (part au poisson…), bornes de paquet@1.
const FRIGO_JOURS_MAX = 30;

const estObjet = (valeur) => Boolean(valeur) && typeof valeur === 'object' && !Array.isArray(valeur);
const textes = (valeurs) => (Array.isArray(valeurs) ? valeurs.filter((v) => typeof v === 'string' && v !== '') : []);
const reduire = (texte) => String(texte ?? '').replace(/\s+/g, ' ').trim();
const comparer = new Intl.Collator('fr', { sensitivity: 'base' }).compare;

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

// ——— Versions d'un plat ———

/** Ajouts d'une version (objets seulement). */
function ajoutsDe(variante) {
  return Array.isArray(variante?.ajouter) ? variante.ajouter.filter(estObjet) : [];
}

/**
 * Style d'une version : `style` s'il est valide (`mer` ou `vegetal`) ; sinon déduit, sans rien écrire : un ajout
 * marqué poisson ou fruits de mer (marqueurs effectifs) → 'mer', sinon 'vegetal'.
 */
export function styleDe(variante) {
  if (STYLES.includes(variante?.style)) return variante.style;
  const mer = ajoutsDe(variante).some((ajout) => {
    const effectifs = marqueursEffectifs(ajout);
    return MARQUEURS_MER.some((m) => effectifs.has(m));
  });
  return mer ? 'mer' : 'vegetal';
}

/** Jours au frigo d'une version : entier de 1 à 30, sinon null. */
function frigoJoursDe(variante) {
  const jours = variante?.frigoJours;
  return Number.isInteger(jours) && jours >= 1 && jours <= FRIGO_JOURS_MAX ? jours : null;
}

/** Versions de la fiche pour ce profil, dans leur ordre. */
function versionsPour(plat, profil) {
  if (typeof profil?.id !== 'string') return [];
  return (Array.isArray(plat?.variantes) ? plat.variantes : []).filter((v) => estObjet(v) && v.pour === profil.id);
}

/**
 * Une version jugée seule : rend-elle le plat mangeable ? Les ingrédients exclus qu'elle ne retire pas et ses ajouts
 * exclus restent. → { variante, style, convient, restants: [texte], problemes: [ingredient] } (`problemes` : pour
 * le besoin, jamais rendu par evaluer).
 */
function jugerVersion(variante, exclus, regles) {
  const retires = new Set(textes(variante.retirer).map(slug));
  const problemes = [
    ...exclus.filter((ingredient) => !retires.has(slug(ingredient.produit))),
    ...fautifsDe(regles, ajoutsDe(variante)),
  ];
  return { variante, style: styleDe(variante), convient: !problemes.length, restants: nomsDe(problemes), problemes };
}

/** Version retenue, sous la forme qu'utilisent les écrans : `style` toujours (styleDe), `frigoJours` s'il est donné. */
function varianteRetenue(variante) {
  const frigoJours = frigoJoursDe(variante);
  return {
    source: 'fiche',
    retirer: textes(variante.retirer),
    ajouter: ajoutsDe(variante),
    consigne: typeof variante.consigne === 'string' ? variante.consigne : '',
    style: styleDe(variante),
    ...(frigoJours ? { frigoJours } : {}),
  };
}

// ——— Évaluer un plat pour un profil ———

/**
 * Ce que le plat donne pour ce profil.
 * → { niveau: 'ok' | 'adaptable' | 'exclu' | 'inconnu' (plat sans ingrédients),
 *     variante: null | { source: 'fiche', retirer, ajouter, consigne, style, frigoJours? } (version de la fiche qui
 *       convient : celle de style `mer` s'il y en a une, préférence du foyer ; sinon la première),
 *     fautifs: [ingredient] (ingrédients du plat qui l'excluent, ou le rendent adaptable),
 *     restants: [texte] (ce que la version laisse ou ajoute d'exclu ; si aucune ne convient, la première d'un style
 *       attendu, sinon la première),
 *     aCreer (aucune version), aRevoir (des versions, aucune ne convient),
 *     besoin: null | 'sans_viande' | 'adapter' (besoin de la version à faire : à créer, à revoir ou à compléter),
 *     versions: [{ variante, style, convient, restants }] (toutes les versions de la fiche pour ce profil, dans leur
 *       ordre, chacune jugée seule ; `variante` : l'objet de la fiche ; `style` : styleDe),
 *     manquants: [style] (styles attendus, regles.js › stylesAttendus(profil, plat), sans version qui convient ;
 *       [] si le plat se mange tel quel ; jamais `mer` pour un dessert ou un accompagnement),
 *     aCompleter (au moins une version convient, mais il en manque d'un style attendu) }
 * Un profil sans style attendu (stylesAttendus vide) n'a jamais de `manquants` ni de plat à compléter.
 */
export function evaluer(plat, profil) {
  const resultat = {
    niveau: 'ok', variante: null, fautifs: [], restants: [], aCreer: false, aRevoir: false, besoin: null,
    versions: [], manquants: [], aCompleter: false,
  };
  const ingredients = ingredientsDe(plat);
  if (!ingredients.length) return { ...resultat, niveau: 'inconnu' };
  const regles = reglesEvaluees(profil);
  const exclus = fautifsDe(regles.filter((r) => r.severite === 'exclu'), ingredients);
  const jugees = versionsPour(plat, profil).map((variante) => jugerVersion(variante, exclus, regles));
  const versions = jugees.map(({ variante, style, convient, restants }) => ({ variante, style, convient, restants }));
  const base = { ...resultat, versions };
  if (!regles.length) return base;

  if (!exclus.length) {
    const adaptables = fautifsDe(regles, ingredients);
    return adaptables.length ? { ...base, niveau: 'adaptable', fautifs: adaptables } : base;
  }

  // Exclu : une version de la fiche pour ce profil le rend-elle mangeable ? Chaque style attendu en veut une (un
  // dessert ou un accompagnement n'attend pas de version mer).
  const attendus = stylesAttendus(profil, plat);
  const manquants = attendus.filter((style) => !jugees.some((v) => v.convient && v.style === style));
  if (!jugees.length) return { ...base, niveau: 'exclu', fautifs: exclus, aCreer: true, besoin: besoinDe(exclus), manquants };

  const conviennent = jugees.filter((v) => v.convient);
  if (!conviennent.length) {
    // La version à revoir d'un style attendu d'abord (c'est elle que la demande à Claude montre) ; une version d'un
    // style que le profil n'attend plus ne compte que s'il n'y en a pas d'autre.
    const premiere = jugees.find((v) => attendus.includes(v.style)) ?? jugees[0];
    return {
      ...base,
      niveau: 'exclu',
      fautifs: exclus,
      restants: premiere.restants,
      aRevoir: true,
      besoin: besoinDe(premiere.problemes),
      manquants,
    };
  }
  const retenue = conviennent.find((v) => v.style === 'mer') ?? conviennent[0];
  return {
    ...base,
    niveau: 'adaptable',
    variante: varianteRetenue(retenue.variante),
    fautifs: exclus,
    besoin: manquants.length ? besoinDe(exclus) : null,
    manquants,
    aCompleter: manquants.length > 0,
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
 * Bilan d'un profil, sur les mêmes plats que aAdapterPour : { convient, avecVersion, aCreer, aCompleter, orphelines }.
 * `aCreer` compte aussi les versions à revoir. `aCompleter` : plats dont une version convient mais dont il manque un
 * style attendu (ils comptent aussi dans `avecVersion`). `orphelines` : versions des fiches rangées sous un profil
 * qui n'existe pas (seulement si `profils` est donné).
 */
export function bilanCompatibilite(plats, profil, { profils = null, evaluer: evaluation = evaluer } = {}) {
  const bilan = { convient: 0, avecVersion: 0, aCreer: 0, aCompleter: 0, orphelines: 0 };
  const liste = Array.isArray(plats) ? plats.filter(estObjet) : [];
  for (const plat of liste) {
    if (!compteDansLeBilan(plat, profil)) continue;
    const resultat = evaluation(plat, profil);
    if (aAdapterSelon(plat, profil, resultat)) bilan.aCreer += 1;
    else if (resultat?.variante) {
      bilan.avecVersion += 1;
      if (aCompleterSelon(plat, profil, resultat)) bilan.aCompleter += 1;
    } else if (resultat?.niveau === 'ok' || resultat?.niveau === 'adaptable') bilan.convient += 1;
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
 * Plats qui attendent une version pour ce profil, dans l'ordre où les demander : d'abord les plats à créer ou à
 * revoir (mêmes plats que aAdapterPour), puis les plats à compléter (une version convient, il en manque d'un style
 * attendu ; mêmes filtres). Dans chaque groupe : demande ouverte d'abord, puis meilleure note des autres profils (non
 * noté = 3), puis nom ; les plats de `envoyes` (identifiants déjà copiés pour Claude) passent en fin de groupe, dans
 * le même ordre. `profils` : tous les profils (sans eux, seules les notes présentes des autres comptent).
 * → [{ plat, fautifs, besoin, aRevoir, manquants, aCompleter }]
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
    const aAdapter = aAdapterSelon(plat, profil, resultat);
    if (!aAdapter && !aCompleterSelon(plat, profil, resultat)) continue;
    elements.push({
      element: {
        plat,
        fautifs: resultat.fautifs ?? [],
        besoin: resultat.besoin ?? null,
        aRevoir: Boolean(resultat.aRevoir),
        manquants: Array.isArray(resultat.manquants) ? [...resultat.manquants] : [],
        aCompleter: !aAdapter,
      },
      groupe: aAdapter ? 0 : 1,
      envoye: dejaEnvoyes.has(plat.id),
      demande: ouvertes.has(`${plat.id}__${profil?.id}`),
      note: meilleureNote(plat),
    });
  }
  elements.sort((a, b) => a.groupe - b.groupe
    || Number(a.envoye) - Number(b.envoye)
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
