import { expect, test, type Page } from '@playwright/test';
import { execFileSync } from 'node:child_process';
import type { AllocationPlan } from '../../src/admin/types';

const admin = { Authorization: 'Bearer 123456' };
async function login(page: Page) {
  await page.goto('/admin.html');
  await page.getByLabel('研究者口令').fill('123456');
  await page.getByRole('button', { name: '登录控制台' }).click();
  await expect(page.getByRole('heading', { name: '研究总览', exact: true })).toBeVisible();
}
function drain() {
  const python = process.env.FCM_PYTHON ?? `${process.env.CONDA_PREFIX}/bin/python`;
  execFileSync(python, ['-c', `import json; from pathlib import Path; from backend.app.settings import Settings,ROOT; from backend.app.db import Database; from backend.app.content import ContentStore; from backend.app.service import Service; from backend.app.worker import tick; data=json.loads((ROOT/'runtime/http-e2e-runtime.json').read_text()); s=Settings(data['database_url'],Path(data['artifact_dir']),'integration-secret-'*4,'123456'); db=Database(s.database_url); svc=Service(s,ContentStore(s.artifact_dir,s.study_file)); [tick(db,svc) for _ in range(4)]`], { cwd: '..' });
}

async function savedPlan(page: Page, batch: string, modelId?: string): Promise<AllocationPlan> {
  const response = await page.request.post('/api/v1/admin/allocation-plans', { headers: admin, data: {
    requestId: crypto.randomUUID(), quotas: [{ caseId: '01', neutral: 5, goal: 3 }, { caseId: '02', neutral: 3, goal: 1 }, { caseId: '09', neutral: 2, goal: 2 }],
    tasksPerPerson: 2, maxTurns: 7, seed: 'copy-and-archive', batchId: batch, modelId,
    expiresAt: new Date(Date.now() + 86400000).toISOString(),
  } });
  expect(response.ok()).toBeTruthy(); return response.json();
}

