# LivroNovel

**Seu livro em formato web novel.**

Converta livros EPUB, TXT e DOCX em uma experiência de leitura vertical, organizada por capítulos, com foco no celular. O LivroNovel preserva o texto original, sem reescrever ou resumir a obra.

Projeto gratuito e sem fins lucrativos, sem assinaturas, cobranças ou recursos pagos.

## Estado do projeto

Primeira versão funcional, validada localmente e ainda não publicada. Os recursos abaixo estão implementados; as limitações e etapas futuras estão documentadas ao final.

## Funcionalidades

- **Importação de EPUB, TXT e DOCX:** prévia para renomear, dividir e unir capítulos antes de começar a leitura.
- **Capítulos do EPUB:** divisão pelos destinos do sumário NCX ou EPUB 3, incluindo capítulos que atravessam arquivos internos. Títulos internos servem como alternativa quando não há sumário utilizável.
- **Leitura vertical:** uma página por capítulo, navegação pelo sumário e retomada do trecho dentro do capítulo.
- **Conta opcional:** comece a ler como visitante ou use uma conta para manter sua biblioteca privada e sincronizar o progresso entre dispositivos.
- **Preferências salvas:** temas claro, escuro e sépia, fonte com ou sem serifa, tamanho e espaçamento ajustáveis.
- **Interface mobile first:** configurações na metade inferior da tela para acompanhar os ajustes no texto, confirmações integradas ao visual e controles adaptados ao toque.
- **Conteúdo adaptado:** suporte a imagens, ênfases e notas internas, com simplificação de estilos e remoção de conteúdo ativo ou recursos externos não permitidos.

Experimente com o [livro curto de exemplo](examples/primeira-leitura.txt).

## Executar localmente

### Requisitos

- Node.js 22.12 ou superior; desenvolvimento validado com Node.js 24.
- npm.
- Docker Compose, ou uma instância PostgreSQL disponível.

### Instalação

```sh
npm ci
cp .env.example .env
```

Edite o `.env` e preencha `DATABASE_URL`: `usuario` e `SENHA` são placeholders. Para usar o banco do `compose.yaml`, o usuário e o banco são `livronovel`; a senha deve corresponder a `POSTGRES_PASSWORD` do Compose. O Compose fornece uma senha padrão exclusivamente para desenvolvimento local. Se você definir outra senha, mantenha as duas configurações alinhadas.

Depois, inicie o banco, aplique o esquema e execute a aplicação:

```sh
docker compose up -d db
npm run db:migrate
npm run dev
```

Abra **http://localhost:5173**. A API usa a porta **3001**; o PostgreSQL local usa **54338**, acessível apenas pelo loopback.

O modo visitante precisa da API para converter arquivos, mas funciona sem PostgreSQL. Contas, biblioteca e sincronização exigem o banco e a migração.

O `.env.example` pode ser versionado com valores de exemplo. O `.env` contém a configuração local e está ignorado pelo Git; não publique credenciais reais.

