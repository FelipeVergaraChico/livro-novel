import { test, expect, type Page } from '@playwright/test';
import { epub, docx } from '../fixtures';
import { mkdir } from 'node:fs/promises';
import { pool } from '../../server/db';
import { paceImports } from './support';
const testAccounts: string[] = [];
test.afterAll(async () => {
  if (testAccounts.length)
    await pool.query('DELETE FROM users WHERE email = ANY($1)', [testAccounts]);
  await pool.end();
});

async function noHorizontalOverflow(page: Page) {
  const overflow = await page.evaluate(() => ({
    width: window.innerWidth,
    scroll: document.documentElement.scrollWidth,
  }));
  expect(overflow.scroll).toBeLessThanOrEqual(overflow.width + 1);
}
async function upload(page: Page, name: string, buffer: Buffer) {
  await paceImports();
  await page
    .locator('input[type=file]')
    .setInputFiles({ name, mimeType: 'application/octet-stream', buffer });
  await expect(page.getByRole('heading', { name: 'Tudo pronto para ler?' })).toBeVisible();
}
for (const width of [360, 390, 430, 1440]) {
  test(`importação, ajustes e retomada em ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height: width < 500 ? 844 : 1000 });
    const errors: string[] = [];
    page.on('pageerror', (error) => errors.push(error.message));
    await page.goto('/');
    await page.evaluate(() => document.fonts.ready);
    await noHorizontalOverflow(page);
    await mkdir('work/screenshots', { recursive: true });
    await page.screenshot({ path: `work/screenshots/home-${width}.png`, fullPage: true });
    await upload(page, 'aurora.epub', await epub({ long: true }));
    await noHorizontalOverflow(page);
    await page.screenshot({ path: `work/screenshots/review-${width}.png`, fullPage: false });
    await page.getByRole('button', { name: 'Começar a leitura', exact: true }).click();
    await expect(page.getByRole('button', { name: 'Ajustar leitura' })).toBeVisible();
    await expect(page.locator('.reading-prose')).toContainText('Trecho 180');
    await page.evaluate(() => window.scrollTo(0, 6000));
    await page.waitForTimeout(1600);
    const before = await page.evaluate(() => {
      const blocks = [...document.querySelectorAll<HTMLElement>('[data-block]')];
      return blocks.find((e) => e.getBoundingClientRect().bottom >= 120)?.dataset.block;
    });
    await page.reload();
    await expect(page.locator('.reading-prose')).toBeVisible();
    await page.waitForTimeout(1800);
    const after = await page.evaluate(
      () =>
        [...document.querySelectorAll<HTMLElement>('[data-block]')].find(
          (e) => e.getBoundingClientRect().bottom >= 120,
        )?.dataset.block,
    );
    expect(after).toBe(before);
    await page.getByRole('button', { name: 'Ajustar leitura' }).click();
    await page.getByRole('button', { name: 'Sépia', exact: true }).click();
    await page.getByLabel('Tamanho do texto').fill('28');
    await page.getByLabel('Espaçamento').fill('2.2');
    await noHorizontalOverflow(page);
    await page.screenshot({ path: `work/screenshots/settings-${width}.png`, fullPage: false });
    await page.getByRole('button', { name: 'Fechar painel' }).click();
    await page.getByRole('button', { name: 'Abrir sumário' }).click();
    await page.getByRole('button', { name: /02.*Capítulo 2/ }).click();
    await expect(page.locator('.chapter-heading h1')).toHaveText('Capítulo 2 — O encontro');
    await noHorizontalOverflow(page);
    await page.screenshot({ path: `work/screenshots/reader-${width}.png`, fullPage: true });
    await page.reload();
    await expect(page.locator('.chapter-heading h1')).toHaveText('Capítulo 2 — O encontro');
    await expect(page.locator('html')).toHaveAttribute('data-theme', 'sepia');
    await page.getByRole('button', { name: 'Ajustar leitura' }).click();
    await expect(page.getByLabel('Tamanho do texto')).toHaveValue('28');
    expect(errors).toEqual([]);
  });
}
test('visitante retoma o bloco e a posição após voltar à página inicial', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/');
  await upload(page, 'aurora.epub', await epub({ long: true }));
  await page.getByRole('button', { name: 'Começar a leitura', exact: true }).click();
  await expect(page.locator('.reading-prose')).toBeVisible();
  await page.waitForTimeout(300);
  await page.evaluate(() => window.scrollTo(0, 6050));
  await page.waitForTimeout(650);
  const before = await page.evaluate(() => {
    const block = [...document.querySelectorAll<HTMLElement>('[data-block]')].find(
      (e) => e.getBoundingClientRect().bottom >= 120,
    )!;
    return { id: block.dataset.block, top: block.getBoundingClientRect().top };
  });
  await page.getByRole('button', { name: 'Voltar à página inicial', exact: true }).click();
  await expect(page.locator('.continue-card')).toBeVisible();
  await page.getByRole('button', { name: 'Continuar', exact: true }).click();
  await expect(page.locator('.reading-prose')).toBeVisible();
  await expect
    .poll(async () =>
      page.evaluate(() => {
        const block = [...document.querySelectorAll<HTMLElement>('[data-block]')].find(
          (e) => e.getBoundingClientRect().bottom >= 120,
        );
        return block?.dataset.block;
      }),
    )
    .toBe(before.id);
  const afterTop = await page
    .locator(`[data-block="${before.id}"]`)
    .evaluate((e) => e.getBoundingClientRect().top);
  expect(Math.abs(afterTop - before.top)).toBeLessThan(3);
});

test('TXT: separar e unir sem perder conteúdo; encerramento explícito', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/');
  await upload(
    page,
    'historia.txt',
    Buffer.from('Primeiro trecho.\nSegundo trecho.\nTerceiro trecho.'),
  );
  await page
    .getByRole('button', { name: 'Dividir aqui: iniciar capítulo antes de Segundo trecho.' })
    .click();
  await expect(page.getByText('2 CAPÍTULOS', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Unir ao anterior' }).click();
  await expect(page.getByText('1 CAPÍTULOS', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Começar a leitura', exact: true }).click();
  await expect(page.locator('.reading-prose')).toContainText(
    'Primeiro trecho.Segundo trecho.Terceiro trecho.',
  );
  await page.getByRole('button', { name: 'Encerrar leitura temporária' }).click();
  await page
    .getByRole('dialog')
    .getByRole('button', { name: 'Encerrar leitura', exact: true })
    .click();
  await expect(page.locator('.continue-card')).toHaveCount(0);
  await page.reload();
  await expect(page.locator('.continue-card')).toHaveCount(0);
});
test('confirmação de troca de livro: cancelar, Escape e confirmar', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  page.on('dialog', () => {
    throw new Error('Não deve abrir confirmação do navegador');
  });
  await page.goto('/');
  await upload(page, 'primeiro.txt', Buffer.from('Leitura original.'));
  await page.getByRole('button', { name: 'Começar a leitura', exact: true }).click();
  await page.getByRole('button', { name: 'Voltar à página inicial' }).click();
  const replacement = {
    name: 'segundo.txt',
    mimeType: 'text/plain',
    buffer: Buffer.from('Nova leitura.'),
  };
  await page.locator('input[type=file]').setInputFiles(replacement);
  const dialog = page.getByRole('dialog', { name: 'Trocar de livro?' });
  await expect(dialog).toBeVisible();
  await expect(dialog.getByRole('button', { name: 'Cancelar' })).toBeFocused();
  await noHorizontalOverflow(page);
  await page.screenshot({ path: 'work/screenshots/confirmation-mobile.png' });
  await dialog.getByRole('button', { name: 'Cancelar' }).click();
  await expect(dialog).not.toBeVisible();
  await page.getByRole('button', { name: 'Continuar', exact: true }).click();
  await expect(page.locator('.reading-prose')).toHaveText('Leitura original.');
  await page.getByRole('button', { name: 'Voltar à página inicial' }).click();
  await page.locator('input[type=file]').setInputFiles(replacement);
  await expect(dialog).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(dialog).not.toBeVisible();
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.locator('input[type=file]').setInputFiles(replacement);
  await expect(dialog).toBeVisible();
  await page.screenshot({ path: 'work/screenshots/confirmation-desktop.png' });
  await paceImports();
  await dialog.getByRole('button', { name: 'Importar novo livro' }).click();
  await expect(page.getByRole('heading', { name: 'Tudo pronto para ler?' })).toBeVisible();
  await page.getByRole('button', { name: 'Começar a leitura', exact: true }).click();
  await expect(page.locator('.reading-prose')).toHaveText('Nova leitura.');
});

test('DOCX: importação e leitura pelo navegador', async ({ page }) => {
  await page.setViewportSize({ width: 360, height: 800 });
  await page.goto('/');
  await upload(page, 'historia.docx', await docx());
  await page.getByRole('button', { name: 'Começar a leitura', exact: true }).click();
  await expect(page.locator('.reading-prose strong')).toHaveText(' Em destaque.');
  await noHorizontalOverflow(page);
});
test('conta, biblioteca e retomada em outro dispositivo', async ({ page, browser }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/');
  await upload(page, 'aurora.epub', await epub({ long: true }));
  await page.getByRole('button', { name: 'Começar a leitura', exact: true }).click();
  await page.getByRole('button', { name: 'Criar conta ou entrar para salvar' }).click();
  const email = `browser-${Date.now()}@livronovel.test`,
    password = 'Leitura-teste-12345';
  testAccounts.push(email);
  await page.getByLabel('E-mail', { exact: true }).fill(email);
  await page.getByLabel('Senha', { exact: true }).fill(password);
  await page.getByRole('button', { name: 'Criar minha conta gratuita', exact: true }).click();
  await expect(
    page.getByText('Livro e posição de leitura salvos na sua biblioteca.'),
  ).toBeVisible();
  await page.getByRole('button', { name: 'Fechar aviso' }).click();
  await page.getByRole('button', { name: 'Voltar à página inicial' }).click();
  await page.getByRole('button', { name: 'Minha biblioteca', exact: true }).click();
  await expect(page.locator('.library-book')).toHaveCount(1);
  for (const width of [360, 390, 430]) {
    await page.setViewportSize({ width, height: 844 });
    await noHorizontalOverflow(page);
    await page.screenshot({ path: `work/screenshots/library-${width}.png`, fullPage: true });
  }
  await page.setViewportSize({ width: 390, height: 844 });
  await page.getByRole('button', { name: 'Continuar leitura', exact: true }).click();
  await expect(page.locator('.reading-prose')).toBeVisible();
  await page.evaluate(() => window.scrollTo(0, 5500));
  await page.waitForTimeout(1800);
  const first = await page.evaluate(
    () =>
      [...document.querySelectorAll<HTMLElement>('[data-block]')].find(
        (e) => e.getBoundingClientRect().bottom >= 120,
      )?.dataset.block,
  );
  const secondContext = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
  const desktop = await secondContext.newPage();
  await desktop.goto('http://localhost:5173');
  await desktop.getByRole('button', { name: 'Entrar', exact: true }).click();
  await desktop.getByLabel('E-mail', { exact: true }).fill(email);
  await desktop.getByLabel('Senha', { exact: true }).fill(password);
  await desktop.getByRole('button', { name: 'Entrar na minha conta', exact: true }).click();
  await expect(desktop.getByRole('heading', { name: 'Minha biblioteca.' })).toBeVisible();
  await desktop.getByRole('button', { name: 'Continuar leitura', exact: true }).click();
  await expect(desktop.locator('.reading-prose')).toBeVisible();
  await desktop.waitForTimeout(1800);
  const second = await desktop.evaluate(
    () =>
      [...document.querySelectorAll<HTMLElement>('[data-block]')].find(
        (e) => e.getBoundingClientRect().bottom >= 120,
      )?.dataset.block,
  );
  expect(second).toBe(first);
  await desktop.getByRole('button', { name: 'Voltar à página inicial' }).click();
  await desktop.getByRole('button', { name: 'Minha biblioteca', exact: true }).click();
  await desktop.getByRole('button', { name: 'Excluir A viagem de Aurora' }).click();
  await desktop.getByRole('dialog').getByRole('button', { name: 'Cancelar', exact: true }).click();
  await expect(desktop.locator('.library-book')).toHaveCount(1);
  await desktop.getByRole('button', { name: 'Excluir A viagem de Aurora' }).click();
  await desktop
    .getByRole('dialog')
    .getByRole('button', { name: 'Excluir livro', exact: true })
    .click();
  await expect(
    desktop.getByRole('heading', { name: 'Sua primeira história começa aqui.' }),
  ).toBeVisible();
  await secondContext.close();
});
