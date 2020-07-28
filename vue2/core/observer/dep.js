/* @flow */

import type Watcher from './watcher'
import { remove } from '../util/index'
import config from '../config'

let uid = 0

/**
 * A dep is an observable that can have multiple
 * directives subscribing to it.
 *
 * 依赖收集的核心
 * 一种对 watcher 的管理方式
 */
export default class Dep {
  static target: ?Watcher;
  id: number;
  subs: Array<Watcher>;

  constructor () {
    this.id = uid++
    this.subs = [] // 存储观察者（watcher）的数组
  }

  // 添加一个观察者
  addSub (sub: Watcher) {
    this.subs.push(sub)
  }

  // 移除一个观察者
  removeSub (sub: Watcher) {
    remove(this.subs, sub)
  }

  // 依赖收集，当存在 Dep.target 时添加观察者
  depend () {
    if (Dep.target) { // Dep.target 是全局唯一 watcher
      Dep.target.addDep(this)
    }
  }

  // 通知所有的订阅者，进行派发更新
  notify () {
    // stabilize the subscriber list first
    const subs = this.subs.slice()
    if (process.env.NODE_ENV !== 'production' && !config.async) {
      // subs aren't sorted in scheduler if not running async
      // we need to sort them now to make sure they fire in correct
      // order
      subs.sort((a, b) => a.id - b.id)
    }
    // 调用每一个观察者的 update 方法
    for (let i = 0, l = subs.length; i < l; i++) {
      subs[i].update()
    }
  }
}

// The current target watcher being evaluated.
// This is globally unique because only one watcher
// can be evaluated at a time.

// Dep 的静态属性 target，是一个 watcher，全局在同一时刻只能有一个 watcher，表示该 watcher 此时正在收集依赖
Dep.target = null
const targetStack = []

// 将 Dep.target 赋值为 watcher 并压栈（为了恢复用）
export function pushTarget (target: ?Watcher) {
  targetStack.push(target)
  Dep.target = target
}

// 将 Dep.target 恢复成上一个 watcher（当前 watcher 出栈）
export function popTarget () {
  targetStack.pop()
  Dep.target = targetStack[targetStack.length - 1]
}
