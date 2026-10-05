import { Client, Events, GatewayIntentBits, Partials } from 'discord.js';

import { renderCommands } from './commands.js';

/**
 * Build the Discord client.
 *
 * `MessageContent` is a privileged intent: enable it both in the developer
 * portal and here, otherwise every message body arrives empty.
 *
 * @returns {Client} an unconnected Discord client.
 */
export function createClient()
{
	return new Client(
	{
		intents: [
			GatewayIntentBits.Guilds,
			GatewayIntentBits.GuildMessages,
			GatewayIntentBits.MessageContent,
			GatewayIntentBits.DirectMessages,
		],
		partials: [Partials.Channel],
	});
}

/**
 * Wait a number of milliseconds.
 *
 * @param {number} ms delay length.
 * @returns {Promise<void>} resolves after the delay.
 */
function sleep(ms)
{
	return new Promise((resolve) =>
	{
		setTimeout(resolve, ms);
	});
}

/**
 * Wire up message handling. Returns the client for convenience.
 *
 * Command parsing stays in `src/commands.js` (pure text in, text out); this
 * handler only joins the reply lines into one Discord message.
 *
 * @param {Client} client client to attach listeners to.
 * @param {object} [options] optional overrides.
 * @param {Console} [options.logger] log sink, defaults to `console`.
 * @param {number} [options.replyDelayMs] wait before sending a reply, in ms (default 250, `0` disables).
 * @returns {Client} the same client.
 */
export function attachMessageHandler(client, options = {})
{
	const logger = options.logger ?? console;
	const replyDelayMs = options.replyDelayMs ?? 250;

	client.on(Events.ClientReady, (ready) =>
	{
		logger.log(`[dicefoxes] logged in as ${ready.user.tag}`);
	});

	client.on(Events.MessageCreate, async (message) =>
	{
		if (!message || message.author?.bot)
		{
			return;
		}

		const context = { userId: message.author?.id ?? null };
		let rendered;
		try
		{
			rendered = renderCommands(message.content ?? '', { context });
		}
		catch (error)
		{
			logger.error('[dicefoxes] unexpected failure while rendering commands', error);
			return;
		}

		for (const skip of rendered.skipped)
		{
			logger.warn(`[dicefoxes] skipped ${skip.name} "${skip.text}" in ${message.channelId}: ${skip.reason}`);
		}

		if (rendered.lines.length === 0)
		{
			return;
		}

		if (replyDelayMs > 0)
		{
			await sleep(replyDelayMs);
		}

		try
		{
			await message.channel.send(rendered.lines.join('\n'));
		}
		catch (error)
		{
			logger.warn(`[dicefoxes] could not send to channel ${message.channelId}: ${error.message}`);
		}
	});

	client.on(Events.Error, (error) =>
	{
		logger.error('[dicefoxes] client error', error);
	});

	return client;
}

/**
 * Create, wire up, and log in the bot.
 *
 * @param {string} token Discord bot token from `process.env.DISCORD_TOKEN`.
 * @param {object} [options] optional overrides.
 * @param {Console} [options.logger] log sink, defaults to `console`.
 * @param {number} [options.replyDelayMs] wait before sending a reply, in ms (default 250, `0` disables).
 * @param {Client} [options.client] supply a client instead of building one.
 * @returns {Promise<Client>} resolves once the gateway connection is up.
 */
export async function startBot(token, options = {})
{
	const logger = options.logger ?? console;

	if (!token)
	{
		throw new Error('No Discord token provided. Fill in DISCORD_TOKEN in .env.');
	}

	const client = options.client ?? createClient();
	attachMessageHandler(client, { ...options, logger });

	await client.login(token);
	return client;
}
