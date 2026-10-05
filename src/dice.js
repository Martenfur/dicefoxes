/**
 * Dice formula resolver.
 *
 * Pure text in, result out: parses `NdM` formulas with arithmetic, an
 * optional trailing `DC`, then collects every die up front and rolls them
 * with one batched call into the randomness module. Never touches Discord,
 * `process.env`, or time.
 *
 * Dice letters are `d`, `д`, `к`, `в`, and `l` (any case); `f`/`ф`
 * after the letter marks FATE dice (`1df`, `1дф`). A trailing difficulty
 * (`DC<n>`, `ДС<n>`, `AC<n>`, `АС<n>` — any case, optional space) grades
 * the total.
 */

import { rollBatch } from './random.js';

/** Largest number of sides a single die may have. */
export const MAX_SIDES = 1000000;
/** Largest dice count in one `NdM` term. */
export const MAX_DICE_PER_TERM = 10000;
/** Largest total dice in one formula. */
export const MAX_DICE_PER_FORMULA = 1024;
/** Deepest allowed parenthesis nesting. */
export const MAX_DEPTH = 64;

/**
 * A formula the resolver refuses to roll (bad syntax, busted limits).
 */
export class DiceError extends Error
{
	/**
	 * @param {string} message human-readable reason.
	 */
	constructor(message)
	{
		super(message);
		this.name = 'DiceError';
	}
}

/**
 * @typedef {object} Degree
 * @property {string} key one of `crit`, `success`, `fail`, `critfail`.
 * @property {string} emoji badge for the key.
 */

/**
 * @typedef {object} RollResult
 * @property {string} total formatted total, e.g. `25`.
 * @property {string} annotated formula with rolled faces, e.g. `([15]1d20 + 12) * 2 - [1,4]2d4`.
 * @property {number|null} dc difficulty class, or null when unset.
 * @property {Degree|null} degree graded result, or null when no DC was set.
 */

/** Dice letters: latin `d`/`l`, cyrillic `д` (de), `к` (ka, short for куб), and `в`. */
const DICE_LETTERS = new Set(['d', 'д', 'к', 'в', 'l']);
/** FATE markers: latin `f`, cyrillic `ф`. */
const FATE_LETTERS = new Set(['f', 'ф']);
/** DC keywords: latin `dc`/`ac`, cyrillic `дс`/`ас`. */
const DC_WORDS = new Set(['dc', 'дс', 'ac', 'ас']);
/** Degree badges, best first. */
const DEGREES =
{
	crit: { key: 'crit', emoji: '💥' },
	success: { key: 'success', emoji: '✅' },
	fail: { key: 'fail', emoji: '❌' },
	critfail: { key: 'critfail', emoji: '💀' },
};

function isDigit(ch)
{
	return ch >= '0' && ch <= '9';
}

function isLetter(ch)
{
	return /^\p{L}$/u.test(ch);
}

function isSpace(ch)
{
	return ch === ' ' || ch === '\t' || ch === '\n' || ch === '\r' || ch === '\f' || ch === '\v';
}

/**
 * Split a formula into tokens. Dice letters, FATE markers, and DC keywords
 * stay case-insensitive; letter runs become `word` tokens for the parser.
 *
 * @param {string} source formula text.
 * @returns {Array<{type: string, value: string}>} token stream.
 */
function lex(source)
{
	const tokens = [];
	let i = 0;
	while (i < source.length)
	{
		const ch = source[i];
		if (isSpace(ch))
		{
			i += 1;
			continue;
		}

		if (isDigit(ch))
		{
			const start = i;
			while (i < source.length && isDigit(source[i]))
			{
				i += 1;
			}
			tokens.push({ type: 'number', value: source.slice(start, i) });
			continue;
		}

		if (isLetter(ch))
		{
			const start = i;
			while (i < source.length && isLetter(source[i]))
			{
				i += 1;
			}
			const run = source.slice(start, i).toLowerCase();
			if (run.length >= 2 && DICE_LETTERS.has(run[0]) && FATE_LETTERS.has(run[1]))
			{
				// `2df`: a dice letter glued to a FATE marker. Split the run
				// so the parser sees two words; anything else stays whole
				// (`dc` must survive for the DC check below).
				tokens.push({ type: 'word', value: run[0] });
				tokens.push({ type: 'word', value: run.slice(1) });
				continue;
			}
			tokens.push({ type: 'word', value: run });
			continue;
		}

		if (ch === '+' || ch === '-' || ch === '*' || ch === '/' || ch === '(' || ch === ')')
		{
			tokens.push({ type: ch, value: ch });
			i += 1;
			continue;
		}

		throw new DiceError(`Unexpected character "${ch}"`);
	}

	return tokens;
}

