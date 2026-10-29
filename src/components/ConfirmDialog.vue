<script setup lang="ts">
import { nextTick, onBeforeUnmount, ref } from 'vue';
import { X, BookOpen } from 'lucide-vue-next';

type Confirmation = { title: string; message: string; action: string };
const dialog = ref<HTMLDialogElement>();
const content = ref<Confirmation>();
let resolvePending: ((accepted: boolean) => void) | undefined;
function finish(accepted: boolean) {
  const resolve = resolvePending;
  resolvePending = undefined;
  dialog.value?.close();
  resolve?.(accepted);
}
async function ask(value: Confirmation): Promise<boolean> {
  if (resolvePending) return false;
  const result = new Promise<boolean>((resolve) => {
    resolvePending = resolve;
  });
  content.value = value;
  await nextTick();
  dialog.value?.showModal();
  return result;
}
onBeforeUnmount(() => finish(false));
defineExpose({ ask });
</script>

<template>
  <dialog
    ref="dialog"
    class="confirm-dialog"
    aria-labelledby="confirmation-title"
    aria-describedby="confirmation-message"
    @cancel.prevent="finish(false)"
    @close="!dialog?.open && finish(false)"
  >
    <button class="icon-button close-dialog" aria-label="Fechar confirmação" @click="finish(false)">
      <X :size="21" />
    </button>
    <div class="confirmation-symbol" aria-hidden="true">
      <BookOpen :size="26" :stroke-width="1.5" />
    </div>
    <p class="eyebrow">SUA LEITURA</p>
    <h2 id="confirmation-title">{{ content?.title }}</h2>
    <p id="confirmation-message">{{ content?.message }}</p>
    <div class="confirmation-actions">
      <button class="secondary" autofocus @click="finish(false)">Cancelar</button>
      <button class="primary" @click="finish(true)">{{ content?.action }}</button>
    </div>
  </dialog>
</template>
