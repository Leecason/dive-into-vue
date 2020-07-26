/* @flow */

import {
  warn,
  remove,
  isObject,
  parsePath,
  _Set as Set,
  handleError,
  noop
} from '../util/index'

import { traverse } from './traverse'
import { queueWatcher } from './scheduler'
import Dep, { pushTarget, popTarget } from './dep'

import type { SimpleSet } from '../util/index'

let uid = 0

/**
 * A watcher parses an expression, collects dependencies,
 * and fires callback when the expression value changes.
 * This is used for both the $watch() api and directives.
 *
 * 一个解析表达式，进行依赖收集的观察者，同时在表达式数据变更时触发回调函数。它被用于 $watch api 以及指令
 */
export default class Watcher {
  vm: Component;
  expression: string;
  cb: Function;
  id: number;
  deep: boolean;
  user: boolean;
  lazy: boolean;
  sync: boolean;
  dirty: boolean;
  active: boolean;
  deps: Array<Dep>;
  newDeps: Array<Dep>;
  depIds: SimpleSet;
  newDepIds: SimpleSet;
  before: ?Function;
  getter: Function;
  value: any;

  constructor (
    vm: Component,
    expOrFn: string | Function,
    cb: Function,
    options?: ?Object,
    isRenderWatcher?: boolean
  ) {
    this.vm = vm
    if (isRenderWatcher) {
      vm._watcher = this // vm._watcher 为渲染 watcher
    }
    // _watchers 存放观察者实例
    vm._watchers.push(this)
    // options
    if (options) {
      this.deep = !!options.deep
      this.user = !!options.user
      this.lazy = !!options.lazy // 计算属性 watcher
      this.sync = !!options.sync
      this.before = options.before
    } else {
      this.deep = this.user = this.lazy = this.sync = false
    }
    this.cb = cb
    this.id = ++uid // uid for batching
    this.active = true
    // 计算属性 watcher 的专用属性，进行脏检查
    // dirty 如果为 true，则下次对计算属性求值时会重新计算
    // 如果为 false，则表示没有依赖变化，会继续使用上次计算的结果，不重新计算
    this.dirty = this.lazy // for lazy watchers

    // 和 dep 有关的属性
    this.deps = []
    this.newDeps = []
    this.depIds = new Set()
    this.newDepIds = new Set()
    this.expression = process.env.NODE_ENV !== 'production'
      ? expOrFn.toString()
      : ''
    // parse expression for getter
    if (typeof expOrFn === 'function') {
      this.getter = expOrFn
    } else {
      this.getter = parsePath(expOrFn)
      if (!this.getter) {
        this.getter = noop
        process.env.NODE_ENV !== 'production' && warn(
          `Failed watching path: "${expOrFn}" ` +
          'Watcher only accepts simple dot-delimited paths. ' +
          'For full control, use a function instead.',
          vm
        )
      }
    }
    // 如果是计算属性 watcher，不会立即求值
    this.value = this.lazy
      ? undefined
      : this.get()
  }

  /**
   * Evaluate the getter, and re-collect dependencies.
   *
   * 获得 getter 的值并且重新进行依赖收集
   */
  get () {
    // 将自身观察者设置为 Dep.target，用于依赖收集，定义在 src/core/observer/dep.js
    pushTarget(this)
    let value
    const vm = this.vm

    // 执行 getter 操作，进行依赖收集
    // 在 getter 操作中需要对属性进行求值操作，此时的求值会触发属性的 getter
    // 将该观察者对象放入对应属性 Dep 的 subs（订阅者）中去
    try {
      // 1. 渲染 watcher 的 getter 为 updateComponent，作用是生成 vnode 并 patch 到真实 DOM，定义在 src/core/instance/lifecycle.js
      // 2. 计算属性 watcher 在执行 getter 求值时会触发其中响应式属性的 getter，该计算属性 watcher 则会作为该属性的订阅者被 dep 收集
      value = this.getter.call(vm, vm)
    } catch (e) {
      if (this.user) {
        handleError(e, vm, `getter for watcher "${this.expression}"`)
      } else {
        throw e
      }
    } finally {
      // "touch" every property so they are all tracked as
      // dependencies for deep watching
      if (this.deep) {
        traverse(value) // 递归访问 value，触发所有子项的 getter
      }
      popTarget() // 将 Dep.target 恢复成上一个 watcher（当前 watcher 出栈），定义在 src/core/observer/dep.js
      this.cleanupDeps() // 清理依赖收集，移除不必要的依赖
    }
    return value
  }

