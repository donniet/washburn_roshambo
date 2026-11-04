// Washburn Roshambo — "How it was made": shows the Claude Code conversation that built the simulator.
// The data comes from making-of/transcript.json (built by tools/build_making_of.py).
// Pure helpers are exported and tested; DOM code only runs on the making-of page.

export const BRANCH = 'main';

// ---------- pure helpers ----------

export const escapeHtml = (s) => String(s)
  .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
  .replace(/"/g, '&quot;').replace(/'/g, '&#39;');

// Where a link in Claude's text should go. Relative file links ("game.js#L42")
// point at the file on GitHub; web links pass through; anything else is dropped.
export function resolveLink(href, repo) {
  const h = href.trim();
  if (/^https?:\/\//i.test(h)) return h;
  if (/^(javascript|data|vbscript):/i.test(h) || h.startsWith('//')) return null;
  if (!repo) return null;
  const path = h.replace(/^\.?\//, '');
  return path ? `${repo}/blob/${BRANCH}/${path}` : repo;
}

// Inline markdown: code spans, links, bold, italics. Input is raw text; output is safe HTML.
export function renderInline(text, repo) {
  const codes = [];
  let s = String(text).replace(/`([^`\n]+)`/g, (_, c) => `\u0000${codes.push(c) - 1}\u0000`);
  s = escapeHtml(s);
  s = s.replace(/\[([^\]\n]+)\]\(([^)\s]+)\)/g, (m, label, href) => {
    const url = resolveLink(href.replace(/&amp;/g, '&'), repo);
    return url ? `<a href="${escapeHtml(url)}" target="_blank" rel="noopener">${label}</a>` : label;
  });
  s = s.replace(/\*\*([^*\n]+)\*\*/g, '<strong>$1</strong>');
  // Emphasis markers must hug their text ("*word*"), so "2 * 3 * 4" stays literal.
  s = s.replace(/(^|[^\w*])\*([^*\s](?:[^*\n]*[^*\s])?)\*(?!\w)/g, '$1<em>$2</em>');
  s = s.replace(/(^|[^\w])_([^_\s](?:[^_\n]*[^_\s])?)_(?!\w)/g, '$1<em>$2</em>');
  return s.replace(/\u0000(\d+)\u0000/g, (_, i) => `<code>${escapeHtml(codes[+i])}</code>`);
}

// Block markdown: fenced code, headings, rules, quotes, tables, (nested) lists, paragraphs.
// Covers what appears in the transcript; it is not a full CommonMark parser.
export function renderMarkdown(text, repo) {
  const lines = String(text).replace(/\r\n/g, '\n').split('\n');
  const out = [];
  let i = 0;
  const isTableSep = (l) => /^\s*\|?\s*:?-{3,}:?\s*(\|\s*:?-{3,}:?\s*)*\|?\s*$/.test(l);
  const cells = (l) => l.trim().replace(/^\|/, '').replace(/\|$/, '').split('|').map((c) => c.trim());
  const listRe = /^(\s*)([-*+]|\d+[.)])\s+(.*)$/;

  while (i < lines.length) {
    const line = lines[i];
    if (!line.trim()) { i++; continue; }

    const fence = line.match(/^\s*(```+|~~~+)\s*([\w-]*)/);
    if (fence) {
      const body = [];
      i++;
      while (i < lines.length && !lines[i].trim().startsWith(fence[1])) body.push(lines[i++]);
      i++;
      out.push(`<pre><code>${escapeHtml(body.join('\n'))}</code></pre>`);
      continue;
    }
    const h = line.match(/^(#{1,6})\s+(.*)$/);
    if (h) {
      const level = Math.min(6, h[1].length + 2); // page already uses h1/h2
      out.push(`<h${level}>${renderInline(h[2], repo)}</h${level}>`);
      i++;
      continue;
    }
    if (/^\s*(-{3,}|\*{3,}|_{3,})\s*$/.test(line)) { out.push('<hr>'); i++; continue; }
    if (/^\s*>/.test(line)) {
      const body = [];
      while (i < lines.length && /^\s*>/.test(lines[i])) body.push(lines[i++].replace(/^\s*>\s?/, ''));
      out.push(`<blockquote>${renderMarkdown(body.join('\n'), repo)}</blockquote>`);
      continue;
    }
    if (line.includes('|') && i + 1 < lines.length && isTableSep(lines[i + 1])) {
      const head = cells(line);
      i += 2;
      const rows = [];
      while (i < lines.length && lines[i].includes('|') && lines[i].trim()) rows.push(cells(lines[i++]));
      out.push('<div class="md-table"><table><thead><tr>'
        + head.map((c) => `<th>${renderInline(c, repo)}</th>`).join('')
        + '</tr></thead><tbody>'
        + rows.map((r) => `<tr>${r.map((c) => `<td>${renderInline(c, repo)}</td>`).join('')}</tr>`).join('')
        + '</tbody></table></div>');
      continue;
    }
    if (listRe.test(line)) {
      const items = [];
      while (i < lines.length) {
        const l = lines[i];
        if (!l.trim()) {
          // A blank line continues the list only if indented text or a list item of the
          // same kind (bulleted vs numbered) follows; otherwise a new block starts.
          const next = lines[i + 1] || '';
          const nm = next.match(listRe);
          const sameKind = nm && items.length && /\d/.test(nm[2]) === items[0].ordered;
          if (sameKind || (!nm && /^\s{2,}\S/.test(next))) { i++; continue; }
          break;
        }
        const m = l.match(listRe);
        if (m) items.push({ indent: m[1].length, ordered: /\d/.test(m[2]), text: m[3] });
        else if (/^\s+\S/.test(l) && items.length) items[items.length - 1].text += `\n${l.trim()}`;
        else break;
        i++;
      }
      out.push(renderList(items, repo));
      continue;
    }
    const para = [];
    while (i < lines.length && lines[i].trim() && !/^\s*(```|~~~|#{1,6}\s|>)/.test(lines[i]) && !listRe.test(lines[i])
      && !(lines[i].includes('|') && i + 1 < lines.length && isTableSep(lines[i + 1]))) para.push(lines[i++]);
    out.push(`<p>${para.map((l) => renderInline(l.trim(), repo)).join('<br>')}</p>`);
  }
  return out.join('\n');
}

// Nested list from flat items with indents.
function renderList(items, repo) {
  let html = '';
  const stack = []; // { indent, tag }
  for (const it of items) {
    while (stack.length && it.indent < stack[stack.length - 1].indent) html += `</li></${stack.pop().tag}>`;
    let top = stack[stack.length - 1];
    if (top && it.indent === top.indent && (it.ordered ? 'ol' : 'ul') !== top.tag) {
      html += `</li></${stack.pop().tag}>`; // switching between bullets and numbers
      top = stack[stack.length - 1];
    }
    if (!top || it.indent > top.indent) {
      const tag = it.ordered ? 'ol' : 'ul';
      stack.push({ indent: it.indent, tag });
      html += `<${tag}>`;
    } else {
      html += '</li>';
    }
    html += `<li>${it.text.split('\n').map((t) => renderInline(t, repo)).join('<br>')}`;
  }
  while (stack.length) html += `</li></${stack.pop().tag}>`;
  return html;
}

// Split the event list into turns: each of the person's messages starts one.
// Editor notes and interruptions belong with the message they precede/follow.
export function groupTurns(events) {
  const turns = [];
  let cur = null;
  let pendingNotes = [];
  for (const e of events) {
    if (e.kind === 'ide') { pendingNotes.push(e); continue; }
    if (e.kind === 'user') {
      cur = { user: e, notes: pendingNotes, items: [] };
      pendingNotes = [];
      turns.push(cur);
      continue;
    }
    if (!cur) { cur = { user: null, notes: [], items: [] }; turns.push(cur); }
    cur.items.push(e);
  }
  if (pendingNotes.length && cur) cur.items.push(...pendingNotes);
  return turns;
}

// Headline numbers for the stat tiles.
export function transcriptStats(data) {
  const ev = data.events;
  const count = (k) => ev.filter((e) => e.kind === k).length;
  const tools = ev.filter((e) => e.kind === 'tool');
  const days = new Set(ev.map((e) => (e.time || '').slice(0, 10)).filter(Boolean));
  return {
    requests: count('user'),
    replies: count('assistant'),
    toolCalls: tools.length,
    edits: tools.filter((t) => t.name === 'Edit' || t.name === 'Write').length,
    commands: tools.filter((t) => t.name === 'Bash').length,
    screenshots: tools.reduce((a, t) => a + t.images.length, 0),
    days: days.size,
  };
}

// Plain-language names for the tools Claude used, for students.
const TOOL_NAMES = {
  Bash: 'Ran a command',
  Read: 'Read a file',
  Write: 'Wrote a file',
  Edit: 'Edited a file',
  Agent: 'Asked a helper agent',
  AskUserQuestion: 'Asked a question',
  ExitPlanMode: 'Presented the plan',
  Skill: 'Loaded guidance',
  ToolSearch: 'Loaded a tool',
};
export const toolLabel = (name) => TOOL_NAMES[name] || name;

export function shortTime(iso) {
  if (!iso) return '';
  const d = new Date(iso);
  return d.toLocaleString('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });
}

// ---------- page ----------

function el(tag, attrs = {}, html) {
  const e = document.createElement(tag);
  for (const k in attrs) e.setAttribute(k, attrs[k]);
  if (html != null) e.innerHTML = html;
  return e;
}

function renderTool(t) {
  const details = el('details', { class: `tool${t.error ? ' error' : ''}` });
  const summary = el('summary');
  summary.append(
    el('span', { class: 'tool-name' }, escapeHtml(toolLabel(t.name))),
    el('span', { class: 'tool-title' }, escapeHtml(t.title || '')),
  );
  if (t.images.length) summary.append(el('span', { class: 'tool-badge' }, `${t.images.length} screenshot${t.images.length > 1 ? 's' : ''}`));
  if (t.error) summary.append(el('span', { class: 'tool-badge warn' }, 'didn’t run'));
  details.append(summary);
  // Build the body only when opened, so the page stays light.
  details.addEventListener('toggle', () => {
    if (!details.open || details.dataset.built) return;
    details.dataset.built = '1';
    if (t.input) details.append(el('div', { class: 'tool-label' }, 'Input'), el('pre', {}, escapeHtml(t.input + (t.inputCut ? '\n… (shortened)' : ''))));
    if (t.output) details.append(el('div', { class: 'tool-label' }, 'Result'), el('pre', {}, escapeHtml(t.output + (t.outputCut ? '\n… (shortened)' : ''))));
    for (const src of t.images) {
      const a = el('a', { href: `making-of/${src}`, target: '_blank', rel: 'noopener' });
      a.append(el('img', { src: `making-of/${src}`, alt: 'Screenshot Claude took to check its work', loading: 'lazy' }));
      details.append(a);
    }
  });
  return details;
}

function renderTurn(turn, index, repo) {
  const sec = el('section', { class: 'turn', id: `turn-${index + 1}` });
  for (const n of turn.notes) sec.append(el('div', { class: 'chip' }, escapeHtml(n.text)));
  if (turn.user) {
    const msg = el('div', { class: `msg user${turn.user.midTurn ? ' mid-turn' : ''}` });
    msg.append(el('div', { class: 'who' }, `Teacher${turn.user.midTurn ? ' · sent while Claude was working' : ''} <time>${escapeHtml(shortTime(turn.user.time))}</time>`));
    msg.append(el('div', { class: 'md' }, renderMarkdown(turn.user.text, repo)));
    sec.append(msg);
  }
  let tools = null;
  for (const item of turn.items) {
    if (item.kind === 'tool') {
      if (!tools) { tools = el('div', { class: 'tools' }); sec.append(tools); }
      tools.append(renderTool(item));
      continue;
    }
    tools = null;
    if (item.kind === 'assistant') {
      const msg = el('div', { class: 'msg claude' });
      msg.append(el('div', { class: 'who' }, 'Claude'), el('div', { class: 'md' }, renderMarkdown(item.text, repo)));
      sec.append(msg);
    } else {
      sec.append(el('div', { class: `chip ${item.kind}` }, escapeHtml(item.text)));
    }
  }
  return sec;
}

async function init() {
  const $ = (id) => document.getElementById(id);
  let data;
  try {
    data = await (await fetch('making-of/transcript.json')).json();
  } catch {
    $('transcript').textContent = 'The conversation couldn’t be loaded. Serve this folder over http (python3 -m http.server).';
    return;
  }
  const repo = data.repo;
  for (const a of document.querySelectorAll('[data-repo-link]')) a.href = repo;

  const s = transcriptStats(data);
  $('stat-requests').textContent = s.requests;
  $('stat-tools').textContent = s.toolCalls;
  $('stat-tools-sub').textContent = `${s.commands} commands · ${s.edits} file edits`;
  $('stat-screens').textContent = s.screenshots;
  $('stat-days').textContent = s.days;
  $('stat-days-sub').textContent = `${shortTime(data.start)} – ${shortTime(data.end)}`;

  const turns = groupTurns(data.events);
  const box = $('transcript');
  box.textContent = '';
  const toc = $('toc');
  turns.forEach((turn, i) => {
    box.append(renderTurn(turn, i, repo));
    if (turn.user) {
      const li = el('li');
      const a = el('a', { href: `#turn-${i + 1}` });
      a.textContent = turn.user.text.replace(/\s+/g, ' ').slice(0, 90) + (turn.user.text.length > 90 ? '…' : '');
      li.append(a);
      toc.append(li);
    }
  });

  // Show / hide tool calls, and open or close them all.
  $('show-tools').addEventListener('change', (e) => document.body.classList.toggle('hide-tools', !e.target.checked));
  $('expand-tools').addEventListener('click', () => {
    const all = [...document.querySelectorAll('details.tool')];
    const open = all.some((d) => !d.open);
    for (const d of all) d.open = open;
    $('expand-tools').textContent = open ? 'Collapse all tool calls' : 'Expand all tool calls';
  });
}

if (typeof document !== 'undefined' && document.getElementById('transcript')) init();
