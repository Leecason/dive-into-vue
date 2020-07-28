/* @flow */

import {
  warn,
  once,
  isDef,
  isUndef,
  isTrue,
  isObject,
  hasSymbol,
  isPromise,
  remove
} from 'core/util/index'

import { createEmptyVNode } from 'core/vdom/vnode'
import { currentRenderingInstance } from 'core/instance/render'

// 由于模块化规范原因，确保能找到对应的组件对象
function ensureCtor (comp: any, base) {
  if (
    comp.__esModule ||
    (hasSymbol && comp[Symbol.toStringTag] === 'Module')
  ) {
    comp = comp.default
  }
  // 如果为对象，则调用 Vue.extend 生成组件构造函数
  return isObject(comp)
    ? base.extend(comp)
    : comp
}

// 创建一个注释节点作为异步组件渲染的占位符（因为此时异步组件还未加载回来）
export function createAsyncPlaceholder (
  factory: Function,
  data: ?VNodeData,
  context: Component,
  children: ?Array<VNode>,
  tag: ?string
): VNode {
  const node = createEmptyVNode()
  node.asyncFactory = factory
  node.asyncMeta = { data, context, children, tag }
  return node
}

// 处理了三种异步组件创建方式
// 1.
// Vue.component('async-example', function (resolve, reject) {
//   require(['./my-async-component'], resolve)
// })

// 2. import 返回一个 promise 对象
// Vue.component('async-webpack-example', () => import('./my-async-component'))

// 3. 高阶异步组件
// const AsyncComp = () => ({
//   component: import('./MyComp.vue'), // 需要加载的组件。应当是一个 Promise
//   loading: LoadingComp, // 加载中应当渲染的组件
//   error: ErrorComp, // 出错时渲染的组件
//   delay: 200, // 渲染加载中组件前的等待时间。默认：200ms。
//   timeout: 3000 // 最长等待时间。超出此时间则渲染错误组件。默认：Infinity
// })
// Vue.component('async-example', AsyncComp)

// 只加注释可能比较混乱，为了更好的理解三种逻辑处理，请与下方链接配合阅读并理解
// https://ustbhuangyi.github.io/vue-analysis/v2/components/async-component.html
export function resolveAsyncComponent (
  factory: Function,
  baseCtor: Class<Component>
): Class<Component> | void {
  if (isTrue(factory.error) && isDef(factory.errorComp)) { // 「高阶异步组件」，加载失败时会强制重新渲染，此时渲染 error 组件
    return factory.errorComp
  }

  if (isDef(factory.resolved)) { // 组件已经加载成功，直接渲染加载成功的组件
    return factory.resolved
  }

  const owner = currentRenderingInstance
  if (owner && isDef(factory.owners) && factory.owners.indexOf(owner) === -1) {
    // already pending
    factory.owners.push(owner)
  }

  if (isTrue(factory.loading) && isDef(factory.loadingComp)) { // 「高阶异步组件」，组件加载过程中渲染 loading 组件
    return factory.loadingComp
  }

  if (owner && !isDef(factory.owners)) {
    const owners = factory.owners = [owner]
    let sync = true
    let timerLoading = null
    let timerTimeout = null

    ;(owner: any).$on('hook:destroyed', () => remove(owners, owner))

    const forceRender = (renderCompleted: boolean) => {
      for (let i = 0, l = owners.length; i < l; i++) {
        (owners[i]: any).$forceUpdate()
      }

      if (renderCompleted) {
        owners.length = 0
        if (timerLoading !== null) {
          clearTimeout(timerLoading)
          timerLoading = null
        }
        if (timerTimeout !== null) {
          clearTimeout(timerTimeout)
          timerTimeout = null
        }
      }
    }

    // 使用 once 包装，确保 resolve 和 reject 函数只执行一次
    const resolve = once((res: Object | Class<Component>) => {
      // cache resolved
      // 缓存加载成功的组件
      factory.resolved = ensureCtor(res, baseCtor)
      // invoke callbacks only if this is not a synchronous resolve
      // (async resolves are shimmed as synchronous during SSR)
      if (!sync) {
        forceRender(true) // 由于异步组件加载过程中没有数据变化，加载成功后需要强制视图重新渲染
      } else {
        owners.length = 0
      }
    })

    const reject = once(reason => {
      process.env.NODE_ENV !== 'production' && warn(
        `Failed to resolve async component: ${String(factory)}` +
        (reason ? `\nReason: ${reason}` : '')
      )
      if (isDef(factory.errorComp)) { //「高阶异步组件」，加载失败时，如果定义了 error 组件
        factory.error = true // 标记 error 为 true
        forceRender(true) // 强制重新渲染，会渲染 error 组件
      }
    })

    // 执行异步组件工厂函数并传入上方定义的 resolve, reject
    const res = factory(resolve, reject)

    if (isObject(res)) {
      if (isPromise(res)) { //「第 2 种异步组件」，调用 factory 返回值为 promise，会进入此逻辑
        // () => Promise
        if (isUndef(factory.resolved)) {
          res.then(resolve, reject)
        }
      } else if (isPromise(res.component)) { //「高阶异步组件」，调用 factory 后返回值为 AsyncComp 组件对象
        res.component.then(resolve, reject)

        if (isDef(res.error)) { //「高阶异步组件」定义的 error 组件
          factory.errorComp = ensureCtor(res.error, baseCtor)
        }

        if (isDef(res.loading)) { //「高阶异步组件」定义的 loading 组件
          factory.loadingComp = ensureCtor(res.loading, baseCtor)
          if (res.delay === 0) {
            factory.loading = true
          } else { // 延时 delay 执行
            timerLoading = setTimeout(() => {
              timerLoading = null
              if (isUndef(factory.resolved) && isUndef(factory.error)) {
                factory.loading = true
                forceRender(false)
              }
            }, res.delay || 200)
          }
        }

        if (isDef(res.timeout)) { //「高阶异步组件」如果配置了 timeout，则 timeout 后没有成功加载，执行 reject 渲染 error 组件
          timerTimeout = setTimeout(() => {
            timerTimeout = null
            if (isUndef(factory.resolved)) {
              reject(
                process.env.NODE_ENV !== 'production'
                  ? `timeout (${res.timeout}ms)`
                  : null
              )
            }
          }, res.timeout)
        }
      }
    }

    sync = false
    // return in case resolved synchronously
    return factory.loading //「高阶异步组件」若 delay 为 0，此时直接渲染 loading 组件
      ? factory.loadingComp
      : factory.resolved
  }
}
