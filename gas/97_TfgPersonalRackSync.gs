/** A-nauts personal lessons use one rack; no customer details enter rack calendars. */
const TFG_PERSONAL_RACK_SYNC_ = Object.freeze({
  legacyCalendarId: 'yachiyomidorigaoka@theforestgym.com',
  reservationTag: 'TFG_PERSONAL_RESERVATION_ID',
  slotTag: 'TFG_PERSONAL_SLOT',
  gapMinutes: 40
});

function readTfgPersonalRackRequests_(now) {
  const sheet = SpreadsheetApp.openById(TFG_TOUR_RACK_SYNC_.spreadsheetId).getSheetByName(TFG_TOUR_RACK_SYNC_.sheetName);
  if (!sheet || sheet.getLastRow() < 1) throw new Error('パーソナル予約の参照シートを確認できません。');
  const requests = buildTfgPersonalRackRequests_(sheet.getRange(1, 1, sheet.getLastRow(), sheet.getLastColumn()).getValues(), now);
  const calendar = CalendarApp.getCalendarById(TFG_PERSONAL_RACK_SYNC_.legacyCalendarId);
  if (!calendar) throw new Error('旧形式パーソナル予約のカレンダーを参照できません。');
  const events = calendar.getEvents(new Date(now.getTime() - 2 * 86400000), new Date(now.getTime() + 35 * 86400000));
  return mergeTfgLegacyPersonalRackRequests_(requests, events, now);
}

/** The prior trainer booking app stores BK reservations directly in the personal calendar. */
function mergeTfgLegacyPersonalRackRequests_(requests, events, now) {
  const seen = Object.create(null);
  events.forEach(function(event) {
    const description = String(event.getDescription() || '');
    const match = description.match(/^予約ID[:：]\s*(BK-[A-Z0-9]+)\s*$/m);
    if (!match) return;
    const id = match[1];
    const title = String(event.getTitle() || '');
    if (!title.includes('[' + id + ']') || !/^トレーナー[:：]\s*\S.+$/m.test(description) || !/^プラン[:：]\s*\S.+$/m.test(description) || event.isAllDayEvent()) throw new Error('旧形式パーソナル予約の内容を確認できません。');
    if (seen[id]) throw new Error('旧形式パーソナル予約IDが重複しています。');
    seen[id] = true;
    const lessonStart = event.getStartTime();
    const lessonEnd = event.getEndTime();
    if (!Number.isFinite(lessonStart.getTime()) || !Number.isFinite(lessonEnd.getTime()) || lessonEnd <= lessonStart) throw new Error('旧形式パーソナル予約の日時が不正です。');
    const start = new Date(lessonStart.getTime() + 10 * 60000);
    const end = new Date(start.getTime() + 40 * 60000);
    if (end <= now || start.getTime() > now.getTime() + 33 * 86400000) return;
    const signature = start.toISOString() + '/' + end.toISOString();
    if (requests[id] && requests[id].signature !== signature) throw new Error('旧形式パーソナル予約の日時が参照元と一致しません。');
    requests[id] = {id: id, start: start, end: end, signature: signature};
  });
  return requests;
}

function buildTfgPersonalRackRequests_(values, now) {
  const headers = values[0].map(function(value) { return String(value).trim(); });
  const columns = {};
  ['reservation_id', 'service_code', 'store_code', 'reservation_date', 'start_time', 'status'].forEach(function(name) {
    const index = headers.indexOf(name);
    if (index < 0 || index !== headers.lastIndexOf(name)) throw new Error('パーソナル予約の列を確認できません: ' + name);
    columns[name] = index;
  });
  const calendarIndex = headers.indexOf('calendar_code');
  if (calendarIndex !== headers.lastIndexOf('calendar_code')) throw new Error('予約カレンダーの列が重複しています。');
  const requests = Object.create(null);
  values.slice(1).forEach(function(row) {
    const value = function(name) { return String(row[columns[name]] || '').trim(); };
    if (value('store_code') !== 'YACHIYO') return;
    if (!tfgPersonalRackService_(value('service_code')) && !(calendarIndex >= 0 && String(row[calendarIndex]).trim() === 'PERSONAL')) return;
    if (['RESERVED', 'CONFIRMED'].indexOf(value('status')) < 0) return;
    const id = value('reservation_id');
    if (!id || requests[id]) throw new Error('パーソナル予約IDが不正または重複しています。');
    const date = tfgTourRackDate_(row[columns.reservation_date]);
    const time = tfgTourRackTime_(row[columns.start_time]);
    const lessonStart = new Date(date + 'T' + time + ':00+09:00');
    if (!Number.isFinite(lessonStart.getTime()) || Utilities.formatDate(lessonStart, CONFIG.timezone, 'yyyy-MM-dd HH:mm') !== date + ' ' + time) throw new Error('パーソナル予約日時が不正です。');
    const start = new Date(lessonStart.getTime() + 10 * 60000);
    const end = new Date(start.getTime() + 40 * 60000);
    if (end <= now || start.getTime() > now.getTime() + 33 * 86400000) return;
    requests[id] = {id: id, start: start, end: end, signature: start.toISOString() + '/' + end.toISOString()};
  });
  return requests;
}

