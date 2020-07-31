/* @flow */

import { _Vue } from '../install'
import type Router from '../index'
import { inBrowser } from '../util/dom'
import { runQueue } from '../util/async'
import { warn, isError, isRouterError } from '../util/warn'
import { START, isSameRoute } from '../util/route'
import {
  flatten,
  flatMapComponents,
  resolveAsyncComponents
} from '../util/resolve-components'
import {
  createNavigationDuplicatedError,
  createNavigationCancelledError,
  createNavigationRedirectedError,
  createNavigationAbortedError,
  NavigationFailureType
} from './errors'

export class History {
  router: Router
  base: string
  current: Route
  pending: ?Route
  cb: (r: Route) => void
  ready: boolean
  readyCbs: Array<Function>
  readyErrorCbs: Array<Function>
  errorCbs: Array<Function>
  listeners: Array<Function>
  cleanupListeners: Function

  // implemented by sub-classes
  +go: (n: number) => void
  +push: (loc: RawLocation, onComplete?: Function, onAbort?: Function) => void
  +replace: (loc: RawLocation, onComplete?: Function, onAbort?: Function) => void
  +ensureURL: (push?: boolean) => void
  +getCurrentLocation: () => string
  +setupListeners: Function

  constructor (router: Router, base: ?string) {
    this.router = router
    this.base = normalizeBase(base)
    // start with a route object that stands for "nowhere"
    this.current = START // 当前路径，路径切换的依据
    this.pending = null
    this.ready = false
    this.readyCbs = []
    this.readyErrorCbs = []
    this.errorCbs = []
    this.listeners = []
  }

  // 监听回调，在路由更新时触发
  listen (cb: Function) {
    this.cb = cb
  }

  onReady (cb: Function, errorCb: ?Function) {
    if (this.ready) {
      cb()
    } else {
      this.readyCbs.push(cb)
      if (errorCb) {
        this.readyErrorCbs.push(errorCb)
      }
    }
  }

  onError (errorCb: Function) {
    this.errorCbs.push(errorCb)
  }

  // 切换路径
  transitionTo (
    location: RawLocation, // 目标路径
    onComplete?: Function,
    onAbort?: Function
  ) {
    let route
    // catch redirect option https://github.com/vuejs/vue-router/issues/3201
    try {
      // 根据目标路径找到匹配的新线路
      route = this.router.match(location, this.current)
    } catch (e) {
      this.errorCbs.forEach(cb => {
        cb(e)
      })
      // Exception should still be thrown
      throw e
    }
    // 完成一次真正的路径切换
    this.confirmTransition(
      route,
      () => { // 导航守卫 beforeResolve 钩子函数依次完毕后被调用
        const prev = this.current
        this.updateRoute(route) // 更新路由，执行全局 afterEach 钩子
        onComplete && onComplete(route)
        this.ensureURL()
        this.router.afterHooks.forEach(hook => { // 调用全局的 afterEach 钩子
          hook && hook(route, prev)
        })

        // fire ready cbs once
        if (!this.ready) {
          this.ready = true
          this.readyCbs.forEach(cb => {
            cb(route)
          })
        }
      },
      err => {
        if (onAbort) {
          onAbort(err)
        }
        if (err && !this.ready) {
          this.ready = true
          // Initial redirection should still trigger the onReady onSuccess
          // https://github.com/vuejs/vue-router/issues/3225
          if (!isRouterError(err, NavigationFailureType.redirected)) {
            this.readyErrorCbs.forEach(cb => {
              cb(err)
            })
          } else {
            this.readyCbs.forEach(cb => {
              cb(route)
            })
          }
        }
      }
    )
  }

