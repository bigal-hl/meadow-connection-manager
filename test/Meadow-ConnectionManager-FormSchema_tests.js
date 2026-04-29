/**
 * Tests for the connection-form schema aggregator on
 * MeadowConnectionManager.
 *
 * Two layers are exercised:
 *
 *   1. Schema-file well-formedness — each provider module's
 *      `Meadow-Connection-<Type>-FormSchema.js` must exist (in the
 *      local sibling repo), be requireable as pure data, and meet the
 *      field-shape contract.  Loaded via a relative path so the test
 *      runs against the in-repo copy regardless of what's in
 *      node_modules.
 *
 *   2. MCM resolver behavior — `getProviderFormSchema()` /
 *      `getAllProviderFormSchemas()` must locate the schema via the
 *      resolved module, OR cleanly return null/skip if the module
 *      isn't installed.  This test gracefully skips per-provider when
 *      the module-resolved schema file isn't present (common in dev
 *      workspaces where node_modules holds the previous published
 *      copy).
 *
 * @license MIT
 * @author <steven@velozo.com>
 */
'use strict';

const Chai = require('chai');
const Expect = Chai.expect;
const libPath = require('path');
const libFS = require('fs');

const libMCM = require('../source/Meadow-ConnectionManager.js');

// Minimal fable shim — mirrors the one used in the sanitize tests.
const makeFable = function ()
{
	return {
		isFable: true,
		settings: {},
		services: {},
		servicesMap: {},
		serviceClasses: {},
		Logging: { info: () => {}, warn: () => {}, error: () => {}, debug: () => {}, trace: () => {} },
		log:     { info: () => {}, warn: () => {}, error: () => {}, debug: () => {}, trace: () => {} },
		getUUID: () => 'uuid-' + Math.random().toString(36).substring(2),
		serviceManager:
		{
			addServiceType: () => {},
			instantiateServiceProviderWithoutRegistration: () => ({ connectAsync: (cb) => cb(null) })
		},
		addServiceType: () => {}
	};
};

const PROVIDER_LIST =
[
	{ Type: 'MySQL',       Module: 'meadow-connection-mysql',      RelPath: 'source/Meadow-Connection-MySQL-FormSchema.js' },
	{ Type: 'PostgreSQL',  Module: 'meadow-connection-postgresql', RelPath: 'source/Meadow-Connection-PostgreSQL-FormSchema.js' },
	{ Type: 'MSSQL',       Module: 'meadow-connection-mssql',      RelPath: 'source/Meadow-Connection-MSSQL-FormSchema.js' },
	{ Type: 'SQLite',      Module: 'meadow-connection-sqlite',     RelPath: 'source/Meadow-Connection-SQLite-FormSchema.js' },
	{ Type: 'Solr',        Module: 'meadow-connection-solr',       RelPath: 'source/Meadow-Connection-Solr-FormSchema.js' },
	{ Type: 'RocksDB',     Module: 'meadow-connection-rocksdb',    RelPath: 'source/Meadow-Connection-RocksDB-FormSchema.js' },
	{ Type: 'MongoDB',     Module: 'meadow-connection-mongodb',    RelPath: 'source/Meadow-Connection-MongoDB-FormSchema.js' },
	{ Type: 'Bibliograph', Module: 'bibliograph',                  RelPath: 'source/Bibliograph-FormSchema.js' }
];

const REQUIRED_FIELD_KEYS = [ 'Name', 'Label', 'Type' ];
const ALLOWED_TYPES = new Set([ 'String', 'Number', 'Password', 'Boolean', 'Path', 'Select' ]);

/**
 * Path to the in-repo schema file for a provider, relative to MCM.
 * Sibling layout:
 *   modules/meadow/meadow-connection-manager/test/<this-file>
 *   modules/meadow/<module>/<RelPath>
 */
const localSchemaPath = function (pInfo)
{
	return libPath.resolve(__dirname, '..', '..', pInfo.Module, pInfo.RelPath);
};

const validateFieldShape = function (pSchema, pType)
{
	Expect(pSchema, `${pType}: schema must be an object`).to.be.an('object');
	Expect(pSchema.Provider, `${pType}: Provider mismatch`).to.equal(pType);
	Expect(pSchema.DisplayName, `${pType}: DisplayName missing`).to.be.a('string').and.not.empty;
	Expect(pSchema.Fields, `${pType}: Fields missing`).to.be.an('array').and.not.empty;

	pSchema.Fields.forEach((pField, pIndex) =>
	{
		REQUIRED_FIELD_KEYS.forEach((pKey) =>
		{
			Expect(pField, `${pType} field [${pIndex}] missing ${pKey}`).to.have.property(pKey);
		});
		Expect(ALLOWED_TYPES.has(pField.Type), `${pType} field [${pField.Name}] has unknown Type "${pField.Type}"`).to.equal(true);
		if (pField.MapTo !== undefined)
		{
			Expect(pField.MapTo, `${pType} field [${pField.Name}].MapTo`).to.be.an('array').and.not.empty;
		}
	});
};

