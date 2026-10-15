import { expect, test, type Page } from '@playwright/test';

async function enterCode(page: Page, code: string) {
  await expect(page.getByRole('region', { name: '实验说明', exact: true })).toBeVisible();
  await page.getByLabel('测试编码', { exact: true }).fill(code);
  await page.getByRole('button', { name: '验证并继续' }).click();
  await expect(page.getByRole('heading', { name: '选择测试任务' })).toBeVisible();
  await expect(page.locator('.current-test-code')).toHaveText(`测试编码${code.trim().toUpperCase()}`);
  const fillProfile = page.getByRole('button', { name: '填写资料', exact: true });
  if (await fillProfile.count()) {
    await fillProfile.click();
    await expect(page.getByRole('heading', { name: '用户资料', exact: true })).toBeVisible();
    for (const group of await page.locator('.profile-form fieldset').all()) await group.getByRole('radio').first().check();
    await page.getByRole('button', { name: '提交并返回任务列表' }).click();
  }
  await expect(page.getByRole('heading', { name: '选择测试任务' })).toBeVisible();
  await expect(page.getByRole('region', { name: '实验说明', exact: true })).toBeVisible();
}
async function selectTask(page: Page, title: string) {
  await page.locator('.task-choice').filter({ hasText: title }).getByRole('radio').check();
  await page.getByRole('button', { name: '开始测试', exact: true }).click();
  await expect(page.getByRole('heading', { name: '初始判断' })).toBeVisible();
}
async function assertWorkspace(page: Page, rightName: string) {
  await expect(page.getByRole('region', { name: '实验说明', exact: true })).toHaveCount(0);
  const left = page.getByRole('complementary', { name: '原始场景材料' });
  const right = page.getByRole('region', { name: rightName, exact: true });
  await expect(left).toBeVisible();
  await expect(right).toBeVisible();
  const leftBox = await left.boundingBox();
  const rightBox = await right.boundingBox();
  expect(Math.abs(leftBox!.y - rightBox!.y)).toBeLessThan(2);
  expect(leftBox!.x + leftBox!.width).toBeLessThanOrEqual(rightBox!.x + 1);
  await expect(left.getByRole('heading', { name: '决策任务', exact: true })).toHaveCount(0);
  await expect(right.getByRole('heading', { name: '决策任务', exact: true })).toHaveCount(1);
  await expect(page.getByText(/交互预览|预览设置|模拟回复|占位|示例题|本地交互/)).toHaveCount(0);
}