/**
 * Render one token for error messages.
 *
 * @param {{type: string, value: string}|null} token token or end of input.
 * @returns {string} human-readable token.
 */
function describeToken(token)
{
	if (!token)
	{
		return 'end of formula';
	}

	return `"${token.value}"`;
}

/**
 * Peek at the current token without consuming it.
 *
 * @param {Array<{type: string, value: string}>} tokens token stream.
 * @param {{pos: number}} cursor shared cursor.
 * @returns {{type: string, value: string}|null} current token or null.
 */
function peek(tokens, cursor)
{
	return cursor.pos < tokens.length ? tokens[cursor.pos] : null;
}

/**
 * Parse a full formula: expression plus an optional trailing DC.
 *
 * @param {Array<{type: string, value: string}>} tokens token stream.
 * @returns {{root: object, dc: number|null}} syntax tree plus DC.
 */
function parseFormula(tokens)
{
	if (tokens.length === 0)
	{
		throw new DiceError('Empty formula');
	}

	const cursor = { pos: 0 };
	const root = parseSum(tokens, cursor, 0);
	let dc = null;
	const tail = peek(tokens, cursor);
	if (tail && tail.type === 'word' && DC_WORDS.has(tail.value))
	{
		cursor.pos += 1;
		const amount = peek(tokens, cursor);
		if (!amount || amount.type !== 'number')
		{
			throw new DiceError(`"${tail.value}" needs a number, e.g. "DC15"`);
		}
		cursor.pos += 1;
		dc = parseCount(amount.value);
	}

	const rest = peek(tokens, cursor);
	if (rest)
	{
		throw new DiceError(`Unexpected ${describeToken(rest)} — the DC, if any, goes last`);
	}

	return { root, dc };
}

/**
 * Parse addition and subtraction.
 *
 * @param {Array<{type: string, value: string}>} tokens token stream.
 * @param {{pos: number}} cursor shared cursor.
 * @param {number} depth current parenthesis depth.
 * @returns {object} syntax node.
 */
function parseSum(tokens, cursor, depth)
{
	let node = parseProduct(tokens, cursor, depth);
	for (;;)
	{
		const token = peek(tokens, cursor);
		if (!token || (token.type !== '+' && token.type !== '-'))
		{
			return node;
		}

		cursor.pos += 1;
		node =
		{
			type: 'binary',
			op: token.value,
			left: node,
			right: parseProduct(tokens, cursor, depth),
		};
	}
}

/**
 * Parse multiplication and division.
 *
 * @param {Array<{type: string, value: string}>} tokens token stream.
 * @param {{pos: number}} cursor shared cursor.
 * @param {number} depth current parenthesis depth.
 * @returns {object} syntax node.
 */
function parseProduct(tokens, cursor, depth)
{
	let node = parseUnary(tokens, cursor, depth);
	for (;;)
	{
		const token = peek(tokens, cursor);
		if (!token || (token.type !== '*' && token.type !== '/'))
		{
			return node;
		}

		cursor.pos += 1;
		node =
		{
			type: 'binary',
			op: token.value,
			left: node,
			right: parseUnary(tokens, cursor, depth),
		};
	}
}

/**
 * Parse a leading `+`/`-` sign.
 *
 * @param {Array<{type: string, value: string}>} tokens token stream.
 * @param {{pos: number}} cursor shared cursor.
 * @param {number} depth current parenthesis depth.
 * @returns {object} syntax node.
 */
function parseUnary(tokens, cursor, depth)
{
	const token = peek(tokens, cursor);
	if (token && (token.type === '+' || token.type === '-'))
	{
		cursor.pos += 1;
		return {
			type: 'unary',
			op: token.value,
			expr: parseUnary(tokens, cursor, depth),
		};
	}

	return parsePrimary(tokens, cursor, depth);
}

/**
 * Parse one number, dice term, or parenthesised group.
 *
 * @param {Array<{type: string, value: string}>} tokens token stream.
 * @param {{pos: number}} cursor shared cursor.
 * @param {number} depth current parenthesis depth.
 * @returns {object} syntax node.
 */
