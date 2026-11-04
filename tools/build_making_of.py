#!/usr/bin/env python3
"""Turn a Claude Code session transcript (.jsonl) into the data behind making-of.html.

Usage:
    python3 tools/build_making_of.py ~/.claude/projects/<project>/<session>.jsonl

Writes making-of/transcript.json and the screenshots Claude looked at
(making-of/img/NNN.png). Only the visible conversation is kept: the person's
messages, Claude's replies, and Claude's tool calls with their results.
Claude's private reasoning, system notes and internal records are left out,
email addresses are removed and the home directory is shortened to ~.
"""
import base64
import json
import os
import re
import sys

HOME = os.path.expanduser('~')
OUT = os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', 'making-of')
MAX_TEXT = 3000          # characters of a tool input or output to keep
EMAIL = re.compile(r'[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}')
SYSTEM_TAGS = re.compile(r'<(system-reminder|ide_opened_file|ide_selection)>.*?</\1>', re.S)
NOTICE_PREFIXES = ('Your response above was stopped',)


SCRATCHPAD = re.compile(r'/tmp/claude-\d+/[^/\s]+/[0-9a-f-]{36}/scratchpad')


def clean(text):
    text = EMAIL.sub('[email removed]', text)
    text = SCRATCHPAD.sub('scratchpad', text)   # Claude's temporary working folder
    text = re.sub(r'/tmp/claude-\d+/[^/\s"]+/', '/tmp/claude/', text)   # other temporary folders
    text = text.replace(HOME, '~')
    return text


def clip(text, limit=MAX_TEXT):
    text = clean(text)
    if len(text) <= limit:
        return text, False
    return text[:limit], True


def ide_note(block):
    """A short note for an editor event attached to a message, or None."""
    m = re.search(r'<ide_opened_file>The user opened the file (\S+) in the IDE', block)
    if m:
        return f'Opened {os.path.basename(m.group(1))} in the editor'
    m = re.search(r'<ide_selection>The user selected the lines (\d+) to (\d+) from (\S+?):\s*\n\n(.*?)\n\nThis may', block, re.S)
    if m:
        return f'Selected lines {m.group(1)}–{m.group(2)} of {os.path.basename(m.group(3))}: “{clean(m.group(4).strip())}”'
    return None


def is_bookkeeping(name, inp):
    """Commands that inspected Claude Code's own session records while this page was
    being built. Their output is technical bookkeeping, not part of the story, so the
    page leaves them out. Running the builder itself stays."""
    if name != 'Bash':
        return False
    cmd = str(inp.get('command', ''))
    looks_inside = '.claude/projects' in cmd or '.jsonl' in cmd
    return looks_inside and 'build_making_of.py' not in cmd


def tool_input(name, inp):
    """What to show for a tool call: a one-line title plus the details."""
    def field(key):
        v = inp.get(key)
        return v if isinstance(v, str) else json.dumps(v, indent=2, ensure_ascii=False)
    title = inp.get('description') or inp.get('file_path') or inp.get('skill') or inp.get('query') or ''
    if name == 'Bash':
        body = field('command')
    elif name == 'Write':
        body = field('content')
    elif name == 'Edit':
        body = f"--- replace ---\n{field('old_string')}\n--- with ---\n{field('new_string')}"
    elif name == 'Read':
        body = ''
    elif name == 'AskUserQuestion':
        qs = inp.get('questions', [])
        title = qs[0]['question'] if qs else 'Question'
        body = '\n\n'.join(
            q['question'] + '\n' + '\n'.join(f"  • {o['label']}: {o.get('description', '')}" for o in q.get('options', []))
            for q in qs)
    else:
        body = json.dumps(inp, indent=2, ensure_ascii=False)
    text, cut = clip(body)
    return clean(str(title))[:200], text, cut


