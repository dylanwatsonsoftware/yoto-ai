import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { resolve, dirname } from 'node:path';
import { pathToFileURL } from 'node:url';
import test from 'node:test';

// Exercise Pi's own discovery implementation without a model, network, or account.
const modulePath = process.env.PI_SKILLS_MODULE;
test('Pi discovers both Yoto skills from the project configuration', {
  skip: !modulePath && 'Set PI_SKILLS_MODULE to the installed Pi dist/core/skills.js',
}, async () => {
  const { loadSkills } = await import(pathToFileURL(modulePath).href);
  const settingsPath = resolve('.pi/settings.json');
  const settings = await readFile(settingsPath, 'utf8')
    .then(JSON.parse).catch(error => {
      if (error.code === 'ENOENT') return {};
      throw error;
    });
  const manifest = JSON.parse(await readFile(resolve('package.json'), 'utf8'));
  const sources = [
    (settings.skills ?? []).map(path => resolve(dirname(settingsPath), path)),
    manifest.pi.skills.map(path => resolve(path)),
  ];
  for (const skillPaths of sources) {
    const result = loadSkills({
      cwd: process.cwd(), agentDir: '/tmp/yoto-pi-test-no-global-skills',
      skillPaths, includeDefaults: false,
    });
    for (const name of ['yoto-ai', 'yoto-myo-idea-exchange-google-drive']) {
      const skill = result.skills.find(skill => skill.name === name);
      assert.ok(skill, `Pi did not discover ${name}`);
      assert.ok((await readFile(skill.filePath, 'utf8')).includes(`# ${name === 'yoto-ai' ? 'Yoto AI' : 'Yoto MYO Idea Exchange Google Drive'}`));
    }
    assert.deepEqual(result.diagnostics, []);
  }
});

test('Pi loads the import prompt and preserves selected IDs and paths in its expansion', {
  skip: !modulePath && 'Set PI_SKILLS_MODULE to the installed Pi dist/core/skills.js',
}, async () => {
  const { loadPromptTemplates, expandPromptTemplate } = await import(
    pathToFileURL(resolve(dirname(modulePath), 'prompt-templates.js')).href
  );
  const result = loadPromptTemplates({
    cwd: process.cwd(), agentDir: '/tmp/yoto-pi-test-no-global-prompts',
    promptPaths: [resolve('.pi/prompts')], includeDefaults: false,
  });
  assert.deepEqual(result.diagnostics, []);
  assert.equal(result.templates.length, 1);
  assert.equal(result.templates[0].name, 'yoto-import');
  const expanded = expandPromptTemplate('/yoto-import "https://drive.google.com/file/d/selected-id/view" "/tmp/My Music"', result.templates);
  assert.ok(expanded.includes('https://drive.google.com/file/d/selected-id/view'));
  assert.ok(expanded.includes('/tmp/My Music'));
  assert.ok(!expanded.includes('$ARGUMENTS'));
});
