import { forEachValue } from '../util'

// Base data struct for store's module, package with some attribute and method

// module 构造类，负责管理一个 module
export default class Module {
  constructor (rawModule, runtime) {
    this.runtime = runtime
    // Store some children item
    this._children = Object.create(null) // 子 module
    // Store the origin module object which passed by programmer
    this._rawModule = rawModule // 保存当前 module
    const rawState = rawModule.state

    // Store the origin module's state
    // 保存 module 的 state
    this.state = (typeof rawState === 'function' ? rawState() : rawState) || {}
  }

  get namespaced () {
    return !!this._rawModule.namespaced
  }

  // 添加一个子 module
  addChild (key, module) {
    this._children[key] = module
  }

  // 移除子 module
  removeChild (key) {
    delete this._children[key]
  }

  // 根据 key 获取子 module
  getChild (key) {
    return this._children[key]
  }

  // 根据 key 判断是否存在对应子 module
  hasChild (key) {
    return key in this._children
  }

  update (rawModule) {
    this._rawModule.namespaced = rawModule.namespaced
    if (rawModule.actions) {
      this._rawModule.actions = rawModule.actions
    }
    if (rawModule.mutations) {
      this._rawModule.mutations = rawModule.mutations
    }
    if (rawModule.getters) {
      this._rawModule.getters = rawModule.getters
    }
  }

  forEachChild (fn) {
    forEachValue(this._children, fn)
  }

  forEachGetter (fn) {
    if (this._rawModule.getters) {
      forEachValue(this._rawModule.getters, fn)
    }
  }

  forEachAction (fn) {
    if (this._rawModule.actions) {
      forEachValue(this._rawModule.actions, fn)
    }
  }

  forEachMutation (fn) {
    if (this._rawModule.mutations) {
      forEachValue(this._rawModule.mutations, fn)
    }
  }
}
