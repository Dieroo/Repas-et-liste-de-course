// Fixtures génériques du plan du batch (tests/coeur-plan-batch.test.js, tests/projet-claude.test.js) : trois plats
// d'une semaine, deux profils adultes (Adulte B « Pas de viande »), aucune donnée du foyer.
import { ecrireRegime } from '../../js/coeur/regles.js';

export const SANS_VIANDE = ecrireRegime({ regime: 'sans_viande', precisions: new Set() }, []);
export const ADULTE_A = { id: 'profil-a', nom: 'Adulte A', ordre: 1, coefPortion: 1, email: 'a@exemple.fr' };
export const ADULTE_B = { id: 'profil-b', nom: 'Adulte B', ordre: 2, coefPortion: 1, email: 'b@exemple.fr', regles: SANS_VIANDE };
export const PROFILS = [ADULTE_A, ADULTE_B];

const etape = (titre, texte, duree, extra = {}) => ({ titre, texte, duree, ...extra });

export const GRATIN = {
  id: 'gratin-pommes-de-terre',
  nom: 'Gratin de pommes de terre',
  type: 'plat',
  statutRecette: 'validee',
  portionsBase: 4,
  ingredients: [
    { produit: 'pomme de terre', qte: 1, unite: 'kg', rayon: 'fruits_legumes', marqueurs: ['feculent'] },
    { produit: 'lardons', qte: 150, unite: 'g', rayon: 'charcuterie', marqueurs: ['viande', 'porc', 'charcuterie'], forme: 'morceaux' },
    { produit: 'crème fraîche épaisse', qte: 20, unite: 'cl', rayon: 'cremerie', marqueurs: ['laitier'] },
    { produit: 'gruyère râpé', qte: 100, unite: 'g', rayon: 'fromages', marqueurs: ['laitier'] },
  ],
  realisation: [
    etape('Cuire les pommes de terre', 'Épluchez les pommes de terre, coupez-les en rondelles et faites-les cuire 10 minutes à l\'eau bouillante salée.', 15, { actif: 5, appareil: 'plaque', feu: 'vif', ustensiles: ['grande casserole', 'éplucheur'], ingredients: ['pomme de terre'] }),
    etape('Faire revenir les lardons', 'Faites dorer les lardons à la poêle, sans matière grasse.', 6, { appareil: 'plaque', feu: 'moyen', ustensiles: ['poêle'], ingredients: ['lardons'], partAvant: true }),
    etape('Monter le gratin', 'Alternez pommes de terre, lardons et crème dans le plat, couvrez de gruyère.', 5, { ustensiles: ['plat à gratin'], ingredients: ['crème fraîche épaisse', 'gruyère râpé'] }),
    etape('Cuire au four', 'Enfournez au milieu du four.', 30, { actif: 1, appareil: 'four', tempC: 200, pret: 'Le dessus est doré.' }),
    etape('Sortir le gratin', 'Sortez le plat avec des maniques.', 1),
  ],
  etapes: ['Cuire les pommes de terre', 'Faire revenir les lardons', 'Monter le gratin', 'Cuire au four', 'Sortir le gratin'],
  cuisson: [{ appareil: 'plaque', dureeMin: 15 }, { appareil: 'four', tempC: 200, dureeMin: 30 }],
  conservation: { frigoJours: 3, congelable: true },
  variantes: [
    { pour: 'profil-b', style: 'mer', frigoJours: 2, retirer: ['lardons'], ajouter: [{ produit: 'thon au naturel', qtePortion: 50, unite: 'g', rayon: 'epicerie_salee', marqueurs: ['poisson'] }], consigne: 'Mettez sa part dans un petit plat avant les lardons, ajoutez le thon.' },
    { pour: 'profil-b', style: 'vegetal', retirer: ['lardons'], ajouter: [{ produit: 'tofu fumé', qtePortion: 60, unite: 'g', rayon: 'cremerie', marqueurs: ['soja'] }], consigne: 'Part au tofu.' },
  ],
  notes: {},
};

