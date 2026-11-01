// Build Arriba's compact corridor dataset from an NJ Transit GTFS feed (zip or folder).
// Pure functions; scripts/build-gtfs.mjs handles files. No route tables are typed by hand.

/** RFC 4180 CSV to array of objects. Handles BOM, quotes, embedded commas/newlines, CRLF. */
export function parseCsv(text) {
  if (text.charCodeAt(0) === 0xfeff) text = text.slice(1);
  const rows = [];
  let row = [];
  let field = '';
  let q = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (q) {
      if (c === '"') {
        if (text[i + 1] === '"') { field += '"'; i++; } else q = false;
      } else field += c;
    } else if (c === '"') q = true;
    else if (c === ',') { row.push(field); field = ''; }
    else if (c === '\n' || c === '\r') {
      if (c === '\r' && text[i + 1] === '\n') i++;
      row.push(field); field = '';
      if (row.length > 1 || row[0] !== '') rows.push(row);
      row = [];
    } else field += c;
  }
  if (field !== '' || row.length) { row.push(field); rows.push(row); }
  const [header, ...body] = rows;
  if (!header) return [];
  const keys = header.map((h) => h.trim());
  return body.map((r) => Object.fromEntries(keys.map((k, i) => [k, (r[i] ?? '').trim()])));
}

/**
 * Keep only lines whose `column` value is in `keep`, before full parsing. stop_times.txt is the
 * largest file (millions of rows); filtering first keeps memory to the corridor's share.
 * Lines containing quotes fall back to the full parser for that line.
 */
export function filterCsvByColumn(text, column, keep) {
  if (text.charCodeAt(0) === 0xfeff) text = text.slice(1);
  const nl = text.indexOf('\n');
  const header = (nl < 0 ? text : text.slice(0, nl)).replace(/\r$/, '');
  const idx = header.split(',').map((h) => h.trim().replace(/^"|"$/g, '')).indexOf(column);
  if (idx < 0) throw new Error(`column ${column} not found`);
  const out = [header];
  let start = nl + 1;
  while (nl >= 0 && start < text.length) {
    let end = text.indexOf('\n', start);
    if (end < 0) end = text.length;
    const line = text.slice(start, end).replace(/\r$/, '');
    start = end + 1;
    if (!line) continue;
    const value = line.includes('"') ? Object.values(parseCsv(`${header}\n${line}`)[0] ?? {})[idx] : line.split(',')[idx];
    if (keep.has((value ?? '').trim())) out.push(line);
  }
  return out.join('\n');
}

export function parseGtfsTime(s) {
  if (!s) return undefined;
  const [h, m, sec] = s.split(':').map(Number);
  return h * 3600 + m * 60 + (sec || 0);
}

/**
 * Fill blank intermediate times linearly between known ones (GTFS allows blanks at non-timepoints).
 * A filled value is Arriba's estimate, not NJ Transit data: buildDataset records those indices in
 * trip.estimated so the app labels them (NJ Transit's terms require using the data as-is).
 */
export function interpolate(times) {
  const out = [...times];
  let last = -1;
  for (let i = 0; i < out.length; i++) {
    if (out[i] === undefined) continue;
    if (last >= 0 && i - last > 1) {
      for (let k = last + 1; k < i; k++) out[k] = Math.round(out[last] + ((out[i] - out[last]) * (k - last)) / (i - last));
    }
    last = i;
  }
  if (out[0] === undefined || out[out.length - 1] === undefined) throw new Error('trip has no first or last time');
  return out;
}

/**
 * files: { [name]: string } with routes.txt, stops.txt, trips.txt, stop_times.txt and calendar.txt and/or calendar_dates.txt.
 * routeShortNames: which routes to include (the corridor).
 */