  // 完成一次真正的路径切换
  confirmTransition (route: Route /* 路径 */, onComplete: Function /* 成功回调 */, onAbort?: Function /* 失败回调 */) {
    const current = this.current // 当前路径
    const abort = err => {
      // changed after adding errors with
      // https://github.com/vuejs/vue-router/pull/3047 before that change,
      // redirect and aborted navigation would produce an err == null
      if (!isRouterError(err) && isError(err)) {
        if (this.errorCbs.length) {
          this.errorCbs.forEach(cb => {
            cb(err)
          })
        } else {
          warn(false, 'uncaught error during route navigation:')
          console.error(err)
        }
      }
      onAbort && onAbort(err)
    }
    const lastRouteIndex = route.matched.length - 1
    const lastCurrentIndex = current.matched.length - 1
    // 跳转路径和当前路径是否是同一个路径
    if (
      isSameRoute(route, current) &&
      // in the case the route map has been dynamically appended to
      lastRouteIndex === lastCurrentIndex &&
      route.matched[lastRouteIndex] === current.matched[lastCurrentIndex]
    ) {
      this.ensureURL()
      return abort(createNavigationDuplicatedError(current, route))
    }

    // 导航守卫相关逻辑

    // 根据当前路径和目标路径，对比两边的 record，解析出三个队列
    // 1. updated：两边重合的 record
    // 2. deactivated：当前路径独有的 record
    // 3. activated：目标路径独有的 record
    const { updated, deactivated, activated } = resolveQueue(
      this.current.matched,
      route.matched
    )

    // queue 为导航守卫函数（NavigationGuard）的数组，调用顺序为从前到后
    // 对照完整的导航解析流程查看：https://router.vuejs.org/zh/guide/advanced/navigation-guards.html#%E5%AE%8C%E6%95%B4%E7%9A%84%E5%AF%BC%E8%88%AA%E8%A7%A3%E6%9E%90%E6%B5%81%E7%A8%8B
    const queue: Array<?NavigationGuard> = [].concat( // 数组扁平化
      // in-component leave guards
      extractLeaveGuards(deactivated), // 失活路由的路由组件定义的 beforeRouteLeave 钩子函数集合，顺序为先子后父
      // global before hooks
      this.router.beforeHooks, // VueRouter 实例的全局 beforeEach 钩子函数集合
      // in-component update hooks
      extractUpdateHooks(updated), // 被更新路由的路由组件定义的 beforeRouteUpdate 钩子函数集合，顺序为先父后子
      // in-config enter guards
      activated.map(m => m.beforeEnter), // 被激活路由的路由配置中的 beforeEnter 钩子函数集合
      // async components
      resolveAsyncComponents(activated) // 解析异步路由组件
    )

    this.pending = route
    // 迭代 queue 的迭代器，为了能够在导航守卫钩子中调用 next 走向下一个流程
    const iterator = (hook: NavigationGuard /* 导航守卫钩子函数 */, next /* 执行队列的下一个 */) => {
      if (this.pending !== route) {
        return abort(createNavigationCancelledError(current, route))
      }
      try {
        // 执行钩子函数
        // hook(to, from, next)
        hook(route, current, (to: any) => { // 导航守卫必须要调用此方法，才会执行队列里的下一个导航钩子函数
          if (to === false) {
            // next(false) -> abort navigation, ensure current URL
            this.ensureURL(true)
            abort(createNavigationAbortedError(current, route))
          } else if (isError(to)) {
            this.ensureURL(true)
            abort(to)
          } else if (
            typeof to === 'string' ||
            (typeof to === 'object' &&
              (typeof to.path === 'string' || typeof to.name === 'string'))
          ) {
            // next('/') or next({ path: '/' }) -> redirect
            abort(createNavigationRedirectedError(current, route))
            if (typeof to === 'object' && to.replace) {
              this.replace(to)
            } else {
              this.push(to)
            }
          } else {
            // confirm transition and pass on the value
            next(to)
          }
        })
      } catch (e) {
        abort(e)
      }
    }

    // 这里首先执行上方导航解析流程的前半部分
    // 因为有些导航守卫钩子函数是定义在异步路由组件中的，等异步路由组件解析成功后，才执行后半部分
    // 完整的导航解析流程：https://router.vuejs.org/zh/guide/advanced/navigation-guards.html#%E5%AE%8C%E6%95%B4%E7%9A%84%E5%AF%BC%E8%88%AA%E8%A7%A3%E6%9E%90%E6%B5%81%E7%A8%8B
    runQueue(queue, iterator, () => { // queue 中所有任务执行完毕后才会执行此回调
      const postEnterCbs = [] // 存储 beforeRouterEnter 钩子中传给 next 的回调函数
      const isValid = () => this.current === route // 路由是否切换的判断方法
      // wait until async components are resolved before
      // extracting in-component enter guards

      // 提取所有被激活路由组件的 beforeRouteEnter 钩子函数（此时异步路由组件已解析完成）
      const enterGuards = extractEnterGuards(activated, postEnterCbs, isValid)
      // 拼接上 VueRouter 实例的全局 beforeResolve 钩子函数
      const queue = enterGuards.concat(this.router.resolveHooks)
      // 上方的 beforeRouterEnter 和 beforeResolve 钩子函数依次执行完毕后
      runQueue(queue, iterator, () => {
        if (this.pending !== route) {
          return abort(createNavigationCancelledError(current, route))
        }
        this.pending = null
        onComplete(route) // 更新路由，使用新路径替换 current，执行全局 afterEach 钩子
        if (this.router.app) {
          this.router.app.$nextTick(() => {
            postEnterCbs.forEach(cb => {
              cb()
            })
          })
        }
      })
    })
  }

