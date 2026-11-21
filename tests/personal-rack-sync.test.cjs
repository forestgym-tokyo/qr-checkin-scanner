const test=require('node:test'),assert=require('node:assert/strict');
const {fixture}=require('./helpers/rack-fixture.cjs');
function personal(options={}){
  const f=fixture(options);f.rows[1]=['RSV-PT','PT60','YACHIYO','2026-11-21',options.start||'10:00','RESERVED','private-name private@example.invalid'];return f;
}
function addPersonal(f,no,start,end,{legacy=false,id='RSV-OLD',tagged=false,checkout=false}={}){
  f.block(no,start,end);const e=f.alive(no).at(-1);e.title='PERSONAL';
  e.description=legacy?'A-nauts OS Reserve\nreservation_id: '+id+'\nservice_code: PT60\ncustomer_name: private-name':'BOOKING_TYPE: personal\nCHECKIN: true\nCHECKOUT: '+checkout;
  if(tagged){e.tags.TFG_PERSONAL_RESERVATION_ID=id;e.tags.TFG_PERSONAL_SLOT=e.start.toISOString()+'/'+e.end.toISOString();}
  return e;
}
test('personal lesson acquires rack 4 at +10 for exactly 40 minutes with checkout metadata',()=>{
  const f=personal(),r=f.sync();assert.equal(r.ok,true);assert.equal(r.personal.created,1);const e=f.alive(4)[0];
  assert.equal(e.title,'パーソナル');assert.equal(e.start.toISOString(),'2026-11-21T01:10:00.000Z');assert.equal(e.end.toISOString(),'2026-11-21T01:50:00.000Z');
  assert.match(e.description,/BOOKING_TYPE: personal/);assert.match(e.description,/CHECKIN: true/);assert.match(e.description,/CHECKOUT: false/);assert.doesNotMatch(e.description,/private|customer/);
});
for(const code of ['PT60','PT_ENTRY60','PT_PRIME60','PT_PURPOSE60','PT_DIET60','PT_TRIAL60'])test(code+' uses personal automatic allocation',()=>{
  const f=personal();f.rows[1][1]=code;assert.equal(f.sync().personal.created,1);
});
test('calendar_code PERSONAL supports another personal service without targeting other stores',()=>{
  const f=personal();f.rows[0]=[...f.rows[0],'calendar_code'];f.rows[1][1]='SPECIAL';f.rows[1].push('PERSONAL');assert.equal(f.sync().personal.created,1);
  f.rows[1][2]='MPG';assert.equal(f.sync().personal.released,1);
});
for(const [blocked,expected] of [[[4],3],[[4,3],2],[[4,3,2],1]])test('personal rack priority after '+blocked,()=>{
  const f=personal();blocked.forEach(n=>f.block(n,'2026-11-21T10:10:00+09:00','2026-11-21T10:50:00+09:00'));f.sync();assert.equal(f.alive(expected)[0].title,'パーソナル');
});
for(const [edge,expected] of [['09:31',3],['09:30',4]])test('previous personal end '+edge+' enforces the exact 40-minute boundary',()=>{
  const f=personal();addPersonal(f,4,'2026-11-21T08:50:00+09:00','2026-11-21T'+edge+':00+09:00');f.sync();assert.equal(f.alive(expected).at(-1).title,'パーソナル');
});
for(const [edge,expected] of [['11:29',3],['11:30',4]])test('next personal start '+edge+' enforces the exact 40-minute boundary',()=>{
  const f=personal();addPersonal(f,4,'2026-11-21T'+edge+':00+09:00','2026-11-21T12:10:00+09:00');f.sync();assert.equal(f.alive(expected).at(-1).title,'パーソナル');
});
test('ordinary member bookings may touch a personal slot boundary without a 40-minute buffer',()=>{
  const f=personal();f.block(4,'2026-11-21T09:30:00+09:00','2026-11-21T10:10:00+09:00');f.block(4,'2026-11-21T10:50:00+09:00','2026-11-21T11:30:00+09:00');f.sync();assert.equal(f.alive(4).filter(e=>e.title==='パーソナル').length,1);
});
test('hourly personal reservations alternate racks because only 20 minutes separate the holds',()=>{
  const f=personal();for(const [id,start] of [['RSV-2','11:00'],['RSV-3','12:00']])f.rows.push([id,'PT60','YACHIYO','2026-11-21',start,'RESERVED','']);
  f.sync();assert.deepEqual(f.alive(4).map(e=>e.tags.TFG_PERSONAL_RESERVATION_ID),['RSV-PT','RSV-3']);assert.equal(f.alive(3)[0].tags.TFG_PERSONAL_RESERVATION_ID,'RSV-2');
  assert.equal(f.sync().personal.created,0);
});
test('existing earlier personal hold stays stable while a later conflicting linked hold moves',()=>{
  const f=personal();f.rows.push(['RSV-2','PT60','YACHIYO','2026-11-21','11:00','RESERVED','']);
  const first=addPersonal(f,4,'2026-11-21T10:10:00+09:00','2026-11-21T10:50:00+09:00',{id:'RSV-PT',tagged:true});
  const later=addPersonal(f,4,'2026-11-21T11:10:00+09:00','2026-11-21T11:50:00+09:00',{id:'RSV-2',tagged:true});
  f.sync();assert.equal(first.deleted,false);assert.equal(later.deleted,true);assert.equal(f.alive(3)[0].tags.TFG_PERSONAL_RESERVATION_ID,'RSV-2');
});
test('early checkout preserves completion and the original gap, without recreating the hold',()=>{
  const f=personal();f.sync();const e=f.alive(4)[0];e.end=new Date('2026-11-21T10:20:00+09:00');e.description=e.description.replace('CHECKOUT: false','CHECKOUT: true');
  f.setNow('2026-11-21T10:21:00+09:00');f.rows.push(['RSV-2','PT60','YACHIYO','2026-11-21','11:00','RESERVED','']);
  const r=f.sync();assert.equal(r.personal.retained,1);assert.equal(r.personal.created,1);assert.equal(f.alive(4).length,1);assert.equal(f.alive(3)[0].tags.TFG_PERSONAL_RESERVATION_ID,'RSV-2');assert.equal(e.end.toISOString(),'2026-11-21T01:20:00.000Z');
});
test('a checked-out interval remains relevant even when the actual end is outside the 40-minute lookback',()=>{
  const f=personal({start:'11:00'});const old=addPersonal(f,4,'2026-11-21T10:10:00+09:00','2026-11-21T10:50:00+09:00',{id:'RSV-OLD',tagged:true,checkout:true});old.end=new Date('2026-11-21T10:15:00+09:00');
  f.setNow('2026-11-21T11:00:00+09:00');f.sync();assert.equal(f.alive(3)[0].title,'パーソナル');
});
test('cancelling or moving the source removes only its linked hold',()=>{
  const f=personal();f.sync();const old=f.alive(4)[0];f.rows[1][4]='12:00';let r=f.sync();assert.equal(old.deleted,true);assert.equal(r.personal.created,1);assert.equal(f.alive(4)[0].start.toISOString(),'2026-11-21T03:10:00.000Z');
  f.rows[1][5]='CANCELLED';r=f.sync();assert.equal(r.personal.released,1);assert.equal(f.alive(4).length,0);
});
test('source-linked OS personal holds are adopted and personal details removed',()=>{
  const f=personal();const old=addPersonal(f,4,'2026-11-21T10:10:00+09:00','2026-11-21T10:50:00+09:00',{id:'RSV-PT',legacy:true});const r=f.sync();
  assert.equal(r.personal.adopted,1);assert.equal(r.personal.created,0);assert.equal(old.deleted,false);assert.equal(old.title,'パーソナル');assert.doesNotMatch(old.description,/private/);assert.match(old.description,/CHECKIN: true/);
});
test('old OS timing and duplicate linked holds are replaced with one exact personal hold',()=>{
  const f=personal();const old=addPersonal(f,4,'2026-11-21T10:00:00+09:00','2026-11-21T10:40:00+09:00',{id:'RSV-PT',legacy:true});const duplicate=addPersonal(f,3,'2026-11-21T10:00:00+09:00','2026-11-21T10:40:00+09:00',{id:'RSV-PT',legacy:true});
  const r=f.sync();assert.equal(r.personal.created,1);assert.equal(old.deleted,true);assert.equal(duplicate.deleted,true);assert.equal(f.alive(4).length,1);
});
test('busy calendars leave all members untouched, report pending and retry later',()=>{
  const f=personal();[1,2,3,4].forEach(n=>f.block(n,'2026-11-21T10:10:00+09:00','2026-11-21T10:50:00+09:00'));let r=f.sync();assert.equal(r.personal.created,0);assert.deepEqual(Array.from(r.personal.pending),['RSV-PT']);assert.equal(f.writes.length,0);
  f.alive(2)[0].deleted=true;r=f.sync();assert.equal(r.personal.created,1);assert.equal(f.alive(2)[0].title,'パーソナル');
});
test('personal and tour share calendars without overlap and retain separate source identities',()=>{
  const f=personal();f.rows.push(['RSV-TOUR','TOUR','YACHIYO','2026-11-21','10:00','RESERVED','見学人数：1名']);let r=f.sync();assert.equal(r.created,1);assert.equal(r.personal.created,1);assert.equal(f.alive(2)[0].title,'店内見学');assert.equal(f.alive(4)[0].title,'パーソナル');
  f.rows[1][5]='CANCELLED';f.sync();assert.equal(f.alive(2).length,1);assert.equal(f.alive(4).length,0);
});
test('invalid personal source data prevents any tour or personal mutation',()=>{
  const f=personal();f.rows[1][3]='2026-11-31';f.rows.push(['RSV-TOUR','TOUR','YACHIYO','2026-11-21','10:00','RESERVED','']);assert.equal(f.sync().ok,false);assert.equal(f.writes.length,0);
});
test('unrelated services, other stores, inactive and past reservations do not acquire racks',()=>{
  for(const change of [f=>f.rows[1][1]='TRAINING_SUPPORT45',f=>f.rows[1][2]='MPG',f=>f.rows[1][5]='CANCELLED',f=>f.setNow('2026-11-21T10:51:00+09:00')]){const f=personal();change(f);assert.equal(f.sync().personal.created,0);}
});
test('manual personal selection uses the same strict gap and priority',()=>{
  const f=personal();addPersonal(f,4,'2026-11-21T09:00:00+09:00','2026-11-21T09:40:00+09:00');
  assert.equal(f.scope.findTfgPersonalRack_(new Date('2026-11-21T10:10:00+09:00'),new Date('2026-11-21T10:50:00+09:00')).label,'ラック№3');
});
test('failed ownership tags roll back a newly created personal event',()=>{
  const f=personal();f.state.failTags=true;assert.equal(f.sync().ok,false);assert.equal(f.alive(4).length,0);
});
test('calendar snapshots keep API reads constant as personal reservations increase',()=>{
  const f=personal();for(let i=11;i<21;i++)f.rows.push(['RSV-'+i,'PT60','YACHIYO','2026-11-21',i+':00','RESERVED','']);
  assert.equal(f.sync().personal.created,11);assert.equal(f.state.calendarReads,8);
});
