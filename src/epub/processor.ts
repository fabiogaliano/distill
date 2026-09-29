import { join, dirname, basename } from 'path';
import { EPUB_SPLITTER_PATH } from '../config';

export class EpubProcessor {
  private epubPath: string;
  private outputDir: string;

  constructor(epubPath: string, outputDir?: string) {
    this.epubPath = epubPath;
    this.outputDir = outputDir ?? this.defaultOutputDir();
  }

  private defaultOutputDir(): string {
    const dir = dirname(this.epubPath);
    const name = basename(this.epubPath, '.epub');
    return join(dir, name);
  }

  async ensureSplit(): Promise<void> {
    const manifestPath = join(this.outputDir, 'book.json');
    const manifestFile = Bun.file(manifestPath);

    if (await manifestFile.exists()) {
      return; // Already split
    }

    const proc = Bun.spawn(
      [EPUB_SPLITTER_PATH, this.epubPath, '-o', this.outputDir],
      { stdout: 'pipe', stderr: 'pipe' }
    );

    const exitCode = await proc.exited;
    if (exitCode !== 0) {
      const error = await new Response(proc.stderr).text();
      throw new Error(`epub-splitter failed: ${error}`);
    }
  }
}
