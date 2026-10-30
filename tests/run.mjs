// Test runner: node tests/run.mjs            (fast tests, no engine)
//              node tests/run.mjs --engine   (also runs Stockfish analysis tests; needs `npm install`)
const suites = ['./motifs.test.mjs', './training.test.mjs', './openings.test.mjs', './pgnexport.test.mjs'];
if (process.argv.includes('--engine')) suites.push('./analysis.test.mjs');

let passed = 0, failed = 0;
const assert = (ok, msg) => {
  if (ok) { passed++; } else { failed++; console.log('  FAIL', msg); }
};

for (const s of suites) {
  let mod;
  try {
    mod = await import(s);
  } catch (e) {
    if (e.code === 'ERR_MODULE_NOT_FOUND' && e.message.includes(s.slice(2))) { console.log('skip', s, '(not written yet)'); continue; }
    throw e;
  }
  const before = failed;
  await mod.run(assert);
  console.log(failed === before ? 'ok  ' : 'FAIL', s);
}
console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