test('merged initial judgment, dialogue and final judgment share desktop material columns', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', e => errors.push(e.message));
  await page.goto('/');
  await enterCode(page, 'FCM-PROBE');
  await page.getByRole('radio').check();
  await page.getByRole('button', { name: '开始测试', exact: true }).click();
  await expect(page.getByRole('heading', { name: '初始判断' })).toBeVisible();
  await assertWorkspace(page, '初始判断');
  await expect(page.getByRole('button', { name: '我已阅读，继续' })).toHaveCount(0);
  await expect(page.getByRole('navigation', { name: '实验阶段' }).getByText('阅读与初始判断', { exact: true })).toBeVisible();
  await page.screenshot({ path: '../build/frontend-qa/initial-desktop.png', fullPage: true });
  const proceed = page.getByRole('button', { name: '确认并进入交流' });
  await expect(proceed).toBeDisabled();
  await page.getByRole('radio', { name: 'A 份额A' }).check();
  await expect(proceed).toBeDisabled();
  await page.getByLabel('置信度数值').fill('0');
  await proceed.click();
  await assertWorkspace(page, '与 AI 助手交流');
  await expect(page.getByRole('region', { name: '实验说明' })).toHaveCount(0);
  await expect(page.getByRole('button', { name: '结束交流', exact: true })).toHaveCount(0);
  const send = async (text: string) => {
    await page.getByPlaceholder('输入问题或想法').fill(text);
    await page.getByRole('button', { name: '发送', exact: true }).click();
    await expect(page.getByText('正在回复…')).toHaveCount(0);
  };
  await send('请帮我理解共同条件。');
  await send('两种份额的费用如何查看？');
  await expect(page.getByRole('heading', { name: '当前判断' })).toBeVisible();
  const probeTop = await page.getByRole('heading', { name: '当前判断' }).boundingBox();
  const historyBox = await page.locator('.message-history').boundingBox();
  expect(probeTop!.y).toBeGreaterThan(historyBox!.y);
  await expect(page.getByPlaceholder('输入问题或想法')).toBeDisabled();
  await page.screenshot({ path: '../build/frontend-qa/probe-desktop.png', fullPage: true });
  await expect(page.getByRole('button', { name: '结束交流', exact: true })).toHaveCount(0);
  await page.getByRole('radio', { name: 'B 份额B' }).check();
  await page.getByLabel('置信度数值').fill('73');
  await page.getByRole('button', { name: '确认并继续交流' }).click();
  await expect(page.getByRole('heading', { name: '当前判断' })).toHaveCount(0);
  await expect(page.getByPlaceholder('输入问题或想法')).toBeEnabled();
  await send('我想再核对持有期限。');
  await page.getByRole('button', { name: '结束交流', exact: true }).click();
  await expect(page.getByRole('dialog')).toBeVisible();
  await page.getByRole('button', { name: '继续交流', exact: true }).click();
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await page.getByRole('button', { name: '结束交流', exact: true }).click();
  await page.getByRole('button', { name: '结束并继续' }).click();
  await expect(page.getByRole('heading', { name: '最终判断' })).toBeVisible();
  await assertWorkspace(page, '最终判断');
  await expect(page.getByLabel('置信度数值')).toHaveValue('');
  for (const radio of await page.getByRole('radio').all()) await expect(radio).not.toBeChecked();
  await page.screenshot({ path: '../build/frontend-qa/final-desktop.png', fullPage: true });
  await page.getByRole('radio', { name: 'B 份额B' }).check();
  await page.getByLabel('置信度数值').fill('100');
  await page.getByRole('button', { name: '确认最终判断' }).click();
  await expect(page.getByRole('heading', { name: '任务已完成' })).toBeVisible();
  await expect(page.getByRole('navigation', { name: '实验阶段' }).getByText('问卷', { exact: true })).toHaveCount(0);
  await expect(page.locator('.profile-form')).toHaveCount(0);
  await page.screenshot({ path: '../build/frontend-qa/completion-desktop.png', fullPage: true });
  await expect(page.getByText(/模拟|预览|占位|服务器/)).toHaveCount(0);
  await expect(page.getByRole('button', { name: '重新预览' })).toHaveCount(0);
  await page.getByRole('button', { name: '返回任务列表' }).click();
  await expect(page.getByRole('heading', { name: '本次测试已完成' })).toBeVisible();
  await expect(page.getByRole('heading', { name: '所有作答已保存' })).toBeVisible();
  await expect(page.getByText('你可以关闭页面了。谢谢你的时间和认真作答。')).toBeVisible();
  await expect(page.getByRole('region', { name: '实验说明' })).toHaveCount(0);
  await expect(page.getByRole('button', { name: '开始测试', exact: true })).toHaveCount(0);
  await expect(page.locator('.current-test-code')).toHaveText('测试编码FCM-PROBE');
  await expect(page.locator('.task-choice').getByText('已完成', { exact: true })).toBeVisible();
  await expect(page.getByRole('radio')).toHaveCount(0);
  await expect(page.locator('.task-status.completed').first()).toHaveCSS('color', 'rgb(40, 112, 76)');
  await page.screenshot({ path: '../build/frontend-qa/all-tasks-complete.png', fullPage: true, animations: 'disabled' });
  await page.reload();
  await expect(page.getByRole('heading', { name: '本次测试已完成' })).toBeVisible();
  await expect(page.locator('.current-test-code')).toHaveText('测试编码FCM-PROBE');
  expect(errors).toEqual([]);
});

