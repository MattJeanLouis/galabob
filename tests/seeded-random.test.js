import test from 'node:test';
import assert from 'node:assert/strict';
import { deriveSeed, SeededRandom } from '../js/core/random/seeded-random.js';

test('reproduit exactement une sequence a partir de la meme graine', () => {
  const first = new SeededRandom('stage-42');
  const second = new SeededRandom('stage-42');
  const sequence = (source) => Array.from({ length: 8 }, () => source.next());

  assert.deepEqual(sequence(first), sequence(second));
});

test('reseed redemarre la sequence et expose la graine normalisee', () => {
  const random = new SeededRandom(1234);
  const expected = random.next();
  assert.equal(random.reseed(1234), 1234);
  assert.equal(random.next(), expected);
});

test('integer et pick restent dans leurs bornes', () => {
  const random = new SeededRandom(99);
  for (let index = 0; index < 100; index++) {
    const value = random.integer(4);
    assert.ok(value >= 0 && value < 4);
  }
  assert.ok(['a', 'b', 'c'].includes(random.pick(['a', 'b', 'c'])));
  assert.equal(random.pick([]), null);
  assert.throws(() => random.integer(0), RangeError);
});

test('derive une graine stable et distincte pour chaque stage', () => {
  assert.equal(deriveSeed(123, 'arcade', 8, 0), deriveSeed(123, 'arcade', 8, 0));
  assert.notEqual(deriveSeed(123, 'arcade', 8, 0), deriveSeed(123, 'arcade', 9, 0));
  assert.notEqual(deriveSeed(123, 'arcade', 8, 0), deriveSeed(124, 'arcade', 8, 0));
});
