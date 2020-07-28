/* @flow */

import { baseOptions } from './options'  // web 平台编译模板的一些配置
import { createCompiler } from 'compiler/index'

// compileToFunctions 作用是将 template 编译生成 render
const { compile, compileToFunctions } = createCompiler(baseOptions) // createCompiler 接收一个编译配置的参数

export { compile, compileToFunctions }
