<script setup lang="ts">
import { ref, computed, onMounted, onBeforeUnmount, nextTick, watch } from 'vue';
import {
  ArrowLeft,
  ArrowRight,
  List,
  SlidersHorizontal,
  X,
  Bookmark,
  Check,
  Sun,
  Moon,
  Coffee,
} from 'lucide-vue-next';
import type { Book, Position, Preferences } from '../../shared/types';
const props = defineProps<{
  book: Book;
  position: Position | null;
  preferences: Preferences;
  saved: boolean;
  signedIn: boolean;
  syncStatus: string;
}>();
const emit = defineEmits<{
  back: [];
  progress: [position: Position];
  preferences: [preferences: Preferences];
  save: [];
  end: [];
}>();
const chapterIndex = ref(
  Math.max(
    0,
    props.book.chapters.findIndex((c) => c.id === props.position?.chapterId),
  ),
);
const chapter = computed(() => props.book.chapters[chapterIndex.value]);
const displayBlocks = computed(() =>
  chapter.value.blocks.filter(
    (block, index) =>
      !(
        index === 0 &&
        chapter.value.blocks.length > 1 &&
        block.text.trim() === chapter.value.title.trim()
      ),
  ),
);
const panel = ref<'chapters' | 'settings' | null>(null);
const chapterSearch = ref('');
const contentsPage = ref(1);
const filteredChapters = computed(() =>
  props.book.chapters
    .map((c, i) => ({ ...c, index: i }))
    .filter((c) => c.title.toLocaleLowerCase().includes(chapterSearch.value.toLocaleLowerCase())),
);
watch(chapterSearch, () => (contentsPage.value = 1));
const article = ref<HTMLElement>();
const percentage = ref(0);
let restoring = false;
let timer: ReturnType<typeof setTimeout> | undefined;
const style = computed(() => ({
  '--reader-font-size': `${props.preferences.fontSize}px`,
  '--reader-line-height': props.preferences.lineHeight,
  '--reader-font':
    props.preferences.font === 'serif'
      ? 'Georgia, "Times New Roman", serif'
      : 'system-ui, sans-serif',
}));
function preference<K extends keyof Preferences>(key: K, value: Preferences[K]) {
  emit('preferences', { ...props.preferences, [key]: value });
}
function capture(): Position | null {
  if (!article.value || restoring) return null;
  const blocks = [...article.value.querySelectorAll<HTMLElement>('[data-block]')];
  if (!blocks.length) return null;
  const y = 120;
  // Binary search avoids reading every block on every scroll in long chapters.
  let lo = 0,
    hi = blocks.length - 1;
  while (lo < hi) {
    const mid = Math.floor((lo + hi) / 2);
    if (blocks[mid].getBoundingClientRect().bottom < y) lo = mid + 1;
    else hi = mid;
  }
  const block = blocks[lo],
    rect = block.getBoundingClientRect();
  const fraction = Math.max(0, Math.min(1, (y - rect.top) / Math.max(1, rect.height)));
  percentage.value = Math.min(100, Math.round(((lo + fraction) / blocks.length) * 100));
  return { chapterId: chapter.value.id, blockId: block.dataset.block!, fraction };
}
function report() {
  const position = capture();
  if (position) emit('progress', position);
}
function onScroll() {
  if (restoring || timer) return;
  timer = setTimeout(() => {
    timer = undefined;
    report();
  }, 500);
}
async function restore(position: Position | null) {
  restoring = true;
  await nextTick();
  await document.fonts.ready;
  await Promise.all(
    [...(article.value?.querySelectorAll('img') || [])].map((img) =>
      img.complete
        ? Promise.resolve()
        : new Promise<void>((resolve) => {
            img.addEventListener('load', () => resolve(), { once: true });
            img.addEventListener('error', () => resolve(), { once: true });
            setTimeout(resolve, 2000);
          }),
    ),
  );
  const block =
    position && article.value?.querySelector<HTMLElement>(`[data-block="${position.blockId}"]`);
  if (block) {
    const rect = block.getBoundingClientRect();
    window.scrollTo({
      top: Math.max(0, window.scrollY + rect.top + rect.height * position!.fraction - 120),
      behavior: 'instant',
    });
  } else window.scrollTo({ top: 0, behavior: 'instant' });
  await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
  restoring = false;
  report();
}
async function go(index: number) {
  if (index < 0 || index >= props.book.chapters.length) return;
  report();
  chapterIndex.value = index;
  panel.value = null;
  emit('progress', {
    chapterId: chapter.value.id,
    blockId: chapter.value.blocks[0].id,
    fraction: 0,
  });
  await restore(null);
}
async function noteClick(event: MouseEvent) {
  const link = (event.target as HTMLElement).closest('a[href^="#"]');
  if (!link) return;
  event.preventDefault();
  const target = link.getAttribute('href')!.slice(1);
  for (let i = 0; i < props.book.chapters.length; i++) {
    if (props.book.chapters[i].blocks.some((b) => b.html.includes(`id="${target}"`))) {
      if (chapterIndex.value !== i) await go(i);
      await nextTick();
      document.getElementById(target)?.scrollIntoView({ block: 'center' });
      report();
      break;
    }
  }
}
function escapePanel(event: KeyboardEvent) {
  if (event.key === 'Escape') panel.value = null;
}
watch(
  () => [props.preferences.fontSize, props.preferences.lineHeight, props.preferences.font],
  async () => {
    await restore(props.position);
  },
);
onMounted(async () => {
  window.addEventListener('scroll', onScroll, { passive: true });
  window.addEventListener('keydown', escapePanel);
  await restore(props.position);
});
onBeforeUnmount(() => {
  report();
  clearTimeout(timer);
  window.removeEventListener('scroll', onScroll);
  window.removeEventListener('keydown', escapePanel);
});
</script>

