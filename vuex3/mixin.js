export default function (Vue) {
  // 获取 Vue 的版本
  const version = Number(Vue.version.split('.')[0])

  // 用于 Vue2.x 的逻辑
  if (version >= 2) {
    Vue.mixin({ beforeCreate: vuexInit }) // 向全局混入 beforeCreate 钩子，在钩子中注入 store 到每个 vue 实例中
  } else { // 用于 Vue1.x 的逻辑
    // override init and inject vuex init procedure
    // for 1.x backwards compatibility.
    const _init = Vue.prototype._init
    Vue.prototype._init = function (options = {}) {
      options.init = options.init
        ? [vuexInit].concat(options.init)
        : vuexInit
      _init.call(this, options)
    }
  }

  /**
   * Vuex init hook, injected into each instances init hooks list.
   *
   * Vuex 的初始化钩子，将 store 注入到每个实例中，使得每个组件可以通过 this.$store 访问到 store 实例
   */

  function vuexInit () {
    const options = this.$options
    // store injection
    if (options.store) { // 满足条件时，当前实例为根 vue 实例，store 为 Vuex.Store 实例
      this.$store = typeof options.store === 'function'
        ? options.store()
        : options.store
    } else if (options.parent && options.parent.$store) { // 非根 vue 实例
      // 使得每个 vue 实例都能通过 $store 访问到根实例的 $store
      this.$store = options.parent.$store
    }
  }
}
