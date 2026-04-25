// Run: WORKER_URL=https://hydra.<acct>.workers.dev TELEGRAM_BOT_TOKEN=... npm run telegram:setwebhook
declare const process: { env: Record<string, string | undefined> };
export {};
const token = process.env.TELEGRAM_BOT_TOKEN;
const url = process.env.WORKER_URL;
if (!token || !url) throw new Error('TELEGRAM_BOT_TOKEN and WORKER_URL required');

const res = await fetch(`https://api.telegram.org/bot${token}/setWebhook`, {
  method: 'POST',
  headers: { 'content-type': 'application/json' },
  body: JSON.stringify({ url: `${url}/telegram` }),
});
console.log(await res.json());