test('all scenarios preserve material and task text with 42 available PDFs', async ({ page, request }) => {
  test.setTimeout(120_000);
  const manifest = await (await request.get('/materials/manifest.json')).json();
  const bundle = await (await request.get(`/materials/${manifest.snapshot}`)).json();
  expect(bundle.scenarios).toHaveLength(20);
  let documents = 0;
  for (const scenario of bundle.scenarios) {
    await page.goto('/');
    await page.evaluate(() => sessionStorage.clear());
    await page.reload();
    await enterCode(page, 'FCM-ALL');
    await selectTask(page, scenario.title);
    await expect(page.getByRole('heading', { level: 2, name: scenario.title, exact: true })).toBeVisible();
    await assertWorkspace(page, '初始判断');
    const submitBox = await page.getByRole('button', { name: '确认并进入交流' }).boundingBox();
    expect(submitBox!.y + submitBox!.height).toBeLessThanOrEqual(page.viewportSize()!.height);
    expect(scenario.source_file).toBeUndefined();
    expect(scenario.goal).toBeUndefined();
    expect(scenario.answer).toBeUndefined();
    const task = page.getByRole('region', { name: '决策任务', exact: true });
    await expect(task.locator('.prose')).toHaveText(scenario.task);
    await expect(page.locator('a.reference-link')).toHaveCount(scenario.references.length);
    for (const info of scenario.additional_information)
      await expect(page.getByRole('complementary').getByRole('heading', { name: info.title, exact: true })).toHaveCount(1);
    for (const ref of scenario.references) {
      const response = await request.get(`/${ref.url}`);
      expect(response.status()).toBe(200);
      expect(response.headers()['content-type']).toContain('application/pdf');
      documents++;
    }
  }
  expect(documents).toBe(42);
  expect(bundle.scenarios.some((s: { template: string }) => s.template === 'cards')).toBe(true);
});

for (const viewport of [{ width: 1366, height: 768 }, { width: 1920, height: 1080 }]) {
  test(`desktop ${viewport.width}x${viewport.height} keeps two columns and independent scrolling`, async ({ page }) => {
    await page.setViewportSize(viewport);
    await page.goto('/');
    await enterCode(page, 'FCM-2026');
    await selectTask(page, '消费融资选择：较长优惠期与不同计息规则');
    await expect(page.getByRole('heading', { name: '初始判断' })).toBeVisible();
    await assertWorkspace(page, '初始判断');
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    expect(await page.evaluate(() => document.documentElement.scrollHeight <= innerHeight)).toBe(true);
    await expect(page.getByRole('complementary').getByText('TASK-4P8R', { exact: true })).toBeVisible();
    await expect(page.getByRole('banner').getByText('TASK-4P8R', { exact: true })).toHaveCount(0);
    const stagesBox = await page.getByRole('navigation', { name: '实验阶段' }).boundingBox();
    expect(stagesBox!.x).toBeGreaterThan(viewport.width / 2);
    expect(stagesBox!.x + stagesBox!.width).toBeGreaterThan(viewport.width - 70);
    const confidenceBox = await page.getByLabel('置信度数值').boundingBox();
    const sliderBox = await page.getByRole('slider').boundingBox();
    expect(confidenceBox!.y + confidenceBox!.height).toBeLessThan(viewport.height);
    expect(Math.abs(confidenceBox!.y - sliderBox!.y)).toBeLessThan(24);
    await page.getByRole('radio').first().check();
    await page.getByLabel('置信度数值').fill('47');
    const materials = page.getByRole('complementary', { name: '原始场景材料' });
    const sections = page.getByRole('navigation', { name: '材料章节' });
    await sections.getByRole('button', { name: '方案', exact: true }).click();
    const comparisonHeading = await materials.getByRole('heading', { name: '方案资料', exact: true }).boundingBox();
    const scrollBounds = await page.locator('.scenario-scroll').boundingBox();
    expect(comparisonHeading!.y).toBeGreaterThanOrEqual(scrollBounds!.y);
    expect(comparisonHeading!.y).toBeLessThan(scrollBounds!.y + 50);
    const cellAlignments = await materials.locator('th, td').evaluateAll(cells => cells.map(cell => {
      const style = getComputedStyle(cell); return [style.textAlign, style.verticalAlign];
    }));
    expect(cellAlignments.length).toBeGreaterThan(0);
    for (const alignment of cellAlignments) expect(alignment).toEqual(['center', 'middle']);
    await page.screenshot({ path: `../build/frontend-qa/material-comparison-${viewport.width}.png`, fullPage: true });
    await sections.getByRole('button', { name: 'PDF', exact: true }).click();
    await expect(materials.locator('.reference-link').first()).toBeInViewport();
    await expect(page.getByLabel('置信度数值')).toHaveValue('47');
    await expect(page.getByRole('radio').first()).toBeChecked();
    await sections.getByRole('button', { name: '情境', exact: true }).click();
    const rightBefore = await page.locator('.decision-scroll').evaluate(el => el.scrollTop);
    await page.locator('.scenario-scroll').hover();
    await page.mouse.wheel(0, 1500);
    await expect.poll(() => page.locator('.scenario-scroll').evaluate(el => el.scrollTop)).toBeGreaterThan(0);
    expect(await page.locator('.decision-scroll').evaluate(el => el.scrollTop)).toBe(rightBefore);
    await page.getByRole('radio').first().check();
    await page.getByRole('slider').focus();
    await page.getByRole('slider').press('End');
    await expect(page.getByLabel('置信度数值')).toHaveValue('100');
    await page.getByRole('button', { name: '确认并进入交流' }).click();
    await assertWorkspace(page, '与 AI 助手交流');
    await page.screenshot({ path: `../build/frontend-qa/dialogue-${viewport.width}.png`, fullPage: true });
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  });
}


