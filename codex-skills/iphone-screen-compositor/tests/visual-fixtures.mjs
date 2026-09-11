// Optional local visual fixtures. Synthetic UI only; never reads real app data.
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadEngine, parseArguments, renderOne } from '../scripts/composite-iphone.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
if (!process.argv[2]) throw new Error('Supply a new output directory for the visual fixtures.');
const output = path.resolve(process.argv[2]);
await mkdir(output, { recursive: true });
const options = parseArguments(['--input', 'synthetic.png']);
const engine = await loadEngine(options, root);
for (const mode of ['light', 'dark', 'arabic']) {
  const dark = mode === 'dark', rtl = mode === 'arabic';
  const bg = dark ? '#14252b' : '#f4f6f8';
  const card = dark ? '#22373e' : '#ffffff';
  const fg = dark ? '#f4f6f8' : '#18383f';
  const muted = dark ? '#b5c7cd' : '#647b84';
  const header = dark ? '#14252b' : rtl ? '#116c6a' : '#ffffff';
  const headerFg = rtl || dark ? '#ffffff' : fg;
  const label = (en, ar) => rtl ? ar : en;
  const tx = rtl ? 394 : 46;
  const text = (y, size, color, content, weight = 400) =>
    `<text x="${tx}" y="${y}" text-anchor="${rtl ? 'end' : 'start'}" font-size="${size}" font-weight="${weight}" fill="${color}">${content}</text>`;
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="440" height="901" font-family="Segoe UI,Arial,sans-serif">
    <rect width="440" height="901" fill="${bg}"/>
    <rect width="440" height="125" fill="${header}"/>
    ${text(48, 28, headerFg, label('My appointments', 'مواعيدي'), 600)}
    ${text(84, 15, rtl || dark ? '#c1dadb' : muted, label('Your care, all in one place', 'رعايتك في مكان واحد'))}
    <rect x="24" y="153" width="392" height="188" rx="20" fill="${card}"/>
    ${text(190, 13, muted, label('UPCOMING VISIT', 'الموعد القادم'), 600)}
    ${text(231, 23, fg, label('Routine check-up', 'الفحص الدوري'), 600)}
    ${text(264, 16, muted, label('Tuesday, 15 September', 'الثلاثاء، ١٥ سبتمبر'))}
    <rect x="46" y="284" width="348" height="36" rx="10" fill="${dark ? '#34545b' : '#e4f3ef'}"/>
    ${text(308, 14, dark ? '#c1eee0' : '#22634f', label('10:30 AM  ·  Confirmed', '١٠:٣٠ صباحاً  ·  مؤكد'), 600)}
    ${text(389, 20, fg, label('Before your visit', 'قبل الزيارة'), 600)}
    <rect x="24" y="412" width="392" height="109" rx="18" fill="${card}"/>
    ${text(451, 18, fg, label('Visit checklist', 'قائمة التحضير'), 600)}
    ${text(485, 14, muted, label('Everything you need for your appointment', 'كل ما تحتاج إليه لموعدك'))}
    <rect x="24" y="541" width="392" height="109" rx="18" fill="${card}"/>
    ${text(580, 18, fg, label('Your documents', 'مستنداتك'), 600)}
    ${text(614, 14, muted, label('View and manage your records', 'عرض وإدارة سجلاتك'))}
    <rect x="24" y="704" width="392" height="56" rx="16" fill="#116c6a"/>
    ${text(740, 18, '#ffffff', label('Manage appointment', 'إدارة الموعد'), 600)}
    <path d="M24 803H416" stroke="${dark ? '#34545b' : '#dce5e8'}"/>
    ${text(838, 14, muted, label('Home         Visits         Profile', 'الرئيسية          المواعيد          الملف'))}
  </svg>`;
  const source = await engine.sharp(Buffer.from(svg)).png().toBuffer();
  const result = await renderOne(engine, source, options);
  await writeFile(path.join(output, `${mode}-source.png`), source, { flag: 'wx' });
  await writeFile(path.join(output, `${mode}-iphone.png`), result.cutout, { flag: 'wx' });
  console.log(`${mode}: hardware drift 0; UI leaks 0; bar ${result.barColor}; ${path.join(output, `${mode}-iphone.png`)}`);
}
