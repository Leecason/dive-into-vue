/* @flow */

import config from '../config'
import Watcher from '../observer/watcher'
import { mark, measure } from '../util/perf'
import { createEmptyVNode } from '../vdom/vnode'
import { updateComponentListeners } from './events'
import { resolveSlots } from './render-helpers/resolve-slots'
import { toggleObserving } from '../observer/index'
import { pushTarget, popTarget } from '../observer/dep'

import {
  warn,
  noop,
  remove,
  emptyObject,
  validateProp,
  invokeWithErrorHandling
} from '../util/index'

// 全局变量，当前激活的实例（表示正在创建/更新的 vue 实例），传入子组件构建父子关系
// 因为 JS 为单线程，Vue 的初始化是一个深度遍历过程
// 会作为 createComponentInstanceForVnode 的参数被使用
// 见 src/core/vdom/create-component.js 文件中 componentVNodeHooks 的 init 钩子函数
export let activeInstance: any = null
export let isUpdatingChildComponent: boolean = false

// 设置当前激活的 vue 实例，并返回一个方法：将当前激活的 vue 实例设置为上一个激活实例
export function setActiveInstance(vm: Component) {
  const prevActiveInstance = activeInstance
  activeInstance = vm
  // 此时 activeInstance 和 preActiveInstance 为父子关系
  // 在当前激活实例完成了所有的子树的 patch 或者 update 过程后，会调用下方返回的函数将
  // activeInstance 还原，在创建子组件时会作为参数传入 createComponentInstanceForVnode
  // 并且在子组件初始化时 initLifecycle 方法中将其设置为 vm.$parent 保留其父子关系
  return () => {
    activeInstance = prevActiveInstance
  }
}

export function initLifecycle (vm: Component) {
  const options = vm.$options

  // locate first non-abstract parent
  // 在创建子组件过程中，parent 实际上是 createComponentInstanceForVnode 方法传入的 activeInstance
  let parent = options.parent
  if (parent && !options.abstract) {
    while (parent.$options.abstract && parent.$parent) {
      parent = parent.$parent
    }
    parent.$children.push(vm) // 将当前实例存储到父 vue 实例的 $children 中
  }

  // 将父 vue 实例设置到当前实例的 $parent 上，建立父子关系
  vm.$parent = parent
  vm.$root = parent ? parent.$root : vm

  vm.$children = []
  vm.$refs = {}

  vm._watcher = null
  vm._inactive = null
  vm._directInactive = false
  vm._isMounted = false
  vm._isDestroyed = false
  vm._isBeingDestroyed = false
}

export function lifecycleMixin (Vue: Class<Component>) {
   // _update 方法作用为将 vnode 转换为真实 DOM
   // 调用时机：
   // 1. 首次渲染
   // 2. 数据更新
  Vue.prototype._update = function (vnode: VNode /* vm._render() 返回的 VNode */, hydrating?: boolean /* 非服务端渲染时为 false */) {
    const vm: Component = this
    const prevEl = vm.$el
    const prevVnode = vm._vnode
    const restoreActiveInstance = setActiveInstance(vm) // 设置 vm 为正在创建中的当前激活的实例，并返回一个方法将此设置还原
    // 将 vm._vnode 设置为渲染 vnode
    // 父子关系：
    //  vm._vnode：当前实例对应的渲染 vnode
    //  vm.$vnode：当前实例对应的渲染 vnode 的父 vnode
    //  vm._vnode.parent = vm.$vnode
    vm._vnode = vnode
    // Vue.prototype.__patch__ is injected in entry points
    // based on the rendering backend used.

    // ！！！核心方法：__patch__！！！
    // 不同平台 __patch__ 不一样，web 版定义在 src/platforms/web/runtime/index.js
    if (!prevVnode) {
      // initial render
      // 首次渲染
      vm.$el = vm.__patch__(vm.$el, vnode, hydrating, false /* removeOnly */)
    } else {
      // updates
      // 数据更新
      vm.$el = vm.__patch__(prevVnode, vnode)
    }
    restoreActiveInstance() // 在子组件完成 patch 或者 update 过程后，将 activeInstance 还原为父实例
    // update __vue__ reference
    if (prevEl) {
      prevEl.__vue__ = null
    }
    if (vm.$el) {
      vm.$el.__vue__ = vm
    }
    // if parent is an HOC, update its $el as well
    if (vm.$vnode && vm.$parent && vm.$vnode === vm.$parent._vnode) {
      vm.$parent.$el = vm.$el
    }
    // updated hook is called by the scheduler to ensure that children are
    // updated in a parent's updated hook.
  }

  Vue.prototype.$forceUpdate = function () {
    const vm: Component = this
    if (vm._watcher) {
      vm._watcher.update()
    }
  }

  Vue.prototype.$destroy = function () {
    const vm: Component = this
    if (vm._isBeingDestroyed) {
      return
    }
    callHook(vm, 'beforeDestroy') // 调用 beforeDestroy 钩子
    vm._isBeingDestroyed = true
    // remove self from parent
    // 将自身从 parent 的 $children 中移除
    const parent = vm.$parent
    if (parent && !parent._isBeingDestroyed && !vm.$options.abstract) {
      remove(parent.$children, vm)
    }
    // teardown watchers
    // 销毁渲染 watcher
    if (vm._watcher) {
      vm._watcher.teardown()
    }
    // 销毁其它的 watchers
    let i = vm._watchers.length
    while (i--) {
      vm._watchers[i].teardown()
    }
    // remove reference from data ob
    // frozen object may not have observer.
    if (vm._data.__ob__) {
      vm._data.__ob__.vmCount--
    }
    // call the last hook...
    vm._isDestroyed = true
    // invoke destroy hooks on current rendered tree
    // 递归触发子组件的销毁钩子函数
    // 所以 beforeDestroy 钩子触发顺序为先父后子
    // destroyed 钩子触发顺序为先子后父
    vm.__patch__(vm._vnode, null)
    // fire destroyed hook
    callHook(vm, 'destroyed') // 调用 destroyed 钩子
    // turn off all instance listeners.
    vm.$off()
    // remove __vue__ reference
    if (vm.$el) {
      vm.$el.__vue__ = null
    }
    // release circular reference (#6759)
    if (vm.$vnode) {
      vm.$vnode.parent = null
    }
  }
}

