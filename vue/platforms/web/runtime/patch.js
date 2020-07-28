/* @flow */

import * as nodeOps from 'web/runtime/node-ops'
import { createPatchFunction } from 'core/vdom/patch'
import baseModules from 'core/vdom/modules/index' // 通用 module
import platformModules from 'web/runtime/modules/index' // web 平台相关的 module

// the directive module should be applied last, after all
// built-in modules have been applied.
const modules = platformModules.concat(baseModules) // 将 web 平台的 module 和与通用 module 做合并

export const patch: Function = createPatchFunction({
  nodeOps, // web 平台操作 DOM 的 API
  modules // 定义了一些模块钩子函数
})
