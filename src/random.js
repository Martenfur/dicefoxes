/**
 * Randomness module: swappable batched dice providers.
 *
 * The resolver collects every die in a formula first and hands the whole
 * list here in one call, instead of rolling on demand. Two providers:
 *
 * - `local` (🎲): `node:crypto` CSPRNG. Instant, offline, always works.
 * - `randomorg` (☁️): true randomness via one `generateIntegerSequences`
 *   JSON-RPC call per formula (one sequence per dice term, even with mixed
 *   sides). Any failure — timeout, network error, API refusal, malformed
 *   data — falls back to `local` for that roll.
 *
 * The active provider is chosen in `index.js` from the environment; this
 * module never reads `process.env` itself, so providers stay injectable in
 * tests via `fetchImpl`.
 */

import { randomInt } from 'node:crypto';

/**
 * @typedef {object} DiceSpec
 * @property {number} count how many dice to roll.
 * @property {number} [sides] faces per die (1 to `sides`); absent for FATE dice.
 * @property {boolean} [fate] true for FATE dice, which land on -1, 0, or 1.
 */

/**
 * @typedef {object} RandomSource
 * @property {string} id provider id (`local` or `random.org`).
 * @property {string} emoji badge shown next to rolled formulas.
 */

/**
 * @typedef {object} RollOutcome
 * @property {number[][]} faces one face array per spec, in request order.
 * @property {RandomSource} source provider that actually served the roll.
 * @property {string|null} fallbackReason why `local` covered, or null.
 */

/**
 * @typedef {object} RandomProvider
 * @property {string} provider configured provider id.
 * @property {(specs: DiceSpec[]) => Promise<RollOutcome>} roll roll all specs at once.
 */

/** Local CSPRNG provider: instant, offline. */
export const LOCAL_SOURCE = { id: 'local', emoji: '🎲' };

/** random.org provider: true randomness, one JSON-RPC call per formula. */
export const RANDOM_ORG_SOURCE = { id: 'random.org', emoji: '☁️' };

/** random.org JSON-RPC endpoint (Basic API, release 4). */
export const RANDOM_ORG_URL = 'https://api.random.org/json-rpc/4/invoke';

/** random.org caps: at most this many sequences and values per call. */
const RANDOM_ORG_MAX_SEQUENCES = 1000;
const RANDOM_ORG_MAX_VALUES = 10000;

/** Default ceiling for one random.org call, in milliseconds. */
const DEFAULT_TIMEOUT_MS = 5000;

let nextRequestId = 1;

/**
 * Roll many dice at once with the local CSPRNG.
 *
 * @param {DiceSpec[]} specs what to roll, in left-to-right formula order.
 * @returns {number[][]} one face array per spec, in the same order.
 */
export function rollBatch(specs)
{
	return specs.map((spec) =>
	{
		const faces = [];
		for (let i = 0; i < spec.count; i += 1)
		{
			faces.push(spec.fate ? randomInt(0, 3) - 1 : randomInt(1, spec.sides + 1));
		}
		return faces;
	});
}

/**
 * Roll many dice with the local provider, tagged with its source.
 *
 * @param {DiceSpec[]} specs what to roll, in left-to-right formula order.
 * @returns {RollOutcome} faces plus the local source.
 */
export function rollLocal(specs)
{
	return { faces: rollBatch(specs), source: LOCAL_SOURCE, fallbackReason: null };
}

/**
 * Turn dice specs into one multiform `generateIntegerSequences` request.
 * FATE dice ask for -1..1 directly (the API allows negative bounds).
 *
 * @param {DiceSpec[]} specs what to roll.
 * @returns {{length: number[], min: number[], max: number[]}} sequence params.
 */
function toSequences(specs)
{
	const length = [];
	const min = [];
	const max = [];
	for (const spec of specs)
	{
		length.push(spec.count);
		if (spec.fate)
		{
			min.push(-1);
			max.push(1);
		}
		else
		{
			min.push(1);
			max.push(spec.sides);
		}
	}
	return { length, min, max };
}

/**
 * Check a random.org payload against what was asked.
 *
 * @param {unknown} data `result.random.data` from the API.
 * @param {DiceSpec[]} specs what was requested.
 * @returns {number[][]} validated face arrays.
 */
function readSequences(data, specs)
{
	if (!Array.isArray(data) || data.length !== specs.length)
	{
		throw new Error('random.org answered with the wrong number of sequences');
	}

	return data.map((sequence, index) =>
	{
		const spec = specs[index];
		const lo = spec.fate ? -1 : 1;
		const hi = spec.fate ? 1 : spec.sides;
		if (!Array.isArray(sequence) || sequence.length !== spec.count)
		{
			throw new Error('random.org answered with the wrong sequence length');
		}

		for (const value of sequence)
		{
			if (!Number.isInteger(value) || value < lo || value > hi)
			{
				throw new Error('random.org answered with an out-of-range value');
			}
		}

		return [...sequence];
	});
}

