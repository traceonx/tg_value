import sharp from 'sharp';

const escape = (text: string) => text.replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&apos;' }[char]!));
const clean = (text: string) => text.replace(/\*\*|__/g, '').replace(/^\s*[└📄🎬⬇️📁📂]+\s*/u, '').replace(/^当前:\s*/, '').trim();
const shorten = (text: string, length: number) => {
    let width = 0;
    let result = '';
    for (const char of text) {
        width += char.codePointAt(0)! > 255 ? 2 : 1;
        if (width > length) return result + '…';
        result += char;
    }
    return result;
};

/** Extract the first active transfer; retain the complete status as the caption. */
export function downloadCardData(text: string) {
    const lines = text.split('\n');
    const index = lines.findIndex(line => /[▰▱]/u.test(line));
    if (index < 0) return null;
    const percent = lines[index].match(/([\d.]+)%/);
    const sizeIndex = /\//.test(lines[index - 1] || '') ? index - 1 : index + 1;
    const title = lines.slice(0, Math.min(index, sizeIndex)).reverse().find(line => line.trim()) || 'Download';
    const meta = lines.slice(index + 1).find(line => line.includes('⏱')) || '';
    const folder = lines.find(line => /📁/.test(line))?.replace(/.*📁\s*(批次:\s*)?/, '') || '';
    return { title: clean(title), size: clean(lines[sizeIndex] || ''), percent: percent ? Math.min(100, Math.max(0, Number(percent[1]))) : null,
        speed: meta.match(/⬇\s*(.*?)\s*·/)?.[1] || '—', eta: meta.match(/\d+:\d{2}:\d{2}/)?.[0] || '—', folder: clean(folder) };
}

export function downloadCardCaption(text: string): string {
    const data = downloadCardData(text);
    if (!data) return text.length <= 1024 ? text : '';
    // A single card already contains all these fields; keep task controls and other transfers.
    const lines = text.split('\n');
    const index = lines.findIndex(line => /[▰▱]/u.test(line));
    const sizeIndex = /\//.test(lines[index - 1] || '') ? index - 1 : index + 1;
    let titleIndex = Math.min(index, sizeIndex) - 1;
    while (titleIndex >= 0 && !lines[titleIndex].trim()) titleIndex--;
    const metaIndex = lines.findIndex((line, i) => i > index && line.includes('⏱'));
    const folderIndex = lines.findIndex(line => /📁/.test(line));
    const removed = new Set([index, sizeIndex, titleIndex, metaIndex, folderIndex]);
    const caption = lines.filter((_, i) => !removed.has(i)).join('\n').trim();
    return caption.length <= 1024 ? caption : '';
}

export async function renderDownloadCard(text: string): Promise<Buffer> {
    const data = downloadCardData(text);
    if (!data) {
        const lines = text.split('\n').flatMap(line => Array.from(clean(line)).join('').match(/.{1,55}/gu) || ['']);
        const height = Math.max(240, 100 + lines.length * 38);
        return sharp(Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="1440" height="${height}"><rect width="1440" height="${height}" rx="60" fill="white"/><g font-family="Noto Sans CJK SC, Microsoft YaHei, Arial, sans-serif" font-size="28" fill="#374151">${lines.map((line, i) => `<text x="60" y="${70 + i * 38}">${escape(line)}</text>`).join('')}</g></svg>`)).png().toBuffer();
    }
    const title = escape(shorten(data?.title || clean(text.split('\n').find(line => line.trim()) || 'Download'), 38));
    const percent = data?.percent;
    const overflow = text.length > 1024 ? text.split('\n').flatMap(line => clean(line).match(/.{1,55}/gu) || ['']) : [];
    const height = 420 + overflow.length * 38;
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="1440" height="${height}" viewBox="0 0 1440 ${height}">
      <rect width="1440" height="${height}" fill="white"/>
      <defs><linearGradient id="purple" x2="0" y2="1"><stop stop-color="#A383FF"/><stop offset="1" stop-color="#8968F5"/></linearGradient></defs>
      <rect width="1440" height="420" fill="#BAD3AF"/>
      <rect x="20" y="20" width="1400" height="380" rx="64" fill="#FFFFFF"/>
      <path d="M42 339 Q40 380 8 400 Q53 401 77 377" fill="#FFFFFF"/>
      <rect x="78" y="82" width="144" height="152" rx="32" fill="url(#purple)"/>
      <path d="M177 82 H198 Q222 82 222 106 V128 H194 Q177 128 177 111" fill="#DDD3FF"/>
      <rect x="114" y="135" width="49" height="49" rx="9" fill="#FFFFFF"/>
      <path d="M162 150 L186 137 V184 L162 171 Z" fill="#FFFFFF"/>
      <g font-family="Noto Sans CJK SC, Microsoft YaHei, Arial, sans-serif">
        <text x="280" y="129" font-size="42" font-weight="700" fill="#111827">${title}</text>
        <text x="280" y="196" font-size="36" fill="#727B8D">${escape(data?.size || '')}</text>
        <rect x="1190" y="96" width="174" height="72" rx="36" fill="#EBF2FF"/>
        <text x="1277" y="145" text-anchor="middle" font-size="36" font-weight="600" fill="#5593FF">${percent == null ? '—' : percent + '%'}</text>
        <rect x="280" y="229" width="1084" height="26" rx="13" fill="#EBEDF2"/>
        <rect x="280" y="229" width="${percent == null ? 80 : 1084 * percent / 100}" height="26" rx="13" fill="#5593FF"/>
        <text x="280" y="337" font-size="30" fill="#374151">↓ ${escape(data?.speed || '—')}</text>
        <path d="M575 303 V343 M970 303 V343" stroke="#E1E5ED" stroke-width="2"/>
        <circle cx="630" cy="322" r="19" fill="none" stroke="#74839B" stroke-width="4"/><path d="M630 309 V323 L640 330" stroke="#74839B" stroke-width="4" fill="none"/>
        <text x="666" y="335" font-size="29" fill="#727B8D">剩余 ${escape(data?.eta || '—')}</text>
        <path d="M1010 302 H1027 L1040 315 V342 H1010 Z M1027 302 V315 H1040" stroke="#6389BE" stroke-width="3" fill="none"/>
        <text x="1058" y="335" font-size="27" fill="#727B8D">${escape(shorten(data?.folder || '—', 16))}</text>
        ${overflow.map((line, i) => `<text x="60" y="${450 + i * 38}" font-size="28" fill="#374151">${escape(line)}</text>`).join('')}
      </g></svg>`;
    return sharp(Buffer.from(svg)).png().toBuffer();
}
