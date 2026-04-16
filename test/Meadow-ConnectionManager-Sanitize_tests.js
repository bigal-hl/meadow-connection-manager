/**
 * Tests for the MCM connection-name sanitizer and the hash integration
 * in the MeadowConnectionManager connect/disconnect lifecycle.
 *
 * @license MIT
 * @author <steven@velozo.com>
 */
const Chai = require('chai');
const Expect = Chai.expect;

const libSanitize = require('../source/Meadow-ConnectionManager-Sanitize.js');
const libMCM = require('../source/Meadow-ConnectionManager.js');

// ------------------------------------------------------------------
// Helpers — minimal fable shim for MCM construction
// ------------------------------------------------------------------

const makeFable = function ()
{
	return {
		isFable: true,
		settings: {},
		services: {},
		servicesMap: {},
		serviceClasses: {},
		Logging: { info: () => {}, warn: () => {}, error: () => {}, debug: () => {}, trace: () => {} },
		log: { info: () => {}, warn: () => {}, error: () => {}, debug: () => {}, trace: () => {} },
		getUUID: () => 'uuid-' + Math.random().toString(36).substring(2),
		serviceManager:
		{
			addServiceType: () => {},
			instantiateServiceProviderWithoutRegistration: () => ({ connectAsync: (cb) => cb(null) })
		},
		addServiceType: () => {}
	};
};

// ------------------------------------------------------------------
// Tests
// ------------------------------------------------------------------

suite('Meadow-ConnectionManager-Sanitize', () =>
{
	// ─────── Sanitizer function ───────

	suite('sanitizeConnectionName()', () =>
	{
		test('lowercases and hyphenates spaces', () =>
		{
			Expect(libSanitize('Bookstore MSSQL')).to.equal('bookstore-mssql');
		});

		test('strips punctuation and special characters', () =>
		{
			Expect(libSanitize('Acme, Inc. / Prod')).to.equal('acme-inc-prod');
		});

		test('collapses multiple spaces into one hyphen', () =>
		{
			Expect(libSanitize('   lots   of   spaces   ')).to.equal('lots-of-spaces');
		});

		test('normalizes Unicode diacritics', () =>
		{
			Expect(libSanitize('Über-Café')).to.equal('uber-cafe');
		});

		test('already-sanitized input is idempotent', () =>
		{
			let tmpFirst = libSanitize('My Connection 42');
			Expect(libSanitize(tmpFirst)).to.equal(tmpFirst);
		});

		test('caps at 64 characters', () =>
		{
			let tmpLong = 'a'.repeat(200);
			Expect(libSanitize(tmpLong).length).to.equal(64);
		});

		test('throws on empty string', () =>
		{
			Expect(() => libSanitize('')).to.throw('non-empty string');
		});

		test('throws on all-special-character input', () =>
		{
			Expect(() => libSanitize('!!!')).to.throw('sanitizes to an empty string');
		});

		test('throws on non-string input', () =>
		{
			Expect(() => libSanitize(null)).to.throw('non-empty string');
			Expect(() => libSanitize(undefined)).to.throw('non-empty string');
			Expect(() => libSanitize(42)).to.throw('non-empty string');
		});

		test('preserves numbers', () =>
		{
			Expect(libSanitize('db-2024-prod')).to.equal('db-2024-prod');
		});

		test('trims leading and trailing hyphens after sanitization', () =>
		{
			Expect(libSanitize('---hello---')).to.equal('hello');
		});
	});

	// ─────── Static export from MCM ───────

	suite('MCM.sanitizeConnectionName (static export)', () =>
	{
		test('the sanitizer is accessible from the MCM module', () =>
		{
			Expect(libMCM.sanitizeConnectionName).to.be.a('function');
			Expect(libMCM.sanitizeConnectionName('Hello World')).to.equal('hello-world');
		});
	});

	// ─────── Connection record .hash field ───────

	suite('MCM connect() hash integration', () =>
	{
		test('connection record includes .hash derived from name', (fDone) =>
		{
			let tmpFable = makeFable();
			let tmpMCM = new libMCM(tmpFable);

			tmpMCM.connect('Bookstore MSSQL', { Type: 'SQLite' }, (pError, pConn) =>
			{
				Expect(pError).to.equal(null);
				Expect(pConn).to.be.an('object');
				Expect(pConn.hash).to.equal('bookstore-mssql');
				Expect(pConn.name).to.equal('Bookstore MSSQL');
				fDone();
			});
		});

		test('getConnectionByHash returns the same record as getConnection', (fDone) =>
		{
			let tmpFable = makeFable();
			let tmpMCM = new libMCM(tmpFable);

			tmpMCM.connect('analytics-prod', { Type: 'SQLite' }, (pError) =>
			{
				Expect(pError).to.equal(null);
				let tmpByName = tmpMCM.getConnection('analytics-prod');
				let tmpByHash = tmpMCM.getConnectionByHash('analytics-prod');
				Expect(tmpByName).to.equal(tmpByHash);
				fDone();
			});
		});

		test('rejects a connection whose hash collides with a different name', (fDone) =>
		{
			let tmpFable = makeFable();
			let tmpMCM = new libMCM(tmpFable);

			tmpMCM.connect('book store', { Type: 'SQLite' }, (pError1) =>
			{
				Expect(pError1).to.equal(null);
				// "book-store" sanitizes to the same hash as "book store"
				tmpMCM.connect('book-store', { Type: 'SQLite' }, (pError2) =>
				{
					Expect(pError2).to.be.an('error');
					Expect(pError2.message).to.contain('already in use');
					fDone();
				});
			});
		});

		test('allows reconnect with the same name (hash matches same name)', (fDone) =>
		{
			let tmpFable = makeFable();
			let tmpMCM = new libMCM(tmpFable);

			tmpMCM.connect('my-db', { Type: 'SQLite' }, (pError1) =>
			{
				Expect(pError1).to.equal(null);
				tmpMCM.connect('my-db', { Type: 'SQLite' }, (pError2) =>
				{
					Expect(pError2).to.equal(null);
					fDone();
				});
			});
		});

		test('disconnect removes entry from _ConnectionsByHash', (fDone) =>
		{
			let tmpFable = makeFable();
			let tmpMCM = new libMCM(tmpFable);

			tmpMCM.connect('temp-conn', { Type: 'SQLite' }, (pError) =>
			{
				Expect(pError).to.equal(null);
				Expect(tmpMCM.getConnectionByHash('temp-conn')).to.not.equal(null);

				tmpMCM.disconnect('temp-conn', () =>
				{
					Expect(tmpMCM.getConnectionByHash('temp-conn')).to.equal(null);
					Expect(tmpMCM.getConnection('temp-conn')).to.equal(null);
					fDone();
				});
			});
		});
	});
});
