import 'dotenv/config';

import { startBot } from './src/bot.js';
import { createRandom } from './src/random.js';

// Randomness comes from random.org when the key is present, with the local
// CSPRNG as the automatic fallback. The key value itself is never logged.
const random = createRandom({ apiKey: process.env.RANDOM_ORG_API_KEY });

startBot(process.env.DISCORD_TOKEN, { random }).catch((error) =>
{
	console.error('[dicefoxes] failed to start:', error);
	process.exitCode = 1;
});
