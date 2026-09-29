You are grading a knowledge extraction produced by an unnamed model from one chapter of a technical book. Grade strictly and consistently; several extractions of the same chapter will be graded by the same rubric.

Book: {{BOOK}}
Chapter: {{CHAPTER}}

Stdin contains three sections, delimited by lines starting with "=====":
1. CHAPTER TEXT — the source of truth.
2. GOLD ITEMS — the ideas the author treats as most important in this chapter.
3. EXTRACTION — the JSON to grade.

Score:
- gold: for each gold item, 1 if the extraction captures it correctly and recognizably (author's naming where the gold item names something), 0.5 if present but vague, misnamed, or partly wrong, 0 if missing.
- unsupported: list every claim in the extraction that the chapter text does not support or that contradicts it. Paraphrase and reasonable synthesis are fine; invented concepts, wrong attributions, and wrong facts are not.
- cards: rate the card set 1-5. 5 = every card is correct, tests understanding (scenario/contrast/application), one idea per card, answers concise. 1 = cards are wrong, trivial, or test wording only.
- usefulness: rate 1-5 how useful the extraction is as source material for a skill that applies these ideas to real design work (actionable red flags, fixes, techniques, when-to-use).

Respond with a single JSON object and nothing else:

{
  "gold": [{ "item": "gold item text", "score": 0 | 0.5 | 1, "note": "" }],
  "unsupported": [{ "claim": "", "why": "" }],
  "cards": 1-5,
  "cards_note": "",
  "usefulness": 1-5,
  "usefulness_note": ""
}
