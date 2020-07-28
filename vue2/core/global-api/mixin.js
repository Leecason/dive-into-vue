/* @flow */

import { mergeOptions } from '../util/index'

export function initMixin (Vue: GlobalAPI) {
  Vue.mixin = function (mixin: Object) {
    // 将传入的 mixin 对象合并到 Vue.options 上
    this.options = mergeOptions(this.options, mixin)
    return this
  }
}
