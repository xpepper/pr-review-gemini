/**
 * src/diagnostics.js — Safe Verbose Review Diagnostics & Execution Telemetry
 *
 * Implements structured, redacted telemetry collection across review phases:
 * - Phase execution timing (diff fetch, guidelines, subagents, architecture, caching, publishing)
 * - Configuration & model resolution telemetry (modes, roles, models, fallback attempts)
 * - Diff and guideline metadata (sizes, truncation, file count, transport threshold)
 * - Cache outcomes (hit/miss, cache file path, head freshness)
 * - Per-lens execution lifecycle, duration, status, and error classification
 * - Finding classification, hunk anchoring, demotion, and confidence stats
 * - Publication & safety gate decisions (stale-head check, comment capping, quality gates)
 * - Strict redaction guarantees: zero exposure of prompt/diff bodies, tokens, credentials, or machine paths
 */
import path from 'node:path';
import { PLUGIN_VERSION } from './version.js';

/**
 * Disallowed keys that must never be serialized in diagnostics telemetry
 * to prevent leaking raw prompts, diff bodies, or environment values.
 */
const FORBIDDEN_TELEMETRY_KEYS = new Set([
  'prompt',
  'promptBody',
  'customInstructions',
  'diffText',
  'unifiedDiffText',
  'incrementalDiffText',
  'rawDiff',
  'env',
  'headers',
  'authorization',
  'cookie',
]);

/**
 * Key names that signal sensitive material regardless of their values.
 * Applied on top of the exact-match forbidden set so secret-named keys
 * from untrusted (caller-supplied) telemetry objects are dropped too.
 */
const SENSITIVE_KEY_NAME_PATTERN =
  /(token|secret|passw(or)?d|passwd|passphrase|credential|api[-_]?key|private[-_]?key|access[-_]?key|authorization|cookie)/i;

/**
 * Sensitive token patterns to redact.
 */
const TOKEN_PATTERNS = [
  /ghp_[a-zA-Z0-9]{20,}/g,
  /github_pat_[a-zA-Z0-9_]{20,}/g,
  /gho_[a-zA-Z0-9]{20,}/g,
  /ghu_[a-zA-Z0-9]{20,}/g,
  /ghs_[a-zA-Z0-9]{20,}/g,
  /ghr_[a-zA-Z0-9]{20,}/g,
  /Bearer\s+[a-zA-Z0-9_\-\.]{15,}/gi,
];

/**
 * Machine path patterns to detect and sanitize across macOS, Linux, and Windows.
 */
