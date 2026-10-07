import { readFileSync } from "node:fs"
import { resolve } from "node:path"
import vm from "node:vm"
import ts from "typescript"

// Execute application TS/TSX with external boundaries replaced.
// Uses the existing TypeScript compiler; no credentials or live writes are needed.
export function loadSource<Module>(
  file: string,
  mocks: Record<string, unknown> = {},
  globals: Record<string, unknown> = {},
): Module {
  const { outputText } = ts.transpileModule(
    readFileSync(resolve(file), "utf8"),
    {
      compilerOptions: {
        module: ts.ModuleKind.CommonJS,
        target: ts.ScriptTarget.ES2022,
        jsx: ts.JsxEmit.ReactJSX,
      },
      fileName: file,
    },
  )

  const compiledModule: { exports: unknown } = { exports: {} }

  vm.runInNewContext(
    outputText,
    {
      module: compiledModule,
      exports: compiledModule.exports,
      require(name: string) {
        if (Object.hasOwn(mocks, name)) return mocks[name]
        throw new Error(`Unexpected dependency: ${name}`)
      },
      Response,
      URL,
      AbortController,
      setTimeout,
      clearTimeout,
      process: { env: { NODE_ENV: "test" } },
      console: { error() {} },
      ...globals,
    },
    { filename: file },
  )

  // The VM cannot infer its exports. Callers supply the module contract here.
  return compiledModule.exports as Module
}

export const settle = async () => {
  await new Promise((resolve) => setImmediate(resolve))
}
