import test from 'node:test';
import assert from 'node:assert/strict';
import { EntityBudget } from '../js/core/entity-budget.js';

test('supprime les objets les plus anciens au-dela du plafond', () => {
  const budget = new EntityBudget({ sparks: 3 });
  const sparks = [1, 2, 3, 4, 5];

  assert.equal(budget.enforce('sparks', sparks), 2);
  assert.deepEqual(sparks, [3, 4, 5]);
  assert.equal(budget.discarded.sparks, 2);
});

test('ignore les listes et limites inconnues sans planter', () => {
  const budget = new EntityBudget({});
  assert.equal(budget.enforce('unknown', [1, 2]), 0);
  assert.equal(budget.enforce('unknown', null), 0);
});

