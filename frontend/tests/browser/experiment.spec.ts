import { expect, test, type Page } from '@playwright/test';

async function enterCode(page: Page, code: string) {
  await expect(page.getByRole('region', { name: 'Study instructions', exact: true })).toBeVisible();
  await page.getByLabel('Participant code', { exact: true }).fill(code);
  await page.getByRole('button', { name: 'Continue' }).click();
  await expect(page.getByRole('heading', { name: 'Study tasks' })).toBeVisible();
  await expect(page.locator('.current-test-code')).toHaveText(`Participant code${code.trim().toUpperCase()}`);
  const fillProfile = page.getByRole('button', { name: 'Complete questionnaire', exact: true });
  if (await fillProfile.count()) {
    await fillProfile.click();
    await expect(page.getByRole('heading', { name: 'Background questionnaire', exact: true })).toBeVisible();
    for (const group of await page.locator('.profile-form fieldset').all()) await group.getByRole('radio').first().check();
    await page.getByRole('button', { name: 'Submit and return to tasks' }).click();
  }
  await expect(page.getByRole('heading', { name: 'Study tasks' })).toBeVisible();
  await expect(page.getByRole('region', { name: 'Study instructions', exact: true })).toBeVisible();
}
async function selectTask(page: Page, title: string) {
  await page.locator('.task-choice').filter({ hasText: title }).getByRole('radio').check();
  await page.getByRole('button', { name: 'Begin task', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Initial choice' })).toBeVisible();
}
async function assertWorkspace(page: Page, rightName: string) {
  await expect(page.getByRole('region', { name: 'Study instructions', exact: true })).toHaveCount(0);
  const left = page.getByRole('complementary', { name: 'Task materials' });
  const right = page.getByRole('region', { name: rightName, exact: true });
  await expect(left).toBeVisible();
  await expect(right).toBeVisible();
  const leftBox = await left.boundingBox();
  const rightBox = await right.boundingBox();
  expect(Math.abs(leftBox!.y - rightBox!.y)).toBeLessThan(2);
  expect(leftBox!.x + leftBox!.width).toBeLessThanOrEqual(rightBox!.x + 1);
  await expect(left.getByRole('heading', { name: 'Decision task', exact: true })).toHaveCount(0);
  await expect(right.getByRole('heading', { name: 'Decision task', exact: true })).toHaveCount(1);
  await expect(page.getByText(/交互预览|预览设置|模拟回复|占位|示例题|本地交互/)).toHaveCount(0);
}

test('merged initial judgment, dialogue and final judgment share desktop material columns', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', e => errors.push(e.message));
  await page.goto('/');
  await enterCode(page, 'FCM-PROBE');
  await page.getByRole('radio').check();
  await page.getByRole('button', { name: 'Begin task', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Initial choice' })).toBeVisible();
  await assertWorkspace(page, 'Initial choice');
  await expect(page.getByRole('button', { name: '我已阅读，继续' })).toHaveCount(0);
  await expect(page.getByRole('navigation', { name: 'Study stages' }).getByText('Initial choice', { exact: true })).toBeVisible();
  await page.screenshot({ path: '../build/frontend-qa/initial-desktop.png', fullPage: true, animations: 'disabled' });
  const proceed = page.getByRole('button', { name: 'Continue to conversation' });
  await expect(proceed).toBeDisabled();
  await page.getByRole('radio', { name: 'A 份额A' }).check();
  await expect(proceed).toBeDisabled();
  await page.getByLabel('Confidence value').fill('0');
  await proceed.click();
  await assertWorkspace(page, 'Conversation with the AI assistant');
  await expect(page.getByRole('region', { name: 'Study instructions' })).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'End conversation', exact: true })).toHaveCount(0);
  const send = async (text: string) => {
    await page.getByPlaceholder('Type a question or share your thoughts…').fill(text);
    await page.getByRole('button', { name: 'Send', exact: true }).click();
    await expect(page.getByText('Replying…')).toHaveCount(0);
  };
  await send('请帮我理解共同条件。');
  await send('两种份额的费用如何查看？');
  await expect(page.getByRole('heading', { name: 'Current choice' })).toBeVisible();
  const probeTop = await page.getByRole('heading', { name: 'Current choice' }).boundingBox();
  const historyBox = await page.locator('.message-history').boundingBox();
  expect(probeTop!.y).toBeGreaterThan(historyBox!.y);
  await expect(page.getByPlaceholder('Type a question or share your thoughts…')).toBeDisabled();
  await page.screenshot({ path: '../build/frontend-qa/probe-desktop.png', fullPage: true, animations: 'disabled' });
  await expect(page.getByRole('button', { name: 'End conversation', exact: true })).toHaveCount(0);
  await page.getByRole('radio', { name: 'B 份额B' }).check();
  await page.getByLabel('Confidence value').fill('73');
  await page.getByRole('button', { name: 'Submit and continue' }).click();
  await expect(page.getByRole('heading', { name: 'Current choice' })).toHaveCount(0);
  await expect(page.getByPlaceholder('Type a question or share your thoughts…')).toBeEnabled();
  await send('我想再核对持有期限。');
  await page.getByRole('button', { name: 'End conversation', exact: true }).click();
  await expect(page.getByRole('dialog')).toBeVisible();
  await page.getByRole('button', { name: 'Return to conversation', exact: true }).click();
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await page.getByRole('button', { name: 'End conversation', exact: true }).click();
  await page.getByRole('button', { name: 'Continue to final choice' }).click();
  await expect(page.getByRole('heading', { name: 'Final choice' })).toBeVisible();
  await assertWorkspace(page, 'Final choice');
  await expect(page.getByLabel('Confidence value')).toHaveValue('');
  for (const radio of await page.getByRole('radio').all()) await expect(radio).not.toBeChecked();
  await page.screenshot({ path: '../build/frontend-qa/final-desktop.png', fullPage: true, animations: 'disabled' });
  await page.getByRole('radio', { name: 'B 份额B' }).check();
  await page.getByLabel('Confidence value').fill('100');
  await page.getByRole('button', { name: 'Submit final choice' }).click();
  await expect(page.getByRole('heading', { name: 'Task complete' })).toBeVisible();
  await expect(page.getByRole('navigation', { name: 'Study stages' }).getByText('问卷', { exact: true })).toHaveCount(0);
  await expect(page.locator('.profile-form')).toHaveCount(0);
  await page.screenshot({ path: '../build/frontend-qa/completion-desktop.png', fullPage: true, animations: 'disabled' });
  await expect(page.getByText(/模拟|预览|占位|服务器/)).toHaveCount(0);
  await expect(page.getByRole('button', { name: '重新预览' })).toHaveCount(0);
  await page.getByRole('button', { name: 'Back to tasks' }).click();
  await expect(page.getByRole('heading', { name: 'Your study tasks are complete' })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Your responses have been saved' })).toBeVisible();
  await expect(page.getByText('You can now close this page. Thank you for taking part.')).toBeVisible();
  await expect(page.getByRole('region', { name: 'Study instructions' })).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Begin task', exact: true })).toHaveCount(0);
  await expect(page.locator('.current-test-code')).toHaveText('Participant codeFCM-PROBE');
  await expect(page.locator('.task-choice').getByText('Completed', { exact: true })).toBeVisible();
  await expect(page.getByRole('radio')).toHaveCount(0);
  await expect(page.locator('.task-status.completed').first()).toHaveCSS('color', 'rgb(40, 112, 76)');
  await page.screenshot({ path: '../build/frontend-qa/all-tasks-complete.png', fullPage: true, animations: 'disabled' });
  await page.reload();
  await expect(page.getByRole('heading', { name: 'Your study tasks are complete' })).toBeVisible();
  await expect(page.locator('.current-test-code')).toHaveText('Participant codeFCM-PROBE');
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
    await assertWorkspace(page, 'Initial choice');
    const submitBox = await page.getByRole('button', { name: 'Continue to conversation' }).boundingBox();
    expect(submitBox!.y + submitBox!.height).toBeLessThanOrEqual(page.viewportSize()!.height);
    expect(scenario.source_file).toBeUndefined();
    expect(scenario.goal).toBeUndefined();
    expect(scenario.answer).toBeUndefined();
    const task = page.getByRole('region', { name: 'Decision task', exact: true });
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
    await expect(page.getByRole('heading', { name: 'Initial choice' })).toBeVisible();
    await assertWorkspace(page, 'Initial choice');
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    expect(await page.evaluate(() => document.documentElement.scrollHeight <= innerHeight)).toBe(true);
    await expect(page.getByRole('complementary').getByText('TASK-4P8R', { exact: true })).toBeVisible();
    await expect(page.getByRole('banner').getByText('TASK-4P8R', { exact: true })).toHaveCount(0);
    const stagesBox = await page.getByRole('navigation', { name: 'Study stages' }).boundingBox();
    expect(stagesBox!.x).toBeGreaterThan(viewport.width / 2);
    expect(stagesBox!.x + stagesBox!.width).toBeGreaterThan(viewport.width - 70);
    const confidenceBox = await page.getByLabel('Confidence value').boundingBox();
    await expect(page.getByRole('slider')).toHaveCount(0);
    expect(confidenceBox!.y + confidenceBox!.height).toBeLessThan(viewport.height);
    await page.getByRole('radio').first().check();
    await page.getByLabel('Confidence value').fill('47');
    const materials = page.getByRole('complementary', { name: 'Task materials' });
    const sections = page.getByRole('navigation', { name: 'Material sections' });
    await sections.getByRole('button', { name: 'Options', exact: true }).click();
    const comparisonHeading = await materials.getByRole('heading', { name: 'Option details', exact: true }).boundingBox();
    const scrollBounds = await page.locator('.scenario-scroll').boundingBox();
    expect(comparisonHeading!.y).toBeGreaterThanOrEqual(scrollBounds!.y);
    expect(comparisonHeading!.y).toBeLessThan(scrollBounds!.y + 50);
    const cellAlignments = await materials.locator('th, td').evaluateAll(cells => cells.map(cell => {
      const style = getComputedStyle(cell); return [style.textAlign, style.verticalAlign];
    }));
    expect(cellAlignments.length).toBeGreaterThan(0);
    for (const alignment of cellAlignments) expect(alignment).toEqual(['center', 'middle']);
    await page.screenshot({ path: `../build/frontend-qa/material-comparison-${viewport.width}.png`, fullPage: true, animations: 'disabled' });
    await sections.getByRole('button', { name: 'PDF', exact: true }).click();
    await expect(materials.locator('.reference-link').first()).toBeInViewport();
    await expect(page.getByLabel('Confidence value')).toHaveValue('47');
    await expect(page.getByRole('radio').first()).toBeChecked();
    await sections.getByRole('button', { name: 'Context', exact: true }).click();
    const rightBefore = await page.locator('.decision-scroll').evaluate(el => el.scrollTop);
    await page.locator('.scenario-scroll').hover();
    await page.mouse.wheel(0, 1500);
    await expect.poll(() => page.locator('.scenario-scroll').evaluate(el => el.scrollTop)).toBeGreaterThan(0);
    expect(await page.locator('.decision-scroll').evaluate(el => el.scrollTop)).toBe(rightBefore);
    await page.getByRole('radio').first().check();
    await page.getByLabel('Confidence value').fill('99');
    await page.getByLabel('Confidence value').press('ArrowUp');
    await expect(page.getByLabel('Confidence value')).toHaveValue('100');
    await page.getByRole('button', { name: 'Continue to conversation' }).click();
    await assertWorkspace(page, 'Conversation with the AI assistant');
    await page.screenshot({ path: `../build/frontend-qa/dialogue-${viewport.width}.png`, fullPage: true, animations: 'disabled' });
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
  await expect(page.getByRole('region', { name: 'Study instructions' }).locator('.prose')).toHaveText(welcome.welcome);
  expect(snapshots).toEqual([]);
  await expect(page.getByRole('heading', { name: 'Welcome to the study' })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Initial choice' })).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Continue' })).toBeDisabled();
  await page.screenshot({ path: '../build/frontend-qa/code-entry.png', fullPage: true, animations: 'disabled' });
  await page.getByLabel('Participant code', { exact: true }).fill('INVALID');
  await page.getByRole('button', { name: 'Continue' }).click();
  await expect(page.getByRole('alert')).toHaveText('We could not recognise this code. Please check it and try again.');
  await page.getByLabel('Participant code', { exact: true }).fill('FCM-EXPIRED');
  await page.getByRole('button', { name: 'Continue' }).click();
  await expect(page.getByRole('alert')).toHaveText('This code has expired. Please contact the research team about your study access.');
  await enterCode(page, 'FCM-2026');
  await expect(page.getByRole('region', { name: 'Study instructions' }).locator('.prose')).toHaveText(welcome.welcome);
  await expect(page.getByRole('radio')).toHaveCount(3);
  await expect(page.getByRole('button', { name: 'Begin task', exact: true })).toBeDisabled();
  await page.locator('.task-choice').filter({ hasText: 'TASK-7K3M' }).getByRole('radio').check();
  await page.locator('.task-choice').filter({ hasText: 'TASK-4P8R' }).getByRole('radio').check();
  await expect(page.locator('.task-choice').filter({ hasText: 'TASK-7K3M' }).getByRole('radio')).not.toBeChecked();
  await page.screenshot({ path: '../build/frontend-qa/task-selection.png', fullPage: true, animations: 'disabled' });
  await page.getByRole('button', { name: 'Begin task', exact: true }).click();
  await expect(page.getByText('TASK-4P8R', { exact: true })).toBeVisible();
  await expect(page.getByRole('heading', { name: '消费融资选择：较长优惠期与不同计息规则', exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Use another code' })).toHaveCount(0);
  await expect(page.getByText(/场景\s*0[1-9]/)).toHaveCount(0);
  await page.reload();
  await expect(page.getByText('TASK-4P8R', { exact: true })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Study tasks' })).toHaveCount(0);
  await page.goto('/?case=01');
  await expect(page.getByText('TASK-4P8R', { exact: true })).toBeVisible();
});

test('refresh resumes the same task and conversation without resetting initial answers', async ({ page }) => {
  await page.goto('/');
  await enterCode(page, 'FCM-2026');
  await selectTask(page, '基金份额选择：八年持有');
  await page.getByRole('radio', { name: 'A 份额A' }).check();
  await page.getByLabel('Confidence value').fill('42');
  await page.getByRole('button', { name: 'Continue to conversation' }).click();
  await page.getByPlaceholder('Type a question or share your thoughts…').fill('请帮我核对费用。');
  await page.getByRole('button', { name: 'Send', exact: true }).click();
  await expect(page.getByText('Replying…')).toHaveCount(0);
  await page.reload();
  await assertWorkspace(page, 'Conversation with the AI assistant');
  await expect(page.getByText('TASK-7K3M', { exact: true })).toBeVisible();
  await expect(page.getByText('请帮我核对费用。', { exact: true })).toBeVisible();
  await expect(page.locator('.message')).toHaveCount(3);
  await expect(page.getByRole('heading', { name: 'Initial choice' })).toHaveCount(0);
});

test('single-task and empty assignments have a clear entry state', async ({ page }) => {
  await page.goto('/');
  await enterCode(page, 'FCM-SINGLE');
  await expect(page.getByRole('radio')).toHaveCount(1);
  await expect(page.getByRole('button', { name: 'Begin task', exact: true })).toBeDisabled();
  await page.getByRole('button', { name: 'Use another code' }).click();
  await enterCode(page, 'FCM-EMPTY');
  await expect(page.getByRole('heading', { name: 'No tasks have been added yet' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Begin task', exact: true })).toHaveCount(0);
});

test('entrance instructions can recover from a loading failure without losing the code', async ({ page }) => {
  let unavailable = true;
  await page.route('**/materials/instructions.json', async route => {
    if (unavailable) await route.fulfill({ status: 503, body: 'Unavailable' });
    else await route.continue();
  });
  await page.goto('/');
  await expect(page.getByRole('alert')).toHaveText('We could not load the study instructions. Please try again.');
  await page.getByLabel('Participant code', { exact: true }).fill('FCM-2026');
  await expect(page.getByRole('button', { name: 'Continue' })).toBeDisabled();
  unavailable = false;
  await page.getByRole('button', { name: 'Try again', exact: true }).click();
  await expect(page.getByRole('region', { name: 'Study instructions' }).locator('.prose')).toBeVisible();
  await expect(page.getByRole('alert')).toHaveCount(0);
  await expect(page.getByLabel('Participant code', { exact: true })).toHaveValue('FCM-2026');
  await enterCode(page, 'FCM-2026');
});

test('profile is the first task, gates experiments and remains completed on re-entry', async ({ page }) => {
  await page.setViewportSize({ width: 1366, height: 768 });
  await page.goto('/');
  await page.getByLabel('Participant code', { exact: true }).fill('FCM-2026');
  await page.getByRole('button', { name: 'Continue' }).click();
  await expect(page.getByRole('heading', { name: 'Study tasks' })).toBeVisible();
  const profileTask = page.getByRole('region', { name: 'Background questionnaire task' });
  await expect(profileTask.getByText('Not completed', { exact: true })).toBeVisible();
  for (const radio of await page.getByRole('radio').all()) await expect(radio).toBeDisabled();
  const profileBox = await profileTask.boundingBox();
  const firstTaskBox = await page.locator('.task-choice').first().boundingBox();
  expect(profileBox!.y + profileBox!.height).toBeLessThan(firstTaskBox!.y);
  await page.screenshot({ path: '../build/frontend-qa/profile-task-pending-1366.png', fullPage: true, animations: 'disabled' });
  await profileTask.getByRole('button', { name: 'Complete questionnaire', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Background questionnaire', exact: true })).toBeVisible();
  await expect(page.getByRole('navigation', { name: 'Study stages' })).toHaveCount(0);
  await expect(page.getByText(/TASK-/)).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Submit and return to tasks' })).toBeDisabled();
  await page.getByRole('radio', { name: '电脑', exact: true }).check();
  await page.getByRole('button', { name: 'Back to tasks', exact: true }).click();
  await expect(page.getByRole('dialog').getByText(/unsent answers will be cleared/)).toBeVisible();
  await page.getByRole('button', { name: 'Keep filling in', exact: true }).click();
  await expect(page.getByRole('radio', { name: '电脑', exact: true })).toBeChecked();
  await page.getByRole('button', { name: 'Back to tasks', exact: true }).click();
  await page.getByRole('button', { name: 'Return and clear answers', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Study tasks' })).toBeVisible();
  await expect(profileTask.getByText('Not completed', { exact: true })).toBeVisible();
  await page.reload();
  await expect(page.getByRole('heading', { name: 'Study tasks' })).toBeVisible();
  await profileTask.getByRole('button', { name: 'Complete questionnaire', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Background questionnaire', exact: true })).toBeVisible();
  await expect(page.getByRole('radio', { name: '电脑', exact: true })).not.toBeChecked();
  await page.getByRole('radio', { name: '电脑', exact: true }).check();
  await page.getByRole('radio', { name: '偶尔使用', exact: true }).check();
  await expect(page.getByRole('button', { name: 'Submit and return to tasks' })).toBeEnabled();
  await page.screenshot({ path: '../build/frontend-qa/profile-entry-1366.png', fullPage: true, animations: 'disabled' });
  await page.getByRole('button', { name: 'Submit and return to tasks' }).click();
  await expect(page.getByRole('heading', { name: 'Study tasks' })).toBeVisible();
  await expect(profileTask.getByText('Completed', { exact: true })).toBeVisible();
  await expect(profileTask.locator('.task-status')).toHaveCSS('color', 'rgb(40, 112, 76)');
  await expect(profileTask.getByRole('button', { name: 'Complete questionnaire', exact: true })).toHaveCount(0);
  await page.screenshot({ path: '../build/frontend-qa/profile-task-complete-1366.png', fullPage: true, animations: 'disabled' });
  await selectTask(page, '基金份额选择：八年持有');
  await page.getByRole('button', { name: 'Back to tasks', exact: true }).click();
  await page.getByRole('button', { name: 'Return and clear progress', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Study tasks' })).toBeVisible();
  await page.getByRole('button', { name: 'Use another code' }).click();
  await page.getByLabel('Participant code', { exact: true }).fill('FCM-2026');
  await page.getByRole('button', { name: 'Continue' }).click();
  await expect(page.getByRole('heading', { name: 'Study tasks' })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Background questionnaire', exact: true })).toHaveCount(0);
  await expect(profileTask.getByText('Completed', { exact: true })).toBeVisible();
  // Old caches did not contain the display code; restore it from the verified grant.
  await page.evaluate(() => {
    const cache = JSON.parse(sessionStorage.getItem('fcm.access.v1')!);
    delete cache.grant.testCode;
    sessionStorage.setItem('fcm.access.v1', JSON.stringify(cache));
  });
  await page.reload();
  await expect(page.getByRole('heading', { name: 'Study tasks' })).toBeVisible();
  await expect(page.locator('.current-test-code')).toHaveText('Participant codeFCM-2026');
  await selectTask(page, '消费融资选择：较长优惠期与不同计息规则');
  await page.getByRole('radio').first().check();
  await page.getByLabel('Confidence value').fill('42');
  await page.getByRole('button', { name: 'Continue to conversation' }).click();
  for (let i = 0; i < 3; i++) {
    await page.getByPlaceholder('Type a question or share your thoughts…').fill(`核对条件 ${i}`);
    await page.getByRole('button', { name: 'Send', exact: true }).click();
    await expect(page.getByText('Replying…')).toHaveCount(0);
  }
  await page.getByRole('button', { name: 'End conversation', exact: true }).click();
  await page.getByRole('button', { name: 'Continue to final choice' }).click();
  await page.getByRole('radio').last().check();
  await page.getByLabel('Confidence value').fill('73');
  await page.getByRole('button', { name: 'Submit final choice' }).click();
  await expect(page.getByRole('heading', { name: 'Task complete' })).toBeVisible();
  await expect(page.locator('.profile-form')).toHaveCount(0);
  await page.getByRole('button', { name: 'Back to tasks', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Study tasks' })).toBeVisible();
  await expect(page.getByRole('dialog')).toHaveCount(0);
});

test('return home requires confirmation, cancel preserves progress and confirm starts fresh', async ({ page }) => {
  await page.setViewportSize({ width: 1366, height: 768 });
  await page.goto('/');
  await enterCode(page, 'FCM-2026');
  await selectTask(page, '基金份额选择：八年持有');
  const home = page.getByRole('button', { name: 'Back to tasks', exact: true });
  await page.getByRole('radio', { name: 'B 份额B' }).check();
  await page.getByLabel('Confidence value').fill('63');
  await home.click();
  const dialog = page.getByRole('dialog', { name: 'Return to the task list?' });
  await expect(dialog).toBeVisible();
  await expect(dialog.getByText(/will not be saved/)).toBeVisible();
  await dialog.getByRole('button', { name: 'Stay in task', exact: true }).click();
  await expect(dialog).toHaveCount(0);
  await expect(page.getByLabel('Confidence value')).toHaveValue('63');
  await expect(page.getByRole('radio', { name: 'B 份额B' })).toBeChecked();
  await home.click();
  await dialog.press('Escape');
  await expect(dialog).toHaveCount(0);
  await page.getByRole('button', { name: 'Continue to conversation' }).click();
  await page.getByPlaceholder('Type a question or share your thoughts…').fill('这条记录应在确认退出后清除。');
  await page.getByRole('button', { name: 'Send', exact: true }).click();
  await expect(home).toBeDisabled();
  await expect(page.getByText('Replying…')).toHaveCount(0);
  await home.click();
  await expect(dialog).toBeVisible();
  await page.screenshot({ path: '../build/frontend-qa/return-home-1366.png', fullPage: true, animations: 'disabled' });
  await dialog.getByRole('button', { name: 'Stay in task', exact: true }).click();
  await expect(page.getByText('这条记录应在确认退出后清除。', { exact: true })).toBeVisible();
  await home.click();
  await dialog.getByRole('button', { name: 'Return and clear progress', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Study tasks' })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Welcome to the study' })).toHaveCount(0);
  await expect(page.getByRole('radio')).toHaveCount(3);
  await expect(page.getByRole('button', { name: 'Begin task', exact: true })).toBeDisabled();
  await page.reload();
  await expect(page.getByRole('heading', { name: 'Study tasks' })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Welcome to the study' })).toHaveCount(0);
  await selectTask(page, '基金份额选择：八年持有');
  await expect(page.getByLabel('Confidence value')).toHaveValue('');
  for (const radio of await page.getByRole('radio').all()) await expect(radio).not.toBeChecked();
  await expect(page.locator('.message')).toHaveCount(0);
  await home.click();
  await dialog.getByRole('button', { name: 'Return and clear progress', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Study tasks' })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Welcome to the study' })).toHaveCount(0);
  await selectTask(page, '消费融资选择：较长优惠期与不同计息规则');
  await expect(page.getByRole('complementary').getByText('TASK-4P8R', { exact: true })).toBeVisible();
});

// These checks exercise the new input behaviour and data mapping, rather than
// taking snapshots of individual CSS values.
test('confidence stays blank until entered and rejects values outside the integer scale', async ({ page }) => {
  await page.goto('/');
  await enterCode(page, 'FCM-2026');
  await selectTask(page, '基金份额选择：八年持有');
  const confidence = page.getByLabel('Confidence value');
  const submit = page.getByRole('button', { name: 'Continue to conversation' });
  await expect(confidence).toHaveValue('');
  await expect(page.getByRole('slider')).toHaveCount(0);
  await page.getByRole('radio').first().check();
  await expect(submit).toBeDisabled();
  for (const value of ['-1', '101', '2.5']) {
    await confidence.fill(value);
    await expect(submit).toBeDisabled();
    await expect(page.getByRole('alert')).toHaveText('Enter a whole number from 0 to 100.');
  }
  for (const value of ['0', '100']) {
    await confidence.fill(value);
    await expect(submit).toBeEnabled();
    await expect(page.getByRole('alert')).toHaveCount(0);
  }
  await confidence.fill('');
  await expect(submit).toBeDisabled();
  await page.getByRole('button', { name: 'Back to tasks' }).click();
  await expect(page.getByRole('button', { name: 'Stay in task' })).toBeFocused();
  await page.getByRole('dialog').press('Escape');
  await expect(page.getByRole('button', { name: 'Back to tasks' })).toBeFocused();
  await expect(page.getByRole('radio').first()).toBeChecked();
});

test('comparison cells follow the option identity when a supplied option order changes', async ({ page }) => {
  await page.route('**/materials/snapshot-*.json', async route => {
    const response = await route.fetch();
    const bundle = await response.json();
    const scenario = bundle.scenarios.find((s: { case_id: string }) => s.case_id === '01');
    scenario.options.reverse();
    scenario.comparison = [{ attribute: 'Reference', A: 'Original A value', B: 'Original B value' }];
    await route.fulfill({ response, json: bundle });
  });
  await page.goto('/');
  await enterCode(page, 'FCM-2026');
  await selectTask(page, '基金份额选择：八年持有');
  const headers = page.locator('.comparison-table thead th');
  await expect(headers.nth(1)).toContainText('Option B');
  await expect(headers.nth(2)).toContainText('Option A');
  await expect(page.locator('.comparison-table tbody td').nth(0)).toHaveText('Original B value');
  await expect(page.locator('.comparison-table tbody td').nth(1)).toHaveText('Original A value');
  await expect(page.getByRole('radio').first()).toHaveValue('B');
});

test('twenty tasks with long English titles remain selectable and the action stays visible', async ({ page }) => {
  await page.setViewportSize({ width: 1366, height: 768 });
  await page.route('**/materials/snapshot-*.json', async route => {
    const response = await route.fetch();
    const bundle = await response.json();
    for (const scenario of bundle.scenarios) {
      scenario.title = `Task ${scenario.case_id}: Comparing the eligibility requirements, charges and payment arrangements of two financial options`;
    }
    await route.fulfill({ response, json: bundle });
  });
  await page.goto('/');
  await enterCode(page, 'FCM-ALL');
  await expect(page.locator('.task-choice')).toHaveCount(20);
  await page.locator('.task-choice').last().getByRole('radio').check();
  await expect(page.getByRole('button', { name: 'Begin task', exact: true })).toBeInViewport();
  await expect(page.locator('.task-choice').last()).toBeInViewport();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.screenshot({ path: '../build/frontend-qa/twenty-tasks-1366.png', fullPage: false, animations: 'disabled' });
  await page.getByRole('button', { name: 'Begin task', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Initial choice' })).toBeVisible();
  await expect(page.getByRole('complementary').getByRole('heading', { level: 2 })).toContainText('Task 20:');
});
