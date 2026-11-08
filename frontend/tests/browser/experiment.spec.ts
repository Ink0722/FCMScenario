import { expect, test, type Page } from '@playwright/test';

async function enterCode(page: Page, code: string) {
  await expect(page.getByRole('region', { name: 'Study instructions', exact: true })).toBeVisible();
  await page.getByLabel('Participant code', { exact: true }).fill(code);
  await page.getByRole('checkbox').check();
  await page.getByRole('button', { name: 'Begin', exact: true }).click();
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
  await page.setViewportSize({ width: 1366, height: 768 });
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
  const confidenceWording = await page.locator('.confidence-field').innerText();
  expect(confidenceWording).toContain('How confident are you in your current choice?');
  expect(confidenceWording).toContain('50 = Moderately confident');
  expect(confidenceWording).toContain('not a percentage estimate');
  expect(confidenceWording).toContain('There is no preferred confidence level.');
  await expect(page.getByLabel('Confidence value')).toHaveAccessibleDescription(/how certain you feel[\s\S]*There is no preferred confidence level/);
  await page.screenshot({ path: '../build/frontend-qa/initial-desktop.png', fullPage: true, animations: 'disabled' });
  const proceed = page.getByRole('button', { name: 'Continue to conversation' });
  await expect(proceed).toBeDisabled();
  await page.getByRole('radio', { name: 'A Share class A' }).check();
  await expect(proceed).toBeDisabled();
  await page.getByLabel('Confidence value').fill('0');
  await proceed.click();
  await assertWorkspace(page, 'Conversation with the AI assistant');
  await expect(page.getByRole('region', { name: 'Study instructions' })).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'End conversation', exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: 'End conversation', exact: true })).toBeDisabled();
  await expect(page.locator('.message.assistant').first()).toContainText('Would you like help with this decision?');
  await expect(page.locator('.conversation-guide')).toHaveText('Please complete at least 3 exchanges before ending.');
  const send = async (text: string) => {
    await page.getByPlaceholder('Ask a question about the materials…').fill(text);
    await page.getByRole('button', { name: 'Send', exact: true }).click();
    await expect(page.getByText('Replying…')).toHaveCount(0);
  };
  await send('请帮我理解共同条件。');
  await expect(page.locator('.conversation-guide')).toHaveText('Please complete 2 more exchanges before ending.');
  await page.reload();
  await expect(page.getByRole('heading', { name: 'Conversation', exact: true })).toBeVisible();
  await expect(page.locator('.conversation-guide')).toHaveText('Please complete 2 more exchanges before ending.');
  await send('两种份额的费用如何查看？');
  await expect(page.locator('.conversation-guide')).toHaveText('Please complete 1 more exchange before ending.');
  await expect(page.getByRole('heading', { name: 'Current choice' })).toBeVisible();
  await expect(page.locator('.probe-card .confidence-field')).toHaveText(confidenceWording, { useInnerText: true });
  const probeTop = await page.getByRole('heading', { name: 'Current choice' }).boundingBox();
  const historyBox = await page.locator('.message-history').boundingBox();
  expect(probeTop!.y).toBeGreaterThan(historyBox!.y);
  await expect(page.getByPlaceholder('Ask a question about the materials…')).toBeDisabled();
  expect(await page.evaluate(() => document.documentElement.scrollHeight <= innerHeight)).toBe(true);
  const probeSubmit = await page.getByRole('button', { name: 'Submit and continue', exact: true }).boundingBox();
  expect(probeSubmit!.y + probeSubmit!.height).toBeLessThanOrEqual(historyBox!.y + historyBox!.height);
  await page.screenshot({ path: '../build/frontend-qa/probe-desktop.png', fullPage: true, animations: 'disabled' });
  await expect(page.getByRole('button', { name: 'End conversation', exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: 'End conversation', exact: true })).toBeDisabled();
  await page.getByRole('radio', { name: 'B Share class B' }).check();
  await page.getByLabel('Confidence value').fill('73');
  await page.getByRole('button', { name: 'Submit and continue' }).click();
  await expect(page.getByRole('heading', { name: 'Current choice' })).toHaveCount(0);
  await expect(page.getByPlaceholder('Ask a question about the materials…')).toBeEnabled();
  await send('我想再核对持有期限。');
  await expect(page.locator('.conversation-guide')).toHaveText('End conversation takes you to your final choice.');
  await expect(page.getByRole('button', { name: 'End conversation', exact: true })).toBeEnabled();
  await page.getByRole('button', { name: 'End conversation', exact: true }).click();
  await expect(page.getByRole('dialog')).toBeVisible();
  await page.getByRole('button', { name: 'Return to conversation', exact: true }).click();
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await page.getByRole('button', { name: 'End conversation', exact: true }).click();
  await page.getByRole('button', { name: 'Continue to final choice' }).click();
  await expect(page.getByRole('heading', { name: 'Final choice' })).toBeVisible();
  await assertWorkspace(page, 'Final choice');
  await expect(page.locator('.confidence-field')).toHaveText(confidenceWording, { useInnerText: true });
  await expect(page.getByLabel('Confidence value')).toHaveValue('');
  for (const radio of await page.getByRole('radio').all()) await expect(radio).not.toBeChecked();
  await page.screenshot({ path: '../build/frontend-qa/final-desktop.png', fullPage: true, animations: 'disabled' });
  await page.getByRole('radio', { name: 'B Share class B' }).check();
  await page.getByLabel('Confidence value').fill('100');
  await page.getByRole('button', { name: 'Submit final choice' }).click();
  await expect(page.getByRole('heading', { name: 'Task complete' })).toBeVisible();
  await expect(page.locator('.completion-illustration')).toHaveJSProperty('naturalWidth', 1536);
  await expect(page.locator('.stage-nav .finished .stage-number')).toHaveCSS('color', 'rgb(40, 112, 76)');
  await expect(page.getByRole('button', { name: 'Back to tasks', exact: true })).toBeInViewport();
  await expect(page.getByRole('navigation', { name: 'Study stages' }).getByText('问卷', { exact: true })).toHaveCount(0);
  await expect(page.locator('.profile-form')).toHaveCount(0);
  await page.screenshot({ path: '../build/frontend-qa/completion-desktop.png', fullPage: true, animations: 'disabled' });
  await expect(page.getByText(/模拟|预览|占位|服务器/)).toHaveCount(0);
  await expect(page.getByRole('button', { name: '重新预览' })).toHaveCount(0);
  await page.getByRole('button', { name: 'Back to tasks' }).click();
  await expect(page.getByRole('heading', { name: 'Your study tasks are complete' })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Your responses have been saved' })).toBeVisible();
  await expect(page.getByText('That’s everything. You can now close this page.')).toBeVisible();
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

test('all scenarios preserve material and task text with 42 distinct PDFs and the extra layout copy', async ({ page, request }) => {
  test.setTimeout(120_000);
  const manifest = await (await request.get('/materials/manifest.json')).json();
  const bundle = await (await request.get(`/materials/${manifest.snapshot}`)).json();
  expect(bundle.scenarios).toHaveLength(20);
  let documents = 0;
  const documentRevisions = new Set<string>();
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
      documentRevisions.add(ref.revision);
      documents++;
    }
  }
  expect(documents).toBe(43);
  expect(documentRevisions.size).toBe(42);
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
  await page.setViewportSize({ width: 1366, height: 768 });
  const snapshots: string[] = [];
  page.on('request', request => { if (request.url().includes('/snapshot-')) snapshots.push(request.url()); });
  await page.goto('/?case=17&probe=1');
  await expect(page.locator('.site-symbol')).toHaveAttribute('src', '/decision-mark.svg');
  await expect(page.locator('link[rel="icon"]')).toHaveAttribute('href', /(?:\.\/|\/)decision-mark\.svg$/);
  expect((await request.get('/decision-mark.svg')).ok()).toBe(true);
  const welcomeResponse = await page.request.get('/materials/instructions.json');
  expect(welcomeResponse.ok()).toBe(true);
  const welcome = await welcomeResponse.json();
  const welcomeText = welcome.welcome.replace(/^\d+\.\s+/gm, '').replace(/^[-*]\s+/gm, '').replace(/\*\*/g, '').replace(/\\\r?\n/g, '\n');
  expect(Object.keys(welcome).sort()).toEqual(['revision', 'welcome']);
  await expect(page.getByRole('region', { name: 'Study instructions' }).locator('.prose')).toHaveText(welcomeText);
  await expect(page.locator('.entry-instructions .prose ol > li')).toHaveCount(0);
  await expect(page.locator('.entry-instructions .prose ul > li')).toHaveCount(3);
  await expect(page.locator('.entry-roadmap > li .step-points')).toHaveCount(3);
  await expect(page.locator('.entry-roadmap .step-points > li')).toHaveCount(6);
  expect(snapshots).toEqual([]);
  await expect(page.getByRole('heading', { name: 'Welcome to the study' })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Initial choice' })).toHaveCount(0);
  const begin = page.getByRole('button', { name: 'Begin', exact: true });
  const confirmation = page.getByRole('checkbox', { name: 'I have read the instructions carefully and confirm that I am ready to begin.', exact: true });
  await expect(confirmation).not.toBeChecked();
  await expect(begin).toBeDisabled();
  await confirmation.check();
  await expect(begin).toBeDisabled();
  await confirmation.uncheck();
  await expect(page.locator('.entry-heading > div > p').first()).toHaveText('Welcome! Thank you for your participation.');
  await expect(page.locator('.entry-heading .entry-contact')).toHaveText('Please read the study instructions before you begin. Questions? Email huayingkai@ruc.edu.cn.');
  await expect(page.locator('.code-form-contact')).toHaveText('Questions about your participant code? Email huayingkai@ruc.edu.cn.');
  await expect(page.locator('.code-form')).not.toContainText('Please read the study instructions before you begin.');
  await expect(page.getByText('When you are ready, click “Begin” to start.', { exact: true })).toHaveCount(0);
  await expect(page.locator('.entry-instructions .prose > p')).toHaveCount(3);
  const contactLinks = page.getByRole('link', { name: 'huayingkai@ruc.edu.cn', exact: true });
  await expect(contactLinks).toHaveCount(2);
  for (const link of await contactLinks.all()) await expect(link).toHaveAttribute('href', 'mailto:huayingkai@ruc.edu.cn');
  await expect(page.locator('.entry-instructions')).not.toContainText('When you are ready');
  await page.screenshot({ path: '../build/frontend-qa/code-entry.png', fullPage: true, animations: 'disabled' });
  await page.getByRole('button', { name: 'Begin', exact: true }).scrollIntoViewIfNeeded();
  await expect(page.getByRole('button', { name: 'Begin', exact: true })).toBeInViewport();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.screenshot({ path: '../build/frontend-qa/entry-instructions-bottom.png', animations: 'disabled' });
  await page.getByLabel('Participant code', { exact: true }).fill('INVALID');
  await expect(begin).toBeDisabled();
  await confirmation.check();
  await expect(begin).toBeEnabled();
  await confirmation.uncheck();
  await expect(begin).toBeDisabled();
  await page.getByRole('checkbox').check();
  await page.getByRole('button', { name: 'Begin', exact: true }).click();
  await expect(page.getByRole('alert')).toHaveText('We could not recognise this code. Please check it and try again.');
  await page.getByLabel('Participant code', { exact: true }).fill('FCM-EXPIRED');
  await page.getByRole('checkbox').check();
  await page.getByRole('button', { name: 'Begin', exact: true }).click();
  await expect(page.getByRole('alert')).toHaveText('This code has expired. Please contact the research team about your study access.');
  await enterCode(page, 'FCM-2026');
  await expect(page.getByRole('region', { name: 'Study instructions' }).locator('.prose')).toHaveText(welcomeText);
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
  await selectTask(page, 'Choosing fund shares: an eight-year investment');
  await page.getByRole('radio', { name: 'A Share class A' }).check();
  await page.getByLabel('Confidence value').fill('42');
  await page.getByRole('button', { name: 'Continue to conversation' }).click();
  await page.getByPlaceholder('Ask a question about the materials…').fill('请帮我核对费用。');
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
  await expect(page.getByRole('button', { name: 'Begin', exact: true })).toBeDisabled();
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
  await page.getByRole('checkbox').check();
  await page.getByRole('button', { name: 'Begin', exact: true }).click();
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
  await expect(page.locator('.profile-illustration')).toHaveJSProperty('naturalWidth', 1536);
  await expect(page.getByRole('button', { name: 'Submit and return to tasks' })).toBeInViewport();
  await page.screenshot({ path: '../build/frontend-qa/profile-watercolor-1366.png', animations: 'disabled' });
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
  await selectTask(page, 'Choosing fund shares: an eight-year investment');
  await page.getByRole('button', { name: 'Back to tasks', exact: true }).click();
  await page.getByRole('button', { name: 'Return and clear progress', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Study tasks' })).toBeVisible();
  await page.getByRole('button', { name: 'Use another code' }).click();
  await page.getByLabel('Participant code', { exact: true }).fill('FCM-2026');
  await page.getByRole('checkbox').check();
  await page.getByRole('button', { name: 'Begin', exact: true }).click();
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
    await page.getByPlaceholder('Ask a question about the materials…').fill(`核对条件 ${i}`);
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
  await selectTask(page, 'Choosing fund shares: an eight-year investment');
  const home = page.getByRole('button', { name: 'Back to tasks', exact: true });
  await page.getByRole('radio', { name: 'B Share class B' }).check();
  await page.getByLabel('Confidence value').fill('63');
  await home.click();
  const dialog = page.getByRole('dialog', { name: 'Return to the task list?' });
  await expect(dialog).toBeVisible();
  await expect(dialog.getByText(/will not be saved/)).toBeVisible();
  await dialog.getByRole('button', { name: 'Stay in task', exact: true }).click();
  await expect(dialog).toHaveCount(0);
  await expect(page.getByLabel('Confidence value')).toHaveValue('63');
  await expect(page.getByRole('radio', { name: 'B Share class B' })).toBeChecked();
  await home.click();
  await dialog.press('Escape');
  await expect(dialog).toHaveCount(0);
  await page.getByRole('button', { name: 'Continue to conversation' }).click();
  await page.getByPlaceholder('Ask a question about the materials…').fill('这条记录应在确认退出后清除。');
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
  await selectTask(page, 'Choosing fund shares: an eight-year investment');
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
  await selectTask(page, 'Choosing fund shares: an eight-year investment');
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

test('saved tasks keep their confidence wording while new tasks receive the updated guidance', async ({ page }) => {
  const snapshotRoute = '**/materials/snapshot-*.json';
  const originalPrompt = 'How confident are you in your choice? (0–100)';
  const originalScale = '0 means not at all confident; 100 means completely confident. Rate how certain you are about your choice, not the probability of making a profit.';
  await page.route(snapshotRoute, async route => {
    const response = await route.fetch();
    const bundle = await response.json();
    bundle.shared.confidence_prompt = originalPrompt;
    bundle.shared.confidence_scale = originalScale;
    bundle.shared.revision = 'confidence-before-detailed-guidance';
    delete bundle.shared.confidence_notes;
    await route.fulfill({ response, json: bundle });
  });
  await page.goto('/');
  await enterCode(page, 'FCM-EN');
  await selectTask(page, 'Choosing fund shares: an eight-year investment');
  await expect(page.locator('.confidence-field legend')).toHaveText(originalPrompt);
  await expect(page.locator('.confidence-explanation')).toHaveText(originalScale);
  await expect(page.locator('.confidence-guidance, .confidence-notes')).toHaveCount(0);
  await page.getByRole('radio').first().check();
  await page.getByLabel('Confidence value').fill('37');
  await page.unroute(snapshotRoute);
  await page.reload();
  await expect(page.locator('.confidence-explanation')).toHaveText(originalScale);
  await expect(page.getByLabel('Confidence value')).toHaveValue('37');
  await expect(page.locator('.confidence-guidance, .confidence-notes')).toHaveCount(0);
  await page.getByRole('button', { name: 'Back to tasks', exact: true }).click();
  await page.getByRole('button', { name: 'Return and clear progress', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Study tasks', exact: true })).toBeVisible();
  await page.reload();
  await selectTask(page, 'Choosing fund shares: an eight-year investment');
  await expect(page.locator('.confidence-guidance')).toContainText('50 = Moderately confident');
  await expect(page.locator('.confidence-notes')).toContainText('There is no preferred confidence level.');
  await expect(page.getByLabel('Confidence value')).toHaveValue('');
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
  await selectTask(page, 'Choosing fund shares: an eight-year investment');
  const headers = page.locator('.comparison-table thead th');
  await expect(headers.nth(1)).toContainText('Option B');
  await expect(headers.nth(2)).toContainText('Option A');
  await expect(page.locator('.comparison-table tbody td').nth(0)).toHaveText('Original B value');
  await expect(page.locator('.comparison-table tbody td').nth(1)).toHaveText('Original A value');
  await expect(page.getByRole('radio').first()).toHaveValue('B');
});

test('literature-grounded A/B cases can omit non-applicable material sections', async ({ page }) => {
  await page.route('**/materials/snapshot-*.json', async route => {
    const response = await route.fetch();
    const bundle = await response.json();
    const scenario = bundle.scenarios.find((s: { case_id: string }) => s.case_id === '01');
    scenario.template = 'table';
    scenario.common_facts = [];
    scenario.comparison = [];
    scenario.references = [];
    scenario.additional_information = [];
    scenario.knowledge = [];
    await route.fulfill({ response, json: bundle });
  });
  await page.goto('/');
  await enterCode(page, 'FCM-EN');
  await selectTask(page, 'Choosing fund shares: an eight-year investment');
  const materials = page.getByRole('complementary', { name: 'Task materials' });
  await expect(materials.locator('[data-material-section="comparison"]')).toBeVisible();
  await expect(materials.locator('.comparison-cards .material-option')).toHaveCount(2);
  await expect(materials.locator('[data-material-section="conditions"]')).toHaveCount(0);
  await expect(materials.locator('[data-material-section="references"]')).toHaveCount(0);
  await expect(materials.locator('[data-material-section="additional"]')).toHaveCount(0);
  await expect(materials.locator('[data-material-section="knowledge"]')).toHaveCount(0);
  const navigation = page.getByRole('navigation', { name: 'Material sections' });
  await expect(navigation.getByRole('button', { name: 'PDF', exact: true })).toHaveCount(0);
});

test('English case one keeps words intact and controls usable on narrower desktop windows', async ({ context }) => {
  test.setTimeout(90_000);
  for (const width of [1100, 1280, 1366, 1920]) {
    const page = await context.newPage();
    await page.setViewportSize({ width, height: 768 });
    await page.goto('/');
    await page.getByRole('button', { name: 'Begin', exact: true }).scrollIntoViewIfNeeded();
    await page.evaluate(() => document.fonts.ready);
    const accessNote = await page.locator('.code-form-note').evaluate(element => ({
      height: element.getBoundingClientRect().height,
      lineHeight: parseFloat(getComputedStyle(element).lineHeight),
      clipped: element.scrollWidth > element.clientWidth + 1,
    }));
    expect(Math.abs(accessNote.height - accessNote.lineHeight)).toBeLessThanOrEqual(1);
    expect(accessNote.clipped).toBe(false);
    const roadmapLines = await page.locator('.entry-roadmap .step-points').evaluateAll(paragraphs => paragraphs.map(paragraph => {
      const walker = document.createTreeWalker(paragraph, NodeFilter.SHOW_TEXT);
      const tops = new Set<number>();
      let node: Node | null;
      while ((node = walker.nextNode())) {
        if (!node.textContent?.trim()) continue;
        const range = document.createRange();
        range.selectNodeContents(node);
        for (const rect of range.getClientRects()) if (rect.width > 0) tops.add(Math.round(rect.top * 10));
      }
      return { lines: tops.size, clipped: paragraph.scrollWidth > paragraph.clientWidth + 1 };
    }));
    expect(roadmapLines).toHaveLength(3);
    for (const paragraph of roadmapLines) {
      expect(paragraph.lines).toBeGreaterThanOrEqual(3);
      expect(paragraph.clipped).toBe(false);
    }
    const roadmapCards = await page.locator('.entry-roadmap > li').evaluateAll(cards => cards.map(card => {
      const bounds = card.getBoundingClientRect();
      const paragraph = card.querySelector('.step-points')!.getBoundingClientRect();
      return { height: bounds.height, clipped: paragraph.right > bounds.right || paragraph.bottom > bounds.bottom };
    }));
    for (const card of roadmapCards) {
      expect(Math.abs(card.height - roadmapCards[0].height)).toBeLessThanOrEqual(1);
      expect(card.clipped).toBe(false);
    }
    const unusedWidth = await page.locator('.entry-layout .entry-instructions .prose').evaluate(element => {
      const panel = element.closest('.entry-instructions')!;
      const style = getComputedStyle(panel);
      const available = panel.clientWidth - parseFloat(style.paddingLeft) - parseFloat(style.paddingRight);
      return available - element.getBoundingClientRect().width;
    });
    expect(Math.abs(unusedWidth)).toBeLessThanOrEqual(1);
    const instructionCard = await page.locator('.entry-layout > .entry-instructions').boundingBox();
    const codeCard = await page.locator('.code-form').boundingBox();
    expect(Math.abs(instructionCard!.y - codeCard!.y)).toBeLessThanOrEqual(1);
    expect(Math.abs(instructionCard!.height - codeCard!.height)).toBeLessThanOrEqual(1);
    const codeInput = await page.getByLabel('Participant code', { exact: true }).boundingBox();
    const confirmation = await page.locator('.entry-confirmation').boundingBox();
    expect(confirmation!.y - (codeInput!.y + codeInput!.height)).toBeCloseTo(20, 0);
    const clippedEntryControls = await page.locator('.code-form input, .code-form .button, .code-form a').evaluateAll(controls => controls.filter(control => {
      const bounds = control.getBoundingClientRect();
      const card = control.closest('.code-form')!.getBoundingClientRect();
      return bounds.left < card.left || bounds.right > card.right || bounds.top < card.top || bounds.bottom > card.bottom;
    }).map(control => control.tagName));
    expect(clippedEntryControls).toEqual([]);
    await page.evaluate(() => window.scrollTo(0, 0));
    await expect(page.getByRole('heading', { name: 'Welcome to the study', exact: true })).toBeInViewport();
    await page.locator('.entry-illustration').evaluate((image: HTMLImageElement) => image.decode());
    const headingText = await page.locator('.entry-hero > div').boundingBox();
    const illustration = await page.locator('.entry-illustration').boundingBox();
    expect(headingText!.y + headingText!.height).toBeLessThanOrEqual(illustration!.y + illustration!.height + 1);
    const contactClipped = await page.locator('.entry-contact').evaluate(element => element.scrollWidth > element.clientWidth + 1);
    expect(contactClipped).toBe(false);
    const headingStyles = await page.locator('.entry-heading p').evaluateAll(paragraphs => paragraphs.map(element => {
      const style = getComputedStyle(element);
      return [style.fontSize, style.lineHeight, style.fontFamily, style.fontWeight, style.color];
    }));
    expect(headingStyles[1]).toEqual(headingStyles[0]);
    await page.screenshot({ path: `../build/frontend-qa/homepage-one-page-${width}-768.png`, fullPage: true, animations: 'disabled' });
    expect(await page.evaluate(() => document.documentElement.scrollHeight), `${width}×768 homepage height`).toBeLessThanOrEqual(769);
    await page.setViewportSize({ width, height: 720 });
    await page.screenshot({ path: `../build/frontend-qa/homepage-one-page-${width}-720.png`, fullPage: true, animations: 'disabled' });
    expect(await page.evaluate(() => document.documentElement.scrollHeight), `${width}×720 homepage height`).toBeLessThanOrEqual(721);
    await page.setViewportSize({ width, height: 768 });
    await page.getByRole('button', { name: 'Begin', exact: true }).scrollIntoViewIfNeeded();
    await expect(page.getByRole('button', { name: 'Begin', exact: true })).toBeInViewport();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    await enterCode(page, 'FCM-EN');
    await selectTask(page, 'Choosing fund shares: an eight-year investment');
    await expect(page.locator('.scenario-panel')).toHaveAttribute('lang', 'en');
    await expect(page.locator('.scenario-panel')).not.toContainText(/[\u3400-\u9fff]/);
    const checkTextAndControls = async () => {
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
      const splitWords = await page.locator('.scenario-panel, .decision-column, .dialogue-column').evaluateAll(regions => {
        const split: string[] = [];
        for (const region of regions) {
          const walker = document.createTreeWalker(region, NodeFilter.SHOW_TEXT);
          let node: Node | null;
          while ((node = walker.nextNode())) {
            for (const match of (node.textContent ?? '').matchAll(/[A-Za-z]{3,}/g)) {
              const range = document.createRange();
              range.setStart(node, match.index!);
              range.setEnd(node, match.index! + match[0].length);
              if (range.getClientRects().length > 1) split.push(match[0]);
            }
          }
        }
        return split;
      });
      expect(splitWords).toEqual([]);
      const clipped = await page.locator('.material-nav button, .button, .home-button').evaluateAll(controls => controls.filter(control => {
        const bounds = control.getBoundingClientRect();
        return bounds.width > 0 && (control.scrollWidth > control.clientWidth + 1 || bounds.x < 0 || bounds.right > innerWidth + 1);
      }).map(control => control.textContent));
      expect(clipped).toEqual([]);
      const heading = await page.locator('.material-task-number').boundingBox();
      const navigation = await page.locator('.material-nav').boundingBox();
      expect(heading!.x + heading!.width).toBeLessThanOrEqual(navigation!.x);
    };
    await checkTextAndControls();
    await expect(page.getByRole('button', { name: 'Continue to conversation' })).toBeInViewport();
    await page.screenshot({ path: `../build/frontend-qa/case-one-english-${width}.png`, animations: 'disabled' });
    await page.getByRole('radio', { name: 'A Share class A' }).check();
    await page.getByLabel('Confidence value').fill('50');
    await page.getByRole('button', { name: 'Continue to conversation' }).click();
    const messages = ['Hi.', 'Could we look at the conditions?\nI would like to understand how the fees apply over eight years before making a choice.', 'Thanks.'];
    for (const [turn, message] of messages.entries()) {
      await page.getByLabel('Your message', { exact: true }).fill(message);
      if (turn === 0) await page.screenshot({ path: `../build/frontend-qa/conversation-ready-${width}.png`, animations: 'disabled' });
      await page.getByRole('button', { name: 'Send', exact: true }).click();
      await expect(page.getByText('Replying…')).toHaveCount(0);
      if (turn === 0) await page.screenshot({ path: `../build/frontend-qa/conversation-short-${width}.png`, animations: 'disabled' });
    }
    const userTexts = page.locator('.message.user .user-text');
    const shortBubble = await userTexts.first().boundingBox();
    const longBubble = await userTexts.nth(1).boundingBox();
    const history = await page.locator('.message-history').boundingBox();
    expect(shortBubble!.width).toBeLessThan(longBubble!.width / 2);
    expect(longBubble!.width).toBeLessThanOrEqual(history!.width * .85 + 1);
    expect(Math.abs(shortBubble!.x + shortBubble!.width - longBubble!.x - longBubble!.width)).toBeLessThan(1);
    expect(await userTexts.nth(1).textContent()).toBe(messages[1]);
    await checkTextAndControls();
    await expect(page.getByRole('button', { name: 'End conversation', exact: true })).toBeInViewport();
    await page.screenshot({ path: `../build/frontend-qa/conversation-english-${width}.png`, animations: 'disabled' });
    await page.close();
  }
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
  await page.getByRole('button', { name: 'Begin', exact: true }).scrollIntoViewIfNeeded();
  await page.getByLabel('Participant code', { exact: true }).fill('FCM-ALL');
  await page.getByRole('checkbox').check();
  await page.getByRole('button', { name: 'Begin', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Study tasks', exact: true })).toBeInViewport();
  expect(await page.evaluate(() => scrollY)).toBe(0);
  await page.getByRole('button', { name: 'Use another code', exact: true }).click();
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

test('unsubmitted judgments and messages survive refresh without crossing stages', async ({ page }) => {
  test.setTimeout(90_000);
  await page.goto('/');
  await enterCode(page, 'FCM-PROBE');
  await selectTask(page, 'Choosing fund shares: an eight-year investment');
  await page.getByRole('radio', { name: 'B Share class B' }).check();
  await page.getByLabel('Confidence value').fill('-1');
  await page.reload();
  await expect(page.getByRole('radio', { name: 'B Share class B' })).toBeChecked();
  await expect(page.getByLabel('Confidence value')).toHaveValue('-1');
  await expect(page.getByRole('button', { name: 'Continue to conversation' })).toBeDisabled();
  await expect(page.getByRole('alert')).toHaveText('Enter a whole number from 0 to 100.');
  const submittedPre = await page.evaluate(() => {
    const cache = JSON.parse(sessionStorage.getItem('fcm.access.v1')!);
    return JSON.parse(sessionStorage.getItem('fcm.mock-service.v2')!).sessions[cache.sessionId].started.progress.decisions.pre;
  });
  expect(submittedPre).toBeUndefined();
  await page.getByLabel('Confidence value').fill('63');
  await page.reload();
  await expect(page.getByLabel('Confidence value')).toHaveValue('63');
  await expect(page.getByText('Your unsubmitted input has been restored.')).toHaveCount(0);
  await page.getByRole('button', { name: 'Continue to conversation' }).click();
  const input = page.getByLabel('Your message', { exact: true });
  await input.fill('This question has not been sent yet.');
  await page.reload();
  await expect(input).toHaveValue('This question has not been sent yet.');
  await expect(page.locator('.message')).toHaveCount(1);
  await expect(page.getByRole('button', { name: 'End conversation', exact: true })).toBeDisabled();
  await page.getByRole('button', { name: 'Send', exact: true }).click();
  await expect(page.getByText('Replying…')).toHaveCount(0);
  await input.fill('A second question about the materials.');
  await page.getByRole('button', { name: 'Send', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Current choice' })).toBeVisible();
  await expect(page.getByLabel('Confidence value')).toHaveValue('');
  for (const radio of await page.getByRole('radio').all()) await expect(radio).not.toBeChecked();
  await page.getByRole('radio', { name: 'B Share class B' }).check();
  await page.getByLabel('Confidence value').fill('41');
  await page.reload();
  await expect(page.getByRole('heading', { name: 'Current choice' })).toBeVisible();
  await expect(page.getByRole('radio', { name: 'B Share class B' })).toBeChecked();
  await expect(page.getByLabel('Confidence value')).toHaveValue('41');
  await page.getByRole('button', { name: 'Submit and continue' }).click();
  await input.fill('One more question.');
  await page.getByRole('button', { name: 'Send', exact: true }).click();
  await expect(page.getByRole('button', { name: 'End conversation', exact: true })).toBeEnabled();
  await input.fill('Keep this draft until I confirm.');
  await page.getByRole('button', { name: 'End conversation', exact: true }).click();
  await expect(page.getByRole('dialog')).toContainText('Your unsent message will be discarded.');
  await page.getByRole('button', { name: 'Return to conversation', exact: true }).click();
  await expect(input).toHaveValue('Keep this draft until I confirm.');
  await page.getByRole('button', { name: 'End conversation', exact: true }).click();
  await page.getByRole('button', { name: 'Continue to final choice' }).click();
  await expect(page.getByLabel('Confidence value')).toHaveValue('');
  for (const radio of await page.getByRole('radio').all()) await expect(radio).not.toBeChecked();
  await page.getByRole('radio', { name: 'A Share class A' }).check();
  await page.getByLabel('Confidence value').fill('0');
  await page.reload();
  await expect(page.getByRole('heading', { name: 'Final choice', exact: true })).toBeVisible();
  await expect(page.getByRole('radio', { name: 'A Share class A' })).toBeChecked();
  await expect(page.getByLabel('Confidence value')).toHaveValue('0');
  await page.screenshot({ path: '../build/frontend-qa/restored-final-choice.png', animations: 'disabled' });
  await page.getByRole('button', { name: 'Submit final choice' }).click();
  await expect(page.getByRole('heading', { name: 'Task complete' })).toBeVisible();
  expect(await page.evaluate(() => Object.keys(sessionStorage).filter(key => key.startsWith('fcm.draft.v1:session:')))).toEqual([]);
});

test('profile drafts survive refresh and clear only on submission or confirmed return', async ({ page }) => {
  await page.goto('/');
  await page.getByLabel('Participant code', { exact: true }).fill('FCM-2026');
  await page.getByRole('checkbox').check();
  await page.getByRole('button', { name: 'Begin', exact: true }).click();
  await page.getByRole('button', { name: 'Complete questionnaire', exact: true }).click();
  await page.getByRole('radio', { name: '电脑', exact: true }).check();
  await page.reload();
  await expect(page.getByRole('heading', { name: 'Background questionnaire', exact: true })).toBeVisible();
  await expect(page.getByRole('radio', { name: '电脑', exact: true })).toBeChecked();
  await expect(page.getByRole('button', { name: 'Submit and return to tasks' })).toBeDisabled();
  await page.getByRole('button', { name: 'Back to tasks', exact: true }).click();
  await page.getByRole('button', { name: 'Keep filling in', exact: true }).click();
  await expect(page.getByRole('radio', { name: '电脑', exact: true })).toBeChecked();
  await page.getByRole('button', { name: 'Back to tasks', exact: true }).click();
  await page.getByRole('button', { name: 'Return and clear answers', exact: true }).click();
  await page.reload();
  await expect(page.getByRole('heading', { name: 'Study tasks', exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Complete questionnaire', exact: true }).click();
  for (const radio of await page.getByRole('radio').all()) await expect(radio).not.toBeChecked();
  await page.getByRole('radio', { name: '电脑', exact: true }).check();
  await page.getByRole('radio', { name: '偶尔使用', exact: true }).check();
  await page.getByRole('button', { name: 'Submit and return to tasks' }).click();
  await expect(page.getByRole('heading', { name: 'Study tasks', exact: true })).toBeVisible();
  expect(await page.evaluate(() => Object.keys(sessionStorage).filter(key => key.startsWith('fcm.draft.v1:profile:')))).toEqual([]);
  await page.getByRole('button', { name: 'Use another code', exact: true }).click();
  await page.getByLabel('Participant code', { exact: true }).fill('FCM-EN');
  await page.getByRole('checkbox').check();
  await page.getByRole('button', { name: 'Begin', exact: true }).click();
  await page.getByRole('button', { name: 'Complete questionnaire', exact: true }).click();
  for (const radio of await page.getByRole('radio').all()) await expect(radio).not.toBeChecked();
});

test('confirming return clears unsent task input and another task starts blank', async ({ page }) => {
  await page.goto('/');
  await enterCode(page, 'FCM-2026');
  await selectTask(page, 'Choosing fund shares: an eight-year investment');
  await page.getByRole('radio', { name: 'A Share class A' }).check();
  await page.getByLabel('Confidence value').fill('77');
  await page.getByRole('button', { name: 'Back to tasks', exact: true }).click();
  await page.getByRole('button', { name: 'Stay in task', exact: true }).click();
  await page.reload();
  await expect(page.getByLabel('Confidence value')).toHaveValue('77');
  await page.getByRole('button', { name: 'Back to tasks', exact: true }).click();
  await page.getByRole('button', { name: 'Return and clear progress', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Study tasks', exact: true })).toBeVisible();
  expect(await page.evaluate(() => Object.keys(sessionStorage).filter(key => key.startsWith('fcm.draft.v1:session:')))).toEqual([]);
  await selectTask(page, '消费融资选择：较长优惠期与不同计息规则');
  await expect(page.getByLabel('Confidence value')).toHaveValue('');
  for (const radio of await page.getByRole('radio').all()) await expect(radio).not.toBeChecked();
});

test('unavailable draft storage keeps the form usable and reports the failure', async ({ page }) => {
  await page.addInitScript(() => {
    const original = Storage.prototype.setItem;
    Storage.prototype.setItem = function(key, value) {
      if (key.startsWith('fcm.draft.v1:')) throw new DOMException('Full', 'QuotaExceededError');
      return original.call(this, key, value);
    };
  });
  await page.goto('/');
  await enterCode(page, 'FCM-EN');
  await selectTask(page, 'Choosing fund shares: an eight-year investment');
  await page.getByRole('radio', { name: 'A Share class A' }).check();
  await page.getByLabel('Confidence value').fill('88');
  await expect(page.getByRole('alert')).toHaveText('Your input could not be kept in this tab. Keep this page open until you submit.');
  await expect(page.getByLabel('Confidence value')).toHaveValue('88');
  await page.getByRole('button', { name: 'Continue to conversation' }).click();
  await expect(page.getByRole('heading', { name: 'Conversation', exact: true })).toBeVisible();
});

test('system body text, bundled headings and bulleted conditions preserve the 58 to 42 layout', async ({ page, request }) => {
  const fonts: string[] = [];
  page.on('request', req => { if (req.url().includes('/fonts/') && req.url().endsWith('.woff2')) fonts.push(req.url()); });
  await page.goto('/');
  await expect(page.locator('.entry-instructions .prose')).toBeVisible();
  const bodyFont = await page.locator('body').evaluate(element => getComputedStyle(element).fontFamily);
  expect(bodyFont).toContain('-apple-system');
  expect(bodyFont).not.toContain('Study Sans');
  await expect(page.locator('.entry-instructions .prose')).toHaveCSS('font-family', bodyFont);
  await expect(page.locator('.entry-illustration')).toHaveJSProperty('naturalWidth', 1536);
  await page.locator('.entry-illustration').evaluate((image: HTMLImageElement) => image.decode());
  await page.evaluate(() => document.fonts.ready);
  await page.screenshot({ path: '../build/frontend-qa/entry-watercolor.png', animations: 'disabled' });
  await enterCode(page, 'FCM-EN');
  await expect(page.locator('.task-illustration')).toHaveJSProperty('naturalWidth', 1536);
  await page.screenshot({ path: '../build/frontend-qa/tasks-watercolor.png', animations: 'disabled' });
  await selectTask(page, 'Choosing fund shares: an eight-year investment');
  await page.evaluate(() => document.fonts.ready);
  const faces = await page.evaluate(() => [...document.fonts].map(face => ({ family: face.family, status: face.status })));
  expect(faces).toEqual([{ family: 'Study Serif', status: 'loaded' }]);
  expect(new Set(fonts).size).toBe(1);
  for (const url of fonts) expect(new URL(url).origin).toBe(new URL(page.url()).origin);
  const left = await page.locator('.scenario-column').boundingBox();
  const right = await page.locator('.decision-column').boundingBox();
  expect(left!.width / (left!.width + right!.width)).toBeCloseTo(0.58, 2);
  const manifest = await (await request.get('/materials/manifest.json')).json();
  const bundle = await (await request.get(`/materials/${manifest.snapshot}`)).json();
  const scenario = bundle.scenarios.find((item: { case_id: string }) => item.case_id === '01');
  await expect(page.locator('.condition-list > li .prose')).toHaveText(scenario.common_facts);
  await page.screenshot({ path: '../build/frontend-qa/reading-hierarchy.png', animations: 'disabled' });
  await page.getByRole('navigation', { name: 'Material sections' }).getByRole('button', { name: 'PDF', exact: true }).click();
  const referenceLinks = page.getByRole('link', { name: /Open PDF/ });
  await expect(referenceLinks).toHaveCount(scenario.references.length);
  await expect(referenceLinks.first()).toBeInViewport();
  await page.screenshot({ path: '../build/frontend-qa/material-files-unframed.png', animations: 'disabled' });
  const glossary = page.getByRole('navigation', { name: 'Material sections' }).getByRole('button', { name: 'Glossary', exact: true });
  await glossary.click();
  await expect(page.getByRole('heading', { name: 'Key terms', exact: true })).toBeInViewport();
  await expect(glossary).toHaveAttribute('aria-current', 'location');
  await page.screenshot({ path: '../build/frontend-qa/material-glossary.png', animations: 'disabled' });
});

test('refreshing during a message request does not submit it twice', async ({ page }) => {
  await page.goto('/');
  await enterCode(page, 'FCM-EN');
  await selectTask(page, 'Choosing fund shares: an eight-year investment');
  await page.getByRole('radio', { name: 'A Share class A' }).check();
  await page.getByLabel('Confidence value').fill('50');
  await page.getByRole('button', { name: 'Continue to conversation' }).click();
  const input = page.getByLabel('Your message', { exact: true });
  const text = 'Could we check this passage?';
  await input.fill(text);
  await page.getByRole('button', { name: 'Send', exact: true }).click();
  await page.reload();
  await expect(page.getByRole('heading', { name: 'Conversation', exact: true })).toBeVisible();
  const sent = page.locator('.message.user').filter({ hasText: text });
  if (await sent.count() === 0) {
    await expect(input).toHaveValue(text);
    await page.getByRole('button', { name: 'Send', exact: true }).click();
    await expect(page.getByText('Replying…')).toHaveCount(0);
  } else await expect(input).toHaveValue('');
  await expect(sent).toHaveCount(1);
  await input.fill(text);
  await page.getByRole('button', { name: 'Send', exact: true }).click();
  await expect(page.getByText('Replying…')).toHaveCount(0);
  await expect(sent).toHaveCount(2);
});

test('a failed submission preserves the draft for refresh and an explicit retry', async ({ page }) => {
  await page.goto('/');
  await enterCode(page, 'FCM-EN');
  await selectTask(page, 'Choosing fund shares: an eight-year investment');
  await page.getByRole('radio', { name: 'B Share class B' }).check();
  await page.getByLabel('Confidence value').fill('74');
  // The local gateway uses a short delay instead of an HTTP boundary. Reject
  // that next operation before it accepts a decision, then reload normally.
  await page.evaluate(() => {
    const original = window.setTimeout.bind(window);
    let failOnce = true;
    window.setTimeout = ((handler: TimerHandler, delay?: number, ...args: unknown[]) => {
      if (failOnce && delay === 350) { failOnce = false; throw new Error('Temporary submission failure.'); }
      return original(handler, delay, ...args);
    }) as typeof window.setTimeout;
  });
  await page.getByRole('button', { name: 'Continue to conversation' }).click();
  await expect(page.getByRole('alert')).toHaveText('Temporary submission failure.');
  await expect(page.getByLabel('Confidence value')).toHaveValue('74');
  await expect(page.getByRole('radio', { name: 'B Share class B' })).toBeChecked();
  await page.reload();
  await expect(page.getByRole('heading', { name: 'Initial choice', exact: true })).toBeVisible();
  await expect(page.getByLabel('Confidence value')).toHaveValue('74');
  await expect(page.getByRole('radio', { name: 'B Share class B' })).toBeChecked();
  await page.getByRole('button', { name: 'Continue to conversation' }).click();
  await expect(page.getByRole('heading', { name: 'Conversation', exact: true })).toBeVisible();
});
