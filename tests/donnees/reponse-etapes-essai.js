// Réponse réelle du projet Claude à l'essai du format « réalisation » (2026-10-12, effort faible), gardée telle quelle
// comme fixture générique : trois recettes classiques, aucune donnée du foyer. Les empreintes sont celles de l'essai
// (fictives) ; les tests les remplacent par celles des fiches ci-dessous quand il le faut.
// Fiches génériques correspondantes (ingrédients, portions, cuisson), contre lesquelles la réponse se valide sans erreur.

export const REPONSE_ETAPES_ESSAI = {
  "format": "paquet@1",
  "instructions": 6,
  "plats": [
    {
      "id": "gratin-dauphinois",
      "nom": "Gratin dauphinois",
      "empreinte": "3kf9za",
      "realisation": [
        {
          "titre": "Éplucher et trancher les pommes de terre",
          "texte": "Épluchez les pommes de terre. Coupez-les en rondelles fines de 3 mm, toutes de la même épaisseur. Ne les rincez pas : leur amidon épaissira la sauce.",
          "duree": 20,
          "ustensiles": [
            "éplucheur",
            "planche",
            "couteau"
          ],
          "ingredients": [
            "pomme de terre"
          ],
          "pret": "Toutes les pommes de terre sont en rondelles fines et régulières.",
          "apres": []
        },
        {
          "titre": "Chauffer le lait parfumé",
          "texte": "Pelez l'ail et écrasez-le du plat du couteau. Mettez-le dans la grande casserole avec le lait et la muscade. Salez et poivrez. Chauffez à feu moyen.",
          "duree": 5,
          "actif": 2,
          "appareil": "plaque",
          "feu": "moyen",
          "ustensiles": [
            "grande casserole",
            "couteau"
          ],
          "ingredients": [
            "lait",
            "ail",
            "noix de muscade"
          ],
          "aussi": [
            {
              "produit": "sel fin",
              "qte": 1,
              "unite": "cc"
            },
            "poivre noir"
          ],
          "pret": "Le lait frémit, de petites bulles apparaissent sur le bord.",
          "apres": []
        },
        {
          "titre": "Précuire les pommes de terre dans le lait",
          "texte": "Plongez les rondelles dans le lait. Baissez à feu doux et laissez cuire en remuant doucement de temps en temps pour qu'elles n'attachent pas au fond.",
          "duree": 10,
          "actif": 3,
          "appareil": "plaque",
          "feu": "doux",
          "ustensiles": [
            "grande casserole",
            "spatule en bois"
          ],
          "pret": "La pointe d'un couteau entre dans une rondelle avec un peu de résistance.",
          "apres": [
            1,
            2
          ]
        },
        {
          "titre": "Remplir le plat",
          "texte": "Beurrez tout le plat à gratin. Versez-y les pommes de terre et leur lait à la louche, retirez l'ail. Nappez de crème et égalisez la surface.",
          "duree": 3,
          "ustensiles": [
            "plat à gratin",
            "louche"
          ],
          "ingredients": [
            "beurre",
            "crème liquide"
          ],
          "pret": "Les pommes de terre sont juste couvertes de liquide."
        },
        {
          "titre": "Cuire au four",
          "texte": "Enfournez au milieu du four à 180 °C. Laissez cuire sans y toucher.",
          "duree": 50,
          "actif": 1,
          "appareil": "four",
          "tempC": 180,
          "pret": "Le dessus est doré et le couteau traverse le gratin sans résistance."
        },
        {
          "titre": "Réchauffer une portion",
          "texte": "Mettez la portion dans un petit plat couvert de papier aluminium. Réchauffez au four à 160 °C.",
          "duree": 20,
          "actif": 2,
          "appareil": "four",
          "tempC": 160,
          "ustensiles": [
            "plat à gratin"
          ],
          "aussi": [
            "papier aluminium"
          ],
          "pret": "C'est bien chaud au centre, la crème bouillonne sur les bords.",
          "auService": true
        }
      ]
    },
    {
      "id": "carbonade-flamande",
      "nom": "Carbonade flamande",
      "empreinte": "q7m2xd",
      "realisation": [
        {
          "titre": "Émincer les oignons",
          "texte": "Pelez les oignons et coupez-les en deux. Émincez-les en lamelles fines.",
          "duree": 8,
          "ustensiles": [
            "planche",
            "couteau"
          ],
          "ingredients": [
            "oignon jaune"
          ],
          "pret": "Tous les oignons sont en lamelles fines.",
          "apres": []
        },
        {
          "titre": "Couper le bœuf",
          "texte": "Coupez le bœuf en cubes de 4 cm et séchez-les avec du papier absorbant. Lavez-vous les mains ensuite.",
          "duree": 6,
          "ustensiles": [
            "planche",
            "couteau"
          ],
          "ingredients": [
            "bœuf à braiser"
          ],
          "aussi": [
            "papier absorbant"
          ],
          "pret": "Tous les cubes sont secs en surface.",
          "partAvant": true
        },
        {
          "titre": "Dorer la viande et les lardons",
          "texte": "Faites fondre le beurre dans la cocotte à feu vif. Dorez le bœuf en deux fois avec les lardons, sans trop remuer. Poivrez. Réservez sur une assiette.",
          "duree": 12,
          "appareil": "plaque",
          "feu": "vif",
          "ustensiles": [
            "cocotte",
            "spatule en bois"
          ],
          "ingredients": [
            {
              "produit": "beurre",
              "part": 0.7
            },
            "lardons fumés"
          ],
          "aussi": [
            "poivre noir"
          ],
          "pret": "Les cubes sont bien bruns sur toutes les faces."
        },
        {
          "titre": "Faire fondre les oignons",
          "texte": "Baissez à feu moyen et ajoutez le reste du beurre dans la cocotte. Mettez les oignons et remuez souvent en grattant les sucs du fond.",
          "duree": 8,
          "actif": 6,
          "appareil": "plaque",
          "feu": "moyen",
          "ustensiles": [
            "cocotte",
            "spatule en bois"
          ],
          "ingredients": [
            {
              "produit": "beurre",
              "part": 0.3
            }
          ],
          "pret": "Les oignons sont fondants et blonds."
        },
        {
          "titre": "Mouiller et garnir",
          "texte": "Remettez la viande. Versez la bière et le bouillon, ajoutez la cassonade et le laurier. Tartinez le pain d'épices de moutarde et posez-le dessus. Portez à frémissement.",
          "duree": 5,
          "actif": 3,
          "appareil": "plaque",
          "feu": "vif",
          "ustensiles": [
            "cocotte",
            "couteau"
          ],
          "ingredients": [
            "bière brune",
            "bouillon de bœuf",
            "cassonade",
            "laurier",
            "pain d'épices",
            "moutarde forte"
          ],
          "pret": "Le liquide frémit et couvre presque la viande."
        },
        {
          "titre": "Mijoter au four",
          "texte": "Couvrez la cocotte et enfournez à 160 °C. Laissez mijoter toute la durée, sans raccourcir : la bière doit cuire longtemps.",
          "duree": 150,
          "actif": 2,
          "appareil": "four",
          "tempC": 160,
          "ustensiles": [
            "cocotte"
          ],
          "pret": "La viande se défait à la fourchette, le pain d'épices a fondu dans la sauce."
        },
        {
          "titre": "Finir la sauce",
          "texte": "Sortez la cocotte du four. Retirez le laurier et mélangez pour lisser la sauce. Goûtez et rectifiez en sel et en poivre.",
          "duree": 3,
          "ustensiles": [
            "louche"
          ],
          "aussi": [
            "sel fin",
            "poivre noir"
          ],
          "pret": "La sauce est brune, lisse et nappe la cuillère."
        },
        {
          "titre": "Réchauffer une portion",
          "texte": "Mettez la portion dans une casserole avec un fond d'eau. Réchauffez à couvert à feu doux en remuant de temps en temps.",
          "duree": 12,
          "actif": 2,
          "appareil": "plaque",
          "feu": "doux",
          "ustensiles": [
            "casserole"
          ],
          "pret": "C'est bien chaud au centre des morceaux, la sauce frémit.",
          "auService": true
        }
      ]
    },
    {
      "id": "gateau-chocolat",
      "nom": "Gâteau au chocolat",
      "empreinte": "w5h8tn",
      "realisation": [
        {
          "titre": "Fondre le chocolat et le beurre",
          "texte": "Cassez le chocolat en carrés dans la casserole avec le beurre en morceaux. Faites fondre à feu doux en remuant sans arrêt. Retirez du feu et laissez tiédir.",
          "duree": 5,
          "appareil": "plaque",
          "feu": "doux",
          "ustensiles": [
            "casserole",
            "spatule en bois"
          ],
          "ingredients": [
            "chocolat noir",
            "beurre"
          ],
          "pret": "Le mélange est lisse et brillant, sans morceaux.",
          "apres": []
        },
        {
          "titre": "Séparer les œufs",
          "texte": "Cassez les œufs un par un. Mettez les blancs dans un saladier propre et sec, les jaunes dans un bol. Lavez-vous les mains ensuite.",
          "duree": 4,
          "ustensiles": [
            "saladier"
          ],
          "ingredients": [
            "oeuf"
          ],
          "pret": "Aucune trace de jaune dans les blancs.",
          "apres": []
        },
        {
          "titre": "Ajouter sucre, jaunes et farine",
          "texte": "Versez le chocolat tiède dans un saladier. Ajoutez le sucre et fouettez, puis les jaunes un à un. Ajoutez la farine en pluie en fouettant.",
          "duree": 4,
          "ustensiles": [
            "saladier",
            "fouet"
          ],
          "ingredients": [
            "sucre",
            "farine"
          ],
          "pret": "La pâte est lisse et homogène.",
          "apres": [
            1,
            2
          ]
        },
        {
          "titre": "Monter les blancs en neige",
          "texte": "Ajoutez une pincée de sel aux blancs. Fouettez d'abord doucement, puis de plus en plus vite.",
          "duree": 6,
          "ustensiles": [
            "saladier",
            "fouet"
          ],
          "aussi": [
            {
              "produit": "sel fin",
              "qte": 1,
              "unite": "pincee"
            }
          ],
          "pret": "Les blancs sont fermes et ne glissent pas quand on penche le saladier.",
          "apres": [
            2
          ]
        },
        {
          "titre": "Incorporer les blancs",
          "texte": "Ajoutez un tiers des blancs à la pâte et mélangez. Ajoutez le reste en soulevant délicatement la pâte avec la spatule, sans battre.",
          "duree": 3,
          "ustensiles": [
            "spatule en bois"
          ],
          "pret": "Plus aucune trace blanche, la pâte reste aérée.",
          "apres": [
            3,
            4
          ]
        },
        {
          "titre": "Cuire au four",
          "texte": "Tapissez le moule de papier cuisson et versez la pâte. Enfournez au milieu du four à 180 °C.",
          "duree": 25,
          "actif": 2,
          "appareil": "four",
          "tempC": 180,
          "ustensiles": [
            "moule"
          ],
          "aussi": [
            "papier cuisson"
          ],
          "pret": "Le dessus est craquelé, une lame plantée au centre ressort à peine humide."
        }
      ]
    }
  ]
};

