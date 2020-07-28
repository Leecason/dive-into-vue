/* @flow */

import { _Vue } from '../install'
import { warn, isError } from './warn'

// 解析异步路由组件，返回类似导航守卫钩子的函数
export function resolveAsyncComponents (matched: Array<RouteRecord>): Function {
  return (to, from, next) => {
    let hasAsync = false
    let pending = 0
    let error = null

    flatMapComponents(matched, (def, _, match, key) => {
      // if it's a function and doesn't have cid attached,
      // assume it's an async component resolve function.
      // we are not using Vue's default async resolving mechanism because
      // we want to halt the navigation until the incoming component has been
      // resolved.

      // 异步路由组件的判断，解析流程类似 vue 的异步组件
      if (typeof def === 'function' && def.cid === undefined) {
        hasAsync = true
        pending++

        // 异步组件解析成功的回调
        const resolve = once(resolvedDef => {
          if (isESModule(resolvedDef)) {
            resolvedDef = resolvedDef.default
          }
          // save resolved on async factory in case it's used elsewhere
          def.resolved = typeof resolvedDef === 'function'
            ? resolvedDef
            : _Vue.extend(resolvedDef)
          match.components[key] = resolvedDef // 将解析成功的路由组件赋值给对应的路由视图
          pending--
          if (pending <= 0) {
            next() // 解析完成自动执行 next
          }
        })

        const reject = once(reason => {
          const msg = `Failed to resolve async component ${key}: ${reason}`
          process.env.NODE_ENV !== 'production' && warn(false, msg)
          if (!error) {
            error = isError(reason)
              ? reason
              : new Error(msg)
            next(error)
          }
        })

        let res
        try {
          res = def(resolve, reject)
        } catch (e) {
          reject(e)
        }
        if (res) {
          if (typeof res.then === 'function') {
            res.then(resolve, reject)
          } else {
            // new syntax in Vue 2.3
            const comp = res.component
            if (comp && typeof comp.then === 'function') {
              comp.then(resolve, reject)
            }
          }
        }
      }
    })

    if (!hasAsync) next()
  }
}

// 将数组每个 record 调用 fn，返回的数组中的元素为每个 fn 的返回值
export function flatMapComponents (
  matched: Array<RouteRecord>, // record 数组
  fn: Function
): Array<?Function> {
  return flatten(matched.map(m => {
    // key 为路由对象定义的路由视图名称
    return Object.keys(m.components).map(key => fn(
      m.components[key], // 路由视图对应的路由组件
      m.instances[key], // 路由视图对应的路由组件实例
      m, // record
      key // 路由视图名称
    ))
  }))
}

// 数组扁平化
export function flatten (arr: Array<any>): Array<any> {
  return Array.prototype.concat.apply([], arr)
}

const hasSymbol =
  typeof Symbol === 'function' &&
  typeof Symbol.toStringTag === 'symbol'

function isESModule (obj) {
  return obj.__esModule || (hasSymbol && obj[Symbol.toStringTag] === 'Module')
}

// in Webpack 2, require.ensure now also returns a Promise
// so the resolve/reject functions may get called an extra time
// if the user uses an arrow function shorthand that happens to
// return that Promise.
function once (fn) {
  let called = false
  return function (...args) {
    if (called) return
    called = true
    return fn.apply(this, args)
  }
}
