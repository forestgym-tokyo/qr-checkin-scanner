const test=require('node:test'),assert=require('node:assert/strict');
const {fixture}=require('./helpers/rack-fixture.cjs');
test('one visitor reserves rack 2 from tour start +30 minutes for 30 minutes',()=>{
  const f=fixture();assert.equal(f.sync().created,1);const e=f.alive(2)[0];
  assert.equal(e.title,'店内見学');assert.equal(e.start.toISOString(),'2026-11-21T01:30:00.000Z');assert.equal(e.end.toISOString(),'2026-11-21T02:00:00.000Z');
  assert.match(e.description,/BOOKING_TYPE: tour/);assert.match(e.description,/CHECKIN: true/);assert.match(e.description,/CHECKOUT: false/);
  assert.doesNotMatch(e.description,/private|CANCEL_TOKEN/);assert.equal(f.alive(1).length,0);
});
test('two visitors reserve exactly 40 minutes, including a 20:00 tour',()=>{
  const f=fixture({party:2,start:'20:00'});f.sync();const e=f.alive(2)[0];
  assert.equal(e.start.toISOString(),'2026-11-21T11:30:00.000Z');assert.equal(e.end.toISOString(),'2026-11-21T12:10:00.000Z');
});
for(const [blocked,expected] of [[[2],3],[[2,3],4],[[2,3,4],1]])test('priority fallback after '+blocked.join(','),()=>{
  const f=fixture();blocked.forEach(n=>f.block(n));f.sync();assert.equal(f.alive(expected)[0].title,'店内見学');
});
test('a conflict in the last ten minutes excludes a rack for a two-person tour',()=>{
  const f=fixture({party:2});f.block(2,'2026-11-21T11:00:00+09:00','2026-11-21T11:30:00+09:00');f.sync();assert.equal(f.alive(3)[0].title,'店内見学');
});
test('adjacent events are not conflicts',()=>{
  const f=fixture();f.block(2,'2026-11-21T10:00:00+09:00','2026-11-21T10:30:00+09:00');f.block(2,'2026-11-21T11:00:00+09:00','2026-11-21T11:40:00+09:00');f.sync();assert.equal(f.alive(2).filter(e=>e.title==='店内見学').length,1);
});
test('all busy leaves member bookings untouched and retries when space opens',()=>{
  const f=fixture();[1,2,3,4].forEach(n=>f.block(n));const result=f.sync();assert.equal(result.created,0);assert.deepEqual(Array.from(result.pending),['RSV-ONE']);assert.equal(f.writes.length,0);
  f.alive(3)[0].deleted=true;assert.equal(f.sync().created,1);assert.equal(f.alive(3)[0].title,'店内見学');
});
test('retries and repeated polling never duplicate a hold or move it when a higher-priority rack opens',()=>{
  const f=fixture();f.block(2);f.sync();f.alive(2)[0].deleted=true;const result=f.sync();assert.equal(result.created,0);assert.equal(result.retained,1);assert.equal(f.alive(2).length,0);
});
test('cancellation releases only the managed hold',()=>{
  const f=fixture();f.block(4);f.sync();f.rows[1][5]='CANCELLED';const result=f.sync();assert.equal(result.released,1);assert.equal(f.alive(2).length,0);assert.equal(f.alive(4)[0].title,'会員予約');
});
test('changing tour time releases the old hold and takes the new exact interval',()=>{
  const f=fixture();f.sync();f.rows[1][4]='12:00';const result=f.sync();assert.equal(result.created,1);assert.equal(result.released,1);assert.equal(f.alive(2)[0].start.toISOString(),'2026-11-21T03:30:00.000Z');
});
test('changing party size updates the hold from 30 to 40 minutes',()=>{
  const f=fixture();f.sync();f.rows[1][6]='見学人数：2名';f.sync();assert.equal((f.alive(2)[0].end-f.alive(2)[0].start)/60000,40);
});
test('tablet checkout shortens the event; polling preserves it and never recreates the hold',()=>{
  const f=fixture();f.sync();const e=f.alive(2)[0];e.end=new Date('2026-11-21T10:45:00+09:00');e.description=e.description.replace('CHECKOUT: false','CHECKOUT: true');f.setNow('2026-11-21T10:46:00+09:00');
  const result=f.sync();assert.equal(result.created,0);assert.equal(result.retained,1);assert.equal(e.end.toISOString(),'2026-11-21T01:45:00.000Z');
});
test('other services, other stores and past tours never acquire a rack',()=>{
  const f=fixture();f.rows.push(['OTHER','PT','YACHIYO','2026-11-21','10:00','RESERVED','']);f.rows.push(['OTHER2','TOUR','SOGA','2026-11-21','10:00','RESERVED','']);f.setNow('2026-11-21T11:01:00+09:00');assert.equal(f.sync().reservations,0);assert.equal(f.writes.length,0);
});
test('missing columns or invalid party data fail before modifying an existing hold',()=>{
  for(const corrupt of [f=>{f.rows[0]=f.rows[0].map(x=>x==='status'?'missing':x)},f=>{f.rows[1][6]='\nTFG_TOUR_DATA:{bad'}]){
    const f=fixture();f.sync();const before=f.writes.length;corrupt(f);assert.equal(f.sync().ok,false);assert.equal(f.alive(2).length,1);assert.equal(f.writes.length,before);
  }
});
test('duplicate reservation IDs fail before modifying any holds',()=>{
  const f=fixture();f.rows.push([...f.rows[1]]);assert.equal(f.sync().ok,false);assert.equal(f.writes.length,0);
});
test('unavailable rack calendars fail before releasing existing holds',()=>{
  const f=fixture();f.sync();f.rows[1][5]='CANCELLED';f.state.missing='4';assert.equal(f.sync().ok,false);assert.equal(f.alive(2).length,1);
});
test('failed ownership tagging rolls back the new calendar event',()=>{
  const f=fixture();f.state.failTags=true;assert.equal(f.sync().ok,false);assert.equal(f.alive(2).length,0);
});
test('tablet refresh is throttled for 30 seconds; trigger and booking hooks share the same lock',()=>{
  const f=fixture();f.sync(false);assert.equal(f.sync(false).skipped,true);assert.equal(f.state.reads,2);f.setNow('2026-11-21T09:00:31+09:00');f.sync(false);assert.equal(f.state.reads,4);assert.equal(f.scope.checkInNow({rackNo:1}).ok,true);
});
test('a busy rack lock causes a safe retry without any calendar changes',()=>{
  const f=fixture();f.state.busy=true;assert.equal(f.sync().skipped,true);assert.equal(f.state.reads,0);assert.equal(f.writes.length,0);
});
test('installer retains all existing triggers and creates just one minute trigger',()=>{
  const f=fixture();f.triggers.push({getHandlerFunction:()=> 'existing-handler'});f.scope.installTfgTourRackSync_();f.scope.installTfgTourRackSync_();assert.deepEqual(f.triggers.map(t=>t.getHandlerFunction()),['existing-handler','syncTfgTourRacks_']);
});
test('native sheet dates and times use Japan time',()=>{
  const f=fixture();f.rows[1][3]=new Date('2026-11-20T15:00:00Z');f.rows[1][4]=new Date('1899-12-30T01:00:00Z');assert.equal(f.sync().created,1);assert.equal(f.alive(2)[0].start.toISOString(),'2026-11-21T01:30:00.000Z');
});
test('impossible dates fail instead of silently shifting a booking',()=>{
  const f=fixture();f.rows[1][3]='2026-11-31';assert.equal(f.sync().ok,false);assert.equal(f.writes.length,0);
});
function addLegacyHold(f,no){
  f.block(no);const event=f.alive(no).at(-1);event.title='店内見学';event.end=new Date('2026-11-21T11:00:00+09:00');
  event.description='A-nauts OS Reserve\n\nreservation_id: RSV-ONE\nservice_code: TOUR\ncustomer_name: private-name';return event;
}
test('an existing OS rack hold is adopted in place and made checkout-compatible',()=>{
  const f=fixture();const old=addLegacyHold(f,2);const result=f.sync();assert.equal(result.created,0);assert.equal(result.adopted,1);assert.equal(f.alive(2)[0],old);assert.match(old.description,/BOOKING_TYPE: tour/);assert.match(old.description,/CHECKIN: true/);assert.doesNotMatch(old.description,/private-name/);
});
test('existing legacy and newly tagged duplicates are reduced to one rack in priority order',()=>{
  const f=fixture();const preferred=addLegacyHold(f,2);f.sync();
  const duplicate=addLegacyHold(f,3);const result=f.sync();assert.equal(result.created,0);assert.equal(result.released,1);assert.equal(duplicate.deleted,true);assert.equal(preferred.deleted,false);
});
test('a higher-priority legacy hold replaces a duplicate generated before adoption was enabled',()=>{
  const f=fixture();f.block(2);f.sync();const generated=f.alive(3)[0];f.alive(2)[0].deleted=true;const legacy=addLegacyHold(f,2);const result=f.sync();assert.equal(result.adopted,1);assert.equal(result.released,1);assert.equal(generated.deleted,true);assert.equal(legacy.deleted,false);
});
test('unrelated manual tour events are not adopted or deleted',()=>{
  const f=fixture();const manual=addLegacyHold(f,2);manual.description='BOOKING_TYPE: tour\nADMIN_TOKEN: manual';f.sync();assert.equal(manual.deleted,false);assert.equal(f.alive(3)[0].title,'店内見学');
});
test('a legacy hold conflicting with a member reservation is moved without changing the member booking',()=>{
  const f=fixture();const legacy=addLegacyHold(f,2);f.block(2);const member=f.alive(2)[1];const result=f.sync();assert.equal(result.created,1);assert.equal(legacy.deleted,true);assert.equal(member.deleted,false);assert.equal(f.alive(3)[0].title,'店内見学');
});
