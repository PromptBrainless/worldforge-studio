import test from 'node:test';
import assert from 'node:assert/strict';
import { cpSync, copyFileSync, existsSync, mkdtempSync, rmSync, symlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const repositoryRoot = fileURLToPath(new URL('..', import.meta.url));

test('production build succeeds without tests or fixtures', () => {
  const isolatedRoot = mkdtempSync(join(tmpdir(), 'worldforge-empty-core-'));
  try {
    for (const file of ['index.html', 'package.json', 'tsconfig.json', 'vite.config.ts']) {
      copyFileSync(join(repositoryRoot, file), join(isolatedRoot, file));
    }
    cpSync(join(repositoryRoot, 'src'), join(isolatedRoot, 'src'), { recursive: true });
    symlinkSync(join(repositoryRoot, 'node_modules'), join(isolatedRoot, 'node_modules'), 'dir');
    assert.equal(existsSync(join(isolatedRoot, 'tests')), false);

    const result = spawnSync('npm', ['run', 'build'], { cwd: isolatedRoot, encoding: 'utf8' });
    assert.equal(result.status, 0, `${result.stdout}\n${result.stderr}`);
  } finally {
    rmSync(isolatedRoot, { recursive: true, force: true });
  }
});