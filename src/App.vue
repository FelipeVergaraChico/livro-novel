<script setup lang="ts">
import { ref, computed, onMounted, watch, nextTick } from 'vue';
import ConfirmDialog from './components/ConfirmDialog.vue';
const confirmation = ref<InstanceType<typeof ConfirmDialog>>();
import {
  BookOpen,
  ArrowUpRight,
  ArrowRight,
  Upload,
  FileText,
  Library,
  X,
  Check,
  Plus,
  Search,
  Trash2,
  LogOut,
  LoaderCircle,
  ShieldCheck,
  Bookmark,
  ChevronRight,
} from 'lucide-vue-next';
import ImportReview from './components/ImportReview.vue';
import ReaderView from './components/ReaderView.vue';
import { api, ApiError } from './api';
import {
  loadReading,
  storeReading,
  clearReading,
  stagePosition,
  readPreferences,
  writePreferences,
  type Reading,
} from './storage';
import { MAX_FILE_BYTES, type Book, type Preferences, type Position } from '../shared/types';

type User = { id: string; email: string; preferences: Preferences };
type LibraryResult = {
  books: {
    id: string;
    title: string;
    author: string;
    format: string;
    chapters: number;
    progress: Position | null;
  }[];
  page: number;
  pages: number;
  total: number;
  usage: { count: number; bytes: number; maxBooks: number; maxBytes: number };
};
const view = ref<'home' | 'review' | 'reader' | 'library'>('home');
const user = ref<User | null>(null);
const reading = ref<Reading | null>(null);
const imported = ref<Book | null>(null);
const preferences = ref(readPreferences());
const busy = ref(false);
const errorMessage = ref('');
const notice = ref('');
const fileInput = ref<HTMLInputElement>();
const dragging = ref(false);
const syncStatus = ref('Progresso salvo');
const authDialog = ref<HTMLDialogElement>();
const authMode = ref<'login' | 'register'>('register');
const email = ref('');
const password = ref('');
const authError = ref('');
const authBusy = ref(false);
const saveAfterAuth = ref(false);
const library = ref<LibraryResult | null>(null);
const libraryPage = ref(1);
const search = ref('');
const libraryLoading = ref(false);
const userName = computed(() => user.value?.email.split('@')[0]);
const formTitle = computed(() =>
  authMode.value === 'register' ? 'Um lugar para suas histórias.' : 'Bom ter você de volta.',
);
let progressTimer: ReturnType<typeof setTimeout> | undefined,
  preferenceTimer: ReturnType<typeof setTimeout> | undefined;
let pendingPosition: Position | null = null;
let savingProgress: Promise<void> | null = null;
let progressConflict = false;
let libraryRequest = 0;

