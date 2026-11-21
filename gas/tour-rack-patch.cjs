/** Surgical patch for the existing rack project Code.gs, preserving unrelated functions. */
function patchTourRackSource(source) {
  function once(before, after) {
    if (source.split(before).length !== 2) throw new Error('Rack source changed: ' + before.slice(0, 90));
    source = source.replace(before, after);
  }
  once('    // ★JSON API（一覧）', "    if (action === 'getracktabletjson' || action === 'getscheduletabletjson') syncTfgTourRacksIfDue_(false);\n\n    // ★JSON API（一覧）");
  once("function getRackPriorityForTour_() {\n  return [\n    findRackByLabel_('ラック№4'),\n    findRackByLabel_('ラック№3'),\n    findRackByLabel_('ラック№2'),\n    findRackByLabel_('ラック№1')", "function getRackPriorityForTour_() {\n  return [\n    findRackByLabel_('ラック№2'),\n    findRackByLabel_('ラック№3'),\n    findRackByLabel_('ラック№4'),\n    findRackByLabel_('ラック№1')");
  const start = source.indexOf('function getDisplayNameForTablet_(event) {');
  const end = source.indexOf('function getQueueDisplayName_', start);
  if (start < 0 || end < 0) throw new Error('Tablet name function missing');
  const oldName = source.slice(start, end);
  if (oldName.split("return '見学';").length !== 3) throw new Error('Tour display labels changed');
  once(oldName, oldName.replaceAll("return '見学';", "return '店内見学';"));
  once("('状況：' + currentDisplayName + 'さん')", "('状況：' + formatDisplayNameWithSan_(currentDisplayName))");
  once('function checkInNow(params) {', 'function checkInNowWithoutTourSync_(params) {');
  for (const name of ['reserveSelectedSlot', 'reservePersonalSlot', 'reserveTourSlot']) {
    once('function ' + name + '(payload) {\n  const lock', 'function ' + name + '(payload) {\n  syncTfgTourRacksIfDue_(false);\n  const lock');
  }
  once('function registerQueue(payload) {', 'function registerQueue(payload) {\n  syncTfgTourRacksIfDue_(false);');
  once('function registerAutoSelectedQueue(data) {', 'function registerAutoSelectedQueue(data) {\n  syncTfgTourRacksIfDue_(false);');
  return source;
}
module.exports = {patchTourRackSource};