export const SALADE = {
  id: 'salade-pommes-de-terre',
  nom: 'Salade de pommes de terre',
  type: 'plat',
  statutRecette: 'validee',
  portionsBase: 4,
  ingredients: [
    { produit: 'pomme de terre', qte: 600, unite: 'g', rayon: 'fruits_legumes', marqueurs: ['feculent'] },
    { produit: 'échalote', qte: 1, unite: 'pc', rayon: 'fruits_legumes', marqueurs: ['legume'], role: 'incorpore' },
    { produit: 'moutarde', qte: 1, unite: 'cs', rayon: 'epicerie_salee', marqueurs: [] },
  ],
  realisation: [
    etape('Cuire les pommes de terre', 'Faites cuire les pommes de terre entières à l\'eau, 20 minutes.', 25, { actif: 3, appareil: 'plaque', feu: 'vif', ustensiles: ['casserole'], ingredients: ['pomme de terre'] }),
    etape('Assaisonner', 'Coupez-les tièdes, ajoutez l\'échalote émincée et la moutarde délayée.', 8, { ustensiles: ['saladier'], ingredients: ['échalote', 'moutarde'] }),
  ],
  etapes: ['Cuire les pommes de terre', 'Assaisonner'],
  cuisson: [{ appareil: 'plaque', dureeMin: 25 }],
  conservation: { frigoJours: 3, congelable: false },
  notes: {},
};

export const POULET = {
  id: 'poulet-curry',
  nom: 'Poulet au curry',
  type: 'plat',
  statutRecette: 'validee',
  portionsBase: 4,
  ingredients: [
    { produit: 'haut de cuisse de poulet', qte: 600, unite: 'g', rayon: 'boucherie', marqueurs: ['viande', 'volaille'], forme: 'morceaux' },
    { produit: 'oignon jaune', qte: 1, unite: 'pc', rayon: 'fruits_legumes', marqueurs: ['legume'], role: 'incorpore' },
    { produit: 'crème fraîche épaisse', qte: 10, unite: 'cl', rayon: 'cremerie', marqueurs: ['laitier'] },
  ],
  realisation: [
    etape('Saisir le poulet', 'Faites dorer le poulet et l\'oignon dans le Cookeo. Lavez-vous les mains.', 8, { appareil: 'cookeo', mode: 'dorer', ingredients: ['haut de cuisse de poulet', 'oignon jaune'] }),
    etape('Cuire sous pression', 'Ajoutez la crème, fermez et lancez la cuisson.', 15, { actif: 1, appareil: 'cookeo', mode: 'sous pression', ingredients: ['crème fraîche épaisse'], pret: 'Plus du tout rosé au centre.' }),
  ],
  etapes: ['Saisir le poulet', 'Cuire sous pression'],
  cuisson: [{ appareil: 'cookeo', mode: 'sous pression', dureeMin: 15 }],
  conservation: { frigoJours: 3, congelable: true },
  notes: {},
};

export const HOUMOUS = { id: 'houmous', nom: 'Houmous', type: 'apero', statutRecette: 'validee', portionsBase: 4, ingredients: [{ produit: 'pois chiche', qte: 1, unite: 'boite', rayon: 'epicerie_salee', marqueurs: ['feculent'] }], notes: {} };
export const ATTENTE = { id: 'tarte-attente', nom: 'Tarte en attente', notes: {} };

export const PLATS = [GRATIN, SALADE, POULET, HOUMOUS, ATTENTE];

export const SEMAINE = {
  id: '2026-10-24', debut: '2026-10-24', fin: '2026-10-30', creeLe: 1,
  plats: {
    'gratin-pommes-de-terre': { ajouteLe: 1 },
    'salade-pommes-de-terre': { ajouteLe: 2 },
    'poulet-curry': { ajouteLe: 3 },
    houmous: { ajouteLe: 4 },
    'tarte-attente': { ajouteLe: 5 },
  },
};

const G = 'gratin-pommes-de-terre';
const S = 'salade-pommes-de-terre';
const P = 'poulet-curry';

