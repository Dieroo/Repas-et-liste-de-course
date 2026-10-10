import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  ROUTE_PAR_DEFAUT,
  ROUTES_AVEC_PARAMETRE,
  normaliserEmail,
  roleDe,
  roleEffectif,
  routeAutorisee,
  resoudreRoute,
  parametreDe,
  gestionnaireADesigner,
} from '../js/coeur/roles.js';

const reglages = { gestionnaire: 'planif@example.com' };

test('normaliserEmail ignore la casse et les espaces', () => {
  assert.equal(normaliserEmail('  Planif@Example.COM '), 'planif@example.com');
});

test('normaliserEmail renvoie une chaîne vide si l’adresse manque', () => {
  assert.equal(normaliserEmail(undefined), '');
  assert.equal(normaliserEmail(null), '');
  assert.equal(normaliserEmail(42), '');
});

test('roleDe reconnaît le gestionnaire, même écrit autrement', () => {
  assert.equal(roleDe('planif@example.com', reglages), 'gestionnaire');
  assert.equal(roleDe(' PLANIF@example.com', reglages), 'gestionnaire');
  assert.equal(roleDe('planif@example.com', { gestionnaire: 'Planif@Example.com ' }), 'gestionnaire');
});

test('roleDe donne la vue courses à l’autre membre', () => {
  assert.equal(roleDe('courses@example.com', reglages), 'courses');
});

test('roleDe sans gestionnaire défini : personne n’est gestionnaire', () => {
  assert.equal(roleDe('planif@example.com', {}), 'courses');
  assert.equal(roleDe('planif@example.com', { gestionnaire: '' }), 'courses');
  assert.equal(roleDe('planif@example.com', undefined), 'courses');
});

test('roleDe sans adresse : aucun rôle', () => {
  assert.equal(roleDe('', reglages), null);
  assert.equal(roleDe(null, reglages), null);
  assert.equal(roleDe(undefined, { gestionnaire: '' }), null);
});

test('routeAutorisee : les quatre onglets pour les deux rôles', () => {
  for (const route of ['semaine', 'courses', 'plats', 'decouvrir']) {
    assert.equal(routeAutorisee(route, 'gestionnaire'), true, route);
    assert.equal(routeAutorisee(route, 'courses'), true, route);
  }
});

test('routeAutorisee : Réglages réservé au gestionnaire', () => {
  assert.equal(routeAutorisee('reglages', 'gestionnaire'), true);
  assert.equal(routeAutorisee('reglages', 'courses'), false);
});

test('routeAutorisee : écran inconnu ou rôle absent refusés', () => {
  assert.equal(routeAutorisee('inconnu', 'gestionnaire'), false);
  assert.equal(routeAutorisee('', 'gestionnaire'), false);
  assert.equal(routeAutorisee('semaine', null), false);
  assert.equal(routeAutorisee('semaine', 'autre'), false);
});

test('resoudreRoute lit le hash', () => {
  assert.equal(resoudreRoute('#/courses', 'courses'), 'courses');
  assert.equal(resoudreRoute('#courses', 'courses'), 'courses');
  assert.equal(resoudreRoute('#/plats/carbonade', 'gestionnaire'), 'plats');
  assert.equal(resoudreRoute('#/decouvrir?profil=x', 'gestionnaire'), 'decouvrir');
});

test('resoudreRoute renvoie vers l’accueil si l’écran est inconnu ou interdit', () => {
  assert.equal(ROUTE_PAR_DEFAUT, 'semaine');
  assert.equal(resoudreRoute('', 'gestionnaire'), 'semaine');
  assert.equal(resoudreRoute(undefined, 'gestionnaire'), 'semaine');
  assert.equal(resoudreRoute('#/', 'courses'), 'semaine');
  assert.equal(resoudreRoute('#/nimporte', 'courses'), 'semaine');
  assert.equal(resoudreRoute('#/reglages', 'courses'), 'semaine');
  assert.equal(resoudreRoute('#/reglages', 'gestionnaire'), 'reglages');
  assert.equal(resoudreRoute('#/semaine', null), 'semaine');
});

test('gestionnaireADesigner : vrai tant que personne n’est gestionnaire', () => {
  assert.equal(gestionnaireADesigner(undefined), true);
  assert.equal(gestionnaireADesigner({}), true);
  assert.equal(gestionnaireADesigner({ versionSchema: 1 }), true);
  assert.equal(gestionnaireADesigner({ gestionnaire: '  ' }), true);
  assert.equal(gestionnaireADesigner(reglages), false);
});

test('routes : « Modifier la recette » pour les deux rôles, identifiant obligatoire', () => {
  for (const role of ['gestionnaire', 'courses']) {
    assert.equal(routeAutorisee('modifier', role), true, role);
    assert.equal(resoudreRoute('#/modifier/risotto-test', role), 'modifier', role);
    // Sans identifiant valide : la liste des plats, comme pour la fiche.
    assert.equal(resoudreRoute('#/modifier', role), 'plats', role);
    assert.equal(resoudreRoute('#/modifier/', role), 'plats', role);
    assert.equal(resoudreRoute('#/modifier/Majuscules', role), 'plats', role);
    assert.equal(resoudreRoute('#/modifier/a%2Fb', role), 'plats', role);
  }
  assert.equal(resoudreRoute('#/modifier/risotto-test', null), 'semaine');
  assert.equal(parametreDe('#/modifier/risotto-test', 'modifier'), 'risotto-test');
  assert.equal(parametreDe('#/modifier/Abc!', 'modifier'), '');
  assert.equal(parametreDe('#/modifier/risotto-test', 'plat'), '');
  assert.equal(parametreDe('#/plat/risotto-test', 'modifier'), '');
});

test('routes : « Demandes » réservée au gestionnaire, sans paramètre ; ailleurs et en aperçu, Semaine (T2e)', () => {
  assert.equal(routeAutorisee('demandes', 'gestionnaire'), true);
  assert.equal(routeAutorisee('demandes', 'courses'), false);
  assert.equal(resoudreRoute('#/demandes', 'gestionnaire'), 'demandes');
  assert.equal(resoudreRoute('#/demandes', 'courses'), 'semaine');
  assert.equal(resoudreRoute('#/demandes', null), 'semaine');
  // Aperçu « Repas et courses » : le rôle effectif est « courses ».
  assert.equal(resoudreRoute('#/demandes', roleEffectif('gestionnaire', true)), 'semaine');
  assert.equal(resoudreRoute('#/demandes', roleEffectif('gestionnaire', false)), 'demandes');
  // Sans paramètre : un identifiant ajouté est ignoré.
  assert.equal(ROUTES_AVEC_PARAMETRE.includes('demandes'), false);
  assert.equal(resoudreRoute('#/demandes/gratin-test', 'gestionnaire'), 'demandes');
  assert.equal(parametreDe('#/demandes/gratin-test', 'demandes'), '');
});
