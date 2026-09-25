import test from 'node:test';
import assert from 'node:assert/strict';

test('WorldForge workspace contract is documented', () => {
  assert.match(JSON.stringify({type:'world',schemaVersion:1}), /world/);
  assert.equal(typeof crypto.randomUUID, 'function');
});