test('entry requires a valid code and task selection remains editable only before start', async ({ page, request }) => {
  const snapshots: string[] = [];
  page.on('request', request => { if (request.url().includes('/snapshot-')) snapshots.push(request.url()); });
  await page.goto('/?case=17&probe=1');
  await expect(page.locator('.site-symbol')).toHaveAttribute('src', '/decision-mark.svg');
  await expect(page.locator('link[rel="icon"]')).toHaveAttribute('href', /(?:\.\/|\/)decision-mark\.svg$/);
  expect((await request.get('/decision-mark.svg')).ok()).toBe(true);
  const welcomeResponse = await page.request.get('/materials/instructions.json');
  expect(welcomeResponse.ok()).toBe(true);
  const welcome = await welcomeResponse.json();
  expect(Object.keys(welcome).sort()).toEqual(['revision', 'welcome']);
  await expect(page.getByRole('region', { name: '实验说明' }).locator('.prose')).toHaveText(welcome.welcome);
  expect(snapshots).toEqual([]);
  await expect(page.getByRole('heading', { name: '输入测试编码' })).toBeVisible();
  await expect(page.getByRole('heading', { name: '初始判断' })).toHaveCount(0);
  await expect(page.getByRole('button', { name: '验证并继续' })).toBeDisabled();
  await page.screenshot({ path: '../build/frontend-qa/code-entry.png', fullPage: true });
  await page.getByLabel('测试编码', { exact: true }).fill('INVALID');
  await page.getByRole('button', { name: '验证并继续' }).click();
  await expect(page.getByRole('alert')).toHaveText('没能识别这个编码，请核对后再试一次。');
  await page.getByLabel('测试编码', { exact: true }).fill('FCM-EXPIRED');
  await page.getByRole('button', { name: '验证并继续' }).click();
  await expect(page.getByRole('alert')).toHaveText('这个编码已过期，可以联系研究人员确认新的测试安排。');
  await enterCode(page, 'FCM-2026');
  await expect(page.getByRole('region', { name: '实验说明' }).locator('.prose')).toHaveText(welcome.welcome);
  await expect(page.getByRole('radio')).toHaveCount(3);
  await expect(page.getByRole('button', { name: '开始测试', exact: true })).toBeDisabled();
  await page.locator('.task-choice').filter({ hasText: 'TASK-7K3M' }).getByRole('radio').check();
  await page.locator('.task-choice').filter({ hasText: 'TASK-4P8R' }).getByRole('radio').check();
  await expect(page.locator('.task-choice').filter({ hasText: 'TASK-7K3M' }).getByRole('radio')).not.toBeChecked();
  await page.screenshot({ path: '../build/frontend-qa/task-selection.png', fullPage: true });
  await page.getByRole('button', { name: '开始测试', exact: true }).click();
  await expect(page.getByText('TASK-4P8R', { exact: true })).toBeVisible();
  await expect(page.getByRole('heading', { name: '消费融资选择：较长优惠期与不同计息规则', exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: '使用其他编码' })).toHaveCount(0);
  await expect(page.getByText(/场景\s*0[1-9]/)).toHaveCount(0);
  await page.reload();
  await expect(page.getByText('TASK-4P8R', { exact: true })).toBeVisible();
  await expect(page.getByRole('heading', { name: '选择测试任务' })).toHaveCount(0);
  await page.goto('/?case=01');
  await expect(page.getByText('TASK-4P8R', { exact: true })).toBeVisible();
});

