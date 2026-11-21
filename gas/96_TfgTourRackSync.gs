/** Link A-nauts TOUR reservations to one rack. Customer details never enter rack calendars. */
const TFG_TOUR_RACK_SYNC_ = Object.freeze({
  spreadsheetId: '1YCMXS_ngE34QvZw0-P_sVuvteOjDmvbz7mAFH4W-jzA',
  sheetName: 'reservations',
  reservationTag: 'TFG_TOUR_RESERVATION_ID',
  slotTag: 'TFG_TOUR_SLOT',
  cacheKey: 'TFG_TOUR_PERSONAL_RACK_SYNC_LAST_V2',
  intervalSeconds: 30
});

/** Editor-only installer; existing triggers and reservations are preserved. */
function installTfgTourRackSync_() {
  const result = syncTfgTourRacksIfDue_(true);
  if (!result.ok) throw new Error(result.error || '見学ラック連携を確認できませんでした。');
  if (!ScriptApp.getProjectTriggers().some(function(trigger) {
    return trigger.getHandlerFunction() === 'syncTfgTourRacks_';
  })) ScriptApp.newTrigger('syncTfgTourRacks_').timeBased().everyMinutes(1).create();
  console.log(JSON.stringify(result));
  return result;
}

/** Time trigger plus the live tablet refresh keep future holds synchronized. */
function syncTfgTourRacks_() {
  const result = syncTfgTourRacksIfDue_(false);
  if (!result.ok) throw new Error(result.error || '見学ラック同期に失敗しました。');
  return result;
}

function syncTfgTourRacksIfDue_(force) {
  const now = new Date();
  const cache = CacheService.getScriptCache();
  const last = Number(cache.get(TFG_TOUR_RACK_SYNC_.cacheKey) || 0);
  if (!force && now.getTime() - last < TFG_TOUR_RACK_SYNC_.intervalSeconds * 1000) return {ok: true, skipped: true};
  const lock = LockService.getScriptLock();
  if (!lock.tryLock(500)) return {ok: true, skipped: true};
  try {
    // Another tablet may have completed the work while this request acquired the lock.
    const current = Number(cache.get(TFG_TOUR_RACK_SYNC_.cacheKey) || 0);
    if (!force && now.getTime() - current < TFG_TOUR_RACK_SYNC_.intervalSeconds * 1000) return {ok: true, skipped: true};
    const result = syncTfgTourRacksUnlocked_(now);
    cache.put(TFG_TOUR_RACK_SYNC_.cacheKey, String(now.getTime()), 60);
    return result;
  } catch (error) {
    logError_('syncTfgTourRacks_', error);
    return {ok: false, error: String(error && error.message || error)};
  } finally { lock.releaseLock(); }
}

function readTfgTourRackRequests_(now) {
  const sheet = SpreadsheetApp.openById(TFG_TOUR_RACK_SYNC_.spreadsheetId).getSheetByName(TFG_TOUR_RACK_SYNC_.sheetName);
  if (!sheet || sheet.getLastRow() < 1) throw new Error('見学予約の参照シートを確認できません。');
  const values = sheet.getRange(1, 1, sheet.getLastRow(), sheet.getLastColumn()).getValues();
  return buildTfgTourRackRequests_(values, now);
}

