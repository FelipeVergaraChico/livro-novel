import { test, expect } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import { paceImports } from './support';
test('acessibilidade da página inicial, conta e leitor em três temas no celular', async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/');
  const audit = async () => {
    const result = await new AxeBuilder({ page })
      .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'])
      .analyze();
    expect(
      result.violations.map((v) => ({
        id: v.id,
        impact: v.impact,
        nodes: v.nodes.map((n) => n.target),
      })),
    ).toEqual([]);
  };
  await audit();
  await page.getByRole('button', { name: 'Entrar', exact: true }).click();
  await audit();
  await page.getByRole('button', { name: 'Fechar acesso à conta' }).click();
  await paceImports();
  await page
    .locator('input[type=file]')
    .setInputFiles({
      name: 'acessibilidade.txt',
      mimeType: 'text/plain',
      buffer: Buffer.from(
        'Capítulo 1\nUma história para ler com calma.\nCada palavra merece seu próprio tempo.',
      ),
    });
  await expect(page.getByRole('heading', { name: 'Tudo pronto para ler?' })).toBeVisible();
  await audit();
  await page.getByRole('button', { name: 'Começar a leitura', exact: true }).click();
  await page.getByRole('button', { name: 'Ajustar leitura' }).click();
  for (const name of ['Claro', 'Sépia', 'Escuro']) {
    await page.getByRole('button', { name, exact: true }).click();
    await audit();
  }
});
