import test from 'node:test';
import assert from 'node:assert/strict';
import { maxPrepsLinks, maxPrepsSearchUrl, parseRosterText, mergeRoster } from '../../src/core/maxpreps.js';
import { createPlayer } from '../../src/core/roster.js';

test('links: any MaxPreps page of a school maps to its volleyball home and roster', () => {
  const r = maxPrepsLinks('https://www.maxpreps.com/fl/tampa/tampa-prep-terrapins/volleyball/25-26/schedule/');
  assert.deepEqual(r, { base: 'https://www.maxpreps.com/fl/tampa/tampa-prep-terrapins/volleyball/', roster: 'https://www.maxpreps.com/fl/tampa/tampa-prep-terrapins/volleyball/roster/', school: 'fl/tampa/tampa-prep-terrapins' });
  assert.equal(maxPrepsLinks('maxpreps.com/fl/tampa/plant-panthers/football'), null, 'a link without https:// is rejected');
  assert.equal(maxPrepsLinks('https://maxpreps.com/fl/tampa/plant-panthers/football/').roster, 'https://www.maxpreps.com/fl/tampa/plant-panthers/volleyball/roster/');
  assert.equal(maxPrepsLinks('https://www.maxpreps.com/high-schools/tampa-catholic-crusaders-(tampa,fl)/volleyball/home.htm').roster, 'https://www.maxpreps.com/high-schools/tampa-catholic-crusaders-(tampa,fl)/volleyball/roster.htm');
  assert.equal(maxPrepsLinks('https://evil.example.com/fl/tampa/x/volleyball/'), null);
  assert.equal(maxPrepsLinks('https://www.maxpreps.com/'), null);
  assert.equal(maxPrepsLinks('not a url'), null);
  assert.match(maxPrepsSearchUrl('Plant Panthers'), /^https:\/\/www\.google\.com\/search\?q=site%3Amaxpreps\.com%20Plant%20Panthers%20volleyball%20roster$/);
});

test('table paste with a header row; staff rows skipped', () => {
  const text = ['#\tName\tGr.\tPos.\tHt.', '2\tAva Stone\tJr.\tOH\t5\'9"', '7\tBea Lane\tSr.\tS\t5\'7"', '11\tCara Moss\tFr.\tL, DS\t5\'4"', 'Head Coach\tDana Coach'].join('\n');
  const r = parseRosterText(text);
  assert.equal(r.format, 'table');
  assert.deepEqual(r.players.map((p) => [p.jersey, p.name, p.grade, p.roles, p.libero]), [
    ['2', 'Ava Stone', 'Jr.', ['OH'], false], ['7', 'Bea Lane', 'Sr.', ['S'], false], ['11', 'Cara Moss', 'Fr.', ['L', 'DS'], true],
  ]);
});

test('table paste without headers, columns in any order', () => {
  const r = parseRosterText('Ava Stone\t2\tOH\t11\nBea Lane\t7\tMB\t12\n');
  assert.deepEqual(r.players.map((p) => [p.jersey, p.name, p.grade, p.roles]), [['2', 'Ava Stone', 'Jr.', ['OH']], ['7', 'Bea Lane', 'Sr.', ['MB']]]);
});

test('one field per line (card layout), with coaches at the end', () => {
  const text = 'Roster\n#\n2\nAva Stone\nJr.\nOH\n5\'9"\n7\nBea Lane\nSr.\nSetter\n12\nCara Moss\nSo.\nLibero\nHead Coach\nDana Coach\nAssistant Coach\nEli Helper\n';
  const r = parseRosterText(text);
  assert.equal(r.format, 'blocks');
  assert.deepEqual(r.players.map((p) => [p.jersey, p.name, p.grade, p.roles.join('/')]), [['2', 'Ava Stone', 'Jr.', 'OH'], ['7', 'Bea Lane', 'Sr.', 'S'], ['12', 'Cara Moss', 'So.', 'L']]);
});

test('free-text lines', () => {
  const r = parseRosterText("12 Jane Doe Jr. OH 5'10\"\n#3 Kim Lee-Park Sr. S\n4 Mia Ray\nCoach: Bob Smith");
  assert.equal(r.format, 'lines');
  assert.deepEqual(r.players.map((p) => [p.jersey, p.name, p.grade, p.roles.join('/')]), [['12', 'Jane Doe', 'Jr.', 'OH'], ['3', 'Kim Lee-Park', 'Sr.', 'S'], ['4', 'Mia Ray', '', '']]);
});

test('junk yields null; duplicate jerseys warn', () => {
  assert.equal(parseRosterText('Welcome to the team page\nNo roster yet'), null);
  assert.equal(parseRosterText(''), null);
  const r = parseRosterText('5\tA One\n5\tB Two\n');
  assert.deepEqual(r.warnings, ['Jersey #5 appears more than once.']);
});

test('markup is stripped from pasted names', () => {
  const r = parseRosterText('9\t<b>Ann</b> "Bee"\tJr.\n8\tCy Dee\tSo.');
  assert.equal(r.players[0].name, 'bAnn/b Bee');
});

test('mergeRoster keeps ids and app-edited roles for players matched by name', () => {
  const old = [createPlayer({ id: 'keep', name: 'Ava Stone', jersey: '2', roles: ['OH', 'RS'] }), createPlayer({ id: 'gone', name: 'Left Team' })];
  const merged = mergeRoster(old, [{ name: 'ava stone', jersey: '22', roles: [], grade: 'Sr.' }, { name: 'New Kid', jersey: '9', roles: ['MB'] }], createPlayer);
  assert.deepEqual(merged.map((p) => [p.id === 'keep', p.jersey, p.roles]), [[true, '22', ['OH', 'RS']], [false, '9', ['MB']]]);
});
