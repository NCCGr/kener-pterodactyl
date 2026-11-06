import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const egg = JSON.parse(readFileSync(new URL('../egg-kener.json', import.meta.url), 'utf8'));
// Pterodactyl Panel v1.11.11 EggFormRequest / Egg model validation (ASCII PCRE).
// The edit form joins each image as "display name|image reference".
// Source: https://github.com/pterodactyl/panel/blob/v1.11.11/app/Http/Requests/Admin/Egg/EggFormRequest.php
const imageRule = /^[\w#.\/\- ]*\|*[\w.\/\-:@ ]*$/i;

test('image values pass the Panel model and each edit-form line passes the request rule', () => {
  assert(Object.keys(egg.docker_images).length > 0);
  for (const [label, reference] of Object.entries(egg.docker_images)) {
    assert(imageRule.test(reference), `Panel rejects image reference: ${reference}`);
    assert(reference.length <= 191);
    assert(imageRule.test(`${label}|${reference}`), `Panel rejects display name or reference: ${label}`);
  }
});

test('the compatibility rule catches both causes of the reported save failure', () => {
  assert(!imageRule.test('Kener（ローカルビルド）|local/kener-pterodactyl:4.2.0-egg.3'));
  assert(!imageRule.test('Kener|~local/kener-pterodactyl:4.2.0-egg.3'));
});

test('startup detection agrees with the supervisor and configuration stays valid JSON', () => {
  for (const key of ['files', 'startup', 'logs']) JSON.parse(egg.config[key]);
  const marker = JSON.parse(egg.config.startup).done;
  const supervisor = readFileSync(new URL('../supervisor.mjs', import.meta.url), 'utf8');
  assert.equal(marker, '[kener-egg] 起動完了: ポート');
  assert(supervisor.includes('起動完了: ポート ${port}'));
  assert.equal(egg.meta.version, 'PTDL_v2');
});
