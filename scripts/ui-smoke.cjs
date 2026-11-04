// Run against the isolated demo API, never production:
// npx --package @playwright/cli playwright-cli -s=bank-audit run-code --filename scripts/ui-smoke.cjs
async (page) => {
  const origin = 'http://127.0.0.1:4322';
  const api = 'http://127.0.0.1:8011/api/';
  const nonce = Date.now();
  const password = 'Review!Ocean427';
  const email = `review-${nonce}@example.test`;
  const screenshots = 'artifacts';
  const checked = [];
  const assert = (condition, message) => { if (!condition) throw new Error(message); };
  const go = async (hash, title) => { await page.goto(origin + '/#' + hash); await page.getByRole('heading', { name: title, exact: true, level: 1 }).waitFor(); };
  await page.goto(origin);
  await page.evaluate(() => { localStorage.removeItem('hdfc.access'); sessionStorage.removeItem('hdfc.access'); });
  await page.goto(origin + '/#register');
  await page.getByLabel('Full name', { exact: true }).fill('Alice Review');
  await page.getByLabel('Email address', { exact: true }).fill(email);
  await page.getByRole('textbox', { name: 'Password', exact: true }).fill(password);
  await page.getByRole('button', { name: 'Open account', exact: true }).click();
  await page.getByRole('heading', { name: 'Welcome, Alice' }).waitFor();
  checked.push('Registration and account creation');
  assert(await page.evaluate(() => !!localStorage.getItem('hdfc.access') && !sessionStorage.getItem('hdfc.access')), 'Login was not persisted');
  await page.reload();
  await page.getByRole('heading', { name: 'Welcome, Alice' }).waitFor();
  checked.push('Persistent login after reload');

  await page.getByRole('button', { name: 'Deposit', exact: true }).click();
  await page.getByLabel('Amount (INR)').fill('1000');
  await page.getByRole('button', { name: 'Review deposit' }).click();
  await page.getByRole('button', { name: 'Confirm deposit' }).click();
  await page.getByRole('heading', { name: 'Deposit completed' }).waitFor();
  await page.getByRole('button', { name: 'Done', exact: true }).click();
  checked.push('Deposit review and receipt');

  const bobResponse = await page.request.post(api + 'auth/register/', { data: { name: 'Bob Receiver', email: `receiver-${nonce}@example.test`, password } });
  assert(bobResponse.ok(), 'Receiver registration failed');
  const bob = await bobResponse.json();
  const receiverContext = await page.context().browser().newContext();
  const receiver = await receiverContext.newPage();
  await receiver.goto(origin);
  await receiver.evaluate(token => localStorage.setItem('hdfc.access', token), bob.token);
  await receiver.goto(origin + '/#payments/receive');
  await receiver.getByRole('heading', { name: 'Your receive QR' }).waitFor();
  await receiver.getByLabel('Request amount (INR)').fill('75.50');
  await receiver.getByLabel('Payment note').fill('Shared lunch');
  await receiver.locator('.receive-code svg').screenshot({ path: screenshots + '/receiver-qr.png' });
  await go('payments', 'Scan & pay');
  await page.getByRole('button', { name: /^Pay with QR/ }).click();
  await page.getByLabel('Upload QR image').setInputFiles(screenshots + '/receiver-qr.png');
  await page.getByRole('dialog').waitFor();
  assert(await page.getByLabel('Recipient account number').inputValue() === bob.account.number, 'QR recipient was not decoded');
  assert(await page.getByLabel('Amount (INR)').inputValue() === '75.50', 'QR amount was not decoded');
  await page.getByRole('button', { name: 'Review transfer' }).click();
  await page.getByLabel('Create transaction PIN').fill('1234');
  await page.getByLabel('Confirm transaction PIN').fill('1234');
  await page.getByRole('button', { name: 'Confirm transfer' }).click();
  await page.getByRole('heading', { name: 'Transfer completed' }).waitFor();
  await page.getByRole('button', { name: 'Done', exact: true }).click();
  await receiver.goto(origin + '/#overview');
  await receiver.getByRole('button', { name: 'Show balance and account number' }).click();
  await receiver.getByText('₹75.50', { exact: true }).first().waitFor();
  await receiverContext.close();
  checked.push('QR image scan → verified recipient → new PIN → payment → receiver balance');

  await go('overview', 'Welcome, Alice');
  await page.getByRole('button', { name: 'Withdraw', exact: true }).click();
  await page.getByLabel('Amount (INR)').fill('10');
  await page.getByRole('button', { name: 'Review withdrawal' }).click();
  await page.getByLabel('Transaction PIN', { exact: true }).fill('1234');
  // Commit the withdrawal at the API, then simulate losing its response.
  await page.route(api + 'movements/', async route => {
    const response = await route.fetch();
    assert(response.status() === 201, 'Interrupted withdrawal was not committed');
    await route.abort('failed');
  }, { times: 1 });
  await page.getByRole('button', { name: 'Confirm withdrawal' }).click();
  await page.getByRole('button', { name: 'Retry confirmation' }).waitFor();
  await page.getByRole('button', { name: 'Close dialog' }).click();
  await page.reload();
  await page.getByRole('button', { name: /Review withdraw/ }).click();
  await page.getByLabel('Transaction PIN', { exact: true }).fill('1234');
  await page.getByRole('button', { name: 'Retry confirmation' }).click();
  await page.getByRole('heading', { name: 'Withdrawal completed' }).waitFor();
  await page.getByRole('button', { name: 'Done', exact: true }).click();
  await page.getByRole('button', { name: 'Show balance and account number' }).click();
  await page.getByText('₹914.50', { exact: true }).waitFor();
  assert(await page.getByRole('region', { name: 'Pending transactions' }).count() === 0, 'Completed request was still pending');
  checked.push('Lost withdrawal response → reload → same-request retry → no duplicate debit');

  await go('profile/details', 'Personal details');
  await page.getByRole('button', { name: 'Edit personal details' }).click();
  await page.getByLabel('Full name').fill('Alice Updated');
  await page.getByLabel('Mobile number').fill('+919876543210');
  await page.getByLabel('Address', { exact: false }).last().fill('New Delhi');
  await page.getByRole('button', { name: 'Save profile' }).click();
  await page.getByText('Profile updated.', { exact: true }).waitFor();
  await page.getByText('+919876543210', { exact: true }).waitFor();
  checked.push('Edit name, phone and address');

  await go('profile/nominee', 'Nominee');
  await page.getByRole('button', { name: 'Add nominee' }).click();
  await page.getByLabel('Nominee full name').fill('Nominee Child');
  await page.getByRole('combobox', { name: 'Relationship', exact: true }).selectOption('Child');
  await page.getByLabel('Date of birth').fill('2018-01-01');
  await page.getByLabel('Nominee address').fill('New Delhi');
  await page.getByLabel('Guardian full name').fill('Adult Guardian');
  await page.getByLabel('Guardian relationship').fill('Parent');
  await page.getByLabel('Guardian address').fill('New Delhi');
  await page.getByLabel('Transaction PIN', { exact: true }).fill('1234');
  await page.getByRole('button', { name: 'Save nominee' }).click();
  await page.getByText('Nominee saved.', { exact: true }).waitFor();
  checked.push('Minor nominee with guardian, PIN protection and saved details');

  await go('profile/recipients', 'Saved recipients');
  await page.getByRole('button', { name: 'Add recipient' }).click();
  await page.getByLabel('Recipient account number').fill(bob.account.number);
  await page.getByLabel('Nickname').fill('Lunch friend');
  await page.getByRole('button', { name: 'Save recipient' }).click();
  await page.getByText('Lunch friend', { exact: true }).waitFor();
  checked.push('Save verified recipient');

  await go('profile/preferences', 'Preferences');
  await page.getByLabel('Lock outgoing payments').check();
  await page.getByLabel('Transaction PIN').fill('1234');
  await page.getByRole('button', { name: 'Save preferences' }).click();
  await page.getByText('Preferences saved.', { exact: true }).waitFor();
  await go('overview', 'Welcome, Alice');
  assert(await page.getByRole('button', { name: 'Withdraw', exact: true }).isDisabled(), 'Withdrawal was enabled while locked');
  await go('profile/preferences', 'Preferences');
  await page.getByLabel('Lock outgoing payments').uncheck();
  await page.getByLabel('Transaction PIN').fill('1234');
  await page.getByRole('button', { name: 'Save preferences' }).click();
  await page.getByText('Preferences saved.', { exact: true }).waitFor();
  checked.push('Payment lock and unlock');

  await go('cards', 'Virtual debit card');
  await page.getByRole('button', { name: 'Create virtual card', exact: true }).click();
  await page.getByLabel('Transaction PIN').fill('1234');
  await page.getByRole('button', { name: 'Confirm card creation' }).click();
  await page.getByText('Virtual card created.', { exact: true }).waitFor();
  await page.getByRole('button', { name: 'Freeze card', exact: true }).click();
  await page.getByLabel('Transaction PIN').fill('1234');
  await page.getByRole('button', { name: 'Confirm freeze' }).click();
  await page.getByText('Card frozen.', { exact: true }).waitFor();
  checked.push('Virtual card creation and freeze');

  await go('profile/help', 'Help & support');
  await page.getByRole('button', { name: 'New support request' }).click();
  await page.getByLabel('Describe the problem').fill('Please check this demo support request.');
  await page.getByRole('button', { name: 'Submit support request' }).click();
  await page.getByText('Please check this demo support request.', { exact: true }).waitFor();
  checked.push('Support request submission and saved status');

  await go('activity', 'Transaction history');
  const downloaded = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Export statement (CSV)' }).click();
  await (await downloaded).saveAs(screenshots + '/account-statement.csv');
  checked.push('Statement export');

  const geometry = [];
  for (const width of [390, 1440, 1728]) {
    await page.setViewportSize({ width, height: 900 });
    await go('profile', 'Profile & settings');
    await page.screenshot({ path: screenshots + `/settings-${width}.png`, fullPage: true });
    const measurements = await page.evaluate(() => ({ viewport: innerWidth, document: document.documentElement.scrollWidth, heading: document.querySelector('h1').getBoundingClientRect().toJSON(), navigation: [...document.querySelectorAll('.sidebar nav a')].map(element => ({ text: element.textContent, rect: element.getBoundingClientRect().toJSON() })) }));
    assert(measurements.document <= width, `Horizontal overflow at ${width}px`);
    geometry.push(measurements);
  }
  await page.setViewportSize({ width: 390, height: 844 });
  await go('payments/receive', 'Scan & pay');
  await page.screenshot({ path: screenshots + '/receive-mobile.png', fullPage: true });
  await go('profile/security', 'Security');
  await page.screenshot({ path: screenshots + '/security-mobile.png', fullPage: true });
  checked.push('Responsive settings and QR layouts at 390, 1440 and 1728px');
  return { email, checked, geometry };
}
