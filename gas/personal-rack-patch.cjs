/** Patch only the existing display labels and manual personal rack selector. */
function patchPersonalRackSource(source) {
  const nameStart = source.indexOf('function getDisplayNameForTablet_(event) {');
  const nameEnd = source.indexOf('function getQueueDisplayName_', nameStart);
  if (nameStart < 0 || nameEnd < 0) throw new Error('Tablet display function missing');
  const oldName = source.slice(nameStart, nameEnd);
  if (oldName.split("return 'PERSONAL';").length !== 3) throw new Error('Personal display labels changed');
  source = source.slice(0, nameStart) + oldName.replaceAll("return 'PERSONAL';", "return 'パーソナル';") + source.slice(nameEnd);
  const status = "? ('状況：' + currentDisplayName + 'さん')";
  if (source.split(status).length !== 2) throw new Error('Native tablet status label changed');
  source = source.replace(status, "? ('状況：' + currentDisplayName + (currentDisplayName === 'パーソナル' ? '' : 'さん'))");
  if (source.split("label = 'PERSONAL';").length !== 2) throw new Error('Tablet schedule label changed');
  source = source.replace("label = 'PERSONAL';", "label = 'パーソナル';");
  const honorific = 'if (text.indexOf("PERSONAL") !== -1 || text.indexOf("店内見学") !== -1) {';
  if (source.split(honorific).length !== 2) throw new Error('Shared tablet name formatter changed');
  source = source.replace(honorific, 'if (text === "パーソナル" || text.indexOf("PERSONAL") !== -1 || text.indexOf("店内見学") !== -1) {');
  const start = source.indexOf('function findAssignableRackForPersonal_(start, end) {');
  const end = source.indexOf('\nfunction ', start + 1);
  if (start < 0 || end < 0 || !source.slice(start, end).includes('previousPersonalRackId')) throw new Error('Personal selector changed');
  return source.slice(0, start) + 'function findAssignableRackForPersonal_(start, end) {\n  return findTfgPersonalRack_(start, end);\n}\n' + source.slice(end);
}

function patchPersonalRackTablet(html) {
  if (html.includes('function rackTabletName(')) throw new Error('Personal tablet labels already patched');
  const start = html.indexOf('function extractCurrentName(data){');
  if (start < 0) throw new Error('Tablet name helper missing');
  html = html.slice(0, start) + 'function rackTabletName(name){\n  return name ? (name === "パーソナル" ? name : name + "さん") : "";\n}\n\n' + html.slice(start);
  if (html.split('nextName + "さん"').length !== 6 || html.split('currentName + "さんが利用中"').length !== 2 || html.split('currentName + "さん"').length !== 2) throw new Error('Tablet name labels changed');
  return html.replaceAll('nextName + "さん"', 'rackTabletName(nextName)').replaceAll('currentName + "さんが利用中"', 'rackTabletName(currentName) + "が利用中"').replaceAll('currentName + "さん"', 'rackTabletName(currentName)');
}
module.exports = {patchPersonalRackSource, patchPersonalRackTablet};