/** Plan de batch exemple pour SEMAINE (réponse de Claude, valeur de `batch`) ; `empreinte` : celle de la demande. */
export function planExemple(empreinte) {
  return {
    semaine: '2026-10-24',
    empreinte,
    dureeTotale: 80,
    travail: 50,
    recipients: [
      { plat: G, ustensile: 'plat à gratin', taille: '25 × 20 cm, pour 4 parts' },
      { plat: S, ustensile: 'saladier', taille: 'moyen, 2 litres' },
      { plat: P, ustensile: 'cuve du Cookeo', taille: '4 parts' },
    ],
    etapes: [
      { titre: 'Cuire toutes les pommes de terre', texte: 'Épluchez toutes les pommes de terre et faites-les cuire entières dans l\'eau bouillante salée : elles servent au gratin et à la salade.', duree: 25, actif: 8, appareil: 'plaque', feu: 'vif', ustensiles: ['grande casserole', 'éplucheur'], plats: [G, S], ingredients: [{ produit: 'pomme de terre', plat: G }, { produit: 'pomme de terre', plat: S }], pret: 'La pointe d\'un couteau entre sans forcer.' },
      { titre: 'Saisir le poulet', texte: 'Pendant ce temps, faites dorer le poulet et l\'oignon émincé dans le Cookeo. Lavez-vous les mains.', duree: 8, appareil: 'cookeo', mode: 'dorer', ustensiles: ['planche', 'couteau'], plats: [P], ingredients: [{ produit: 'haut de cuisse de poulet', plat: P }, { produit: 'oignon jaune', plat: P }] },
      { titre: 'Lancer le curry', texte: 'Ajoutez la crème, fermez le Cookeo et lancez la cuisson sous pression.', duree: 15, actif: 1, appareil: 'cookeo', mode: 'sous pression', plats: [P], ingredients: [{ produit: 'crème fraîche épaisse', plat: P }], pret: 'Le poulet n\'est plus du tout rosé au centre.' },
      { titre: 'Allumer le four', texte: 'Allumez le four pour le gratin.', duree: 1, appareil: 'four', tempC: 200, prechauffer: true, plats: [G] },
      { titre: 'Faire revenir les lardons', texte: 'Faites dorer les lardons à la poêle, sans matière grasse.', duree: 6, appareil: 'plaque', feu: 'moyen', ustensiles: ['poêle'], plats: [G], ingredients: [{ produit: 'lardons', plat: G }] },
      { titre: 'Couper les pommes de terre', texte: 'Égouttez les pommes de terre. Coupez celles du gratin en rondelles et celles de la salade en dés.', duree: 5, ustensiles: ['passoire', 'planche', 'couteau'], plats: [G, S] },
      { titre: 'Monter le gratin', texte: 'Alternez pommes de terre, lardons et crème dans le plat, puis couvrez de gruyère.', duree: 5, ustensiles: ['plat à gratin'], plats: [G], ingredients: [{ produit: 'crème fraîche épaisse', plat: G }, { produit: 'gruyère râpé', plat: G }], partAvant: G },
      { titre: 'Cuire le gratin', texte: 'Enfournez au milieu du four.', duree: 25, actif: 1, appareil: 'four', tempC: 200, plats: [G], pret: 'Le dessus est doré.' },
      { titre: 'Ouvrir le Cookeo', texte: 'Laissez sortir toute la vapeur avant d\'ouvrir le couvercle, puis goûtez et rectifiez.', duree: 2, plats: [P] },
      { titre: 'Assaisonner la salade', texte: 'Pendant la cuisson du gratin, ajoutez l\'échalote émincée et la moutarde aux pommes de terre tièdes.', duree: 8, ustensiles: ['saladier'], plats: [S], ingredients: [{ produit: 'échalote', plat: S }, { produit: 'moutarde', plat: S }] },
      { titre: 'Sortir le gratin', texte: 'Sortez le plat du four avec des maniques.', duree: 1, plats: [G], pret: 'Le gratin est sorti, le four peut être éteint.' },
    ],
  };
}
