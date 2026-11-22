// The AI commands' input schemas and one-line descriptions — plain data, no imports. The command API checks every call
// against these; the web build also writes them to desktop/src-tauri/mcp-tools.json, which HYDRA.exe --mcp serves as its
// MCP tool list (so the list is answered without starting HYDRA). Keep them short: they are sent to the AI.
const str = { type: 'string', minLength: 1, maxLength: 200 };
const sheet = { type: 'string', maxLength: 200, description: 'sheet id or name; default: the open sheet' };
const num = { type: 'number' };
const values = { type: 'object', maxProperties: 60, additionalProperties: { type: ['number', 'string', 'boolean'] }, description: 'e.g. {"set":"120 bar"}; plain numbers use bar, L/min, mm …' };
const part = { type: 'object', additionalProperties: false, required: ['ref'], properties: { ref: str, tag: { type: 'string', maxLength: 20, description: 'ISO 1219-2, e.g. 1V2' }, as: { type: 'string', maxLength: 40 }, x: num, y: num, rot: num, mirror: { type: 'boolean' }, values, desc: { type: 'string', maxLength: 200 } } };
const ports = { type: 'array', minItems: 2, maxItems: 40, items: str, description: 'TAG.PORT, e.g. ["1P1.P","1V1.P"]' };
const kind = { type: 'string', enum: ['work', 'pilot', 'drain'] };
const planId = { type: 'string', minLength: 1, maxLength: 60 };
const obj = (props: any, required: string[] = []) => ({ type: 'object', additionalProperties: false, required, properties: props });

export const SCHEMAS: Record<string, any> = {
  get_project_info: obj({}),
  get_sheet: obj({ sheet, plan: planId, full: { type: 'boolean' } }),
  search_library: obj({ query: { type: 'string', maxLength: 120 }, domain: { type: 'string', enum: ['hydraulic', 'pneumatic'] }, category: { type: 'string', maxLength: 60 }, limit: { type: 'integer', minimum: 1, maximum: 25 } }, ['query']),
  describe_part: obj({ ref: str }, ['ref']),
  validate: obj({ sheet, plan: planId }),
  run_sim: obj({ sheet, plan: planId, t_end: { type: 'number', exclusiveMinimum: 0, maximum: 60 }, events: { type: 'array', maxItems: 100, items: obj({ t: { type: 'number', minimum: 0 }, tag: str, pos: { type: 'string', minLength: 1, maxLength: 8 } }, ['t', 'tag', 'pos']) } }, ['t_end']),
  add_component: { ...part, properties: { ...part.properties, sheet } },
  set_param: obj({ sheet, tag: str, key: { type: 'string', maxLength: 60 }, value: { type: ['number', 'string'] }, values }, ['tag']),
  connect: obj({ sheet, ports, kind }, ['ports']),
  remove: obj({ sheet, tags: { type: 'array', minItems: 1, maxItems: 200, items: str } }, ['tags']),
  move_component: obj({ sheet, tag: str, x: num, y: num, rot: num }, ['tag', 'x', 'y']),
  build_circuit: obj({ sheet, replace: { type: 'boolean' }, parts: { type: 'array', maxItems: 200, items: part }, nets: { type: 'array', maxItems: 300, items: obj({ kind, ports }, ['ports']) } }),
  get_question_template: obj({ circuit_type: { type: 'string', maxLength: 40, description: 'lift, press, clamping, power_pack, cylinder, motor_drive, pneumatic' } }, ['circuit_type']),
  ask_user: obj({ title: { type: 'string', maxLength: 120 }, questions: { type: 'array', minItems: 1, maxItems: 20, items: obj({ id: { type: 'string', maxLength: 40 }, label: { type: 'string', maxLength: 80 }, type: { type: 'string', enum: ['select', 'number', 'radio', 'check', 'text'] }, options: { type: 'array', maxItems: 12, items: { type: 'string', maxLength: 60 } }, unit: { type: 'string', maxLength: 12 }, value: { type: ['number', 'string', 'boolean'] }, decide: { type: 'boolean' } }, ['id', 'label', 'type']) } }, ['title', 'questions']),
  propose_bom: obj({ title: { type: 'string', maxLength: 120 }, circuit_type: { type: 'string', maxLength: 40 }, pressure: { type: 'string', maxLength: 20 }, rows: { type: 'array', minItems: 1, maxItems: 120, items: obj({ tag: { type: 'string', maxLength: 20 }, part: { type: 'string', maxLength: 80 }, ref: { type: 'string', maxLength: 80 }, rating: { type: 'string', maxLength: 60 } }, ['tag', 'part']) }, assumptions: { type: 'array', maxItems: 20, items: { type: 'string', maxLength: 160 } } }, ['rows']),
  insert_template: obj({ sheet, name: str, x: num, y: num }, ['name']),
  create_for: obj({ sheet, domain: { type: 'string', enum: ['electric', 'logic', 'controller'] }, sequence: { type: 'array', maxItems: 60, items: { type: 'string', maxLength: 12 }, description: 'AUTO steps, e.g. ["1A1+","1A2+","1A2-","1A1-"]; default: all extend, then retract' }, name: { type: 'string', maxLength: 80 } }, ['domain']),
  get_plan: obj({ plan_id: planId }, ['plan_id']),
  apply_plan: obj({ plan_id: planId }, ['plan_id']),
  discard_plan: obj({ plan_id: planId }, ['plan_id']),
};

