You are comparing several knowledge extractions of the same chapter of a technical book, each produced by a different unnamed model. They all cover the chapter's main ideas, so judge the finer differences.

Book: {{BOOK}}
Chapter: {{CHAPTER}}

Stdin contains the CHAPTER TEXT, then each extraction under a line "===== EXTRACTION <label>".

Rank the extractions from best to worst as source material for (a) Anki cards that build real understanding and (b) a skill that applies these ideas to design work. Weigh, in order:
1. Faithfulness: nothing the chapter doesn't support; the author's own names and distinctions preserved.
2. Precision: items are sharp and specific rather than generic; symptoms and fixes you could act on.
3. Card quality: scenario/contrast cards that test understanding, one idea each, correct answers.
4. Economy: no padding or redundancy. Longer is not better.

Respond with a single JSON object and nothing else:

{
  "ranking": ["best label", "...", "worst label"],
  "reasons": { "<label>": "one or two sentences on its strengths and weaknesses" }
}
