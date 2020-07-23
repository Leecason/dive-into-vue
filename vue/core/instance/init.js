/* @flow */

import config from '../config'
import { initProxy } from './proxy'
import { initState } from './state'
import { initRender } from './render'
import { initEvents } from './events'
import { mark, measure } from '../util/perf'
import { initLifecycle, callHook } from './lifecycle'
import { initProvide, initInjections } from './inject'
import { extend, mergeOptions, formatComponentName } from '../util/index'

let uid = 0

export function initMixin (Vue: Class<Component>) {
  Vue.prototype._init = function (options?: Object) {
    const vm: Component = this
    // a uid
    vm._uid = uid++

    let startTag, endTag
    /* istanbul ignore if */
    if (process.env.NODE_ENV !== 'production' && config.performance && mark) {
      startTag = `vue-perf-start:${vm._uid}`
      endTag = `vue-perf-end:${vm._uid}`
      mark(startTag)
    }

    // a flag to avoid this being observed
    // 避免 vue 实例被 observe 的标记
    vm._isVue = true
    // merge options
    // 合并配置，不同场景合并配置的逻辑不一样，传入的 options 也大不相同
    if (options && options._isComponent) { // 当前实例为子组件，则执行子组件的选项合并
      // 在执行 Vue.extend 构造子组件构造函数时，会调用 mergeOptions 方法
      // 见 src/core/global-api/extend.js

      // optimize internal component instantiation
      // since dynamic options merging is pretty slow, and none of the
      // internal component options needs special treatment.
      initInternalComponent(vm, options) // 因为不涉及递归操作，比 else 分支中外部调用场景的 mergeOptions 的过程要快
    } else { // 外部调用场景，通常为 new Vue() 时
      // 将 resolveConstructorOptions 返回的 options 和传入的 options 做合并，
      // 普通场景下该函数返回 vm.constructor.options 即 Vue.options
      // Vue.options 定义在 src/core/global-api/index.js
      // mergeOptions 定义在 src/core/util/options.js
      vm.$options = mergeOptions(
        resolveConstructorOptions(vm.constructor),
        options || {},
        vm
      )
    }
    /* istanbul ignore else */
    if (process.env.NODE_ENV !== 'production') {
      initProxy(vm)
    } else {
      vm._renderProxy = vm
    }
    // expose real self
    vm._self = vm
    initLifecycle(vm) // 初始化生命周期相关逻辑
    initEvents(vm) // 初始化事件中心
    initRender(vm) // 初始化渲染相关逻辑
    callHook(vm, 'beforeCreate')
    // 在 data/props 初始化之前初始化 inject
    initInjections(vm) // resolve injections before data/props
    initState(vm) // 初始化 data，props，computed，watcher 等
    // 在 data/props 初始化之后初始化 provide
    initProvide(vm) // resolve provide after data/props
    callHook(vm, 'created')

    /* istanbul ignore if */
    if (process.env.NODE_ENV !== 'production' && config.performance && mark) {
      vm._name = formatComponentName(vm, false)
      mark(endTag)
      measure(`vue ${vm._name} init`, startTag, endTag)
    }

    // 1.如果有 el 属性，则挂载到 el 对应的 dom 上
    // $mount 的实现和平台、构建方式都相关
    // web 版 $mount:
    //  带 complier: src/platform/web/entry-runtime-with-compiler.js
    //  不带 complier: src/platform/web/runtime/index.js
    // weex 版 $mount:
    //  src/platform/weex/runtime/index.js

    // 2.如果当前实例为组件实例，则没有 el
    // 组件自己接管了 $mount 过程
    // 可以在 src/core/vdom/create-component.js 文件中 componentVNodeHooks 的 init 函数中看到 child.$mount 的调用
    if (vm.$options.el) {
      vm.$mount(vm.$options.el)
    }
  }
}

// 将创建子组件时的一些参数合并到 vm.$options 上
export function initInternalComponent (vm: Component, options: InternalComponentOptions) {
  // 相当于 vm.$options = Object.create(Sub.options)
  const opts = vm.$options = Object.create(vm.constructor.options)
  // doing this because it's faster than dynamic enumeration.
  const parentVnode = options._parentVnode // 子组件的父 vnode
  opts.parent = options.parent // 子组件的父 vue 实例
  opts._parentVnode = parentVnode

  // 获取到父组件的一些配置
  const vnodeComponentOptions = parentVnode.componentOptions
  opts.propsData = vnodeComponentOptions.propsData // 传给子组件的 props
  opts._parentListeners = vnodeComponentOptions.listeners // 监听子组件的自定义事件
  opts._renderChildren = vnodeComponentOptions.children
  opts._componentTag = vnodeComponentOptions.tag

  if (options.render) {
    opts.render = options.render
    opts.staticRenderFns = options.staticRenderFns
  }
}

export function resolveConstructorOptions (Ctor: Class<Component>) {
  let options = Ctor.options
  if (Ctor.super) {
    const superOptions = resolveConstructorOptions(Ctor.super)
    const cachedSuperOptions = Ctor.superOptions
    if (superOptions !== cachedSuperOptions) {
      // super option changed,
      // need to resolve new options.
      Ctor.superOptions = superOptions
      // check if there are any late-modified/attached options (#4976)
      const modifiedOptions = resolveModifiedOptions(Ctor)
      // update base extend options
      if (modifiedOptions) {
        extend(Ctor.extendOptions, modifiedOptions)
      }
      options = Ctor.options = mergeOptions(superOptions, Ctor.extendOptions)
      if (options.name) {
        options.components[options.name] = Ctor
      }
    }
  }
  return options
}

function resolveModifiedOptions (Ctor: Class<Component>): ?Object {
  let modified
  const latest = Ctor.options
  const sealed = Ctor.sealedOptions
  for (const key in latest) {
    if (latest[key] !== sealed[key]) {
      if (!modified) modified = {}
      modified[key] = latest[key]
    }
  }
  return modified
}
