import type { SummaryProvider } from './types';
import type { ProviderOptions } from '../types';
import { getDefaultModel } from '../config';

export class AgyProvider implements SummaryProvider {
  name = 'agy';

  async summarize(
    content: string,
    prompt: string,
    options?: ProviderOptions
  ): Promise<string> {
    let model = options?.model ?? getDefaultModel();

    if (model === 'flash') {
      model = 'gemini-3.5-flash-medium';
    } else if (model === 'pro') {
      model = 'gemini-3.1-pro-low';
    }

    const proc = Bun.spawn(
      ['agy', '-p', prompt, '--model', model],
      {
        stdin: new Response(content),
        stdout: 'pipe',
        stderr: 'pipe',
      }
    );

    const output = await new Response(proc.stdout).text();
    const error = await new Response(proc.stderr).text();
    const exitCode = await proc.exited;

    if (exitCode !== 0) {
      throw new Error(`Agy CLI failed: ${error}`);
    }

    return output.trim();
  }
}
