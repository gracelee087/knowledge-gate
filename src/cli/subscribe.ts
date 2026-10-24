// Ask the YouTube hub to send our channels' upload notifications to our webhook (one subscription per channel). The hub then checks the
// callback with a GET (see src/server/webhook.ts), which logs the lease it granted.
// Usage: npx tsx src/cli/subscribe.ts [unsubscribe]   (env: CALLBACK_URL, WEBSUB_SECRET)
import '../lib/env.ts';
import { need } from '../lib/env.ts';
import { TOPICS } from '../lib/channel.ts';

export async function subscribe(mode = 'subscribe') {
  const out: string[] = [];
  for (const topic of TOPICS) {
    const res = await fetch('https://pubsubhubbub.appspot.com/subscribe', {
      method: 'POST',
      body: new URLSearchParams({ 'hub.mode': mode, 'hub.topic': topic, 'hub.callback': need('CALLBACK_URL'), 'hub.secret': need('WEBSUB_SECRET'), 'hub.verify': 'async' }),
      signal: AbortSignal.timeout(30_000),
    });
    out.push(`${mode} ${topic.split('=')[1]}: hub answered ${res.status} ${(await res.text()).slice(0, 100)}`);
  }
  return out.join('\n');
}

if (process.argv[1]?.replace(/\\/g, '/').endsWith('cli/subscribe.ts')) console.log(await subscribe(process.argv[2] ?? 'subscribe'));
