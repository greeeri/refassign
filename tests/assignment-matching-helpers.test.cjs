const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const ts = require('typescript');
const moduleBox = {exports:{}};
vm.runInNewContext(ts.transpileModule(fs.readFileSync('lib/assignments/matchingGames.ts','utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText,{module:moduleBox,exports:moduleBox.exports});
const {normalizeMatchingTotals,pageNumbers,emptyMatchingTotals}=moduleBox.exports;
test('counts accept zero and refuse malformed/negative totals rather than misleading numbers',()=>{
 const zero=emptyMatchingTotals();assert.equal(normalizeMatchingTotals(zero).total,0);
 for(const v of [null,[],{total:-1},{...zero,total:1.5},{...zero,total:'50'},{...zero,queue:{replacement:-1}}]) assert.equal(normalizeMatchingTotals(v),null);
});
test('page window never exceeds five numbers and reaches both edges',()=>{
 assert.deepEqual(Array.from(pageNumbers(1,8)),[1,2,3,4,5]);
 assert.deepEqual(Array.from(pageNumbers(5,8)),[3,4,5,6,7]);
 assert.deepEqual(Array.from(pageNumbers(8,8)),[4,5,6,7,8]);
 assert.deepEqual(Array.from(pageNumbers(1,1)),[1]);
});

const {normalizeGameSummary,emptyGameSummary}=moduleBox.exports;
test('simple summary exposes only total games and games with open positions',()=>{
 assert.equal(JSON.stringify(normalizeGameSummary({total:12,openGames:5,queue:{attention:9}})),JSON.stringify({total:12,openGames:5}));
 assert.equal(JSON.stringify(emptyGameSummary()),JSON.stringify({total:0,openGames:0}));
 for(const v of [null,[],{total:-1,openGames:0},{total:4},{total:4,openGames:-1},{total:4,openGames:5},{total:4,openGames:1.5},{total:'4',openGames:1}]) assert.equal(normalizeGameSummary(v),null);
});