test('quota allocation is separate, freezes a preview and issues the same matrix once after a lost response', async ({ page }) => {
  await login(page);
  await page.getByRole('link', { name: '配额随机分配', exact: true }).click();
  await page.getByLabel('每人任务数', { exact: true }).fill('2');
  for (const [number, count] of [['01', 2], ['02', 1], ['09', 1]] as const) {
    await page.getByLabel(`Case ${number} Neutral 配额`, { exact: true }).fill(String(count));
    await page.getByLabel(`Case ${number} Goal 配额`, { exact: true }).fill(String(count));
  }
  await page.getByLabel('批次名称', { exact: true }).fill('quota-ui-plan');
  await page.getByLabel('对话最大轮数', { exact: true }).fill('3');
  await page.screenshot({ path: '../build/admin-qa/quota-form.png', fullPage: true });
  await page.getByRole('button', { name: '生成随机分配预览', exact: true }).click();
  await expect(page).toHaveURL(/#allocation\/[0-9a-f]{64}$/);
  const ref = new URL(page.url()).hash.split('/')[1];
  const before = await (await page.request.get(`/api/v1/admin/allocation-plans/${ref}`)).json();
  expect(before.participantCount).toBe(4); expect(before.taskCount).toBe(8);
  expect((await (await page.request.get('/api/v1/admin/participants?batch=quota-ui-plan')).json()).total).toBe(0);
  await page.reload();
  await expect(page.getByRole('button', { name: '确认发放 4 个测试码', exact: true })).toBeEnabled();
  const ids: string[] = []; let lose = true;
  await page.route('**/api/v1/admin/allocation-plans/*/issue', async route => {
    ids.push(route.request().postDataJSON().requestId);
    if (lose) { lose = false; await route.fetch(); return route.abort('failed'); }
    await route.continue();
  });
  await page.getByRole('button', { name: '确认发放 4 个测试码', exact: true }).click();
  await expect(page.getByRole('alert')).toContainText('重试不会再次发放');
  await page.getByRole('button', { name: '恢复同一发放请求', exact: true }).click();
  await expect(page.getByRole('status').filter({ hasText: '已恢复发放结果' })).toBeVisible();
  await expect(page.locator('.admin-code-cell')).toHaveCount(4);
  expect(ids).toHaveLength(2); expect(ids[0]).toBe(ids[1]);
  const after = await (await page.request.get(`/api/v1/admin/allocation-plans/${ref}`)).json();
  expect(after.members.map((member: { tasks: unknown }) => member.tasks)).toEqual(before.members.map((member: { tasks: unknown }) => member.tasks));
  expect((await (await page.request.get('/api/v1/admin/participants?batch=quota-ui-plan')).json()).total).toBe(4);
  await page.screenshot({ path: '../build/admin-qa/quota-plan.png', fullPage: true });
  await page.setViewportSize({ width: 1100, height: 850 });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBeTruthy();
  await page.screenshot({ path: '../build/admin-qa/quota-plan-1100.png', fullPage: true });
  await page.getByRole('link', { name: '批次管理', exact: true }).click();
  const row = page.getByRole('row').filter({ hasText: 'quota-ui-plan' });
  await expect(row.getByRole('link', { name: '查看配额方案', exact: true })).toBeVisible();
  await expect(row.getByRole('button', { name: '复制配置', exact: true })).toHaveCount(0);
  await page.getByRole('link', { name: '测试码与发放', exact: true }).click();
  await expect(page.getByRole('group', { name: '选择发放任务', exact: true }).getByRole('checkbox')).toHaveCount(20);
  await expect(page.getByRole('heading', { name: '每个 case 的发放配额' })).toHaveCount(0);
});

test('infeasible quotas are explained and leaving an unsaved allocation can be cancelled', async ({ page }) => {
  await login(page);
  await page.getByRole('link', { name: '配额随机分配', exact: true }).click();
  await page.getByLabel('每人任务数', { exact: true }).fill('2');
  await page.getByLabel('Case 01 Neutral 配额', { exact: true }).fill('3');
  await expect(page.getByText('Neutral 共 3 份任务，需调整为每人任务数的整数倍。', { exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: '生成随机分配预览', exact: true })).toBeDisabled();
  await page.getByLabel('Case 01 Neutral 配额', { exact: true }).fill('4');
  await expect(page.getByText('Neutral 有 case 的配额超过该组人数；请降低该配额或增加其他 case 配额。', { exact: true })).toBeVisible();
  page.once('dialog', dialog => dialog.dismiss());
  await page.getByRole('link', { name: '测试码与发放', exact: true }).click();
  await expect(page.getByLabel('Case 01 Neutral 配额', { exact: true })).toHaveValue('4');
  await page.getByLabel('Case 02 Neutral 配额', { exact: true }).fill('4');
  await expect(page.getByRole('button', { name: '生成随机分配预览', exact: true })).toBeEnabled();
});

test('quota participant tasks unlock sequentially and remain ordered after completing the first task', async ({ page }) => {
  const preview = await (await page.request.post('/api/v1/admin/allocation-plans', { headers: admin, data: {
    requestId: crypto.randomUUID(), quotas: [{ caseId: '01', neutral: 1, goal: 0 }, { caseId: '02', neutral: 1, goal: 0 }],
    tasksPerPerson: 2, maxTurns: 3, seed: 'participant-ui-sequence', batchId: 'quota-participant-ui',
  } })).json();
  const issued = await (await page.request.post(`/api/v1/admin/allocation-plans/${preview.planRef}/issue`, { headers: admin, data: { requestId: crypto.randomUUID() } })).json();
  await page.goto('/');
  await page.getByLabel('Participant code', { exact: true }).fill(issued.codes[0].code);
  await page.getByRole('checkbox').check();
  await page.getByRole('button', { name: 'Begin', exact: true }).click();
  await page.getByRole('button', { name: 'Complete questionnaire', exact: true }).click();
  for (const group of await page.locator('.profile-form fieldset').all()) await group.getByRole('radio').first().check();
  await page.getByRole('button', { name: 'Submit and return to tasks' }).click();
  await expect(page.getByText('Complete the tasks in the assigned order. The next task opens after you finish the current one.', { exact: true })).toBeVisible();
  const choices = page.locator('.task-choice').getByRole('radio');
  await expect(choices).toHaveCount(2);
  await expect(choices.nth(0)).toBeEnabled(); await expect(choices.nth(1)).toBeDisabled();
  await page.screenshot({ path: '../build/admin-qa/quota-participant.png', fullPage: true });
  await choices.nth(0).check();
  await page.getByRole('button', { name: 'Begin task', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Initial choice', exact: true })).toBeVisible();
  await page.getByRole('radio').first().check();
  await page.getByLabel('Confidence value').fill('0');
  await page.getByRole('button', { name: 'Continue to conversation' }).click();
  for (let turn = 0; turn < 3; turn++) {
    await page.getByPlaceholder('Ask a question about the materials…').fill(`Question ${turn + 1}`);
    await page.getByRole('button', { name: 'Send', exact: true }).click();
    await expect(page.getByText('Your message is saved and queued. Waiting for a reply…')).toBeVisible();
    drain();
    if (turn < 2) await expect(page.getByPlaceholder('Ask a question about the materials…')).toBeEnabled();
  }
  await expect(page.getByRole('heading', { name: 'Final choice', exact: true })).toBeVisible();
  await page.getByRole('radio').first().check();
  await page.getByLabel('Confidence value').fill('50');
  await page.getByRole('button', { name: 'Submit final choice' }).click();
  await expect(page.getByRole('heading', { name: 'Task complete', exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Back to tasks', exact: true }).click();
  await expect(page.locator('.task-choice').getByRole('radio')).toHaveCount(1);
  await expect(page.locator('.task-choice').getByRole('radio')).toBeEnabled();
  await page.reload();
  await expect(page.locator('.task-choice').getByRole('radio')).toBeEnabled();
  await expect(page.getByText(`2. Case ${preview.members[0].tasks[1].caseId}`, { exact: true })).toBeVisible();
});

test('copy pre-fills quotas without reusing expiry or seed, shows distributions and recovers a lost deletion response', async ({ page }) => {
  const original = await savedPlan(page, 'quota-copy-source');
  await login(page);
  await page.goto(`/admin.html#allocation/${original.planRef}`);
  await page.getByText('A/B 目标与展示顺序', { exact: true }).click();
  await page.getByText('Case 组合共现次数', { exact: true }).click();
  const pair = original.cooccurrence.find(pair => pair.cases.join(':') === '01:02')!;
  await expect(page.getByLabel('Case 01 与 02 共现', { exact: true })).toHaveText(String(pair.neutral));
  await page.getByRole('combobox', { name: '共现实验条件', exact: true }).selectOption('goal');
  await expect(page.getByLabel('Case 01 与 02 共现', { exact: true })).toHaveText(String(pair.goal));
  await page.screenshot({ path: '../build/admin-qa/quota-distributions.png', fullPage: true });
  await page.getByRole('link', { name: '复制为新方案', exact: true }).click();
  await expect(page.getByLabel('Case 01 Neutral 配额', { exact: true })).toHaveValue('5');
  await expect(page.getByLabel('Case 02 Goal 配额', { exact: true })).toHaveValue('1');
  await expect(page.getByLabel('每人任务数', { exact: true })).toHaveValue('2');
  await expect(page.getByLabel('对话最大轮数', { exact: true })).toHaveValue('7');
  await expect(page.getByLabel('访问到期时间（北京时间）', { exact: true })).toHaveValue('');
  await page.getByText('随机种子（可选）', { exact: true }).click();
  await expect(page.getByLabel('随机种子', { exact: true })).toHaveValue('');
  page.once('dialog', dialog => dialog.dismiss());
  await page.getByRole('link', { name: '批次管理', exact: true }).click();
  await expect(page).toHaveURL(new RegExp(`copy=${original.planRef}$`));
  await page.getByLabel('批次名称', { exact: true }).fill('quota-copy-draft');
  await page.getByRole('button', { name: '生成随机分配预览', exact: true }).click();
  await expect(page).toHaveURL(/#allocation\/[0-9a-f]{64}$/);
  const copyRef = new URL(page.url()).hash.split('/')[1];
  expect(copyRef).not.toBe(original.planRef);
  const copy: AllocationPlan = await (await page.request.get(`/api/v1/admin/allocation-plans/${copyRef}`)).json();
  expect(copy.quotas).toEqual(original.quotas); expect(copy.seed).not.toBe(original.seed);
  expect(copy.expiresAt).toBeNull(); expect(copy.issued).toBe(false);
  page.once('dialog', dialog => dialog.dismiss());
  await page.getByRole('button', { name: '删除未发放方案', exact: true }).click();
  await expect(page).toHaveURL(new RegExp(`${copyRef}$`));
  let lose = true; const ids: string[] = [];
  await page.route('**/api/v1/admin/allocation-plans/*/delete', async route => {
    ids.push(route.request().postDataJSON().requestId);
    if (lose) { lose = false; await route.fetch(); return route.abort('failed'); }
    await route.continue();
  });
  page.once('dialog', dialog => dialog.accept());
  await page.getByRole('button', { name: '删除未发放方案', exact: true }).click();
  await expect(page.getByRole('alert')).toContainText('重试可恢复操作结果');
  await page.getByRole('button', { name: '重试删除请求', exact: true }).click();
  await expect(page).toHaveURL(/#allocation$/);
  expect(ids).toHaveLength(2); expect(ids[0]).toBe(ids[1]);
  await expect(page.getByRole('row').filter({ hasText: 'quota-copy-draft' })).toHaveCount(0);
  expect((await page.request.get(`/api/v1/admin/allocation-plans/${copyRef}`, { headers: admin })).status()).toBe(404);
  const source: AllocationPlan = await (await page.request.get(`/api/v1/admin/allocation-plans/${original.planRef}`, { headers: admin })).json();
  expect(source.members).toEqual(original.members);
});

test('archive retries preserve issued codes, archived history can restore the same plan', async ({ page }) => {
  const plan = await savedPlan(page, 'quota-archive-ui');
  const issued = await (await page.request.post(`/api/v1/admin/allocation-plans/${plan.planRef}/issue`, { headers: admin, data: { requestId: crypto.randomUUID() } })).json();
  await login(page);
  await page.goto(`/admin.html#allocation/${plan.planRef}`);
  let lose = true;
  await page.route('**/api/v1/admin/allocation-plans/*/archive', async route => {
    if (lose) { lose = false; await route.fetch(); return route.abort('failed'); }
    await route.continue();
  });
  await page.getByRole('button', { name: '归档方案', exact: true }).click();
  await expect(page.getByRole('alert')).toContainText('重试可恢复操作结果');
  await page.getByRole('button', { name: '重试归档请求', exact: true }).click();
  await expect(page.getByRole('button', { name: '恢复到当前方案', exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: '删除未发放方案', exact: true })).toHaveCount(0);
  await page.getByRole('link', { name: '← 新建配额方案 / 历史', exact: true }).click();
  await expect(page.getByRole('row').filter({ hasText: 'quota-archive-ui' })).toHaveCount(0);
  await page.getByRole('combobox', { name: '方案范围', exact: true }).selectOption('archived');
  const row = page.getByRole('row').filter({ hasText: 'quota-archive-ui' });
  await expect(row).toContainText('已归档');
  await row.getByRole('link', { name: '打开方案 →', exact: true }).click();
  await page.reload();
  const archived: AllocationPlan = await (await page.request.get(`/api/v1/admin/allocation-plans/${plan.planRef}`)).json();
  expect(archived.archived).toBe(true);
  expect(archived.members.map(member => member.code)).toEqual(issued.codes.map((row: { code: string }) => row.code));
  await page.getByRole('button', { name: '恢复到当前方案', exact: true }).click();
  await expect(page.getByRole('button', { name: '归档方案', exact: true })).toBeVisible();
  await page.getByRole('link', { name: '← 新建配额方案 / 历史', exact: true }).click();
  await expect(page.getByRole('row').filter({ hasText: 'quota-archive-ui' })).toContainText('已发放');
});

test('copying a real model plan requires an explicit fresh model choice', async ({ page }) => {
  const settings = await (await page.request.get('/api/v1/admin/settings', { headers: admin })).json();
  await page.request.post('/api/v1/admin/settings', { headers: admin, data: {
    requestId: crypto.randomUUID(), revision: settings.revision, environmentName: settings.environmentName, notes: settings.notes,
    models: [...settings.models.map((model: { id: string; label: string; baseUrl: string; modelName: string }) => ({ id: model.id, label: model.label, baseUrl: model.baseUrl, modelName: model.modelName })),
      { id: 'quota-copy-model', label: '复制模型', baseUrl: 'https://example.test/v1', modelName: 'copy-test', apiKey: 'fake-copy-test-key' }],
  } });
  const plan = await savedPlan(page, 'quota-copy-agent', 'quota-copy-model');
  await login(page);
  await page.goto(`/admin.html#allocation?copy=${plan.planRef}`);
  await expect(page.getByRole('combobox', { name: '本方案模型', exact: true })).toHaveValue('__confirm__');
  await expect(page.getByRole('button', { name: '生成随机分配预览', exact: true })).toBeDisabled();
  await page.getByRole('combobox', { name: '本方案模型', exact: true }).selectOption('');
  await expect(page.getByRole('button', { name: '生成随机分配预览', exact: true })).toBeEnabled();
  await page.getByRole('button', { name: '生成随机分配预览', exact: true }).click();
  await expect(page).toHaveURL(/#allocation\/[0-9a-f]{64}$/);
  await expect(page.getByRole('button', { name: '确认发放 8 个测试码', exact: true })).toBeEnabled();
});
