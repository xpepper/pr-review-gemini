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
      assert.equal(response.result.serverInfo.name, 'copilot-pr-review');
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

    it('handles tools/list returning pr_review_subagents, pr_review_diff, and pr_review_publish', async () => {
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
      assert.ok(toolNames.includes('pr_review_subagents'));
      assert.ok(toolNames.includes('pr_review_diff'));
      assert.ok(toolNames.includes('pr_review_publish'));

      const subagentsTool = response.result.tools.find((t) => t.name === 'pr_review_subagents');
      assert.ok(subagentsTool.description);
      assert.ok(subagentsTool.inputSchema.properties.prNumber);
      assert.ok(subagentsTool.inputSchema.properties.mode);
    });

    it('handles tools/call for pr_review_diff', async () => {
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
          name: 'pr_review_diff',
          arguments: { prNumber: 42 },
        },
      });

      assert.equal(response.id, 4);
      assert.ok(response.result.content);
      const parsed = JSON.parse(response.result.content[0].text);
      assert.equal(parsed.prNumber, 42);
      assert.equal(parsed.filesCount, 1);
      assert.equal(parsed.files[0].path, 'a.js');
    });

    it('handles tools/call for pr_review_subagents in mock dry-run', async () => {
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
          name: 'pr_review_subagents',
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
      assert.equal(responses[0].result.serverInfo.name, 'copilot-pr-review');

      server.close();
    });
  });
});