   // 更新路径
  updateRoute (route: Route) {
    this.current = route // 替换新路径
    this.cb && this.cb(route) // 触发监听的回调，监听函数定义在 src/index.js VueRouter 实例的 init 方法中
  }

  setupListeners () {
    // Default implementation is empty
  }

  teardownListeners () {
    this.listeners.forEach(cleanupListener => {
      cleanupListener()
    })
    this.listeners = []
  }
}

function normalizeBase (base: ?string): string {
  if (!base) {
    if (inBrowser) {
      // respect <base> tag
      const baseEl = document.querySelector('base')
      base = (baseEl && baseEl.getAttribute('href')) || '/'
      // strip full URL origin
      base = base.replace(/^https?:\/\/[^\/]+/, '')
    } else {
      base = '/'
    }
  }
  // make sure there's the starting slash
  if (base.charAt(0) !== '/') {
    base = '/' + base
  }
  // remove trailing slash
  return base.replace(/\/$/, '')
}

// 根据当前路径 record 和目标路径 record，对比两边的 record，解析出三个队列
function resolveQueue (
  current: Array<RouteRecord>, // 当前路径到根路径的所有 record
  next: Array<RouteRecord>  // 目标路径到根路径的所有 record
): {
  updated: Array<RouteRecord>,
  activated: Array<RouteRecord>,
  deactivated: Array<RouteRecord>
} {
  let i
  const max = Math.max(current.length, next.length)
  // 找到两组 record 不一样的位置 i
  for (i = 0; i < max; i++) {
    if (current[i] !== next[i]) {
      break
    }
  }
  return {
    updated: next.slice(0, i), // 从目标路径的 0 到 i 的位置，是两组重合的
    activated: next.slice(i), // 从目标路径的 i 到最后位置，是 next 独有的
    deactivated: current.slice(i) // 从当前路径的 i 到最后位置，是 current 独有的
  }
}

function extractGuards (
  records: Array<RouteRecord>, // record 数组
  name: string, // 导航守卫的钩子函数名称
  bind: Function, // 绑定导航守卫钩子函数执行时上下文的方法
  reverse?: boolean // 反转导航守卫钩子函数的执行顺序，因为 records 收集顺序为先父后子，有些导航守卫钩子函数的执行为先子后父，例如 deactivated
): Array<?Function> {
  const guards = flatMapComponents(records, (def /* 路由组件 */, instance /* 路由组件实例 */, match /* record */, key /* 路由视图名称 */) => {
    const guard = extractGuard(def, name) // 获取到路由组件定义的导航守卫钩子函数
    if (guard) {
      // 给导航守卫钩子函数绑定执行上下文为路由组件实例
      return Array.isArray(guard) // 导航守卫钩子函数可以是数组
        ? guard.map(guard => bind(guard, instance, match, key))
        : bind(guard, instance, match, key)
    }
  })
  return flatten(reverse ? guards.reverse() : guards)
}

