// Test double for server/request-scope.ts in the VM-based unit tests: behaves as the real module does outside a request
// (no cookie store, so nothing is memoized and nothing is timed). The real module is tested in scripts/request-scope.test.cjs.
module.exports = {
  requestScope: async () => null,
  requestMemo: async (_key, _proof, compute) => compute(),
  timePhase: async (_name, run) => run(),
  addMark: () => {},
  serverTimingEnabled: () => false,
  serverTimingValue: () => '',
};