function tfgPersonalRackService_(code) {
  return /^(?:PT60|PT_[A-Z0-9_]+)$/.test(String(code || '').trim());
}

/** Only source-linked OS events are adopted; manual rack holds remain untouched. */
function tfgPersonalRackLegacyId_(event) {
  const description = String(event.getDescription() || '');
  if (!/^A-nauts OS Reserve\s*\n/.test(description)) return '';
  const service = description.match(/^service_code:\s*(\S+)\s*$/m);
  if (!service || !tfgPersonalRackService_(service[1])) return '';
  const match = description.match(/^reservation_id:\s*(RSV[A-Za-z0-9-]+)\s*$/m);
  return match ? match[1] : '';
}

/** The original reserved interval survives an early checkout, including its 40-minute gap. */
function tfgPersonalRackInterval_(event) {
  const signature = event.getTag(TFG_PERSONAL_RACK_SYNC_.slotTag);
  if (signature) {
    const parts = signature.split('/');
    const start = new Date(parts[0]);
    const end = new Date(parts[1]);
    if (parts.length !== 2 || !Number.isFinite(start.getTime()) || !Number.isFinite(end.getTime()) || end <= start) throw new Error('パーソナルの確保時間を確認できません。');
    return {start: start, end: end};
  }
  return {start: event.getStartTime(), end: event.getEndTime()};
}

function tfgPersonalRackView_(event) {
  const id = event.getTag(TFG_PERSONAL_RACK_SYNC_.reservationTag) || tfgPersonalRackLegacyId_(event);
  const personal = !!(id || parseAdminBookingDescription_(event.getDescription() || '').BOOKING_TYPE === 'personal' || /PERSONAL|パーソナル/.test(String(event.getTitle() || '')));
  const interval = personal ? tfgPersonalRackInterval_(event) : {start: event.getStartTime(), end: event.getEndTime()};
  return {eventId: event.getId(), id: id, personal: personal, start: interval.start, end: interval.end};
}

function tfgPersonalRackHasConflict_(calendar, start, end, excludeId, requestId, requests, snapshot) {
  // Include shortened, checked-out 40-minute events whose original end is still relevant.
  const events = snapshot || calendar.getEvents(new Date(start.getTime() - 80 * 60000), new Date(end.getTime() + 40 * 60000)).map(tfgPersonalRackView_);
  return events.some(function(interval) {
    if (excludeId && interval.eventId === excludeId) return false;
    const id = interval.id;
    if (requestId && id === requestId) return false;
    const personal = interval.personal;
    if (personal && requestId && requests && requests[id]) {
      // Keep the earlier existing lesson stable; the later source-linked hold is reconciled next.
      const own = requests[requestId];
      const other = requests[id];
      if (other.start > own.start || (+other.start === +own.start && id.localeCompare(requestId) > 0)) return false;
    }
    const gap = personal ? TFG_PERSONAL_RACK_SYNC_.gapMinutes * 60000 : 0;
    return start.getTime() < interval.end.getTime() + gap && end.getTime() + gap > interval.start.getTime();
  });
}

/** Used by both source synchronization and the existing manual personal rack form. */
function findTfgPersonalRack_(start, end) {
  const racks = getRackPriorityForPersonal_();
  if (racks.length !== 4) throw new Error('パーソナル用ラック4台の設定を確認できません。');
  const candidates = racks.map(function(info) {
    const calendar = CalendarApp.getCalendarById(info.id);
    if (!calendar) throw new Error('ラックカレンダーを参照できません。');
    return {info: info, calendar: calendar};
  });
  for (let i = 0; i < candidates.length; i++) {
    if (!tfgPersonalRackHasConflict_(candidates[i].calendar, start, end)) return candidates[i].info;
  }
  return null;
}