function parsePrimary(tokens, cursor, depth)
{
	if (depth > MAX_DEPTH)
	{
		throw new DiceError('Formula is nested too deep');
	}

	const token = peek(tokens, cursor);
	if (!token)
	{
		throw new DiceError('Unexpected end of formula');
	}

	if (token.type === '(')
	{
		cursor.pos += 1;
		const expr = parseSum(tokens, cursor, depth + 1);
		const closing = peek(tokens, cursor);
		if (!closing || closing.type !== ')')
		{
			throw new DiceError('Missing closing ")"');
		}
		cursor.pos += 1;
		return { type: 'paren', expr };
	}

	if (token.type === 'number')
	{
		cursor.pos += 1;
		const value = parseCount(token.value);
		const next = peek(tokens, cursor);
		if (next && next.type === 'word' && DICE_LETTERS.has(next.value))
		{
			cursor.pos += 1;
			return makeDice(value, next.value, tokens, cursor);
		}

		return { type: 'number', value };
	}

	if (token.type === 'word')
	{
		if (DICE_LETTERS.has(token.value))
		{
			cursor.pos += 1;
			return makeDice(1, token.value, tokens, cursor);
		}

		throw new DiceError(`Unknown "${token.value}"`);
	}

	throw new DiceError(`Unexpected ${describeToken(token)}`);
}

/**
 * Parse a non-negative integer literal.
 *
 * @param {string} text literal text.
 * @returns {number} parsed value.
 */
function parseCount(text)
{
	const value = Number(text);
	if (!Number.isSafeInteger(value))
	{
		throw new DiceError(`Number "${text}" is too large`);
	}

	return value;
}

/**
 * Build a dice node from a dice letter word.
 *
 * What follows the letter decides the kind: a FATE marker (`f`/`ф`) makes
 * FATE dice, a number makes regular dice with that many sides.
 *
 * @param {number} count how many dice.
 * @param {string} word lower-cased dice letter.
 * @param {Array<{type: string, value: string}>} tokens token stream.
 * @param {{pos: number}} cursor shared cursor.
 * @returns {object} dice syntax node.
 */
function makeDice(count, word, tokens, cursor)
{
	if (count < 1)
	{
		throw new DiceError('Roll at least one die, e.g. "d20"');
	}

	if (count > MAX_DICE_PER_TERM)
	{
		throw new DiceError(`At most ${MAX_DICE_PER_TERM} dice per term`);
	}

	const next = peek(tokens, cursor);
	if (next && next.type === 'word' && FATE_LETTERS.has(next.value))
	{
		cursor.pos += 1;
		return { type: 'dice', count, fate: true };
	}

	if (!next || next.type !== 'number')
	{
		throw new DiceError(`"${word}" needs a number of sides, e.g. "d20"`);
	}
	cursor.pos += 1;
	const sides = parseCount(next.value);
	if (sides < 1)
	{
		throw new DiceError('A die needs at least one side');
	}

	if (sides > MAX_SIDES)
	{
		throw new DiceError(`At most ${MAX_SIDES} sides per die`);
	}

	return { type: 'dice', count, sides };
}

/**
 * Collect every die in a tree, left to right.
 *
 * @param {object} node syntax node.
 * @param {Array<{count: number, sides?: number, fate?: boolean}>} specs output list.
 */
function collectDice(node, specs)
{
	if (node.type === 'dice')
	{
		if (node.fate)
		{
			specs.push({ count: node.count, fate: true });
		}
		else
		{
			specs.push({ count: node.count, sides: node.sides });
		}
		return;
	}

	if (node.type === 'binary')
	{
		collectDice(node.left, specs);
		collectDice(node.right, specs);
		return;
	}

	if (node.type === 'unary' || node.type === 'paren')
	{
		collectDice(node.expr, specs);
	}
}

/**
 * Evaluate a tree against rolled faces, rebuilding the annotated formula.
 *
 * @param {object} node syntax node.
 * @param {number[]} faces all rolled faces, left to right.
 * @param {{pos: number}} cursor shared face cursor.
 * @param {number[]} d20faces output: every individual d20 face, for nat 20/1 nudges.
 * @returns {{value: number, annotated: string}} numeric value plus receipt.
 */
