const fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const test=require('node:test'),assert=require('node:assert/strict');
const source=fs.readFileSync(path.join(__dirname,'../gas/96_TfgTourRackSync.gs'),'utf8');
const headers=['reservation_id','service_code','store_code','reservation_date','start_time','status','note'];
function fixture({party=1,start='10:00',now='2026-11-21T09:00:00+09:00'}={}){
  let clock=Date.parse(now),locked=false,serial=0;
  const rows=[headers,['RSV-ONE','TOUR','YACHIYO','2026-11-21',start,'RESERVED','見学人数：'+party+'名\nTFG_TOUR_DATA:'+JSON.stringify({guests:Array.from({length:party},()=>({name:'private-name',email:'private@example.invalid'}))})]];
  const cache=new Map(),triggers=[],calendars=new Map(),writes=[],state={reads:0,missing:null,failTags:false,busy:false};
  const date=value=>new Date(value);
  function event(title,start,end,description='',tags={}){
    const item={id:String(++serial),title,start:date(start),end:date(end),description,tags:{...tags},deleted:false,
      getId(){return this.id},getTitle(){return this.title},getStartTime(){return this.start},getEndTime(){return this.end},
      getDescription(){return this.description},getTag(key){return this.tags[key]||null},
      setTag(key,value){if(state.failTags)throw Error('tag failure');this.tags[key]=value;return this},
      deleteEvent(){assert.equal(locked,true);this.deleted=true;writes.push(['delete',this.id]);}
    };return item;
  }
  for(const no of [1,2,3,4]){
    const events=[];calendars.set(String(no),{events,
      getEvents:(a,b)=>events.filter(e=>!e.deleted&&e.start<b&&e.end>a),
      createEvent(title,start,end,options){assert.equal(locked,true);const e=event(title,start,end,options.description);events.push(e);writes.push(['create',no]);return e;}
    });
  }
  function format(d,zone,pattern){
    const p=Object.fromEntries(new Intl.DateTimeFormat('en-CA',{timeZone:zone,year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',hourCycle:'h23'}).formatToParts(d).map(p=>[p.type,p.value]));
    return pattern==='HH:mm'?p.hour+':'+p.minute:p.year+'-'+p.month+'-'+p.day+(pattern.includes('HH:mm')?' '+p.hour+':'+p.minute:'');
  }
  const scope=vm.createContext({console:{log(){}},Date:new Proxy(Date,{construct:(t,args)=>new t(...(args.length?args:[clock]))}),CONFIG:{timezone:'Asia/Tokyo'},
    SpreadsheetApp:{openById:()=>({getSheetByName:()=>({getLastRow:()=>rows.length,getLastColumn:()=>headers.length,getRange:()=>({getValues(){state.reads++;return rows}})})})},
    Utilities:{formatDate:format,getUuid:()=> 'admin-token-'+(++serial)},
    CacheService:{getScriptCache:()=>({get:key=>cache.get(key),put:(k,v)=>cache.set(k,v)})},
    LockService:{getScriptLock:()=>({tryLock(){if(state.busy||locked)return false;locked=true;return true},waitLock(){if(locked)throw Error('nested');locked=true},releaseLock(){locked=false}})},
    CalendarApp:{getCalendarById:id=>state.missing===id?null:calendars.get(id)},
    getRackPriorityForTour_:()=>[2,3,4,1].map(no=>({id:String(no),label:'ラック№'+no})),
    buildAdminBookingDescription_:meta=>Object.entries(meta).map(([k,v])=>k+': '+v).join('\n'),
    logError_(){},checkInNowWithoutTourSync_:params=>{assert.equal(locked,true);return {ok:true,params}},
    ScriptApp:{getProjectTriggers:()=>triggers,newTrigger:handler=>({timeBased(){return this},everyMinutes(n){assert.equal(n,1);return this},create(){triggers.push({getHandlerFunction:()=>handler})}})}
  });
  vm.runInContext(source,scope);
  const sync=force=>scope.syncTfgTourRacksIfDue_(force===undefined?true:force);
  const alive=no=>calendars.get(String(no)).events.filter(e=>!e.deleted);
  const block=(no,from='2026-11-21T10:30:00+09:00',to='2026-11-21T11:10:00+09:00')=>calendars.get(String(no)).events.push(event('会員予約',from,to));
  return {scope,rows,state,cache,triggers,calendars,writes,sync,alive,block,setNow:iso=>{clock=Date.parse(iso)}};
}
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
  const f=fixture();f.sync(false);assert.equal(f.sync(false).skipped,true);assert.equal(f.state.reads,1);f.setNow('2026-11-21T09:00:31+09:00');f.sync(false);assert.equal(f.state.reads,2);assert.equal(f.scope.checkInNow({rackNo:1}).ok,true);
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
