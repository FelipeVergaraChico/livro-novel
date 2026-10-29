import { describe, it, expect, afterAll } from 'vitest';
import request from 'supertest';
import { randomUUID } from 'node:crypto';
import { createApp } from '../server/app';
import { pool } from '../server/db';
import { importBook } from '../server/importer';
const app = createApp();
const origin = 'http://localhost:5173';
const accounts: string[] = [];
async function account() {
  const email = `test-${randomUUID()}@livronovel.test`;
  accounts.push(email);
  const result = await request(app)
    .post('/api/auth/register')
    .set('Origin', origin)
    .send({ email, password: 'Teste-local-123456' });
  expect(result.status).toBe(201);
  return { cookie: result.headers['set-cookie'][0].split(';')[0], id: result.body.id, email };
}
afterAll(async () => {
  if (accounts.length) await pool.query('DELETE FROM users WHERE email = ANY($1)', [accounts]);
  await pool.end();
});
describe('API, contas e biblioteca PostgreSQL', () => {
  it('recusa escrita de outra origem e exige autenticação para biblioteca', async () => {
    expect(
      (
        await request(app)
          .post('/api/auth/register')
          .set('Origin', 'https://outro.invalid')
          .send({})
      ).status,
    ).toBe(403);
    expect((await request(app).get('/api/books')).status).toBe(401);
  });
  it('converte um TXT sem conta em processo separado', async () => {
    const result = await request(app)
      .post('/api/import')
      .set('Origin', origin)
      .attach('file', Buffer.from('Capítulo 1\nTexto original.'), 'exemplo.txt');
    expect(result.status).toBe(200);
    expect(result.body.chapters).toHaveLength(1);
  });
  it('retorna erro legível para formato falso', async () => {
    const result = await request(app)
      .post('/api/import')
      .set('Origin', origin)
      .attach('file', Buffer.from('Não sou um epub'), 'falso.epub');
    expect(result.status).toBe(422);
    expect(result.body.error).toContain('pacote');
  });
  it('salva, retoma, impede acesso cruzado e detecta conflito de progresso', async () => {
    const a = await account(),
      b = await account();
    const book = await importBook(
      Buffer.from('Capítulo 1\nUm parágrafo.\nOutro parágrafo.'),
      'livro.txt',
    );
    const saved = await request(app)
      .post('/api/books')
      .set('Origin', origin)
      .set('Cookie', a.cookie)
      .send({ book });
    expect(saved.status).toBe(201);
    const id = saved.body.book.id;
    expect((await request(app).get(`/api/books/${id}`).set('Cookie', b.cookie)).status).toBe(404);
    const progress = {
      chapterId: book.chapters[0].id,
      blockId: book.chapters[0].blocks[1].id,
      fraction: 0.4,
    };
    const updated = await request(app)
      .put(`/api/books/${id}/progress`)
      .set('Origin', origin)
      .set('Cookie', a.cookie)
      .send({ progress, version: 0 });
    expect(updated.status).toBe(200);
    expect(updated.body.version).toBe(1);
    const stale = await request(app)
      .put(`/api/books/${id}/progress`)
      .set('Origin', origin)
      .set('Cookie', a.cookie)
      .send({ progress, version: 0 });
    expect(stale.status).toBe(409);
    const reopened = await request(app).get(`/api/books/${id}`).set('Cookie', a.cookie);
    expect(reopened.body.progress).toEqual(progress);
    await request(app).delete(`/api/books/${id}`).set('Origin', origin).set('Cookie', b.cookie);
    expect((await request(app).get(`/api/books/${id}`).set('Cookie', a.cookie)).status).toBe(200);
    await request(app).delete(`/api/books/${id}`).set('Origin', origin).set('Cookie', a.cookie);
    expect((await request(app).get(`/api/books/${id}`).set('Cookie', a.cookie)).status).toBe(404);
  });
  it('sincroniza preferências, autentica e encerra sessão', async () => {
    const a = await account();
    const preferences = { theme: 'sepia', fontSize: 24, lineHeight: 2.1, font: 'serif' };
    expect(
      (
        await request(app)
          .put('/api/preferences')
          .set('Origin', origin)
          .set('Cookie', a.cookie)
          .send(preferences)
      ).status,
    ).toBe(200);
    const logged = await request(app)
      .post('/api/auth/login')
      .set('Origin', origin)
      .send({ email: a.email, password: 'Teste-local-123456' });
    expect(logged.status).toBe(200);
    expect(logged.body.preferences).toEqual(preferences);
    const cookie = logged.headers['set-cookie'][0].split(';')[0];
    await request(app).post('/api/auth/logout').set('Origin', origin).set('Cookie', cookie);
    expect((await request(app).get('/api/auth/me').set('Cookie', cookie)).status).toBe(401);
  });
  it('pagina no servidor e mantém resumo independente do filtro', async () => {
    const a = await account();
    const book = await importBook(Buffer.from('Texto.'), 'Exemplo.txt');
    for (let i = 0; i < 14; i++)
      await pool.query(
        'INSERT INTO books(id,user_id,title,author,format,content,size_bytes) VALUES($1,$2,$3,$4,$5,$6,$7)',
        [randomUUID(), a.id, `Livro ${i}`, '', 'txt', JSON.stringify(book), 100],
      );
    const first = await request(app).get('/api/books?page=1').set('Cookie', a.cookie);
    const second = await request(app).get('/api/books?page=2').set('Cookie', a.cookie);
    expect(first.body.books).toHaveLength(12);
    expect(second.body.books).toHaveLength(2);
    expect(first.body.usage.count).toBe(14);
    expect(first.body.usage.bytes).toBe(1400);
    const filtered = await request(app).get('/api/books?search=Livro%2013').set('Cookie', a.cookie);
    expect(filtered.body.total).toBe(1);
    expect(filtered.body.usage.count).toBe(14);
    expect(new Set([...first.body.books, ...second.body.books].map((b) => b.id)).size).toBe(14);
  });
  it('impede ultrapassar cotas de livros e de armazenamento', async () => {
    const a = await account();
    const book = await importBook(Buffer.from('Texto.'), 'Teste.txt');
    const id = randomUUID();
    await pool.query(
      'INSERT INTO books(id,user_id,title,author,format,content,size_bytes) VALUES($1,$2,$3,$4,$5,$6,$7)',
      [id, a.id, 'Cheio', '', 'txt', JSON.stringify(book), 500_000_000],
    );
    expect(
      (
        await request(app)
          .post('/api/books')
          .set('Origin', origin)
          .set('Cookie', a.cookie)
          .send({ book })
      ).status,
    ).toBe(409);
    await pool.query('DELETE FROM books WHERE user_id=$1', [a.id]);
    for (let i = 0; i < 50; i++)
      await pool.query(
        'INSERT INTO books(id,user_id,title,author,format,content,size_bytes) VALUES($1,$2,$3,$4,$5,$6,$7)',
        [randomUUID(), a.id, 'Livro', '', 'txt', JSON.stringify(book), 1],
      );
    expect(
      (
        await request(app)
          .post('/api/books')
          .set('Origin', origin)
          .set('Cookie', a.cookie)
          .send({ book })
      ).status,
    ).toBe(409);
  });
});
