import { expect, test } from '@playwright/test';

test('HTTP mode serves the code-entry page while no formal cases are published', async ({ page }) => {
  await page.goto('/');
  await expect(page.getByRole('heading', { name: 'Enter your code' })).toBeVisible();
  await expect(page.getByRole('region', { name: 'Study instructions', exact: true })).toBeVisible();
});
