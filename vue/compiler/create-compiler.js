/* @flow */

import { extend } from 'shared/util'
import { detectErrors } from './error-detector'
import { createCompileToFunctionFn } from './to-function'

// baseCompile 是真正对 template 进行编译的方法
export function createCompilerCreator (baseCompile: Function): Function {
  // 不同平台编译过程中依赖的 baseOptions 不同，但是同一平台每一次编译的 baseOptions 是相同的
  // Vue 使用函数柯里化将 baseOptions 进行保留，避免了每次编译都需要传参
  return function createCompiler (baseOptions: CompilerOptions) {
    // 传入给 createCompileToFunctionFn，在该方法返回的 compileToFunctions 中被调用
    // 它会先处理配置参数，最后调用 baseCompile 执行真正的编译
    function compile (
      template: string,
      options?: CompilerOptions
    ): CompiledResult {
      const finalOptions = Object.create(baseOptions)
      const errors = []
      const tips = []

      let warn = (msg, range, tip) => {
        (tip ? tips : errors).push(msg)
      }

      if (options) {
        if (process.env.NODE_ENV !== 'production' && options.outputSourceRange) {
          // $flow-disable-line
          const leadingSpaceLength = template.match(/^\s*/)[0].length

          warn = (msg, range, tip) => {
            const data: WarningMessage = { msg }
            if (range) {
              if (range.start != null) {
                data.start = range.start + leadingSpaceLength
              }
              if (range.end != null) {
                data.end = range.end + leadingSpaceLength
              }
            }
            (tip ? tips : errors).push(data)
          }
        }
        // merge custom modules
        if (options.modules) {
          finalOptions.modules =
            (baseOptions.modules || []).concat(options.modules)
        }
        // merge custom directives
        if (options.directives) {
          finalOptions.directives = extend(
            Object.create(baseOptions.directives || null),
            options.directives
          )
        }
        // copy other options
        for (const key in options) {
          if (key !== 'modules' && key !== 'directives') {
            finalOptions[key] = options[key]
          }
        }
      }

      finalOptions.warn = warn

      const compiled = baseCompile(template.trim(), finalOptions)
      if (process.env.NODE_ENV !== 'production') {
        detectErrors(compiled.ast, warn)
      }
      compiled.errors = errors
      compiled.tips = tips
      return compiled
    }

    return {
      compile,
      // compileToFunctions 在 src/platforms/web/entry-runtime-with-compiler.js 中被调用
      compileToFunctions: createCompileToFunctionFn(compile)
    }
  }
}