// Vue 实例的挂载 $mount 最终会调用这个函数
// 核心：实例化渲染 Watcher，vm._render() 和 vm._update() 方法
export function mountComponent (
  vm: Component,
  el: ?Element,
  hydrating?: boolean
): Component {
  vm.$el = el
  if (!vm.$options.render) {
    vm.$options.render = createEmptyVNode
    if (process.env.NODE_ENV !== 'production') {
      /* istanbul ignore if */
      if ((vm.$options.template && vm.$options.template.charAt(0) !== '#') ||
        vm.$options.el || el) {
        warn(
          'You are using the runtime-only build of Vue where the template ' +
          'compiler is not available. Either pre-compile the templates into ' +
          'render functions, or use the compiler-included build.',
          vm
        )
      } else {
        warn(
          'Failed to mount component: template or render function not defined.',
          vm
        )
      }
    }
  }
  callHook(vm, 'beforeMount') // 在挂载 vue 实例之前，调用 beforeMount 钩子

  let updateComponent
  /* istanbul ignore if */
  if (process.env.NODE_ENV !== 'production' && config.performance && mark) {
    updateComponent = () => {
      const name = vm._name
      const id = vm._uid
      const startTag = `vue-perf-start:${id}`
      const endTag = `vue-perf-end:${id}`

      mark(startTag)
      const vnode = vm._render()
      mark(endTag)
      measure(`vue ${name} render`, startTag, endTag)

      mark(startTag)
      vm._update(vnode, hydrating)
      mark(endTag)
      measure(`vue ${name} patch`, startTag, endTag)
    }
  } else {
    // updateComponent 是下方渲染 watcher 的回调函数
    // ！！！渲染的核心！！！
    // vm._render() 会创建当前实例的 vnode，过程中会对 vm 上的数据进行访问，触发属性的求值 getter，进行依赖收集
    // _render 方法定义在 src/core/instance/render.js
    // vm._update() 会将 vnode 转换为真实 DOM，定义在上方 lifecycleMixin 中
    updateComponent = () => {
      vm._update(vm._render(), hydrating)
    }
  }

  // we set this to vm._watcher inside the watcher's constructor
  // since the watcher's initial patch may call $forceUpdate (e.g. inside child
  // component's mounted hook), which relies on vm._watcher being already defined
  // ！！！核心代码！！！
  // 实例一个渲染 watcher，watcher 的回调是上方的 updateComponent
  // 初始化时会执行一次回调，当 vm 实例中侦测的属性发生变化后，会触发 updateComponent 回调函数来完成组件的重新渲染
  // 实例时会进入 watcher 的 this.get() 方法，调用 updateComponent，收集渲染的依赖，见 src/core/observer/watcher.js
  new Watcher(vm, updateComponent, noop, {
    before () { // 在渲染 watcher 回调前调用
      if (vm._isMounted && !vm._isDestroyed) { // 如果已经挂载，表示这是一次组件更新
        callHook(vm, 'beforeUpdate') // 调用 beforeUpdate 钩子
      }
    }
  }, true /* isRenderWatcher */) // 标记这个 watcher 为渲染 watcher
  hydrating = false

  // manually mounted instance, call mounted on self
  // mounted is called for render-created child components in its inserted hook
  // 如果是根节点，设置 _isMounted 为 true，同时调用 mounted 钩子函数
  // vm.$vnode 表示该实例的父 vnode，为 null 表示该节点为根节点
  if (vm.$vnode == null) { // 没有父 vnode，表示这是一次根节点的挂载过程
    vm._isMounted = true // 标记为已挂载
    callHook(vm, 'mounted') // 调用 mounted 钩子
  }
  return vm
}

