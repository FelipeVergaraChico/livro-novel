import { existsSync } from 'node:fs';
import path from 'node:path';
import express from 'express';
import { createApp } from './app.js';
const app = createApp();
const web = path.resolve('dist/web');
if (existsSync(web)) app.use(express.static(web));
const port = Number(process.env.PORT || 3001);
app.listen(port, '127.0.0.1', () => console.log(`LivroNovel API em http://127.0.0.1:${port}`));
