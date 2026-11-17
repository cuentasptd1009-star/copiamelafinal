import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import ts from 'typescript';

async function originFor(env) {
  const source = (await readFile(new URL('../artifacts/super-tv/src/lib/api.ts', import.meta.url), 'utf8')).replaceAll('import.meta.env', `(${JSON.stringify(env)})`);
  const { outputText } = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.ES2022, target: ts.ScriptTarget.ES2022 } });
  return (await import('data:text/javascript;base64,' + Buffer.from(outputText).toString('base64'))).apiBase;
}

test('production builds without Cloudflare environment variables still use the VPS', async () => {
  assert.equal(await originFor({ PROD: true, BASE_URL: '/' }), 'https://167-233-103-143.sslip.io');
});

test('explicit API configuration is normalized and shared', async () => {
  assert.equal(await originFor({ PROD: true, VITE_API_URL: 'https://api.example.test/' }), 'https://api.example.test');
});

test('development keeps its relative local API path', async () => {
  assert.equal(await originFor({ PROD: false, BASE_URL: '/preview/' }), '');
});