test('refresh resumes the same task and conversation without resetting initial answers', async ({ page }) => {
  await page.goto('/');
  await enterCode(page, 'FCM-2026');
  await selectTask(page, '基金份额选择：八年持有');
  await page.getByRole('radio', { name: 'A 份额A' }).check();
  await page.getByLabel('置信度数值').fill('42');
  await page.getByRole('button', { name: '确认并进入交流' }).click();
  await page.getByPlaceholder('输入问题或想法').fill('请帮我核对费用。');
  await page.getByRole('button', { name: '发送', exact: true }).click();
  await expect(page.getByText('正在回复…')).toHaveCount(0);
  await page.reload();
  await assertWorkspace(page, '与 AI 助手交流');
  await expect(page.getByText('TASK-7K3M', { exact: true })).toBeVisible();
  await expect(page.getByText('请帮我核对费用。', { exact: true })).toBeVisible();
  await expect(page.locator('.message')).toHaveCount(3);
  await expect(page.getByRole('heading', { name: '初始判断' })).toHaveCount(0);
});

test('single-task and empty assignments have a clear entry state', async ({ page }) => {
  await page.goto('/');
  await enterCode(page, 'FCM-SINGLE');
  await expect(page.getByRole('radio')).toHaveCount(1);
  await expect(page.getByRole('button', { name: '开始测试', exact: true })).toBeDisabled();
  await page.getByRole('button', { name: '使用其他编码' }).click();
  await enterCode(page, 'FCM-EMPTY');
  await expect(page.getByRole('heading', { name: '还没有为你安排测试任务' })).toBeVisible();
  await expect(page.getByRole('button', { name: '开始测试', exact: true })).toHaveCount(0);
});

test('entrance instructions can recover from a loading failure without losing the code', async ({ page }) => {
  let unavailable = true;
  await page.route('**/materials/instructions.json', async route => {
    if (unavailable) await route.fulfill({ status: 503, body: 'Unavailable' });
    else await route.continue();
  });
  await page.goto('/');
  await expect(page.getByRole('alert')).toHaveText('实验说明暂时没能打开，请点击“重新加载”再试一次。');
  await page.getByLabel('测试编码', { exact: true }).fill('FCM-2026');
  await expect(page.getByRole('button', { name: '验证并继续' })).toBeDisabled();
  unavailable = false;
  await page.getByRole('button', { name: '重新加载', exact: true }).click();
  await expect(page.getByRole('region', { name: '实验说明' }).locator('.prose')).toBeVisible();
  await expect(page.getByRole('alert')).toHaveCount(0);
  await expect(page.getByLabel('测试编码', { exact: true })).toHaveValue('FCM-2026');
  await enterCode(page, 'FCM-2026');
});

