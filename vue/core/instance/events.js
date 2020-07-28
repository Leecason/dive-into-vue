/* @flow */

import {
  tip,
  toArray,
  hyphenate,
  formatComponentName,
  invokeWithErrorHandling
} from '../util/index'
import { updateListeners } from '../vdom/helpers/index'

// 初始化事件中心
export function initEvents (vm: Component) {
  vm._events = Object.create(null) // vue 实例上保留所有自定义事件的事件中心对象
  vm._hasHookEvent = false
  // init parent attached events
  const listeners = vm.$options._parentListeners // 拿到父组件在该组件上定义的自定义事件
  if (listeners) {
    // 更新组件监听器
    updateComponentListeners(vm, listeners)
  }
}

let target: any

// 添加自定义事件监听器
function add (event, fn) {
  target.$on(event, fn)
}

// 移除自定义事件监听器
function remove (event, fn) {
  target.$off(event, fn)
}

// 创建只执行一次的自定义事件监听器
function createOnceHandler (event, fn) {
  const _target = target
  return function onceHandler () {
    const res = fn.apply(null, arguments)
    if (res !== null) { // 执行后移除该监听器，保证回调只执行一次
      _target.$off(event, onceHandler)
    }
  }
}

export function updateComponentListeners (
  vm: Component,
  listeners: Object,
  oldListeners: ?Object
) {
  target = vm
  // 更新事件监听器，定义在 src/core/vdom/helpers/update-listeners.js
  updateListeners(listeners, oldListeners || {}, add, remove, createOnceHandler, vm)
  target = undefined
}

// 在 Vue 原型对象上添加 $on, $once, $off, $emit 方法
export function eventsMixin (Vue: Class<Component>) {
  const hookRE = /^hook:/

  // 绑定事件侦听器
  Vue.prototype.$on = function (event: string | Array<string>, fn: Function): Component {
    const vm: Component = this
    if (Array.isArray(event)) { // 如果事件是数组，则遍历递归调用 $on
      for (let i = 0, l = event.length; i < l; i++) {
        vm.$on(event[i], fn)
      }
    } else { // 单个事件
      // 每个事件名对应的事件是通过数组来存储的，将回调函数添加到该事件名的数组中
      // 添加进去的每个回调的触发时机是在调用 $emit 时
      (vm._events[event] || (vm._events[event] = [])).push(fn)
      // optimize hook:event cost by using a boolean flag marked at registration
      // instead of a hash lookup
      if (hookRE.test(event)) {
        vm._hasHookEvent = true
      }
    }
    return vm
  }

  // 绑定只触发一次的自定义事件
  Vue.prototype.$once = function (event: string, fn: Function): Component {
    const vm: Component = this
    function on () { // 实际绑定的回调函数
      vm.$off(event, on) // 在真正的回调执行前，先移除该事件的回调，保证只执行一次
      fn.apply(vm, arguments) // 接着在执行真正的回调
    }
    on.fn = fn
    vm.$on(event, on)
    return vm
  }

  // 移除对应事件名的回调函数
  // 可以指定具体需要移除的回调，如果不指定，就移除所有该事件名对应的所有回调
  Vue.prototype.$off = function (event?: string | Array<string>, fn?: Function): Component {
    const vm: Component = this
    // all
    if (!arguments.length) {
      vm._events = Object.create(null)
      return vm
    }
    // array of events
    if (Array.isArray(event)) { // 如果是传入事件名是数组，递归调用 $off
      for (let i = 0, l = event.length; i < l; i++) {
        vm.$off(event[i], fn)
      }
      return vm
    }
    // specific event
    const cbs = vm._events[event] // 找到对应事件的回调函数
    if (!cbs) { // 该事件没有任何回调，则不需要移除，直接返回
      return vm
    }
    if (!fn) { // 如果没有指定需要移除的回调，则移除所有回调
      vm._events[event] = null
      return vm
    }
    // specific handler
    // 只移除特定的回调函数
    let cb
    let i = cbs.length
    while (i--) {
      cb = cbs[i]
      if (cb === fn || cb.fn === fn) {
        cbs.splice(i, 1)
        break
      }
    }
    return vm
  }

  // 调用事件中心里对应事件的回调函数
  Vue.prototype.$emit = function (event: string): Component {
    const vm: Component = this
    if (process.env.NODE_ENV !== 'production') {
      const lowerCaseEvent = event.toLowerCase()
      // 事件名最好使用小写 + 连字符形式，因为 HTML 属性不区分大小写
      if (lowerCaseEvent !== event && vm._events[lowerCaseEvent]) {
        tip(
          `Event "${lowerCaseEvent}" is emitted in component ` +
          `${formatComponentName(vm)} but the handler is registered for "${event}". ` +
          `Note that HTML attributes are case-insensitive and you cannot use ` +
          `v-on to listen to camelCase events when using in-DOM templates. ` +
          `You should probably use "${hyphenate(event)}" instead of "${event}".`
        )
      }
    }
    let cbs = vm._events[event] // 从事件中心对象中拿到对应事件名的回调函数集合
    if (cbs) {
      cbs = cbs.length > 1 ? toArray(cbs) : cbs // 保证是数组
      const args = toArray(arguments, 1)
      const info = `event handler for "${event}"`
      for (let i = 0, l = cbs.length; i < l; i++) { // 执行绑定的所有回调函数并执行
        invokeWithErrorHandling(cbs[i], vm, args, vm, info)
      }
    }
    return vm
  }
}