// 提取路由组件定义的导航守卫钩子函数
function extractGuard (
  def: Object | Function, // 组件定义
  key: string // 导航守卫钩子函数名称
): NavigationGuard | Array<NavigationGuard> {
  if (typeof def !== 'function') {
    // extend now so that global mixins are applied.
    def = _Vue.extend(def) // 为了应用全局 mixins，使用 Vue.extend 生成组件构造函数
  }
  return def.options[key] // 返回组件定义的导航守卫钩子函数
}

// 提取路由组件定义的 beforeRouteLeave 钩子函数集合
function extractLeaveGuards (deactivated: Array<RouteRecord>): Array<?Function> {
  return extractGuards(deactivated, 'beforeRouteLeave' /* 导航守卫钩子函数名 */, bindGuard /* 绑定钩子函数执行上下文的方法 */, true /* 反转钩子函数的执行顺序，为先子后父 */)
}

// 提取路由组件定义的 beforeRouteUpdate 钩子函数集合
function extractUpdateHooks (updated: Array<RouteRecord>): Array<?Function> {
  return extractGuards(updated, 'beforeRouteUpdate' /* 导航守卫钩子函数名 */, bindGuard /* 绑定钩子函数执行上下文的方法 */) // 钩子函数执行顺序为先父后子
}

// 绑定导航守卫钩子函数执行时的上下文
function bindGuard (guard: NavigationGuard /* 钩子函数 */, instance: ?_Vue /* 要绑定的执行上下文 vue 实例 */): ?NavigationGuard {
  if (instance) {
    return function boundRouteGuard () {
      return guard.apply(instance, arguments) // 将路由组件实例作为导航钩子函数执行时的上下文
    }
  }
}

// 提取路由组件定义的 beforeRouteEnter 钩子函数集合
function extractEnterGuards (
  activated: Array<RouteRecord>,
  cbs: Array<Function>,
  isValid: () => boolean
): Array<?Function> {
  return extractGuards(
    activated,
    'beforeRouteEnter',
    // 绑定钩子函数执行上下文的方法，beforeRouteEnter 守卫不能访问 this，因为守卫在导航确认前被调用，因此即将登场的新组件还没被创建
    (guard, _ /* 没有上下文 */, match, key) => {
      return bindEnterGuard(guard, match, key, cbs, isValid)
    }
  )
}

// 绑定 beforeRouterEnter 钩子执行上下文的方法
function bindEnterGuard (
  guard: NavigationGuard, // 钩子函数
  match: RouteRecord, // record
  key: string, // 路由视图名称
  cbs: Array<Function>,
  isValid: () => boolean // 路由是否切换
): NavigationGuard {
  return function routeEnterGuard (to, from, next) {
    // beforeRouteEnter 的 next 方法支持传入一个回调访问组件实例，在导航被确认的时候执行回调
    return guard(to, from, cb => {
      if (typeof cb === 'function') {
        cbs.push(() => { // 将轮询访问路由实例的方法添加入回调列表，在导航解析完成后依次调用
          // #750
          // if a router-view is wrapped with an out-in transition,
          // the instance may not have been registered at this time.
          // we will need to poll for registration until current route
          // is no longer valid.
          // 轮询访问路由实例，直到实例被创建后，执行传入的回调并传入路由实例作为参数
          poll(cb, match.instances, key, isValid)
        })
      }
      next(cb)
    })
  }
}

// 轮询一个回调
function poll (
  cb: any, // somehow flow cannot infer this is a function
  instances: Object, // record 上的路由组件实例
  key: string, // 路由视图名称
  isValid: () => boolean // 路由是否切换的判断方法
) {
  if (
    instances[key] &&
    !instances[key]._isBeingDestroyed // do not reuse being destroyed instance
  ) { // 如果能访问到路由实例且未被销毁，调用回调函数，同时传入路由实例作为参数
    cb(instances[key])
  } else if (isValid()) { // 如果路由未被切换，一直轮询直到实例被创建
    setTimeout(() => {
      poll(cb, instances, key, isValid)
    }, 16)
  }
}