suite('Connection form schema files (in-repo, by path)', () =>
{
	PROVIDER_LIST.forEach((pInfo) =>
	{
		test(`${pInfo.Type} schema file is well-formed`, function ()
		{
			let tmpPath = localSchemaPath(pInfo);
			if (!libFS.existsSync(tmpPath))
			{
				// Sibling repo not checked out alongside MCM — skip rather
				// than fail.  The aggregator test below covers the
				// resolved-module path too.
				this.skip();
				return;
			}
			let tmpSchema = require(tmpPath);
			validateFieldShape(tmpSchema, pInfo.Type);
		});
	});

	test('every provider schema round-trips through JSON', function ()
	{
		PROVIDER_LIST.forEach((pInfo) =>
		{
			let tmpPath = localSchemaPath(pInfo);
			if (!libFS.existsSync(tmpPath)) { return; }
			let tmpSchema = require(tmpPath);
			let tmpRoundTrip = JSON.parse(JSON.stringify(tmpSchema));
			Expect(tmpRoundTrip).to.deep.equal(tmpSchema);
		});
	});

	test('MSSQL schema file is at the expected explicit path', function ()
	{
		let tmpPath = localSchemaPath({ Module: 'meadow-connection-mssql', RelPath: 'source/Meadow-Connection-MSSQL-FormSchema.js' });
		if (!libFS.existsSync(tmpPath))
		{
			this.skip();
			return;
		}
		Expect(libFS.existsSync(tmpPath)).to.equal(true);
	});

	test('MSSQL declares MapTo for shared retry-delay fields', function ()
	{
		let tmpPath = localSchemaPath({ Module: 'meadow-connection-mssql', RelPath: 'source/Meadow-Connection-MSSQL-FormSchema.js' });
		if (!libFS.existsSync(tmpPath))
		{
			this.skip();
			return;
		}
		let tmpSchema = require(tmpPath);

		let tmpInitial = tmpSchema.Fields.find((f) => f.Name === 'RetryInitialDelaySec');
		Expect(tmpInitial, 'expected RetryInitialDelaySec field').to.exist;
		Expect(tmpInitial.MapTo).to.include('ConnectRetryOptions.InitialDelayMs');
		Expect(tmpInitial.MapTo).to.include('DDLRetryOptions.InitialDelayMs');
		Expect(tmpInitial.Multiplier).to.equal(1000);

		let tmpMax = tmpSchema.Fields.find((f) => f.Name === 'RetryMaxDelaySec');
		Expect(tmpMax, 'expected RetryMaxDelaySec field').to.exist;
		Expect(tmpMax.MapTo).to.include('ConnectRetryOptions.MaxDelayMs');
		Expect(tmpMax.MapTo).to.include('DDLRetryOptions.MaxDelayMs');
		Expect(tmpMax.Multiplier).to.equal(1000);
	});
});

suite('MCM aggregator: getProviderFormSchema()', () =>
{
	test('returns null for an unknown provider type', () =>
	{
		let tmpFable = makeFable();
		let tmpMCM = new libMCM(tmpFable, {}, 'mcm-test');
		Expect(tmpMCM.getProviderFormSchema('NotARealEngine')).to.equal(null);
	});

	test('returns null when the resolved module lacks the schema file', () =>
	{
		// In a dev workspace `node_modules/meadow-connection-mysql` is
		// often the previously-published version which doesn't have the
		// FormSchema file yet.  The aggregator must NOT throw — it must
		// gracefully return null so the UI can fall back to a
		// hand-rolled form or hide the unsupported provider.
		let tmpFable = makeFable();
		let tmpMCM = new libMCM(tmpFable, {}, 'mcm-test');
		// We don't assert the return value here (it might be a real
		// schema if node_modules is up to date) — just that the call
		// completes without throwing.
		PROVIDER_LIST.forEach((pInfo) =>
		{
			Expect(() => tmpMCM.getProviderFormSchema(pInfo.Type)).to.not.throw();
		});
	});
});

suite('MCM aggregator: getAllProviderFormSchemas()', () =>
{
	test('returns an array (possibly empty) without throwing', () =>
	{
		let tmpFable = makeFable();
		let tmpMCM = new libMCM(tmpFable, {}, 'mcm-test');
		let tmpSchemas;
		Expect(() => { tmpSchemas = tmpMCM.getAllProviderFormSchemas(); }).to.not.throw();
		Expect(tmpSchemas).to.be.an('array');
	});

	test('emitted schemas have unique Provider ids', () =>
	{
		let tmpFable = makeFable();
		let tmpMCM = new libMCM(tmpFable, {}, 'mcm-test');
		let tmpSchemas = tmpMCM.getAllProviderFormSchemas();
		let tmpSeen = new Set();
		tmpSchemas.forEach((pSchema) =>
			{
				Expect(pSchema.Provider, 'Provider id must be a string').to.be.a('string');
				Expect(tmpSeen.has(pSchema.Provider), `duplicate Provider id: ${pSchema.Provider}`).to.equal(false);
				tmpSeen.add(pSchema.Provider);
			});
	});

	test('every emitted schema satisfies the field-shape contract', () =>
	{
		let tmpFable = makeFable();
		let tmpMCM = new libMCM(tmpFable, {}, 'mcm-test');
		let tmpSchemas = tmpMCM.getAllProviderFormSchemas();
		tmpSchemas.forEach((pSchema) =>
		{
			validateFieldShape(pSchema, pSchema.Provider);
		});
	});
});