function showError(error: unknown) {
  errorMessage.value =
    error instanceof Error ? error.message : 'Não foi possível concluir esta ação.';
}
async function persist() {
  if (!reading.value) return;
  try {
    await storeReading(JSON.parse(JSON.stringify(reading.value)));
  } catch {
    notice.value =
      'O navegador não permitiu guardar esta sessão. Evite recarregar a página antes de salvar o livro na conta.';
  }
}
async function flushProgress() {
  clearTimeout(progressTimer);
  if (savingProgress) {
    await savingProgress;
    if (pendingPosition && !progressConflict) await flushProgress();
    return;
  }
  const record = reading.value;
  if (!record || !pendingPosition || progressConflict) return;
  const position = pendingPosition;
  pendingPosition = null;
  await persist();
  if (!record.saved || !user.value) return;
  syncStatus.value = 'Salvando progresso…';
  savingProgress = (async () => {
    try {
      const result = await api<{ version: number }>(`/books/${record.book.id}/progress`, {
        method: 'PUT',
        body: JSON.stringify({ progress: position, version: record.version }),
      });
      record.version = result.version;
      syncStatus.value = 'Progresso sincronizado';
      await persist();
    } catch (err) {
      if (err instanceof ApiError && err.status === 409) {
        progressConflict = true;
        syncStatus.value = 'Conflito de progresso: reabra pela biblioteca';
        showError(err);
      } else {
        pendingPosition ||= position;
        syncStatus.value = 'Salvo neste dispositivo · sincronização pendente';
        showError(err);
      }
    } finally {
      savingProgress = null;
    }
  })();
  await savingProgress;
}
function updateProgress(position: Position) {
  if (!reading.value) return;
  reading.value.position = position;
  pendingPosition = position;
  try {
    stagePosition(reading.value.book.id, position);
  } catch {
    /* IndexedDB persistence remains available. */
  }
  if (view.value === 'reader')
    history.replaceState(null, '', `#ler/${reading.value.book.id}/${position.chapterId}`);
  clearTimeout(progressTimer);
  progressTimer = setTimeout(() => void flushProgress(), 800);
}
async function home() {
  await flushProgress();
  view.value = 'home';
  history.replaceState(null, '', '#inicio');
  // Unmount the reader while its last visible block is still at the reading position.
  // Its final progress report must happen before resetting the home page scroll.
  await nextTick();
  window.scrollTo(0, 0);
}
async function beginReading(book: Book) {
  busy.value = true;
  errorMessage.value = '';
  try {
    reading.value = {
      book,
      position: null,
      saved: false,
      owner: null,
      version: 0,
      updatedAt: Date.now(),
    };
    progressConflict = false;
    pendingPosition = null;
    if (user.value) await saveBook();
    await persist();
    view.value = 'reader';
    imported.value = null;
    window.scrollTo(0, 0);
  } catch (err) {
    showError(err);
  } finally {
    busy.value = false;
  }
}
async function saveBook() {
  if (!reading.value || reading.value.saved) return;
  if (!user.value) {
    openAuth(true);
    return;
  }
  const result = await api<{ book: Book; progress: Position | null; version: number }>('/books', {
    method: 'POST',
    body: JSON.stringify({ book: reading.value.book, progress: reading.value.position }),
  });
  reading.value = {
    book: result.book,
    position: result.progress,
    saved: true,
    owner: user.value.id,
    version: result.version,
    updatedAt: Date.now(),
  };
  progressConflict = false;
  syncStatus.value = 'Livro salvo na sua biblioteca';
  await persist();
  notice.value = 'Livro e posição de leitura salvos na sua biblioteca.';
}
async function requestSave() {
  if (busy.value) return;
  busy.value = true;
  try {
    await flushProgress();
    await saveBook();
  } catch (err) {
    showError(err);
  } finally {
    busy.value = false;
  }
}
async function endReading() {
  if (
    !(await confirmation.value?.ask({
      title: 'Encerrar esta leitura?',
      message:
        'O livro temporário e seu progresso serão removidos deste dispositivo. Para ler novamente, você precisará importar o arquivo.',
      action: 'Encerrar leitura',
    }))
  )
    return;
  await clearReading();
  reading.value = null;
  pendingPosition = null;
  view.value = 'home';
  history.replaceState(null, '', '#inicio');
  window.scrollTo(0, 0);
}
function chooseFile() {
  if (!busy.value) fileInput.value?.click();
}
async function importFile(file?: File) {
  if (!file || busy.value) return;
  errorMessage.value = '';
  notice.value = '';
  if (file.size > MAX_FILE_BYTES || !file.size) {
    errorMessage.value = 'Escolha um arquivo não vazio de até 20 MB.';
    return;
  }
  if (!/\.(epub|txt|docx)$/i.test(file.name)) {
    errorMessage.value = 'Escolha um livro em EPUB, TXT ou DOCX.';
    return;
  }
  if (
    reading.value &&
    !reading.value.saved &&
    !(await confirmation.value?.ask({
      title: 'Trocar de livro?',
      message:
        'Ao começar a nova leitura, o livro temporário atual e seu progresso serão substituídos. Você pode cancelar e salvar a leitura atual em uma conta gratuita antes de continuar.',
      action: 'Importar novo livro',
    }))
  ) {
    if (fileInput.value) fileInput.value.value = '';
    return;
  }
  busy.value = true;
  try {
    await flushProgress();
    const body = new FormData();
    body.append('file', file);
    imported.value = await api<Book>('/import', { method: 'POST', body });
    view.value = 'review';
    window.scrollTo(0, 0);
  } catch (err) {
    showError(err);
  } finally {
    busy.value = false;
    if (fileInput.value) fileInput.value.value = '';
  }
}
function dropped(event: DragEvent) {
  dragging.value = false;
  if (event.dataTransfer?.files.length !== 1) {
    errorMessage.value = 'Importe um livro por vez.';
    return;
  }
  void importFile(event.dataTransfer.files[0]);
}
function openAuth(save = false) {
  saveAfterAuth.value = save;
  authError.value = '';
  authDialog.value?.showModal();
}
async function authenticate() {
  authBusy.value = true;
  authError.value = '';
  try {
    user.value = await api<User>(`/auth/${authMode.value}`, {
      method: 'POST',
      body: JSON.stringify({ email: email.value, password: password.value }),
    });
    password.value = '';
    if (authMode.value === 'login')
      preferences.value = { ...preferences.value, ...user.value.preferences };
    else await api('/preferences', { method: 'PUT', body: JSON.stringify(preferences.value) });
    writePreferences(preferences.value);
    authDialog.value?.close();
    if (saveAfterAuth.value && reading.value && !reading.value.saved) await requestSave();
    else if (reading.value && !reading.value.saved)
      notice.value =
        'Você entrou. Sua leitura ainda é temporária; use “Salvar na biblioteca” para guardá-la.';
    else await showLibrary();
  } catch (err) {
    authError.value = err instanceof Error ? err.message : 'Falha ao entrar.';
  } finally {
    authBusy.value = false;
  }
}
async function logout() {
  try {
    await flushProgress();
    await api('/auth/logout', { method: 'POST' });
    user.value = null;
    library.value = null;
    if (reading.value?.saved) {
      reading.value = null;
      pendingPosition = null;
      await clearReading();
    }
    await home();
  } catch (err) {
    showError(err);
  }
}
async function fetchLibrary() {
  const request = ++libraryRequest;
  libraryLoading.value = true;
  try {
    const result = await api<LibraryResult>(
      `/books?page=${libraryPage.value}&search=${encodeURIComponent(search.value)}`,
    );
    if (request === libraryRequest) library.value = result;
  } catch (err) {
    showError(err);
  } finally {
    if (request === libraryRequest) libraryLoading.value = false;
  }
}
async function showLibrary() {
  if (!user.value) {
    openAuth();
    return;
  }
  await flushProgress();
  view.value = 'library';
  history.replaceState(null, '', '#biblioteca');
  window.scrollTo(0, 0);
  await fetchLibrary();
}
async function openBook(id: string) {
  busy.value = true;
  try {
    await flushProgress();
    const result = await api<{ book: Book; progress: Position | null; version: number }>(
      `/books/${id}`,
    );
    reading.value = {
      book: result.book,
      position: result.progress,
      saved: true,
      owner: user.value!.id,
      version: result.version,
      updatedAt: Date.now(),
    };
    pendingPosition = null;
    progressConflict = false;
    syncStatus.value = 'Progresso sincronizado';
    await persist();
    view.value = 'reader';
  } catch (err) {
    showError(err);
  } finally {
    busy.value = false;
  }
}
async function deleteBook(id: string, title: string) {
  if (
    !(await confirmation.value?.ask({
      title: 'Excluir este livro?',
      message: `“${title}” será removido da sua biblioteca junto com o progresso de leitura. Essa ação não pode ser desfeita.`,
      action: 'Excluir livro',
    }))
  )
    return;
  try {
    await api(`/books/${id}`, { method: 'DELETE' });
    if (reading.value?.book.id === id) {
      reading.value = null;
      pendingPosition = null;
      await clearReading();
    }
    await fetchLibrary();
    if (!library.value?.books.length && libraryPage.value > 1) {
      libraryPage.value--;
      await fetchLibrary();
    }
  } catch (err) {
    showError(err);
  }
}
function changePreferences(value: Preferences) {
  preferences.value = value;
  try {
    writePreferences(value);
  } catch {
    notice.value = 'Seu navegador não permitiu salvar as preferências.';
  }
  clearTimeout(preferenceTimer);
  if (user.value)
    preferenceTimer = setTimeout(async () => {
      try {
        await api('/preferences', { method: 'PUT', body: JSON.stringify(value) });
      } catch (err) {
        showError(err);
      }
    }, 500);
}
watch(
  () => preferences.value.theme,
  (value) => (document.documentElement.dataset.theme = value),
  { immediate: true },
);
onMounted(async () => {
  try {
    user.value = await api<User>('/auth/me');
    preferences.value = { ...preferences.value, ...user.value.preferences };
    writePreferences(preferences.value);
  } catch (err) {
    if (!(err instanceof ApiError && err.status === 401))
      notice.value = 'Contas indisponíveis no momento. Você pode usar o modo visitante.';
  }
  try {
    const previous = await loadReading();
    if (previous && (!previous.saved || previous.owner === user.value?.id)) {
      reading.value = previous;
      if (previous.saved) {
        const remote = await api<{ book: Book; progress: Position | null; version: number }>(
          `/books/${previous.book.id}`,
        );
        const position =
          previous.version === remote.version
            ? previous.position || remote.progress
            : remote.progress;
        reading.value = { ...previous, book: remote.book, position, version: remote.version };
        if (position && JSON.stringify(position) !== JSON.stringify(remote.progress)) {
          pendingPosition = position;
          void flushProgress();
        }
      }
      if (location.hash.startsWith('#ler/')) {
        view.value = 'reader';
        await nextTick();
      }
    } else if (previous) await clearReading();
    if (location.hash === '#biblioteca' && user.value) await showLibrary();
  } catch {
    notice.value =
      'Não foi possível restaurar a leitura anterior. Importe o livro novamente ou abra sua biblioteca.';
  }
  window.addEventListener('online', () => void flushProgress());
  document.addEventListener('visibilitychange', () => {
    if (document.hidden) void flushProgress();
  });
});
</script>

