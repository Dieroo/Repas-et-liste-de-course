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

/** Fichier JPEG tiré d'une adresse de données (« data:image/jpeg;base64,… ») ; null si elle est illisible. Synchrone. */
export function fichierDeLImage(adresse, nom) {
  const trouve = /^data:([^;,]+);base64,(.*)$/s.exec(String(adresse ?? ''));
  if (!trouve) return null;
  try {
    const binaire = atob(trouve[2]);
    const octets = new Uint8Array(binaire.length);
    for (let i = 0; i < binaire.length; i += 1) octets[i] = binaire.charCodeAt(i);
    return new File([octets], nom, { type: trouve[1] });
  } catch {
    return null;
  }
}

/**
 * Télécharge des images (adresses de données), chacune sous son nom. Synchrone, dans le toucher. Chrome peut demander
 * une fois l'autorisation de télécharger plusieurs fichiers.
 */
export function telechargerImages(images) {
  for (const { nom, adresse } of images) {
    const fichier = fichierDeLImage(adresse, nom);
    if (!fichier) continue;
    const lien = document.createElement('a');
    const url = URL.createObjectURL(fichier);
    lien.href = url;
    lien.download = nom;
    lien.hidden = true;
    document.body.append(lien);
    lien.click();
    lien.remove();
    setTimeout(() => URL.revokeObjectURL(url), DELAI_LIBERATION_MS);
  }
}

/** Vrai si le téléphone sait partager des photos vers une autre app (Android : menu « Partager »). */
export function partageDePhotosPossible() {
  try {
    if (typeof navigator.share !== 'function' || typeof navigator.canShare !== 'function') return false;
    return navigator.canShare({ files: [new File([new Uint8Array(1)], 'essai.jpg', { type: 'image/jpeg' })] });
  } catch {
    return false;
  }
}

/** Vrai si le téléphone sait partager, avec des photos, un fichier texte (la demande pour Claude). */
export function partageDuTextePossible() {
  try {
    if (typeof navigator.share !== 'function' || typeof navigator.canShare !== 'function') return false;
    return navigator.canShare({ files: [
      new File(['essai'], 'essai.txt', { type: 'text/plain' }),
      new File([new Uint8Array(1)], 'essai.jpg', { type: 'image/jpeg' }),
    ] });
  } catch {
    return false;
  }
}

/**
 * Partage des images et, si le téléphone le permet, un texte en fichier joint (menu « Partager » d'Android, vers
 * l'app Claude) : l'app Claude garde le texte d'un partage qui porte texte et images, et laisse les images (essai du
 * 2026-10-15) ; un fichier texte part comme les images, en pièce jointe, devant elles. Sans partage de fichier texte,
 * les images seules (le texte part alors par le presse-papiers).
 * `texte` : { nom, contenu } ou null. À appeler dans le toucher, sans attente préalable : les fichiers sont construits
 * tout de suite.
 * → promesse de { issue: 'partage' | 'annule' | 'impossible', avecTexte }.
 */
export async function partagerImages({ images, texte = null }) {
  const fichiers = images.map(({ nom, adresse }) => fichierDeLImage(adresse, nom)).filter(Boolean);
  let contenu = { files: fichiers };
  let avecTexte = false;
  try {
    if (!fichiers.length || typeof navigator.share !== 'function' || !navigator.canShare?.(contenu)) {
      return { issue: 'impossible', avecTexte };
    }
    if (texte?.contenu && texte?.nom) {
      const avec = { files: [new File([texte.contenu], texte.nom, { type: 'text/plain' }), ...fichiers] };
      if (navigator.canShare(avec)) {
        contenu = avec;
        avecTexte = true;
      }
    }
    await navigator.share(contenu);
    return { issue: 'partage', avecTexte };
  } catch (erreur) {
    return { issue: erreur?.name === 'AbortError' ? 'annule' : 'impossible', avecTexte };
  }
}
