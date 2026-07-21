#!/usr/bin/env node
// WP5-I4 WI-4.5 — 实验层用户开启路径端到端冒烟（in-process 同构 harness）。
// ============================================================
// 链路：隔离 DATA_DIR config.json → handleComputerModelMessage（WS 序列 handler
// 级，source:"settings"）→ D2 生物识别门（fake deps.gate 双路）→
// resolveTinyClickAdmission（真 I1 复验 + 真 TinyClickSession + 真 locator）→
// runComputerTask（生产 admission locator + 生产 png-decode；OCR/注入/证据/窗口
// 为 inline fake——不实测第三方应用，目标帧 = spike fixture.png）。
//
// 覆盖（出口 4/5/6 锚）：
//   1. fail-closed 基线：开关关 → admission null(model-switch-off)
//   2. set_enabled(true) 未接受 → license_required + config 零写入 + 文案四段标记
//   3. license_response accepted → licenseAccepted + download-host-unset（零网络）
//   4. 生物识别门双路：拒绝 → BIOMETRIC_DENIED 不写；批准 → enabled 且持久化
//   5. admission 全通过 → 真会话 ready（junction 指向 spike 模型目录）
//   6. 出口 4 拒绝臂：英文短命令 → L2 hit → reL2 caption「实验层建议（TinyClick
//      本地模型，未校准，可能完全错误）」→ 拒绝 → ELEMENT_NOT_FOUND 诚实降级、
//      零注入、completedActions 0（拒绝不耗预算）、无后续 tinyclick hit
//   7. 出口 4 批准臂：G4 批准 + 续期批准 → 建议点真注入 + uncrossverified +
//      confidence 缺省（G3）+ completedActions 1（批准后才耗预算，M1 挂钩）
// 精度对账（非断言）：注入点与 frozen 锚（g1-envelope-result）距离仅打印——
//   准确率臂归 golden 门禁管，冒烟只证链路。
//
// Usage: node scripts/verify-tinyclick-enable-smoke.js [--variant hybrid|int8]
// Exit: 0=全过；1=断言失败；2=环境/前置缺失（spike 模型/编译产物——诚实退出，
//       模型二进制不进 git）。手动臂（真 Hello + 真弹窗）= 发版前人工 checklist，
//       见 docs/decisions/coordinate-computer-use-wp5-i4-implementation-notes.md。

const fs = require("fs");
const os = require("os");
const path = require("path");
const crypto = require("crypto");

const EXIT_OK = 0;
const EXIT_FAIL = 1;
const EXIT_SETUP = 2;

function info(msg) { console.log(`[i4-smoke] INFO:  ${msg}`); }
function ok(msg) { console.log(`[i4-smoke] OK:    ${msg}`); }
function error(msg) { console.error(`[i4-smoke] ERROR: ${msg}`); }

const REPO_ROOT = path.resolve(__dirname, "..");
const DIST = path.join(REPO_ROOT, "companion", ".test-dist", "src");
const SPIKE = path.join(REPO_ROOT, "scripts", "spike", "s3-golden");

/** 冒烟 case：f-icon-en（hybrid/int8 双臂 frozen HIT、ASCII、包线内）。 */
const SMOKE_CASE_ID = "f-icon-en";
const SMOKE_COMMAND = "click on the blue square icon";
const FROZEN_BY_VARIANT = { hybrid: "g1-envelope-result.json", int8: "g1-envelope-result-int8.json" };

function parseArgs(argv) {
  const out = { variant: "hybrid" };
  for (let i = 2; i < argv.length; i++) {
    if (argv[i] === "--variant") out.variant = argv[++i];
    else { error(`未知参数: ${argv[i]}`); process.exit(EXIT_SETUP); }
  }
  if (!FROZEN_BY_VARIANT[out.variant]) {
    error(`未知变体: ${out.variant}`);
    process.exit(EXIT_SETUP);
  }
  return out;
}

let failures = 0;
function assert(cond, what) {
  if (cond) { ok(what); return true; }
  failures++;
  error(`断言失败: ${what}`);
  return false;
}
function sha256File(p) {
  return crypto.createHash("sha256").update(fs.readFileSync(p)).digest("hex");
}

