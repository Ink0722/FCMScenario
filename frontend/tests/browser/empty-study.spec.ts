import { expect, test } from '@playwright/test';

test('the authoring workspace explains when no participant tasks are configured', async ({ page }) => {
  await page.goto('/');
  await page.getByLabel('Participant code', { exact: true }).fill('FCM-EMPTY');
  await page.getByRole('checkbox').check();
  await page.getByRole('button', { name: 'Begin', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Study tasks' })).toBeVisible();
  const profile = page.getByRole('button', { name: 'Complete questionnaire', exact: true });
  if (await profile.count()) {
    await profile.click();
    for (const group of await page.locator('.profile-form fieldset').all()) await group.getByRole('radio').first().check();
    await page.getByRole('button', { name: 'Submit and return to tasks' }).click();
  }
  await expect(page.getByRole('heading', { name: 'No tasks have been added yet' })).toBeVisible();
  await expect(page.getByText('FCM-EMPTY', { exact: true })).toBeVisible();
});
