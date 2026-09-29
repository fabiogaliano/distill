# Model pick — chapter extraction

Judge: claude-opus-5-5@high. Gold columns cover only chapters with gold items. Cost is list-price USD from the CLI, used as a relative quota measure.

| candidate | chapters | gold recall | unsupported / ch | cards (1-5) | usefulness (1-5) | parse fails | out tok / ch | $ / ch | sec / ch |
|---|---|---|---|---|---|---|---|---|---|
| claude-opus-5-5@low | 11 | 100% | 0.7 | 5.0 | 5.0 | 0 | 5239 | 0.199 | 47 |
| claude-opus-5-5@medium | 11 | 100% | 2.7 | 4.7 | 5.0 | 0 | 6173 | 0.218 | 56 |
| claude-opus-5-5@high | 11 | 100% | 1.7 | 4.7 | 5.0 | 0 | 7130 | 0.237 | 64 |
| claude-sonnet-5-5@medium | 11 | 100% | 0.7 | 4.7 | 5.0 | 0 | 4842 | 0.095 | 34 |
| claude-sonnet-5-5@high | 11 | 100% | 1.0 | 5.0 | 5.0 | 0 | 6321 | 0.110 | 43 |

## Blind ranking

Each chapter ranked twice per ranker (order reversed). Lower avg rank is better; 1 = best.

### All rankers combined (66 rankings)

| candidate | avg rank | ranked #1 | aposd | lawsux | momtest | pme | react |
|---|---|---|---|---|---|---|---|
| claude-opus-5-5@medium | 2.30 | 19/66 | 3.3 | 1.9 | 2.3 | 1.5 | 2.0 |
| claude-opus-5-5@high | 2.50 | 24/66 | 2.3 | 3.2 | 2.8 | 2.5 | 1.8 |
| claude-opus-5-5@low | 3.12 | 6/66 | 3.2 | 3.5 | 2.3 | 2.8 | 3.8 |
| claude-sonnet-5-5@high | 3.23 | 9/66 | 2.6 | 3.5 | 3.3 | 3.5 | 3.6 |
| claude-sonnet-5-5@medium | 3.85 | 8/66 | 3.6 | 2.9 | 4.4 | 4.7 | 3.8 |

### claude-opus-5-5@high (22 rankings)

| candidate | avg rank | ranked #1 | aposd | lawsux | momtest | pme | react |
|---|---|---|---|---|---|---|---|
| claude-opus-5-5@medium | 2.18 | 7/22 | 3.0 | 2.0 | 1.5 | 1.5 | 2.5 |
| claude-opus-5-5@high | 2.36 | 9/22 | 1.8 | 2.3 | 3.0 | 2.8 | 2.3 |
| claude-opus-5-5@low | 2.77 | 2/22 | 2.5 | 3.5 | 2.5 | 2.8 | 2.8 |
| claude-sonnet-5-5@high | 3.27 | 4/22 | 3.2 | 3.5 | 3.3 | 3.3 | 3.3 |
| claude-sonnet-5-5@medium | 4.41 | 0/22 | 4.5 | 3.8 | 4.8 | 4.8 | 4.3 |

### openai-codex/gpt-6-astra@high (22 rankings)

| candidate | avg rank | ranked #1 | aposd | lawsux | momtest | pme | react |
|---|---|---|---|---|---|---|---|
| claude-opus-5-5@medium | 2.64 | 8/22 | 4.7 | 2.0 | 3.0 | 1.3 | 1.3 |
| claude-opus-5-5@low | 2.95 | 4/22 | 2.8 | 3.3 | 1.0 | 3.0 | 4.8 |
| claude-opus-5-5@high | 3.05 | 3/22 | 3.3 | 4.8 | 3.3 | 1.8 | 2.0 |
| claude-sonnet-5-5@high | 3.09 | 3/22 | 2.0 | 3.3 | 3.0 | 4.3 | 3.5 |
| claude-sonnet-5-5@medium | 3.27 | 4/22 | 2.2 | 1.8 | 4.8 | 4.8 | 3.5 |

### Gemini 3.8 Flash (High) (22 rankings)

| candidate | avg rank | ranked #1 | aposd | lawsux | momtest | pme | react |
|---|---|---|---|---|---|---|---|
| claude-opus-5-5@high | 2.09 | 12/22 | 1.8 | 2.5 | 2.0 | 3.0 | 1.3 |
| claude-opus-5-5@medium | 2.09 | 4/22 | 2.3 | 1.8 | 2.3 | 1.8 | 2.3 |
| claude-sonnet-5-5@high | 3.32 | 2/22 | 2.5 | 3.8 | 3.8 | 3.0 | 4.0 |
| claude-opus-5-5@low | 3.64 | 0/22 | 4.3 | 3.8 | 3.3 | 2.8 | 3.8 |
| claude-sonnet-5-5@medium | 3.86 | 4/22 | 4.0 | 3.3 | 3.8 | 4.5 | 3.8 |