/** Called under the shared rack script lock, after all source rows and calendars were validated. */
function syncTfgPersonalRacksUnlocked_(now, requests, tourRacks) {
  const racks = getRackPriorityForPersonal_().map(function(info) {
    const rack = tourRacks.find(function(item) { return item.info.id === info.id; });
    if (!rack) throw new Error('パーソナル用ラック設定が一致しません。');
    return rack;
  });
  if (racks.length !== 4) throw new Error('パーソナル用ラック4台の設定を確認できません。');
  const existing = Object.create(null);
  const result = {reservations: Object.keys(requests).length, created: 0, adopted: 0, released: 0, retained: 0, pending: []};
  racks.forEach(function(rack) {
    const events = rack.calendar.getEvents(new Date(now.getTime() - 2 * 86400000), new Date(now.getTime() + 35 * 86400000));
    rack.personalEvents = events.map(tfgPersonalRackView_);
    events.sort(function(a, b) { return a.getStartTime() - b.getStartTime(); }).forEach(function(event) {
      const taggedId = event.getTag(TFG_PERSONAL_RACK_SYNC_.reservationTag);
      const id = taggedId || tfgPersonalRackLegacyId_(event);
      if (!id) return;
      const request = requests[id];
      const signature = taggedId ? event.getTag(TFG_PERSONAL_RACK_SYNC_.slotTag) : event.getStartTime().toISOString() + '/' + event.getEndTime().toISOString();
      const completed = taggedId && parseAdminBookingDescription_(event.getDescription() || '').CHECKOUT === 'true';
      const sameSlot = request && signature === request.signature && (completed || !tfgPersonalRackHasConflict_(rack.calendar, request.start, request.end, event.getId(), id, requests, rack.personalEvents));
      if (sameSlot && !existing[id]) {
        if (!taggedId) {
          event.setTag(TFG_PERSONAL_RACK_SYNC_.reservationTag, id);
          event.setTag(TFG_PERSONAL_RACK_SYNC_.slotTag, request.signature);
          result.adopted++;
        }
        ensureTfgPersonalRackMetadata_(event, rack.info);
        existing[id] = event;
        result.retained++;
      } else if (event.getEndTime() > now) {
        event.deleteEvent();
        rack.personalEvents = rack.personalEvents.filter(function(item) { return item.eventId !== event.getId(); });
        result.released++;
      }
    });
  });
  Object.keys(requests).sort(function(a, b) { return requests[a].start - requests[b].start || a.localeCompare(b); }).forEach(function(id) {
    if (existing[id]) return;
    const request = requests[id];
    let chosen = null;
    for (let i = 0; i < racks.length; i++) {
      if (!tfgPersonalRackHasConflict_(racks[i].calendar, request.start, request.end, '', '', null, racks[i].personalEvents)) { chosen = racks[i]; break; }
    }
    if (!chosen) { result.pending.push(id); return; }
    const event = chosen.calendar.createEvent('パーソナル', request.start, request.end, {description: buildAdminBookingDescription_({
      BOOKING_TYPE: 'personal', ADMIN_TOKEN: Utilities.getUuid(), RACK: chosen.info.label, CHECKIN: 'true', CHECKOUT: 'false'
    })});
    try {
      event.setTag(TFG_PERSONAL_RACK_SYNC_.reservationTag, id);
      event.setTag(TFG_PERSONAL_RACK_SYNC_.slotTag, request.signature);
    } catch (error) { event.deleteEvent(); throw error; }
    chosen.personalEvents.push(tfgPersonalRackView_(event));
    result.created++;
  });
  return result;
}

function ensureTfgPersonalRackMetadata_(event, rack) {
  const meta = parseAdminBookingDescription_(event.getDescription() || '');
  if (event.getTitle() !== 'パーソナル') event.setTitle('パーソナル');
  if (meta.BOOKING_TYPE === 'personal' && meta.CHECKIN === 'true') return;
  event.setDescription(buildAdminBookingDescription_({
    BOOKING_TYPE: 'personal', ADMIN_TOKEN: meta.ADMIN_TOKEN || Utilities.getUuid(), RACK: rack.label,
    CHECKIN: 'true', CHECKOUT: meta.CHECKOUT === 'true' ? 'true' : 'false'
  }));
}
