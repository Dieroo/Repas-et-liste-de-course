// Fixtures génériques des exemples DEMANDE-ETAPES de docs/projet-claude.md (T5-0b) : deux fiches et leurs étapes
// détaillées, aussi celles des exemples de fiches complètes (gratin, quiche, poulet au miso).
export const GRATIN = {
  id: 'gratin-pates-jambon', nom: 'Gratin de pâtes au jambon', type: 'plat', statutRecette: 'brouillon', portionsBase: 4,
  ingredients: [
    { produit: 'pâtes courtes', qte: 400, unite: 'g', rayon: 'epicerie_salee', marqueurs: ['feculent'] },
    { produit: 'jambon blanc', qte: 4, unite: 'tranche', rayon: 'charcuterie', marqueurs: ['viande', 'porc', 'charcuterie'], forme: 'fine' },
    { produit: 'crème fraîche épaisse', qte: 20, unite: 'cl', rayon: 'cremerie', marqueurs: ['laitier'] },
    { produit: 'gruyère râpé', qte: 100, unite: 'g', rayon: 'fromages', marqueurs: ['laitier'] },
    { produit: 'oignon jaune', qte: 1, unite: 'pc', rayon: 'fruits_legumes', marqueurs: ['legume'], role: 'incorpore' },
  ],
  etapes: ['Cuire les pâtes al dente.', "Faire revenir l'oignon émincé, ajouter la crème et le jambon coupé fin.", 'Mélanger avec les pâtes, couvrir de gruyère, gratiner.'],
  cuisson: [{ appareil: 'plaque', dureeMin: 12 }, { appareil: 'four', tempC: 200, dureeMin: 20 }],
  tempsActifMin: 15,
  conservation: { frigoJours: 3, congelable: true },
  emporter: true,
  variantes: [{ pour: 'profil-b', retirer: ['jambon blanc'], ajouter: [{ produit: 'thon au naturel', qtePortion: 50, unite: 'g', rayon: 'epicerie_salee', marqueurs: ['poisson'] }], consigne: "Prélever sa part avant d'ajouter le jambon ; y mettre le thon." }],
  source: 'Version classique',
};
export const GATEAU = {
  id: 'gateau-yaourt', nom: 'Gâteau au yaourt', type: 'dessert', statutRecette: 'validee', portionsBase: 6,
  ingredients: [
    { produit: 'yaourt nature', qte: 125, unite: 'g', rayon: 'cremerie', marqueurs: ['laitier'] },
    { produit: 'sucre', qte: 150, unite: 'g', rayon: 'epicerie_sucree', marqueurs: [] },
    { produit: 'œuf', qte: 3, unite: 'pc', rayon: 'cremerie', marqueurs: ['oeuf'] },
    { produit: 'farine', qte: 200, unite: 'g', rayon: 'epicerie_sucree', marqueurs: ['feculent'] },
    { produit: 'levure chimique', qte: 1, unite: 'sachet', rayon: 'epicerie_sucree', marqueurs: [] },
    { produit: 'huile de tournesol', qte: 8, unite: 'cl', rayon: 'epicerie_salee', marqueurs: [] },
  ],
  etapes: ['Mélanger le yaourt, le sucre et les œufs.', "Ajouter la farine, la levure et l'huile.", 'Cuire au four.'],
  cuisson: [{ appareil: 'four', tempC: 180, dureeMin: 35 }],
  tempsActifMin: 10,
  conservation: { frigoJours: 4, congelable: true },
  source: 'Version classique',
};
export const REALISATION_GRATIN = [
  { titre: "Préparer l'oignon et le jambon", texte: "Pelez l'oignon et émincez-le finement. Coupez le jambon en lanières d'un centimètre.", duree: 5, ustensiles: ['planche', "couteau d'office"], ingredients: ['oignon jaune'] },
  { titre: "Faire chauffer l'eau des pâtes", texte: "Remplissez une grande casserole d'eau, couvrez et portez à ébullition à feu vif.", duree: 10, actif: 1, appareil: 'plaque', feu: 'vif', ustensiles: ['grande casserole'], aussi: [{ produit: 'eau', qte: 3, unite: 'l', fixe: true }], pret: "L'eau bout à gros bouillons.", apres: [] },
  { titre: 'Cuire les pâtes', texte: "Salez l'eau, versez les pâtes et remuez. Laissez cuire 2 minutes de moins que le temps du paquet, en remuant de temps en temps.", duree: 9, actif: 1, appareil: 'plaque', feu: 'vif', ingredients: ['pâtes courtes'], aussi: [{ produit: 'gros sel', qte: 1, unite: 'cs', fixe: true }], pret: 'Les pâtes sont encore un peu fermes sous la dent.', apres: [2] },
  { titre: 'Égoutter les pâtes', texte: 'Versez les pâtes dans la passoire, secouez et laissez-les dans la passoire.', duree: 2, ustensiles: ['passoire'] },
  { titre: "Faire fondre l'oignon", texte: "Dans une sauteuse, faites fondre l'oignon dans un filet d'huile à feu moyen, en remuant, sans le laisser colorer.", duree: 5, appareil: 'plaque', feu: 'moyen', ustensiles: ['sauteuse', 'spatule en bois'], aussi: ["huile d'olive"], pret: "L'oignon est translucide.", apres: [1] },
  { titre: 'Faire la sauce', texte: 'Ajoutez la crème et le jambon, poivrez et laissez frémir 2 minutes à feu doux. Goûtez : le jambon sale déjà, salez seulement s\'il le faut.', duree: 3, appareil: 'plaque', feu: 'doux', ingredients: ['crème fraîche épaisse', 'jambon blanc'], aussi: ['poivre noir'], partAvant: true },
  { titre: 'Assembler', texte: 'Mélangez les pâtes avec la sauce, versez dans le plat à gratin et couvrez de gruyère.', duree: 4, ustensiles: ['plat à gratin'], ingredients: ['gruyère râpé'], apres: [4, 6] },
  { titre: 'Gratiner au four', texte: 'Enfournez à mi-hauteur et laissez gratiner sans y toucher.', duree: 20, actif: 1, appareil: 'four', tempC: 200, pret: 'Le dessus est doré et la sauce bouillonne sur les bords.' },
  { titre: 'Sortir le gratin', texte: 'Sortez le plat du four avec des maniques et posez-le sur un dessous-de-plat.', duree: 1, pret: 'Le plat est sorti, le four peut être éteint.' },
  { titre: 'Réchauffer une portion', texte: "Couvrez la boîte et réchauffez au micro-ondes en remuant à mi-temps, jusqu'à ce que ce soit bien chaud au centre.", duree: 4, actif: 1, pret: 'Bien chaud au centre, la sauce frémit.', auService: true },
];
export const REALISATION_GATEAU = [
  { titre: 'Battre les œufs et le sucre', texte: 'Cassez les œufs dans un saladier, ajoutez le sucre et fouettez. Lavez-vous les mains ensuite.', duree: 4, ustensiles: ['saladier', 'fouet'], ingredients: ['œuf', 'sucre'], pret: 'Le mélange blanchit et mousse un peu.' },
  { titre: "Ajouter le yaourt et l'huile", texte: "Ajoutez le yaourt, puis l'huile en filet, en fouettant.", duree: 2, ustensiles: ['fouet'], ingredients: ['yaourt nature', 'huile de tournesol'] },
  { titre: 'Ajouter la farine et la levure', texte: 'Versez la farine et la levure en pluie. Mélangez juste assez pour une pâte lisse, sans grumeaux.', duree: 3, ustensiles: ['spatule en bois'], ingredients: ['farine', 'levure chimique'], pret: 'La pâte est lisse et nappe la cuillère.' },
  { titre: 'Cuire au four', texte: 'Versez la pâte dans le moule beurré et enfournez au milieu du four.', duree: 35, actif: 2, appareil: 'four', tempC: 180, ustensiles: ['moule'], aussi: ['beurre pour le moule'], pret: 'Une lame plantée au centre ressort sèche.' },
  { titre: 'Sortir et démouler', texte: 'Sortez le moule du four. Laissez tiédir 10 minutes, puis démoulez sur une grille.', duree: 12, actif: 2, pret: 'Le gâteau se détache seul du moule.' },
];
export const REALISATION_QUICHE = [
  { titre: 'Foncer le moule', texte: 'Déroulez la pâte dans le moule avec son papier et piquez le fond à la fourchette.', duree: 3, ustensiles: ['moule'], ingredients: ['pâte brisée'], partAvant: true },
  { titre: 'Dorer les lardons', texte: 'Faites dorer les lardons à sec dans une poêle à feu moyen, en remuant. Égouttez-les sur du papier absorbant, puis lavez-vous les mains.', duree: 5, appareil: 'plaque', feu: 'moyen', ustensiles: ['poêle', 'spatule en bois'], ingredients: ['lardon fumé'], aussi: ['papier absorbant'], pret: 'Les lardons sont dorés et un peu croustillants.', apres: [] },
  { titre: "Préparer l'appareil", texte: 'Cassez les œufs dans un saladier, ajoutez la crème et fouettez. Salez peu, les lardons sont déjà salés, et poivrez. Lavez-vous les mains ensuite.', duree: 3, ustensiles: ['saladier', 'fouet'], ingredients: ['œuf', 'crème fraîche épaisse'], aussi: ['sel fin', 'poivre noir'], apres: [] },
  { titre: 'Garnir la quiche', texte: "Répartissez les lardons et le gruyère sur la pâte, puis versez l'appareil.", duree: 2, ingredients: ['gruyère râpé'], apres: [1, 2, 3] },
  { titre: 'Cuire au four', texte: 'Enfournez au milieu du four et laissez cuire sans ouvrir la porte.', duree: 35, actif: 1, appareil: 'four', tempC: 180, pret: 'La quiche est dorée et ne tremble plus au centre.' },
  { titre: 'Sortir la quiche', texte: 'Sortez la quiche du four et laissez-la reposer 5 minutes avant de la couper.', duree: 5, actif: 1, pret: 'La garniture est prise quand on coupe.' },
  { titre: 'Réchauffer une part', texte: 'Réchauffez la part sur une plaque, au four, pour que la pâte reste croustillante.', duree: 10, actif: 1, appareil: 'four', tempC: 160, pret: 'Bien chaud au centre.', auService: true },
];
export const REALISATION_POULET = [
  { titre: 'Préparer la marinade', texte: 'Râpez le gingembre. Mélangez-le dans un saladier avec le miso et le miel.', duree: 4, ustensiles: ['râpe', 'saladier'], ingredients: ['gingembre frais', 'miso blanc', 'miel'], partAvant: true },
  { titre: 'Enrober le poulet et la patate douce', texte: 'Épluchez la patate douce et coupez-la en cubes de 2 cm. Coupez le poulet en morceaux, enrobez le tout de marinade et étalez sur la plaque. Lavez-vous les mains après le poulet cru.', duree: 10, ustensiles: ['éplucheur', 'planche', 'couteau', 'plaque de four'], ingredients: ['haut de cuisse de poulet', 'patate douce'] },
  { titre: 'Rôtir au four', texte: 'Enfournez en haut du four. Retournez les morceaux à mi-cuisson.', duree: 35, actif: 3, appareil: 'four', tempC: 200, pret: "Le poulet n'est plus du tout rosé au centre, le jus qui s'écoule est clair." },
  { titre: 'Cuire le riz', texte: "Rincez le riz, versez-le dans une casserole avec une fois et demie son volume d'eau salée. Couvrez et laissez cuire à feu doux.", duree: 12, actif: 2, appareil: 'plaque', feu: 'doux', ustensiles: ['casserole'], ingredients: ['riz basmati'], aussi: ['sel fin'], pret: "L'eau est absorbée et le riz est tendre.", apres: [] },
  { titre: 'Sortir la plaque', texte: 'Sortez la plaque du four et mélangez le poulet et la patate douce dans leur jus.', duree: 2, pret: 'Tout est bien enrobé de sauce.', apres: [3] },
  { titre: 'Réchauffer une portion', texte: "Réchauffez la boîte couverte au micro-ondes, en remuant à mi-temps, jusqu'à ce que ce soit bien chaud au centre.", duree: 4, actif: 1, pret: 'Bien chaud au centre.', auService: true },
];
