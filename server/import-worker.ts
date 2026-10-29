import { importBook } from './importer.js';
import type { Book } from '../shared/types.js';
process.once('message', async (message: { data: string; filename: string }) => {
  let response: { book: Book } | { error: string };
  try {
    response = {
      book: await importBook(Buffer.from(message.data, 'base64'), message.filename),
    };
  } catch (error) {
    response = {
      error: error instanceof Error ? error.message : 'Falha ao converter o arquivo.',
    };
  }
  // Large results are buffered by IPC. Closing before this callback can truncate
  // the message even though conversion succeeded and the worker exits with code 0.
  process.send?.(response, (error: Error | null) => {
    if (error) process.exitCode = 1;
    if (process.connected) process.disconnect();
  });
});
