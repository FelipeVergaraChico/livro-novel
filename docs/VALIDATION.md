# Validação local — LivroNovel

Verificação em 29/10/2026, com Node.js 24, PostgreSQL 17 em Docker e Google Chrome automatizado. Esta evidência corresponde ao ambiente local, sem publicação ou homologação em aparelhos físicos.

## Resultado

| Verificação                                                             | Resultado                                                                                             |
| ----------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------- |
| `npm run check`                                                         | Tipos do frontend e backend aprovados                                                                 |
| `npm test`                                                              | 28 testes aprovados: 19 de conversão/proteção, 2 de entrega pelo processo filho e 7 de API/PostgreSQL |
| `npm run build`                                                         | Build de frontend e backend aprovado                                                                  |
| `npm run test:browser`                                                  | 8 cenários aprovados, incluindo acessibilidade                                                        |
| Biblioteca mobile e retomada entre dispositivos, após ampliar o cenário | Cenário direcionado aprovado em nova execução                                                         |
| `npm run test:production`                                               | HTML, banco e conversor compilado aprovados                                                           |
| `npm audit --omit=dev`                                                  | Nenhuma vulnerabilidade conhecida reportada nas dependências de execução na consulta desta data       |

## Cobertura mobile

| Tela/fluxo                          | 360 px | 390 px | 430 px | 1440 px                          |
| ----------------------------------- | ------ | ------ | ------ | -------------------------------- |
| Página inicial e importação EPUB    | Passou | Passou | Passou | Passou                           |
| Prévia de capítulos                 | Passou | Passou | Passou | Passou                           |
| Leitor, tema, fonte e espaçamento   | Passou | Passou | Passou | Passou                           |
| Recarregar e retomar bloco/capítulo | Passou | Passou | Passou | Passou                           |
| Biblioteca com conta                | Passou | Passou | Passou | Passou no fluxo de sincronização |

As verificações incluem ausência de transbordamento horizontal e capturas de tela. Houve inspeção visual de página inicial, revisão, leitor, painel de preferências e biblioteca. A sincronização foi exercitada entre contextos separados de navegador, de 390 para 1440 px, verificando o identificador do bloco retomado.

## Conteúdo e segurança

- TXT com texto literal, caracteres especiais e UTF-16 com BOM.
- EPUB com ordem dos capítulos, metadados, imagem incorporada, ênfase e ligação de nota interna.
- DOCX com capítulos e negrito.
- Divisão e união de capítulos na interface, sem perda do texto da amostra.
- Arquivo vazio, extensão não suportada, executável disfarçado de TXT e EPUB/DOCX falsos.
- Expansão excessiva de ZIP, declarações XML de entidade, macros e excesso de blocos por capítulo.
- Remoção de scripts, eventos e recursos externos, com sanitização também ao salvar na biblioteca.
- Autorização por proprietário, acesso cruzado negado, cotas de livros e armazenamento, paginação no servidor e total independente dos filtros.
- Cadastro, login, preferências sincronizadas, logout e conflito de versões do progresso.
- Encerramento explícito da leitura temporária e manutenção das preferências.

## Acessibilidade

O axe-core não reportou violações nas verificações executadas com regras WCAG A/AA na página inicial, formulário de conta, prévia e leitor com seus três temas em 390 px. Isso não constitui certificação de acessibilidade nem substitui testes com leitor de tela, teclado virtual e usuários.

## Pendências explícitas

- Teste manual em Android e Safari/iOS, incluindo teclado, orientação, áreas seguras e restauração de abas.
- Livros reais com formatação, tabelas e notas mais variadas que as amostras automatizadas.
- Ensaios de carga e consumo de memória em celulares de menor capacidade.
- Publicação com HTTPS, recuperação/verificação de e-mail e operação de contas para público amplo.
- Exportação PDF e modo offline, conforme escopo de uma versão posterior.

O modo visitante não promete descarte irrecuperável ao fechar a aba: navegadores podem restaurar sua sessão. Consulte o ADR 0001 e as limitações em DEVELOPMENT.md.

## Correção de importação de arquivos maiores

O erro 422 “O arquivo excedeu os recursos disponíveis ou não pôde ser processado” foi reproduzido com um EPUB real de 2.844.753 bytes e minimizado para um TXT sintético de aproximadamente 130 KB. O parser terminava normalmente, mas o processo filho chamava `disconnect()` antes da conclusão do envio de uma resposta grande pelo canal IPC; o pai recebia um encerramento sem mensagem e apresentava o erro genérico.

A correção aguarda o callback de `process.send()` antes de desconectar. Dois testes de regressão, com TXT e DOCX gerando respostas maiores que 256 KB, falharam antes da correção e passaram depois. Os limites de arquivo, processamento e sanitização foram preservados.

Validação adicional: o EPUB real foi convertido duas vezes em desenvolvimento e uma vez pelo worker compilado. Pelo site, a importação retornou HTTP 200, abriu a prévia e o leitor em 390 px, sem erros JavaScript ou transbordamento horizontal. O DOCX informado pelo usuário não foi disponibilizado; a regressão de DOCX foi verificada com documento sintético. O livro real não foi incorporado ao repositório.

## Correção da separação de capítulos EPUB

