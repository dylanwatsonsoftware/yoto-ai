import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

test('the Pi package contains runnable skill sources and excludes catalogue assets and runtime data', async () => {
  const cache = await mkdtemp(join(tmpdir(), 'yoto-pack-'));
  try {
    const [pack] = JSON.parse(execFileSync('npm', ['pack', '--dry-run', '--json', '--ignore-scripts', '--cache', cache], { encoding: 'utf8' }));
    const paths = pack.files.map(({ path }) => path);
    for (const path of ['.pi/prompts/yoto-import.md', 'playlist-package-v1.schema.json',
      'yoto-ai/SKILL.md', 'yoto-ai/scripts/src/cli.ts', 'yoto-ai/package-lock.json',
      'yoto-myo-idea-exchange-google-drive/SKILL.md',
      'yoto-myo-idea-exchange-google-drive/scripts/src/cli.ts']) {
      assert.ok(paths.includes(path), `Missing ${path}`);
    }
    assert.deepEqual(paths.filter(path => /^(catalogue-site|import-reports|imports|previews|portable-packages)\//.test(path)), []);
    assert.deepEqual(paths.filter(path => /(^|\/)(\.env(?!\.example)|node_modules|\.data|tokens)(\/|$)/.test(path)), []);
    assert.ok(pack.unpackedSize < 2_000_000, `Pi skill package unexpectedly large: ${pack.unpackedSize}`);
  } finally {
    await rm(cache, { recursive: true, force: true });
  }
});
