#!/usr/bin/env node
let raw = '';
process.stdin.setEncoding('utf8');
process.stdin.on('data', (chunk) => { raw += chunk; });
process.stdin.on('end', () => {
  try {
    const input = JSON.parse(raw || '{}');
    const args = (input.toolCall && input.toolCall.args) || {};
    const overwrite = {};
    if (args.Model !== 'flash') {
      overwrite.Model = 'flash';
    }
    if (!args.TypeName || args.TypeName === 'research') {
      overwrite.TypeName = 'ejecutor';
    }
    if (Object.keys(overwrite).length > 0) {
      process.stdout.write(JSON.stringify({ decision: 'allow', overwrite }));
    } else {
      process.stdout.write(JSON.stringify({ decision: 'allow' }));
    }
  } catch (err) {
    process.stdout.write(JSON.stringify({ decision: 'allow' }));
  }
});
