export interface MentionMember { machineId: string; username: string; }

export function filterMentions(members: MentionMember[], keyword: string): MentionMember[] {
  const k = keyword.trim().toLowerCase();
  return members.filter((m) => !k || m.username.toLowerCase().includes(k));
}

export interface ComposerParse { isCommand: boolean; missingTarget: boolean; }
export function parseComposer(text: string, atMember: MentionMember | null): ComposerParse {
  const isCommand = /^\s*\/command(?:\s|$)/.test(text);
  if (!isCommand) return { isCommand: false, missingTarget: false };
  return { isCommand: true, missingTarget: !atMember };
}

export interface TargetSplit { toId: string | null; text: string; }
// 从 "@username 正文" 还原 toId 与正文；找不到 @ 开头则原样
export function splitAtCommand(raw: string, username: string, machineId: string): TargetSplit {
  const m = raw.match(/^\s*@([^\s]+)([\s\S]*)$/);
  if (!m) return { toId: null, text: raw.trim() };
  return { toId: machineId, text: (m[2] || '').trim() || username };
}

export interface MessageSegment { text: string; mention: boolean; }
export function highlightMentions(text: string, nameById: Record<string, string>): MessageSegment[] {
  const out: MessageSegment[] = [];
  const re = /@([\w-]+)/g;
  let last = 0;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text))) {
    if (m.index > last) out.push({ text: text.slice(last, m.index), mention: false });
    const id = m[1];
    out.push({ text: `@${nameById[id] ?? id}`, mention: true });
    last = m.index + m[0].length;
  }
  if (last < text.length) out.push({ text: text.slice(last), mention: false });
  if (!out.length) out.push({ text, mention: false });
  return out;
}