O mesmo EPUB revelou que arquivos internos não equivalem a capítulos: nove arquivos de conteúdo continham 26 capítulos numerados, além de seções editoriais. O importador agora usa os destinos do sumário NCX ou EPUB 3 para dividir o conteúdo, conserva âncoras vazias e mantém no capítulo anterior a continuação que ocupa o começo do arquivo seguinte. Na ausência de sumário utilizável, usa títulos internos. A ordem de leitura continua seguindo o spine do EPUB.

Três regressões sintéticas falharam antes da correção e passaram depois: NCX, navegação EPUB 3 e títulos sem sumário. Dois testes adicionais verificam destinos de arquivo inteiro e divisão dentro de elementos aninhados sem perda de texto, ênfase ou duplicação de IDs. A suíte completa passou com 33 testes; checagem de tipos e build também passaram.

No EPUB fornecido, foram conferidos os 26 inícios contra os marcadores originais: cada marcador está no primeiro bloco do capítulo correspondente e não aparece dentro de outro capítulo numerado. O capítulo 2 começa em p42 e o capítulo 3 em p62. O leitor passou a indicar a posição como seção, evitando apresentar créditos ou dedicatória como parte da numeração original dos capítulos. Conversões já salvas precisam ser reimportadas; seus dados não são alterados automaticamente.

Os oito testes de navegador passaram, incluindo leitura em 360, 390, 430 e 1440 px. Na importação real pelo site em 390 px, a API retornou HTTP 200 com 40 seções (26 capítulos numerados e seções editoriais); abrir “Capítulo 2” pelo sumário mostrou p42 sem incluir p62. Não houve erro JavaScript ou transbordamento horizontal nesse fluxo.

## Retomada do visitante após voltar ao início

O fluxo de sair do leitor para a página inicial e clicar em “Continuar” foi reproduzido em 390 px com EPUB sintético longo. O teste falhou antes da correção: retornou um bloco diferente daquele em que a leitura havia parado. A função `home()` rolava a janela para o topo antes da desmontagem do leitor, cujo registro final de progresso sobrescrevia a posição correta. A navegação agora aguarda a desmontagem antes de rolar a página inicial.

O teste de regressão passou verificando o mesmo identificador de bloco e o deslocamento dentro dele, com tolerância de 3 px. Isso é retomada local da sessão temporária, sem exigir login; a conta permite salvar na biblioteca e sincronizar entre dispositivos.

Nesta correção, passaram os três cenários direcionados de navegador (retomada do visitante, recarga em 390 px e sincronização entre dispositivos com conta) e a checagem de tipos.

## Painel de preferências na metade inferior do celular

Até 720 px de largura, as preferências ocupam os 50dvh inferiores, com cabeçalho fixo, controles roláveis e margem para a área segura. O texto permanece visível acima, sem sobreposição escurecida. O sumário mantém seu posicionamento anterior.

Verificação no Chromium em 360×800, 390×844, 430×932 e 667×375 confirmou altura de meia tela e ausência de transbordamento horizontal. Foram exercitados tamanho, fonte, espaçamento, rolagem dos controles e fechamento; em 1440 px o painel lateral manteve 350 px de largura. Captura de 390 px inspecionada visualmente em `work/screenshots/settings-bottom-sheet-390.png`. Checagem de tipos aprovada. Testes em dispositivos físicos continuam pendentes.

## Confirmações integradas ao visual do LivroNovel

Os três usos de `window.confirm` foram substituídos por um componente compartilhado com `<dialog>` estilizado: exclusão da biblioteca, encerramento da leitura temporária e importação de outro livro. O diálogo tem título e descrição acessíveis, foco inicial em Cancelar, fechamento por Escape e botões com ação explícita. No celular, os botões ficam empilhados e têm altura mínima de 48 px.

Passaram três cenários direcionados no navegador: encerramento temporário, troca de livro com cancelamento/Escape/confirmação e biblioteca com cancelamento seguido de exclusão confirmada. A troca cancelada preservou o conteúdo anterior e permitiu selecionar o mesmo arquivo novamente. Capturas de 390 e 1440 px foram inspecionadas em `work/screenshots/confirmation-mobile.png` e `work/screenshots/confirmation-desktop.png`. Checagem de tipos aprovada.

## DOCX extenso com muita formatação

O arquivo LT.docx fornecido pelo usuário (458.914 bytes) reproduziu duas vezes o erro genérico 422. Seu `word/document.xml` ocupa 7.997.263 bytes e contém 14.520 parágrafos. Uma execução diagnóstica confirmou encerramento por SIGABRT com `JavaScript heap out of memory` no limite de 256 MB. Mesmo retirando a construção redundante da árvore XML no ensaio isolado, o conversor Mammoth esgotou esse limite. Com 512 MB, o worker concluiu em aproximadamente 7 segundos.

O limite de heap por worker passou a 512 MB. Permanecem duas conversões simultâneas, prazo de 20 segundos, limites de entrada/saída, descompactação e sanitização. O orçamento de memória e o consumo adicional de buffers estão documentados em DEVELOPMENT.md; esta mudança não representa ensaio de carga do servidor.

Um DOCX sintético com 28 capítulos e 14.560 parágrafos formatados reproduziu a falha antes da mudança e passou depois, verificando todos os capítulos, a contagem de blocos e o último parágrafo. Os três testes do conversor e o build passaram. O arquivo real converteu duas vezes após a correção, com 28 capítulos, 13.649 blocos e 2.399.486 bytes de saída. Pelo site, retornou HTTP 200 e abriu no leitor em 390 px, sem erro JavaScript ou transbordamento horizontal. O arquivo original não foi alterado nem incorporado ao projeto.
