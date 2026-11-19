// Preload for child processes of local-fixture suites: their SQL HTTP calls run
// on the local fixture database instead of leaving the runner.
import {fixturePool,postgresTransport} from './postgres-fixture.mjs';
globalThis.fetch=postgresTransport(fixturePool());
