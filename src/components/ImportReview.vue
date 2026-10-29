<script setup lang="ts">
import { ref, computed, toRaw } from 'vue';
import { ArrowLeft, ArrowRight, BookOpen, Scissors, Combine } from 'lucide-vue-next';
import type { Book } from '../../shared/types';
import { MAX_CHAPTER_BLOCKS } from '../../shared/types';
const props = defineProps<{ book: Book; busy: boolean }>();
const emit = defineEmits<{ cancel: []; accept: [book: Book] }>();
const draft = ref<Book>(structuredClone(toRaw(props.book)));
const selected = ref(0);
const blockPage = ref(1);
const chapterPage = ref(1);
const chapter = computed(() => draft.value.chapters[selected.value]);
const canMerge = computed(
  () =>
    selected.value > 0 &&
    chapter.value.blocks.length + draft.value.chapters[selected.value - 1].blocks.length <=
      MAX_CHAPTER_BLOCKS,
);
const visibleBlocks = computed(() =>
  chapter.value.blocks.slice((blockPage.value - 1) * 40, blockPage.value * 40),
);
const visibleChapters = computed(() =>
  draft.value.chapters.slice((chapterPage.value - 1) * 30, chapterPage.value * 30),
);
const valid = computed(
  () => draft.value.title.trim() && draft.value.chapters.every((c) => c.title.trim()),
);
function select(index: number) {
  selected.value = index;
  blockPage.value = 1;
}
function split(id: string) {
  const at = chapter.value.blocks.findIndex((b) => b.id === id);
  if (at <= 0) return;
  const blocks = chapter.value.blocks.splice(at);
  const next = {
    id: crypto.randomUUID(),
    title: blocks[0].text.slice(0, 100) || 'Novo capítulo',
    blocks,
  };
  draft.value.chapters.splice(selected.value + 1, 0, next);
  select(selected.value + 1);
  chapterPage.value = Math.floor(selected.value / 30) + 1;
}
function merge() {
  if (!canMerge.value) return;
  const previous = draft.value.chapters[selected.value - 1];
  previous.blocks.push(...chapter.value.blocks);
  draft.value.chapters.splice(selected.value, 1);
  select(selected.value - 1);
  chapterPage.value = Math.floor(selected.value / 30) + 1;
}
</script>

<template>
  <section class="review page-shell" aria-labelledby="review-title">
    <button class="text-button" @click="emit('cancel')"><ArrowLeft :size="17" /> Voltar</button>
    <div class="section-heading">
      <div>
        <p class="eyebrow">SEU LIVRO, DO SEU JEITO</p>
        <h1 id="review-title">Tudo pronto para ler?</h1>
        <p>Confira os capítulos. O texto da sua história permanece o mesmo.</p>
      </div>
      <span class="badge">{{ draft.format.toUpperCase() }}</span>
    </div>
    <div class="review-meta">
      <label>Título do livro<input v-model="draft.title" maxlength="200" /></label
      ><label
        >Autor <span class="muted">(opcional)</span
        ><input v-model="draft.author" maxlength="200" placeholder="Nome do autor"
      /></label>
    </div>
    <div v-if="draft.warnings.length" class="notice">
      <p v-for="warning in draft.warnings" :key="warning">{{ warning }}</p>
    </div>
    <div class="review-layout">
      <aside class="chapter-panel">
        <p class="eyebrow">{{ draft.chapters.length }} CAPÍTULOS</p>
        <button
          v-for="(item, i) in visibleChapters"
          :key="item.id"
          class="chapter-item"
          :class="{ active: selected === (chapterPage - 1) * 30 + i }"
          @click="select((chapterPage - 1) * 30 + i)"
        >
          <span>{{ String((chapterPage - 1) * 30 + i + 1).padStart(2, '0') }}</span
          >{{ item.title || 'Sem título' }}
        </button>
        <div v-if="draft.chapters.length > 30" class="pager">
          <button :disabled="chapterPage === 1" @click="chapterPage--">Anterior</button
          ><span>{{ chapterPage }}</span
          ><button :disabled="chapterPage * 30 >= draft.chapters.length" @click="chapterPage++">
            Próxima
          </button>
        </div>
      </aside>
      <div class="chapter-preview">
        <div class="preview-tools">
          <label>Título do capítulo<input v-model="chapter.title" maxlength="200" /></label
          ><button
            class="text-button"
            :disabled="!canMerge"
            title="Unir até 5.000 blocos em um capítulo"
            @click="merge"
          >
            <Combine :size="16" /> Unir ao anterior
          </button>
        </div>
        <p class="muted small">Use a tesoura entre trechos para começar um novo capítulo.</p>
        <div v-for="block in visibleBlocks" :key="block.id" class="preview-block">
          <button
            v-if="chapter.blocks[0].id !== block.id"
            class="split-button"
            :aria-label="`Dividir aqui: iniciar capítulo antes de ${block.text.slice(0, 60)}`"
            @click="split(block.id)"
          >
            <Scissors :size="14" /><span>Dividir aqui</span>
          </button>
          <div class="book-prose" v-html="block.html"></div>
        </div>
        <div v-if="chapter.blocks.length > 40" class="pager">
          <button :disabled="blockPage === 1" @click="blockPage--">Trechos anteriores</button
          ><span>{{ blockPage }} / {{ Math.ceil(chapter.blocks.length / 40) }}</span
          ><button :disabled="blockPage * 40 >= chapter.blocks.length" @click="blockPage++">
            Próximos trechos
          </button>
        </div>
      </div>
    </div>
    <div class="review-footer">
      <span><BookOpen :size="18" /> Sem reescrever. Sem resumir.</span
      ><button class="primary" :disabled="!valid || busy" @click="emit('accept', draft)">
        {{ busy ? 'Preparando…' : 'Começar a leitura' }}<ArrowRight :size="18" />
      </button>
    </div>
  </section>
</template>
