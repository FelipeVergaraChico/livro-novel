import { spawn } from 'node:child_process';
import assert from 'node:assert/strict';

const origin = 'http://127.0.0.1:3002';
const child = spawn(process.execPath, ['dist/server/index.js'], {
  env: { ...process.env, PORT: '3002', APP_ORIGIN: origin },
  stdio: ['ignore', 'pipe', 'pipe'],
});
try {
  await new Promise((resolve, reject) => {
    const timer = setTimeout(
      () => reject(new Error('API de produção não iniciou em 10 segundos.')),
      10_000,
    );
    child.stdout.on('data', (data) => {
      if (data.toString().includes('LivroNovel API')) {
        clearTimeout(timer);
        resolve();
      }
    });
    child.once('exit', (code) => {
      clearTimeout(timer);
      reject(new Error(`API encerrou: ${code}`));
    });
    child.once('error', reject);
  });
  const index = await fetch(origin);
  assert.equal(index.status, 200);
  assert.match(await index.text(), /LivroNovel/);
  const health = await fetch(`${origin}/api/health`);
  assert.equal(health.status, 200);
  const body = new FormData();
  body.append('file', new Blob(['Capítulo 1\nLivroNovel em produção local.']), 'teste.txt');
  const imported = await fetch(`${origin}/api/import`, {
    method: 'POST',
    headers: { Origin: origin },
    body,
  });
  const book = await imported.json();
  assert.equal(imported.status, 200, JSON.stringify(book));
  assert.equal(book.chapters.length, 1);
  assert.match(book.chapters[0].blocks[1].text, /produção local/);
  console.log('Smoke de produção: HTML, PostgreSQL e conversão isolada passaram.');
} finally {
  child.kill();
}
