import { mkdtemp, rm } from 'fs/promises';
import { tmpdir } from 'os';
import { join } from 'path';

// Opens text in $VISUAL / $EDITOR and returns what was saved.
export async function editText(text: string, filename: string): Promise<string> {
  const editor = process.env.VISUAL || process.env.EDITOR || 'vi';
  const dir = await mkdtemp(join(tmpdir(), 'glean-edit-'));
  const path = join(dir, filename);
  try {
    await Bun.write(path, text);
    // Through the shell so EDITOR values with flags ("code --wait") work.
    const proc = Bun.spawn(['sh', '-c', `${editor} "$1"`, 'sh', path], {
      stdin: 'inherit',
      stdout: 'inherit',
      stderr: 'inherit',
    });
    if ((await proc.exited) !== 0) throw new Error(`${editor} exited with an error`);
    return await Bun.file(path).text();
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}
