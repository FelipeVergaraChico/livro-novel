# Desenvolvimento do LivroNovel

O projeto é gratuito e sem fins lucrativos. Não há planos pagos, cobranças ou integração de pagamentos.

## Requisitos

- Node.js 22.12+ (validado localmente com Node.js 24).
- npm.
- Docker Compose para o PostgreSQL local, ou uma instância PostgreSQL configurada em `DATABASE_URL`.

## Iniciar

```sh
npm ci
cp .env.example .env
docker compose up -d db
npm run db:migrate
npm run dev
```

Abra `http://localhost:5173`. O frontend usa a porta 5173, a API usa 3001 e o PostgreSQL fica exposto somente no loopback, na porta 54338. A senha padrão do Compose é exclusivamente de desenvolvimento.

O modo visitante funciona sem PostgreSQL. Contas, biblioteca e sincronização dependem do banco e da migração. A conversão depende da API, inclusive no modo visitante. Arquivos enviados não são gravados em disco nem ficam associados a visitantes no servidor.

## Experimentar no celular físico

No computador e no celular conectados à mesma rede de confiança, configure `APP_ORIGIN` no `.env` para incluir a origem do computador nessa rede, por exemplo `http://192.168.1.10:5173`, usando o IP real da máquina. Pare o servidor de desenvolvimento anterior e execute `npm run dev:lan`; no celular, abra essa mesma origem. Esse modo expõe somente o servidor de desenvolvimento à rede e não foi ativado automaticamente. Para publicação, use o build e HTTPS.

## Testes

```sh
npm run check
npm test
npm run build
npm run test:production
```

Os testes de API usam o PostgreSQL configurado, criam contas com identificadores únicos e removem suas próprias contas ao terminar. Use um banco de desenvolvimento.

O smoke de produção inicia o build na porta 3002, verifica HTML, PostgreSQL e conversão em processo filho e encerra esse servidor de teste ao terminar. A porta precisa estar livre.

Com `npm run dev` rodando em outro terminal:

```sh
npm run test:browser
```

Os testes de navegador usam o Google Chrome em `/usr/bin/google-chrome`. Configure `CHROME_PATH` se o executável estiver em outro caminho. A suíte respeita o limite real de seis importações por minuto e leva cerca de um minuto ou mais. Capturas, traces de falhas e resultados temporários ficam em `work/`, ignorado pelo Git.

## Build de produção

```sh
npm run build
npm run db:migrate
npm start
```

A API serve também `dist/web`. Configure `APP_ORIGIN` com a origem exata usada pelo navegador, incluindo protocolo e porta quando houver. Em produção, use HTTPS e `COOKIE_SECURE=true`; a API escuta em `127.0.0.1` para uso atrás de um proxy. A publicação não faz parte desta entrega local.

## Organização

- `src/App.vue`: navegação, importação, autenticação, biblioteca e coordenação de persistência.
- `src/components/ReaderView.vue`: leitura, sumário, preferências e posição dentro do capítulo.
- `src/components/ImportReview.vue`: prévia, renomeação, divisão e união dos capítulos.
- `src/storage.ts`: leitura temporária em IndexedDB, referência e posição por aba em sessionStorage, preferências locais.
- `server/importer.ts`: reconhecimento dos formatos, extração limitada e sanitização.
- `server/converter.ts`: limite de concorrência e processamento em processo filho com prazo e limite de heap.
- `server/app.ts`: rotas, sessões, cotas e autorização por proprietário.
- `server/schema.sql`: esquema PostgreSQL.
- `shared/types.ts`: contratos de livro, capítulos, blocos, progresso e preferências.

## Limitações conhecidas

- Fechar uma aba normalmente perde sua referência de sessão. Entretanto, navegadores podem restaurar `sessionStorage` ao restaurar abas/sessões. Não se promete apagamento garantido no fechamento. “Encerrar leitura” apaga explicitamente o registro local; registros com mais de 24 horas sem atualização são removidos na próxima abertura do aplicativo. Ver ADR 0001.
- A posição usa um bloco de conteúdo e uma fração de sua altura. Retoma o trecho, não uma palavra exata. Fontes e imagens são aguardadas antes da restauração.
- EPUBs com criptografia/DRM, macros, objetos incorporados e imagens SVG não são suportados. Imagens externas não são carregadas. Links de notas internas são preservados; estilos complexos de DOCX podem ser simplificados.
- TXT aceito em UTF-8 ou UTF-16 com BOM. Arquivos binários renomeados são recusados; texto que se parece com código é exibido como texto, sem execução.
- O conversor tem limites de recursos, mas um processo filho não constitui um sandbox completo do sistema operacional. Não há antivírus integrado nem alegação de ausência total de malware. Há validação de formato, sanitização e isolamento parcial com limite de heap/tempo.
- Além dos 20 MB de entrada, o conteúdo convertido pode ocupar no máximo 20 MB, com até 30.000 blocos no livro e 5.000 por capítulo. A descompactação permite até 80 MB no total, 12 MB por entrada e 2.500 entradas. Há duas conversões simultâneas, prazo de 20 segundos por conversão e heap de 512 MB por processo (até 1 GB de heap nas duas conversões; o consumo total também inclui buffers e o servidor). Livros que excedem esses limites são recusados com mensagem, sem truncamento silencioso.
- Recuperação de senha por e-mail, verificação de e-mail, exportação em PDF e modo offline ainda não estão implementados. Os dois primeiros precisam ser tratados antes de oferecer contas a um público amplo.
- Verificações em viewports de Chrome não substituem uso em aparelhos físicos e Safari/iOS.