/**
 * Build a random.org roller: one `generateIntegerSequences` call per roll.
 * It throws on any problem (timeout, network, refusal, bad data) — the
 * caller in {@link createRandom} turns that into a local fallback.
 *
 * @param {object} options provider options.
 * @param {string} options.apiKey random.org API key (never logged).
 * @param {number} [options.timeoutMs] request ceiling in ms.
 * @param {Function} [options.fetchImpl] `fetch` replacement for tests.
 * @returns {(specs: DiceSpec[]) => Promise<RollOutcome>} random.org roller.
 */
export function createRandomOrgRoller({ apiKey, timeoutMs = DEFAULT_TIMEOUT_MS, fetchImpl = globalThis.fetch } = {})
{
	if (!apiKey)
	{
		throw new Error('random.org needs an API key');
	}

	return async function rollRandomOrg(specs)
	{
		if (specs.length === 0)
		{
			return { faces: [], source: RANDOM_ORG_SOURCE, fallbackReason: null };
		}

		const total = specs.reduce((sum, spec) => sum + spec.count, 0);
		if (specs.length > RANDOM_ORG_MAX_SEQUENCES || total > RANDOM_ORG_MAX_VALUES)
		{
			throw new Error('formula is too large for one random.org call');
		}

		const { length, min, max } = toSequences(specs);
		const body = JSON.stringify({
			jsonrpc: '2.0',
			method: 'generateIntegerSequences',
			params: { apiKey, n: specs.length, length, min, max, replacement: true, base: 10 },
			id: nextRequestId++,
		});

		let response;
		const attempt = fetchImpl(RANDOM_ORG_URL, {
			method: 'POST',
			headers: { 'Content-Type': 'application/json' },
			body,
		});
		const timeout = new Promise((_, reject) =>
		{
			setTimeout(() => reject(new Error(`random.org timed out after ${timeoutMs}ms`)), timeoutMs);
		});

		try
		{
			// Raced, not aborted: a uniform timeout message for real and
			// injected fetch alike, with no dangling rejections afterwards.
			response = await Promise.race([attempt, timeout]);
		}
		catch (error)
		{
			throw new Error(`random.org request failed: ${error.message}`);
		}

		if (!response || typeof response.ok !== 'boolean' || !response.ok)
		{
			throw new Error(`random.org answered HTTP ${response?.status ?? 'unknown'}`);
		}

		let payload;
		try
		{
			payload = await response.json();
		}
		catch
		{
			throw new Error('random.org answered with invalid JSON');
		}

		if (payload && payload.error)
		{
			throw new Error(`random.org refused: ${payload.error.message ?? JSON.stringify(payload.error)}`);
		}

		return { faces: readSequences(payload?.result?.random?.data, specs), source: RANDOM_ORG_SOURCE, fallbackReason: null };
	};
}

/**
 * Build the active randomness provider.
 *
 * Without an explicit `provider`, a present `apiKey` selects `randomorg`
 * and a missing one selects `local`. random.org failures fall back to local
 * per roll and say so in `fallbackReason`.
 *
 * @param {object} [options] provider options.
 * @param {string} [options.provider] `local` or `randomorg`.
 * @param {string} [options.apiKey] random.org API key (never logged).
 * @param {number} [options.timeoutMs] random.org ceiling in ms.
 * @param {Function} [options.fetchImpl] `fetch` replacement for tests.
 * @returns {RandomProvider} active provider.
 */
export function createRandom(options = {})
{
	const provider = options.provider ?? (options.apiKey ? 'randomorg' : 'local');
	if (provider !== 'local' && provider !== 'randomorg')
	{
		throw new Error(`Unknown randomness provider "${provider}" — try "local" or "randomorg"`);
	}

	if (provider === 'randomorg' && !options.apiKey)
	{
		throw new Error('provider "randomorg" needs RANDOM_ORG_API_KEY');
	}

	const orgRoll = provider === 'randomorg'
		? createRandomOrgRoller({ apiKey: options.apiKey, timeoutMs: options.timeoutMs, fetchImpl: options.fetchImpl })
		: null;

	async function roll(specs)
	{
		if (!orgRoll)
		{
			return rollLocal(specs);
		}

		try
		{
			return await orgRoll(specs);
		}
		catch (error)
		{
			const local = rollLocal(specs);
			return { ...local, fallbackReason: error.message };
		}
	}

	return { provider, roll };
}