<template>
  <div class="reader" :style="style">
    <header class="reader-toolbar">
      <button
        class="icon-button"
        aria-label="Voltar à página inicial"
        @click="
          report();
          emit('back');
        "
      >
        <ArrowLeft :size="21" />
      </button>
      <div class="reader-book-name">
        <strong>{{ book.title }}</strong
        ><span>{{ chapterIndex + 1 }} de {{ book.chapters.length }} seções</span>
      </div>
      <div class="toolbar-actions">
        <button
          class="icon-button"
          :aria-expanded="panel === 'chapters'"
          aria-label="Abrir sumário"
          @click="panel = panel === 'chapters' ? null : 'chapters'"
        >
          <List :size="21" /></button
        ><button
          class="icon-button"
          :aria-expanded="panel === 'settings'"
          aria-label="Ajustar leitura"
          @click="panel = panel === 'settings' ? null : 'settings'"
        >
          <SlidersHorizontal :size="20" />
        </button>
      </div>
    </header>
    <div class="reading-progress" aria-hidden="true">
      <div :style="{ width: `${percentage}%` }"></div>
    </div>
    <aside
      v-if="panel"
      class="reader-panel"
      :class="{ 'reader-settings': panel === 'settings' }"
      :aria-label="panel === 'settings' ? 'Preferências de leitura' : 'Sumário'"
    >
      <div class="panel-heading">
        <h2>{{ panel === 'settings' ? 'Seu jeito de ler' : 'Sumário' }}</h2>
        <button class="icon-button" aria-label="Fechar painel" @click="panel = null">
          <X :size="20" />
        </button>
      </div>
      <div class="reader-panel-content">
        <template v-if="panel === 'settings'"
          ><p class="muted small">As suas preferências ficam salvas.</p>
          <fieldset>
            <legend>Aparência</legend>
            <div class="theme-options">
              <button
                v-for="theme in ['light', 'sepia', 'dark'] as const"
                :key="theme"
                :class="['theme-swatch', theme, { chosen: preferences.theme === theme }]"
                :aria-pressed="preferences.theme === theme"
                @click="preference('theme', theme)"
              >
                <Sun v-if="theme === 'light'" :size="20" /><Coffee
                  v-else-if="theme === 'sepia'"
                  :size="20"
                /><Moon v-else :size="20" />{{
                  { light: 'Claro', sepia: 'Sépia', dark: 'Escuro' }[theme]
                }}
              </button>
            </div>
          </fieldset>
          <label
            >Tamanho do texto <span>{{ preferences.fontSize }} px</span
            ><input
              type="range"
              min="16"
              max="32"
              step="1"
              :value="preferences.fontSize"
              @input="
                preference('fontSize', Number(($event.target as HTMLInputElement).value))
              " /></label
          ><label
            >Espaçamento <span>{{ preferences.lineHeight.toFixed(1) }}</span
            ><input
              type="range"
              min="1.4"
              max="2.4"
              step="0.1"
              :value="preferences.lineHeight"
              @input="
                preference('lineHeight', Number(($event.target as HTMLInputElement).value))
              " /></label
          ><label
            >Fonte<select
              :value="preferences.font"
              @change="
                preference('font', ($event.target as HTMLSelectElement).value as 'serif' | 'sans')
              "
            >
              <option value="serif">Literária — com serifa</option>
              <option value="sans">Simples — sem serifa</option>
            </select></label
          ><button
            class="secondary full"
            @click="
              restore(null);
              panel = null;
            "
          >
            Voltar ao início do capítulo
          </button></template
        >
        <template v-else
          ><label class="sr-only" for="chapter-search">Buscar capítulo</label
          ><input id="chapter-search" v-model="chapterSearch" placeholder="Buscar capítulo…" />
          <nav class="contents-list">
            <button
              v-for="c in filteredChapters.slice((contentsPage - 1) * 40, contentsPage * 40)"
              :key="c.id"
              class="chapter-item"
              :class="{ active: c.index === chapterIndex }"
              @click="go(c.index)"
            >
              <span>{{ String(c.index + 1).padStart(2, '0') }}</span
              >{{ c.title }}
            </button>
            <p v-if="!filteredChapters.length">Nenhum capítulo encontrado.</p>
          </nav>
          <div v-if="filteredChapters.length > 40" class="pager">
            <button :disabled="contentsPage === 1" @click="contentsPage--">Anterior</button
            ><span>{{ contentsPage }}</span
            ><button
              :disabled="contentsPage * 40 >= filteredChapters.length"
              @click="contentsPage++"
            >
              Próxima
            </button>
          </div></template
        >
      </div>
    </aside>
    <main id="main" class="reading-page">
      <div class="chapter-heading">
        <p class="eyebrow">SEÇÃO {{ String(chapterIndex + 1).padStart(2, '0') }}</p>
        <h1>{{ chapter.title }}</h1>
        <span class="chapter-ornament" aria-hidden="true">✦</span>
      </div>
      <article
        ref="article"
        class="book-prose reading-prose"
        aria-label="Texto do capítulo"
        @click="noteClick"
      >
        <div
          v-for="block in displayBlocks"
          :key="block.id"
          :data-block="block.id"
          v-html="block.html"
        ></div>
      </article>
      <nav class="chapter-navigation" aria-label="Navegar entre capítulos">
        <button class="secondary" :disabled="chapterIndex === 0" @click="go(chapterIndex - 1)">
          <ArrowLeft :size="17" /> Anterior</button
        ><span>{{ chapterIndex + 1 }} / {{ book.chapters.length }}</span
        ><button
          class="primary"
          :disabled="chapterIndex === book.chapters.length - 1"
          @click="go(chapterIndex + 1)"
        >
          Próximo <ArrowRight :size="17" />
        </button>
      </nav>
      <div class="reader-endnote">
        <Check v-if="saved" :size="16" /><Bookmark v-else :size="16" /><span>{{
          saved ? syncStatus : 'Leitura temporária · disponível nesta sessão'
        }}</span>
      </div>
      <div v-if="!saved" class="guest-save">
        <p>Quer guardar esta história para depois?</p>
        <button
          class="secondary"
          @click="
            report();
            emit('save');
          "
        >
          {{
            signedIn ? 'Salvar na minha biblioteca' : 'Criar conta ou entrar para salvar'
          }}</button
        ><button class="text-button danger" @click="emit('end')">
          Encerrar leitura temporária
        </button>
      </div>
    </main>
  </div>
</template>
