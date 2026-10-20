// Carte « Nouveau » de Semaine (2026-10-20, décision 32) : ce qu'une mise à jour apporte à l'utilisatrice des courses,
// dit en quelques mots. Logique pure : ni DOM, ni Firebase, ni stockage du téléphone (l'app lit et écrit la marque
// « déjà vu », ces fonctions ne font que la lire et la composer). Rien dans Firestore.
// Une nouveauté s'ajoute à la fin de NOUVEAUTES, avec un numéro plus grand : seule la plus récente pas encore vue est
// montrée (une personne qui revient après deux mises à jour ne voit que la dernière). Elle est vue quand un de ses
// boutons est touché, ou après OUVERTURES_NOUVEAUTE ouvertures de l'app où elle s'est montrée sans geste.
// Typographie : \u00A0 avant « : », apostrophe ’.

/** Nouveautés, de la plus ancienne à la plus récente. `emoji` : devant le titre ; `lien` : { libelle, hash }. */
export const NOUVEAUTES = Object.freeze([
  Object.freeze({
    numero: 1,
    emoji: '🍳',
    titre: 'Nouveau\u00A0: Ma cuisine',
    texte: 'Dites ce que vous avez\u00A0: l’app en tiendra compte pour vous proposer des plats.',
    lien: Object.freeze({ libelle: 'Voir Ma cuisine', hash: '#/ma-cuisine' }),
  }),
]);

/** Ouvertures de l'app où la carte se montre sans qu'un de ses boutons soit touché ; ensuite, elle compte pour vue. */
export const OUVERTURES_NOUVEAUTE = 3;

/** Préfixe de la marque sur le téléphone (stockage partagé avec les autres sites du même domaine github.io). */
export const PREFIXE_NOUVEAUTES = 'repas-courses:nouveautes-vues:';

/** Clé de la marque pour un compte (`uid` Firebase) ; null sans identifiant. */
export function cleNouveautes(uid) {
  return typeof uid === 'string' && uid !== '' ? `${PREFIXE_NOUVEAUTES}${uid}` : null;
}

const MARQUE = /^(\d{1,4})(?::(\d{1,4})o([1-9]\d?))?$/;

/**
 * Marque stockée → { vu, montree, fois } : `vu`, le dernier numéro vu (0 si la marque est absente ou abîmée) ;
 * `montree` et `fois`, la nouveauté montrée sans geste et le nombre d'ouvertures ('1:2o1' : la 1 vue, la 2 montrée une
 * fois).
 */
export function lireMarqueNouveautes(valeur) {
  const trouve = typeof valeur === 'string' ? MARQUE.exec(valeur) : null;
  if (!trouve) return { vu: 0, montree: 0, fois: 0 };
  return { vu: Number(trouve[1]), montree: trouve[2] ? Number(trouve[2]) : 0, fois: trouve[3] ? Number(trouve[3]) : 0 };
}

/** Dernier numéro vu, lu dans la valeur stockée ('3', '3:4o1') ; 0 si elle est absente ou abîmée. */
export function numeroVu(valeur) {
  return lireMarqueNouveautes(valeur).vu;
}

/** Valeur à stocker quand la nouveauté `numero` est vue (un de ses boutons touché). */
export function valeurVue(numero) {
  return String(Number.isInteger(numero) && numero > 0 ? numero : 0);
}

/** Valeur à stocker quand la nouveauté `numero` se montre à une ouverture de l'app (une ouverture de plus). */
export function valeurMontree(valeur, numero) {
  const { vu, montree, fois } = lireMarqueNouveautes(valeur);
  if (!Number.isInteger(numero) || numero <= vu) return valeurVue(vu);
  const n = montree === numero ? fois + 1 : 1;
  return n >= OUVERTURES_NOUVEAUTE ? valeurVue(numero) : `${vu}:${numero}o${n}`;
}

/**
 * Nouveauté à montrer sur Semaine → la plus récente pas encore vue, ou null : seulement dans la vue « Repas et courses »
 * (`role` affiché 'courses', aperçu du gestionnaire compris, pour qu'il la voie), jamais si la marque est illisible
 * (`valeur` undefined : stockage bloqué, on ne la remontrerait pas à chaque ouverture).
 */
export function nouveauteAMontrer(valeur, { role = null } = {}) {
  if (role !== 'courses' || valeur === undefined) return null;
  const derniere = NOUVEAUTES.at(-1) ?? null;
  return derniere && derniere.numero > numeroVu(valeur) ? derniere : null;
}

/** Textes fixes de la carte. */
export const TEXTES_NOUVEAUTES = Object.freeze({ ok: 'OK' });