  /**
   * Add a dependency to this directive.
   */
  addDep (dep: Dep) {
    const id = dep.id
    // 防止 dep 被多次重复添加
    if (!this.newDepIds.has(id)) {
      this.newDepIds.add(id)
      this.newDeps.push(dep)
      if (!this.depIds.has(id)) {
        // 将自身 watcher 添加到 dep（依赖）的 subs（订阅者）中
        // 当 watcher 的依赖发生改变，会通知该依赖对应的 dep 中的 subs 进行派发更新
        dep.addSub(this)
      }
    }
  }

  /**
   * Clean up for dependency collection.
   *
   * 清理依赖收集
   * vue 为数据驱动的，对于渲染 watcher，由于每次数据变化都会重新渲染，会再次触发依赖收集
   * watcher 有两个属性
   *   1. newDeps：新添加的依赖
   *   2. deps：上一次添加的依赖
   * 在 cleanupDeps 时会移除上一次依赖对自身订阅，将 newDeps 作为自己最新的依赖
   * 原因是：
   *   如果此时有一个 v-if 控制了渲染模板 a 和 b
   *   模板 a 渲染时对 x 有依赖，x 变化时应该通知视图变化，所以将 x 作为了依赖收集了起来
   *   一旦改变了 v-if 条件渲染了模板 b，此时视图不依赖 x 了，所以 x 改变时视图不需要更新，所以应该将对 x 的依赖去除
   */
  cleanupDeps () {
    let i = this.deps.length
    // 移除自身对上一次所有依赖的订阅
    while (i--) {
      const dep = this.deps[i]
      if (!this.newDepIds.has(dep.id)) {
        dep.removeSub(this)
      }
    }
    let tmp = this.depIds
    this.depIds = this.newDepIds
    this.newDepIds = tmp
    this.newDepIds.clear()
    tmp = this.deps
    this.deps = this.newDeps
    this.newDeps = tmp
    this.newDeps.length = 0
  }

  /**
   * Subscriber interface.
   * Will be called when a dependency changes.
   *
   * 调度者接口，当依赖改变时进行回调
   */
  update () {
    /* istanbul ignore else */
    if (this.lazy) { // 计算属性
      this.dirty = true // 脏检查标记设为 true，下次对该计算属性求值时会重新计算
    } else if (this.sync) {
      this.run()
    } else {
      // ！！！重要！！！
      // Vue 的一个优化点，派发更新时不会直接触发 watcher 回调，而是将 watcher 添加到队列中，在 nextTick 后（异步）触发 watcher 的回调
      // 定义在 src/core/observer/scheduler.js
      queueWatcher(this)
    }
  }

  /**
   * Scheduler job interface.
   * Will be called by the scheduler.
   *
   * 调度者工作接口，将被调度者调用
   *
   */
  run () {
    if (this.active) {
      // get 操作在获取 value 时，本身也会执行 getter
      // 对于渲染 watcher，将会调用 updateComponent，触发重新渲染，重新执行 patch 过程，定义在 src/core/instance/lifecycle.js
      const value = this.get()
      if (
        value !== this.value ||
        // Deep watchers and watchers on Object/Arrays should fire even
        // when the value is the same, because the value may
        // have mutated.

         // 即使新旧值相等，但值是对象类型或 deep watcher，也应该执行 watcher 回调
        isObject(value) ||
        this.deep
      ) {
        // set new value
        const oldValue = this.value
        // 设置新的值
        this.value = value

        // 触发回调，将新值 value 和旧值 oldValue 传入回调，所以在回调函数参数中能拿到新旧值
        if (this.user) {
          try {
            this.cb.call(this.vm, value, oldValue)
          } catch (e) {
            handleError(e, this.vm, `callback for watcher "${this.expression}"`)
          }
        } else {
          this.cb.call(this.vm, value, oldValue)
        }
      }
    }
  }

  /**
   * Evaluate the value of the watcher.
   * This only gets called for lazy watchers.
   *
   * 获取观察者的值
   * 该方法只会被计算属性 watcher 使用
   */
  evaluate () {
    this.value = this.get() // 对计算属性求值
    this.dirty = false // 将脏检查标记设为 false
  }

  /**
   * Depend on all deps collected by this watcher.
   *
   * 收集该 watcher 的所有 deps 依赖
   */
  depend () {
    let i = this.deps.length
    while (i--) {
      this.deps[i].depend()
    }
  }

  /**
   * Remove self from all dependencies' subscriber list.
   */
  teardown () {
    if (this.active) {
      // remove self from vm's watcher list
      // this is a somewhat expensive operation so we skip it
      // if the vm is being destroyed.
      if (!this.vm._isBeingDestroyed) {
        remove(this.vm._watchers, this)
      }
      let i = this.deps.length
      while (i--) {
        this.deps[i].removeSub(this)
      }
      this.active = false
    }
  }
}
