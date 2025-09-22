const fs = require('fs');
const path = require('path');

const filePath = path.join(process.cwd(), 'server/src/routes/admin.ts');
const original = fs.readFileSync(filePath, 'utf8');
const marker = "// GET /api/admin/analytics - Get analytics data";
const endMarker = "export default router;";
const start = original.indexOf(marker);
const end = original.indexOf(endMarker);
if (start === -1 || end === -1) {
  throw new Error('Analytics block markers not found in admin.ts');
}
const newBlock = fs.readFileSync(path.join(process.cwd(), 'new_block.txt'), 'utf8');
const updated = original.slice(0, start) + newBlock + '\n' + original.slice(end);
fs.writeFileSync(filePath, updated);
