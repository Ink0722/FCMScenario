import { expect, test, type Page } from '@playwright/test';

async function enterCode(page: Page, code: string) {
  await page.getByLabel('Participant code', { exact: true }).fill(code);
  await page.getByRole('checkbox').check();
  await page.getByRole('button', { name: 'Begin', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Study tasks', exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Complete questionnaire', exact: true }).click();
  for (const group of await page.locator('.profile-form fieldset').all()) await group.getByRole('radio').first().check();
  await page.getByRole('button', { name: 'Submit and return to tasks', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Study tasks', exact: true })).toBeVisible();
}
async function beginEnglishTask(page: Page) {
  await page.locator('.task-choice').getByRole('radio').check();
  await page.getByRole('button', { name: 'Begin task', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Initial choice', exact: true })).toBeVisible();
}

test('console reset restarts the current code, optionally clears Profile and preserves another code', async ({ page }) => {
  await page.goto('/');
  await enterCode(page, 'FCM-2026');
  const otherProfile = await page.evaluate(() => JSON.parse(sessionStorage.getItem('fcm.mock-service.v2')!).profiles['FCM-2026']);
  await page.getByRole('button', { name: 'Use another code', exact: true }).click();
  await enterCode(page, 'FCM-EN');
  await beginEnglishTask(page);
  await page.getByRole('radio', { name: 'A Share class A', exact: true }).check();
  await page.getByLabel('Confidence value').fill('63');
  await page.getByRole('button', { name: 'Continue to conversation', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Conversation', exact: true })).toBeVisible();
  await page.getByLabel('Your message', { exact: true }).fill('This is an unsent draft.');
  await page.evaluate(() => window.fcmDev!.resetCode());
  await expect(page.getByRole('heading', { name: 'Study tasks', exact: true })).toBeVisible();
  await expect(page.locator('.profile-task .task-status.completed')).toBeVisible();
  await expect(page.locator('.task-choice .task-status')).toHaveText('Ready');
  expect(await page.evaluate(() => Object.keys(JSON.parse(sessionStorage.getItem('fcm.mock-service.v2')!).sessions))).toEqual([]);
  await beginEnglishTask(page);
  await expect(page.getByLabel('Confidence value')).toHaveValue('');
  await expect(page.getByRole('radio', { name: 'A Share class A', exact: true })).not.toBeChecked();
  await page.getByRole('radio', { name: 'B Share class B', exact: true }).check();
  await page.getByLabel('Confidence value').fill('27');
  await page.evaluate(() => window.fcmDev!.resetCode({ includeProfile: true }));
  await expect(page.getByRole('button', { name: 'Complete questionnaire', exact: true })).toBeVisible();
  await expect(page.locator('.task-choice input')).toBeDisabled();
  const saved = await page.evaluate(() => ({
    database: JSON.parse(sessionStorage.getItem('fcm.mock-service.v2')!),
    drafts: Object.keys(sessionStorage).filter(key => key.startsWith('fcm.draft.v1:')),
  }));
  expect(saved.database.profiles['FCM-EN']).toBeUndefined();
  expect(saved.database.profiles['FCM-2026']).toEqual(otherProfile);
  expect(Object.keys(saved.database.sessions)).toEqual([]);
  expect(saved.drafts).toEqual([]);
  await expect(page.getByRole('button', { name: /reset/i })).toHaveCount(0);
});

test('a pending mock submission cannot write the old database back after a development reset', async ({ page }) => {
  await page.goto('/');
  await enterCode(page, 'FCM-EN');
  await beginEnglishTask(page);
  await page.getByRole('radio', { name: 'A Share class A', exact: true }).check();
  await page.getByLabel('Confidence value').fill('51');
  await page.getByRole('button', { name: 'Continue to conversation', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Saving…', exact: true })).toBeVisible();
  // Hold the current page so the old request can settle. The actual console
  // command always reloads immediately after this same storage operation.
  await page.evaluate(async () => {
    const { resetLocalCode } = await import('/src/dev/tools.ts');
    resetLocalCode(sessionStorage);
  });
  await expect(page.getByRole('alert')).toContainText('Local test data was reset.');
  expect(await page.evaluate(() => Object.keys(JSON.parse(sessionStorage.getItem('fcm.mock-service.v2')!).sessions))).toEqual([]);
  await page.reload();
  await expect(page.getByRole('heading', { name: 'Study tasks', exact: true })).toBeVisible();
  await expect(page.locator('.task-choice .task-status')).toHaveText('Ready');
});
