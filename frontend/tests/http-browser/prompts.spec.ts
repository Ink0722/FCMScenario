import { expect, test } from '@playwright/test';
import { readFileSync } from 'node:fs';

const admin = { Authorization: 'Bearer 123456' };
async function openEditor(page: import('@playwright/test').Page) {
  await page.goto('/admin.html');
  await page.getByLabel('研究者口令').fill('123456');
  await page.getByRole('button', { name: '登录控制台' }).click();
  await page.getByRole('link', { name: '提示词', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Advisor 提示词', exact: true })).toBeVisible();
}

test('prompt panel saves all text groups and recovers an unconfirmed save after reload without another revision', async ({ page }) => {
  const errors: string[] = []; page.on('pageerror', error => errors.push(error.message));
  await openEditor(page);
  const initial = await (await page.request.get('/api/v1/admin/advisor-prompts')).json();
  const budget = (await (await page.request.get('/api/v1/admin/settings')).json()).modelBudget;
  await page.getByLabel('共同规则提示词', { exact: true }).fill(initial.config.prompt.instructions + '\nBROWSER-PROMPT-EDIT');
  await page.getByRole('button', { name: /^策略目录/ }).click();
  await expect(page.getByRole('navigation', { name: '编辑项目' }).getByRole('button')).toHaveCount(12);
  await page.getByRole('navigation', { name: '编辑项目' }).getByRole('button', { name: /^S01 / }).click();
  await page.getByLabel('分类边界', { exact: true }).fill(initial.config.strategies[1].boundary + ' BROWSER-BOUNDARY-EDIT');
  await page.getByLabel('策略执行提示词', { exact: true }).fill(initial.config.strategies[1].execution_prompt + ' BROWSER-CARD-EDIT');
  await page.screenshot({ path: test.info().outputPath('prompt-strategy-cards.png'), fullPage: true });
  await page.getByRole('button', { name: /^工具说明/ }).click();
  await page.getByLabel('工具说明', { exact: true }).fill(initial.config.tools[0].description + ' BROWSER-TOOL-EDIT');
  let lose = true; const requests: string[] = [];
  await page.route('**/api/v1/admin/advisor-prompts', async route => {
    if (route.request().method() !== 'POST') return route.continue();
    requests.push(route.request().postDataJSON().requestId);
    if (lose) { lose = false; await route.fetch(); return route.abort('failed'); }
    return route.continue();
  });
  await page.getByRole('button', { name: '保存提示词', exact: true }).click();
  await expect(page.getByRole('alert')).toContainText('未能确认服务器响应');
  page.once('dialog', dialog => dialog.accept());
  await page.reload();
  await page.getByRole('button', { name: '重试同一保存请求', exact: true }).click();
  await expect(page.getByRole('status').filter({ hasText: '提示词 v' })).toContainText('已保存');
  const saved = await (await page.request.get('/api/v1/admin/advisor-prompts')).json();
  expect(saved.revision).toBe(initial.revision + 1);
  expect(saved.config.prompt.instructions).toContain('BROWSER-PROMPT-EDIT');
  expect(saved.config.strategies[1].boundary).toContain('BROWSER-BOUNDARY-EDIT');
  expect(saved.config.strategies[1].execution_prompt).toContain('BROWSER-CARD-EDIT');
  expect(saved.config.tools[0].description).toContain('BROWSER-TOOL-EDIT');
  expect(requests).toHaveLength(2); expect(requests[0]).toBe(requests[1]);
  const after = (await (await page.request.get('/api/v1/admin/settings')).json()).modelBudget;
  expect(after).toEqual(budget);
  await expect(page.getByLabel('共同规则提示词', { exact: true })).toHaveValue(saved.config.prompt.instructions);
  const download = page.waitForEvent('download');
  await page.getByRole('button', { name: '导出 JSON', exact: true }).click();
  const exported = JSON.parse(readFileSync((await (await download).path())!, 'utf8'));
  expect(exported.config).toEqual(saved.config);
  expect(exported.draft).toBe(false);
  expect(exported.savedRuntimeRef).toBe(saved.runtimeRef);
  await page.screenshot({ path: test.info().outputPath('prompt-editor-desktop.png'), fullPage: true });
  await page.setViewportSize({ width: 768, height: 900 });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 2)).toBeTruthy();
  await page.screenshot({ path: test.info().outputPath('prompt-editor-tablet.png'), fullPage: true });
  expect(errors).toEqual([]);
});

test('prompt editor protects unsaved text, validates target placeholder, and reports competing edits', async ({ page }) => {
  await openEditor(page);
  const saved = await (await page.request.get('/api/v1/admin/advisor-prompts')).json();
  const items = page.getByRole('navigation', { name: '编辑项目' });
  await items.getByRole('button', { name: /^Goal 条件/ }).click();
  await page.getByLabel('Goal 条件提示词', { exact: true }).fill('Missing a target placeholder.');
  await page.getByRole('button', { name: '保存提示词', exact: true }).click();
  await expect(page.getByRole('alert')).toContainText('必须保留 {target}');
  await page.getByLabel('Goal 条件提示词', { exact: true }).fill(saved.config.prompt.goal);
  await items.getByRole('button', { name: /^开场白/ }).click();
  await page.getByLabel('开场白提示词', { exact: true }).fill('My unsaved opening.');
  page.once('dialog', dialog => dialog.dismiss());
  await page.getByRole('navigation', { name: '研究管理导航' }).getByRole('link', { name: '设置', exact: true }).click();
  await expect(page.getByLabel('开场白提示词', { exact: true })).toHaveValue('My unsaved opening.');
  saved.config.prompt.opening = 'Opening saved by another researcher.';
  const response = await page.request.post('/api/v1/admin/advisor-prompts', { headers: admin, data: {
    requestId: crypto.randomUUID(), revision: saved.revision, config: saved.config,
  } });
  expect(response.status()).toBe(200);
  await page.getByRole('button', { name: '保存提示词', exact: true }).click();
  await expect(page.getByRole('alert')).toContainText('其他页面更新');
  await expect(page.getByLabel('开场白提示词', { exact: true })).toHaveValue('My unsaved opening.');
  page.once('dialog', dialog => dialog.accept());
  await page.getByRole('button', { name: '重新读取最新版本', exact: true }).click();
  await expect(page.getByLabel('共同规则提示词', { exact: true })).toBeVisible();
  await items.getByRole('button', { name: /^开场白/ }).click();
  await expect(page.getByLabel('开场白提示词', { exact: true })).toHaveValue('Opening saved by another researcher.');
  await page.getByRole('button', { name: '此项恢复默认', exact: true }).click();
  await expect(page.getByLabel('开场白提示词', { exact: true })).toHaveValue(saved.defaults.prompt.opening);
  await page.getByRole('button', { name: '撤销修改', exact: true }).click();
  await expect(page.getByLabel('开场白提示词', { exact: true })).toHaveValue('Opening saved by another researcher.');
  await page.getByLabel('开场白提示词', { exact: true }).fill('Discard this draft when refreshing.');
  page.once('dialog', dialog => dialog.accept());
  await page.getByRole('button', { name: '刷新数据', exact: false }).click();
  await expect(page.getByLabel('共同规则提示词', { exact: true })).toBeVisible();
  await items.getByRole('button', { name: /^开场白/ }).click();
  await expect(page.getByLabel('开场白提示词', { exact: true })).toHaveValue('Opening saved by another researcher.');
});
