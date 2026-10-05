/**
 * Macro storage: named dice formulas plus per-user character pins.
 *
 * The store keeps everything in memory and writes `userdata.json`
 * after every mutation (add, update, delete, pin, unpin), so a restart
 * never loses data. Loading is lazy: the file is read on first use, and a
 * missing or corrupt file simply starts empty.
 *
 * Only this module touches the filesystem. Tests should construct their
 * own `MacroStore` on a temp file instead of using {@link macroStore}.
 */

import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';

/**
 * File-backed macro store.
 */
export class MacroStore
{
	/**
	 * @param {string} file path of the JSON file to sync with.
	 */
	constructor(file)
	{
		this.file = file;
		this.macros = new Map();
		this.users = new Map();
		this.ready = false;
	}

	/**
	 * Load the file once. Missing or corrupt files start empty.
	 */
	load()
	{
		if (this.ready)
		{
			return;
		}
		this.ready = true;

		let data;
		try
		{
			data = JSON.parse(readFileSync(this.file, 'utf8'));
		}
		catch
		{
			return;
		}

		if (!data || typeof data !== 'object')
		{
			return;
		}

		if (data.macros && typeof data.macros === 'object')
		{
			for (const [name, formula] of Object.entries(data.macros))
			{
				if (typeof formula === 'string')
				{
					this.macros.set(name, formula);
				}
			}
		}

		if (data.users && typeof data.users === 'object')
		{
			for (const [userId, pins] of Object.entries(data.users))
			{
				if (Array.isArray(pins))
				{
					this.users.set(userId, pins.filter((pin) => typeof pin === 'string'));
				}
			}
		}
	}

	/**
	 * Write the whole state to disk, creating directories as needed.
	 */
	save()
	{
		mkdirSync(dirname(this.file), { recursive: true });
		const users = {};
		for (const [userId, pins] of this.users)
		{
			users[userId] = [...pins];
		}
		writeFileSync(this.file, `${JSON.stringify({ macros: Object.fromEntries(this.macros), users }, null, 2)}\n`);
	}

	/**
	 * Check whether a macro exists.
	 *
	 * @param {string} name normalised macro name.
	 * @returns {boolean} true when present.
	 */
	has(name)
	{
		this.load();
		return this.macros.has(name);
	}

	/**
	 * Read a macro formula.
	 *
	 * @param {string} name normalised macro name.
	 * @returns {string|undefined} stored formula, if any.
	 */
	get(name)
	{
		this.load();
		return this.macros.get(name);
	}

	/**
	 * Add or overwrite a macro, syncing to disk.
	 *
	 * @param {string} name normalised macro name.
	 * @param {string} formula raw formula text.
	 */
	set(name, formula)
	{
		this.load();
		this.macros.set(name, formula);
		this.save();
	}

	/**
	 * Delete a macro, syncing to disk.
	 *
	 * @param {string} name normalised macro name.
	 * @returns {boolean} true when something was deleted.
	 */
	delete(name)
	{
		this.load();
		const removed = this.macros.delete(name);
		if (removed)
		{
			this.save();
		}
		return removed;
	}

	/**
	 * List all macros in insertion order.
	 *
	 * @returns {Array<[string, string]>} `[name, formula]` pairs.
	 */
	list()
	{
		this.load();
		return [...this.macros.entries()];
	}

	/**
	 * List a user's pinned characters.
	 *
	 * @param {string|null} userId author id, or null when unknown.
	 * @returns {string[]} pinned names, oldest first.
	 */
	pins(userId)
	{
		this.load();
		if (userId === null || userId === undefined)
		{
			return [];
		}
		return [...(this.users.get(String(userId)) ?? [])];
	}

	/**
	 * Pin a character to a user, syncing to disk.
	 *
	 * @param {string|null} userId author id, or null when unknown.
	 * @param {string} name normalised character name.
	 */
	pin(userId, name)
	{
		this.load();
		const key = String(userId);
		const pins = this.users.get(key) ?? [];
		if (!pins.includes(name))
		{
			pins.push(name);
			this.users.set(key, pins);
			this.save();
		}
	}

	/**
	 * Unpin a character, syncing to disk.
	 *
	 * @param {string|null} userId author id, or null when unknown.
	 * @param {string} name normalised character name.
	 * @returns {boolean} true when something was unpinned.
	 */
	unpin(userId, name)
	{
		this.load();
		const key = String(userId);
		const pins = this.users.get(key) ?? [];
		const next = pins.filter((pin) => pin !== name);
		if (next.length === pins.length)
		{
			return false;
		}
		this.users.set(key, next);
		this.save();
		return true;
	}
}

/**
 * Production store, synced with `userdata.json` under the working
 * directory. The bot passes it through the command context; commands fall
 * back to it when no store is supplied.
 */
export const macroStore = new MacroStore(join(process.cwd(), 'userdata.json'));
