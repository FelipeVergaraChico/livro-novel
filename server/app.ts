import express, { type Request, type Response, type NextFunction } from 'express';
import cookieParser from 'cookie-parser';
import helmet from 'helmet';
import { rateLimit } from 'express-rate-limit';
import multer from 'multer';
import { randomUUID, randomBytes, createHash, scrypt, timingSafeEqual } from 'node:crypto';
import { promisify } from 'node:util';
import { z } from 'zod';
import { load } from 'cheerio';
import { pool } from './db.js';
import { convertIsolated } from './converter.js';
import { cleanHtml } from './importer.js';
import {
  MAX_BOOKS,
  MAX_FILE_BYTES,
  MAX_LIBRARY_BYTES,
  MAX_CONVERTED_BYTES,
  MAX_CHAPTER_BLOCKS,
  MAX_BOOK_BLOCKS,
  defaultPreferences,
} from '../shared/types.js';

const derive = promisify(scrypt);
const digest = (token: string) => createHash('sha256').update(token).digest('hex');
const error = (message: string, status = 400) => Object.assign(new Error(message), { status });
const preferencesSchema = z.object({
  theme: z.enum(['light', 'dark', 'sepia']),
  fontSize: z.number().min(16).max(32),
  lineHeight: z.number().min(1.4).max(2.4),
  font: z.enum(['serif', 'sans']),
});
const positionSchema = z.object({
  chapterId: z.uuid(),
  blockId: z.uuid(),
  fraction: z.number().min(0).max(1),
});
const bookSchema = z.object({
  id: z.uuid(),
  title: z.string().trim().min(1).max(200),
  author: z.string().max(200),
  format: z.enum(['epub', 'txt', 'docx']),
  warnings: z.array(z.string().max(1000)).max(100),
  chapters: z
    .array(
      z.object({
        id: z.uuid(),
        title: z.string().trim().min(1).max(200),
        blocks: z
          .array(
            z.object({
              id: z.uuid(),
              html: z.string().max(20_000_000),
              text: z.string().max(12_000_000),
            }),
          )
          .min(1)
          .max(MAX_CHAPTER_BLOCKS),
      }),
    )
    .min(1)
    .max(2500),
});
const credentialsSchema = z.object({
  email: z
    .email()
    .max(254)
    .transform((v) => v.toLowerCase().trim()),
  password: z.string().min(10).max(128),
});
type User = { id: string; email: string; preferences: unknown };
declare global {
  namespace Express {
    interface Request {
      user?: User;
    }
  }
}

