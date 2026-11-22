// Whole-machine samples registry (public machines only)
import { machineProject, type MachineSpec } from './build';
import { m01 } from './m01';
export const MACHINES: (() => MachineSpec)[] = [m01];
export const machineList = () => MACHINES.map(f => { const m = f(); return { id: m.id, name: m.name, description: m.description }; });
export function buildMachine(id: string) { const f = MACHINES.find(x => x().id === id); if (!f) throw new Error('Unknown machine ' + id); return machineProject(f()); }
export async function openMachine(id: string) { const { setProject } = await import('../project'); const S = await import('../store'); const p = buildMachine(id); p.manifest.name += ' (sample)'; p.nodes[p.rootId].name = p.manifest.name; await setProject(p, { dirty: false, sample: true }); const first = Object.values(p.nodes).find(n => n.type === 'sheet'); if (first) S.openSheetTab(first.id); return p; }
