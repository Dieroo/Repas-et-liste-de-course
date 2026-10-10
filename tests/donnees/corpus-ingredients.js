// Corpus de couverture des « Produits courants » (T3-0, plan §6.2 point 11).
//
// Origine : rédigé le 2026-10-10 par un agent séparé, AVANT le dictionnaire (js/coeur/dictionnaire.js) et sans
// le regarder, à partir de trois sources génériques :
//   - les fixtures de tests/ (produits réalistes seulement : ni noms de test, ni variantes de casse) ;
//   - les exemples de docs/projet-claude.md et de CLAUDE.md §8 ;
//   - des recettes françaises courantes de batch cooking : plats mijotés, gratins, pâtes, poissons, desserts, apéro.
// Écriture : comme Claude écrit `produit` dans une fiche paquet@1 (docs/projet-claude.md §2) : minuscules, au
// singulier, sans marque, avec les accents ; quelques pluriels d'usage gardés tels que Claude les écrit souvent
// (« pâtes », « lentilles vertes », « petits pois », « herbes de provence »). Aucun nom volontairement ambigu
// (« pâte », « pâté », « crème », « fromage », « bouillon », « steak », « saucisse » seuls) : Claude précise toujours.
//
// Règle : ce corpus est figé. On ne l'ajuste JAMAIS au dictionnaire (ni ajout, ni retrait, ni réécriture d'un nom
// pour qu'il soit reconnu) : c'est le dictionnaire qui doit le couvrir, à 90 % au moins
// (tests/coeur-dictionnaire.test.js). Un nom non reconnu se corrige dans le dictionnaire (entrée ou alias).
//
// Regroupement par rayon pour la lecture seulement : l'ordre et les groupes n'ont aucun effet sur le test.
// Données génériques : aucune donnée du foyer.

export const CORPUS_INGREDIENTS = Object.freeze([
  // Fruits et légumes
  'oignon jaune', 'oignon rouge', 'échalote', "gousse d'ail", 'ail', 'carotte', 'poireau', 'courgette', 'aubergine',
  'poivron rouge', 'tomate', 'tomate cerise', 'pomme de terre', 'pomme de terre à chair ferme', 'patate douce',
  'champignon de paris', 'céleri branche', 'navet', 'panais', 'potiron', 'courge butternut', 'chou-fleur', 'brocoli',
  "pousse d'épinard", 'haricot vert', 'fenouil', 'concombre', 'avocat', 'radis', 'citron', 'citron vert', 'pomme',
  'gingembre frais', 'persil', 'coriandre fraîche', 'basilic frais', 'ciboulette', 'aneth',

  // Boucherie
  'bœuf haché', 'steak haché', 'joue de bœuf', 'paleron de bœuf', 'bœuf à braiser', 'épaule de veau',
  "épaule d'agneau", 'sauté de porc', 'échine de porc', 'filet mignon de porc', 'blanc de poulet',
  'haut de cuisse de poulet', 'cuisse de poulet', 'escalope de dinde', 'cuisse de canard', 'chair à saucisse',
  'foie de volaille',

  // Charcuterie
  'jambon blanc', 'jambon cru', 'lardon fumé', 'poitrine fumée', 'bacon', 'chorizo', 'saucisse de toulouse',
  'saucisse de morteau', 'merguez', 'saucisson sec', 'pâté de campagne', 'rillettes de porc',

  // Poissonnerie
  'pavé de saumon', 'saumon fumé', 'dos de cabillaud', 'filet de cabillaud', 'filet de colin', 'filet de lieu noir',
  'truite fumée', 'crevette décortiquée', 'moule', 'noix de saint-jacques', 'encornet', "pavé d'espadon",
  'filet de maquereau', 'bâtonnet de surimi',

  // Crèmerie (dont pâtes à dérouler, tofu et apéro frais)
  'beurre', 'beurre doux', 'beurre demi-sel', 'crème fraîche épaisse', 'crème fraîche', 'crème liquide entière',
  'lait', 'lait demi-écrémé', 'œuf', 'yaourt nature', 'fromage blanc', 'mascarpone', 'ricotta', 'pâte brisée',
  'pâte feuilletée', 'pâte à pizza', 'tofu ferme', 'tofu fumé', 'crème de soja', 'gnocchi', 'houmous',

  // Fromages
  'gruyère râpé', 'emmental râpé', 'fromage râpé', 'comté', 'parmesan', 'reblochon', 'camembert', 'mozzarella',
  'bûche de chèvre', 'feta', 'fromage à raclette', 'roquefort', 'tomme de savoie',

  // Épicerie salée : féculents et légumes secs
  'pâtes', 'pâtes courtes', 'spaghetti', 'penne', 'coquillette', 'feuille de lasagne', 'riz basmati', 'riz arborio',
  'riz long', 'semoule fine', 'boulgour', 'lentilles vertes', 'lentille corail', 'pois chiche', 'haricot rouge',
  'maïs doux',
  // Épicerie salée : conserves, sauces, huiles, condiments
  'tomate concassée', 'coulis de tomate', 'concentré de tomate', 'lait de coco', "huile d'olive", 'huile neutre',
  'vinaigre de vin rouge', 'vinaigre balsamique', 'vinaigre de cidre', 'sauce soja', 'moutarde', 'thon au naturel',
  'olive noire', 'cornichon', 'tapenade', 'chips', 'cacahuète', 'pignon de pin',
  // Épicerie salée : sel, épices et herbes sèches
  'sel', 'sel fin', 'gros sel', 'poivre', 'paprika', 'cumin', 'curry', 'curcuma', 'noix de muscade',
  "piment d'espelette", 'herbes de provence', 'thym', 'feuille de laurier', 'quatre-épices',
  // Épicerie salée : bouillons, fonds, liants
  'bouillon de légumes', 'bouillon de volaille', 'bouillon de bœuf', 'cube de bouillon de volaille', 'fond de veau',
  'fumet de poisson', 'fécule de maïs', 'chapelure',
  // Épicerie salée : protéines végétales
  'seitan', 'miso blanc', 'protéines de soja texturées',

  // Épicerie sucrée
  'sucre', 'sucre en poudre', 'sucre roux', 'sucre glace', 'sucre vanillé', 'farine', 'levure chimique',
  'extrait de vanille', 'chocolat noir', 'cacao en poudre', 'miel', "poudre d'amande", "flocon d'avoine",
  'noisette', 'noix', 'cerneau de noix', 'cannelle', 'biscuit à la cuillère', 'crème de marrons',
  'compote de pomme', 'feuille de gélatine', 'agar-agar',

  // Boulangerie
  'pain de mie', 'baguette', 'pain de campagne', 'tortilla de blé', "pain d'épices", 'gressin',

  // Surgelés
  'petits pois', 'épinard haché surgelé', 'poêlée de légumes', 'frites', 'fruits rouges surgelés', 'edamame',

  // Boissons (cuisine et apéro)
  'vin blanc sec', 'vin rouge', 'bière blonde', 'cidre brut', 'rhum', 'marsala', 'porto', 'café fort',
  'café soluble', 'jus de pomme', 'sirop de grenadine',
]);
