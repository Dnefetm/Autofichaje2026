"use strict";
var __awaiter = (this && this.__awaiter) || function (thisArg, _arguments, P, generator) {
    function adopt(value) { return value instanceof P ? value : new P(function (resolve) { resolve(value); }); }
    return new (P || (P = Promise))(function (resolve, reject) {
        function fulfilled(value) { try { step(generator.next(value)); } catch (e) { reject(e); } }
        function rejected(value) { try { step(generator["throw"](value)); } catch (e) { reject(e); } }
        function step(result) { result.done ? resolve(result.value) : adopt(result.value).then(fulfilled, rejected); }
        step((generator = generator.apply(thisArg, _arguments || [])).next());
    });
};
var __generator = (this && this.__generator) || function (thisArg, body) {
    var _ = { label: 0, sent: function() { if (t[0] & 1) throw t[1]; return t[1]; }, trys: [], ops: [] }, f, y, t, g = Object.create((typeof Iterator === "function" ? Iterator : Object).prototype);
    return g.next = verb(0), g["throw"] = verb(1), g["return"] = verb(2), typeof Symbol === "function" && (g[Symbol.iterator] = function() { return this; }), g;
    function verb(n) { return function (v) { return step([n, v]); }; }
    function step(op) {
        if (f) throw new TypeError("Generator is already executing.");
        while (g && (g = 0, op[0] && (_ = 0)), _) try {
            if (f = 1, y && (t = op[0] & 2 ? y["return"] : op[0] ? y["throw"] || ((t = y["return"]) && t.call(y), 0) : y.next) && !(t = t.call(y, op[1])).done) return t;
            if (y = 0, t) op = [op[0] & 2, t.value];
            switch (op[0]) {
                case 0: case 1: t = op; break;
                case 4: _.label++; return { value: op[1], done: false };
                case 5: _.label++; y = op[1]; op = [0]; continue;
                case 7: op = _.ops.pop(); _.trys.pop(); continue;
                default:
                    if (!(t = _.trys, t = t.length > 0 && t[t.length - 1]) && (op[0] === 6 || op[0] === 2)) { _ = 0; continue; }
                    if (op[0] === 3 && (!t || (op[1] > t[0] && op[1] < t[3]))) { _.label = op[1]; break; }
                    if (op[0] === 6 && _.label < t[1]) { _.label = t[1]; t = op; break; }
                    if (t && _.label < t[2]) { _.label = t[2]; _.ops.push(op); break; }
                    if (t[2]) _.ops.pop();
                    _.trys.pop(); continue;
            }
            op = body.call(thisArg, _);
        } catch (e) { op = [6, e]; y = 0; } finally { f = t = 0; }
        if (op[0] & 5) throw op[1]; return { value: op[0] ? op[1] : void 0, done: true };
    }
};
var __spreadArray = (this && this.__spreadArray) || function (to, from, pack) {
    if (pack || arguments.length === 2) for (var i = 0, l = from.length, ar; i < l; i++) {
        if (ar || !(i in from)) {
            if (!ar) ar = Array.prototype.slice.call(from, 0, i);
            ar[i] = from[i];
        }
    }
    return to.concat(ar || Array.prototype.slice.call(from));
};
Object.defineProperty(exports, "__esModule", { value: true });
var pg_1 = require("pg");
var fs = require("fs");
var path = require("path");
var yaml = require("yaml");
var crypto = require("crypto");
var validate_data_pipeline_1 = require("./validate_data_pipeline");
// Deduplica preservando orden
function dedup(arr) { return Array.from(new Set(arr)); }
function main() {
    return __awaiter(this, void 0, void 0, function () {
        var dbUrl, client, rootDir, limitsPath, hintsPath, external_limits, hints, declaredProcesses, pipelineRoutes, parsedHints, rolesRes, roles, schema_hash, hashRes, e_1, funcsRes, hasPgStatStatements, e_2, triggersRes, triggersByFunc, tablesRes, tables, triggers, cron_jobs, cronRes, e_3, edge_functions, edgeDir, state_machines, enumRes, enumStates, transRes, transitions_1, e_4, queues, jobsRes, producerRows, _i, _a, row, t, genericProducers, _loop_1, _b, _c, t, e_5, diagnostics, tsResult, job_handlers, _d, _e, _f, jobType, files, workerHandlers, appDiagnostics, blueprint, knownFunctions, _loop_2, _g, _h, f, appDiagnosticsPostDB, smStates, _loop_3, _j, _k, _l, procName, proc, errors, warns, infos, fmt, catalog, tablesCatalog, processesCatalog, outJsonPath, md, _m, _o, _p, smName, sm, _q, _r, _s, qName, q, counts, _t, _u, _v, name_1, r, grouped, _w, _x, sev, items, _y, items_1, d, _z, _0, _1, procName, proc, _2, _3, s, bits, _4, _5, d, handlers, handlerText, diagCounts, _6, _7, _8, funcName, data, outMdPath;
        var _9, _10, _11, _12, _13, _14, _15, _16;
        return __generator(this, function (_17) {
            switch (_17.label) {
                case 0:
                    dbUrl = process.env.DATABASE_URL || process.env.SUPABASE_DB_URL;
                    if (!dbUrl) {
                        console.error("ERROR: DATABASE_URL o SUPABASE_DB_URL no configurada.");
                        process.exit(1);
                    }
                    client = new pg_1.Client({ connectionString: dbUrl });
                    return [4 /*yield*/, client.connect()];
                case 1:
                    _17.sent();
                    console.log("Conectado a la base de datos. Extrayendo catalogos...");
                    rootDir = path.resolve(__dirname, '..');
                    limitsPath = path.join(rootDir, 'infra_limits.json');
                    hintsPath = path.join(rootDir, 'docs', 'flow_hints.yaml');
                    external_limits = {};
                    if (fs.existsSync(limitsPath)) {
                        external_limits = JSON.parse(fs.readFileSync(limitsPath, 'utf8'));
                    }
                    hints = {};
                    declaredProcesses = {};
                    pipelineRoutes = {};
                    if (fs.existsSync(hintsPath)) {
                        parsedHints = yaml.parse(fs.readFileSync(hintsPath, 'utf8'));
                        if (parsedHints && parsedHints.hints) {
                            hints = parsedHints.hints;
                        }
                        if (parsedHints && parsedHints.processes) {
                            declaredProcesses = parsedHints.processes;
                        }
                        if (parsedHints && parsedHints.pipeline_routes) {
                            pipelineRoutes = parsedHints.pipeline_routes;
                        }
                    }
                    return [4 /*yield*/, client.query("SELECT rolname, rolconfig FROM pg_roles WHERE rolname IN ('authenticated', 'anon', 'service_role')")];
                case 2:
                    rolesRes = _17.sent();
                    roles = {};
                    rolesRes.rows.forEach(function (r) { roles[r.rolname] = r.rolconfig; });
                    schema_hash = null;
                    _17.label = 3;
                case 3:
                    _17.trys.push([3, 5, , 6]);
                    return [4 /*yield*/, client.query("SELECT public.fn_schema_hash() AS h")];
                case 4:
                    hashRes = _17.sent();
                    schema_hash = (_10 = (_9 = hashRes.rows[0]) === null || _9 === void 0 ? void 0 : _9.h) !== null && _10 !== void 0 ? _10 : null;
                    return [3 /*break*/, 6];
                case 5:
                    e_1 = _17.sent();
                    console.warn("[schema_hash] fn_schema_hash() no disponible, se calculara localmente.");
                    return [3 /*break*/, 6];
                case 6: return [4 /*yield*/, client.query("\nSELECT p.oid, p.proname, n.nspname as schema, p.prosrc, p.proconfig, p.prosecdef, s.total_time, s.calls\nFROM pg_proc p\nJOIN pg_namespace n ON p.pronamespace = n.oid\nLEFT JOIN pg_stat_user_functions s ON s.funcid = p.oid\nWHERE n.nspname = 'public' AND p.prokind = 'f'\nAND NOT EXISTS (SELECT 1 FROM pg_depend d WHERE d.objid = p.oid AND d.deptype = 'e')\n")];
                case 7:
                    funcsRes = _17.sent();
                    hasPgStatStatements = false;
                    _17.label = 8;
                case 8:
                    _17.trys.push([8, 10, , 11]);
                    return [4 /*yield*/, client.query("SELECT 1 FROM pg_stat_statements LIMIT 1")];
                case 9:
                    _17.sent();
                    hasPgStatStatements = true;
                    return [3 /*break*/, 11];
                case 10:
                    e_2 = _17.sent();
                    return [3 /*break*/, 11];
                case 11: return [4 /*yield*/, client.query("\nSELECT t.tgname, t.tgtype, c.relname as table_name, p.proname as target_function, n.nspname as target_schema\nFROM pg_trigger t\nJOIN pg_class c ON t.tgrelid = c.oid\nJOIN pg_proc p ON t.tgfoid = p.oid\nJOIN pg_namespace n ON p.pronamespace = n.oid\nWHERE NOT t.tgisinternal AND n.nspname = 'public'\n")];
                case 12:
                    triggersRes = _17.sent();
                    triggersByFunc = {};
                    triggersRes.rows.forEach(function (t) {
                        var fullFuncName = "".concat(t.target_schema, ".").concat(t.target_function);
                        if (!triggersByFunc[fullFuncName])
                            triggersByFunc[fullFuncName] = [];
                        triggersByFunc[fullFuncName].push(t);
                    });
                    return [4 /*yield*/, client.query("\nSELECT c.relname as table_name, c.relrowsecurity as rls_enabled,\nCOALESCE(json_agg(json_build_object('column', a.attname, 'type', format_type(a.atttypid, a.atttypmod), 'notnull', a.attnotnull) ORDER BY a.attnum) FILTER (WHERE a.attnum > 0 AND NOT a.attisdropped), '[]') as columns\nFROM pg_class c\nJOIN pg_namespace n ON c.relnamespace = n.oid\nLEFT JOIN pg_attribute a ON a.attrelid = c.oid\nWHERE n.nspname = 'public' AND c.relkind = 'r'\nGROUP BY c.relname, c.relrowsecurity\n")];
                case 13:
                    tablesRes = _17.sent();
                    tables = {};
                    tablesRes.rows.forEach(function (t) { tables["public.".concat(t.table_name)] = { rls_enabled: t.rls_enabled, columns: t.columns }; });
                    triggers = triggersRes.rows.map(function (t) { return ({ trigger: t.tgname, table: "public.".concat(t.table_name), target_function: "".concat(t.target_schema, ".").concat(t.target_function) }); });
                    cron_jobs = [];
                    _17.label = 14;
                case 14:
                    _17.trys.push([14, 16, , 17]);
                    return [4 /*yield*/, client.query("SELECT jobid, schedule, command, active FROM cron.job")];
                case 15:
                    cronRes = _17.sent();
                    cron_jobs = cronRes.rows;
                    return [3 /*break*/, 17];
                case 16:
                    e_3 = _17.sent();
                    console.warn("[cron] pg_cron no disponible o sin permisos.");
                    return [3 /*break*/, 17];
                case 17:
                    edge_functions = [];
                    edgeDir = path.join(rootDir, 'supabase', 'functions');
                    if (fs.existsSync(edgeDir)) {
                        edge_functions = fs.readdirSync(edgeDir, { withFileTypes: true })
                            .filter(function (d) { return d.isDirectory() && !d.name.startsWith('_'); })
                            .map(function (d) { return ({ name: d.name, path: "supabase/functions/".concat(d.name) }); });
                    }
                    state_machines = {};
                    _17.label = 18;
                case 18:
                    _17.trys.push([18, 22, , 23]);
                    return [4 /*yield*/, client.query("\nSELECT e.enumlabel AS label\nFROM pg_type t JOIN pg_enum e ON e.enumtypid = t.oid\nWHERE t.typname = 'estado_importacion_excel'\nORDER BY e.enumsortorder\n")];
                case 19:
                    enumRes = _17.sent();
                    enumStates = enumRes.rows.map(function (r) { return r.label; });
                    if (!(enumStates.length > 0)) return [3 /*break*/, 21];
                    return [4 /*yield*/, client.query("SELECT desde::text AS desde, hasta::text AS hasta FROM importacion_estado_transiciones")];
                case 20:
                    transRes = _17.sent();
                    transitions_1 = {};
                    transRes.rows.forEach(function (r) {
                        if (!transitions_1[r.desde])
                            transitions_1[r.desde] = [];
                        transitions_1[r.desde].push(r.hasta);
                    });
                    Object.keys(transitions_1).forEach(function (k) { transitions_1[k] = dedup(transitions_1[k]).sort(); });
                    state_machines['importacion'] = {
                        enum_type: 'estado_importacion_excel',
                        states: enumStates,
                        transitions: transitions_1,
                        recovery_from: transitions_1['error'] ? dedup(transitions_1['error']).sort() : []
                    };
                    console.log("[state-machine] importacion: ".concat(enumStates.length, " estados, ").concat(Object.keys(transitions_1).length, " origenes de transicion."));
                    _17.label = 21;
                case 21: return [3 /*break*/, 23];
                case 22:
                    e_4 = _17.sent();
                    console.warn("[state-machine] No se pudo introspectar estado_importacion_excel / importacion_estado_transiciones.", e_4.message);
                    return [3 /*break*/, 23];
                case 23:
                    queues = {};
                    _17.label = 24;
                case 24:
                    _17.trys.push([24, 26, , 27]);
                    return [4 /*yield*/, client.query("SELECT type, status, count(*)::int AS n FROM public.jobs GROUP BY type, status")];
                case 25:
                    jobsRes = _17.sent();
                    producerRows = funcsRes.rows.filter(function (f) { return /INSERT\s+INTO\s+(?:public\.)?jobs\b/i.test(f.prosrc || ''); });
                    for (_i = 0, _a = jobsRes.rows; _i < _a.length; _i++) {
                        row = _a[_i];
                        t = row.type;
                        if (!queues[t]) {
                            queues[t] = { type: t, status_counts: {}, total: 0, pending: 0, failed: 0, producers: [] };
                        }
                        queues[t].status_counts[row.status] = row.n;
                        queues[t].total += row.n;
                        if (row.status === 'pending')
                            queues[t].pending += row.n;
                        if (row.status === 'failed')
                            queues[t].failed += row.n;
                    }
                    genericProducers = producerRows.map(function (f) { return "".concat(f.schema, ".").concat(f.proname); });
                    _loop_1 = function (t) {
                        var specific = producerRows
                            .filter(function (f) { return new RegExp("['\"]".concat(t, "['\"]")).test(f.prosrc || ''); })
                            .map(function (f) { return "".concat(f.schema, ".").concat(f.proname); });
                        queues[t].producers = dedup(specific.length > 0 ? specific : genericProducers);
                    };
                    for (_b = 0, _c = Object.keys(queues); _b < _c.length; _b++) {
                        t = _c[_b];
                        _loop_1(t);
                    }
                    console.log("[queues] ".concat(Object.keys(queues).length, " cola(s) detectada(s) en public.jobs; ").concat(genericProducers.length, " funcion(es) productora(s)."));
                    return [3 /*break*/, 27];
                case 26:
                    e_5 = _17.sent();
                    console.warn("[queues] No se pudo introspectar public.jobs.", e_5.message);
                    return [3 /*break*/, 27];
                case 27:
                    diagnostics = [];
                    console.log("Corriendo Analizador Estatico de TypeScript (AST)...");
                    tsResult = (0, validate_data_pipeline_1.runStaticAppAnalysis)(rootDir);
                    job_handlers = {};
                    for (_d = 0, _e = tsResult.enqueuedJobs.entries(); _d < _e.length; _d++) {
                        _f = _e[_d], jobType = _f[0], files = _f[1];
                        // Para simplificar, mapeamos los archivos. Si un archivo es worker, lo cuenta como manejado.
                        job_handlers[jobType] = files;
                    }
                    workerHandlers = Array.from(tsResult.enqueuedJobs.keys());
                    appDiagnostics = (0, validate_data_pipeline_1.validateCrossReferences)(tsResult, {}, {}, workerHandlers);
                    appDiagnostics.forEach(function (d) {
                        diagnostics.push({
                            scope: d.scope,
                            severity: d.severity,
                            code: d.code,
                            message: d.message,
                            hint: d.file ? "En archivo: ".concat(d.file) : undefined,
                            evidence: { runtime: false }
                        });
                    });
                    console.log("[ast-analysis] ".concat(appDiagnostics.length, " diagnosticos del analizador de TypeScript encontrados."));
                    blueprint = {
                        generated_at: new Date().toISOString(),
                        schema_hash: schema_hash,
                        processes_hash: null,
                        roles: roles,
                        external_limits: external_limits,
                        functions: {},
                        tables: tables,
                        triggers: triggers,
                        cron_jobs: cron_jobs,
                        edge_functions: edge_functions,
                        state_machines: state_machines,
                        queues: queues,
                        processes: {},
                        job_handlers: job_handlers,
                        diagnostics: diagnostics
                    };
                    knownFunctions = new Set(funcsRes.rows.map(function (row) { return row.proname; }));
                    _loop_2 = function (f) {
                        var fullFuncName, source, calls_tables, calls_functions, dynamic_sql, magicTables, magicFuncs, avg_time_ms, p95_time_ms, timing_source, statRes, e_6, allFuncCallsMatches, insertMatches, updateMatches, deleteMatches, estimatedCostMs, cascade, seenCascade, _loop_4, _18, calls_tables_1, table, lineageDiagnostics;
                        return __generator(this, function (_19) {
                            switch (_19.label) {
                                case 0:
                                    fullFuncName = "".concat(f.schema, ".").concat(f.proname);
                                    source = f.prosrc;
                                    calls_tables = new Set();
                                    calls_functions = new Set();
                                    dynamic_sql = false;
                                    magicTables = __spreadArray([], source.matchAll(/--\s*@flow-affects:\s*([^\s]+)/g), true).map(function (m) { return m[1]; });
                                    magicFuncs = __spreadArray([], source.matchAll(/--\s*@flow-calls:\s*([^\s]+)/g), true).map(function (m) { return m[1]; });
                                    magicTables.forEach(function (t) { return calls_tables.add(t); });
                                    magicFuncs.forEach(function (fn) { return calls_functions.add(fn); });
                                    if (source.match(/\bEXECUTE\b/i) || source.match(/\bformat\s*\(/i)) {
                                        dynamic_sql = true;
                                    }
                                    if (hints[fullFuncName]) {
                                        (_11 = hints[fullFuncName].affects_tables) === null || _11 === void 0 ? void 0 : _11.forEach(function (t) { return calls_tables.add(t); });
                                        (_12 = hints[fullFuncName].calls_functions) === null || _12 === void 0 ? void 0 : _12.forEach(function (fn) { return calls_functions.add(fn); });
                                    }
                                    avg_time_ms = f.calls && f.calls > 0 ? f.total_time / f.calls : null;
                                    p95_time_ms = null;
                                    timing_source = avg_time_ms ? 'live_stats' : 'none';
                                    if (!hasPgStatStatements) return [3 /*break*/, 4];
                                    _19.label = 1;
                                case 1:
                                    _19.trys.push([1, 3, , 4]);
                                    return [4 /*yield*/, client.query("SELECT max_exec_time, mean_exec_time FROM pg_stat_statements WHERE query ILIKE $1 ORDER BY max_exec_time DESC LIMIT 1", ["%".concat(f.proname, "%")])];
                                case 2:
                                    statRes = _19.sent();
                                    if (statRes.rows.length > 0) {
                                        p95_time_ms = statRes.rows[0].max_exec_time;
                                        if (!avg_time_ms) {
                                            avg_time_ms = statRes.rows[0].mean_exec_time;
                                            timing_source = 'pg_stat_statements';
                                        }
                                    }
                                    return [3 /*break*/, 4];
                                case 3:
                                    e_6 = _19.sent();
                                    return [3 /*break*/, 4];
                                case 4:
                                    if ((_13 = hints[fullFuncName]) === null || _13 === void 0 ? void 0 : _13.estimated_time_ms) {
                                        avg_time_ms = hints[fullFuncName].estimated_time_ms;
                                        p95_time_ms = hints[fullFuncName].estimated_time_ms;
                                        timing_source = 'yaml_hint';
                                    }
                                    allFuncCallsMatches = __spreadArray([], source.matchAll(/\b(?:public\.)?([a-zA-Z0-9_]+)\s*\(/gi), true).map(function (m) { return m[1]; });
                                    allFuncCallsMatches.forEach(function (fn) { if (knownFunctions.has(fn))
                                        calls_functions.add("public.".concat(fn)); });
                                    insertMatches = __spreadArray([], source.matchAll(/INSERT\s+INTO\s+(?:public\.)?([a-zA-Z0-9_]+)/gi), true).map(function (m) { return m[1]; });
                                    updateMatches = __spreadArray([], source.matchAll(/UPDATE\s+(?:public\.)?([a-zA-Z0-9_]+)/gi), true).map(function (m) { return m[1]; });
                                    deleteMatches = __spreadArray([], source.matchAll(/DELETE\s+FROM\s+(?:public\.)?([a-zA-Z0-9_]+)/gi), true).map(function (m) { return m[1]; });
                                    insertMatches.concat(updateMatches, deleteMatches).forEach(function (t) { return calls_tables.add("public.".concat(t)); });
                                    if (!avg_time_ms && !p95_time_ms) {
                                        estimatedCostMs = 5;
                                        estimatedCostMs += insertMatches.length * 150;
                                        estimatedCostMs += updateMatches.length * 200;
                                        estimatedCostMs += deleteMatches.length * 100;
                                        estimatedCostMs += __spreadArray([], source.matchAll(/\bSELECT\b/gi), true).length * 20;
                                        estimatedCostMs += __spreadArray([], source.matchAll(/\bJOIN\b/gi), true).length * 30;
                                        estimatedCostMs += __spreadArray([], source.matchAll(/\bFOR\s+.*?\s+IN\b/gi), true).length * 150;
                                        if (dynamic_sql)
                                            estimatedCostMs += 200;
                                        avg_time_ms = estimatedCostMs;
                                        timing_source = 'ast_estimator';
                                        console.log("[Estimador] ".concat(fullFuncName, ": inferencia AST = ").concat(avg_time_ms, "ms"));
                                    }
                                    cascade = [];
                                    seenCascade = new Set();
                                    _loop_4 = function (table) {
                                        var trgs = triggersRes.rows.filter(function (t) { return t.table_name === table.replace('public.', ''); });
                                        trgs.forEach(function (t) {
                                            var key = "".concat(t.table_name, "|").concat(t.tgname);
                                            if (seenCascade.has(key))
                                                return;
                                            seenCascade.add(key);
                                            cascade.push({ table: t.table_name, trigger: t.tgname, target_function: "".concat(t.target_schema, ".").concat(t.target_function) });
                                        });
                                    };
                                    for (_18 = 0, calls_tables_1 = calls_tables; _18 < calls_tables_1.length; _18++) {
                                        table = calls_tables_1[_18];
                                        _loop_4(table);
                                    }
                                    blueprint.functions[fullFuncName] = {
                                        source_sql: source,
                                        statement_timeout_override: f.proconfig ? (f.proconfig.find(function (c) { return c.startsWith('statement_timeout'); }) || null) : null,
                                        security: f.prosecdef ? 'DEFINER' : 'INVOKER',
                                        calls_tables: dedup(Array.from(calls_tables)),
                                        calls_functions: dedup(Array.from(calls_functions)),
                                        triggers_on_tables: dedup((triggersByFunc[fullFuncName] || []).map(function (t) { return t.table_name; })),
                                        triggers_cascade: cascade,
                                        dynamic_sql: dynamic_sql,
                                        avg_time_ms: avg_time_ms,
                                        p95_time_ms: p95_time_ms,
                                        timing_source: timing_source
                                    };
                                    lineageDiagnostics = (0, validate_data_pipeline_1.analyzeDataLineageSql)(source, fullFuncName, blueprint.tables);
                                    lineageDiagnostics.forEach(function (d) {
                                        diagnostics.push({
                                            scope: d.scope,
                                            severity: d.severity,
                                            code: d.code,
                                            message: d.message,
                                            hint: d.file ? "En archivo: ".concat(d.file) : undefined,
                                            evidence: { runtime: false }
                                        });
                                    });
                                    return [2 /*return*/];
                            }
                        });
                    };
                    _g = 0, _h = funcsRes.rows;
                    _17.label = 28;
                case 28:
                    if (!(_g < _h.length)) return [3 /*break*/, 31];
                    f = _h[_g];
                    return [5 /*yield**/, _loop_2(f)];
                case 29:
                    _17.sent();
                    _17.label = 30;
                case 30:
                    _g++;
                    return [3 /*break*/, 28];
                case 31:
                    appDiagnosticsPostDB = (0, validate_data_pipeline_1.validateCrossReferences)(tsResult, blueprint.functions, blueprint.tables, workerHandlers);
                    appDiagnosticsPostDB.forEach(function (d) {
                        // Evitar duplicados del primer parseo ciego
                        if (!diagnostics.find(function (existing) { return existing.code === d.code && existing.scope === d.scope; })) {
                            diagnostics.push({
                                scope: d.scope,
                                severity: d.severity,
                                code: d.code,
                                message: d.message,
                                hint: d.file ? "En archivo: ".concat(d.file) : undefined,
                                evidence: { runtime: false }
                            });
                        }
                    });
                    smStates = new Set(((_14 = state_machines['importacion']) === null || _14 === void 0 ? void 0 : _14.states) || []);
                    _loop_3 = function (procName, proc) {
                        var steps = Array.isArray(proc.steps) ? proc.steps : [];
                        var deletedTables = new Set(); // Rastrear canibalizacion en memoria
                        for (var i = 0; i < steps.length; i++) {
                            var step = steps[i];
                            if (step.fn && !blueprint.functions[step.fn]) {
                                diagnostics.push({ scope: "processes.".concat(procName), severity: 'error', code: 'FN_MISSING', message: "funcion inexistente en la BD: ".concat(step.fn), hint: 'Verifica el nombre o crea la funcion antes de declararla.', evidence: { yaml: true } });
                            }
                            if (step.estado && smStates.size > 0 && !smStates.has(step.estado)) {
                                diagnostics.push({ scope: "processes.".concat(procName), severity: 'error', code: 'STATE_MISSING', message: "estado inexistente en estado_importacion_excel: ".concat(step.estado), hint: 'Corrige el estado declarado o actualiza la state machine.', evidence: { yaml: true } });
                            }
                            // MOTOR DE CANIBALIZACION
                            if (step.fn && blueprint.functions[step.fn]) {
                                var sql = blueprint.functions[step.fn].source_sql;
                                // Detectar lecturas
                                var selectRegex = /SELECT\s+[\s\S]*?\s+FROM\s+(?:public\.)?([a-zA-Z0-9_]+)/gi;
                                var m = void 0;
                                while ((m = selectRegex.exec(sql)) !== null) {
                                    var tableRead = m[1];
                                    if (deletedTables.has(tableRead)) {
                                        diagnostics.push({
                                            scope: "processes.".concat(procName, ".cannibalization"),
                                            severity: 'error',
                                            code: 'DATA_CANNIBALIZATION',
                                            message: "Flujo roto: El Paso ".concat(i + 1, " (").concat(step.fn, ") lee de la tabla '").concat(tableRead, "', pero un paso anterior ya vaci\u00F3 esta tabla. El paso procesar\u00E1 0 filas."),
                                            hint: "Revisa la secuencia en flow_hints.yaml o quita el DELETE prematuro.",
                                            evidence: { yaml: true }
                                        });
                                    }
                                }
                                // Detectar borrados
                                var deleteRegex = /(?:DELETE\s+FROM|TRUNCATE\s+TABLE)\s+(?:public\.)?([a-zA-Z0-9_]+)/gi;
                                while ((m = deleteRegex.exec(sql)) !== null) {
                                    deletedTables.add(m[1]);
                                }
                                // Detectar inserciones que podrian curar la canibalizacion
                                var insertRegex = /INSERT\s+INTO\s+(?:public\.)?([a-zA-Z0-9_]+)/gi;
                                while ((m = insertRegex.exec(sql)) !== null) {
                                    deletedTables.delete(m[1]);
                                }
                            }
                        }
                        if (((_15 = proc.recovery) === null || _15 === void 0 ? void 0 : _15.rutas) && smStates.size > 0) {
                            for (var _20 = 0, _21 = proc.recovery.rutas; _20 < _21.length; _20++) {
                                var r = _21[_20];
                                if (!smStates.has(r)) {
                                    diagnostics.push({ scope: "processes.".concat(procName, ".recovery"), severity: 'error', code: 'RECOVERY_STATE_MISSING', message: "estado de recuperacion inexistente: ".concat(r), hint: 'La ruta de recovery no coincide con la maquina de estados.', evidence: { yaml: true } });
                                }
                            }
                        }
                        if (Array.isArray(proc.downstream)) {
                            proc.downstream.forEach(function (d) {
                                if (!d || !d.job)
                                    return;
                                var job = d.job;
                                var expectRuntime = d.expect_runtime !== false;
                                var hasRuntime = !!queues[job];
                                var handlers = job_handlers[job] || [];
                                var hasHandler = handlers.length > 0;
                                var producerHints = __spreadArray(__spreadArray([], (tsResult.enqueuedJobs.has(job) ? ['app-code'] : []), true), (d.productor ? [String(d.productor)] : []), true);
                                var isProducible = producerHints.length > 0;
                                if (hasRuntime)
                                    return;
                                if (hasHandler || isProducible) {
                                    diagnostics.push({ scope: "processes.".concat(procName, ".downstream"), severity: expectRuntime ? 'warn' : 'info', code: 'QUEUE_NO_RUNTIME', message: "cola '".concat(job, "' sin filas observadas en public.jobs"), hint: d.blocked_by ? "Bloqueo conocido: ".concat(d.blocked_by, ". No es fallo estructural.") : 'La cola es valida pero aun no tiene trafico observado.', evidence: { runtime: false, handler: handlers, producer: producerHints, yaml: true } });
                                }
                                else {
                                    diagnostics.push({ scope: "processes.".concat(procName, ".downstream"), severity: 'error', code: 'QUEUE_ORPHAN', message: "cola '".concat(job, "' sin runtime, sin consumidor detectable y sin productor detectable"), hint: "Agrega el handler en route.ts o corrige el nombre en flow_hints.yaml.", evidence: { runtime: false, handler: handlers, producer: producerHints, yaml: true } });
                                }
                            });
                        }
                        blueprint.processes[procName] = proc;
                    };
                    for (_j = 0, _k = Object.entries(declaredProcesses); _j < _k.length; _j++) {
                        _l = _k[_j], procName = _l[0], proc = _l[1];
                        _loop_3(procName, proc);
                    }
                    errors = diagnostics.filter(function (d) { return d.severity === 'error'; });
                    warns = diagnostics.filter(function (d) { return d.severity === 'warn'; });
                    infos = diagnostics.filter(function (d) { return d.severity === 'info'; });
                    fmt = function (d) { return "  [".concat(d.code, "] ").concat(d.scope, ": ").concat(d.message).concat(d.hint ? "\n      -> ".concat(d.hint) : ''); };
                    if (errors.length) {
                        console.error("\n[processes] ".concat(errors.length, " ERROR(es):"));
                        errors.forEach(function (d) { return console.error(fmt(d)); });
                    }
                    if (warns.length) {
                        console.warn("\n[processes] ".concat(warns.length, " ADVERTENCIA(s):"));
                        warns.forEach(function (d) { return console.warn(fmt(d)); });
                    }
                    if (infos.length) {
                        console.log("\n[processes] ".concat(infos.length, " nota(s) informativa(s):"));
                        infos.forEach(function (d) { return console.log(fmt(d)); });
                    }
                    if (!(errors.length > 0)) return [3 /*break*/, 33];
                    return [4 /*yield*/, client.end()];
                case 32:
                    _17.sent();
                    process.exit(1);
                    _17.label = 33;
                case 33:
                    console.log("\n[processes] ".concat(Object.keys(blueprint.processes).length, " proceso(s) validados: ").concat(errors.length, " error, ").concat(warns.length, " warn, ").concat(infos.length, " info."));
                    if (!blueprint.schema_hash) {
                        catalog = Object.keys(blueprint.functions).sort().map(function (k) { return k + ':' + blueprint.functions[k].source_sql; }).join('\n');
                        tablesCatalog = JSON.stringify(blueprint.tables);
                        blueprint.schema_hash = crypto.createHash('sha256').update(catalog + tablesCatalog).digest('hex');
                    }
                    processesCatalog = JSON.stringify(blueprint.processes) + JSON.stringify(blueprint.state_machines) + JSON.stringify(blueprint.queues);
                    blueprint.processes_hash = crypto.createHash('sha256').update(processesCatalog).digest('hex');
                    outJsonPath = path.join(rootDir, 'docs', 'db_flow_blueprint.json');
                    fs.writeFileSync(outJsonPath, JSON.stringify(blueprint, null, 2));
                    console.log("Guardado JSON en: ".concat(outJsonPath));
                    md = "# DB Flow Blueprint & System Diagnostics\n\n";
                    md += "- **Schema hash:** `".concat(blueprint.schema_hash, "`\n");
                    md += "- **Processes hash:** `".concat(blueprint.processes_hash, "`\n");
                    md += "- **Tables:** ".concat(Object.keys(blueprint.tables).length, " | **Triggers:** ").concat(blueprint.triggers.length, " | **Cron jobs:** ").concat(blueprint.cron_jobs.length, " | **Edge fns:** ").concat(blueprint.edge_functions.length, " | **Queues:** ").concat(Object.keys(blueprint.queues).length, "\n\n");
                    if (tsResult.dataLineage && tsResult.dataLineage['mapeo_frontend']) {
                        md += "## \uD83D\uDCCA Linaje de Datos (Excel -> BD)\n\n";
                        md += "Columnas extra\u00EDdas en Frontend / Edge:\n";
                        tsResult.dataLineage['mapeo_frontend'].forEach(function (col) {
                            md += "- `".concat(col, "`\n");
                        });
                        md += "\n";
                    }
                    if (Object.keys(blueprint.state_machines).length > 0) {
                        md += "## Maquinas de estado\n\n";
                        for (_m = 0, _o = Object.entries(blueprint.state_machines); _m < _o.length; _m++) {
                            _p = _o[_m], smName = _p[0], sm = _p[1];
                            md += "### ".concat(smName, " (enum `").concat(sm.enum_type, "`)\n");
                            md += "- **Estados:** ".concat(sm.states.join(', '), "\n");
                            if (sm.recovery_from.length > 0)
                                md += "- **Recuperacion desde error ->** ".concat(sm.recovery_from.join(', '), "\n");
                            md += "- **Transiciones:**\n";
                            Object.entries(sm.transitions).forEach(function (_a) {
                                var desde = _a[0], hasta = _a[1];
                                md += " - `".concat(desde, "` -> ").concat(hasta.join(', '), "\n");
                            });
                            md += '\n';
                        }
                    }
                    if (Object.keys(blueprint.queues).length > 0) {
                        md += "## Colas (jobs)\n\n";
                        for (_q = 0, _r = Object.entries(blueprint.queues); _q < _r.length; _q++) {
                            _s = _r[_q], qName = _s[0], q = _s[1];
                            counts = Object.entries(q.status_counts).map(function (_a) {
                                var s = _a[0], n = _a[1];
                                return "".concat(s, "=").concat(n);
                            }).join(', ');
                            md += "### ".concat(qName, "\n");
                            md += "- **Total:** ".concat(q.total, " (").concat(counts, ")\n");
                            if (q.pending > 0)
                                md += "- **Pendientes:** ".concat(q.pending, "\n");
                            if (q.failed > 0)
                                md += "- **WARNING - Fallidos:** ".concat(q.failed, "\n");
                            if (q.producers.length > 0)
                                md += "- **Productores:** ".concat(q.producers.join(', '), "\n");
                            md += '\n';
                        }
                    }
                    if (Object.keys(pipelineRoutes).length > 0) {
                        md += "## Rutas de pricing (estado)\n\n";
                        for (_t = 0, _u = Object.entries(pipelineRoutes); _t < _u.length; _t++) {
                            _v = _u[_t], name_1 = _v[0], r = _v[1];
                            md += "### ".concat(name_1, " \u2014 **").concat((r.status || 'unknown').toUpperCase(), "**\n\n");
                            if (r.description)
                                md += "".concat(r.description, "\n\n");
                            if (r.path)
                                md += "- Path: `".concat(r.path, "`\n");
                            if (r.producer)
                                md += "- Producer: `".concat(r.producer, "`\n");
                            if (r.consumer)
                                md += "- Consumer: `".concat(r.consumer, "`\n");
                            if (r.notes)
                                md += "- Notes: ".concat(r.notes, "\n");
                            md += "\n";
                        }
                    }
                    if (blueprint.diagnostics.length > 0) {
                        md += "## Diagnosticos\n\n";
                        grouped = {
                            error: blueprint.diagnostics.filter(function (d) { return d.severity === 'error'; }),
                            warn: blueprint.diagnostics.filter(function (d) { return d.severity === 'warn'; }),
                            info: blueprint.diagnostics.filter(function (d) { return d.severity === 'info'; }),
                        };
                        for (_w = 0, _x = ['error', 'warn', 'info']; _w < _x.length; _w++) {
                            sev = _x[_w];
                            items = grouped[sev];
                            if (!items.length)
                                continue;
                            md += "### ".concat(sev.toUpperCase(), "\n\n");
                            for (_y = 0, items_1 = items; _y < items_1.length; _y++) {
                                d = items_1[_y];
                                md += "- [".concat(d.code, "] `").concat(d.scope, "`: ").concat(d.message);
                                if (d.hint)
                                    md += " \u2014 ".concat(d.hint);
                                md += "\n";
                            }
                            md += "\n";
                        }
                    }
                    if (Object.keys(blueprint.processes || {}).length > 0) {
                        md += "## Procesos declarados\n\n";
                        for (_z = 0, _0 = Object.entries(blueprint.processes); _z < _0.length; _z++) {
                            _1 = _0[_z], procName = _1[0], proc = _1[1];
                            md += "### ".concat(procName, "\n\n");
                            if (proc.trigger)
                                md += "- Trigger: `".concat(proc.trigger, "`\n");
                            if (Array.isArray(proc.steps) && proc.steps.length) {
                                md += "- Steps:\n";
                                for (_2 = 0, _3 = proc.steps; _2 < _3.length; _2++) {
                                    s = _3[_2];
                                    bits = [];
                                    if (s.fn)
                                        bits.push("fn=`".concat(s.fn, "`"));
                                    if (s.estado)
                                        bits.push("estado=`".concat(s.estado, "`"));
                                    if (s.tabla_destino)
                                        bits.push("tabla_destino=`".concat(s.tabla_destino, "`"));
                                    if (s.destino)
                                        bits.push("destino=`".concat(s.destino, "`"));
                                    md += "  - ".concat(bits.join(' | '), "\n");
                                }
                            }
                            if (Array.isArray(proc.downstream) && proc.downstream.length) {
                                md += "- Downstream:\n";
                                for (_4 = 0, _5 = proc.downstream; _4 < _5.length; _4++) {
                                    d = _5[_4];
                                    if (d.trigger) {
                                        md += "  - trigger=`".concat(d.trigger, "`").concat(d.tabla ? " | tabla=`".concat(d.tabla, "`") : '', "\n");
                                        continue;
                                    }
                                    if (d.fn) {
                                        md += "  - fn=`".concat(d.fn, "`").concat(d.destino ? " | destino=`".concat(d.destino, "`") : '', "\n");
                                        continue;
                                    }
                                    if (d.job) {
                                        handlers = ((_16 = blueprint.job_handlers) === null || _16 === void 0 ? void 0 : _16[d.job]) || [];
                                        handlerText = handlers.length ? handlers.map(function (h) { return "`".concat(h, "`"); }).join(', ') : '`no detectado`';
                                        md += "  - job=`".concat(d.job, "` | handler=").concat(handlerText, " | expect_runtime=`").concat(d.expect_runtime !== false, "`");
                                        if (d.blocked_by)
                                            md += " | blocked_by=`".concat(d.blocked_by, "`");
                                        md += "\n";
                                    }
                                }
                            }
                            if (proc.recovery) {
                                md += "- Recovery: desde `".concat(proc.recovery.desde, "`");
                                if (Array.isArray(proc.recovery.rutas)) {
                                    md += " -> [".concat(proc.recovery.rutas.map(function (r) { return "`".concat(r, "`"); }).join(', '), "]");
                                }
                                md += "\n";
                            }
                            md += "\n";
                        }
                    }
                    diagCounts = {
                        error: blueprint.diagnostics.filter(function (d) { return d.severity === 'error'; }).length,
                        warn: blueprint.diagnostics.filter(function (d) { return d.severity === 'warn'; }).length,
                        info: blueprint.diagnostics.filter(function (d) { return d.severity === 'info'; }).length,
                    };
                    md += "## Salud del blueprint\n\n";
                    md += "- Procesos declarados: ".concat(Object.keys(blueprint.processes || {}).length, "\n");
                    md += "- Handlers de jobs detectados en worker: ".concat(Object.keys(blueprint.job_handlers || {}).length, "\n");
                    md += "- Diagnosticos error: ".concat(diagCounts.error, "\n");
                    md += "- Diagnosticos warn: ".concat(diagCounts.warn, "\n");
                    md += "- Diagnosticos info: ".concat(diagCounts.info, "\n\n");
                    for (_6 = 0, _7 = Object.entries(blueprint.functions); _6 < _7.length; _6++) {
                        _8 = _7[_6], funcName = _8[0], data = _8[1];
                        md += "## ".concat(funcName, "\n");
                        md += "- **Security:** ".concat(data.security, "\n");
                        md += "- **Timeout Override:** ".concat(data.statement_timeout_override || 'None', "\n");
                        md += "- **Avg Time:** ".concat(data.avg_time_ms ? data.avg_time_ms.toFixed(2) + ' ms' : 'Unknown', " (source: ").concat(data.timing_source, ")\n");
                        if (data.dynamic_sql)
                            md += "- WARNING: **Dynamic SQL Detected**\n";
                        if (data.calls_tables.length > 0)
                            md += "- **Touches Tables:** ".concat(data.calls_tables.join(', '), "\n");
                        if (data.calls_functions.length > 0)
                            md += "- **Calls Functions:** ".concat(data.calls_functions.join(', '), "\n");
                        if (data.triggers_cascade.length > 0) {
                            md += "- **Cascading Triggers:**\n";
                            data.triggers_cascade.forEach(function (tc) {
                                md += " - `".concat(tc.table, "` -> `").concat(tc.target_function, "` (Trigger: ").concat(tc.trigger, ")\n");
                            });
                        }
                        md += '\n';
                    }
                    outMdPath = path.join(rootDir, 'docs', 'db_flow_blueprint.md');
                    fs.writeFileSync(outMdPath, md);
                    console.log("Guardado MD en: ".concat(outMdPath));
                    return [4 /*yield*/, client.end()];
                case 34:
                    _17.sent();
                    return [2 /*return*/];
            }
        });
    });
}
main().catch(function (err) { console.error(err); process.exit(1); });
