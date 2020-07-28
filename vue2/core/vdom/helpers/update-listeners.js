/* @flow */

import {
  warn,
  invokeWithErrorHandling
} from 'core/util/index'
import {
  cached,
  isUndef,
  isTrue,
  isPlainObject
} from 'shared/util'

// 解析 name 上的修饰符，并且通过 cached 函数缓存解析结果，不会对同一个 name 进行两次解析
// 在 parser 阶段遇到特定的修饰符（capture、once、passive），会给 name 前面加上对应的符号，在这里会解析出来，见 src/compiler/helpers.js addHandler 方法
const normalizeEvent = cached((name: string): {
  name: string,
  once: boolean,
  capture: boolean,
  passive: boolean,
  handler?: Function,
  params?: Array<any>
} => {
  const passive = name.charAt(0) === '&'
  name = passive ? name.slice(1) : name
  const once = name.charAt(0) === '~' // Prefixed last, checked first
  name = once ? name.slice(1) : name
  const capture = name.charAt(0) === '!'
  name = capture ? name.slice(1) : name
  return {
    name,
    once,
    capture,
    passive
  }
})

// 创建执行回调函数的 invoker
export function createFnInvoker (fns: Function | Array<Function>, vm: ?Component): Function {
  // 返回的 invoker 函数，是最终的事件回调函数
  function invoker () {
    const fns = invoker.fns // fns 是用户自定义的回调函数集合，存在 invoker 上，执行事件回调函数时，取出遍历执行
    // 处理 fns 是数组或单个函数的情况
    if (Array.isArray(fns)) {
      const cloned = fns.slice()
      for (let i = 0; i < cloned.length; i++) {
        invokeWithErrorHandling(cloned[i], null, arguments, vm, `v-on handler`)
      }
    } else {
      // return handler return value for single handlers
      return invokeWithErrorHandling(fns, null, arguments, vm, `v-on handler`)
    }
  }
  invoker.fns = fns
  return invoker
}

// 更新事件监听器，原生 DOM 事件与自定义事件通用
// 两者差异化的是通过传入的 add，remove, createOnceHandler 方法来实现的
export function updateListeners (
  on: Object,
  oldOn: Object,
  add: Function,
  remove: Function,
  createOnceHandler: Function,
  vm: Component
) {
  let name, def, cur, old, event
  for (name in on) { // 遍历要绑定的事件
    def = cur = on[name] // 要新添加的事件
    old = oldOn[name] // 已经绑定的事件
    event = normalizeEvent(name) // 根据 name 解析出修饰符
    /* istanbul ignore if */
    if (__WEEX__ && isPlainObject(def)) {
      cur = def.handler
      event.params = def.params
    }
    if (isUndef(cur)) { // 如果要新添加的事件没有定义，则会报警告
      process.env.NODE_ENV !== 'production' && warn(
        `Invalid handler for event "${event.name}": got ` + String(cur),
        vm
      )
    } else if (isUndef(old)) { // old 没有定义，表示是要创建一个新的事件监听器
      if (isUndef(cur.fns)) {
        cur = on[name] = createFnInvoker(cur, vm) // 创建当前要绑定事件的回调函数，实际为 invoker 函数
      }
      if (isTrue(event.once)) { // 如果有 once 修饰符，则创建只执行一次的回调函数，定义在 src/platforms/web/runtime/modules/events.js
        cur = on[name] = createOnceHandler(event.name, cur, event.capture)
      }
      // 添加事件监听器
      // 对于 web 平台，定义在 src/platforms/web/runtime/modules/events.js
      add(event.name, cur, event.capture, event.passive, event.params)
    } else if (cur !== old) { // 绑定的事件回调发生了变化
      old.fns = cur  // 将 invoker 的 fns 指向新的回调函数，实现更新事件回调函数
      on[name] = old
    }
  }
  for (name in oldOn) {
    if (isUndef(on[name])) {
      event = normalizeEvent(name)
      remove(event.name, oldOn[name], event.capture)
    }
  }
}
