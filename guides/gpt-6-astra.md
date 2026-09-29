# Writing a SKILL.md body for GPT-6 Astra in pi

Sources, fetched 2026-09-29:
- [Using GPT-6](https://developers.openai.com/api/docs/guides/latest-model) (the current prompting guide, tuned on GPT-6 Astra)
- [Rethinking skills and prompts for GPT-6 Astra](https://developers.openai.com/blog/rethinking-skills-and-prompts-for-gpt-6-astra)
- [Codex: Build skills](https://developers.openai.com/codex/skills) and the Codex `skill-creator` SKILL.md
- pi 0.86.1 `docs/skills.md`: pi lists name and description, and the model reads SKILL.md with its read tool when the task matches.

## How Astra reads a skill

- It follows skill text closely and literally. Unclear or conflicting guidance can make it pause or stop early, so every sentence should be something you'd want applied every time.
- It already tests and verifies thoroughly; telling it to verify more leads to over-checking.
- It tends toward long, heavily formatted answers with recurring filler phrases.
- It asks the user questions when it could reasonably proceed.

## Content

- Describe the outcome and the decision criteria for open-ended work: what a good result looks like and how to choose between options. Use fixed step sequences only where deviating would cause a concrete problem.
- Keep the book's named concepts, rules, recognition cues, and fixes. Cut generic advice, repeated instructions, and speculative edge cases.
- Mark hard requirements apart from recommendations, since Astra treats every rule as a requirement.
- Don't turn one example into a universal rule. Examples illustrate; say so when that's their role.
- Define done: what the answer must contain for the task to be complete.
- Say that the user's explicit instructions take precedence over the skill.
- Soften "always ask first" language. Say what it may do without asking (read files, analyze, draft, review).

## Leave these out

- "Think step by step", "explain your reasoning": unnecessary for a reasoning model and sometimes harmful.
- "Always run all tests", "verify thoroughly" for small changes.
- ALL-CAPS and absolute "never/always" wording except for real safety or permission limits.
- "Read X, Y, and Z before every task." Point to supporting material where it becomes relevant.

## Output style to ask for

When the skill shapes the final answer, ask for clear, concise paragraphs, with lists only for genuinely parallel or sequential items, and name the phrases to avoid: "Bottom Line:", "delve", "foster", "leverage", "it's worth noting", "importantly", "genuinely", "This isn't about X. It's about Y.", "X, not Y" contrasts the user didn't ask about, and closing summaries such as "In short:".

## Shape

- Start with a `# ` title and one or two sentences on what the skill does.
- Then when to apply it, the outcome and criteria, the named concepts and red flags with recognition cues and fixes, a short example, and pitfalls.
- Shorter is better than complete: keep it well under 500 lines.
