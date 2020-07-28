/* @flow */

import { ASSET_TYPES } from 'shared/constants'
import { isPlainObject, validateComponentName } from '../util/index'

export function initAssetRegisters (Vue: GlobalAPI) {
  /**
   * Create asset registration methods.
   *
   * ASSET_TYPES 的值为 ['component', 'directive', 'filter']
   */
  ASSET_TYPES.forEach(type => {
    Vue[type] = function (
      id: string,
      definition: Function | Object
    ): Function | Object | void {
      if (!definition) {
        return this.options[type + 's'][id]
      } else {
        /* istanbul ignore if */
        if (process.env.NODE_ENV !== 'production' && type === 'component') {
          validateComponentName(id)
        }
        // 注册全局组件
        if (type === 'component' && isPlainObject(definition)) { // 定义的组件对象必须是纯 js 对象
          definition.name = definition.name || id // 组件对象中的 name 优先
          // 使用 Vue.extend 生成该组件构造函数
          // 所以 Vue.options.components（全局组件） 上存的是组件的构造函数
          definition = this.options._base.extend(definition)
        }
        if (type === 'directive' && typeof definition === 'function') {
          definition = { bind: definition, update: definition }
        }
        this.options[type + 's'][id] = definition
        return definition
      }
    }
  })
}
