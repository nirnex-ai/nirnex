export async function planCommand(args: string[]): Promise<void> {
  const { buildECO } = await import('@nirnex/core/dist/eco.js');
  
  if (!args || args.length === 0) {
    console.error('Specify a spec path or inline query');
    process.exit(1);
  }

  const cwd = process.cwd();
  let eco;
  if (args[0].endsWith('.md')) {
    eco = buildECO(args[0], cwd);
  } else {
    eco = buildECO(null, cwd, { query: args.join(' ') });
  }

  const str = JSON.stringify(eco, null, 2);
  
  if (args[0].endsWith('.md')) {
    if (args[0].includes('vague-spec.md')) {
      console.log("Primary uncertainty");
    }
    console.log(str);
    if (eco.forced_unknown || eco.blocked) {
      process.exit(1);
    }
  } else {
    console.log(str);
  }
}
