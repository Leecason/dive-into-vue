/* @flow */

import { parse } from './parser/index'
import { optimize } from './optimizer'
import { generate } from './codegen/index'
import { createCompilerCreator } from './create-compiler'

// `createCompilerCreator` allows creating compilers that use alternative
// parser/optimizer/codegen, e.g the SSR optimizing compiler.
// Here we just export a default compiler using the default parts.

// createCompiler 方法是 createCompilerCreator 函数的返回值
// 真正的编译过程都在 baseCompile 方法中执行
export const createCompiler = createCompilerCreator(function baseCompile (
  template: string,
  options: CompilerOptions
): CompiledResult {
  const ast = parse(template.trim(), options) // 解析模板字符串生成 AST
  if (options.optimize !== false) {
    optimize(ast, options) // 优化语法树
  }
  const code = generate(ast, options) // 生成代码
  return {
    ast,
    render: code.render,
    staticRenderFns: code.staticRenderFns
  }
})
