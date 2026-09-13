import test from 'node:test';
import assert from 'node:assert/strict';
import {selectColdPlan,coldPromptFor,resumeColdPromptFor} from './harness-complex-case.mjs';
const atomicName='failed cancellation persistence cannot release phantom inventory';
const external=(atomic,other=true)=>({protectedFilesUnchanged:true,checks:[{name:'ordinary behavior',passed:other},{name:atomicName,...atomic}]});
test('a passing implementation is not told to report a fictitious natural defect',()=>{
  const plan=selectColdPlan(external({passed:true}));
  assert.equal(plan.expectAtomicity,false);
  assert.doesNotMatch(coldPromptFor(plan),/另建\[ATOMIC-REVIEW\]|已经独立复现|上述两个新review/);
  assert.match(resumeColdPromptFor(plan),/不要虚构/);
});
test('specific independently reproduced phantom inventory enables the second review',()=>{
  const plan=selectColdPlan(external({passed:false,error:'failed commit released inventory\n1 !== 0'}));
  assert.equal(plan.expectAtomicity,true);
  assert.match(coldPromptFor(plan),/另建\[ATOMIC-REVIEW\]/);
});
test('unrelated failures or modified protected files cannot authorize defect injection',()=>{
  for(const outcome of [external({passed:false,error:'server did not start'}),external({passed:true},false),{...external({passed:true}),protectedFilesUnchanged:false}]) {
    assert.throws(()=>selectColdPlan(outcome));
  }
});
