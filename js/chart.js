// =====================================================================
//  The growth chart
// =====================================================================
//  Drawn by hand as an SVG picture (no chart library to download).
//  A page puts a placeholder where the chart goes:
//      <div data-chart="weight" data-dogs="<dog id>,<dog id>"></div>
//  and mountWeightCharts() draws into it at the right width.
//
//  - One line per dog, in the dog's collar color. Sunny's points are
//    circles and Chomper's are squares, so they're told apart without
//    relying on color.
//  - A thin gray line marks the top of the dog's current Heartgard /
//    NexGard size when the dog is getting close to it.
//  - Touch or hover anywhere on the chart to read the weights for the
//    nearest date. The list under the chart has every number too.
// =====================================================================

import * as L from './logic.js';
import { state, dogById, shortName } from './store.js';
import { esc } from './ui.js';

// Chart colors are deeper versions of the collar colors (set in
// css/app.css as --chart-yellow and so on), so the two lines stay easy
// to tell apart on a white or dark background.
function lineColor(dog) {
  const collar = (dog.collar_color || '').toLowerCase();
  return `var(--chart-${collar}, var(--muted))`;
}

// First dog in the list gets circles, the next squares, then diamonds.
const SHAPES = ['circle', 'square', 'diamond'];
function shapeFor(dog) {
  const i = L.sortedDogs(state.data.dogs).findIndex((d) => d.id === dog.id);
  return SHAPES[i % SHAPES.length];
}

// A marker: an 8px dot or square with a ring in the card color, so
// points stay clear where lines cross.
function marker(shape, x, y, color, r = 4.5) {
  const ring = `stroke="var(--surface)" stroke-width="2" fill="${color}"`;
  if (shape === 'square') return `<rect x="${x - r}" y="${y - r}" width="${2 * r}" height="${2 * r}" rx="1.5" ${ring}/>`;
  if (shape === 'diamond') return `<path d="M${x} ${y - r - 1}L${x + r + 1} ${y}L${x} ${y + r + 1}L${x - r - 1} ${y}Z" ${ring}/>`;
  return `<circle cx="${x}" cy="${y}" r="${r}" ${ring}/>`;
}

// A small sample of the marker for legends and the touch readout.
export function keySwatch(dog) {
  return `<svg class="key" width="22" height="12" aria-hidden="true">
    <line x1="1" y1="6" x2="21" y2="6" stroke="${lineColor(dog)}" stroke-width="2" stroke-linecap="round"/>
    ${marker(shapeFor(dog), 11, 6, lineColor(dog), 3.5)}</svg>`;
}

export function mountWeightCharts() {
  document.querySelectorAll('[data-chart="weight"]').forEach(drawWeightChart);
}

// Round numbers for the side of the chart: 5, 10, 20 ...
function niceStep(range) {
  for (const step of [1, 2, 5, 10, 20, 25, 50, 100]) if (range / step <= 5) return step;
  return 200;
}

