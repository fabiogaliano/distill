import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';

export interface AnkiNote {
  deckName: string;
  modelName: string;
  fields: Record<string, string>;
  tags: string[];
}

export interface StagedBatch {
  batchTag: string;
  noteIds: number[];
}

export interface AnkiBackend {
  // Creates "Parent::Leaf" if missing.
  ensureDeck(parent: string, leaf: string): Promise<void>;
  // All-or-nothing: throws if any note is rejected (e.g. a duplicate).
  stage(notes: AnkiNote[]): Promise<StagedBatch>;
  close(): Promise<void>;
}

export const MAX_STAGE_BATCH = 20;

// Ember is an MCP server that runs TypeScript against the Anki collection. Generated
// cards go in through stageMany: suspended in their deck until approved in the app.
export async function connectEmber(
  url = process.env.GLEAN_ANKI_MCP_URL,
  token = process.env.GLEAN_ANKI_MCP_TOKEN
): Promise<AnkiBackend> {
  if (!url || !token) {
    throw new Error('Set GLEAN_ANKI_MCP_URL and GLEAN_ANKI_MCP_TOKEN to reach the ember Anki MCP server');
  }
  const client = new Client({ name: 'glean', version: '0.1.0' });
  await client.connect(
    new StreamableHTTPClientTransport(new URL(url), { requestInit: { headers: { Authorization: `Bearer ${token}` } } })
  );

  // Data rides in as a JSON literal; the script reports back through console.log.
  const run = async <T>(code: string): Promise<T> => {
    const result = await client.callTool({ name: 'anki', arguments: { code } });
    const text = (result.content as { type: string; text?: string }[])
      .filter(c => c.type === 'text')
      .map(c => c.text)
      .join('\n');
    if (result.isError) throw new Error(text.replace(/^❌ Error: /, '').split('\n')[0]);
    return JSON.parse(text.trim().split('\n').pop()!) as T;
  };

  return {
    async ensureDeck(parent, leaf) {
      await run(`
        const [parent, leaf] = ${JSON.stringify([parent, leaf])};
        const decks = await anki.decks.list();
        if (!decks.includes(parent + '::' + leaf)) {
          // Creating the leaf and moving it would adopt an unrelated top-level deck of the same name.
          if (decks.includes(leaf)) throw new Error('A top-level deck named "' + leaf + '" already exists; move or rename it first');
          if (!decks.includes(parent)) await anki.decks.create(parent);
          const id = await anki.decks.create(leaf);
          await anki.decks.move(id, parent);
        }
        console.log(JSON.stringify(true));
      `);
    },

    async stage(notes) {
      const result = await run<{ batch_tag: string; note_ids: number[] }>(`
        const result = await anki.notes.stageMany(${JSON.stringify(notes)});
        console.log(JSON.stringify({ batch_tag: result.batch_tag, note_ids: result.note_ids }));
      `);
      if (result.note_ids.length !== notes.length) {
        throw new Error(`staged ${result.note_ids.length} of ${notes.length} notes in ${result.batch_tag}`);
      }
      return { batchTag: result.batch_tag, noteIds: result.note_ids };
    },

    close: () => client.close(),
  };
}
