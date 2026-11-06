import { readFileSync, writeFileSync } from 'node:fs';

// Upstream's Express listener ignores HOST. Make tunnel mode genuinely loopback-only.
const file = 'scripts/main.ts';
const source = readFileSync(file, 'utf8');
const before = 'app.listen(PORT, async () => {';
const after = 'app.listen(Number(PORT), process.env.HOST || "0.0.0.0", async () => {';
if (source.split(before).length !== 2) throw new Error('Kener listener changed; review the HOST patch before updating.');
writeFileSync(file, source.replace(before, after));
