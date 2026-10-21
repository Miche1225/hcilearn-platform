// PostToolUse hook: rebuild public/dark.css whenever public/style.css is edited,
// so npm test's dark.css freshness check never fails.
const { execSync } = require('child_process');

let input = '';
process.stdin.on('data', (c) => (input += c)).on('end', () => {
  const file = ((JSON.parse(input).tool_input || {}).file_path || '').replace(/\\/g, '/');
  if (!file.endsWith('public/style.css')) return;
  execSync('npm run build:dark', { cwd: process.env.CLAUDE_PROJECT_DIR || process.cwd(), stdio: 'ignore' });
});