function buildTfgTourRackRequests_(values, now) {
  const headers = values[0].map(function(value) { return String(value).trim(); });
  const required = ['reservation_id', 'service_code', 'store_code', 'reservation_date', 'start_time', 'status', 'note'];
  const columns = {};
  required.forEach(function(name) {
    if (headers.indexOf(name) < 0 || headers.indexOf(name) !== headers.lastIndexOf(name)) throw new Error('見学予約の列を確認できません: ' + name);
    columns[name] = headers.indexOf(name);
  });
  const requests = Object.create(null);
  values.slice(1).forEach(function(row) {
    const value = function(name) { return row[columns[name]]; };
    if (String(value('service_code')).trim() !== 'TOUR' || String(value('store_code')).trim() !== 'YACHIYO') return;
    if (['RESERVED', 'CONFIRMED'].indexOf(String(value('status')).trim()) < 0) return;
    const id = String(value('reservation_id') || '').trim();
    if (!id) throw new Error('見学予約IDがありません。');
    const date = tfgTourRackDate_(value('reservation_date'));
    const time = tfgTourRackTime_(value('start_time'));
    const tourStart = new Date(date + 'T' + time + ':00+09:00');
    if (!Number.isFinite(tourStart.getTime()) || Utilities.formatDate(tourStart, CONFIG.timezone, 'yyyy-MM-dd HH:mm') !== date + ' ' + time) throw new Error('見学日時が不正です: ' + id);
    const size = tfgTourRackPartySize_(value('note'));
    const start = new Date(tourStart.getTime() + 30 * 60000);
    const end = new Date(start.getTime() + (size === 2 ? 40 : 30) * 60000);
    if (end <= now || start.getTime() > now.getTime() + 33 * 86400000) return;
    if (requests[id]) throw new Error('見学予約IDが重複しています: ' + id);
    requests[id] = {id: id, start: start, end: end, partySize: size, signature: start.toISOString() + '/' + end.toISOString()};
  });
  return requests;
}

function tfgTourRackPartySize_(note) {
  const text = String(note || '');
  const marker = '\nTFG_TOUR_DATA:';
  const index = text.lastIndexOf(marker);
  if (index >= 0) {
    const data = JSON.parse(text.slice(index + marker.length));
    if (!Array.isArray(data.guests) || (data.guests.length !== 1 && data.guests.length !== 2)) throw new Error('見学人数を確認できません。');
    return data.guests.length;
  }
  const match = text.match(/見学人数[：:]\s*([12])\s*名/);
  return match ? Number(match[1]) : 1;
}

function tfgTourRackDate_(value) {
  if (value instanceof Date) return Utilities.formatDate(value, CONFIG.timezone, 'yyyy-MM-dd');
  const match = String(value || '').trim().match(/^(\d{4})[-/](\d{1,2})[-/](\d{1,2})(?:$|[ T])/);
  if (!match) throw new Error('見学予約の日付が不正です。');
  return match[1] + '-' + match[2].padStart(2, '0') + '-' + match[3].padStart(2, '0');
}

function tfgTourRackTime_(value) {
  if (value instanceof Date) return Utilities.formatDate(value, CONFIG.timezone, 'HH:mm');
  const match = String(value || '').trim().match(/^(\d{1,2}):(\d{2})(?::\d{2})?$/);
  if (!match || Number(match[1]) > 23 || Number(match[2]) > 59) throw new Error('見学予約の開始時刻が不正です。');
  return match[1].padStart(2, '0') + ':' + match[2];
}

