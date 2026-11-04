// Run from the repository root against the isolated demo on ports 8011/4322.
async (page) => {
  const response = await page.request.post('http://127.0.0.1:8011/api/auth/register/', { data: { name: 'A'.repeat(150), email: `long-${Date.now()}@example.test`, password: 'Long!Ocean427' } });
  if (!response.ok()) throw new Error('Local fixture failed');
  const session = await response.json();
  await page.goto('http://127.0.0.1:4322/');
  await page.evaluate(token => localStorage.setItem('hdfc.access', token), session.token);
  await page.reload();
  await page.getByRole('heading', { name: /^Welcome/ }).waitFor();
  const results = [];
  for (const width of [320, 390, 768, 1440, 1728]) {
    await page.setViewportSize({ width, height: 900 });
    for (const route of ['overview', 'profile', 'cards']) {
      await page.goto('http://127.0.0.1:4322/#' + route);
      await page.locator('h1').waitFor();
      results.push({ route, ...await page.evaluate(() => ({ width: innerWidth, scroll: document.documentElement.scrollWidth })) });
    }
  }
  await page.screenshot({ path: 'artifacts/long-name-desktop.png', fullPage: true });
  const failures = results.filter(row => row.scroll > row.width);
  if (failures.length) throw new Error('Horizontal overflow: ' + JSON.stringify(failures));
  return { checked: results.length, widths: [320, 390, 768, 1440, 1728], results };
}