async function main() {
  const args = parseArgs(process.argv);

  // --- 前置检查：编译产物 + spike 模型 + fixture ---------------------------------
  const needDist = [
    "config.js",
    "computer/model-handlers.js",
    "computer/model-admission.js",
    "computer/model-license.js",
    "computer/png-decode.js",
    "computer/executor.js",
  ];
  for (const f of needDist) {
    if (!fs.existsSync(path.join(DIST, f))) {
      error(`编译产物缺失: ${path.join(DIST, f)}\n  先运行: cd companion && node node_modules/typescript/bin/tsc -p tsconfig.test.json`);
      process.exit(EXIT_SETUP);
    }
  }
  const spikeModelDir = path.join(SPIKE, `onnx-${args.variant}`);
  for (const f of ["vision_encoder.onnx", "embed_tokens.onnx", "encoder_model.onnx", "decoder_model.onnx"]) {
    if (!fs.existsSync(path.join(spikeModelDir, f))) {
      error(`spike 模型缺失: ${path.join(spikeModelDir, f)}（模型二进制不进 git，需本机 spike 产物）`);
      process.exit(EXIT_SETUP);
    }
  }
  const fixturePng = path.join(SPIKE, "fixture.png");
  const frozenPath = path.join(SPIKE, FROZEN_BY_VARIANT[args.variant]);
  if (!fs.existsSync(fixturePng) || !fs.existsSync(frozenPath)) {
    error(`fixture/frozen 缺失（spike 产物 gitignore 不入库）`);
    process.exit(EXIT_SETUP);
  }

  // --- 隔离 DATA_DIR（必须先于 config.js require——DATA_DIR 模块加载时定型） --------
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "cmspark-i4-smoke-"));
  process.env.CMSPARK_DATA_DIR = dataDir;
  info(`隔离 DATA_DIR: ${dataDir}`);
  // 种子 config：apps 条目（coordinateAllowed）+ 主开关开；模型字段全默认（关）。
  fs.writeFileSync(
    path.join(dataDir, "config.json"),
    JSON.stringify({
      apps: {
        enabled: true,
        entries: {
          "win.app.test": {
            token: "win.app.test",
            kind: "gui",
            display_name: "Test App",
            source: "user",
            policy: "manual",
            enabled: true,
            added_at: "2026-07-21T00:00:00.000Z",
            exe: { path: "C:\\Program Files\\TestApp\\app.exe", signer: "CN=Test", user_writable_dir: false },
            coordinateAllowed: true,
          },
        },
      },
      // 变体经 config 显式指定（裁决 4：切换路径 = config + 重启，冒烟按臂种子）
      computer: { coordinateEnabled: true, modelVariant: args.variant },
    }, null, 2),
  );
  // 模型目录 junction（junction 免管理员特权；admission 走真 modelDirFor 路径）
  fs.mkdirSync(path.join(dataDir, "models"), { recursive: true });
  try {
    fs.symlinkSync(spikeModelDir, path.join(dataDir, "models", `tinyclick-${args.variant}`), "junction");
  } catch (e) {
    error(`模型目录 junction 失败: ${e && e.message ? e.message : e}`);
    process.exit(EXIT_SETUP);
  }

  // --- 加载编译产物 ----------------------------------------------------------------
  const { getConfig } = require(path.join(DIST, "config.js"));
  const { handleComputerModelMessage, computerModelSession } = require(path.join(DIST, "computer", "model-handlers.js"));
  const { resolveTinyClickAdmission, ADMISSION_REASON } = require(path.join(DIST, "computer", "model-admission.js"));
  const { runComputerTask } = require(path.join(DIST, "computer", "executor.js"));
  const { decodePngToRgba } = require(path.join(DIST, "computer", "png-decode.js"));

  const broadcasts = [];
  const ctx = { broadcast: (m) => broadcasts.push(m), requestConfirmation: async () => ({ approved: true }) };
  let gateApproved = true;
  const deps = {
    gate: async () =>
      gateApproved
        ? { approved: true, method: "biometric" }
        : { approved: false, reason: "cancelled" },
  };
  const holder = computerModelSession; // 生产单例（与 server.ts 接线同实例语义）

  // === 1. fail-closed 基线 =======================================================
  {
    const adm = await resolveTinyClickAdmission({ config: getConfig().computer, holder });
    assert(adm.locator === null && adm.reason === ADMISSION_REASON.SWITCH_OFF,
      `基线: 开关关 → admission null + model-switch-off（实得 ${adm.reason}）`);
  }

  // === 2. set_enabled(true) 未接受 → license_required 零写入 ======================
  {
    const r = await handleComputerModelMessage({ type: "computer.model.set_enabled", enabled: true, source: "settings" }, ctx, holder, deps);
    assert(r.type === "computer.model.license_required", "未接受 license → license_required");
    assert(typeof r.licenseText === "string" && r.licenseText.includes("MIT License"), "门文案含 MIT 全文");
    assert(r.licenseText.includes("Samsung"), "门文案含 Samsung 版权行（双引）");
    assert(r.licenseText.includes("Ethics"), "门文案含 Ethics 引文（双引）");
    assert(r.licenseText.includes("英文短命令") && r.licenseText.includes("13.3%"), "门文案含实测披露（S-3 冻结数据）");
    assert(getConfig().computer?.modelEnabled !== true, "license_required 分支 config 零写入");
    assert(typeof r.notice === "string" && r.notice.length > 0, "license_required 含 notice");
  }

  // === 3. license_response accepted → 时间戳+哈希+download-host-unset 零网络 ======
  {
    const r = await handleComputerModelMessage({ type: "computer.model.license_response", accepted: true, source: "settings" }, ctx, holder, deps);
    assert(r.licenseAccepted === true, "接受后 licenseAccepted=true");
    assert(typeof r.licenseAcceptedAt === "string" && r.licenseAcceptedAt.length > 0, "接受时间戳持久化");
    assert(getConfig().computer?.modelLicenseAcceptedTextHash?.length === 12, "文本版本哈希（P1，12 位）写入");
    assert(r.download === "download-host-unset", `占位主机 fail-fast 零网络（实得 ${r.download}）`);
    assert(!broadcasts.some((b) => b && b.type === "computer.model.progress"), "禁网兜底零进度广播（零网络证据）");
  }

  // === 4. 生物识别门双路 ==========================================================
  {
    gateApproved = false;
    const deny = await handleComputerModelMessage({ type: "computer.model.set_enabled", enabled: true, source: "settings" }, ctx, holder, deps);
    assert(deny.type === "error" && deny.code === "BIOMETRIC_DENIED", "门拒绝 → BIOMETRIC_DENIED");
    assert(getConfig().computer?.modelEnabled !== true, "门拒绝不写 config");
    gateApproved = true;
    const allow = await handleComputerModelMessage({ type: "computer.model.set_enabled", enabled: true, source: "settings" }, ctx, holder, deps);
    assert(allow.type === "computer.model.state" && allow.modelEnabled === true, "门批准 → enabled");
    const onDisk = JSON.parse(fs.readFileSync(path.join(dataDir, "config.json"), "utf8"));
    assert(onDisk.computer?.modelEnabled === true, "enabled 持久化到 config.json");
  }

  // === 5. admission 全通过（真会话 ~1.4s I1 复验 + warmup） ========================
  let admission;
  {
    admission = await resolveTinyClickAdmission({ config: getConfig().computer, holder });
    assert(admission.locator !== null, `admission 全通过 → locator 非空（实得 reason=${admission.reason}）`);
    assert(holder.session !== null, "holder 写入点①落定真会话");
    if (!admission.locator) {
      error("admission 未通过，冒烟无法继续");
      process.exit(EXIT_FAIL);
    }
  }

  // --- inline fakes（executor 依赖；帧 = fixture.png 真采集形态） -------------------
  const frame = decodePngToRgba(fs.readFileSync(fixturePng)); // 生产 png-decode 自吃
  ok(`fixture.png 解码 ${frame.width}×${frame.height}（生产 png-decode）`);
  const fixtureSha = sha256File(fixturePng);
  const mkShot = (pngPath) => ({
    hwnd: 424242,
    rect: { x: 0, y: 0, width: frame.width, height: frame.height },
    client: { x: 0, y: 0, width: frame.width, height: frame.height }, // 偏移 0 → 注入点即图像坐标
    dpi: 96,
    path: pngPath,
    sha256: fixtureSha,
    black: false,
    fallbackUsed: false,
    osrBlackSuspected: false,
  });
  // 生产语义镜像：采集帧是任务所有的 transient——executor R1 sweeper 在任何
  // 出口删除 raw 帧。绝不把共享 fixture 路径交给 executor（第一次运行曾把
  // spike fixture.png 本体扫掉——每 capture 复制一份隔离副本，扫副本无碍）。
  let captureSeq = 0;
  const mkCapturer = () => ({
    async captureWindow() {
      captureSeq++;
      const tmp = path.join(dataDir, `smoke-cap-${captureSeq}.png`);
      fs.copyFileSync(fixturePng, tmp);
      return mkShot(tmp);
    },
    async crop(_s, _r, out) { return out; },
    async diff() { return { diffRatio: 0 }; }, // 区域/整帧恒稳定（批准臂复核通过）
    async diffRegion() { return { diffRatio: 0 }; },
  });
  const mkLocator = () => ({ // OCR 恒 miss → 链落 L2 实验层
    async ensureLanguage() {},
    async ocr() { return { language: "zh-Hans", words: [] }; },
    locate() { return null; },
  });
  const winInfo = {
    hwnd: 424242, pid: 1234, exePath: "C:\\Program Files\\TestApp\\app.exe",
    title: "Test App", rect: { x: 0, y: 0, width: frame.width, height: frame.height }, alive: true,
  };
  const mkWindows = () => ({
    async enumerateByExe() { return [winInfo]; },
    async infoForHwnd() { return winInfo; },
  });
  const mkInjector = () => {
    const clicks = [];
    return {
      clicks,
      async click(hwnd, x, y, kind) { clicks.push({ hwnd, x, y, kind }); },
      async typeText() {}, async keyChord() {}, async scroll() {}, async drag() {},
      async probeWindow() { return winInfo; },
      async foregroundHwnd() { return 424242; },
    };
  };
  const mkEvidence = () => {
    const records = [];
    return {
      records, dir: "evidence-dir",
      async init() {},
      async sealScreenshot(raw, seq, phase) { return { sha256: `sha-${seq}-${phase}` }; },
      async appendAction(r) { records.push(r); },
      async finalize() {},
    };
  };
  const mkConfirm = (behaviors) => {
    const captured = [];
    let i = 0;
    return {
      captured,
      fn: async (details) => {
        captured.push({ details });
        const approved = behaviors[Math.min(i, behaviors.length - 1)];
        i++;
        return { confirmationId: `c${i}`, approved, reason: approved ? "approved" : "denied" };
      },
    };
  };
  const mkDeps = (behaviors, locator) => {
    const confirm = mkConfirm(behaviors);
    const injector = mkInjector();
    const evidence = mkEvidence();
    const logs = [];
    return {
      confirm, injector, evidence, logs,
      deps: {
        capturer: mkCapturer(),
        locator: mkLocator(),
        injector,
        windows: mkWindows(),
        securityEnv: { assertInjectable: async () => {} },
        evidenceFactory: () => evidence,
        confirm: confirm.fn,
        config: getConfig(),
        log: (event, data) => logs.push({ event, data }),
        tinyclickLocator: locator,
      },
    };
  };
  const ACTION = { action: "click", target: SMOKE_COMMAND };
  const CAPTION = "实验层建议（TinyClick 本地模型，未校准，可能完全错误）";

  // === 6. 出口 4 拒绝臂 ============================================================
  {
    const h = mkDeps([false], admission.locator);
    const r = await runComputerTask({ task: "t", app: "win.app.test", actions: [ACTION] }, h.deps);
    assert(r.success === false && r.errorCode === "ELEMENT_NOT_FOUND", `拒绝臂 → 诚实降级 ELEMENT_NOT_FOUND（实得 ${r.errorCode}）`);
    assert(h.injector.clicks.length === 0, "拒绝臂零注入");
    assert(r.completedActions === 0, "拒绝不耗注入预算（completedActions=0）");
    assert(h.confirm.captured.length === 1, "拒绝臂恰好一次 re-L2");
    const details = h.confirm.captured[0].details;
    assert(typeof details.code === "string" && details.code.includes(CAPTION), "reL2 caption 含「实验层建议…未校准，可能完全错误」");
    assert(JSON.stringify(details.dangerousApis || []).includes("computer.experimental_suggestion"), "dangerousApis 标实验层建议");
    assert(details.autoConfirmEligible === false, "实验层建议永不自动批准");
    const tcHits = h.logs.filter((l) => l.event === "computeruse.locate" && l.data?.layer === "tinyclick" && l.data?.hit === true);
    assert(tcHits.length === 1, `拒绝后无后续 tinyclick hit（实得 ${tcHits.length} 次）——降级链无污染`);
  }

  // === 7. 出口 4 批准臂 ============================================================
  {
    // per-task admission 重评（生产接线语义）——既有会话快路径 + 新 locator
    // 实例（坍缩历史任务级；两臂同帧同命令不互相抑制）。
    const adm2 = await resolveTinyClickAdmission({ config: getConfig().computer, holder });
    assert(adm2.locator !== null, "批准臂 per-task admission 重评通过");
    const h = mkDeps([true, true], adm2.locator); // G4 批准 + A1.3 续期批准
    // M1 形态：三个直接坐标点击在前（建预算上下文），续期门（A1.3「交叉验证」）
    // 随建议动作触发——单动作不耗续期窗口，与 executor M1 单测同形态。
    const actions = [
      ...[1, 2, 3].map((i) => ({ action: "click", x: 10 + i, y: 10 })),
      ACTION,
    ];
    const r = await runComputerTask({ task: "t", app: "win.app.test", actions }, h.deps);
    assert(r.success === true, `批准臂成功（实得 error=${r.error}）`);
    assert(h.injector.clicks.length === 4, "批准臂建议点真注入（3 直接 + 1 建议）");
    assert(r.completedActions === 4, "G4 批准后才耗预算（M1 挂钩；拒绝臂=0 对照）");
    assert(h.confirm.captured.length === 2, "G4 门 + A1.3 续期门各一次");
    const details = h.confirm.captured[0].details;
    assert(typeof details.code === "string" && details.code.includes(CAPTION), "批准臂 caption 契约同上");
    assert(typeof h.confirm.captured[1].details.code === "string" && h.confirm.captured[1].details.code.includes("交叉验证"), "第二窗 = A1.3 续期（批准后才计数）");
    const step = (r.steps || []).find((s) => s.layer === "tinyclick") || {};
    assert(step.layer === "tinyclick", "步骤 layer=tinyclick");
    assert(step.confidence === undefined, "confidence 缺省（G3 未校准不上链）");
    const rec = h.evidence.records.find((x) => x.action === "click" && x.layer === "tinyclick");
    assert(!!rec && rec.uncrossverified === true, "批准注入带 uncrossverified 标记（A1.3，证据链）");
    // 精度对账（非断言）：与 frozen 锚距离仅打印
    const frozen = JSON.parse(fs.readFileSync(frozenPath, "utf8"));
    const anchor = Object.values(frozen.golden || {}).find((a) => a && a.id === SMOKE_CASE_ID);
    const lastClick = h.injector.clicks[h.injector.clicks.length - 1];
    if (anchor && lastClick) {
      const dist = Math.hypot(lastClick.x - anchor.pred.x, lastClick.y - anchor.pred.y);
      info(`精度对账: 注入点 (${lastClick.x}, ${lastClick.y}) vs frozen 锚 (${anchor.pred.x}, ${anchor.pred.y})，dist=${dist.toFixed(1)}px（准确率臂归 golden 门禁）`);
      assert(dist <= 64, `注入点距 frozen 锚 ≤64px 冒烟级 sanity（实得 ${dist.toFixed(1)}px）`);
      assert(lastClick.x >= 0 && lastClick.x <= frame.width && lastClick.y >= 0 && lastClick.y <= frame.height, "注入点在帧域内");
    }
  }

  // --- 汇总 ------------------------------------------------------------------------
  if (failures > 0) {
    error(`${failures} 条断言失败`);
    process.exit(EXIT_FAIL);
  }
  ok(`全链路冒烟通过（variant=${args.variant}）`);
  process.exit(EXIT_OK);
}

main().catch((e) => {
  error(`未捕获异常: ${e && e.stack ? e.stack : e}`);
  process.exit(EXIT_SETUP);
});
