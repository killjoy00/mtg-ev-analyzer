const fs = require('node:fs');
const path = require('node:path');
const Module = require('node:module');
const assert = require('node:assert/strict');
const ts = require('typescript');

// Resolve mocks per compiled module, without changing Node's global loader.
function compileModule(relative, mocks, { resolve, cache = new Map() } = {}) {
  const filename = path.resolve(relative);
  if (cache.has(filename)) return cache.get(filename).exports;
  const compiled = new Module(filename, module);
  compiled.filename = filename;
  compiled.paths = Module._nodeModulePaths(path.dirname(filename));
  cache.set(filename, compiled);
  const originalRequire = Module.createRequire(filename);
  compiled.require = (request) => {
    const special = resolve?.(request, mocks);
    if (special !== undefined) return special;
    if (request === '@/src/components/Text') return { Text: mocks['react-native'].Text };
    if (request === '@/src/components/ScreenArea') return { ScreenArea: mocks['react-native-safe-area-context'].SafeAreaView };
    if (Object.prototype.hasOwnProperty.call(mocks, request)) return mocks[request];
    if (request.endsWith('.png')) {
      const asset = path.resolve(path.dirname(filename), request);
      assert.equal(fs.readFileSync(asset).subarray(0, 8).toString('hex'), '89504e470d0a1a0a', 'native asset must be a real PNG');
      return { uri: asset };
    }
    if (request.startsWith('@/')) {
      const stem = request.slice(2);
      const target = [stem + '.ts', stem + '.tsx', stem + '.js'].find(file => fs.existsSync(file));
      if (!target) throw Error('Unresolved native test alias: ' + request);
      return compileModule(target, mocks, { resolve, cache });
    }
    return originalRequire(request);
  };
  const output = ts.transpileModule(fs.readFileSync(filename, 'utf8'), {
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX, esModuleInterop: true },
    fileName: filename,
  }).outputText;
  compiled._compile(output, filename);
  return compiled.exports;
}
module.exports = { compileModule };
