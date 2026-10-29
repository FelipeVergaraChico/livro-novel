import { readFile } from 'node:fs/promises';
import { pool } from './db.js';
try {
  await pool.query(await readFile(new URL('./schema.sql', import.meta.url), 'utf8'));
  console.log('Banco do LivroNovel preparado.');
} finally {
  await pool.end();
}