test('profile is the first task, gates experiments and remains completed on re-entry', async ({ page }) => {
  await page.setViewportSize({ width: 1366, height: 768 });
  await page.goto('/');
  await page.getByLabel('测试编码', { exact: true }).fill('FCM-2026');
  await page.getByRole('button', { name: '验证并继续' }).click();
  await expect(page.getByRole('heading', { name: '选择测试任务' })).toBeVisible();
  const profileTask = page.getByRole('region', { name: '用户资料任务' });
  await expect(profileTask.getByText('待填写', { exact: true })).toBeVisible();
  for (const radio of await page.getByRole('radio').all()) await expect(radio).toBeDisabled();
  const profileBox = await profileTask.boundingBox();
  const firstTaskBox = await page.locator('.task-choice').first().boundingBox();
  expect(profileBox!.y + profileBox!.height).toBeLessThan(firstTaskBox!.y);
  await page.screenshot({ path: '../build/frontend-qa/profile-task-pending-1366.png', fullPage: true, animations: 'disabled' });
  await profileTask.getByRole('button', { name: '填写资料', exact: true }).click();
  await expect(page.getByRole('heading', { name: '用户资料', exact: true })).toBeVisible();
  await expect(page.getByRole('navigation', { name: '实验阶段' })).toHaveCount(0);
  await expect(page.getByText(/TASK-/)).toHaveCount(0);
  await expect(page.getByRole('button', { name: '提交并返回任务列表' })).toBeDisabled();
  await page.getByRole('radio', { name: '电脑', exact: true }).check();
  await page.getByRole('button', { name: '返回任务列表', exact: true }).click();
  await expect(page.getByRole('dialog').getByText(/返回后不会保存/)).toBeVisible();
  await page.getByRole('button', { name: '继续填写', exact: true }).click();
  await expect(page.getByRole('radio', { name: '电脑', exact: true })).toBeChecked();
  await page.getByRole('button', { name: '返回任务列表', exact: true }).click();
  await page.getByRole('button', { name: '确认返回', exact: true }).click();
  await expect(page.getByRole('heading', { name: '选择测试任务' })).toBeVisible();
  await expect(profileTask.getByText('待填写', { exact: true })).toBeVisible();
  await page.reload();
  await expect(page.getByRole('heading', { name: '选择测试任务' })).toBeVisible();
  await profileTask.getByRole('button', { name: '填写资料', exact: true }).click();
  await expect(page.getByRole('heading', { name: '用户资料', exact: true })).toBeVisible();
  await expect(page.getByRole('radio', { name: '电脑', exact: true })).not.toBeChecked();
  await page.getByRole('radio', { name: '电脑', exact: true }).check();
  await page.getByRole('radio', { name: '偶尔使用', exact: true }).check();
  await expect(page.getByRole('button', { name: '提交并返回任务列表' })).toBeEnabled();
  await page.screenshot({ path: '../build/frontend-qa/profile-entry-1366.png', fullPage: true, animations: 'disabled' });
  await page.getByRole('button', { name: '提交并返回任务列表' }).click();
  await expect(page.getByRole('heading', { name: '选择测试任务' })).toBeVisible();
  await expect(profileTask.getByText('已完成', { exact: true })).toBeVisible();
  await expect(profileTask.locator('.task-status')).toHaveCSS('color', 'rgb(40, 112, 76)');
  await expect(profileTask.getByRole('button', { name: '填写资料', exact: true })).toHaveCount(0);
  await page.screenshot({ path: '../build/frontend-qa/profile-task-complete-1366.png', fullPage: true, animations: 'disabled' });
  await selectTask(page, '基金份额选择：八年持有');
  await page.getByRole('button', { name: '返回主界面', exact: true }).click();
  await page.getByRole('button', { name: '确认返回', exact: true }).click();
  await expect(page.getByRole('heading', { name: '选择测试任务' })).toBeVisible();
  await page.getByRole('button', { name: '使用其他编码' }).click();
  await page.getByLabel('测试编码', { exact: true }).fill('FCM-2026');
  await page.getByRole('button', { name: '验证并继续' }).click();
  await expect(page.getByRole('heading', { name: '选择测试任务' })).toBeVisible();
  await expect(page.getByRole('heading', { name: '用户资料', exact: true })).toHaveCount(0);
  await expect(profileTask.getByText('已完成', { exact: true })).toBeVisible();
  // Old caches did not contain the display code; restore it from the verified grant.
  await page.evaluate(() => {
    const cache = JSON.parse(sessionStorage.getItem('fcm.access.v1')!);
    delete cache.grant.testCode;
    sessionStorage.setItem('fcm.access.v1', JSON.stringify(cache));
  });
  await page.reload();
  await expect(page.getByRole('heading', { name: '选择测试任务' })).toBeVisible();
  await expect(page.locator('.current-test-code')).toHaveText('测试编码FCM-2026');
  await selectTask(page, '消费融资选择：较长优惠期与不同计息规则');
  await page.getByRole('radio').first().check();
  await page.getByLabel('置信度数值').fill('42');
  await page.getByRole('button', { name: '确认并进入交流' }).click();
  for (let i = 0; i < 3; i++) {
    await page.getByPlaceholder('输入问题或想法').fill(`核对条件 ${i}`);
    await page.getByRole('button', { name: '发送', exact: true }).click();
    await expect(page.getByText('正在回复…')).toHaveCount(0);
  }
  await page.getByRole('button', { name: '结束交流', exact: true }).click();
  await page.getByRole('button', { name: '结束并继续' }).click();
  await page.getByRole('radio').last().check();
  await page.getByLabel('置信度数值').fill('73');
  await page.getByRole('button', { name: '确认最终判断' }).click();
  await expect(page.getByRole('heading', { name: '任务已完成' })).toBeVisible();
  await expect(page.locator('.profile-form')).toHaveCount(0);
  await page.getByRole('button', { name: '返回主界面', exact: true }).click();
  await expect(page.getByRole('heading', { name: '选择测试任务' })).toBeVisible();
  await expect(page.getByRole('dialog')).toHaveCount(0);
});

