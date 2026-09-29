import prompts from 'prompts';
import type { UIProvider, Choice } from './types';
import type { ChapterInfo } from '../types';

/**
 * UI implementation using the 'prompts' library for interactive CLI prompts
 */
export class PromptsUI implements UIProvider {
  async selectChapters(
    chapters: ChapterInfo[],
    preselected: number[]
  ): Promise<number[]> {
    const response = await prompts({
      type: 'multiselect',
      name: 'chapters',
      message: 'Select chapters to extract',
      choices: chapters.map(c => ({
        title: `${String(c.index).padStart(2, '0')}. ${c.title} (${c.word_count} words)`,
        value: c.index,
        selected: preselected.includes(c.index),
      })),
      hint: 'Space to toggle, Enter to confirm',
      instructions: false,
      // Prevent circular scrolling - when reaching the bottom, stay at the bottom
      limit: chapters.length,
      min: 0,
      max: chapters.length,
    } as any);

    // Handle Ctrl+C or escape
    if (!response.chapters) {
      return [];
    }

    return response.chapters;
  }

  async confirm(message: string): Promise<boolean> {
    const response = await prompts({
      type: 'confirm',
      name: 'value',
      message,
      initial: true,
    });

    return response.value ?? false;
  }

  async selectOne<T>(message: string, choices: Choice<T>[]): Promise<T> {
    const response = await prompts({
      type: 'select',
      name: 'value',
      message,
      choices: choices.map(c => ({
        title: c.title,
        value: c.value,
        description: c.description,
      })),
    });

    return response.value;
  }
}
