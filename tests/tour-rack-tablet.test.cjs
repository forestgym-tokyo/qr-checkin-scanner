const fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const test=require('node:test'),assert=require('node:assert/strict');
const html=fs.readFileSync(path.join(__dirname,'../racktablet.html'),'utf8');
const script=html.match(/<script>([\s\S]*?)<\/script>/)[1];
new vm.Script(script);
function fixture(){
  const elements=new Map();
  const element=id=>{if(!elements.has(id))elements.set(id,{textContent:'',innerHTML:'',style:{},classList:{add(){},remove(){}}});return elements.get(id)};
  const scope=vm.createContext({URLSearchParams,location:{search:'?rackNo=2'},document:{getElementById:element,querySelector:element,documentElement:{style:{setProperty(){}}}}});
  vm.runInContext(script.slice(0,script.indexOf('async function loadData()')),scope);
  return {scope,element};
}
test('an active tour displays 店内見学 and enables the existing checkout button',()=>{
  const f=fixture();f.scope.applyData({state:'using_checked_in',currentDisplayName:'店内見学',nextDisplayName:'店内見学',canCheckout:true,remainingMin:27,currentText:'10:30～11:00'});
  assert.equal(f.element('user').textContent,'店内見学さんが利用中');assert.equal(f.element('nextUser').textContent,'店内見学さん');assert.equal(f.element('checkoutBtn').style.display,'flex');
});
test('a scheduled tour keeps checkout hidden and uses the requested honorific',()=>{
  const f=fixture();f.scope.applyData({state:'reserved',nextDisplayName:'店内見学',canCheckout:false,remainingMin:12});
  assert.equal(f.element('nextUser').textContent,'店内見学さん');assert.equal(f.element('checkoutBtn').style.display,'none');
});
test('normal member names retain their honorific and checkout behavior',()=>{
  const f=fixture();f.scope.applyData({state:'using_checked_in',currentDisplayName:'テスト会員',canCheckout:true});assert.equal(f.element('user').textContent,'テスト会員さんが利用中');assert.equal(f.element('checkoutBtn').style.display,'flex');
});
test('an active personal uses the exact display label and enables checkout',()=>{
  const f=fixture();f.scope.applyData({state:'using_checked_in',currentDisplayName:'パーソナル',nextDisplayName:'パーソナル',canCheckout:true,remainingMin:35,currentText:'10:10～10:50'});
  assert.equal(f.element('user').textContent,'パーソナルが利用中');assert.equal(f.element('nextUser').textContent,'パーソナル');assert.equal(f.element('checkoutBtn').style.display,'flex');
});
test('a scheduled personal uses the exact display label and hides checkout',()=>{
  const f=fixture();f.scope.applyData({state:'reserved',nextDisplayName:'パーソナル',canCheckout:false,remainingMin:12});
  assert.equal(f.element('nextUser').textContent,'パーソナル');assert.equal(f.element('checkoutBtn').style.display,'none');
});
