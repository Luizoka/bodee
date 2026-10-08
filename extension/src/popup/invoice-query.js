export async function queryInvoicesByAccount(accounts, query) {
  const settled = await Promise.allSettled(accounts.map(async (account) => [account, await query(account)]));
  const results = [];
  const failures = [];

  settled.forEach((result, index) => {
    if (result.status === 'fulfilled') results.push(result.value);
    else failures.push({ account: accounts[index], error: result.reason });
  });

  return { results, failures };
}