const ing = (produit, qte, unite, rayon, marqueurs = [], extra = {}) => ({ produit, qte, unite, rayon, marqueurs, ...extra });

export const FICHES_ESSAI = [
  {
    id: 'gratin-dauphinois',
    nom: 'Gratin dauphinois',
    type: 'plat',
    statutRecette: 'brouillon',
    portionsBase: 4,
    ingredients: [
      ing('pomme de terre', 1, 'kg', 'fruits_legumes', ['legume', 'feculent'], { role: 'principal' }),
      ing('lait', 50, 'cl', 'cremerie', ['laitier']),
      ing('crème liquide', 20, 'cl', 'cremerie', ['laitier']),
      ing('ail', 1, 'pc', 'fruits_legumes', ['legume'], { role: 'incorpore' }),
      ing('beurre', 10, 'g', 'cremerie', ['laitier']),
      ing('noix de muscade', 1, 'pincee', 'epicerie_salee'),
    ],
    etapes: ['Éplucher et trancher les pommes de terre.', 'Les précuire dans le lait.', 'Remplir le plat et cuire au four.'],
    cuisson: [{ appareil: 'plaque', dureeMin: 15 }, { appareil: 'four', tempC: 180, dureeMin: 50 }],
    tempsActifMin: 30,
    conservation: { frigoJours: 3, congelable: false },
    source: 'Version classique',
  },
  {
    id: 'carbonade-flamande',
    nom: 'Carbonade flamande',
    type: 'plat',
    statutRecette: 'brouillon',
    portionsBase: 4,
    ingredients: [
      ing('bœuf à braiser', 800, 'g', 'boucherie', ['viande', 'boeuf'], { forme: 'morceaux' }),
      ing('lardon fumé', 100, 'g', 'charcuterie', ['viande', 'porc', 'charcuterie'], { forme: 'morceaux' }),
      ing('oignon jaune', 3, 'pc', 'fruits_legumes', ['legume'], { role: 'incorpore' }),
      ing('beurre', 40, 'g', 'cremerie', ['laitier']),
      ing('bière brune', 50, 'cl', 'boissons'),
      ing('bouillon de bœuf', 20, 'cl', 'epicerie_salee', ['bouillon_viande']),
      ing('cassonade', 1, 'cs', 'epicerie_sucree'),
      ing('laurier', 2, 'pc', 'epicerie_salee'),
      ing('pain d\'épices', 2, 'tranche', 'epicerie_sucree', ['miel']),
      ing('moutarde forte', 1, 'cs', 'epicerie_salee'),
    ],
    etapes: ['Dorer la viande.', 'Faire fondre les oignons.', 'Mouiller à la bière et mijoter au four.'],
    cuisson: [{ appareil: 'plaque', dureeMin: 20 }, { appareil: 'four', tempC: 160, dureeMin: 150 }],
    tempsActifMin: 35,
    conservation: { frigoJours: 3, congelable: true },
    variantes: [
      {
        pour: 'profil-b',
        style: 'vegetal',
        retirer: ['bœuf à braiser', 'lardon fumé', 'bouillon de bœuf'],
        ajouter: [{ produit: 'seitan', qtePortion: 120, unite: 'g', rayon: 'epicerie_salee', marqueurs: [] }],
        consigne: 'Mettre sa part de côté avant la viande ; seitan saisi, même sauce.',
      },
    ],
    source: 'Version classique',
  },
  {
    id: 'gateau-chocolat',
    nom: 'Gâteau au chocolat',
    type: 'dessert',
    statutRecette: 'brouillon',
    portionsBase: 6,
    ingredients: [
      ing('chocolat noir', 200, 'g', 'epicerie_sucree'),
      ing('beurre', 125, 'g', 'cremerie', ['laitier']),
      ing('œuf', 4, 'pc', 'cremerie', ['oeuf']),
      ing('sucre', 100, 'g', 'epicerie_sucree'),
      ing('farine', 50, 'g', 'epicerie_sucree', ['feculent']),
    ],
    etapes: ['Fondre le chocolat et le beurre.', 'Ajouter le sucre, les jaunes et la farine.', 'Incorporer les blancs, cuire.'],
    cuisson: [{ appareil: 'plaque', dureeMin: 5 }, { appareil: 'four', tempC: 180, dureeMin: 25 }],
    tempsActifMin: 25,
    conservation: { frigoJours: 4, congelable: true },
    source: 'Version classique',
  },
];