function evaluate(node, faces, cursor, d20faces)
{
	if (node.type === 'number')
	{
		return { value: node.value, annotated: String(node.value) };
	}

	if (node.type === 'dice')
	{
		const values = [];
		for (let i = 0; i < node.count; i += 1)
		{
			if (cursor.pos >= faces.length)
			{
				throw new DiceError('Randomness provider returned too few values');
			}
			values.push(faces[cursor.pos]);
			cursor.pos += 1;
		}

		if (!node.fate && node.sides === 20)
		{
			d20faces.push(...values);
		}

		const value = values.reduce((sum, face) => sum + face, 0);
		const label = node.fate ? `${node.count}df` : `${node.count}d${node.sides}`;
		return { value, annotated: `[${values.join(',')}]${label}` };
	}

	if (node.type === 'unary')
	{
		const inner = evaluate(node.expr, faces, cursor, d20faces);
		return {
			value: node.op === '-' ? -inner.value : inner.value,
			annotated: `${node.op}${inner.annotated}`,
		};
	}

	if (node.type === 'paren')
	{
		const inner = evaluate(node.expr, faces, cursor, d20faces);
		return { value: inner.value, annotated: `(${inner.annotated})` };
	}

	const left = evaluate(node.left, faces, cursor, d20faces);
	const right = evaluate(node.right, faces, cursor, d20faces);
	let value;
	if (node.op === '+')
	{
		value = left.value + right.value;
	}
	else if (node.op === '-')
	{
		value = left.value - right.value;
	}
	else if (node.op === '*')
	{
		value = left.value * right.value;
	}
	else
	{
		if (right.value === 0)
		{
			throw new DiceError('Division by zero');
		}
		value = left.value / right.value;
	}

	return { value, annotated: `${left.annotated} ${node.op} ${right.annotated}` };
}

/**
 * Format a numeric total for chat.
 *
 * @param {number} value raw total.
 * @returns {string} integer as-is, fractions trimmed to two decimals.
 */
function formatTotal(value)
{
	if (!Number.isFinite(value))
	{
		throw new DiceError('Result is not a finite number');
	}

	if (Number.isInteger(value))
	{
		return String(value);
	}

	return String(parseFloat(value.toFixed(2)));
}

/**
 * Grade a total against a DC (Pathfinder-style bands plus nat 20/1 nudges).
 *
 * A natural 20 promotes one degree and a natural 1 demotes one, clamped at
 * the ends — but only when the formula rolled exactly one d20 face.
 *
 * @param {number} total rolled total.
 * @param {number} dc difficulty class.
 * @param {number[]} d20faces every individual d20 face in the formula.
 * @returns {Degree} graded degree.
 */
function gradeDegree(total, dc, d20faces)
{
	const diff = total - dc;
	let key = 'fail';
	if (diff >= 10)
	{
		key = 'crit';
	}
	else if (diff >= 0)
	{
		key = 'success';
	}
	else if (diff <= -10)
	{
		key = 'critfail';
	}

	if (d20faces.length === 1)
	{
		if (d20faces[0] === 20 && (key === 'fail' || key === 'success'))
		{
			key = key === 'fail' ? 'success' : 'crit';
		}
		else if (d20faces[0] === 1 && (key === 'success' || key === 'fail'))
		{
			key = key === 'success' ? 'fail' : 'critfail';
		}
	}

	return DEGREES[key];
}

/**
 * Roll a dice formula.
 *
 * Parses the formula, hands every die to the randomness module in one
 * batched call, then evaluates. The roller is injectable for tests and for
 * future providers: it receives the dice specs left to right and must
 * return one face array per spec.
 *
 * @param {string} source formula text, e.g. `(1д20 + 12) * 2 - 2д4`.
 * @param {(specs: Array<{count: number, sides?: number, fate?: boolean}>) => number[][]} [roller] randomness source, defaults to {@link rollBatch}.
 * @returns {RollResult} formatted total, annotated formula, DC, and degree.
 */
export function rollFormula(source, roller = rollBatch)
{
	if (typeof source !== 'string' || source.trim().length === 0)
	{
		throw new DiceError('Empty formula');
	}

	const { root, dc } = parseFormula(lex(source));
	const specs = [];
	collectDice(root, specs);
	const diceCount = specs.reduce((sum, spec) => sum + spec.count, 0);
	if (diceCount > MAX_DICE_PER_FORMULA)
	{
		throw new DiceError(`At most ${MAX_DICE_PER_FORMULA} dice per formula`);
	}

	const faces = [];
	for (const batch of roller(specs))
	{
		for (const face of batch)
		{
			faces.push(face);
		}
	}

	const d20faces = [];
	const result = evaluate(root, faces, { pos: 0 }, d20faces);
	return {
		total: formatTotal(result.value),
		annotated: result.annotated,
		dc,
		degree: dc === null ? null : gradeDegree(result.value, dc, d20faces),
	};
}
