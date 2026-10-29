import pg from 'pg';
import { existsSync } from 'node:fs';
if (existsSync('.env')) process.loadEnvFile('.env');
export const pool = new pg.Pool({
  connectionString:
    process.env.DATABASE_URL ||
    'postgresql://livronovel:livronovel_local@localhost:54338/livronovel',
  connectionTimeoutMillis: 3000,
  max: 10,
});
pool.on('error', (error) => console.error('Conexão PostgreSQL:', error.message));
