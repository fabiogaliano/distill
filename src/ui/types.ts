import type { ChapterInfo } from '../types';

/**
 * Choice option for select prompts
 */
export interface Choice<T> {
  title: string;
  value: T;
  description?: string;
}

/**
 * Abstract UI interface for user interactions.
 * Can be implemented by prompts, inquirer, blessed TUI, web API, etc.
 */
export interface UIProvider {
  /**
   * Select multiple chapters from a list
   * @param chapters - All available chapters
   * @param preselected - Indices that should be pre-selected
   * @returns Selected chapter indices
   */
  selectChapters(chapters: ChapterInfo[], preselected: number[]): Promise<number[]>;

  /**
   * Ask for confirmation
   * @param message - The confirmation message
   * @returns true if confirmed, false otherwise
   */
  confirm(message: string): Promise<boolean>;

  /**
   * Select one option from a list
   * @param message - The prompt message
   * @param choices - Available choices
   * @returns The selected value
   */
  selectOne<T>(message: string, choices: Choice<T>[]): Promise<T>;

  /**
   * Ask for a line of text
   * @returns The text, or undefined if cancelled
   */
  text(message: string): Promise<string | undefined>;
}