function drawWeightChart(box) {
  const { data, today } = state;
  const dogs = box.dataset.dogs.split(',').map(dogById).filter(Boolean);
  const series = dogs
    .map((dog) => ({ dog, color: lineColor(dog), shape: shapeFor(dog),
      points: L.weightsFor(data.weights, dog.id).map((w) => ({ date: w.date, lbs: Number(w.weight_lbs) })) }))
    .filter((s) => s.points.length);
  if (series.length === 0) {
    box.innerHTML = '<p class="muted">No weights logged yet.</p>';
    return;
  }

  // Size limits worth showing: the top of each dog's current size, if
  // the dog is within 15 lb of it. Shared limits are drawn once.
  const limits = new Map();
  const allLbs = series.flatMap((s) => s.points.map((p) => p.lbs));
  for (const s of series) {
    for (const t of data.treatments.filter((t) => t.active)) {
      const check = L.sizeCheck(data, s.dog, t, today);
      if (check && check.band.max_lbs - check.lbs <= 15) {
        limits.set(`${t.id}|${check.band.max_lbs}`, { lbs: check.band.max_lbs, text: `${t.name} ${check.band.label}: up to ${check.band.max_lbs} lb` });
      }
    }
  }

  // Sizes and scales. Up and down (pounds) first ...
  const width = Math.max(280, box.clientWidth);
  const height = width < 500 ? 220 : 280;
  const pad = { left: 34, right: 14, top: 18, bottom: 26 };
  const plotH = height - pad.top - pad.bottom;

  const limitLbs = [...limits.values()].map((l) => l.lbs);
  let y0 = Math.min(...allLbs) - 2, y1 = Math.max(...allLbs, ...limitLbs) + 2;
  const step = niceStep(y1 - y0);
  y0 = Math.max(0, Math.floor(y0 / step) * step);
  y1 = Math.ceil(y1 / step) * step;
  const yOf = (lbs) => pad.top + (1 - (lbs - y0) / (y1 - y0)) * plotH;

  // ... names at the line ends, only when they don't bump into each
  // other (the legend above the chart always says who is who). They
  // need room on the right ...
  const ends = series.map((s) => ({ s, last: s.points[s.points.length - 1] }));
  const endYs = ends.map((e) => yOf(e.last.lbs)).sort((a, b) => a - b);
  const showEndNames = series.length > 1 && endYs.every((y, i) => i === 0 || y - endYs[i - 1] >= 14);
  if (showEndNames) pad.right = 72;
  const plotW = width - pad.left - pad.right;

  // ... then across (dates).
  const dayNums = series.flatMap((s) => s.points.map((p) => L.daysBetween('2000-01-01', p.date)));
  let x0 = Math.min(...dayNums), x1 = Math.max(...dayNums);
  if (x1 - x0 < 14) { x0 -= 7; x1 += 7; }
  const xPad = (x1 - x0) * 0.04;
  x0 -= xPad; x1 += xPad;

  const xOf = (date) => pad.left + ((L.daysBetween('2000-01-01', date) - x0) / (x1 - x0)) * plotW;

  // Background lines and labels. A background line right next to a
  // size-limit line is left out, so the two don't read as one.
  let svg = '';
  const limitYs = limitLbs.map(yOf);
  for (let v = y0; v <= y1 + 0.001; v += step) {
    const y = yOf(v);
    if (!limitYs.some((ly) => Math.abs(ly - y) < 8)) {
      svg += `<line class="grid" x1="${pad.left}" x2="${width - pad.right}" y1="${y}" y2="${y}"/>`;
    }
    svg += `<text class="tick" x="${pad.left - 6}" y="${y + 4}" text-anchor="end">${v}</text>`;
  }
  const tickCount = width < 500 ? 3 : 5;
  for (let i = 0; i < tickCount; i++) {
    const dayNum = Math.round(x0 + xPad + ((x1 - x0 - 2 * xPad) * i) / (tickCount - 1));
    const date = L.addDays('2000-01-01', dayNum);
    const anchor = i === 0 ? 'start' : i === tickCount - 1 ? 'end' : 'middle';
    svg += `<text class="tick" x="${xOf(date)}" y="${height - 6}" text-anchor="${anchor}">${esc(L.formatDate(date, { short: true, today }))}</text>`;
  }

  // Size limits
  for (const limit of limits.values()) {
    const y = yOf(limit.lbs);
    svg += `<line class="limit" x1="${pad.left}" x2="${width - pad.right}" y1="${y}" y2="${y}"/>`;
    svg += `<text class="limit-text" x="${width - pad.right}" y="${y - 5}" text-anchor="end">${esc(limit.text)}</text>`;
  }

  // The lines and points
  for (const s of series) {
    const path = s.points.map((p, i) => `${i ? 'L' : 'M'}${xOf(p.date).toFixed(1)} ${yOf(p.lbs).toFixed(1)}`).join('');
    svg += `<path d="${path}" fill="none" stroke="${s.color}" stroke-width="2" stroke-linejoin="round" stroke-linecap="round"/>`;
    svg += s.points.map((p) => marker(s.shape, xOf(p.date), yOf(p.lbs), s.color)).join('');
  }

  if (showEndNames) {
    for (const e of ends) {
      svg += `<text class="end-label" x="${xOf(e.last.date) + 8}" y="${yOf(e.last.lbs) + 4}">${esc(shortName(e.s.dog))} ${e.last.lbs}</text>`;
    }
  }

  // The touch/hover layer: a hairline that snaps to the nearest date.
  svg += `<line class="crosshair" y1="${pad.top}" y2="${pad.top + plotH}" x1="0" x2="0" visibility="hidden"/>`;
  svg += `<rect class="hit" x="0" y="0" width="${width}" height="${height}" fill="transparent"/>`;

  const summary = series.map((s) => {
    const first = s.points[0], last = s.points[s.points.length - 1];
    return `${shortName(s.dog)} went from ${first.lbs} lb on ${L.formatDate(first.date)} to ${last.lbs} lb on ${L.formatDate(last.date)}`;
  }).join('. ');
  const legend = series.length > 1
    ? `<div class="chart-legend">${series.map((s) => `<span>${keySwatch(s.dog)}${esc(shortName(s.dog))}</span>`).join('')}</div>` : '';

  box.innerHTML = `${legend}
    <div class="chart-frame">
      <svg width="${width}" height="${height}" viewBox="0 0 ${width} ${height}" role="img" tabindex="0"
        aria-label="Weight chart. ${esc(summary)}.">${svg}</svg>
      <div class="chart-tip" hidden></div>
    </div>`;
  wireHover(box, series, xOf);
}

