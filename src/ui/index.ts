import type { ChapterInfo } from '../types';
import type { UIProvider, Choice } from './types';
import { PromptsUI } from './prompts.ui';

export type { UIProvider, Choice } from './types';

/**
 * Headless UI for non-interactive mode.
 * Returns defaults without prompting the user.
 */
class HeadlessUI implements UIProvider {
  async selectChapters(
    _chapters: ChapterInfo[],
    preselected: number[]
  ): Promise<number[]> {
    // Use auto-detected chapters
    return preselected;
  }

  async confirm(_message: string): Promise<boolean> {
    // Always confirm in headless mode
    return true;
  }

  async selectOne<T>(_message: string, choices: Choice<T>[]): Promise<T> {
    // Return first choice as default
    const first = choices[0];
    if (!first) throw new Error('No choices provided');
    return first.value;
  }

  async text(_message: string): Promise<string | undefined> {
    return undefined;
  }
}

/**
 * Create a UI provider based on the interactive mode
 * @param interactive - Whether to use interactive prompts
 * @returns UIProvider instance
 */
export function createUI(interactive: boolean): UIProvider {
  return interactive ? new PromptsUI() : new HeadlessUI();
}
