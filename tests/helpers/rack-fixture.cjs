const fs=require('node:fs'),path=require('node:path'),vm=require('node:vm'),assert=require('node:assert/strict');
const source=fs.readFileSync(path.join(__dirname,'../../gas/96_TfgTourRackSync.gs'),'utf8');
const personalSource=fs.readFileSync(path.join(__dirname,'../../gas/97_TfgPersonalRackSync.gs'),'utf8');
const headers=['reservation_id','service_code','store_code','reservation_date','start_time','status','note'];
function fixture({party=1,start='10:00',now='2026-11-21T09:00:00+09:00'}={}){
  let clock=Date.parse(now),locked=false,serial=0;
  const rows=[headers,['RSV-ONE','TOUR','YACHIYO','2026-11-21',start,'RESERVED','見学人数：'+party+'名\nTFG_TOUR_DATA:'+JSON.stringify({guests:Array.from({length:party},()=>({name:'private-name',email:'private@example.invalid'}))})]];
  const cache=new Map(),triggers=[],calendars=new Map(),sourceEvents=[],writes=[],state={reads:0,calendarReads:0,missing:null,failTags:false,busy:false};
  const date=value=>new Date(value);
  function event(title,start,end,description='',tags={}){
    const item={id:String(++serial),title,start:date(start),end:date(end),description,tags:{...tags},deleted:false,
      getId(){return this.id},getTitle(){return this.title},setTitle(value){this.title=value;return this},getStartTime(){return this.start},getEndTime(){return this.end},
      getDescription(){return this.description},isAllDayEvent(){return false},setDescription(value){this.description=value;return this},getTag(key){return this.tags[key]||null},
      setTag(key,value){if(state.failTags)throw Error('tag failure');this.tags[key]=value;return this},
      deleteEvent(){assert.equal(locked,true);this.deleted=true;writes.push(['delete',this.id]);}
    };return item;
  }
  for(const no of [1,2,3,4]){
    const events=[];calendars.set(String(no),{events,
      getEvents:(a,b)=>{state.calendarReads++;return events.filter(e=>!e.deleted&&e.start<b&&e.end>a)},
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
    CalendarApp:{getCalendarById:id=>state.missing===id?null:id==='yachiyomidorigaoka@theforestgym.com'?{getEvents(a,b){state.calendarReads++;return sourceEvents.filter(e=>!e.deleted&&e.start<b&&e.end>a)}}:calendars.get(id)},
    getRackPriorityForTour_:()=>[2,3,4,1].map(no=>({id:String(no),label:'ラック№'+no})),
    getRackPriorityForPersonal_:()=>[4,3,2,1].map(no=>({id:String(no),label:'ラック№'+no})),
    buildAdminBookingDescription_:meta=>Object.entries(meta).map(([k,v])=>k+': '+v).join('\n'),
    parseAdminBookingDescription_:text=>Object.fromEntries(text.split('\n').filter(x=>x.includes(': ')).map(x=>[x.slice(0,x.indexOf(': ')),x.slice(x.indexOf(': ')+2)])),
    logError_(){},checkInNowWithoutTourSync_:params=>{assert.equal(locked,true);return {ok:true,params}},
    ScriptApp:{getProjectTriggers:()=>triggers,newTrigger:handler=>({timeBased(){return this},everyMinutes(n){assert.equal(n,1);return this},create(){triggers.push({getHandlerFunction:()=>handler})}})}
  });
  vm.runInContext(source,scope);
  vm.runInContext(personalSource,scope);
  const sync=force=>scope.syncTfgTourRacksIfDue_(force===undefined?true:force);
  const alive=no=>calendars.get(String(no)).events.filter(e=>!e.deleted);
  const block=(no,from='2026-11-21T10:30:00+09:00',to='2026-11-21T11:10:00+09:00')=>calendars.get(String(no)).events.push(event('会員予約',from,to));
  return {scope,rows,state,cache,triggers,calendars,sourceEvents,writes,sync,alive,block,setNow:iso=>{clock=Date.parse(iso)}};
}
module.exports={fixture};
