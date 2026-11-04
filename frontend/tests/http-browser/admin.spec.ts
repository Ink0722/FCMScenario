import { expect, test, type APIRequestContext, type Page } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';

test.use({ timezoneId: 'America/Los_Angeles' });
const adminPassword = '123456'; // Isolated test server only.
const adminHeader = { Authorization: `Bearer ${adminPassword}` };
async function login(page: Page) {
  await page.goto('/admin.html');
  await page.getByLabel('研究者口令').fill(adminPassword);
  await page.getByRole('button', { name: '登录控制台' }).click();
  await expect(page.getByRole('heading', { name: '研究总览', exact: true })).toBeVisible();
}
async function post(request: APIRequestContext, path: string, data: unknown, headers = adminHeader) {
  const response = await request.post(`/api/v1${path}`, { data, headers });
  expect(response.ok(), await response.text()).toBeTruthy();
  return response.status() === 204 ? undefined : response.json();
}
function drain() {
  const python = process.env.FCM_PYTHON ?? `${process.env.CONDA_PREFIX}/bin/python`;
  execFileSync(python, ['-c', `import json; from pathlib import Path; from backend.app.settings import Settings,ROOT; from backend.app.db import Database; from backend.app.content import ContentStore; from backend.app.service import Service; from backend.app.worker import tick; data=json.loads((ROOT/'runtime/http-e2e-runtime.json').read_text()); s=Settings(data['database_url'],Path(data['artifact_dir']),'integration-secret-'*4,'123456'); db=Database(s.database_url); svc=Service(s,ContentStore(s.artifact_dir,s.study_file)); [tick(db,svc) for _ in range(4)]`], { cwd: '..' });
}

test('researcher login persists, keeps credentials out of storage, and logout revokes session', async ({ page, context }) => {
  await page.goto('/admin.html');
  await page.screenshot({ path: '../build/admin-qa/login.png', fullPage: true });
  await page.getByLabel('研究者口令').fill('incorrect');
  await page.getByRole('button', { name: '登录控制台' }).click();
  await expect(page.getByRole('alert')).toContainText('口令不正确');
  await page.getByLabel('研究者口令').fill(adminPassword);
  await page.getByRole('button', { name: '登录控制台' }).click();
  await expect(page.getByRole('heading', { name: '研究总览', exact: true })).toBeVisible();
  await expect(page.getByText('正在读取记录…')).toHaveCount(0);
  await page.reload();
  await expect(page.getByRole('heading', { name: '研究总览', exact: true })).toBeVisible();
  const cookie = (await context.cookies()).find(c => c.name === 'fcm_researcher')!;
  expect(cookie.httpOnly).toBeTruthy(); expect(cookie.sameSite).toBe('Strict');
  expect(await page.evaluate(() => JSON.stringify({ ...localStorage, ...sessionStorage }))).not.toContain(adminPassword);
  await page.screenshot({ path: '../build/admin-qa/overview.png', fullPage: true });
  await page.getByRole('button', { name: '退出登录', exact: true }).click();
  await expect(page.getByLabel('研究者口令')).toBeVisible();
  const replay = await page.request.get('/api/v1/admin/participants', { headers: { Cookie: `fcm_researcher=${cookie.value}` } });
  expect(replay.status()).toBe(401);
});

