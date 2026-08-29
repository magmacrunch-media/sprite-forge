// Assertion helpers and the result tally, from the kit (tests/kit/assert.mjs,
// vendored from magma-kit). Re-exported under the path every suite already
// imports, so the suites did not all have to move at once — and so there stays
// exactly one tally, which the runner reads.

export { results, test, eq, ok, throws } from './kit/assert.mjs';
