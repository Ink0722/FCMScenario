import { expect, test } from '@playwright/test';
import { execFileSync } from 'node:child_process';

// Uses the real HTTP API, DB, Worker executor and OpenAI SDK, with an isolated
// provider transport. No paid traffic and no real credentials in this test.
function runAdvisor() {
  const python = process.env.FCM_PYTHON ?? `${process.env.CONDA_PREFIX}/bin/python`;
  execFileSync(python, ['-c', `
import json
from pathlib import Path
import httpx2
from openai import OpenAI
from backend.app.settings import Settings,ROOT
from backend.app.db import Database
from backend.app.content import ContentStore
from backend.app.service import Service
from backend.app.environment import EnvironmentSettings
from backend.app.advisor import AdvisorRuntime
from backend.tests.test_advisor import Provider
saved=json.loads((ROOT/'runtime/http-e2e-runtime.json').read_text())
s=Settings(saved['database_url'],Path(saved['artifact_dir']),'integration-secret-'*4,'123456')
db=Database(s.database_url)
a=AdvisorRuntime(db,Service(s,ContentStore(s.artifact_dir,s.study_file)),EnvironmentSettings(s))
a.client=lambda connection,key: OpenAI(api_key=key,max_retries=0,http_client=httpx2.Client(transport=httpx2.MockTransport(Provider())))
a.tick()
db.engine.dispose()
`], { cwd: '..' });
}

