const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ts = require('typescript');
function load(file) {
  const module = { exports:{} };
  vm.runInNewContext(ts.transpileModule(fs.readFileSync(file,'utf8'), { compilerOptions:{ module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022 } }).outputText, {
    module,exports:module.exports,require(name) {
      if (name==='next/server') return { NextResponse:{ json:(body,options)=>({body,status:options?.status||200}) } };
      if (name.endsWith('/supabase/admin') || name.endsWith('/supabase/server')) return {};
      if (name.endsWith('/supabase/readAll')) return load(path.resolve(path.dirname(file),name+'.ts'));
      throw new Error(`Unexpected scope dependency ${name}`);
    },
  });
  return module.exports;
}
module.exports = load(path.resolve(__dirname,'../../lib/server/organizationScope.ts'));
