/**
 * Randomness module: rolls dice in batches.
 *
 * The resolver collects every die in a formula first and hands the whole
 * list here in one call, instead of rolling on demand. One batched call per
 * formula keeps the door open for future providers (quota pooling, seeded
 * replays) without changing the resolver.
 *
 * Pure entropy from `node:crypto`: no `Math.random`, no network, no clock.
 */

import { randomInt } from 'node:crypto';

/**
 * @typedef {object} DiceSpec
 * @property {number} count how many dice to roll.
 * @property {number} [sides] faces per die (1 to `sides`); absent for FATE dice.
 * @property {boolean} [fate] true for FATE dice, which land on -1, 0, or 1.
 */

/**
 * Roll many dice at once.
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
