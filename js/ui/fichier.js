// Fichiers du téléphone : choix d'un fichier, lecture de son texte, téléchargement d'un fichier produit par l'app.

/**
 * Ouvre le sélecteur de fichiers du téléphone. À appeler dans un toucher. → File ou null.
 * Types larges : Android ou Drive donnent parfois un type inattendu à un fichier de l'app, qui ne doit pas être grisé.
 */
export function choisirFichier() {
  return new Promise((resoudre) => {
    const entree = document.createElement('input');
    entree.type = 'file';
    entree.accept = 'application/json,text/plain,application/octet-stream,.json,.txt';
    entree.addEventListener('change', () => resoudre(entree.files?.[0] ?? null), { once: true });
    entree.addEventListener('cancel', () => resoudre(null), { once: true });
    entree.click();
  });
}

/**
 * Lit le texte d'un fichier (UTF-8). Un fichier de plus de `max` octets est refusé avant toute lecture.
 * → promesse de { texte } ou { erreur: 'trop_gros' | 'illisible' }.
 */
export async function lireTexte(fichier, max) {
  if (!fichier || typeof fichier.size !== 'number') return { erreur: 'illisible' };
  if (fichier.size > max) return { erreur: 'trop_gros' };
  try {
    return { texte: await fichier.text() };
  } catch {
    return { erreur: 'illisible' };
  }
}

// Chrome Android lit l'adresse du fichier après le clic : elle n'est libérée qu'ensuite.
const DELAI_LIBERATION_MS = 10000;

/**
 * Télécharge `texte` sous le nom `nom`. Synchrone : à appeler dans le toucher, sans attente préalable, sinon le
 * navigateur peut bloquer le téléchargement. Une page ne sait pas s'il a abouti : les textes disent « lancé ».
 */
export function telecharger(nom, texte) {
  const adresse = URL.createObjectURL(new Blob([texte], { type: 'application/json' }));
  const lien = document.createElement('a');
  lien.href = adresse;
  lien.download = nom;
  lien.hidden = true;
  document.body.append(lien);
  lien.click();
  lien.remove();
  setTimeout(() => URL.revokeObjectURL(adresse), DELAI_LIBERATION_MS);
}
