import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  ROUTE_PAR_DEFAUT,
  normaliserEmail,
  roleDe,
  routeAutorisee,
  resoudreRoute,
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
