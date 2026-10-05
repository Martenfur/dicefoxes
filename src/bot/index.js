import { Client, Events, GatewayIntentBits, Partials } from 'discord.js';

/**
 * Check whether a message should trigger the bot.
 *
 * @param {string} content raw message text.
 * @returns {boolean} true when the text starts with `roll` or `ролл`.
 */
export function isRollTrigger(content)
{
	if (typeof content !== 'string' || content.length === 0)
	{
		return false;
	}

	const lowered = content.trimStart().toLowerCase();
	return lowered.startsWith('roll') || lowered.startsWith('ролл');
}

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
 * Wire up message handling. Returns the client for convenience.
 *
 * @param {Client} client client to attach listeners to.
 * @param {object} [options] optional overrides.
 * @param {Console} [options.logger] log sink, defaults to `console`.
 * @returns {Client} the same client.
 */
export function attachMessageHandler(client, options = {})
{
	const logger = options.logger ?? console;

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

		if (!isRollTrigger(message.content ?? ''))
		{
			return;
		}

		try
		{
			await message.channel.send('roll! :D');
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
	attachMessageHandler(client, { logger });

	await client.login(token);
	return client;
}
