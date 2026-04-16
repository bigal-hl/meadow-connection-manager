/**
 * Meadow Connection Manager — Connection Name Sanitizer
 *
 * Converts a human-readable connection name into a URL-safe slug suitable
 * for use as a route namespace (e.g. `/1.0/{hash}/Book`).
 *
 * Behavior:
 *   - NFKD-normalize and strip combining diacritical marks ("Über" → "uber")
 *   - Lowercase
 *   - Replace runs of non-[a-z0-9] with a single hyphen
 *   - Trim leading/trailing hyphens
 *   - Cap at 64 characters
 *   - Throw on empty input or input that sanitizes to the empty string
 *   - Idempotent: sanitize(sanitize(x)) === sanitize(x)
 *
 * @license MIT
 * @author <steven@velozo.com>
 */

const MAX_HASH_LENGTH = 64;

/**
 * Sanitize a connection name into a URL-safe route hash.
 *
 * @param {string} pName - The human-readable connection name
 * @returns {string} The sanitized hash
 * @throws {Error} If pName is empty or sanitizes to nothing
 */
function sanitizeConnectionName(pName)
{
	if (typeof (pName) !== 'string' || pName.length === 0)
	{
		throw new Error('MeadowConnectionManager: connection name must be a non-empty string.');
	}

	let tmpResult = pName
		// NFKD normalization decomposes characters like "ü" into "u" + combining diaeresis
		.normalize('NFKD')
		// Strip combining diacritical marks (Unicode category Mn)
		.replace(/[\u0300-\u036f]/g, '')
		// Lowercase
		.toLowerCase()
		// Replace any run of non-alphanumeric characters with a single hyphen
		.replace(/[^a-z0-9]+/g, '-')
		// Trim leading/trailing hyphens
		.replace(/^-+|-+$/g, '')
		// Cap length
		.substring(0, MAX_HASH_LENGTH);

	if (tmpResult.length === 0)
	{
		throw new Error(`MeadowConnectionManager: connection name "${pName}" sanitizes to an empty string.`);
	}

	return tmpResult;
}

module.exports = sanitizeConnectionName;
module.exports.MAX_HASH_LENGTH = MAX_HASH_LENGTH;
