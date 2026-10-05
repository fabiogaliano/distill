import { join } from 'path';
import { parse as parseYaml, stringify as stringifyYaml } from 'yaml';

export interface RecipeSource {
  book: string;
  // Chapter indices; omitted means every selected chapter.
  chapters?: number[];
}

export interface EvalCase {
  name: string;
  // Whether the skill should load for this prompt.
  fire: boolean;
  prompt: string;
  expect: string[];
}

export interface Recipe {
  name: string;
  description: string;
  focus: string;
  sources: RecipeSource[];
  scope: { include: string[]; exclude: string[] };
  evals: EvalCase[];
}

// Claude Code and pi both reject skill names outside this shape.
const NAME = /^[a-z0-9]+(-[a-z0-9]+)*$/;
const MAX_NAME = 64;
// pi (Agent Skills spec) caps description at 1024; Claude's cap is higher.
const MAX_DESCRIPTION = 1024;

export const skillsDir = (root: string) => join(root, 'skills');
export const skillDir = (root: string, name: string) => join(skillsDir(root), name);
export const recipePath = (root: string, name: string) => join(skillDir(root, name), 'recipe.yaml');
export const specPath = (root: string, name: string) => join(skillDir(root, name), 'spec.md');
export const variantDir = (root: string, name: string, target: string) => join(skillDir(root, name), target);
export const evalsDir = (root: string, name: string) => join(skillDir(root, name), 'evals');

export function assertSkillName(name: string): void {
  if (!NAME.test(name) || name.length > MAX_NAME) {
    throw new Error(`Skill name "${name}" must be lowercase letters, digits, and hyphens, at most ${MAX_NAME} characters`);
  }
}

const isStrings = (v: unknown): v is string[] => Array.isArray(v) && v.every(s => typeof s === 'string');

// Checks a recipe from the model or from a hand edit; returns every problem so
// one round of editing can fix them all.
export function recipeProblems(value: unknown): string[] {
  if (!value || typeof value !== 'object') return ['recipe must be a mapping'];
  const r = value as Record<string, unknown>;
  const problems: string[] = [];

  if (typeof r.name !== 'string' || !NAME.test(r.name)) problems.push('name: lowercase letters, digits, and hyphens');
  if (typeof r.description !== 'string' || !r.description.trim()) problems.push('description: required');
  else if (r.description.length > MAX_DESCRIPTION) {
    problems.push(`description: ${r.description.length} characters, max ${MAX_DESCRIPTION}`);
  }
  if (typeof r.focus !== 'string' || !r.focus.trim()) problems.push('focus: required');

  if (!Array.isArray(r.sources) || r.sources.length === 0) problems.push('sources: at least one book');
  else {
    r.sources.forEach((s, i) => {
      const source = s as Record<string, unknown>;
      if (typeof source?.book !== 'string') problems.push(`sources[${i}].book: required`);
      const chapters = source?.chapters;
      if (chapters !== undefined && !(Array.isArray(chapters) && chapters.every(Number.isInteger))) {
        problems.push(`sources[${i}].chapters: list of chapter indices`);
      }
    });
  }

  const scope = r.scope as Record<string, unknown> | undefined;
  if (!scope || !isStrings(scope.include) || !isStrings(scope.exclude)) {
    problems.push('scope: include and exclude lists');
  }

  if (!Array.isArray(r.evals) || r.evals.length === 0) problems.push('evals: at least one case');
  else {
    const names = new Set<string>();
    r.evals.forEach((c, i) => {
      const ec = c as Record<string, unknown>;
      const at = `evals[${i}]`;
      if (typeof ec?.name !== 'string' || !NAME.test(ec.name)) problems.push(`${at}.name: kebab-case`);
      else if (names.has(ec.name)) problems.push(`${at}.name: duplicate "${ec.name}"`);
      else names.add(ec.name);
      if (typeof ec?.fire !== 'boolean') problems.push(`${at}.fire: true or false`);
      if (typeof ec?.prompt !== 'string' || !ec.prompt.trim()) problems.push(`${at}.prompt: required`);
      if (!isStrings(ec?.expect) || ec.expect.length === 0) problems.push(`${at}.expect: at least one statement`);
    });
    if (!r.evals.some(c => (c as EvalCase)?.fire === true)) problems.push('evals: needs a case where the skill fires');
    if (!r.evals.some(c => (c as EvalCase)?.fire === false)) problems.push('evals: needs a case where it should not fire');
  }
  return problems;
}

export function toRecipe(value: unknown): Recipe {
  const problems = recipeProblems(value);
  if (problems.length > 0) throw new Error(`Invalid recipe:\n  ${problems.join('\n  ')}`);
  return value as Recipe;
}

export function parseRecipe(yaml: string): Recipe {
  return toRecipe(parseYaml(yaml));
}

export function stringifyRecipe(recipe: Recipe): string {
  return stringifyYaml(recipe, { lineWidth: 0 });
}

export async function readRecipe(root: string, name: string): Promise<Recipe | undefined> {
  const file = Bun.file(recipePath(root, name));
  return (await file.exists()) ? parseRecipe(await file.text()) : undefined;
}

export async function requireRecipe(root: string, name: string): Promise<Recipe> {
  const recipe = await readRecipe(root, name);
  if (!recipe) throw new Error(`No recipe for skill "${name}". Run: distill skill plan ${name}`);
  return recipe;
}

export async function writeRecipe(root: string, recipe: Recipe): Promise<string> {
  const path = recipePath(root, recipe.name);
  await Bun.write(path, stringifyRecipe(recipe));
  return path;
}