def main(path):
    os.makedirs(os.path.join(OUT, 'img'), exist_ok=True)
    events, tools_by_id = [], {}
    images = dropped = 0
    start = end = None

    def push(ev, ts):
        nonlocal start, end
        ev['time'] = ts
        start = start or ts
        end = ts or end
        events.append(ev)

    for line in open(path, encoding='utf-8'):
        o = json.loads(line)
        kind, ts = o.get('type'), o.get('timestamp')

        # A message the person typed while Claude was still working.
        if kind == 'attachment':
            a = o.get('attachment', {})
            if a.get('type') == 'queued_command' and a.get('origin', {}).get('kind') == 'human':
                text = ''.join(p.get('text', '') for p in a.get('prompt', []) if isinstance(p, dict))
                push({'kind': 'user', 'text': clean(text), 'midTurn': True}, ts)
            continue

        if kind not in ('user', 'assistant') or o.get('isMeta') or o.get('isSidechain'):
            continue
        content = o['message'].get('content')
        blocks = [{'type': 'text', 'text': content}] if isinstance(content, str) else content or []

        for b in blocks:
            t = b.get('type')
            if kind == 'user' and t == 'text':
                raw = b.get('text', '')
                for tag in re.finditer(r'<(ide_opened_file|ide_selection)>.*?</\1>', raw, re.S):
                    note = ide_note(tag.group(0))
                    if note:
                        push({'kind': 'ide', 'text': note}, ts)
                text = SYSTEM_TAGS.sub('', raw).strip()
                if not text:
                    continue
                if text.startswith('[Request interrupted'):
                    push({'kind': 'interrupt', 'text': 'Stopped by the user'}, ts)
                elif text.startswith(NOTICE_PREFIXES):
                    push({'kind': 'notice', 'text': 'Part of this reply was stopped by an automatic safety check, so Claude changed approach.'}, ts)
                else:
                    push({'kind': 'user', 'text': clean(text)}, ts)
            elif kind == 'assistant' and t == 'text':
                text = b.get('text', '').strip()
                if text:
                    push({'kind': 'assistant', 'text': clean(text)}, ts)
            elif kind == 'assistant' and t == 'tool_use':
                if is_bookkeeping(b.get('name', ''), b.get('input') or {}):
                    dropped += 1   # its result has no matching call, so it is skipped too
                    continue
                title, body, cut = tool_input(b.get('name', ''), b.get('input') or {})
                ev = {'kind': 'tool', 'name': b.get('name'), 'title': title, 'input': body, 'inputCut': cut,
                      'output': '', 'outputCut': False, 'images': [], 'error': False}
                tools_by_id[b.get('id')] = ev
                push(ev, ts)
            elif kind == 'user' and t == 'tool_result':
                ev = tools_by_id.get(b.get('tool_use_id'))
                if not ev:
                    continue
                parts = b.get('content')
                parts = [{'type': 'text', 'text': parts}] if isinstance(parts, str) else parts or []
                texts = []
                for p in parts:
                    if p.get('type') == 'text':
                        texts.append(SYSTEM_TAGS.sub('', p.get('text', '')).strip())
                    elif p.get('type') == 'image':
                        src = p.get('source', {})
                        ext = 'jpg' if 'jpeg' in src.get('media_type', '') else 'png'
                        images += 1
                        name = f'img/{images:03d}.{ext}'
                        with open(os.path.join(OUT, name), 'wb') as f:
                            f.write(base64.b64decode(src.get('data', '')))
                        ev['images'].append(name)
                ev['output'], ev['outputCut'] = clip('\n'.join(x for x in texts if x))
                ev['error'] = bool(b.get('is_error'))

    data = {
        'repo': 'https://github.com/donniet/washburn_roshambo',
        'start': start, 'end': end,
        'events': events,
    }
    with open(os.path.join(OUT, 'transcript.json'), 'w', encoding='utf-8') as f:
        json.dump(data, f, ensure_ascii=False, separators=(',', ':'))
    counts = {}
    for e in events:
        counts[e['kind']] = counts.get(e['kind'], 0) + 1
    print('events', counts, 'images', images, 'bookkeeping calls left out', dropped)


if __name__ == '__main__':
    if len(sys.argv) != 2:
        sys.exit(__doc__)
    main(sys.argv[1])
