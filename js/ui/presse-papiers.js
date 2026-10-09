// Presse-papiers : copier un texte pour le projet Claude, lire la réponse à coller. À appeler dans un toucher.

/** Copie un texte. → true si la copie a réussi. Le texte n'est jamais affiché. */
export async function copier(texte) {
  try {
    await navigator.clipboard.writeText(texte);
    return true;
  } catch {
    // Repli des navigateurs sans accès au presse-papiers : zone invisible, sélection, copie.
  }
  const actif = document.activeElement;
  const zone = document.createElement('textarea');
  zone.value = texte;
  zone.setAttribute('readonly', '');
  zone.setAttribute('aria-hidden', 'true');
  zone.className = 'hors-ecran';
  // Depuis une feuille (dialogue modal), la page derrière est inerte : la zone se pose dans la feuille pour être
  // sélectionnable.
  (actif?.closest?.('dialog[open]') ?? document.body).append(zone);
  zone.select();
  let reussi = false;
  try {
    reussi = document.execCommand('copy');
  } catch {
    reussi = false;
  }
  zone.remove();
  if (actif instanceof HTMLElement) actif.focus({ preventScroll: true });
  return reussi;
}

/** Lit le presse-papiers. → { texte } ou { refus: true } (non permis, ou refusé par la personne). */
export async function lirePressePapiers() {
  if (!navigator.clipboard?.readText) return { refus: true };
  try {
    return { texte: await navigator.clipboard.readText() };
  } catch {
    return { refus: true };
  }
}

/** Vrai si le téléphone a déjà bloqué la lecture du presse-papiers pour l'app. */
export async function lectureBloquee() {
  try {
    const etat = await navigator.permissions.query({ name: 'clipboard-read' });
    return etat.state === 'denied';
  } catch {
    return false;
  }
}
