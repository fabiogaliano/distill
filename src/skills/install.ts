import { lstat, mkdir, readlink, symlink } from 'fs/promises';
import { join } from 'path';
import { resolveLibraryRoot } from '../library/library';
import type { SkillTarget } from '../types';
import { variantDir } from './recipe';

export interface InstallResult {
  target: string;
  link: string;
  status: 'installed' | 'already';
}

export async function installSkill(root: string, name: string, targets: Record<string, SkillTarget>): Promise<InstallResult[]> {
  const plans = [];
  for (const [target, config] of Object.entries(targets)) {
    const source = variantDir(root, name, target);
    if (!(await Bun.file(join(source, 'SKILL.md')).exists())) {
      throw new Error(`No ${target}/SKILL.md for "${name}". Run: distill skill build ${name}`);
    }
    const dir = resolveLibraryRoot(config.install);
    const link = join(dir, name);
    const existing = await lstat(link).catch(() => undefined);
    if (existing) {
      const current = existing.isSymbolicLink() ? await readlink(link) : undefined;
      if (current !== source) {
        throw new Error(`${link} already exists and isn't this skill's link; move it away first`);
      }
    }
    plans.push({ target, dir, link, source, installed: Boolean(existing) });
  }

  // Checked every target before linking any, so a conflict leaves nothing half-installed.
  const results: InstallResult[] = [];
  for (const p of plans) {
    if (!p.installed) {
      await mkdir(p.dir, { recursive: true });
      await symlink(p.source, p.link);
    }
    results.push({ target: p.target, link: p.link, status: p.installed ? 'already' : 'installed' });
  }
  return results;
}