// Shows the weights for the date nearest the finger or pointer.
// Arrow keys step through the dates when the chart has keyboard focus.
function wireHover(box, series, xOf) {
  const svgEl = box.querySelector('svg');
  const hair = box.querySelector('.crosshair');
  const tip = box.querySelector('.chart-tip');
  const dates = [...new Set(series.flatMap((s) => s.points.map((p) => p.date)))].sort();
  let current = dates.length - 1;

  const show = (i) => {
    current = i;
    const date = dates[i];
    const x = xOf(date);
    hair.setAttribute('x1', x);
    hair.setAttribute('x2', x);
    hair.setAttribute('visibility', 'visible');

    // Built with textContent: names and numbers can't be read as page code.
    tip.replaceChildren();
    const head = document.createElement('div');
    head.className = 'tip-date';
    head.textContent = L.formatDate(date);
    tip.append(head);
    for (const s of series) {
      const point = s.points.find((p) => p.date === date);
      if (!point) continue;
      const row = document.createElement('div');
      row.className = 'tip-row';
      row.innerHTML = keySwatch(s.dog);   // the swatch is built from fixed values
      const value = document.createElement('strong');
      value.textContent = `${point.lbs} lb`;
      const name = document.createElement('span');
      name.textContent = shortName(s.dog);
      row.append(value, name);
      tip.append(row);
    }
    tip.hidden = false;
    const tipW = tip.offsetWidth;
    const frameW = svgEl.getBoundingClientRect().width;
    const left = Math.max(0, Math.min(x - tipW / 2, frameW - tipW));
    tip.style.left = `${left}px`;
  };
  const hide = () => {
    hair.setAttribute('visibility', 'hidden');
    tip.hidden = true;
  };
  const nearest = (event) => {
    const rect = svgEl.getBoundingClientRect();
    const px = event.clientX - rect.left;
    let best = 0;
    dates.forEach((d, i) => { if (Math.abs(xOf(d) - px) < Math.abs(xOf(dates[best]) - px)) best = i; });
    return best;
  };

  const hit = box.querySelector('.hit');
  hit.addEventListener('pointermove', (e) => show(nearest(e)));
  hit.addEventListener('pointerdown', (e) => show(nearest(e)));
  hit.addEventListener('pointerleave', (e) => { if (e.pointerType === 'mouse') hide(); });
  svgEl.addEventListener('focus', () => show(current));
  svgEl.addEventListener('blur', hide);
  svgEl.addEventListener('keydown', (e) => {
    if (e.key === 'ArrowLeft' && current > 0) { e.preventDefault(); show(current - 1); }
    if (e.key === 'ArrowRight' && current < dates.length - 1) { e.preventDefault(); show(current + 1); }
  });
}
