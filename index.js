import 'dotenv/config';

import { startBot } from './src/bot.js';

startBot(process.env.DISCORD_TOKEN).catch((error) =>
{
	console.error('[dicefoxes] failed to start:', error);
	process.exitCode = 1;
});
