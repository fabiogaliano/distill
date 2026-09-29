import { isAbsolute, relative, resolve } from 'path';
import { query, type CanUseTool, type EffortLevel, type SDKResultMessage } from '@anthropic-ai/claude-agent-sdk';
import type { ModelSpec } from '../types';

export interface AgentTask {
  prompt: string;
  cwd: string;
  // Directories the agent may read and search.
  readable: string[];
  // Files or directories the agent may create or edit.
  writable: string[];
  maxTurns?: number;
}

export interface AgentResult {
  text: string;
  isError: boolean;
  turns: number;
  costUsd: number;
  durationMs: number;
}

export type Agent = (task: AgentTask) => Promise<AgentResult>;

const TOOLS = ['Read', 'Glob', 'Grep', 'Write', 'Edit'];
const READ_TOOLS = new Set(['Read', 'Glob', 'Grep']);
const WRITE_TOOLS = new Set(['Write', 'Edit']);

const SYSTEM_PROMPT =
  'You work on files in a reading library on disk. Use your tools to read the sources the task names and to write the files it asks for. Finish by replying with one line saying what you wrote.';

const within = (path: string, roots: string[]) =>
  roots.some(root => {
    const rel = relative(root, path);
    return rel === '' || (!rel.startsWith('..') && !isAbsolute(rel));
  });

// Glob accepts an absolute pattern with no path, which would otherwise pass as cwd.
function absoluteGlobBase(pattern: unknown): string | undefined {
  if (typeof pattern !== 'string' || !isAbsolute(pattern)) return undefined;
  const wildcard = pattern.search(/[*?[{]/);
  return wildcard === -1 ? pattern : pattern.slice(0, pattern.lastIndexOf('/', wildcard) + 1) || '/';
}

// Every tool call is checked against the task's paths, so a model mistake can't
// read outside the sources or write outside the skill.
export function pathGuard(task: Pick<AgentTask, 'cwd' | 'readable' | 'writable'>): CanUseTool {
  const readable = task.readable.map(p => resolve(p));
  const writable = task.writable.map(p => resolve(p));
  return async (tool, input) => {
    const raw = input.file_path ?? input.path ?? absoluteGlobBase(input.pattern);
    const path = resolve(task.cwd, typeof raw === 'string' ? raw : '.');
    if (READ_TOOLS.has(tool) && within(path, [...readable, ...writable])) return { behavior: 'allow', updatedInput: input };
    if (WRITE_TOOLS.has(tool) && within(path, writable)) return { behavior: 'allow', updatedInput: input };
    return { behavior: 'deny', message: `${tool} is not allowed on ${path} in this task` };
  };
}

export function claudeAgent(spec: ModelSpec): Agent {
  if (spec.provider !== 'claude-sdk') {
    throw new Error(`Skill building runs through the Claude Agent SDK; role uses provider "${spec.provider}"`);
  }
  return async task => {
    let result: SDKResultMessage | undefined;
    const messages = query({
      prompt: task.prompt,
      // Same isolation as plain calls (no CLAUDE.md, MCP servers), plus only the
      // file tools this task needs.
      options: {
        model: spec.model,
        effort: spec.effort as EffortLevel | undefined,
        systemPrompt: SYSTEM_PROMPT,
        settingSources: [],
        mcpServers: {},
        strictMcpConfig: true,
        extraArgs: { 'strict-mcp-config': null },
        tools: TOOLS,
        cwd: task.cwd,
        permissionMode: 'default',
        canUseTool: pathGuard(task),
        maxTurns: task.maxTurns ?? 80,
      },
    });
    for await (const message of messages) {
      if (message.type === 'result') result = message;
    }
    if (!result) throw new Error(`${spec.model}: Agent SDK returned no result`);
    return {
      text: result.subtype === 'success' ? result.result : result.errors.join('\n'),
      isError: result.is_error || result.subtype !== 'success',
      turns: result.num_turns,
      costUsd: result.total_cost_usd,
      durationMs: result.duration_ms,
    };
  };
}