test('generate chosen groups in one step, persist codes, export a batch, rotate and cancel', async ({ page }) => {
  const errors: string[] = []; page.on('pageerror', error => errors.push(error.message));
  await login(page);
  await page.getByRole('link', { name: '测试码与发放', exact: true }).click();
  await expect(page.getByRole('button', { name: '生成 0 个测试码' })).toBeDisabled();
  await page.getByRole('radio', { name: '两组分别配置' }).check();
  await page.getByLabel('Neutral 测试码数量', { exact: true }).fill('3');
  await page.getByLabel('Goal 测试码数量', { exact: true }).fill('2');
  await page.getByRole('checkbox', { name: '01', exact: true }).check();
  await page.getByLabel('对话最大轮数').fill('3');
  await page.getByLabel('批次名称').fill('admin-ui-pilot');
  await page.getByLabel('访问到期时间（北京时间）').fill('2035-01-02T10:30');
  await page.evaluate(() => window.scrollTo(0, 0));
  await page.screenshot({ path: '../build/admin-qa/issue.png', fullPage: true });
  const issuedRequest = page.waitForRequest(r => r.url().endsWith('/admin/codes') && r.method() === 'POST');
  await page.getByRole('button', { name: '生成 5 个测试码', exact: true }).click();
  const data = (await issuedRequest).postDataJSON();
  expect(data.groups).toEqual([{ condition: 'neutral', count: 3 }, { condition: 'goal', count: 2 }]);
  expect(data.expiresAt).toBe('2035-01-02T02:30:00.000Z');
  const result = page.getByRole('region', { name: '测试码生成结果' });
  await expect(result).toContainText('测试码已生成 · admin-ui-pilot · 5 个测试码');
  const downloadPromise = page.waitForEvent('download');
  await result.getByRole('button', { name: '下载 CSV' }).click();
  const csv = readFileSync((await (await downloadPromise).path())!, 'utf8');
  const rows = csv.replace(/^\uFEFF/, '').trim().split('\r\n').slice(1).map(line => line.split(','));
  expect(rows).toHaveLength(5);
  expect(rows.filter(r => r[2] === 'neutral')).toHaveLength(3);
  expect(rows.filter(r => r[2] === 'goal')).toHaveLength(2);
  const [pid, oldCode] = rows[0];
  // A result no longer blocks another generation, and the next batch retains the selected settings.
  await expect(page.getByRole('button', { name: '生成 5 个测试码', exact: true })).toBeEnabled();
  const grant = await post(page.request, '/access/exchange', { requestId: crypto.randomUUID(), code: oldCode }, {});
  await page.reload();
  await page.getByRole('link', { name: '参与记录', exact: true }).click();
  await page.getByRole('combobox', { name: '批次', exact: true }).selectOption('admin-ui-pilot');
  await page.getByRole('button', { name: '筛选', exact: true }).click();
  await expect(page.getByText('共 5 条记录')).toBeVisible();
  await expect(page.locator('.admin-code-cell code').filter({ hasText: oldCode })).toBeVisible();
  const exportPromise = page.waitForEvent('download');
  await page.getByRole('link', { name: '导出筛选结果', exact: true }).click();
  const exported = readFileSync((await (await exportPromise).path())!, 'utf8');
  expect(exported.trim().split('\r\n')).toHaveLength(6);
  expect(exported).toContain(oldCode); expect(exported).toContain('2035-01-02T10:30:00+08:00');
  // Metadata must show Beijing time even in a Los Angeles browser.
  const records = await (await page.request.get('/api/v1/admin/participants?batch=admin-ui-pilot')).json();
  const bj = new Intl.DateTimeFormat('zh-CN', { timeZone: 'Asia/Shanghai', year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',hourCycle:'h23' }).format(new Date(records.items[0].assignedAt));
  await expect(page.locator('.admin-date-cell').first()).toHaveText(bj);
  await page.screenshot({ path: '../build/admin-qa/participants.png', fullPage: true });
  await page.getByLabel('参与者编号或测试码', { exact: true }).fill(oldCode);
  await page.getByRole('button', { name: '筛选', exact: true }).click();
  await expect(page.getByText('共 1 条记录')).toBeVisible();
  await page.getByRole('link', { name: `FCM · ${pid.slice(0, 8).toUpperCase()}`, exact: true }).click();
  await page.getByRole('button', { name: '换发测试码', exact: true }).click();
  await page.getByRole('button', { name: '确认换码', exact: true }).click();
  await expect(result).toContainText('换码已完成');
  const newCode = (await result.locator('.admin-code-cell code').textContent())!;
  expect(newCode).not.toBe(oldCode);
  expect((await page.request.get('/api/v1/tasks', { headers: { Authorization: `Bearer ${grant.accessToken}` } })).status()).toBe(401);
  expect((await page.request.post('/api/v1/access/exchange', { data: { requestId: crypto.randomUUID(), code: oldCode } })).status()).toBe(401);
  await post(page.request, '/access/exchange', { requestId: crypto.randomUUID(), code: newCode }, {});
  await page.reload();
  await expect(page.locator('.admin-current-code code')).toHaveText(newCode);
  await page.getByRole('button', { name: '取消访问', exact: true }).click();
  await page.getByRole('button', { name: '确认取消访问', exact: true }).click();
  await expect(page.getByRole('status').filter({ hasText: '访问已取消' })).toBeVisible();
  expect((await page.request.post('/api/v1/access/exchange', { data: { requestId: crypto.randomUUID(), code: newCode } })).status()).toBe(401);
  await expect(page.locator('.admin-current-code code')).toHaveText(newCode);
  await page.screenshot({ path: '../build/admin-qa/participant.png', fullPage: true });
  expect(errors).toEqual([]);
});

test('replay switches between abandoned and complete attempts, with zero confidence intact', async ({ page }) => {
  const request = page.request;
  const preview = await post(request, '/admin/code-preview', { taskCodes: ['task-7k3m'], maxTurns: 3 });
  const issued = await post(request, '/admin/codes', { requestId: crypto.randomUUID(), configRef: preview.configRef, groups: [{condition: 'goal', count: 1}], batchId: 'replay-pilot' });
  const grant = await post(request, '/access/exchange', { requestId: crypto.randomUUID(), code: issued.codes[0].code }, {});
  const headers = { Authorization: `Bearer ${grant.accessToken}` };
  const profile = await (await request.get('/api/v1/profile', { headers })).json();
  await post(request, '/profile', { requestId: crypto.randomUUID(), answers: Object.fromEntries(profile.questions.map((q: any) => [q.id, q.options[0].value])) }, headers);
  const tasks = await (await request.get('/api/v1/tasks', { headers })).json();
  let active = await post(request, `/tasks/${tasks[0].id}/start`, { requestId: crypto.randomUUID() }, headers);
  const decision = async (stage: string, confidence: number) => post(request, `/attempts/${active.session.id}/measurements/${stage}`, { requestId: crypto.randomUUID(), stage, decision: { choice: stage === 'pre' ? 'A' : 'B', confidence }, timestamp: new Date().toISOString() }, headers);
  await decision('pre', 0);
  await post(request, `/attempts/${active.session.id}/turns`, { id: crypto.randomUUID(), role: 'user', text: 'A preserved abandoned question', timestamp: new Date().toISOString() }, headers);
  await post(request, `/attempts/${active.session.id}/abandon`, { requestId: crypto.randomUUID() }, headers);
  active = await post(request, `/tasks/${tasks[0].id}/start`, { requestId: crypto.randomUUID() }, headers);
  await decision('pre', 0);
  for (let i = 0; i < 3; i++) {
    await post(request, `/attempts/${active.session.id}/turns`, { id: crypto.randomUUID(), role: 'user', text: `Replay question ${i}`, timestamp: new Date().toISOString() }, headers);
    drain();
  }
  await decision('post', 100);
  await post(request, `/attempts/${active.session.id}/complete`, { requestId: crypto.randomUUID() }, headers);
  await login(page);
  await page.goto(`/admin.html#task/${tasks[0].id}`);
  await expect(page.getByLabel('选择历史尝试')).toContainText('第 2 次尝试 · 已完成');
  await expect(page.locator('.admin-measure').first()).toContainText('信心度 0');
  await expect(page.locator('.admin-measure').last()).toContainText('信心度 100');
  await expect(page.locator('.admin-turn')).toHaveCount(3);
  await page.locator('.admin-turn-details summary').first().click();
  await expect(page.locator('.admin-turn-details').first().getByText('当前使用确定性开发回复，未调用真实模型或工具。')).toBeVisible();
  await page.evaluate(() => window.scrollTo(0, 0));
  await page.screenshot({ path: '../build/admin-qa/replay.png', fullPage: true });
  await page.getByLabel('选择历史尝试').selectOption({ index: 0 });
  await expect(page.getByText('A preserved abandoned question', { exact: true })).toBeVisible();
  await expect(page.locator('.admin-turn').getByText('已取消')).toBeVisible();
  await page.setViewportSize({ width: 1100, height: 850 });
  await page.evaluate(() => window.scrollTo(0, 0));
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBeTruthy();
  await page.screenshot({ path: '../build/admin-qa/replay-1100.png', fullPage: true });
});

test('a lost issuance response restores saved codes without generating another participant', async ({ page }) => {
  await login(page);
  await page.getByRole('link', { name: '测试码与发放', exact: true }).click();
  await page.getByRole('radio', { name: 'Neutral', exact: false }).check();
  await page.getByRole('checkbox', { name: '01', exact: true }).check();
  await page.getByLabel('批次名称').fill('lost-response-pilot');
  const ids: string[] = []; let lose = true;
  await page.route('**/api/v1/admin/codes', async route => {
    ids.push(route.request().postDataJSON().requestId);
    if (lose) { lose = false; await route.fetch(); await route.abort('failed'); }
    else await route.continue();
  });
  await page.getByRole('button', { name: '生成 1 个测试码', exact: true }).click();
  await expect(page.getByRole('alert')).toContainText('请求编号已保留');
  await page.getByRole('button', { name: '重试同一发放请求' }).click();
  await expect(page.getByRole('region', { name: '测试码生成结果' })).toContainText('已恢复生成结果');
  await expect(page.locator('.admin-vault .admin-code-cell code')).toHaveCount(1);
  expect(ids).toHaveLength(2); expect(ids[0]).toBe(ids[1]);
  const result = await (await page.request.get('/api/v1/admin/participants?batch=lost-response-pilot')).json();
  expect(result.total).toBe(1);
});


test('settings retain environment and model connection while keeping API keys private', async ({ page }) => {
  await login(page);
  await page.getByRole('link', { name: '设置', exact: true }).click();
  await expect(page.getByRole('heading', { name: '设置', exact: true })).toBeVisible();
  await page.getByLabel('环境名称', { exact: true }).fill('Pilot 维护环境');
  await page.getByLabel('环境备注', { exact: true }).fill('供本地接口与材料联调使用');
  await page.getByRole('button', { name: '添加模型', exact: false }).click();
  await page.getByLabel('显示名称', { exact: true }).fill('测试模型 A');
  await page.getByLabel('接口地址（Base URL）').fill('https://provider.example.test/v1');
  await page.getByLabel('模型名', { exact: true }).fill('fcm-test-model');
  await page.getByLabel('API Key', { exact: true }).fill('TEST-provider-key-private-value');
  let modelCalls = 0;
  await page.route('https://provider.example.test/**', route => { modelCalls++; return route.abort(); });
  await page.getByRole('button', { name: '保存设置', exact: true }).click();
  await expect(page.getByRole('status').filter({ hasText: '设置已保存' })).toBeVisible();
  await expect(page.locator('.admin-sidebar-bottom')).toContainText('Pilot 维护环境');
  await expect(page.getByLabel('API Key', { exact: true })).toHaveValue('');
  await expect(page.getByText('当前 API Key 已保存。页面不回显已保存的密钥。', { exact: true })).toBeVisible();
  await page.reload();
  await expect(page.getByLabel('环境名称', { exact: true })).toHaveValue('Pilot 维护环境');
  await expect(page.getByLabel('接口地址（Base URL）')).toHaveValue('https://provider.example.test/v1');
  await expect(page.getByLabel('模型名', { exact: true })).toHaveValue('fcm-test-model');
  const response = await page.request.get('/api/v1/admin/settings');
  expect(await response.text()).not.toContain('TEST-provider-key-private-value');
  expect(await page.evaluate(() => JSON.stringify({ ...localStorage, ...sessionStorage }))).not.toContain('TEST-provider-key-private-value');
  await page.screenshot({ path: '../build/admin-qa/settings.png', fullPage: true });
  await page.getByLabel('环境备注', { exact: true }).fill('更新备注，保留已有 API Key');
  await page.getByRole('button', { name: '保存设置', exact: true }).click();
  await expect(page.getByRole('status').filter({ hasText: '设置已保存' })).toBeVisible();
  await expect(page.getByLabel('删除已保存的 API Key', { exact: true })).toBeVisible();
  await page.getByLabel('删除已保存的 API Key', { exact: true }).check();
  await page.getByRole('button', { name: '保存设置', exact: true }).click();
  await expect(page.getByText('当前未保存 API Key。', { exact: true })).toBeVisible();
  expect(modelCalls).toBe(0);
  await page.getByRole('link', { name: '测试码与发放', exact: true }).click();
  const picker = page.getByRole('group', { name: '选择发放任务', exact: true });
  await expect(picker.getByRole('checkbox')).toHaveCount(20);
  expect((await picker.innerText()).replace(/\s+/g, ' ').trim()).toContain('01');
  expect(await picker.innerText()).not.toContain('TASK-');
  expect((await picker.boundingBox())!.height).toBeLessThan(120);
  await page.getByRole('checkbox', { name: '01', exact: true }).check();
  await page.getByRole('checkbox', { name: '20', exact: true }).check();
  await expect(page.getByText('已选 2 项', { exact: false })).toBeVisible();
  await page.screenshot({ path: '../build/admin-qa/tasks-compact.png', fullPage: true });
  await page.setViewportSize({ width: 1100, height: 850 });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBeTruthy();
  await page.screenshot({ path: '../build/admin-qa/issue-1100.png', fullPage: true });
});

test('batch model is optional; selecting a registered model freezes a preview without issuing fake live tests', async ({ page }) => {
  await login(page);
  const current = await (await page.request.get('/api/v1/admin/settings')).json();
  await post(page.request, '/admin/settings', {
    requestId: crypto.randomUUID(), revision: current.revision, environmentName: current.environmentName, notes: '',
    models: [
      { id: 'batch-model-a', label: '模型 A', baseUrl: 'https://model-a.example.test/v1', modelName: 'test-a', apiKey: 'TEST-key-a' },
      { id: 'batch-model-b', label: '模型 B', baseUrl: 'https://model-b.example.test/v1', modelName: 'test-b', apiKey: 'TEST-key-b' },
    ],
  });
  await page.getByRole('link', { name: '测试码与发放', exact: true }).click();
  const chooser = page.getByRole('combobox', { name: '本批模型', exact: false });
  await expect(chooser).toHaveValue('');
  await page.getByRole('radio', { name: 'Neutral', exact: false }).check();
  await page.getByRole('checkbox', { name: '01', exact: true }).check();
  await page.getByLabel('批次名称').fill('model-selection-pilot');
  await chooser.selectOption('batch-model-b');
  const responsePromise = page.waitForResponse(r => r.url().endsWith('/admin/code-preview') && r.request().method() === 'POST');
  await page.getByRole('button', { name: '预览模型安排', exact: true }).click();
  const response = await responsePromise;
  const preview = await response.json();
  expect(preview.model.id).toBe('batch-model-b'); expect(preview.canIssue).toBe(false);
  expect(JSON.stringify(preview)).not.toContain('TEST-key-b');
  await expect(page.getByRole('status').filter({ hasText: '模型安排已冻结' })).toBeVisible();
  expect((await (await page.request.get('/api/v1/admin/participants?batch=model-selection-pilot')).json()).total).toBe(0);
  await page.evaluate(() => window.scrollTo(0, 0));
  await page.screenshot({ path: '../build/admin-qa/model-selection.png', fullPage: true });
  // Explicitly selecting no model keeps the existing deterministic workflow usable.
  await chooser.selectOption('');
  await page.getByRole('button', { name: '生成 1 个测试码', exact: true }).click();
  await expect(page.getByRole('region', { name: '测试码生成结果' })).toBeVisible();
  const rows = await (await page.request.get('/api/v1/admin/participants?batch=model-selection-pilot')).json();
  expect(rows.total).toBe(1);
});

test('preset GPT connection requires a saved key and connection verification retries reuse the same request', async ({ page }) => {
  await login(page);
  const current = await (await page.request.get('/api/v1/admin/settings')).json();
  await post(page.request, '/admin/settings', {
    requestId: crypto.randomUUID(), revision: current.revision, environmentName: current.environmentName,
    models: [{ id: 'openai-gpt54-mini', label: 'GPT-5.4 mini（联调）', baseUrl: 'https://api.openai.com/v1', modelName: 'gpt-5.4-mini-2026-03-17' }],
  });
  // This browser test never calls a paid provider, even after saving its fake key.
  const ids: string[] = []; let lose = true;
  await page.route('**/api/v1/admin/models/probe', async route => {
    ids.push(route.request().postDataJSON().requestId);
    if (lose) { lose = false; return route.abort('failed'); }
    return route.fulfill({ json: {
      requestId: ids[0], modelId: 'openai-gpt54-mini', status: 'succeeded', message: '连接验证成功；正式实验执行器仍待接入。',
      responseText: 'Connection OK', usage: { inputTokens: 17, outputTokens: 3 }, costUsd: 0.00002625, costStatus: 'settled',
      finishedAt: new Date().toISOString(), budget: { ...current.modelBudget, spentUsd: 0.00002625, remainingUsd: 0.99997375, requestCount: 1 },
    } });
  });
  await page.getByRole('link', { name: '设置', exact: true }).click();
  await expect(page.getByLabel('当前编辑的模型')).toHaveValue('openai-gpt54-mini');
  const verify = page.getByRole('button', { name: '验证连接（消耗少量额度）' });
  await expect(verify).toBeDisabled();
  await expect(page.getByRole('heading', { name: '模型调用额度', exact: true })).toBeVisible();
  await page.getByLabel('API Key', { exact: true }).fill('TEST-not-a-real-openai-key');
  await expect(verify).toBeDisabled();
  await page.getByRole('button', { name: '保存设置', exact: true }).click();
  await expect(verify).toBeEnabled();
  expect(ids).toHaveLength(0);
  await verify.click();
  await expect(page.getByRole('alert')).toContainText('未能确认服务器响应');
  await page.getByRole('button', { name: '查看本次验证结果' }).click();
  await expect(page.getByRole('status').filter({ hasText: '连接验证成功' })).toBeVisible();
  expect(ids).toHaveLength(2); expect(ids[0]).toBe(ids[1]);
  await expect(page.getByLabel('API Key', { exact: true })).toHaveValue('');
  await page.evaluate(() => window.scrollTo(0, 0));
  await page.screenshot({ path: '../build/admin-qa/gpt-budget.png', fullPage: true });
  await page.setViewportSize({ width: 1100, height: 850 });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBeTruthy();
  await page.screenshot({ path: '../build/admin-qa/settings-1100.png', fullPage: true });
});

test('unsaved settings survive cancelled navigation, data refresh and browser history', async ({ page }) => {
  await login(page);
  await page.getByRole('link', { name: '设置', exact: true }).click();
  await page.getByLabel('环境备注', { exact: true }).fill('这段内容尚未保存，取消导航时应当保留。');
  await expect(page.getByText('● 尚未保存', { exact: true })).toBeVisible();
  page.once('dialog', dialog => dialog.dismiss());
  await page.getByRole('link', { name: '研究总览', exact: true }).click();
  await expect(page.getByRole('heading', { name: '设置', exact: true })).toBeVisible();
  page.once('dialog', dialog => dialog.dismiss());
  await page.getByRole('button', { name: '刷新数据', exact: false }).click();
  await expect(page.getByLabel('环境备注', { exact: true })).toHaveValue('这段内容尚未保存，取消导航时应当保留。');
  page.once('dialog', dialog => dialog.dismiss());
  await page.reload({ timeout: 5000 }).catch(() => undefined);
  await expect(page.getByLabel('环境备注', { exact: true })).toHaveValue('这段内容尚未保存，取消导航时应当保留。');
  page.once('dialog', dialog => dialog.dismiss());
  await page.goBack();
  await expect(page).toHaveURL(/#settings$/);
  await expect(page.getByLabel('环境备注', { exact: true })).toHaveValue('这段内容尚未保存，取消导航时应当保留。');
  page.once('dialog', dialog => dialog.accept());
  await page.getByRole('link', { name: '研究总览', exact: true }).click();
  await expect(page.getByRole('heading', { name: '研究总览', exact: true })).toBeVisible();
});

test('batch summaries copy a new arrangement and copied display IDs are searchable', async ({ page }) => {
  await login(page);
  const preview = await post(page.request, '/admin/code-preview', { taskCodes: ['task-7k3m', 'task-4p8r'], maxTurns: 7 });
  const issued = await post(page.request, '/admin/codes', { requestId: crypto.randomUUID(), configRef: preview.configRef,
    batchId: 'batch-copy-ui-test', groups: [{ condition: 'neutral', count: 2 }, { condition: 'goal', count: 1 }], expiresAt: '2035-01-02T02:30:00Z' });
  await page.getByRole('link', { name: '批次管理', exact: true }).click();
  await page.getByLabel('批次名称', { exact: true }).fill('batch-copy-ui-test');
  await page.getByRole('button', { name: '查找批次', exact: true }).click();
  const row = page.getByRole('row').filter({ hasText: 'batch-copy-ui-test' });
  await expect(row).toContainText('3 人');
  await expect(row).toContainText('Neutral 2 / Goal 1');
  await expect(row).toContainText('01 · 09');
  await page.screenshot({ path: '../build/admin-qa/batches.png', fullPage: true });
  await row.getByRole('button', { name: '复制配置', exact: true }).click();
  await expect(page.getByRole('status').filter({ hasText: '已复制 batch-copy-ui-test' })).toBeVisible();
  await expect(page.getByLabel('Neutral 测试码数量', { exact: true })).toHaveValue('2');
  await expect(page.getByLabel('Goal 测试码数量', { exact: true })).toHaveValue('1');
  await expect(page.getByRole('checkbox', { name: '01', exact: true })).toBeChecked();
  await expect(page.getByRole('checkbox', { name: '09', exact: true })).toBeChecked();
  await expect(page.getByLabel('对话最大轮数')).toHaveValue('7');
  await expect(page.getByLabel('批次名称', { exact: true })).toHaveValue('');
  await expect(page.getByLabel('访问到期时间（北京时间）')).toHaveValue('');
  await page.getByRole('button', { name: '生成 3 个测试码', exact: true }).click();
  await expect(page.getByRole('region', { name: '测试码生成结果' })).toContainText('3 个测试码');
  const original = await (await page.request.get('/api/v1/admin/participants?batch=batch-copy-ui-test')).json();
  expect(original.total).toBe(3);
  await page.goto(`/admin.html#participants?batch=batch-copy-ui-test&configRef=${preview.configRef}`);
  const display = original.items.find((item: { participantId: string }) => item.participantId === issued.participants[0]).codeDisplay;
  await page.getByLabel('参与者编号或测试码').fill(display);
  await page.getByRole('button', { name: '筛选', exact: true }).click();
  await expect(page.getByText('共 1 条记录 · 每页 20 条', { exact: true })).toBeVisible();
  await expect(page.getByRole('link', { name: display, exact: true })).toBeVisible();
});

test('uncertain verification history survives reload and audited reconciliation retries do not repeat', async ({ page }) => {
  await login(page);
  const python = process.env.FCM_PYTHON ?? `${process.env.CONDA_PREFIX}/bin/python`;
  execFileSync(python, ['-c', `import json; from pathlib import Path; from datetime import timedelta; from backend.app.settings import ROOT; from backend.app.db import Database,Job,now; from backend.app.model_runtime import KIND,RESERVE_NANO,MODEL_NAME; data=json.loads((ROOT/'runtime/http-e2e-runtime.json').read_text()); db=Database(data['database_url']); ctx=db.transaction(); s=ctx.__enter__(); s.add(Job(kind=KIND,scope_ref={},actor_id='researcher',idempotency_key='browser-uncertain-probe',status='uncertain',created_at=now()-timedelta(minutes=6),finished_at=now(),progress={'requestId':'browser-uncertain-probe','modelId':'test-history-model','modelLabel':'核对用测试模型','modelName':MODEL_NAME,'chargeNano':RESERVE_NANO,'usage':None,'message':'请求超时，等待供应商确认。','failureKind':'timeout','providerRequestId':'req_browser_history'})); ctx.__exit__(None,None,None); db.engine.dispose()`], { cwd: '..' });
  await page.getByRole('link', { name: '设置', exact: true }).click();
  let row = page.getByRole('row').filter({ hasText: '核对用测试模型' });
  await expect(row).toContainText('预占 $0.300576');
  await page.reload();
  row = page.getByRole('row').filter({ hasText: '核对用测试模型' });
  await row.getByRole('button', { name: '核对费用', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: '核对请求费用', exact: true });
  await dialog.getByLabel('输入 Token', { exact: true }).fill('0');
  await dialog.getByLabel('输出 Token（含推理）', { exact: true }).fill('0');
  await dialog.getByLabel('供应商记录 / 工单编号').fill('provider-browser-ticket');
  await dialog.getByLabel('核对依据', { exact: true }).fill('供应商工单确认测试请求已经结束，未产生输入或输出用量，已核对为零。');
  await dialog.getByRole('checkbox').check();
  await page.screenshot({ path: '../build/admin-qa/reconcile.png', fullPage: true });
  const ids: string[] = []; let lose = true;
  await page.route('**/api/v1/admin/models/probes/*/reconcile', async route => {
    ids.push(route.request().postDataJSON().requestId);
    if (lose) { lose = false; await route.fetch(); return route.abort('failed'); }
    await route.continue();
  });
  await dialog.getByRole('button', { name: '确认核对并结算', exact: true }).click();
  await expect(dialog.getByRole('alert')).toContainText('重试将沿用原请求编号');
  await dialog.getByRole('button', { name: '重试同一核对', exact: true }).click();
  await expect(dialog).not.toBeVisible();
  await expect(page.getByRole('status').filter({ hasText: '该请求的费用已核对' })).toBeVisible();
  await expect(row).toContainText('费用已人工核对');
  expect(ids).toHaveLength(2); expect(ids[0]).toBe(ids[1]);
  const history = await (await page.request.get('/api/v1/admin/models/probes')).json();
  expect(history.budget.limitUsd).toBe(1); expect(history.budget.reservedUsd).toBe(0); expect(history.total).toBe(1);
  await page.reload();
  await expect(page.getByRole('row').filter({ hasText: '核对用测试模型' })).toContainText('费用已人工核对');
  await page.screenshot({ path: '../build/admin-qa/model-history.png', fullPage: true });
});