export function buildDataset(files, { routeShortNames, feedVersion = 'unknown', builtAt = new Date().toISOString(), source = 'NJ Transit GTFS' }) {
  const need = (n) => {
    if (files[n] === undefined) throw new Error(`missing ${n}`);
    return parseCsv(files[n]);
  };
  const agency = files['agency.txt'] ? parseCsv(files['agency.txt']) : [];
  const timezone = agency[0]?.agency_timezone || 'America/New_York';
  const wanted = new Set(routeShortNames.map((s) => s.toUpperCase()));
  const routes = need('routes.txt').filter((r) => wanted.has((r.route_short_name || '').toUpperCase()));
  if (!routes.length) throw new Error(`none of ${routeShortNames.join(', ')} found in routes.txt`);
  const routeIds = new Set(routes.map((r) => r.route_id));
  const trips = need('trips.txt').filter((t) => routeIds.has(t.route_id));
  const tripIds = new Set(trips.map((t) => t.trip_id));

  const byTrip = new Map();
  if (files['stop_times.txt'] === undefined) throw new Error('missing stop_times.txt');
  for (const st of parseCsv(filterCsvByColumn(files['stop_times.txt'], 'trip_id', tripIds))) {
    let a = byTrip.get(st.trip_id);
    if (!a) byTrip.set(st.trip_id, (a = []));
    a.push(st);
  }

  const patterns = new Map();
  const outTrips = [];
  const usedStops = new Set();
  const usedServices = new Set();
  for (const t of trips) {
    const sts = (byTrip.get(t.trip_id) || []).sort((x, y) => Number(x.stop_sequence) - Number(y.stop_sequence));
    if (sts.length < 2) continue;
    const stopIds = sts.map((s) => s.stop_id);
    const dir = t.direction_id === '1' ? 1 : 0;
    const headsign = t.trip_headsign || sts[sts.length - 1].stop_headsign || '';
    const key = `${t.route_id}|${dir}|${headsign}|${stopIds.join('>')}`;
    let p = patterns.get(key);
    if (!p) {
      p = { id: `P${patterns.size + 1}`, routeId: t.route_id, directionId: dir, headsign, stopIds };
      patterns.set(key, p);
    }
    const given = sts.map((s) => parseGtfsTime(s.departure_time || s.arrival_time));
    const trip = { id: t.trip_id, patternId: p.id, serviceId: t.service_id, times: interpolate(given) };
    const estimated = given.flatMap((v, i) => (v === undefined ? [i] : []));
    if (estimated.length) trip.estimated = estimated;
    outTrips.push(trip);
    stopIds.forEach((s) => usedStops.add(s));
    usedServices.add(t.service_id);
  }

  const calendars = {};
  for (const c of files['calendar.txt'] ? parseCsv(files['calendar.txt']) : []) {
    if (!usedServices.has(c.service_id)) continue;
    const d = ['monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday', 'sunday'].map((k) => c[k] === '1');
    calendars[c.service_id] = { days: d, start: c.start_date, end: c.end_date, added: [], removed: [] };
  }
  for (const cd of files['calendar_dates.txt'] ? parseCsv(files['calendar_dates.txt']) : []) {
    if (!usedServices.has(cd.service_id)) continue;
    const cal = (calendars[cd.service_id] ??= { days: [false, false, false, false, false, false, false], start: '99999999', end: '00000000', added: [], removed: [] });
    (cd.exception_type === '2' ? cal.removed : cal.added).push(cd.date);
  }
  for (const cal of Object.values(calendars)) {
    cal.added.sort();
    cal.removed.sort();
  }

  const stops = need('stops.txt')
    .filter((s) => usedStops.has(s.stop_id))
    .map((s) => {
      const o = { id: s.stop_id, name: s.stop_name, lat: Number(s.stop_lat), lon: Number(s.stop_lon) };
      if (s.stop_code) o.code = s.stop_code;
      if (/PORT AUTHORITY/i.test(s.stop_name)) o.terminal = 'PABT';
      return o;
    });

  return {
    meta: { demo: false, source, feedVersion, builtAt, timezone },
    routes: routes.map((r) => {
      const o = { id: r.route_id, shortName: r.route_short_name, longName: r.route_long_name || '' };
      if (r.route_color) o.color = r.route_color;
      return o;
    }),
    stops,
    patterns: [...patterns.values()],
    trips: outTrips,
    calendars,
  };
}
