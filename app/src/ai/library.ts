// AI command layer — the part library as the AI sees it: top matches only, never the whole library.
import Fuse from 'fuse.js';
import * as S from '../store';
import { STD } from '../symbols';
import { geomOf } from '../designer/geom';
import { fieldsFor, defaults } from '../designer/fields';
import { normRef, partGeom, portLabel, fmtValue, aiUnit } from './core';

type Entry = { ref: string; name: string; domain: string; category: string; cls: string; tags: string[] };
function entries(): Entry[] {
  const std = [...STD, ...S.stdValveItems.value].filter((x: any) => x.domain !== 'electrical')
    .map((x: any) => ({ ref: 'std:' + x.id, name: x.name, domain: x.domain, category: x.category, cls: x.cls, tags: x.tags || [] }));
  const lib = S.customLib.value.filter((it: any) => (it.definition?.domain || it.domain) !== 'electrical')
    .map((it: any) => ({ ref: 'lib:' + it.item_id, name: it.name || it.definition?.name || it.item_id, domain: it.definition?.domain || it.domain || '', category: 'Custom', cls: it.type || '', tags: it.tags || [] }));
  return [...std, ...lib];
}
const brief = (e: Entry) => { const g = geomOf(e.ref); return { ref: e.ref, name: e.name, domain: e.domain, letter: g.letter, ports: g.ports.map(p => portLabel(g, p)) }; };

export function searchLibrary(query: string, o: { domain?: string; category?: string; limit?: number } = {}) {
  let all = entries();
  if (o.domain) all = all.filter(e => e.domain === o.domain);
  if (o.category) { const c = o.category.toLowerCase(); all = all.filter(e => e.category.toLowerCase().includes(c) || e.cls.toLowerCase() === c); }
  const lim = Math.max(1, Math.min(25, o.limit || 8));
  const q = (query || '').trim();
  // ranking: entries holding every query word first (more of them in the name, then base library order — the plain
  // part before its variants), then fuzzy matches for typos
  let hits: Entry[] = all;
  if (q) {
    const toks = q.toLowerCase().split(/[\s,;/]+/).filter(Boolean);
    const hay = (e: Entry) => `${e.name} ${e.tags.join(' ')} ${e.category} ${e.cls} ${e.ref}`.toLowerCase();
    const words = all.map((e, i) => ({ e, i, inName: toks.filter(t => e.name.toLowerCase().includes(t)).length })).filter(x => toks.every(t => hay(x.e).includes(t)))
      .sort((a, b) => b.inName - a.inName || a.i - b.i).map(x => x.e);
    const seen = new Set(words.map(e => e.ref));
    const fuzzy = new Fuse(all, { keys: ['name', 'tags', 'category', 'cls', 'ref'], threshold: 0.4, ignoreLocation: true }).search(q).map(r => r.item).filter(e => !seen.has(e.ref));
    hits = [...words, ...fuzzy];
  }
  return { total: hits.length, items: hits.slice(0, lim).map(brief) };
}

export function describePart(ref: string) {
  const r = normRef(ref); const g = partGeom(r); const d = defaults(g);
  return { ref: r, name: g.name, domain: g.domain, cls: g.cls, letter: g.letter, standard: g.standard,
    ports: g.ports.map(p => ({ name: portLabel(g, p), role: p.role, domain: p.domain })),
    values: fieldsFor(g).filter(f => f.qty !== 'table').map(f => ({ key: f.key, label: f.label, ...(aiUnit(f) ? { unit: aiUnit(f) } : {}), default: fmtValue(f, d[f.key]), ...(f.options ? { options: f.options } : {}), ...(f.sim ? { sim: true } : {}) })) };
}
