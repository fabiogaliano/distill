import type { ModelSpec } from '../types';
import type { Completion, Provider } from './types';

export class AgyProvider implements Provider {
  constructor(readonly spec: ModelSpec) {}

  async complete(prompt: string, input: string): Promise<Completion> {
    const started = Date.now();
    const proc = Bun.spawn(['agy', '-p', prompt, '--model', this.spec.model], {
      stdin: new Response(input),
      stdout: 'pipe',
      stderr: 'pipe',
    });

    const [output, error, exitCode] = await Promise.all([
      new Response(proc.stdout).text(),
      new Response(proc.stderr).text(),
      proc.exited,
    ]);

    if (exitCode !== 0) {
      throw new Error(`Agy CLI failed: ${error}`);
    }

    // agy's print mode reports no stop reason or usage.
    return {
      text: output,
      stopReason: null,
      isError: false,
      outputTokens: 0,
      thinkingTokens: 0,
      costUsd: 0,
      durationMs: Date.now() - started,
    };
  }
}
