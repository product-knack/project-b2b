# iOS handoff: Odds Nucleus, bold text and subtitles in articles (26 Oct 2026)

For the iOS Expo repo. Self-contained. Web side shipped in hub-track (the Education Content editor); Android
shipped in odds-app commit 0749816 (26 Oct 2026). Feature doc: `b2b/docs/features/android/shared/odds-nucleus.md`
section 6 (body rules) and the 26 Oct change-log line. Copy rule: no dashes in user-facing text.

## 1. The feature in one page
1. Staff write articles for the Nucleus in the web editor (`/academy/education-content/:id`,
   `/trainer/education-content/:id`). The Body box has a **Bold** and a **Subtitle** button. The editor selects
   text and presses one of them.
2. **Bold** wraps the selection as `**text**` inside a paragraph, a bullet or a pull quote.
   **Subtitle** turns the line into `## text` on its own line, with blank lines around it.
3. Storage is unchanged: `longevity_resources.body`, plain text with those markers. Nothing else in the row changed,
   no new column, no migration, no RLS change.
4. The readers (web Nucleus, Android, iOS) parse the body the same way: blank-line blocks, `- ` bullets, `## `
   heading, `> ` quote, else a paragraph. Subtitles already rendered as headings on every reader. Bold did not:
   before this change a bold word showed as `**word**` with the asterisks.
5. After this change the app shows the bold runs in the bold body face, the asterisks never show, a lone or
   unmatched `**` (for example `2 ** 3`) prints as typed, and a heading never shows markers.

## 2. The rule (identical on all three readers, copy exactly)
- A bold run is `**` followed by a non-space, the shortest text that ends in a non-space, then `**`.
  Regex: `/\*\*(?=\S)([\s\S]*?\S)\*\*/g`.
- Anything outside a match is a plain run. An unmatched `**` stays in the text as typed.
- `stripInline(text)` is the same text with the markers removed (used for headings and for any place the body
  is shown as plain text).
- Headings: `parseBody` strips the markers from the `## ` line, so a heading never carries `**`.
- Paragraphs, bullets and quotes keep the markers in the parsed block; the screen splits them into runs at render.
- Search is untouched: the Nucleus search reads the title and the summary, never the body.
- Offline: the cached piece is the same body text, parsed on render, so nothing to change in the cache.

## 3. Edits (two files, plus the test)
### `src/lib/nucleus.ts`
Add above `parseBody`:
```ts
/* Inline bold (26 Oct 2026, the web editor's Bold button stores **text**): identical to the web parser so
   all three readers agree. */
export type InlineRun = { text: string; bold: boolean };

/** **x** becomes a bold run; an unmatched ** prints as typed. */
export const inlineRuns = (text: string): InlineRun[] => {
  const out: InlineRun[] = [];
  const re = /\*\*(?=\S)([\s\S]*?\S)\*\*/g;
  let last = 0;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text))) {
    if (m.index > last) out.push({ text: text.slice(last, m.index), bold: false });
    out.push({ text: m[1], bold: true });
    last = m.index + m[0].length;
  }
  if (last < text.length) out.push({ text: text.slice(last), bold: false });
  return out.length ? out : [{ text, bold: false }];
};
export const stripInline = (text: string) => inlineRuns(text).map((r) => r.text).join('');
```
In `parseBody`, the heading line becomes:
```ts
blocks.push({ type: 'h2', text: stripInline(lines[0].replace(/^## /, '').trim()) });
```

### `src/screens/nucleus.tsx`
Import `inlineRuns` from `../lib/nucleus`. Above `BodyBlocks` add:
```tsx
/* **bold** runs (26 Oct 2026): nested Text keeps the line wrapping of the parent paragraph. */
const Runs = ({ text }: { text: string }) => (
  <>{inlineRuns(text).map((r, i) => r.bold
    ? <Text key={i} style={{ fontFamily: F.bodyBold }}>{r.text}</Text>
    : <React.Fragment key={i}>{r.text}</React.Fragment>)}</>
);
```
In `BodyBlocks` replace the three plain children:
- paragraph: `<Text ...>{b.text}</Text>` becomes `<Text ...><Runs text={b.text} /></Text>`
- bullet item: `<Text ...>{it}</Text>` becomes `<Text ...><Runs text={it} /></Text>`
- quote: `<Text ...italic>{b.text}</Text>` becomes `<Text ...italic><Runs text={b.text} /></Text>`
  (the bold run inside a quote uses `F.bodyBold`; the font set has no bold italic face, that is accepted)
- headings stay as they are (`Serif`, the text is already stripped).

### `tests/rules/nucleus_rules_test.js`
Add after the `empty body` check:
```js
eq('inline bold run', N.inlineRuns('Most adults need **seven to nine** hours.'), [{ text: 'Most adults need ', bold: false }, { text: 'seven to nine', bold: true }, { text: ' hours.', bold: false }]);
eq('unmatched ** prints as typed', N.inlineRuns('2 ** 3 is eight'), [{ text: '2 ** 3 is eight', bold: false }]);
eq('two bold runs, plain text in between', N.inlineRuns('**a** and **b**').map((r) => (r.bold ? 'B:' : 'P:') + r.text), ['B:a', 'P: and ', 'B:b']);
eq('stripInline', N.stripInline('Keep **this** plain'), 'Keep this plain');
eq('heading loses the markers, paragraph keeps them', N.parseBody('## Why **it** matters\nMost need **nine** hours.'), [{ type: 'h2', text: 'Why it matters' }, { type: 'p', text: 'Most need **nine** hours.' }]);
```
Run `node tests/rules/nucleus_rules_test.js` (all pass on Android).

## 4. Verify on a device
- Open a test piece whose body has `Most adults need **seven to nine** hours.` and a `## Why it matters` line:
  "seven to nine" is bold, no asterisks anywhere, the subtitle is a heading.
- A paragraph with `2 ** 3` prints exactly that.
- A bullet and a pull quote with a bold run inside render bold without breaking the wrap.
- Offline (airplane mode, the piece already opened once): the cached piece renders the same.

## 5. Nothing to do on the server
No migration, no RPC, no RLS. The web editor writes the markers; the readers parse them.