<template>
  <a class="skip-link" href="#main">Pular para o conteúdo</a>
  <input
    ref="fileInput"
    class="sr-only"
    type="file"
    accept=".epub,.txt,.docx"
    aria-label="Selecionar livro"
    @change="importFile(($event.target as HTMLInputElement).files?.[0])"
  />
  <header v-if="view !== 'reader'" class="site-header">
    <button class="wordmark" aria-label="LivroNovel — início" @click="home">
      <span class="logo-mark"><BookOpen :size="22" :stroke-width="1.6" /></span>Livro<span
        >Novel</span
      ><span class="wordmark-dot">.</span>
    </button>
    <nav>
      <button class="nav-link" @click="showLibrary"><Library :size="17" /> Minha biblioteca</button
      ><template v-if="user"
        ><span class="account-name">{{ userName }}</span
        ><button class="icon-button" aria-label="Sair da conta" @click="logout">
          <LogOut :size="19" /></button></template
      ><button
        v-else
        class="secondary small-button"
        @click="
          authMode = 'login';
          openAuth();
        "
      >
        Entrar <ArrowUpRight :size="16" />
      </button>
    </nav>
  </header>
  <div v-if="errorMessage" class="toast error-toast" role="alert">
    <span>{{ errorMessage }}</span
    ><button class="icon-button" aria-label="Fechar mensagem de erro" @click="errorMessage = ''">
      <X :size="18" />
    </button>
  </div>
  <div v-if="notice" class="toast notice-toast" role="status">
    <Check :size="18" /><span>{{ notice }}</span
    ><button class="icon-button" aria-label="Fechar aviso" @click="notice = ''">
      <X :size="18" />
    </button>
  </div>

  <main v-if="view === 'home'" id="main" class="home page-shell">
    <section class="hero">
      <div class="hero-copy">
        <p class="eyebrow"><span class="little-line"></span> UMA NOVA FORMA DE LER</p>
        <h1>Seu livro.<br />Um capítulo.<br /><em>Todo um mundo.</em></h1>
        <p class="hero-description">
          Transforme seus livros em uma experiência de web novel. Leitura vertical, capítulo por
          capítulo, no seu ritmo.
        </p>
        <div class="hero-actions">
          <button class="primary" :disabled="busy" @click="chooseFile">
            <LoaderCircle v-if="busy" class="spin" :size="19" /><Plus v-else :size="20" />{{
              busy ? 'Preparando seu livro…' : 'Importar meu livro'
            }}</button
          ><span>Gratuito.<br />Sem precisar de conta.</span>
        </div>
        <div class="format-labels">
          <span>EPUB</span><span>TXT</span><span>DOCX</span
          ><span class="format-note">até 20 MB por livro</span>
        </div>
      </div>
      <div class="hero-art" aria-hidden="true">
        <div class="orbit orbit-one"></div>
        <div class="orbit orbit-two"></div>
        <span class="art-star star-one" aria-hidden="true">✦</span
        ><span class="art-star star-two" aria-hidden="true">✦</span>
        <div class="book-mock">
          <div class="book-spine"></div>
          <div class="book-cover">
            <span class="cover-small">SUA PRÓXIMA<br />GRANDE HISTÓRIA</span>
            <div class="cover-illustration">
              <div class="sun-circle"></div>
              <div class="hill hill-one"></div>
              <div class="hill hill-two"></div>
              <div class="hill hill-three"></div>
              <span class="cover-window"></span>
            </div>
            <span class="cover-title">Entre<br /><em>mundos</em></span
            ><span class="cover-footer">UM LIVRO. INFINITAS POSSIBILIDADES.</span>
          </div>
        </div>
        <div class="reader-mock">
          <div class="mock-top">
            <BookOpen :size="13" /><span>LEITURA SEM DISTRAÇÕES</span><span>•••</span>
          </div>
          <p class="mock-chapter">CAPÍTULO 01</p>
          <h2>Um novo começo</h2>
          <p>
            Há histórias que começam com uma viagem. Outras, com uma simples vontade de descobrir o
            que existe além da próxima página.
          </p>
          <p>E assim, sem pressa, o mundo se abriu diante dela.</p>
          <div class="mock-bottom">
            <span>Seu ritmo. Sua história.</span><ArrowRight :size="15" />
          </div>
        </div>
        <span class="art-caption">DO SEU ARQUIVO PARA A SUA PRÓXIMA AVENTURA</span>
      </div>
    </section>
    <section v-if="reading" class="continue-card">
      <div class="continue-icon"><Bookmark :size="24" /></div>
      <div>
        <p class="eyebrow">SUA HISTÓRIA ESTÁ ESPERANDO</p>
        <h2>{{ reading.book.title }}</h2>
        <p>{{ reading.saved ? 'Salvo na sua biblioteca' : 'Leitura temporária nesta aba' }}</p>
      </div>
      <button class="secondary" @click="view = 'reader'">Continuar <ArrowRight :size="17" /></button
      ><button v-if="!reading.saved" class="text-button" :disabled="busy" @click="requestSave">
        Salvar na biblioteca
      </button>
    </section>
    <section class="import-section">
      <div class="import-intro">
        <span class="section-number">01 — COMEÇAR</span>
        <h2>A próxima história<br />já está com você.</h2>
        <p>
          Escolha um livro no seu dispositivo.<br />
          Nós cuidamos do formato.
        </p>
      </div>
      <div
        class="dropzone"
        :class="{ dragging, loading: busy }"
        @dragover.prevent="dragging = true"
        @dragleave.prevent="dragging = false"
        @drop.prevent="dropped"
      >
        <div class="upload-icon">
          <LoaderCircle v-if="busy" class="spin" :size="27" /><Upload
            v-else
            :size="27"
            :stroke-width="1.5"
          />
        </div>
        <h3>{{ busy ? 'Abrindo sua próxima história…' : 'Solte seu livro aqui' }}</h3>
        <p>
          {{
            busy
              ? 'Validando o arquivo e organizando os capítulos.'
              : 'ou escolha um arquivo no seu dispositivo'
          }}
        </p>
        <button class="secondary" :disabled="busy" @click="chooseFile">
          {{ busy ? 'Processando…' : 'Escolher arquivo' }}<ArrowUpRight :size="16" /></button
        ><span class="drop-hint">EPUB, TXT ou DOCX · máximo de 20 MB</span>
      </div>
    </section>
    <section class="feature-strip" aria-label="Sobre a experiência">
      <div>
        <span class="feature-number">01</span>
        <h3>A história continua igual.</h3>
        <p>Sem resumos ou reescritas. Seu texto, suas imagens e cada detalhe da narrativa.</p>
      </div>
      <div>
        <span class="feature-number">02</span>
        <h3>A leitura fica sua.</h3>
        <p>Role para descobrir. Ajuste tema, fonte e espaçamento para se sentir em casa.</p>
      </div>
      <div>
        <span class="feature-number">03</span>
        <h3>Seu lugar está guardado.</h3>
        <p>Com uma conta gratuita, retome o mesmo trecho no celular ou no computador.</p>
      </div>
    </section>
    <section class="privacy-note">
      <ShieldCheck :size="21" />
      <p>
        Uma biblioteca só sua. Seus livros são privados, e o LivroNovel é gratuito, sem assinaturas
        ou recursos pagos.
      </p>
    </section>
    <footer class="site-footer">
      <span class="footer-brand">LivroNovel.</span
      ><span>Feito para quem gosta de se perder em histórias.</span
      ><span>Leia no seu ritmo <ArrowUpRight :size="14" /></span>
    </footer>
  </main>

  <main v-else-if="view === 'review' && imported" id="main">
    <ImportReview
      :key="imported.id"
      :book="imported"
      :busy="busy"
      @cancel="home"
      @accept="beginReading"
    />
  </main>

  <ReaderView
    v-else-if="view === 'reader' && reading"
    :key="reading.book.id"
    :book="reading.book"
    :position="reading.position"
    :preferences="preferences"
    :saved="reading.saved"
    :signed-in="!!user"
    :sync-status="syncStatus"
    @back="home"
    @progress="updateProgress"
    @preferences="changePreferences"
    @save="requestSave"
    @end="endReading"
  />

  <main v-else-if="view === 'library'" id="main" class="library page-shell">
    <div class="section-heading">
      <div>
        <p class="eyebrow">UM LUGAR PARA SUAS HISTÓRIAS</p>
        <h1>Minha biblioteca<span class="accent">.</span></h1>
        <p>Escolha uma história e continue de onde parou.</p>
      </div>
      <button class="primary" :disabled="busy" @click="chooseFile">
        <Plus :size="18" /> Importar livro
      </button>
    </div>
    <div class="library-tools">
      <form
        class="search-box"
        @submit.prevent="
          libraryPage = 1;
          fetchLibrary();
        "
      >
        <Search :size="19" /><input
          v-model="search"
          aria-label="Buscar livro pelo título"
          placeholder="Encontre sua próxima leitura…"
          maxlength="200"
        /><button type="submit" class="text-button">Buscar</button>
      </form>
      <span v-if="library" class="small muted"
        >{{ library.usage.count }} / 50 livros ·
        {{ (library.usage.bytes / 1_000_000).toFixed(1) }} / 500 MB</span
      >
    </div>
    <p v-if="libraryLoading" class="empty-state" role="status">Buscando suas histórias…</p>
    <div v-else-if="library?.books.length" class="library-grid">
      <article v-for="(book, i) in library.books" :key="book.id" class="library-book">
        <button
          class="library-cover"
          :class="`cover-${i % 4}`"
          :disabled="busy"
          @click="openBook(book.id)"
        >
          <span>{{ book.format.toUpperCase() }}</span
          ><BookOpen :size="42" :stroke-width="1" /><strong>{{ book.title }}</strong
          ><span>{{ book.author || 'Sua biblioteca particular' }}</span>
        </button>
        <div class="library-book-info">
          <div>
            <h2>{{ book.title }}</h2>
            <p>{{ book.chapters }} capítulos</p>
          </div>
          <button
            class="icon-button danger"
            :aria-label="`Excluir ${book.title}`"
            @click="deleteBook(book.id, book.title)"
          >
            <Trash2 :size="18" />
          </button>
        </div>
        <button class="text-button" :disabled="busy" @click="openBook(book.id)">
          {{ book.progress ? 'Continuar leitura' : 'Começar leitura' }} <ChevronRight :size="16" />
        </button>
      </article>
    </div>
    <div v-else class="empty-state">
      <BookOpen :size="40" :stroke-width="1" />
      <h2>
        {{ search ? 'Nenhuma história com esse título.' : 'Sua primeira história começa aqui.' }}
      </h2>
      <p>
        {{
          search
            ? 'Tente buscar por outro título.'
            : 'Importe um livro para preencher sua biblioteca.'
        }}
      </p>
      <button v-if="!search" class="primary" @click="chooseFile">
        Importar meu primeiro livro
      </button>
    </div>
    <div v-if="library && library.pages > 1" class="pager">
      <button
        :disabled="libraryPage <= 1"
        @click="
          libraryPage--;
          fetchLibrary();
        "
      >
        Anterior</button
      ><span>{{ libraryPage }} / {{ library.pages }}</span
      ><button
        :disabled="libraryPage >= library.pages"
        @click="
          libraryPage++;
          fetchLibrary();
        "
      >
        Próxima
      </button>
    </div>
  </main>

  <ConfirmDialog ref="confirmation" />
  <dialog ref="authDialog" class="auth-dialog" aria-labelledby="auth-title">
    <button
      class="icon-button close-dialog"
      aria-label="Fechar acesso à conta"
      @click="authDialog?.close()"
    >
      <X :size="21" />
    </button>
    <div class="auth-brand"><BookOpen :size="28" :stroke-width="1.4" /></div>
    <p class="eyebrow">LIVRONOVEL · SEMPRE GRATUITO</p>
    <h2 id="auth-title">{{ formTitle }}</h2>
    <p>Guarde seus livros e continue a leitura em qualquer dispositivo.</p>
    <form @submit.prevent="authenticate">
      <label
        >E-mail<input
          v-model="email"
          type="email"
          autocomplete="email"
          required
          maxlength="254"
          placeholder="voce@exemplo.com" /></label
      ><label
        >Senha<input
          v-model="password"
          type="password"
          :autocomplete="authMode === 'register' ? 'new-password' : 'current-password'"
          required
          minlength="10"
          maxlength="128"
          placeholder="Pelo menos 10 caracteres"
      /></label>
      <p v-if="authError" class="form-error" role="alert">{{ authError }}</p>
      <button class="primary full" :disabled="authBusy">
        {{
          authBusy
            ? 'Só um instante…'
            : authMode === 'register'
              ? 'Criar minha conta gratuita'
              : 'Entrar na minha conta'
        }}<ArrowRight :size="17" />
      </button>
    </form>
    <button
      class="auth-switch text-button"
      @click="
        authMode = authMode === 'register' ? 'login' : 'register';
        authError = '';
      "
    >
      {{
        authMode === 'register'
          ? 'Já tenho uma conta. Entrar'
          : 'Ainda não tenho conta. Criar gratuitamente'
      }}
    </button>
    <p class="auth-footnote">Até 50 livros e 500 MB. Sem cartão, sem assinatura.</p>
  </dialog>
</template>
