// Ghost preview: the open AI plan drawn faded over the sheet until Apply. Draw-only — it takes no pointer events and
// changes nothing; the Circuit Designer canvas just renders this layer (one line in Canvas.tsx).
import { h } from 'preact';
import { sheetBody } from '../designer/render';
import { livePts, ptsD, type Sheet } from '../designer/model';
import { xfBB, geomOf } from '../designer/geom';
import { fmtQ } from '../designer/state';
import { ghostOf } from './plans';

const GONE = '#C2410C', ADD = '#0A64C2';
export function AiGhost({ sheetId }: { sheetId: string }) {
  const g = ghostOf(sheetId); if (!g) return null;
  const mini = { ...g.sheet, components: g.comps, pipes: g.pipes, junctions: g.juncs, texts: [], enclosures: [] } as Sheet;
  const body = sheetBody(mini, { fmt: fmtQ, layers: false });
  return <g class="ai-ghost" data-plan={g.plan.id} pointer-events="none">
    <g class="ai-ghost-add" opacity=".42" dangerouslySetInnerHTML={{ __html: body }} />
    {g.comps.map(c => { const b = xfBB(c, geomOf(c.ref).bb); return <rect class="ai-ghost-part" data-tag={c.tag} x={b[0] - 1.5} y={b[1] - 1.5} width={b[2] - b[0] + 3} height={b[3] - b[1] + 3} fill="none" stroke={ADD} stroke-width=".3" stroke-dasharray="1.6 1.2" opacity=".7" />; })}
    {g.goneComps.map(({ c, g: gg }) => { const b = xfBB(c, gg.bb); return <rect class="ai-ghost-gone" x={b[0] - 1.5} y={b[1] - 1.5} width={b[2] - b[0] + 3} height={b[3] - b[1] + 3} fill="rgba(194,65,12,.06)" stroke={GONE} stroke-width=".45" stroke-dasharray="2 1.2" />; })}
    {g.gonePipes.map(q => <path class="ai-ghost-gone" d={ptsD(livePts(g.base, q))} fill="none" stroke={GONE} stroke-width=".5" stroke-dasharray="2 1.2" opacity=".8" />)}
  </g>;
}
