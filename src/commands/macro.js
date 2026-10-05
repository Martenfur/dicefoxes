/**
 * Macro command: save dice formulas under multi-word names, roll them
 * later, and pin characters for short lookups.
 *
 * Subcommands: `set <name>: <formula>`, `delete <name>`, `show [prefix]`,
 * `me [character]`, `not me <character>`. Failures throw `DiceError`, which
 * the parser turns into silent skips (logged, never answered).
 */

import { DiceError, rollFormula } from '../dice.js';
import { LOCAL_SOURCE } from '../random.js';
import { macroStore } from '../macrostore.js';

/** How many nested-expansion passes before calling it a cycle. */
const MAX_EXPANSION_PASSES = 10;

/**
 * Normalise a macro or character name: lower case, single spaces.
 *
 * @param {string} text raw name text.
 * @returns {string} normalised name, or empty when blank.
 */
function normalizeName(text)
{
	return text.trim().toLowerCase().split(/\s+/).filter(Boolean).join(' ');
}

/**
 * Escape a string for use inside a regular expression.
 *
 * @param {string} text raw text.
 * @returns {string} text with every metacharacter backslash-escaped.
 */
function escapeRegExp(text)
{
	return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * Collect every expandable name: all macros plus, for each pinned
 * character, the suffixes of macros carrying that prefix.
 *
 * @param {import('../macrostore.js').MacroStore} store macro store.
 * @param {string|null} userId author id, or null when unknown.
 * @returns {string[]} candidate names.
 */
function collectCandidateNames(store, userId)
{
	const names = new Set(store.list().map(([name]) => name));
	for (const pin of store.pins(userId))
	{
		const prefix = `${pin} `;
		for (const [name] of store.list())
		{
			if (name.startsWith(prefix))
			{
				names.add(name.slice(prefix.length));
			}
		}
	}
	return [...names];
}

/**
 * Resolve matched words to a stored formula, trying pinned prefixes.
 *
 * @param {string} words lower-cased matched words.
 * @param {import('../macrostore.js').MacroStore} store macro store.
 * @param {string|null} userId author id, or null when unknown.
 * @returns {string|null} stored formula, or null when nothing matches.
 */
function resolveMacro(words, store, userId)
{
	if (store.has(words))
	{
		return store.get(words);
	}

	for (const pin of store.pins(userId))
	{
		const full = `${pin} ${words}`;
		if (store.has(full))
		{
			return store.get(full);
		}
	}

	return null;
}

/**
 * Expand macros once, left to right, without rescanning replacements.
 *
 * @param {string} text formula text.
 * @param {import('../macrostore.js').MacroStore} store macro store.
 * @param {string|null} userId author id, or null when unknown.
 * @returns {string} text with each macro wrapped in parentheses.
 */
function expandOnce(text, store, userId)
{
	const names = collectCandidateNames(store, userId);
	if (names.length === 0)
	{
		return text;
	}

	names.sort((a, b) => b.length - a.length);
	const source = `(^|[^\\p{L}\\p{N}_])(${names.map(escapeRegExp).join('|')})(?![\\p{L}\\p{N}_])`;
	return text.replace(new RegExp(source, 'giu'), (match, separator, words) =>
	{
		const formula = resolveMacro(words.toLowerCase(), store, userId);
		return formula === null ? match : `${separator}(${formula})`;
	});
}

/**
 * Expand every macro in a formula, following nested references.
 *
 * Each macro lands wrapped in its own parentheses, so `roll athletics * 2`
 * means `roll (1d20 + 12) * 2`, never `roll 1d20 + 12 * 2`.
 *
 * @param {string} text formula text.
 * @param {import('../macrostore.js').MacroStore} store macro store.
 * @param {string|null} userId author id, or null when unknown.
 * @returns {string} fully expanded formula.
 */
export function expandMacros(text, store, userId)
{
	let current = text;
	for (let i = 0; i < MAX_EXPANSION_PASSES; i += 1)
	{
		const next = expandOnce(current, store, userId);
		if (next === current)
		{
			return current;
		}
		current = next;
	}

	throw new DiceError('Macros loop — check for a cycle');
}

/**
 * Check whether a formula mentions a macro name as a whole word.
 *
 * @param {string} text formula text.
 * @param {string} name normalised macro name.
 * @returns {boolean} true on a whole-word hit.
 */
function referencesName(text, name)
{
	const source = `(^|[^\\p{L}\\p{N}_])${escapeRegExp(name)}(?![\\p{L}\\p{N}_])`;
	return new RegExp(source, 'iu').test(text);
}

/**
 * Trial-roll a formula with zeroed dice: validates syntax and limits
 * without caring about randomness.
 *
 * @param {string} formula expanded formula text.
 * @returns {Promise<void>} resolves when the formula is valid.
 */
async function validateFormula(formula)
{
	await rollFormula(formula, (specs) => ({ faces: specs.map((spec) => Array(spec.count).fill(0)), source: LOCAL_SOURCE }));
}

/**
 * Subcommands listed by `macro help`, in display order.
 */
const MACRO_SUBCOMMANDS = [
{
	sub: 'set',
	args: '<name>: <formula>',
	description: 'Saves a formula under a name so you can roll it later.',
},
{
	sub: 'delete',
	args: '<name>',
	description: 'Deletes a saved macro.',
},
{
	sub: 'show',
	args: '[prefix]',
	description: 'Lists saved macros, optionally filtered by a name prefix.',
},
{
	sub: 'me',
	args: '[character]',
	description: 'Pins a character so its macros work without the prefix. Without a name, lists your pins.',
},
{
	sub: 'not me',
	args: '<character>',
	description: 'Unpins a character.',
},
];

/**
 * Render stored macros as a nested `# MACROS` tree.
 *
 * @param {Array<[string, string]>} entries `[name, formula]` pairs.
 * @returns {string} reply block.
 */
export function renderMacroTree(entries)
{
	const lines = ['# MACROS'];
	if (entries.length === 0)
	{
		lines.push('    (empty)');
		return lines.join('\n');
	}

	const root = new Map();
	for (const [name, formula] of entries)
	{
		let node = root;
		const words = name.split(' ');
		for (let i = 0; i < words.length; i += 1)
		{
			if (!node.has(words[i]))
			{
				node.set(words[i], { formula: null, children: new Map() });
			}
			const child = node.get(words[i]);
			if (i === words.length - 1)
			{
				child.formula = formula;
			}
			node = child.children;
		}
	}

	const render = (node, indent) =>
	{
		for (const [word, child] of node)
		{
			if (child.children.size === 0)
			{
				lines.push(`${indent}${word}: ${child.formula}`);
			}
			else
			{
				lines.push(child.formula === null ? `${indent}${word}:` : `${indent}${word}: ${child.formula}`);
				render(child.children, `${indent}    `);
			}
		}
	};
	render(root, '');

	return lines.join('\n');
}

/**
 * Run `macro set <name>: <formula>`.
 *
 * @param {string} rest text after the subcommand.
 * @param {import('../macrostore.js').MacroStore} store macro store.
 * @param {string|null} userId author id, or null when unknown.
 * @returns {Promise<string>} confirmation line.
 */
async function macroSet(rest, store, userId)
{
	const colon = rest.indexOf(':');
	if (colon === -1)
	{
		throw new DiceError('Usage: macro set <name>: <formula>');
	}

	const name = normalizeName(rest.slice(0, colon));
	const formula = rest.slice(colon + 1).trim();
	if (!name || !formula)
	{
		throw new DiceError('Usage: macro set <name>: <formula>');
	}

	if (referencesName(formula, name))
	{
		throw new DiceError(`Macro "${name}" refers to itself`);
	}

	await validateFormula(expandMacros(formula, store, userId));
	const updated = store.has(name);
	store.set(name, formula);
	return updated ? `✅ macro "${name}" updated: ${formula}` : `✅ macro "${name}" set: ${formula}`;
}

/**
 * Run `macro delete <name>`.
 *
 * @param {string} rest text after the subcommand.
 * @param {import('../macrostore.js').MacroStore} store macro store.
 * @returns {string} confirmation line.
 */
function macroDelete(rest, store)
{
	const name = normalizeName(rest);
	if (!name)
	{
		throw new DiceError('Usage: macro delete <name>');
	}

	if (!store.has(name))
	{
		throw new DiceError(`No macro "${name}"`);
	}

	store.delete(name);
	return `✅ macro "${name}" deleted`;
}

/**
 * Run `macro show [prefix]`.
 *
 * @param {string} rest text after the subcommand.
 * @param {import('../macrostore.js').MacroStore} store macro store.
 * @returns {string} reply block with the fenced macro tree.
 */
function macroShow(rest, store)
{
	const prefix = normalizeName(rest);
	const entries = store.list().filter(([name]) => !prefix || name === prefix || name.startsWith(`${prefix} `));
	const lines = renderMacroTree(entries).split('\n');
	return lines[0] + '\n```\n' + lines.slice(1).join('\n') + '\n```';
}

/**
 * Run `macro me [character]`: list pins, or pin a character.
 *
 * @param {string} rest text after the subcommand.
 * @param {import('../macrostore.js').MacroStore} store macro store.
 * @param {string|null} userId author id, or null when unknown.
 * @returns {string} reply block or confirmation line.
 */
function macroMe(rest, store, userId)
{
	if (!rest)
	{
		const lines = ['# CHARACTERS'];
		const pins = store.pins(userId);
		if (pins.length === 0)
		{
			lines.push('    (none)');
		}
		for (const pin of pins)
		{
			lines.push(`- ${pin}`);
		}
		return lines.join('\n');
	}

	const name = normalizeName(rest);
	if (!name)
	{
		throw new DiceError('Usage: macro me [character]');
	}

	if (userId === null || userId === undefined)
	{
		throw new DiceError('Unknown user — pinning needs a message author');
	}

	store.pin(userId, name);
	return `✅ pinned "${name}"`;
}

/**
 * Run `macro not me <character>`.
 *
 * @param {string} rest text after the subcommand.
 * @param {import('../macrostore.js').MacroStore} store macro store.
 * @param {string|null} userId author id, or null when unknown.
 * @returns {string} confirmation line.
 */
function macroNotMe(rest, store, userId)
{
	const words = rest.split(/\s+/).filter(Boolean);
	if (words.length < 2 || words[0].toLowerCase() !== 'me')
	{
		throw new DiceError('Usage: macro not me <character>');
	}

	const name = normalizeName(words.slice(1).join(' '));
	if (userId === null || userId === undefined)
	{
		throw new DiceError('Unknown user — unpinning needs a message author');
	}

	if (!store.unpin(userId, name))
	{
		throw new DiceError(`"${name}" is not pinned`);
	}

	return `✅ unpinned "${name}"`;
}

/**
 * Run a macro subcommand.
 *
 * @param {string} argument everything after the trigger keyword, trimmed.
 * @param {object} [context] command context.
 * @param {string|null} [context.userId] author id for per-user pins.
 * @param {import('../macrostore.js').MacroStore} [context.macros] macro store.
 * @returns {Promise<string>} reply block.
 */
async function handleMacro(argument, context = {})
{
	const store = context.macros ?? macroStore;
	const userId = context.userId ?? null;
	const text = (argument ?? '').trim();
	if (!text)
	{
		return '❌ macro what? Try: macro set <name>: <formula>';
	}

	const space = text.search(/\s/);
	const sub = (space === -1 ? text : text.slice(0, space)).toLowerCase();
	const rest = space === -1 ? '' : text.slice(space).trim();
	if (sub === 'set')
	{
		return macroSet(rest, store, userId);
	}

	if (sub === 'delete')
	{
		return macroDelete(rest, store);
	}

	if (sub === 'show')
	{
		return macroShow(rest, store);
	}

	if (sub === 'me')
	{
		return macroMe(rest, store, userId);
	}

	if (sub === 'not')
	{
		return macroNotMe(rest, store, userId);
	}

	throw new DiceError(`Unknown macro command "${sub}" — try set, delete, show, me, or "not me"`);
}

/**
 * The `macro` command.
 *
 * @type {import('../commands.js').CommandDefinition}
 */
export const macroCommand =
{
	name: 'macro',
	aliases: ['macro'],
	args: '<set|delete|show|me|not me>',
	description: 'Stores dice formulas as reusable macros.',
	subcommands: MACRO_SUBCOMMANDS.map((item) =>
	{
		return {
			syntax: item.args ? `macro ${item.sub} ${item.args}` : `macro ${item.sub}`,
			description: item.description,
		};
	}),
	handle: handleMacro,
};
