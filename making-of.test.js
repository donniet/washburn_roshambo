import test from 'node:test';
import assert from 'node:assert/strict';
import {
  escapeHtml, resolveLink, renderInline, renderMarkdown, groupTurns, transcriptStats, toolLabel,
} from './making-of.js';

const REPO = 'https://github.com/donniet/washburn_roshambo';

test('escapeHtml escapes markup', () => {
  assert.equal(escapeHtml('<b>"Tom" & \'Jerry\'</b>'), '&lt;b&gt;&quot;Tom&quot; &amp; &#39;Jerry&#39;&lt;/b&gt;');
});

test('resolveLink: files go to GitHub, web links pass, unsafe links are dropped', () => {
  assert.equal(resolveLink('game.js#L42', REPO), `${REPO}/blob/main/game.js#L42`);
  assert.equal(resolveLink('./style.css', REPO), `${REPO}/blob/main/style.css`);
  assert.equal(resolveLink('https://example.com/x', REPO), 'https://example.com/x');
  assert.equal(resolveLink('javascript:alert(1)', REPO), null);
  assert.equal(resolveLink('//evil.example', REPO), null);
});

test('renderInline: code, bold, italics, links; raw HTML is escaped', () => {
  assert.equal(renderInline('use `a<b>` and **bold** and *it*', REPO),
    'use <code>a&lt;b&gt;</code> and <strong>bold</strong> and <em>it</em>');
  assert.equal(renderInline('see [game.js:42](game.js#L42)', REPO),
    `see <a href="${REPO}/blob/main/game.js#L42" target="_blank" rel="noopener">game.js:42</a>`);
  assert.equal(renderInline('<script>x</script>', REPO), '&lt;script&gt;x&lt;/script&gt;');
  const unsafe = renderInline('[bad](javascript:alert(1))', REPO);
  assert.ok(!/href|javascript/i.test(unsafe), `unsafe link dropped: ${unsafe}`);
  assert.equal(renderInline('a*b*c and 2 * 3 * 4', REPO), 'a*b*c and 2 * 3 * 4', 'mid-word and spaced stars stay literal');
  assert.equal(renderInline('`**not bold**`', REPO), '<code>**not bold**</code>');
});

test('renderMarkdown: headings, code fences, lists, tables, quotes', () => {
  const html = renderMarkdown([
    '## Plan',
    '',
    'First line',
    'second line',
    '',
    '- one',
    '  - nested',
    '- two',
    '',
    '1. first',
    '2. second',
    '',
    '```js',
    'const a = "<x>";',
    '```',
    '',
    '| A | B |',
    '|---|---|',
    '| 1 | `2` |',
    '',
    '> quoted',
  ].join('\n'), REPO);
  assert.match(html, /<h4>Plan<\/h4>/);
  assert.match(html, /<p>First line<br>second line<\/p>/);
  assert.match(html, /<ul><li>one<ul><li>nested<\/li><\/ul><\/li><li>two<\/li><\/ul>/);
  assert.match(html, /<ol><li>first<\/li><li>second<\/li><\/ol>/);
  assert.match(html, /<pre><code>const a = &quot;&lt;x&gt;&quot;;<\/code><\/pre>/);
  assert.match(html, /<th>A<\/th><th>B<\/th>/);
  assert.match(html, /<td><code>2<\/code><\/td>/);
  assert.match(html, /<blockquote><p>quoted<\/p><\/blockquote>/);
  assert.ok(!/<script/i.test(renderMarkdown('<script>alert(1)</script>', REPO)));
});

test('renderMarkdown: list items continue onto indented lines and across blank lines', () => {
  const html = renderMarkdown('- a\n  more a\n\n- b\n\nAfter', REPO);
  assert.match(html, /<ul><li>a<br>more a<\/li><li>b<\/li><\/ul>/);
  assert.match(html, /<p>After<\/p>/);
});

const EVENTS = [
  { kind: 'ide', text: 'Opened NOTES.md in the editor', time: '2026-10-09T14:45:00Z' },
  { kind: 'user', text: 'Make a plan', time: '2026-10-09T14:46:00Z' },
  { kind: 'tool', name: 'Bash', title: 'List files', images: [], time: '2026-10-09T14:47:00Z' },
  { kind: 'assistant', text: 'Here is the plan', time: '2026-10-09T14:48:00Z' },
  { kind: 'interrupt', text: 'Stopped by the user', time: '2026-10-09T14:49:00Z' },
  { kind: 'user', text: 'Build it', midTurn: true, time: '2026-10-20T10:00:00Z' },
  { kind: 'tool', name: 'Edit', title: 'game.js', images: [], time: '2026-10-20T10:01:00Z' },
  { kind: 'tool', name: 'Read', title: 'shot.png', images: ['img/001.png'], time: '2026-10-20T10:02:00Z' },
];

test('groupTurns: each request starts a turn; editor notes attach to the next request', () => {
  const turns = groupTurns(EVENTS);
  assert.equal(turns.length, 2);
  assert.equal(turns[0].user.text, 'Make a plan');
  assert.deepEqual(turns[0].notes.map((n) => n.text), ['Opened NOTES.md in the editor']);
  assert.deepEqual(turns[0].items.map((e) => e.kind), ['tool', 'assistant', 'interrupt']);
  assert.equal(turns[1].user.midTurn, true);
  assert.deepEqual(turns[1].items.map((e) => e.name), ['Edit', 'Read']);
});

test('transcriptStats counts requests, tools, edits, screenshots and days', () => {
  assert.deepEqual(transcriptStats({ events: EVENTS }), {
    requests: 2, replies: 1, toolCalls: 3, edits: 1, commands: 1, screenshots: 1, days: 2,
  });
});

test('toolLabel gives plain names and falls back to the tool name', () => {
  assert.equal(toolLabel('Bash'), 'Ran a command');
  assert.equal(toolLabel('Mystery'), 'Mystery');
});