/** Caller holds the same script lock used by rack bookings and checkouts. */
function syncTfgTourRacksUnlocked_(now) {
  // Validate the complete source snapshot and all four calendars before changing any hold.
  const personalRequests = readTfgPersonalRackRequests_(now);
  const requests = readTfgTourRackRequests_(now);
  const from = new Date(now.getTime() - 2 * 86400000);
  const to = new Date(now.getTime() + 35 * 86400000);
  const racks = getRackPriorityForTour_().map(function(info) {
    const calendar = CalendarApp.getCalendarById(info.id);
    if (!calendar) throw new Error('ラックカレンダーを参照できません: ' + info.label);
    return {info: info, calendar: calendar, events: calendar.getEvents(from, to)};
  });
  if (racks.length !== 4) throw new Error('見学用ラック4台の設定を確認できません。');
  const existing = Object.create(null);
  const result = {ok: true, reservations: Object.keys(requests).length, created: 0, adopted: 0, released: 0, retained: 0, pending: []};
  racks.forEach(function(rack) {
    rack.events.forEach(function(event) {
      const taggedId = event.getTag(TFG_TOUR_RACK_SYNC_.reservationTag);
      const id = taggedId || tfgTourRackLegacyId_(event);
      if (!id) return;
      const request = requests[id];
      const signature = taggedId ? event.getTag(TFG_TOUR_RACK_SYNC_.slotTag) : event.getStartTime().toISOString() + '/' + event.getEndTime().toISOString();
      let sameSlot = request && signature === request.signature;
      const completed = taggedId && parseAdminBookingDescription_(event.getDescription() || '').CHECKOUT === 'true';
      if (sameSlot && !completed) {
        const conflicts = rack.calendar.getEvents(request.start, request.end).filter(function(other) {
          if (other.getId() === event.getId()) return false;
          const otherId = other.getTag(TFG_TOUR_RACK_SYNC_.reservationTag) || tfgTourRackLegacyId_(other);
          return otherId !== id && other.getStartTime() < request.end && other.getEndTime() > request.start;
        });
        if (conflicts.length) sameSlot = false;
      }
      if (sameSlot && !existing[id]) {
        // A tablet checkout shortens the event but retains its original slot tag.
        if (!taggedId) {
          event.setTag(TFG_TOUR_RACK_SYNC_.reservationTag, id);
          event.setTag(TFG_TOUR_RACK_SYNC_.slotTag, request.signature);
          result.adopted++;
        }
        ensureTfgTourRackMetadata_(event, rack.info);
        existing[id] = event;
        result.retained++;
      } else if (event.getEndTime() > now) {
        event.deleteEvent();
        result.released++;
      }
    });
  });
  Object.keys(requests).sort(function(a, b) { return requests[a].start - requests[b].start || a.localeCompare(b); }).forEach(function(id) {
    const request = requests[id];
    if (existing[id]) return;
    let chosen = null;
    for (let i = 0; i < racks.length; i++) {
      const rack = racks[i];
      const conflicts = rack.calendar.getEvents(request.start, request.end).filter(function(event) {
        return event.getStartTime() < request.end && event.getEndTime() > request.start;
      });
      if (!conflicts.length) { chosen = rack; break; }
    }
    if (!chosen) { result.pending.push(id); return; }
    const description = buildAdminBookingDescription_({
      BOOKING_TYPE: 'tour', ADMIN_TOKEN: Utilities.getUuid(), RACK: chosen.info.label,
      CHECKIN: 'true', CHECKOUT: 'false'
    });
    const event = chosen.calendar.createEvent('店内見学', request.start, request.end, {description: description});
    try {
      event.setTag(TFG_TOUR_RACK_SYNC_.reservationTag, id);
      event.setTag(TFG_TOUR_RACK_SYNC_.slotTag, request.signature);
    } catch (error) {
      event.deleteEvent();
      throw error;
    }
    result.created++;
  });
  result.personal = syncTfgPersonalRacksUnlocked_(now, personalRequests, racks);
  if (result.created || result.adopted || result.released || result.pending.length || result.personal.created || result.personal.adopted || result.personal.released || result.personal.pending.length) console.log(JSON.stringify(result));
  return result;
}

/** Adopt prior OS-created rack holds only when their title and source identity both match. */
function tfgTourRackLegacyId_(event) {
  if (String(event.getTitle() || '').trim() !== '店内見学') return '';
  const description = String(event.getDescription() || '');
  if (!/^A-nauts OS Reserve\s*\n/.test(description) || !/^service_code:\s*TOUR\s*$/m.test(description)) return '';
  const match = description.match(/^reservation_id:\s*(RSV[A-Za-z0-9-]+)\s*$/m);
  return match ? match[1] : '';
}

function ensureTfgTourRackMetadata_(event, rack) {
  const meta = parseAdminBookingDescription_(event.getDescription() || '');
  if (meta.BOOKING_TYPE === 'tour' && meta.CHECKIN === 'true') return;
  event.setDescription(buildAdminBookingDescription_({
    BOOKING_TYPE: 'tour', ADMIN_TOKEN: meta.ADMIN_TOKEN || Utilities.getUuid(), RACK: rack.label,
    CHECKIN: 'true', CHECKOUT: meta.CHECKOUT === 'true' ? 'true' : 'false'
  }));
}

/** Preserve the existing public API while serializing immediate use with tour holds. */
function checkInNow(params) {
  syncTfgTourRacksIfDue_(false);
  const lock = LockService.getScriptLock();
  try {
    lock.waitLock(10000);
    return checkInNowWithoutTourSync_(params);
  } catch (error) {
    logError_('checkInNow', error);
    return {ok: false, message: 'チェックイン処理中にエラーが発生しました。'};
  } finally { lock.releaseLock(); }
}