export function createApp() {
  const app = express();
  app.disable('x-powered-by');
  app.use(
    helmet({
      contentSecurityPolicy: {
        directives: {
          'img-src': ["'self'", 'data:'],
          'style-src': ["'self'", "'unsafe-inline'"],
          'script-src': ["'self'"],
          'connect-src': ["'self'"],
          'object-src': ["'none'"],
          'frame-src': ["'none'"],
        },
      },
    }),
  );
  app.use('/api', (_req, res, next) => {
    res.set('Cache-Control', 'no-store');
    next();
  });
  app.use(
    '/api',
    rateLimit({
      windowMs: 60_000,
      limit: 180,
      standardHeaders: 'draft-8',
      legacyHeaders: false,
      message: { error: 'Muitas solicitações. Aguarde um minuto.' },
    }),
  );
  app.use(cookieParser());
  app.use('/api', (req, _res, next) => {
    if (['GET', 'HEAD', 'OPTIONS'].includes(req.method)) return next();
    const allowed = (process.env.APP_ORIGIN || 'http://localhost:5173,http://127.0.0.1:5173').split(
      ',',
    );
    if (!req.headers.origin || !allowed.includes(req.headers.origin))
      return next(error('Origem da solicitação não permitida.', 403));
    next();
  });
  const json = express.json({ limit: MAX_CONVERTED_BYTES + 1000 });
  const smallJson = express.json({ limit: '16kb' });
  const requireUser = async (req: Request, _res: Response, next: NextFunction) => {
    try {
      const token = req.cookies.ln_session;
      if (!token || typeof token !== 'string')
        throw error('Entre na sua conta para continuar.', 401);
      const result = await pool.query(
        'SELECT u.id,u.email,u.preferences FROM sessions s JOIN users u ON u.id=s.user_id WHERE s.token_hash=$1 AND s.expires_at>now()',
        [digest(token)],
      );
      if (!result.rows[0]) throw error('Sua sessão expirou. Entre novamente.', 401);
      req.user = result.rows[0];
      next();
    } catch (err) {
      next(err);
    }
  };
  const newSession = async (res: Response, userId: string) => {
    const token = randomBytes(32).toString('hex');
    await pool.query('DELETE FROM sessions WHERE expires_at < now()');
    await pool.query(
      "INSERT INTO sessions(token_hash,user_id,expires_at) VALUES($1,$2,now()+interval '30 days')",
      [digest(token), userId],
    );
    res.cookie('ln_session', token, {
      httpOnly: true,
      secure: process.env.COOKIE_SECURE === 'true',
      sameSite: 'strict',
      path: '/api',
      maxAge: 30 * 86400_000,
    });
  };
  app.get('/api/health', async (_req, res) => {
    try {
      await pool.query('SELECT 1');
      res.json({ ok: true, database: true });
    } catch {
      res
        .status(503)
        .json({
          ok: false,
          database: false,
          error:
            'O banco de dados ainda não está disponível. O modo visitante continua disponível.',
        });
    }
  });
  const authLimit = rateLimit({
    windowMs: 15 * 60_000,
    limit: 20,
    standardHeaders: 'draft-8',
    legacyHeaders: false,
    message: { error: 'Muitas tentativas de acesso. Tente novamente em 15 minutos.' },
  });
  app.post('/api/auth/register', authLimit, smallJson, async (req, res) => {
    const { email, password } = credentialsSchema.parse(req.body);
    const salt = randomBytes(16).toString('hex');
    const key = (await derive(password, salt, 64)) as Buffer;
    const user = { id: randomUUID(), email, preferences: defaultPreferences };
    try {
      await pool.query(
        'INSERT INTO users(id,email,password_hash,preferences) VALUES($1,$2,$3,$4)',
        [user.id, email, `${salt}:${key.toString('hex')}`, JSON.stringify(user.preferences)],
      );
    } catch (err: any) {
      if (err.code === '23505')
        throw error('Não foi possível criar a conta com este e-mail. Tente entrar.', 409);
      throw err;
    }
    await newSession(res, user.id);
    res.status(201).json(user);
  });
  app.post('/api/auth/login', authLimit, smallJson, async (req, res) => {
    const { email, password } = credentialsSchema.parse(req.body);
    const result = await pool.query(
      'SELECT id,email,password_hash,preferences FROM users WHERE email=$1',
      [email],
    );
    const user = result.rows[0];
    const [salt, hash] = (user?.password_hash || `${'0'.repeat(32)}:${'0'.repeat(128)}`).split(':');
    const key = (await derive(password, salt, 64)) as Buffer;
    if (!user || !timingSafeEqual(key, Buffer.from(hash, 'hex')))
      throw error('E-mail ou senha incorretos.', 401);
    await newSession(res, user.id);
    res.json({ id: user.id, email: user.email, preferences: user.preferences });
  });
  app.post('/api/auth/logout', async (req, res) => {
    if (req.cookies.ln_session)
      await pool.query('DELETE FROM sessions WHERE token_hash=$1', [
        digest(req.cookies.ln_session),
      ]);
    res.clearCookie('ln_session', {
      path: '/api',
      sameSite: 'strict',
      secure: process.env.COOKIE_SECURE === 'true',
    });
    res.sendStatus(204);
  });
  app.get('/api/auth/me', requireUser, (req, res) => res.json(req.user));
  app.put('/api/preferences', requireUser, smallJson, async (req, res) => {
    const preferences = preferencesSchema.parse(req.body);
    await pool.query('UPDATE users SET preferences=$1 WHERE id=$2', [
      JSON.stringify(preferences),
      req.user!.id,
    ]);
    res.json(preferences);
  });
  const upload = multer({
    storage: multer.memoryStorage(),
    limits: { fileSize: MAX_FILE_BYTES, files: 1, fields: 0, parts: 1 },
  });
  const importLimit = rateLimit({
    windowMs: 60_000,
    limit: 6,
    standardHeaders: 'draft-8',
    legacyHeaders: false,
    message: { error: 'Limite de seis importações por minuto. Aguarde um pouco.' },
  });
  let inflightImports = 0;
  const importSlots = (_req: Request, res: Response, next: NextFunction) => {
    if (inflightImports >= 2)
      return next(error('O conversor está ocupado. Tente novamente em instantes.', 503));
    inflightImports++;
    let released = false;
    const release = () => {
      if (!released) {
        released = true;
        inflightImports--;
      }
    };
    res.once('finish', release);
    res.once('close', release);
    next();
  };
  app.post('/api/import', importLimit, importSlots, upload.single('file'), async (req, res) => {
    if (!req.file) throw error('Selecione um arquivo EPUB, TXT ou DOCX.');
    try {
      res.json(await convertIsolated(req.file.buffer, req.file.originalname));
    } catch (err: any) {
      throw error(err.message, err.status || 422);
    }
  });
  app.get('/api/books', requireUser, async (req, res) => {
    const page = z.coerce
      .number()
      .int()
      .min(1)
      .max(10000)
      .parse(req.query.page || 1);
    const search = z
      .string()
      .max(200)
      .parse(req.query.search || '');
    const searchPattern = `%${search.replace(/[\\%_]/g, '\\$&')}%`;
    const owner = req.user!.id;
    const summary = await pool.query(
      'SELECT count(*)::int AS count, coalesce(sum(size_bytes),0)::bigint AS bytes FROM books WHERE user_id=$1',
      [owner],
    );
    const filtered = await pool.query(
      'SELECT count(*)::int AS count FROM books WHERE user_id=$1 AND title ILIKE $2',
      [owner, searchPattern],
    );
    const books = await pool.query(
      "SELECT id,title,author,format,size_bytes,progress,created_at,jsonb_array_length(content->'chapters') AS chapters FROM books WHERE user_id=$1 AND title ILIKE $2 ORDER BY created_at DESC,id DESC LIMIT 12 OFFSET $3",
      [owner, searchPattern, (page - 1) * 12],
    );
    res.json({
      books: books.rows,
      page,
      pages: Math.max(1, Math.ceil(filtered.rows[0].count / 12)),
      total: filtered.rows[0].count,
      usage: {
        count: summary.rows[0].count,
        bytes: Number(summary.rows[0].bytes),
        maxBooks: MAX_BOOKS,
        maxBytes: MAX_LIBRARY_BYTES,
      },
    });
  });
  app.post('/api/books', requireUser, json, async (req, res) => {
    const input = z
      .object({ book: bookSchema, progress: positionSchema.nullable().optional() })
      .parse(req.body);
    const { book } = input;
    const ids = new Set<string>();
    let blockCount = 0;
    for (const chapter of book.chapters) {
      if (ids.has(chapter.id)) throw error('Capítulos com identificadores repetidos.');
      ids.add(chapter.id);
      for (const block of chapter.blocks) {
        if (++blockCount > MAX_BOOK_BLOCKS || ids.has(block.id))
          throw error('Estrutura de capítulos inválida.');
        ids.add(block.id);
        block.html = cleanHtml(block.html);
        block.text = load(block.html).text();
      }
    }
    const progress = input.progress || null;
    if (
      progress &&
      !book.chapters
        .find((c) => c.id === progress.chapterId)
        ?.blocks.some((b) => b.id === progress.blockId)
    )
      throw error('Posição de leitura inválida.');
    const content = JSON.stringify(book);
    const bytes = Buffer.byteLength(content);
    if (bytes > MAX_CONVERTED_BYTES) throw error('O conteúdo convertido excede 20 MB.');
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      await client.query('SELECT id FROM users WHERE id=$1 FOR UPDATE', [req.user!.id]);
      const usage = (
        await client.query(
          'SELECT count(*)::int AS count,coalesce(sum(size_bytes),0)::bigint AS bytes FROM books WHERE user_id=$1',
          [req.user!.id],
        )
      ).rows[0];
      if (usage.count >= MAX_BOOKS || Number(usage.bytes) + bytes > MAX_LIBRARY_BYTES)
        throw error(
          'Sua biblioteca atingiu o limite de 50 livros ou 500 MB. Exclua um livro para liberar espaço.',
          409,
        );
      const id = randomUUID();
      book.id = id;
      await client.query(
        'INSERT INTO books(id,user_id,title,author,format,content,size_bytes,progress) VALUES($1,$2,$3,$4,$5,$6,$7,$8)',
        [
          id,
          req.user!.id,
          book.title,
          book.author,
          book.format,
          JSON.stringify(book),
          bytes,
          progress && JSON.stringify(progress),
        ],
      );
      await client.query('COMMIT');
      res.status(201).json({ book, progress, version: 0 });
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    } finally {
      client.release();
    }
  });
  app.get('/api/books/:id', requireUser, async (req, res) => {
    const id = z.uuid().parse(req.params.id);
    const result = await pool.query(
      'SELECT content,progress,progress_version FROM books WHERE id=$1 AND user_id=$2',
      [id, req.user!.id],
    );
    if (!result.rows[0]) throw error('Livro não encontrado.', 404);
    res.json({
      book: result.rows[0].content,
      progress: result.rows[0].progress,
      version: result.rows[0].progress_version,
    });
  });
  app.put('/api/books/:id/progress', requireUser, smallJson, async (req, res) => {
    const id = z.uuid().parse(req.params.id);
    const { progress, version } = z
      .object({ progress: positionSchema, version: z.number().int().min(0) })
      .parse(req.body);
    const result = await pool.query(
      `UPDATE books SET progress=$1,progress_version=progress_version+1,updated_at=now()
      WHERE id=$2 AND user_id=$3 AND progress_version=$4
      AND EXISTS (SELECT 1 FROM jsonb_array_elements(content->'chapters') c, jsonb_array_elements(c->'blocks') b WHERE c->>'id'=$5 AND b->>'id'=$6)
      RETURNING progress_version`,
      [JSON.stringify(progress), id, req.user!.id, version, progress.chapterId, progress.blockId],
    );
    if (!result.rowCount)
      throw error(
        'O progresso mudou em outra sessão ou o livro não está disponível. Reabra o livro para sincronizar.',
        409,
      );
    res.json({ version: result.rows[0].progress_version });
  });
  app.delete('/api/books/:id', requireUser, async (req, res) => {
    await pool.query('DELETE FROM books WHERE id=$1 AND user_id=$2', [
      z.uuid().parse(req.params.id),
      req.user!.id,
    ]);
    res.sendStatus(204);
  });
  app.use('/api', (_req, res) => res.status(404).json({ error: 'Rota não encontrada.' }));
  app.use((err: any, _req: Request, res: Response, _next: NextFunction) => {
    if (err instanceof z.ZodError)
      return void res
        .status(400)
        .json({
          error:
            'Confira os dados enviados. E-mail válido, senha de 10 a 128 caracteres e campos dentro dos limites são necessários.',
        });
    if (err instanceof multer.MulterError)
      return void res
        .status(400)
        .json({
          error:
            err.code === 'LIMIT_FILE_SIZE'
              ? 'O arquivo ultrapassa o limite de 20 MB.'
              : 'Envie apenas um arquivo EPUB, TXT ou DOCX de cada vez.',
        });
    if (
      ['ECONNREFUSED', 'ETIMEDOUT', 'ENOTFOUND', '42P01'].includes(err.code) ||
      /timeout|Connection terminated/i.test(err.message)
    )
      return void res
        .status(503)
        .json({
          error:
            'Contas e biblioteca estão temporariamente indisponíveis. Você ainda pode ler como visitante.',
        });
    const status = err.status || (err.type === 'entity.too.large' ? 413 : 500);
    if (status === 500) console.error('Falha da API:', err.message);
    res
      .status(status)
      .json({
        error:
          status === 500 ? 'Não foi possível concluir a operação. Tente novamente.' : err.message,
      });
  });
  return app;
}
