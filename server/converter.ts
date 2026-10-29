import { fork } from 'node:child_process';
import type { Book } from '../shared/types.js';
let active = 0;
export function convertIsolated(buffer: Buffer, filename: string): Promise<Book> {
  if (active >= 2)
    return Promise.reject(
      Object.assign(new Error('O conversor está ocupado. Tente novamente em instantes.'), {
        status: 503,
      }),
    );
  active++;
  return new Promise((resolve, reject) => {
    const source = import.meta.url.endsWith('.ts');
    const worker = fork(new URL(`./import-worker.${source ? 'ts' : 'js'}`, import.meta.url), {
      // DOCX formatting can expand into a large object graph even for small ZIPs.
      execArgv: ['--max-old-space-size=512', ...(source ? ['--import', 'tsx'] : [])],
      env: { NODE_ENV: process.env.NODE_ENV, PATH: process.env.PATH },
      stdio: ['ignore', 'ignore', 'ignore', 'ipc'],
    });
    let settled = false;
    const finish = (error?: Error, book?: Book) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      active--;
      worker.kill();
      error ? reject(error) : resolve(book!);
    };
    const timer = setTimeout(
      () => finish(new Error('A conversão excedeu 20 segundos. O processamento foi interrompido.')),
      20_000,
    );
    worker.on('message', (message: { error?: string; book?: Book }) =>
      finish(message.error ? new Error(message.error) : undefined, message.book),
    );
    worker.on('error', () => finish(new Error('Não foi possível iniciar a conversão.')));
    worker.on('exit', () => {
      if (!settled)
        finish(new Error('O arquivo excedeu os recursos disponíveis ou não pôde ser processado.'));
    });
    worker.send({ data: buffer.toString('base64'), filename }, (error) => {
      if (error) finish(error);
    });
  });
}
