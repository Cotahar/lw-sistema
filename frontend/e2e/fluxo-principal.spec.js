const { test, expect } = require('@playwright/test');

async function login(page) {
  await page.goto('/');
  await page.locator('input[name="username"]').fill('admin');
  await page.locator('input[name="senha"]').fill('admin123');
  await page.getByRole('button', { name: 'Entrar' }).click();
  await expect(page).toHaveURL(/#\/dashboard/);
}

test('login com usuario e senha corretos leva ao Painel', async ({ page }) => {
  await login(page);
  await expect(page.getByRole('heading', { name: 'Painel' })).toBeVisible();
});

test('login com senha errada mostra mensagem de erro e nao entra', async ({ page }) => {
  await page.goto('/');
  await page.locator('input[name="username"]').fill('admin');
  await page.locator('input[name="senha"]').fill('senha-errada');
  await page.getByRole('button', { name: 'Entrar' }).click();
  await expect(page.locator('[data-erro]')).toBeVisible();
  await expect(page).not.toHaveURL(/#\/dashboard/);
});

test('cadastra um Tipo de Fornecedor e ve o registro na lista', async ({ page }) => {
  await login(page);
  await page.goto('/#/config/fornecedor-tipos');
  await page.getByRole('button', { name: '+ Tipo' }).click();
  await page.locator('input[name="nome"]').fill('Posto E2E');
  await page.getByRole('button', { name: 'Cadastrar' }).click();
  await expect(page.getByText('Posto E2E')).toBeVisible();
});

test('selecao em lote: marca dois registros e exclui os dois de uma vez', async ({ page }) => {
  await login(page);
  await page.goto('/#/config/fornecedor-tipos');
  for (const nome of ['Lote E2E A', 'Lote E2E B']) {
    await page.getByRole('button', { name: '+ Tipo' }).click();
    await page.locator('input[name="nome"]').fill(nome);
    await page.getByRole('button', { name: 'Cadastrar' }).click();
    await expect(page.getByText(nome)).toBeVisible();
  }

  await page.locator('tr', { hasText: 'Lote E2E A' }).locator('[data-linha-check]').check();
  await page.locator('tr', { hasText: 'Lote E2E B' }).locator('[data-linha-check]').check();
  await expect(page.locator('[data-excluir-lote]')).toContainText('2');
  await page.locator('[data-excluir-lote]').click();
  await page.locator('[data-confirmar]').click();

  await expect(page.getByText('Lote E2E A')).not.toBeVisible();
  await expect(page.getByText('Lote E2E B')).not.toBeVisible();
});

test('matriz de permissoes: muda o nivel de um modulo e confirma que persiste ao reabrir', async ({ page }) => {
  await login(page);
  await page.goto('/#/usuarios');
  const usuarioNome = `Usuario E2E ${Date.now()}`;

  await page.getByRole('button', { name: '+ Usuario' }).click();
  await page.locator('input[name="nome"]').fill(usuarioNome);
  await page.locator('input[name="email"]').fill(`e2e${Date.now()}@teste.local`);
  await page.locator('input[name="username"]').fill(`e2e${Date.now()}`);
  await page.locator('input[name="senha"]').fill('senha123');
  await page.locator('select[name="perfil"]').selectOption('Comum');
  await page.getByRole('button', { name: 'Cadastrar' }).click();
  await expect(page.getByText(usuarioNome)).toBeVisible();

  const linha = page.locator('tr', { hasText: usuarioNome });
  await linha.getByRole('button', { name: 'Permissoes' }).click();
  // O radio fica visualmente escondido (sr-only, so o label estilizado
  // aparece) - clicar no <label> associado e o jeito real de marca-lo,
  // igual um usuario faria; clicar direto no input escondido nao funciona.
  await page.locator('label[for="perm-multas-Visualizar"]').click();
  await page.getByRole('button', { name: 'Salvar permissoes' }).click();
  await expect(page.getByRole('heading', { name: `Permissoes - ${usuarioNome}` })).not.toBeVisible();

  await linha.getByRole('button', { name: 'Permissoes' }).click();
  await expect(page.locator('[data-linha-modulo="multas"] input[value="Visualizar"]')).toBeChecked();
});

test('DRE: tela carrega e mostra o estado vazio sem quebrar quando nao ha dados no periodo', async ({ page }) => {
  await login(page);
  await page.goto('/#/dre');
  await expect(page.getByRole('heading', { name: 'DRE e Relatorios' })).toBeVisible();
  await expect(page.getByText('Sem dados no periodo.')).toBeVisible();
});