const MACHINE_PATH_PATTERNS = [
  /\/Users\/[^\s"',;:\)\]]+/g,
  /\/home\/[^\s"',;:\)\]]+/g,
  /[a-zA-Z]:\\[^\s"',;:\)\]]+/g,
  /\/private\/var\/[^\s"',;:\)\]]+/g,
  /\/var\/[^\s"',;:\)\]]+/g,
  /\/tmp\/[^\s"',;:\)\]]+/g,
];

/**
 * Redacts sensitive tokens and absolute machine paths from a string.
 *
 * @param {string} str
 * @param {object} [options={}]
 * @param {string} [options.cwd]
 * @returns {string}
 */
export function redactSensitiveString(str, options = {}) {
  if (typeof str !== 'string' || !str) {
    return str;
  }

  let result = str;

  // Redact known auth tokens
  for (const pattern of TOKEN_PATTERNS) {
    result = result.replace(pattern, (match) => {
      if (match.toLowerCase().startsWith('bearer ')) {
        return 'Bearer [REDACTED_TOKEN]';
      }
      return '[REDACTED_TOKEN]';
    });
  }

  // Redact passwords / secret values in key-value format
  result = result.replace(
    /((?:password|secret|api[_-]?key|auth[_-]?token)\s*[:=]\s*["']?)([^"',\s;]+)(["']?)/gi,
    '$1[REDACTED]$3'
  );

  const cwd = options.cwd || process.cwd();

  // Replace cwd occurrences with relative representation
  if (cwd) {
    const cwdWithSlash = cwd.endsWith('/') ? cwd : `${cwd}/`;
    if (result.includes(cwdWithSlash)) {
      result = result.replaceAll(cwdWithSlash, '');
    } else if (result.includes(cwd)) {
      result = result.replaceAll(cwd, '.');
    }
  }

  // Replace standard developer machine paths
  for (const pattern of MACHINE_PATH_PATTERNS) {
    result = result.replace(pattern, (match) => {
      // If path falls inside cwd, make relative
      if (cwd && match.startsWith(cwd)) {
        const rel = path.relative(cwd, match).replace(/\\/g, '/');
        return rel;
      }
      // If path points to relative cache or guidelines, retain clean relative part
      if (match.includes('.gem-pr-cache/')) {
        return match.slice(match.indexOf('.gem-pr-cache/'));
      }
      if (match.includes('.github/')) {
        return match.slice(match.indexOf('.github/'));
      }
      return '[REDACTED_PATH]';
    });
  }

  // Scrub any residual user home directory occurrences
  result = result.replace(/\/Users\/[a-zA-Z0-9_\-]+/g, '[REDACTED_PATH]');
  result = result.replace(/\/home\/[a-zA-Z0-9_\-]+/g, '[REDACTED_PATH]');

  return result;
}

/**
 * Recursively sanitizes data structures to prevent sensitive data leakage.
 *
 * @param {any} data
 * @param {object} [options={}]
 * @returns {any}
 */
export function sanitizeTelemetry(data, options = {}) {
  if (data === null || data === undefined) {
    return data;
  }

  if (typeof data === 'string') {
    return redactSensitiveString(data, options);
  }

  if (typeof data === 'number' || typeof data === 'boolean') {
    return data;
  }

  if (Array.isArray(data)) {
    return data.map((item) => sanitizeTelemetry(item, options));
  }

  if (typeof data === 'object') {
    const sanitized = {};
    for (const [key, value] of Object.entries(data)) {
      if (FORBIDDEN_TELEMETRY_KEYS.has(key) || SENSITIVE_KEY_NAME_PATTERN.test(key)) {
        continue;
      }
      sanitized[key] = sanitizeTelemetry(value, options);
    }
    return sanitized;
  }

  return String(data);
}

/**
 * Creates an execution diagnostics telemetry collector.
 *
 * @param {object} [options={}]
 * @param {boolean} [options.verbose=false]
 * @param {string} [options.cwd=process.cwd()]
 * @returns {object} Diagnostics collector instance
 */
export function createDiagnosticsCollector(options = {}) {
  const cwd = options.cwd || process.cwd();
  const verbose = Boolean(options.verbose);

  let startTime = null;
  let endTime = null;
  let totalDurationMs = null;

  const phases = {};
  let configTelemetry = {};
  let diffTelemetry = {};
  let guidelinesTelemetry = null;
  let cacheTelemetry = null;
  const lensLifecycles = [];
  let findingsTelemetry = {
    total: 0,
    anchored: 0,
    demoted: 0,
    severities: { P0: 0, P1: 0, P2: 0, P3: 0, nit: 0 },
    confidence: { min: null, max: null, avg: null },
  };
  let safetyDecisions = {
    staleHeadPassed: null,
    commentsCapped: false,
    inlineCommentsCount: 0,
    maxInlineComments: 50,
    verdict: null,
    qualityGate: null,
  };

  return {
    verbose,

    start(timestamp = Date.now()) {
      startTime = timestamp;
      return this;
    },

    end(timestamp = Date.now()) {
      endTime = timestamp;
      if (startTime !== null) {
        totalDurationMs = Math.max(0, endTime - startTime);
      }
      return this;
    },

    startPhase(name, timestamp = Date.now()) {
      phases[name] = {
        startTime: timestamp,
        endTime: null,
        durationMs: null,
        status: 'running',
      };
      return this;
    },

    endPhase(name, metadata = {}, timestamp = Date.now()) {
      const phase = phases[name] || { startTime: timestamp };
      phase.endTime = timestamp;
      if (phase.startTime !== null) {
        phase.durationMs = Math.max(0, phase.endTime - phase.startTime);
      }
      phase.status = metadata.status || (metadata.error ? 'failed' : 'completed');
      Object.assign(phase, metadata);
      phases[name] = phase;
      return this;
    },

    async measurePhase(name, fn) {
      this.startPhase(name);
      try {
        const result = await fn();
        const meta =
          result && typeof result === 'object' && !Array.isArray(result)
            ? { ...result }
            : {};
        this.endPhase(name, meta);
        return result;
      } catch (err) {
        this.endPhase(name, {
          status: 'failed',
          error: err?.message || String(err),
        });
        throw err;
      }
    },

    recordConfig(cfg = {}) {
      const sanitizedCfg = { ...cfg };
      for (const forbidden of FORBIDDEN_TELEMETRY_KEYS) {
        delete sanitizedCfg[forbidden];
      }
      configTelemetry = { ...configTelemetry, ...sanitizedCfg };
      return this;
    },

    recordDiffMetadata(diffMeta = {}) {
      const sanitizedMeta = { ...diffMeta };
      for (const forbidden of FORBIDDEN_TELEMETRY_KEYS) {
        delete sanitizedMeta[forbidden];
      }
      diffTelemetry = { ...diffTelemetry, ...sanitizedMeta };
      return this;
    },

    recordGuidelinesMetadata(glMeta = {}) {
      guidelinesTelemetry = { ...glMeta };
      return this;
    },

    recordCacheMetadata(cacheMeta = {}) {
      cacheTelemetry = { ...cacheMeta };
      return this;
    },

    recordLensLifecycle(lensData) {
      if (!lensData || !lensData.lensId) return this;
      const index = lensLifecycles.findIndex((l) => l.lensId === lensData.lensId);
      const sanitizedLens = { ...lensData };
      for (const forbidden of FORBIDDEN_TELEMETRY_KEYS) {
        delete sanitizedLens[forbidden];
      }
      if (index >= 0) {
        lensLifecycles[index] = { ...lensLifecycles[index], ...sanitizedLens };
      } else {
        lensLifecycles.push(sanitizedLens);
      }
      return this;
    },

    recordFindingsClassification(classification = {}) {
      findingsTelemetry = {
        ...findingsTelemetry,
        ...classification,
        severities: {
          ...findingsTelemetry.severities,
          ...(classification.severities || {}),
        },
        confidence: {
          ...findingsTelemetry.confidence,
          ...(classification.confidence || {}),
        },
      };
      return this;
    },

    recordSafetyDecisions(decisions = {}) {
      safetyDecisions = {
        ...safetyDecisions,
        ...decisions,
      };
      return this;
    },

    toObject() {
      const raw = {
        version: PLUGIN_VERSION,
        timestamp: new Date(startTime || Date.now()).toISOString(),
        durationMs: totalDurationMs,
        phases,
        config: configTelemetry,
        diff: diffTelemetry,
        guidelines: guidelinesTelemetry,
        cache: cacheTelemetry,
        lenses: lensLifecycles,
        findings: findingsTelemetry,
        safetyDecisions,
      };

      return sanitizeTelemetry(raw, { cwd });
    },

    toJson(indent = 2) {
      return formatDiagnosticsJson(this.toObject(), { indent });
    },

    toMarkdown(reportOptions = {}) {
      return formatDiagnosticReport(this.toObject(), reportOptions);
    },
  };
}

/**
 * Formats a clean Markdown diagnostic report.
 *
 * @param {object} diagnostics
 * @param {object} [options={}]
 * @returns {string}
 */
export function formatDiagnosticReport(diagnostics, options = {}) {
  if (!diagnostics || typeof diagnostics !== 'object') {
    return '### 🔬 Review Execution Diagnostics\n- No diagnostic telemetry available.';
  }

  const lines = ['### 🔬 Review Execution Diagnostics'];

  // Mode and active lenses
  const mode = diagnostics.config?.mode || 'balanced';
  const lenses = diagnostics.lenses || [];
  const lensNames = lenses
    .map((l) => l.name || l.lensId)
    .filter(Boolean)
    .join(', ');
  lines.push(
    `- **Mode & Lenses**: \`${mode}\` (${lenses.length} lens${lenses.length === 1 ? '' : 'es'} executed${lensNames ? `: ${lensNames}` : ''})`
  );

  // Phase Timing
  const totalMs = diagnostics.durationMs != null ? `${diagnostics.durationMs}ms` : 'N/A';
  const timingParts = [`Total: ${totalMs}`];

  if (diagnostics.phases) {
    if (diagnostics.phases.diffFetch?.durationMs != null) {
      timingParts.push(`Diff: ${diagnostics.phases.diffFetch.durationMs}ms`);
    }
    if (diagnostics.phases.guidelines?.durationMs != null) {
      timingParts.push(`Guidelines: ${diagnostics.phases.guidelines.durationMs}ms`);
    }
    if (diagnostics.phases.subagents?.durationMs != null) {
      timingParts.push(`Subagents: ${diagnostics.phases.subagents.durationMs}ms`);
    }
    if (diagnostics.phases.architecture?.durationMs != null) {
      timingParts.push(`Architecture: ${diagnostics.phases.architecture.durationMs}ms`);
    }
    if (diagnostics.phases.verification?.durationMs != null) {
      timingParts.push(`Verification: ${diagnostics.phases.verification.durationMs}ms`);
    }
    if (diagnostics.phases.caching?.durationMs != null) {
      timingParts.push(`Cache: ${diagnostics.phases.caching.durationMs}ms`);
    }
    if (diagnostics.phases.publishing?.durationMs != null) {
      timingParts.push(`Publish: ${diagnostics.phases.publishing.durationMs}ms`);
    }
  }
  lines.push(`- **Phase Timing**: ${timingParts.join(' | ')}`);

  // Diff metadata
  if (diagnostics.diff && typeof diagnostics.diff.totalBytes === 'number') {
    const kb = (diagnostics.diff.totalBytes / 1024).toFixed(1);
    const files = diagnostics.diff.totalFiles != null ? `${diagnostics.diff.totalFiles} files` : 'files unknown';
    const paging = diagnostics.diff.isLarge ? 'active (> 200 KB)' : 'disabled';
    lines.push(`- **Diff Metadata**: ${kb} KB (${files}, file-backed paging: ${paging})`);
  }

  // Guidelines metadata
  if (diagnostics.guidelines) {
    const gl = diagnostics.guidelines;
    if (gl.found) {
      const bytes = gl.bytes != null ? `${gl.bytes} bytes` : '';
      const auth = gl.untrusted ? '⚠️ untrusted' : 'authentic';
      const trunc = gl.truncated ? '⚠️ truncated' : 'not truncated';
      lines.push(
        `- **Guidelines**: \`${gl.path || 'guidelines'}\` (${[bytes, auth, trunc].filter(Boolean).join(', ')})`
      );
    } else {
      lines.push(`- **Guidelines**: ${gl.enabled ? 'None discovered' : 'Disabled'}`);
    }
  }

  // Cache status
  if (diagnostics.cache) {
    const c = diagnostics.cache;
    let cacheLabel = c.hit ? 'Hit (cached review retained)' : 'Miss (fresh analysis)';
    if (c.headFreshness === 'stale') {
      cacheLabel += ' — ⚠️ Stale head detected';
    }
    lines.push(`- **Cache Status**: ${cacheLabel}`);
  }

  // Per-lens execution lifecycle
  if (lenses.length > 0) {
    lines.push('- **Per-Lens Execution**:');
    for (const lens of lenses) {
      const name = lens.name || lens.lensId;
      const statusIcon = lens.status === 'completed' ? '✔' : lens.status === 'retried' ? '🔄' : '❌';
      const dur = lens.durationMs != null ? `${lens.durationMs}ms` : 'N/A';
      const model = lens.model ? `, model: \`${lens.model}\`` : '';
      const findings = lens.findingsCount != null ? `, findings: ${lens.findingsCount}` : '';
      const retries = lens.fallbacksUsed ? `, retried ${lens.fallbacksUsed}x` : '';
      const err = lens.error ? ` — Error: ${lens.error}` : '';
      lines.push(`  - ${statusIcon} **${name}**: ${lens.status} (${dur}${model}${findings}${retries})${err}`);
    }
  }

  // Findings classification
  if (diagnostics.findings) {
    const f = diagnostics.findings;
    const total = f.total ?? 0;
    const anchored = f.anchored ?? 0;
    const demoted = f.demoted ?? 0;
    const sevParts = f.severities
      ? Object.entries(f.severities)
          .filter(([, count]) => count > 0)
          .map(([sev, count]) => `${sev}: ${count}`)
          .join(', ')
      : '';
    const avgConf =
      f.confidence?.avg != null ? `, avg confidence: ${Math.round(f.confidence.avg * 100)}%` : '';
    lines.push(
      `- **Findings & Anchoring**: ${total} detected (${anchored} anchored inline, ${demoted} demoted to summary${sevParts ? `; ${sevParts}` : ''}${avgConf})`
    );
  }

  // Safety & publication decisions
  if (diagnostics.safetyDecisions) {
    const s = diagnostics.safetyDecisions;
    const parts = [];
    if (s.staleHeadPassed !== null && s.staleHeadPassed !== undefined) {
      parts.push(`Stale-head check: ${s.staleHeadPassed ? 'passed' : 'failed'}`);
    }
    if (s.inlineCommentsCount != null) {
      const cappedNotice = s.commentsCapped ? ' (capped)' : '';
      parts.push(`Inline comments: ${s.inlineCommentsCount}/${s.maxInlineComments || 50}${cappedNotice}`);
    }
    if (s.verdict) {
      parts.push(`Verdict: ${s.verdict}`);
    }
    if (s.qualityGate) {
      parts.push(`Quality gate: ${s.qualityGate.passed ? 'passed' : 'failed'}`);
    }
    if (parts.length > 0) {
      lines.push(`- **Safety & Publication Decisions**: ${parts.join(' | ')}`);
    }
  }

  return lines.join('\n');
}

/**
 * Formats diagnostics telemetry as JSON string.
 *
 * @param {object} diagnostics
 * @param {object} [options={}]
 * @param {number} [options.indent=2]
 * @returns {string}
 */
export function formatDiagnosticsJson(diagnostics, options = {}) {
  const indent = options.indent ?? 2;
  return JSON.stringify(diagnostics, null, indent);
}
