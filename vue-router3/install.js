import View from './components/view'
import Link from './components/link'

export let _Vue

// 安装 VueRouter 插件的方法
export function install (Vue) {
  // 防止重复安装
  if (install.installed && _Vue === Vue) return
  install.installed = true

  _Vue = Vue // 缓存 Vue，同时在上方 export 出去，让其它文件也能获取到 Vue

  const isDef = v => v !== undefined

  const registerInstance = (vm, callVal) => {
    let i = vm.$options._parentVnode
    if (isDef(i) && isDef(i = i.data) && isDef(i = i.registerRouteInstance)) {
      i(vm, callVal)
    }
  }

  // 全局混入 Vue 的逻辑，给每个组件实例注入 beforeCreate 和 destroyed 钩子
  Vue.mixin({
    // 主要处理一些私有属性定义和路由初始化
    beforeCreate () {
      // this.$options.router 为 new Vue 时传入的 router 实例
      if (isDef(this.$options.router)) { // 满足条件时，this 为根 vue 实例
        this._routerRoot = this // 将根 vue 实例赋值给 _routerRoot
        this._router = this.$options.router // 将 router 实例保留到 _router
        this._router.init(this) // 初始化路由，会进行一次初始化跳转
        // <router-view> 的 render 函数中依赖该属性，为了让路由更新时重新渲染 <router-view>，需要将根实例的 _route 变为响应式属性
        Vue.util.defineReactive(this, '_route', this._router.history.current)
      } else { // 普通 vue 实例
        // 每个 vue 实例通过 _routerRoot 都能访问到根 vue 实例，也就能取到 router 实例
        this._routerRoot = (this.$parent && this.$parent._routerRoot) || this
      }
      // 在映射表中注册路由组件实例，目的是将实例作为导航守卫钩子的执行上下文
      registerInstance(this, this)
    },
    destroyed () {
      // 注销映射表中的路由组件实例
      registerInstance(this)
    }
  })

  // 扩展 Vue 原型，使得每个实例 this.$router 都能取到 router 实例
  Object.defineProperty(Vue.prototype, '$router', {
    get () { return this._routerRoot._router }
  })

  // 扩展 Vue 原型，使得每个实例 this.$route 都能取到 route 实例
  Object.defineProperty(Vue.prototype, '$route', {
    get () { return this._routerRoot._route }
  })

  // 全局注册 <router-view> 和 <router-link> 组件
  Vue.component('RouterView', View)
  Vue.component('RouterLink', Link)

  const strats = Vue.config.optionMergeStrategies
  // use the same hook merging strategy for route hooks
  strats.beforeRouteEnter = strats.beforeRouteLeave = strats.beforeRouteUpdate = strats.created
}
