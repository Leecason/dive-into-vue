/* @flow */

import type Router from '../index'
import { History } from './base'
import { cleanPath } from '../util/path'
import { getLocation } from './html5'
import { setupScroll, handleScroll } from '../util/scroll'
import { pushState, replaceState, supportsPushState } from '../util/push-state'

export class HashHistory extends History {
  constructor (router: Router, base: ?string, fallback: boolean) {
    super(router, base)
    // check history fallback deeplinking
    if (fallback && checkFallback(this.base)) {
      return
    }
    ensureSlash() // 在构造函数中执行会在 url 最后添加上 `#/`
  }

  // this is delayed until the app mounts
  // to avoid the hashchange listener being fired too early
  // 初始化监听器
  setupListeners () {
    if (this.listeners.length > 0) {
      return
    }

    // 滚动条相关逻辑
    const router = this.router
    const expectScroll = router.options.scrollBehavior
    const supportsScroll = supportsPushState && expectScroll

    if (supportsScroll) {
      this.listeners.push(setupScroll())
    }

    const handleRoutingEvent = () => {
      const current = this.current
      if (!ensureSlash()) { // 如果要回退的 hash path 不是以 `/` 开头，则不做回退
        return
      }
      // 做一次路径切换
      this.transitionTo(getHash() /* 要回退的 hash */, route => {
        if (supportsScroll) { // 滚动条相关
          handleScroll(this.router, route, current, true)
        }
        if (!supportsPushState) {
          replaceHash(route.fullPath)
        }
      })
    }
    const eventType = supportsPushState ? 'popstate' : 'hashchange'
    // 监听浏览器点击回退按钮的动作
    window.addEventListener(
      eventType,
      handleRoutingEvent
    )
    this.listeners.push(() => {
      window.removeEventListener(eventType, handleRoutingEvent)
    })
  }

  // 导航到一个新的路由
  push (location: RawLocation, onComplete?: Function, onAbort?: Function) {
    const { current: fromRoute } = this
    this.transitionTo(
      location,
      route => {
        pushHash(route.fullPath) // 与 url 变化相关
        handleScroll(this.router, route, fromRoute, false) // 与滚动条相关
        onComplete && onComplete(route)
      },
      onAbort
    )
  }

  replace (location: RawLocation, onComplete?: Function, onAbort?: Function) {
    const { current: fromRoute } = this
    this.transitionTo(
      location,
      route => {
        replaceHash(route.fullPath)
        handleScroll(this.router, route, fromRoute, false)
        onComplete && onComplete(route)
      },
      onAbort
    )
  }

  go (n: number) {
    window.history.go(n)
  }

  ensureURL (push?: boolean) {
    const current = this.current.fullPath
    if (getHash() !== current) {
      push ? pushHash(current) : replaceHash(current)
    }
  }

  getCurrentLocation () {
    return getHash()
  }
}

function checkFallback (base) {
  const location = getLocation(base)
  if (!/^\/#/.test(location)) {
    window.location.replace(cleanPath(base + '/#' + location))
    return true
  }
}

// 确保 path 最前面有个斜线 `/`
function ensureSlash (): boolean {
  const path = getHash() // 拿到 hash
  if (path.charAt(0) === '/') {
    return true
  }
  replaceHash('/' + path) // 使用 replaceHash 不计入历史栈来修改 url
  return false
}

export function getHash (): string {
  // We can't use window.location.hash here because it's not
  // consistent across browsers - Firefox will pre-decode it!
  // 不能直接通过 window.location.hash 来获取，因为在 Firefox 上会有 bug
  let href = window.location.href
  const index = href.indexOf('#') // `#` 索引
  // empty path
  if (index < 0) return '' // 没有 hash

  href = href.slice(index + 1) // 拿到 # 之后的内容
  // decode the hash but not the search or hash
  // as search(query) is already decoded
  // https://github.com/vuejs/vue-router/issues/2708
  const searchIndex = href.indexOf('?')
  if (searchIndex < 0) {
    const hashIndex = href.indexOf('#')
    if (hashIndex > -1) {
      href = decodeURI(href.slice(0, hashIndex)) + href.slice(hashIndex)
    } else href = decodeURI(href)
  } else {
    href = decodeURI(href.slice(0, searchIndex)) + href.slice(searchIndex)
  }

  return href
}

// 将当前 url 拼接上 path
function getUrl (path) {
  const href = window.location.href // 拿到当前路径
  const i = href.indexOf('#') // `#` 索引
  const base = i >= 0 ? href.slice(0, i) : href // 只取 `#` 前的部分
  return `${base}#${path}` // 拼接 path
}

function pushHash (path /* fullPath */) {
  if (supportsPushState) { // 是否支持
    pushState(getUrl(path)) // 拿到最终要跳转的地址调用 pushState，会计入历史栈
  } else {
    window.location.hash = path
  }
}

function replaceHash (path /* fullPath */) {
  if (supportsPushState) { // 是否支持
    replaceState(getUrl(path)) // 拿到最终要跳转的地址调用 replaceState，不计入历史栈
  } else {
    window.location.replace(getUrl(path))
  }
}