export function updateChildComponent (
  vm: Component,
  propsData: ?Object,
  listeners: ?Object,
  parentVnode: MountedComponentVNode,
  renderChildren: ?Array<VNode>
) {
  if (process.env.NODE_ENV !== 'production') {
    isUpdatingChildComponent = true
  }

  // determine whether component has slot children
  // we need to do this before overwriting $options._renderChildren.

  // check if there are dynamic scopedSlots (hand-written or compiled but with
  // dynamic slot names). Static scoped slots compiled from template has the
  // "$stable" marker.
  const newScopedSlots = parentVnode.data.scopedSlots
  const oldScopedSlots = vm.$scopedSlots
  const hasDynamicScopedSlot = !!(
    (newScopedSlots && !newScopedSlots.$stable) ||
    (oldScopedSlots !== emptyObject && !oldScopedSlots.$stable) ||
    (newScopedSlots && vm.$scopedSlots.$key !== newScopedSlots.$key)
  )

  // Any static slot children from the parent may have changed during parent's
  // update. Dynamic scoped slots may also have changed. In such cases, a forced
  // update is necessary to ensure correctness.
  const needsForceUpdate = !!(
    renderChildren ||               // has new static slots
    vm.$options._renderChildren ||  // has old static slots
    hasDynamicScopedSlot
  )

  vm.$options._parentVnode = parentVnode
  vm.$vnode = parentVnode // update vm's placeholder node without re-render

  if (vm._vnode) { // update child tree's parent
    vm._vnode.parent = parentVnode
  }
  vm.$options._renderChildren = renderChildren

  // update $attrs and $listeners hash
  // these are also reactive so they may trigger child update if the child
  // used them during render
  vm.$attrs = parentVnode.data.attrs || emptyObject
  vm.$listeners = listeners || emptyObject

  // update props
  if (propsData && vm.$options.props) {
    toggleObserving(false)
    const props = vm._props
    const propKeys = vm.$options._propKeys || []
    for (let i = 0; i < propKeys.length; i++) {
      const key = propKeys[i]
      const propOptions: any = vm.$options.props // wtf flow?
      props[key] = validateProp(key, propOptions, propsData, vm)
    }
    toggleObserving(true)
    // keep a copy of raw propsData
    vm.$options.propsData = propsData
  }

  // update listeners
  listeners = listeners || emptyObject
  const oldListeners = vm.$options._parentListeners
  vm.$options._parentListeners = listeners
  updateComponentListeners(vm, listeners, oldListeners)

  // resolve slots + force update if has children
  if (needsForceUpdate) {
    vm.$slots = resolveSlots(renderChildren, parentVnode.context)
    vm.$forceUpdate()
  }

  if (process.env.NODE_ENV !== 'production') {
    isUpdatingChildComponent = false
  }
}

function isInInactiveTree (vm) {
  while (vm && (vm = vm.$parent)) {
    if (vm._inactive) return true
  }
  return false
}

export function activateChildComponent (vm: Component, direct?: boolean) {
  if (direct) {
    vm._directInactive = false
    if (isInInactiveTree(vm)) {
      return
    }
  } else if (vm._directInactive) {
    return
  }
  if (vm._inactive || vm._inactive === null) {
    vm._inactive = false
    for (let i = 0; i < vm.$children.length; i++) {
      activateChildComponent(vm.$children[i])
    }
    callHook(vm, 'activated')
  }
}

export function deactivateChildComponent (vm: Component, direct?: boolean) {
  if (direct) {
    vm._directInactive = true
    if (isInInactiveTree(vm)) {
      return
    }
  }
  if (!vm._inactive) {
    vm._inactive = true
    for (let i = 0; i < vm.$children.length; i++) {
      deactivateChildComponent(vm.$children[i])
    }
    callHook(vm, 'deactivated')
  }
}

// 调用生命周期钩子的方法
export function callHook (vm: Component, hook: string) {
  // #7573 disable dep collection when invoking lifecycle hooks
  pushTarget()
  const handlers = vm.$options[hook]
  const info = `${hook} hook`
  if (handlers) {
    for (let i = 0, j = handlers.length; i < j; i++) {
      invokeWithErrorHandling(handlers[i], vm /* 作为钩子函数的执行上下文 */, null, vm, info)
    }
  }
  if (vm._hasHookEvent) {
    vm.$emit('hook:' + hook) // 在父组件可以监听子组件的生命周期钩子，例如 @hook:created
  }
  popTarget()
}