export const DESCRIPTIONS: Record<string, string> = {
  get_project_info: 'Project summary: sheets (id, name, type, part and line counts) and the tags in use.',
  get_sheet: 'One sheet as compact JSON: parts (tag, ref, x, y in mm, changed values) and nets (the ports each net joins). Pass plan to read a proposed plan.',
  search_library: 'Find parts in the ISO 1219 library. Returns the top matches: ref, name, port names.',
  describe_part: 'Ports (name, role) and settable values (key, unit, default) of one library part.',
  validate: 'Rule check of a sheet or a plan: open ports, missing relief valve, bad links. Returns problems only.',
  run_sim: 'Run the solver for t_end s (max 60). events switch valves: {t, tag, pos: a | 0 | b | rest}. Returns a summary: peak bar, actuator end times, warnings.',
  add_component: 'Place one library part (ref) with an ISO tag and values.',
  set_param: 'Set values of a placed part: key + value, or values {key: "120 bar"}. Values belong to the placed part, not the library.',
  connect: 'Join ports into one net (3 or more ports get a junction). kind: work, pilot or drain.',
  remove: 'Remove parts (by tag) and their lines.',
  move_component: 'Move a part to x, y (mm); its lines follow.',
  build_circuit: 'Whole circuit in one call. parts: [{tag, ref, x?, y?, rot?, values?}], nets: [{ports: ["1P1.P","1V1.P"], kind?}]. HYDRA adds no parts itself. With approval on, returns a plan_id shown in HYDRA as a ghost.',
  get_question_template: 'Built-in follow-up questions for a circuit type (lift, press, clamping, power_pack, cylinder, motor_drive, pneumatic). Start from these, add your own, then ask_user.',
  ask_user: 'Show a short form in HYDRA (each question gets "Let AI decide"). Then stop: the answers arrive in the next message. Claude Desktop: ask in your own chat instead.',
  propose_bom: 'Show the parts list for approval. HYDRA adds its mandatory parts (relief valve per pump, tank, lift safety valves) and returns the full list. Then stop and wait for approval before build_circuit.',
  insert_template: "Insert one of the user's saved templates (by name) at x, y; tags are renumbered.",
  create_for: "After the hydraulic circuit is applied: generate electric sheets (PLC I/O, motor starters), a PLC program (AUTO sequence, homing) or the operator panel from the sheet's tags. sequence like [\"1A1+\",\"1A1-\"].",
  get_plan: 'Status of a plan: added and removed parts, rule-check problems, solver result.',
  apply_plan: 'Apply a plan. With "Edit with approval" the user presses Apply in HYDRA and the answer is waiting_for_user.',
  discard_plan: 'Drop a plan; the drawing is not changed.',
};

/** the MCP tool list (name, description, inputSchema) */
export const MCP_TOOLS = Object.keys(SCHEMAS).map(name => ({ name, description: DESCRIPTIONS[name], inputSchema: SCHEMAS[name] }));