test('return home requires confirmation, cancel preserves progress and confirm starts fresh', async ({ page }) => {
  await page.setViewportSize({ width: 1366, height: 768 });
  await page.goto('/');
  await enterCode(page, 'FCM-2026');
  await selectTask(page, '基金份额选择：八年持有');
  const home = page.getByRole('button', { name: '返回主界面', exact: true });
  await page.getByRole('radio', { name: 'B 份额B' }).check();
  await page.getByLabel('置信度数值').fill('63');
  await home.click();
  const dialog = page.getByRole('dialog', { name: '返回主界面？' });
  await expect(dialog).toBeVisible();
  await expect(dialog.getByText(/进度不会保存/)).toBeVisible();
  await dialog.getByRole('button', { name: '继续测试', exact: true }).click();
  await expect(dialog).toHaveCount(0);
  await expect(page.getByLabel('置信度数值')).toHaveValue('63');
  await expect(page.getByRole('radio', { name: 'B 份额B' })).toBeChecked();
  await home.click();
  await dialog.press('Escape');
  await expect(dialog).toHaveCount(0);
  await page.getByRole('button', { name: '确认并进入交流' }).click();
  await page.getByPlaceholder('输入问题或想法').fill('这条记录应在确认退出后清除。');
  await page.getByRole('button', { name: '发送', exact: true }).click();
  await expect(home).toBeDisabled();
  await expect(page.getByText('正在回复…')).toHaveCount(0);
  await home.click();
  await expect(dialog).toBeVisible();
  await page.screenshot({ path: '../build/frontend-qa/return-home-1366.png', fullPage: true });
  await dialog.getByRole('button', { name: '继续测试', exact: true }).click();
  await expect(page.getByText('这条记录应在确认退出后清除。', { exact: true })).toBeVisible();
  await home.click();
  await dialog.getByRole('button', { name: '确认返回', exact: true }).click();
  await expect(page.getByRole('heading', { name: '选择测试任务' })).toBeVisible();
  await expect(page.getByRole('heading', { name: '输入测试编码' })).toHaveCount(0);
  await expect(page.getByRole('radio')).toHaveCount(3);
  await expect(page.getByRole('button', { name: '开始测试', exact: true })).toBeDisabled();
  await page.reload();
  await expect(page.getByRole('heading', { name: '选择测试任务' })).toBeVisible();
  await expect(page.getByRole('heading', { name: '输入测试编码' })).toHaveCount(0);
  await selectTask(page, '基金份额选择：八年持有');
  await expect(page.getByLabel('置信度数值')).toHaveValue('');
  for (const radio of await page.getByRole('radio').all()) await expect(radio).not.toBeChecked();
  await expect(page.locator('.message')).toHaveCount(0);
  await home.click();
  await dialog.getByRole('button', { name: '确认返回', exact: true }).click();
  await expect(page.getByRole('heading', { name: '选择测试任务' })).toBeVisible();
  await expect(page.getByRole('heading', { name: '输入测试编码' })).toHaveCount(0);
  await selectTask(page, '消费融资选择：较长优惠期与不同计息规则');
  await expect(page.getByRole('complementary').getByText('TASK-4P8R', { exact: true })).toBeVisible();
});
