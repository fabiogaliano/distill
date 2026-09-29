# Writing a SKILL.md body for Claude Opus 5.5 and Fable 5.1

Sources, fetched 2026-09-29:
- [Prompting Claude Opus 5.5](https://platform.claude.com/docs/en/build-with-claude/prompt-engineering/prompting-claude-opus-5-5)
- [Prompting Claude Fable 5.1](https://platform.claude.com/docs/en/build-with-claude/prompt-engineering/prompting-claude-fable-5-1)
- [Prompting best practices](https://platform.claude.com/docs/en/build-with-claude/prompt-engineering/claude-prompting-best-practices)
- [Skill authoring best practices](https://platform.claude.com/docs/en/agents-and-tools/agent-skills/best-practices)

## Content

- Claude is already a strong engineer. Keep only what it wouldn't know or do by default: the book's named concepts, its specific rules and their reasons, how to recognize each problem, and the fix. Drop general advice any capable model already follows.
- Give the reason behind each non-obvious rule in one clause. Claude generalizes from the reason; a bare rule gets applied too literally or not at all.
- When the skill tells Claude to avoid something, name the exact patterns ("a method whose body only calls another method with the same arguments"), not a category ("avoid bad abstractions"). A vague ban just swaps one default for another.
- Where a positive description of the target works, prefer it over a list of don'ts.
- Use one term per concept throughout, and use the author's term.
- Examples: one or two complete, short worked examples beat many fragments. Wrap them in `<example>` tags and follow each with a line saying what makes it right.

## Instructions it follows well

- Numbered steps where order or completeness matters; prose where judgment is needed.
- Explicit scope: what the skill is for, what it leaves alone, and what to report as a follow-up instead of doing.
- A stated completion condition: what the answer must contain before the task is done.
- A calm, normal register. "Use this when…" works; "CRITICAL: you MUST…" makes current models over-apply the rule.

## Leave these out

- "Think carefully", "think step by step", "take your time": effort controls thinking, and these lines only delay the answer.
- Any request to write reasoning into the response ("show your reasoning", "explain your thinking before answering", reasoning in `<thinking>` tags). Opus 5.5 may decline these as reasoning extraction.
- Generic "double-check your answer" or "add a final verification step": the model already verifies and over-verifies when told to. A concrete check tied to the domain (for example, "confirm every red flag you name appears in the code you were given") is fine.
- Instructions about progress-update brevity or holding findings until the end: Fable 5.1 already writes few updates.
- Blanket bans on markdown. Say when structure helps instead (a review reads better as a list of findings; an explanation reads better as prose).

## Shape

- Start with a `# ` title and one or two sentences on what the skill does.
- Then when to apply it, the procedure or checklist, the named concepts and red flags with recognition cues and fixes, examples, and pitfalls.
- Keep the body under 500 lines. Say what the final answer should look like (its sections, and roughly how long) since Opus-family output runs long otherwise.
