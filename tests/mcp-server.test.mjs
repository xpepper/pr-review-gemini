import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { PassThrough } from 'node:stream';
import {
  createMcpHandler,
  MCP_TOOLS,
  startMcpServer,
} from '../server/index.js';

describe('Model Context Protocol (MCP) Server', () => {
  describe('mcp.json Manifest', () => {
    it('mcp.json exists and declares server configuration according to Agent Plugins 1.0', () => {
      const manifestPath = path.resolve('mcp.json');
      assert.ok(fs.existsSync(manifestPath), 'mcp.json must exist at repository root');

      const content = fs.readFileSync(manifestPath, 'utf8');
      const manifest = JSON.parse(content);

      assert.ok(manifest.name, 'mcp.json must declare server name');
      assert.ok(manifest.mcpServers || manifest.server, 'mcp.json must declare mcpServers or server');

      const serverConfig = manifest.server || manifest.mcpServers?.[manifest.name] || Object.values(manifest.mcpServers || {})[0];
      assert.ok(serverConfig, 'server configuration must be present');
      assert.equal(serverConfig.command, 'node');
      assert.ok(serverConfig.args.some((arg) => arg.includes('server/index.js')));
    });

    it('does not contain local machine absolute paths in mcp.json', () => {
      const manifestPath = path.resolve('mcp.json');
      const content = fs.readFileSync(manifestPath, 'utf8');
      assert.doesNotMatch(content, /\/Users\//);
      assert.doesNotMatch(content, /\/home\//);
    });
  });

  describe('createMcpHandler - JSON-RPC Protocol Handling', () => {
    it('handles initialize request with protocolVersion and serverInfo', async () => {
      const handler = createMcpHandler();
      const response = await handler.handleMessage({
        jsonrpc: '2.0',
        id: 1,
        method: 'initialize',
        params: {
          protocolVersion: '2024-11-05',
          capabilities: {},
          clientInfo: { name: 'copilot-cli', version: '1.0.0' },
        },
      });

      assert.equal(response.jsonrpc, '2.0');
      assert.equal(response.id, 1);
      assert.ok(response.result);
      assert.equal(response.result.protocolVersion, '2024-11-05');
      assert.equal(response.result.serverInfo.name, 'gem-pr-review');
      assert.ok(response.result.capabilities.tools);
    });

    it('handles ping request', async () => {
      const handler = createMcpHandler();
      const response = await handler.handleMessage({
        jsonrpc: '2.0',
        id: 2,
        method: 'ping',
      });

      assert.equal(response.jsonrpc, '2.0');
      assert.equal(response.id, 2);
      assert.deepEqual(response.result, {});
    });

    it('handles tools/list returning gem_pr_review_subagents, gem_pr_review_diff, and gem_pr_review_publish', async () => {
      const handler = createMcpHandler();
      const response = await handler.handleMessage({
        jsonrpc: '2.0',
        id: 3,
        method: 'tools/list',
      });

      assert.equal(response.jsonrpc, '2.0');
      assert.equal(response.id, 3);
      assert.ok(Array.isArray(response.result.tools));

      const toolNames = response.result.tools.map((t) => t.name);
      assert.ok(toolNames.includes('gem_pr_review_subagents'));
      assert.ok(toolNames.includes('gem_pr_review_diff'));
      assert.ok(toolNames.includes('gem_pr_review_publish'));
      assert.ok(toolNames.includes('gem_pr_review_publish_cached'));
      assert.ok(toolNames.includes('gem_pr_review_prior'));
      assert.ok(toolNames.includes('gem_pr_review_verify'));
      assert.ok(toolNames.includes('gem_self_review'));
      assert.ok(toolNames.includes('gem_pr_review_self'));

      const selfTool = response.result.tools.find((t) => t.name === 'gem_self_review');
      assert.ok(selfTool.description);
      assert.ok(selfTool.inputSchema.properties.scope);
      assert.ok(selfTool.inputSchema.properties.mode);
      assert.ok(selfTool.inputSchema.properties.failOn);

      const subagentsTool = response.result.tools.find((t) => t.name === 'gem_pr_review_subagents');
      assert.ok(subagentsTool.description);
      assert.ok(subagentsTool.inputSchema.properties.prNumber);
      assert.ok(subagentsTool.inputSchema.properties.mode);

      const priorTool = response.result.tools.find((t) => t.name === 'gem_pr_review_prior');
      assert.ok(priorTool.description);
      assert.ok(priorTool.inputSchema.properties.prNumber);
      assert.ok(priorTool.inputSchema.properties.currentHeadSha);
    });

    it('handles tools/call for gem_pr_review_diff', async () => {
      const mockDiff = `diff --git a/a.js b/a.js
index 1111111..2222222 100644
--- a/a.js
+++ b/a.js
@@ -1,2 +1,3 @@
 const x = 1;
+const y = 2;
`;
      const handler = createMcpHandler({
        getPrDiffFn: async () => mockDiff,
      });

      const response = await handler.handleMessage({
        jsonrpc: '2.0',
        id: 4,
        method: 'tools/call',
        params: {
          name: 'gem_pr_review_diff',
          arguments: { prNumber: 42 },
        },
      });

      assert.equal(response.id, 4);
      assert.ok(response.result.content);
      const parsed = JSON.parse(response.result.content[0].text);
      assert.equal(parsed.prNumber, 42);
      assert.equal(parsed.filesCount, 1);
      assert.equal(parsed.files[0].path, 'a.js');
      assert.equal(parsed.isLarge, false);
      assert.ok(parsed.manifest);
      assert.equal(parsed.manifest.totalFiles, 1);
      assert.equal(parsed.thresholdBytes, 200 * 1024);
    });

    it('handles tools/call for legacy pr_review_diff for backwards compatibility', async () => {
      const mockDiff = `diff --git a/a.js b/a.js
index 1111111..2222222 100644
--- a/a.js
+++ b/a.js
@@ -1,2 +1,3 @@
 const x = 1;
+const y = 2;
`;
      const handler = createMcpHandler({
        getPrDiffFn: async () => mockDiff,
      });

      const response = await handler.handleMessage({
        jsonrpc: '2.0',
        id: 44,
        method: 'tools/call',
        params: {
          name: 'pr_review_diff',
          arguments: { prNumber: 42 },
        },
      });

      assert.equal(response.id, 44);
      assert.ok(response.result.content);
      const parsed = JSON.parse(response.result.content[0].text);
      assert.equal(parsed.prNumber, 42);
    });

    it('handles tools/call for gem_pr_review_diff_read with read, grep, and find operations', async () => {
      const mockDiff = `diff --git a/service.js b/service.js
index 1111111..2222222 100644
--- a/service.js
+++ b/service.js
@@ -1,3 +1,4 @@
 function execute() {
+  const token = "secret";
   return token;
 }
`;
      const handler = createMcpHandler({
        getPrDiffFn: async () => mockDiff,
      });

      // 1. read operation
      const readRes = await handler.handleMessage({
        jsonrpc: '2.0',
        id: 51,
        method: 'tools/call',
        params: {
          name: 'gem_pr_review_diff_read',
          arguments: { prNumber: 7, operation: 'read', file: 'service.js' },
        },
      });
      assert.equal(readRes.id, 51);
      const readParsed = JSON.parse(readRes.result.content[0].text);
      assert.equal(readParsed.prNumber, 7);
      assert.equal(readParsed.operation, 'read');
      assert.ok(readParsed.result.content.includes('const token = "secret"'));
      assert.equal(readParsed.budgetState.readsCount, 1);

      // 2. grep operation
      const grepRes = await handler.handleMessage({
        jsonrpc: '2.0',
        id: 52,
        method: 'tools/call',
        params: {
          name: 'gem_pr_review_diff_read',
          arguments: { prNumber: 7, operation: 'grep', query: 'secret' },
        },
      });
      assert.equal(grepRes.id, 52);
      const grepParsed = JSON.parse(grepRes.result.content[0].text);
      assert.equal(grepParsed.operation, 'grep');
      assert.equal(grepParsed.result.matches.length, 1);
      assert.equal(grepParsed.result.matches[0].file, 'service.js');

      // 3. find operation
      const findRes = await handler.handleMessage({
        jsonrpc: '2.0',
        id: 53,
        method: 'tools/call',
        params: {
          name: 'gem_pr_review_diff_read',
          arguments: { prNumber: 7, operation: 'find', query: 'service' },
        },
      });
      assert.equal(findRes.id, 53);
      const findParsed = JSON.parse(findRes.result.content[0].text);
      assert.equal(findParsed.operation, 'find');
      assert.equal(findParsed.result.files.length, 1);
      assert.equal(findParsed.result.files[0].path, 'service.js');
    });

    it('handles tools/call for gem_pr_review_subagents in mock dry-run', async () => {
      const mockDiff = `diff --git a/app.js b/app.js
index 1111111..2222222 100644
--- a/app.js
+++ b/app.js
@@ -1,2 +1,3 @@
+console.log("secure");
`;
      const handler = createMcpHandler({
        getPrDiffFn: async () => mockDiff,
        runnerFn: async () => '<<<PR_REVIEW_JSON>>>[]<<<END_PR_REVIEW_JSON>>>',
      });

      const response = await handler.handleMessage({
        jsonrpc: '2.0',
        id: 5,
        method: 'tools/call',
        params: {
          name: 'gem_pr_review_subagents',
          arguments: {
            prNumber: 99,
            mode: 'quick',
            dryRun: true,
          },
        },
      });

      assert.equal(response.id, 5);
      const resultData = JSON.parse(response.result.content[0].text);
      assert.equal(resultData.prNumber, 99);
      assert.equal(resultData.mode, 'quick');
      assert.equal(resultData.findings.length, 0);
      assert.ok(resultData.summary.includes('PR Review Summary'));
    });

    it('handles tools/call for gem_pr_review_prior', async () => {
      const handler = createMcpHandler({
        fetchPriorReviewsFn: async () => ({
          latestReview: { id: 101, commitId: 'abc111' },
          findings: [{ filePath: 'src/app.js', line: 10, severity: 'P1', title: 'Test issue' }],
        }),
        classifyCommitRelationshipFn: async () => ({
          relationship: 'incremental',
          priorHeadSha: 'abc111',
          currentHeadSha: 'def222',
          canIncremental: true,
          reason: 'Current head directly extends prior commit.',
        }),
        getIncrementalDiffFn: async () => 'diff --git a/src/app.js b/src/app.js\n...',
      });

      const response = await handler.handleMessage({
        jsonrpc: '2.0',
        id: 55,
        method: 'tools/call',
        params: {
          name: 'gem_pr_review_prior',
          arguments: {
            prNumber: 42,
            currentHeadSha: 'def222',
          },
        },
      });

      assert.equal(response.id, 55);
      const resultData = JSON.parse(response.result.content[0].text);
      assert.equal(resultData.prNumber, 42);
      assert.equal(resultData.relationship, 'incremental');
      assert.equal(resultData.canIncremental, true);
    });

    it('handles tools/call for gem_pr_review_publish_cached', async () => {
      let publishCachedCalledWith = null;
      const handler = createMcpHandler({
        publishCachedReviewFn: async (args) => {
          publishCachedCalledWith = args;
          return {
            published: true,
            reviewId: 555,
            publishedCount: 1,
            totalCachedCount: 2,
            summary: 'Review published from cache.',
          };
        },
      });

      const response = await handler.handleMessage({
        jsonrpc: '2.0',
        id: 56,
        method: 'tools/call',
        params: {
          name: 'gem_pr_review_publish_cached',
          arguments: {
            prNumber: 77,
            repo: 'xpepper/test',
            expectedHeadSha: 'sha77',
            selectedIndices: [0],
          },
        },
      });

      assert.equal(response.id, 56);
      const resultData = JSON.parse(response.result.content[0].text);
      assert.equal(resultData.published, true);
      assert.equal(resultData.reviewId, 555);
      assert.equal(resultData.publishedCount, 1);
      assert.ok(publishCachedCalledWith);
      assert.equal(publishCachedCalledWith.prNumber, 77);
      assert.equal(publishCachedCalledWith.headSha, 'sha77');
      assert.deepEqual(publishCachedCalledWith.selectedIndices, [0]);
    });

    it('handles tools/call for gem_self_review and returns fail-closed result', async () => {
      let runSelfReviewArgs = null;
      const handler = createMcpHandler({
        runSelfReviewFn: async (args) => {
          runSelfReviewArgs = args;
          return {
            status: 'failed',
            verdict: 'FAIL',
            mode: args.mode || 'balanced',
            blockingCount: 1,
            counts: { P0: 0, P1: 1, P2: 0, P3: 0, nit: 0 },
            findings: [
              { severity: 'P1', title: 'Unhandled rejection', file: 'src/app.js', line: 12 },
            ],
            remediation: [
              { severity: 'P1', title: 'Unhandled rejection', file: 'src/app.js', line: 12, remediation: 'Add await' },
            ],
            summary: '# ❌ SELF-REVIEW FAILED (FAIL)',
          };
        },
      });

      const response = await handler.handleMessage({
        jsonrpc: '2.0',
        id: 70,
        method: 'tools/call',
        params: {
          name: 'gem_self_review',
          arguments: {
            scope: 'staged',
            mode: 'quick',
            failOn: 'P1',
            includeUntracked: false,
          },
        },
      });

      assert.equal(response.id, 70);
      const data = JSON.parse(response.result.content[0].text);
      assert.equal(data.status, 'failed');
      assert.equal(data.verdict, 'FAIL');
      assert.equal(data.blockingCount, 1);
      assert.equal(data.findings.length, 1);
      assert.ok(data.summary.includes('SELF-REVIEW FAILED'));

      assert.ok(runSelfReviewArgs);
      assert.equal(runSelfReviewArgs.scope, 'staged');
      assert.equal(runSelfReviewArgs.mode, 'quick');
      assert.equal(runSelfReviewArgs.failOn, 'P1');
      assert.equal(runSelfReviewArgs.includeUntracked, false);
    });

    it('handles tools/call for backward-compatible alias gem_pr_review_self', async () => {
      let called = false;
      const handler = createMcpHandler({
        runSelfReviewFn: async () => {
          called = true;
          return {
            status: 'passed',
            verdict: 'PASS',
            blockingCount: 0,
            counts: { P0: 0, P1: 0, P2: 0, P3: 0, nit: 0 },
            findings: [],
            summary: '# ✅ SELF-REVIEW PASSED (PASS)',
          };
        },
      });

      const response = await handler.handleMessage({
        jsonrpc: '2.0',
        id: 71,
        method: 'tools/call',
        params: {
          name: 'gem_pr_review_self',
          arguments: {},
        },
      });

      assert.equal(response.id, 71);
      assert.equal(called, true);
      const data = JSON.parse(response.result.content[0].text);
      assert.equal(data.verdict, 'PASS');
    });

    it('declares custom roles and composition options in gem_pr_review_subagents and gem_self_review schemas', () => {
      const subagentsTool = MCP_TOOLS.find((t) => t.name === 'gem_pr_review_subagents');
      assert.ok(subagentsTool.inputSchema.properties.roles);
      assert.ok(subagentsTool.inputSchema.properties.replaceStandardRoles);
      assert.ok(subagentsTool.inputSchema.properties.customRoles);

      const selfTool = MCP_TOOLS.find((t) => t.name === 'gem_self_review');
      assert.ok(selfTool.inputSchema.properties.roles);
      assert.ok(selfTool.inputSchema.properties.replaceStandardRoles);
      assert.ok(selfTool.inputSchema.properties.customRoles);
    });

    it('handles tools/call for gem_pr_review_subagents with custom roles and composition options', async () => {
      let passedReviewArgs = null;
      const handler = createMcpHandler({
        runReviewFn: async (args) => {
          passedReviewArgs = args;
          return {
            prNumber: args.prNumber,
            lensesExecuted: args.roles || ['a11y'],
            findings: [],
            summary: 'Review summary',
          };
        },
      });

      const response = await handler.handleMessage({
        jsonrpc: '2.0',
        id: 72,
        method: 'tools/call',
        params: {
          name: 'gem_pr_review_subagents',
          arguments: {
            prNumber: 55,
            roles: ['a11y'],
            replaceStandardRoles: true,
            customRoles: {
              a11y: { name: 'A11y', prompt: 'Check accessibility' },
            },
            diffText: 'diff --git a/a.js b/a.js\n+1',
          },
        },
      });

      assert.equal(response.id, 72);
      assert.ok(passedReviewArgs);
      assert.deepEqual(passedReviewArgs.roles, ['a11y']);
      assert.equal(passedReviewArgs.replaceStandardRoles, true);
      assert.ok(passedReviewArgs.customRoles?.a11y);
    });

    it('handles tools/call for gem_self_review with custom roles and composition options', async () => {
      let passedSelfReviewArgs = null;
      const handler = createMcpHandler({
        runSelfReviewFn: async (args) => {
          passedSelfReviewArgs = args;
          return {
            status: 'passed',
            verdict: 'PASS',
            blockingCount: 0,
            counts: { P0: 0, P1: 0, P2: 0, P3: 0, nit: 0 },
            findings: [],
            lenses: args.roles || ['migrations'],
            summary: '# ✅ SELF-REVIEW PASSED (PASS)',
          };
        },
      });

      const response = await handler.handleMessage({
        jsonrpc: '2.0',
        id: 73,
        method: 'tools/call',
        params: {
          name: 'gem_self_review',
          arguments: {
            roles: ['migrations'],
            replaceStandardRoles: true,
            customRoles: {
              migrations: { name: 'Migrations', prompt: 'Check DB migrations' },
            },
          },
        },
      });

      assert.equal(response.id, 73);
      assert.ok(passedSelfReviewArgs);
      assert.deepEqual(passedSelfReviewArgs.roles, ['migrations']);
      assert.equal(passedSelfReviewArgs.replaceStandardRoles, true);
      assert.ok(passedSelfReviewArgs.customRoles?.migrations);
    });

    it('returns error for unknown method with code -32601', async () => {
      const handler = createMcpHandler();
      const response = await handler.handleMessage({
        jsonrpc: '2.0',
        id: 6,
        method: 'unknown/method',
      });

      assert.equal(response.id, 6);
      assert.equal(response.error.code, -32601);
      assert.match(response.error.message, /Method not found/);
    });

    it('returns tool error for unknown tool name', async () => {
      const handler = createMcpHandler();
      const response = await handler.handleMessage({
        jsonrpc: '2.0',
        id: 7,
        method: 'tools/call',
        params: { name: 'non_existent_tool', arguments: {} },
      });

      assert.equal(response.id, 7);
      assert.equal(response.result.isError, true);
      assert.match(response.result.content[0].text, /Unknown tool/);
    });

    it('handles gem_pr_review_guidelines and pr_review_guidelines inspection tools (Increment 19)', async () => {
      const mockLoadGuidelines = () => ({
        enabled: true,
        found: true,
        path: '/mock/.github/gem-pr-review.md',
        relativePath: '.github/gem-pr-review.md',
        byteSize: 128,
        truncated: false,
        rawContent: '# Mock Rules',
        parsed: { global: 'Mock Rules', lenses: {}, sections: [] },
      });

      const handler = createMcpHandler({
        loadGuidelinesFn: mockLoadGuidelines,
      });

      const response = await handler.handleMessage({
        jsonrpc: '2.0',
        id: 80,
        method: 'tools/call',
        params: {
          name: 'gem_pr_review_guidelines',
          arguments: {},
        },
      });

      assert.equal(response.id, 80);
      assert.ok(response.result?.content?.[0]?.text);
      const parsed = JSON.parse(response.result.content[0].text);
      assert.equal(parsed.enabled, true);
      assert.equal(parsed.found, true);
      assert.equal(parsed.relativePath, '.github/gem-pr-review.md');
      assert.equal(parsed.byteSize, 128);
    });

    it('passes guidelinesPath to runReviewFn and runSelfReviewFn in MCP handlers (Increment 19)', async () => {
      let passedReviewArgs = null;
      let passedSelfReviewArgs = null;

      const handler = createMcpHandler({
        getPrDiffFn: async () => 'diff --git a/app.js b/app.js\n+test',
        runReviewFn: async (args) => {
          passedReviewArgs = args;
          return { prNumber: args.prNumber, findings: [] };
        },
        runSelfReviewFn: async (args) => {
          passedSelfReviewArgs = args;
          return { status: 'passed', findings: [] };
        },
      });

      await handler.handleMessage({
        jsonrpc: '2.0',
        id: 81,
        method: 'tools/call',
        params: {
          name: 'gem_pr_review_subagents',
          arguments: {
            prNumber: 99,
            guidelinesPath: 'custom-guidelines.md',
          },
        },
      });

      assert.ok(passedReviewArgs);
      assert.equal(passedReviewArgs.guidelinesPath, 'custom-guidelines.md');

      await handler.handleMessage({
        jsonrpc: '2.0',
        id: 82,
        method: 'tools/call',
        params: {
          name: 'gem_self_review',
          arguments: {
            guidelinesPath: 'self-guidelines.md',
          },
        },
      });

      assert.ok(passedSelfReviewArgs);
      assert.equal(passedSelfReviewArgs.guidelinesPath, 'self-guidelines.md');
    });
  });

  describe('startMcpServer stream processing', () => {
    it('processes line-delimited JSON-RPC messages over stdio streams', async () => {
      const inputStream = new PassThrough();
      const outputStream = new PassThrough();

      const server = startMcpServer({
        input: inputStream,
        output: outputStream,
        getPrDiffFn: async () => 'mock diff',
      });

      const responses = [];
      outputStream.on('data', (chunk) => {
        const lines = chunk.toString().split('\n').filter((l) => l.trim());
        for (const line of lines) {
          responses.push(JSON.parse(line));
        }
      });

      // Send initialize message
      inputStream.write(JSON.stringify({
        jsonrpc: '2.0',
        id: 10,
        method: 'initialize',
        params: { protocolVersion: '2024-11-05' },
      }) + '\n');

      // Wait a tick for response
      await new Promise((resolve) => setTimeout(resolve, 50));

      assert.equal(responses.length, 1);
      assert.equal(responses[0].id, 10);
      assert.equal(responses[0].result.serverInfo.name, 'gem-pr-review');

      server.close();
    });
  });
});
