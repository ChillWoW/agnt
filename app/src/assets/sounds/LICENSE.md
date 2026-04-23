# Notification sound assets

`finish.wav`, `permission.wav`, and `question.wav` are short 16-bit mono PCM
sounds synthesized on-repo by [`generate-sounds.ts`](./generate-sounds.ts) from
a few sine waves with exponential decay envelopes. They are original
generated output (no third-party samples), produced under the same license as
the rest of this repository.

Tweak the frequencies, durations, and envelope parameters in
`generate-sounds.ts` and re-run:

```
cd app && bun run src/assets/sounds/generate-sounds.ts
```

to regenerate.

## Characteristics

- `finish.wav`    C5 -> E5 -> G5 ascending chime ("assistant done")
- `permission.wav`  A5 then E6 two-pulse ping ("permission required")
- `question.wav`  B5 -> C6 short melodic pop ("question asked")