Para acessar pelo celular na mesma rede, consulte [Desenvolvimento — experimentar no celular físico](docs/DEVELOPMENT.md#experimentar-no-celular-físico).

## Como os dados são guardados

| Modo         | Armazenamento e retomada                                                                                                                                                                                      |
| ------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Visitante    | Um livro temporário por sessão, guardado no IndexedDB do navegador. A sessão da aba e a posição mais recente usam `sessionStorage`. É possível voltar ao início ou recarregar a página e continuar a leitura. |
| Com conta    | Livros salvos na biblioteca privada e progresso sincronizado pelo servidor. Limite de 50 livros e 500 MB por conta.                                                                                           |
| Preferências | Guardadas no `localStorage`; com conta, também sincronizadas entre dispositivos.                                                                                                                              |

**Encerrar leitura temporária** remove explicitamente o livro e o progresso locais. Fechar a aba não garante exclusão imediata: navegadores podem restaurar a sessão. Registros sem atualização há mais de 24 horas são removidos na próxima abertura do aplicativo. Veja o [ADR sobre leitura temporária](docs/adr/0001-leitura-temporaria-por-aba.md).

Os arquivos enviados para conversão não são gravados em disco pelo aplicativo nem associados a visitantes no servidor. Ao salvar na conta, o conteúdo convertido passa a integrar a biblioteca privada.

## Limites de importação

| Recurso                | Limite atual                                               |
| ---------------------- | ---------------------------------------------------------- |
| Arquivo enviado        | 20 MB                                                      |
| Conteúdo convertido    | 20 MB                                                      |
| Blocos de conteúdo     | 30.000 por livro e 5.000 por capítulo                      |
| Pacote descompactado   | 80 MB no total, 12 MB por arquivo interno e 2.500 entradas |
| Conversões simultâneas | 2 por processo da API                                      |
| Tempo de conversão     | 20 segundos                                                |
| Heap do conversor      | 512 MB por processo filho                                  |

As cotas controlam o consumo de recursos e não representam planos pagos. O consumo total do servidor inclui buffers e outros processos, além do heap dos conversores.

A importação verifica a estrutura real dos formatos, limita a descompactação e sanitiza o conteúdo. Arquivos com macros, objetos incorporados ou EPUB com criptografia/DRM são recusados. Imagens externas não são carregadas. O processo filho tem limites de recursos, mas não é um sandbox completo do sistema operacional; não há antivírus integrado.

## Tecnologias

- **Frontend:** Vue 3, TypeScript e Vite.
- **Backend:** Node.js, TypeScript e Express.
- **Banco de dados:** PostgreSQL.
- **Conversão:** Mammoth para DOCX, leitura de arquivos ZIP e processamento de XML/HTML para EPUB.
- **Testes:** Vitest, Supertest, Playwright e axe-core.

## Verificação

```sh
npm run check
npm test
npm run build
npm run test:production
```

Os testes de API e o smoke de produção precisam do PostgreSQL configurado. Use um banco de desenvolvimento. O smoke verifica o build na porta 3002 e encerra o servidor de teste ao terminar.

Com `npm run dev` em outro terminal:

```sh
npm run test:browser
```

Os testes de navegador usam `/usr/bin/google-chrome`; configure `CHROME_PATH` para outro caminho. Resultados e capturas ficam em `work/`, ignorado pelo Git.

Consulte [Validação local](docs/VALIDATION.md) para evidências, regressões corrigidas e limites da cobertura. As verificações em larguras móveis do Chrome não substituem testes em celulares físicos ou Safari/iOS.

## Organização

```text
src/         Interface, leitor e armazenamento temporário
server/      API, conversão, autenticação e acesso ao banco
shared/      Tipos e limites compartilhados
public/      Favicon e ícones
examples/    Livro de exemplo para importação
tests/       Testes de importação, conversão, API e navegador
docs/        Desenvolvimento, validação e decisões arquiteturais
```

## Limitações e próximas etapas

- Exportação em PDF, modo offline e marcadores manuais ainda não estão implementados.
- Recuperação e verificação de e-mail precisam ser implementadas antes de disponibilizar contas a um público amplo.
- A retomada usa um bloco e uma fração de sua altura; não promete uma palavra exata.
- Formatações complexas de DOCX podem ser simplificadas; livros com estruturas variadas ainda precisam de mais validação.
- TXT aceita UTF-8 ou UTF-16 com BOM. Imagens SVG não são suportadas na importação.
- Permanecem pendentes testes em Android e Safari/iOS físicos e ensaios de carga.
- A publicação exige configuração de produção, HTTPS e `COOKIE_SECURE=true`. Veja [Build de produção](docs/DEVELOPMENT.md#build-de-produção).

Quando a exportação estiver disponível, a intenção é permitir converter e baixar sem salvar na biblioteca nem consumir sua cota permanente.
