import { expect, test, type Page } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';

function issued() { return JSON.parse(readFileSync('../backend/runtime/http-e2e-codes.json', 'utf8')); }
async function enter(page: Page, index: number) {
  await page.goto('/');
  await page.getByLabel('Participant code', { exact: true }).fill(issued().codes[index].code);
  await page.getByRole('checkbox').check();
  await page.getByRole('button', { name: 'Begin', exact: true }).click();
  await page.getByRole('button', { name: 'Complete questionnaire', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Background questionnaire', exact: true })).toBeVisible();
  for (const group of await page.locator('.profile-form fieldset').all()) await group.getByRole('radio').first().check();
  await page.getByRole('button', { name: 'Submit and return to tasks' }).click();
  await page.locator('.task-choice').getByRole('radio').check();
  await page.getByRole('button', { name: 'Begin task', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Initial choice', exact: true })).toBeVisible();
  await page.getByRole('radio').first().check();
  await page.getByLabel('Confidence value').fill('0');
  await page.getByRole('button', { name: 'Continue to conversation' }).click();
  await expect(page.getByRole('heading', { name: 'Conversation', exact: true })).toBeVisible();
}
function drain() {
  const python = process.env.FCM_PYTHON ?? `${process.env.CONDA_PREFIX}/bin/python`;
  const code = `import json; from pathlib import Path; from backend.app.settings import Settings,ROOT; from backend.app.db import Database; from backend.app.content import ContentStore; from backend.app.service import Service; from backend.app.worker import tick; data=json.loads((ROOT/'runtime/http-e2e-runtime.json').read_text()); s=Settings(data['database_url'],Path(data['artifact_dir']),'integration-secret-'*4,'123456'); db=Database(s.database_url); svc=Service(s,ContentStore(s.artifact_dir,s.study_file)); [tick(db,svc) for _ in range(4)]`;
  execFileSync(python, ['-c', code], { cwd: '..' });
}

test('HTTP acceptance survives reload, then automatic final judgment and durable completion', async ({ page }) => {
  const errors: string[] = []; page.on('pageerror', error => errors.push(error.message));
  await enter(page, 0);
  await expect(page.locator('.message.assistant').first()).toContainText('deterministic');
  await page.getByPlaceholder('Ask a question about the materials…').fill('Please explain the fees.');
  await page.getByRole('button', { name: 'Send', exact: true }).click();
  await expect(page.getByText('Your message is saved and queued. Waiting for a reply…')).toBeVisible();
  await expect(page.getByRole('button', { name: 'End conversation', exact: true })).toBeDisabled();
  await page.screenshot({ path: '../build/backend-qa/http-queued.png', fullPage: true });
  await page.reload();
  await expect(page.getByText('Your message is saved and queued. Waiting for a reply…')).toBeVisible();
  drain();
  await expect(page.getByPlaceholder('Ask a question about the materials…')).toBeEnabled();
  await expect(page.locator('.message.user')).toHaveCount(1);
  await expect(page.locator('.message.assistant')).toHaveCount(2);
  await page.screenshot({ path: '../build/backend-qa/http-dialogue.png', fullPage: true });
  for (let i=0;i<2;i++) {
    await page.getByPlaceholder('Ask a question about the materials…').fill(`Another question ${i}`);
    await page.getByRole('button', { name: 'Send', exact: true }).click();
    await expect(page.getByText('Your message is saved and queued. Waiting for a reply…')).toBeVisible();
    drain();
    if (i === 0) await expect(page.getByPlaceholder('Ask a question about the materials…')).toBeEnabled();
  }
  await expect(page.getByRole('heading', { name: 'Final choice', exact: true })).toBeVisible();
  await page.getByRole('radio').last().check();
  await page.getByLabel('Confidence value').fill('100');
  await page.getByRole('button', { name: 'Submit final choice' }).click();
  await expect(page.getByRole('heading', { name: 'Task complete', exact: true })).toBeVisible();
  await page.reload();
  await expect(page.getByRole('heading', { name: 'Task complete', exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Back to tasks', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Your study tasks are complete' })).toBeVisible();
  await page.screenshot({ path: '../build/backend-qa/http-complete.png', fullPage: true });
  expect(errors).toEqual([]);
});

test('temporary access restore failure preserves cache and offers reconnect', async ({ page }) => {
  await enter(page, 1);
  await page.route('**/api/v1/access', route => route.abort('failed'));
  await page.reload();
  await expect(page.getByRole('button', { name: 'Reconnect', exact: true })).toBeVisible();
  await page.unroute('**/api/v1/access');
  await page.getByRole('button', { name: 'Reconnect', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Conversation', exact: true })).toBeVisible();
});

test('leaving a queued reply closes the old attempt and permits a clean new attempt', async ({ page }) => {
  await enter(page, 2);
  await page.getByPlaceholder('Ask a question about the materials…').fill('Queued question');
  await page.getByRole('button', { name: 'Send', exact: true }).click();
  await expect(page.getByText('Your message is saved and queued. Waiting for a reply…')).toBeVisible();
  await page.getByRole('button', { name: 'Back to tasks', exact: true }).click();
  await expect(page.getByRole('dialog')).toBeVisible();
  await page.getByRole('dialog').getByRole('button', { name: 'Return and clear progress', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Study tasks', exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Complete questionnaire', exact: true })).toHaveCount(0);
  await page.locator('.task-choice').getByRole('radio').check();
  await page.getByRole('button', { name: 'Begin task', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Initial choice', exact: true })).toBeVisible();
  drain();
  await page.reload();
  await expect(page.getByRole('heading', { name: 'Initial choice', exact: true })).toBeVisible();
  await expect(page.getByLabel('Confidence value')).toHaveValue('');
});