test('Advisor validation survives a lost response and reload, then enables a real-mode batch', async ({ page }) => {
  const errors: string[] = []; page.on('pageerror', error => errors.push(error.message));
  const admin = { Authorization: 'Bearer 123456' };
  const current = await (await page.request.get('/api/v1/admin/settings', { headers: admin })).json();
  await page.request.post('/api/v1/admin/settings', { headers: admin, data: {
    requestId: crypto.randomUUID(), revision: current.revision, environmentName: 'Advisor 联调测试',
    models: [{ id: 'openai-gpt54-mini', label: 'GPT 联调', baseUrl: 'https://api.openai.com/v1',
      modelName: 'gpt-5.4-mini-2026-03-17', apiKey: 'TEST-sdk-offline-only' }],
  } });
  await page.goto('/admin.html');
  await page.getByLabel('研究者口令').fill('123456');
  await page.getByRole('button', { name: '登录控制台' }).click();
  await page.getByRole('link', { name: '设置', exact: true }).click();
  let lose = true; const ids: string[] = [];
  await page.route('**/api/v1/admin/models/validate-advisor', async route => {
    ids.push(route.request().postDataJSON().requestId);
    if (lose) { lose = false; await route.fetch(); await route.abort('failed'); }
    else await route.continue();
  });
  await page.getByRole('button', { name: '验证 Advisor（消耗额度）', exact: true }).click();
  await expect(page.getByRole('alert')).toContainText('未能确认服务器响应');
  await page.reload();
  await page.getByRole('button', { name: '查询同一次 Advisor 验证' }).click();
  await expect(page.getByRole('button', { name: '验证处理中…' })).toBeDisabled();
  expect(ids).toHaveLength(2); expect(ids[0]).toBe(ids[1]);
  runAdvisor();
  await expect(page.getByText('真实 Advisor 验证通过：', { exact: false })).toBeVisible();
  await expect(page.getByText('3 次模型调用 · 2 次工具调用 · 策略 S00')).toBeVisible();
  await page.screenshot({ path: '../build/admin-qa/advisor-validation.png', fullPage: true });
  await page.getByRole('link', { name: '测试码与发放', exact: true }).click();
  await page.getByRole('combobox', { name: '本批模型', exact: false }).selectOption('openai-gpt54-mini');
  await page.getByRole('radio', { name: 'Neutral', exact: false }).check();
  await page.getByRole('checkbox', { name: '01', exact: true }).check();
  await page.getByLabel('批次名称').fill('advisor-sdk-browser-pilot');
  let loseCodes = true; const frozenRefs: string[] = [];
  await page.route('**/api/v1/admin/codes', async route => {
    frozenRefs.push(route.request().postDataJSON().configRef);
    if (loseCodes) {
      loseCodes = false; await route.fetch();
      const saved = await (await page.request.get('/api/v1/admin/settings')).json();
      await page.request.post('/api/v1/admin/settings', { headers: admin, data: {
        requestId: crypto.randomUUID(), revision: saved.revision, environmentName: saved.environmentName,
        models: saved.models.map((model: any) => ({ id: model.id, label: '已修改的连接名称', baseUrl: model.baseUrl, modelName: model.modelName })),
      } });
      return route.abort('failed');
    }
    return route.continue();
  });
  await page.getByRole('button', { name: '生成 1 个测试码', exact: true }).click();
  await expect(page.getByRole('alert')).toContainText('请求编号已保留');
  await page.reload();
  await expect(page.getByRole('status').filter({ hasText: '已恢复上次未确认的发放请求' })).toBeVisible();
  await page.getByRole('button', { name: '重试同一发放请求', exact: true }).click();
  expect(frozenRefs).toHaveLength(2); expect(frozenRefs[0]).toBe(frozenRefs[1]);
  const vault = page.getByRole('region', { name: '测试码生成结果' });
  await expect(vault).toContainText('已恢复生成结果');
  const row = await (await page.request.get('/api/v1/admin/participants?batch=advisor-sdk-browser-pilot')).json();
  const pid = row.items[0].participantId;
  const code = row.items[0].testCode;
  const grant = await (await page.request.post('/api/v1/access/exchange', { data: { requestId: crypto.randomUUID(), code } })).json();
  const headers = { Authorization: `Bearer ${grant.accessToken}` };
  const profile = await (await page.request.get('/api/v1/profile', { headers })).json();
  await page.request.post('/api/v1/profile', { headers, data: { requestId: crypto.randomUUID(),
    answers: Object.fromEntries(profile.questions.map((q: any) => [q.id, q.options[0].value])) } });
  const tasks = await (await page.request.get('/api/v1/tasks', { headers })).json();
  const started = await (await page.request.post(`/api/v1/tasks/${tasks[0].id}/start`, { headers, data: { requestId: crypto.randomUUID() } })).json();
  expect(started.session.runtimeMode).toBe('agent');
  const attempt = started.session.id;
  await page.request.post(`/api/v1/attempts/${attempt}/measurements/pre`, { headers, data: {
    requestId: crypto.randomUUID(), stage: 'pre', decision: { choice: 'A', confidence: 0 }, timestamp: new Date().toISOString() } });
  const turnId = crypto.randomUUID();
  await page.request.post(`/api/v1/attempts/${attempt}/turns`, { headers, data: {
    id: turnId, role: 'user', text: 'Explain the reference material.', timestamp: new Date().toISOString() } });
  runAdvisor();
  const stream = await page.request.get(`/api/v1/attempts/${attempt}/turns/${turnId}/events`, { headers });
  expect(await stream.text()).toContain('Compare costs over eight years');
  expect(await stream.text()).not.toContain('PRIVATE PREPARATION');
  await page.goto(`/admin.html#task/${tasks[0].id}`);
  await expect(page.locator('.admin-turn')).toHaveCount(1);
  await expect(page.getByText('Compare costs over eight years (01-01, p. 1).', { exact: true })).toBeVisible();
  await page.locator('.admin-turn-details > summary').click();
  await expect(page.locator('.admin-turn-details')).toContainText('Provider native summary.');
  await expect(page.locator('.admin-turn-details')).toContainText('select_strategy');
  const source = page.locator('.admin-message-assistant a').filter({ hasText: 'p. 1' }).first();
  await expect(source).toHaveAttribute('href', /\/documents\/01-01#page=1$/);
  expect((await page.request.get((await source.getAttribute('href'))!.split('#')[0])).status()).toBe(200);
  await page.locator('.admin-turn-details').getByText('查看原生摘要').first().click();
  await expect(page.locator('.admin-turn-details').getByText('Provider native summary.', { exact: true }).first()).toBeVisible();
  await page.screenshot({ path: '../build/admin-qa/advisor-replay.png', fullPage: true });
  await page.goto('/admin.html#participants?batch=advisor-sdk-browser-pilot');
  const exported = page.waitForEvent('download');
  await page.getByRole('link', { name: '导出研究数据 ZIP' }).click();
  expect((await exported).suggestedFilename()).toBe('fcm-research-data.zip');
  expect(await page.evaluate(() => JSON.stringify({ ...localStorage, ...sessionStorage }))).not.toContain('TEST-sdk-offline-only');
  expect(errors).toEqual([]);
});

test('budget warning disables a new live issuance before creating participants', async ({ page }) => {
  await page.goto('/admin.html');
  await page.getByLabel('研究者口令').fill('123456');
  await page.getByRole('button', { name: '登录控制台' }).click();
  await page.route('**/api/v1/admin/catalog', async route => {
    const response = await route.fetch(); const value = await response.json();
    value.models = value.models.map((model: any) => ({ ...model, runtimeReady: true }));
    await route.fulfill({ json: value });
  });
  await page.route('**/api/v1/admin/model-budget/estimate', route => route.fulfill({ json: {
    applies: true, taskCount: 1, minimumTurns: 3, estimatedPerTurnUsd: .03, estimatedMinimumUsd: .09,
    remainingUsd: .001, canIssue: false, message: '额度不足以覆盖本批最低轮数的参考用量，请先核对待确认费用。', basis: '参考估算，不预占预算。',
  } }));
  await page.getByRole('link', { name: '测试码与发放', exact: true }).click();
  await page.getByRole('radio', { name: 'Neutral', exact: false }).check();
  await page.getByRole('checkbox', { name: '01', exact: true }).check();
  await page.getByRole('combobox', { name: '本批模型', exact: false }).selectOption('openai-gpt54-mini');
  await expect(page.getByRole('status').filter({ hasText: '发放额度预检' })).toContainText('额度不足');
  await expect(page.getByRole('button', { name: '生成 1 个测试码', exact: true })).toBeDisabled();
  await page.screenshot({ path: '../build/admin-qa/budget-preflight.png', fullPage: true });
});
