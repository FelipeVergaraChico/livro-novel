# Separar a leitura temporária da biblioteca permanente

O modo visitante precisa sobreviver a recarregamentos sem criar uma biblioteca permanente, e livros com imagens podem ultrapassar o espaço disponível no sessionStorage. Por isso, o livro fica no IndexedDB, com uma referência e a posição de leitura no sessionStorage da aba; preferências ficam separadas no localStorage e, após login, podem ser sincronizadas com a conta.

O evento de fechamento não permite distinguir com confiabilidade uma aba encerrada, um recarregamento ou uma restauração de sessão. “Encerrar leitura” faz o descarte explícito, enquanto registros com mais de 24 horas sem atualização são limpos na próxima abertura; restaurar abas pelo navegador pode restaurar a referência temporária. Essa limitação deve permanecer documentada, sem promessa de apagamento garantido ao fechar a aba.
