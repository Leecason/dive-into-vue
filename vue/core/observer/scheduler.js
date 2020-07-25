/* @flow */

import type Watcher from './watcher'
import config from '../config'
import { callHook, activateChildComponent } from '../instance/lifecycle'

import {
  warn,
  nextTick,
  devtools,
  inBrowser,
  isIE
} from '../util/index'

export const MAX_UPDATE_COUNT = 100

const queue: Array<Watcher> = []
const activatedChildren: Array<Component> = []
// 一个哈希表，用来存放 watcher 的 id，防止重复的 watcher 多次加入
let has: { [key: number]: ?true } = {}
let circular: { [key: number]: number } = {}
let waiting = false
let flushing = false
let index = 0

/**
 * Reset the scheduler's state.
 *
 * 重置调度者的状态，清空 watcher 队列
 */
function resetSchedulerState () {
  index = queue.length = activatedChildren.length = 0
  has = {}
  if (process.env.NODE_ENV !== 'production') {
    circular = {}
  }
  waiting = flushing = false
}

// Async edge case #6566 requires saving the timestamp when event listeners are
// attached. However, calling performance.now() has a perf overhead especially
// if the page has thousands of event listeners. Instead, we take a timestamp
// every time the scheduler flushes and use that for all event listeners
// attached during that flush.
export let currentFlushTimestamp = 0

// Async edge case fix requires storing an event listener's attach timestamp.
let getNow: () => number = Date.now

// Determine what event timestamp the browser is using. Annoyingly, the
// timestamp can either be hi-res (relative to page load) or low-res
// (relative to UNIX epoch), so in order to compare time we have to use the
// same timestamp type when saving the flush timestamp.
// All IE versions use low-res event timestamps, and have problematic clock
// implementations (#9632)
if (inBrowser && !isIE) {
  const performance = window.performance
  if (
    performance &&
    typeof performance.now === 'function' &&
    getNow() > document.createEvent('Event').timeStamp
  ) {
    // if the event timestamp, although evaluated AFTER the Date.now(), is
    // smaller than it, it means the event is using a hi-res timestamp,
    // and we need to use the hi-res version for event listener timestamps as
    // well.
    getNow = () => performance.now()
  }
}

/**
 * Flush both queues and run the watchers.
 *
 * 执行 watcher 队列中 watcher 的回调
 */
function flushSchedulerQueue () {
  currentFlushTimestamp = getNow()
  flushing = true
  let watcher, id

  // Sort queue before flush.
  // This ensures that:
  // 1. Components are updated from parent to child. (because parent is always
  //    created before the child)
  // 2. A component's user watchers are run before its render watcher (because
  //    user watchers are created before the render watcher)
  // 3. If a component is destroyed during a parent component's watcher run,
  //    its watchers can be skipped.

  // 将队列按 watcher id 从小到大排序
  // 确保：
  // 1. 组件的更新由父到子
  //   （因为父组件的创建过程是在子组件之前，所以 watcher 创建顺序也是先父后子，执行顺序也应先父后子）
  // 2. 用户自定义的 watcher 要先于渲染 watcher
  //   （因为用户自定义的 watcher 是在渲染 watcher 之前创建，自定义 watcher 在 initState 时创建，渲染 watcher 在 mount 时创建）
  // 3. 如果一个组件在父组件的 watcher 回调执行期间被销毁，那么它的 watcher 回调可以都跳过，所以父组件 watcher 应该先执行
  queue.sort((a, b) => a.id - b.id)

  // do not cache length because more watchers might be pushed
  // as we run existing watchers
   // watcher 队列遍历
  // 细节：
  //   每一次遍历都会对「队列长度」重新求值，因为在 watcher 执行回调时的一些操作可能会触发新的 watcher，会将新的 watcher 插入进队列中
  //   插入位置为第一个大于队列中 watcher id 的位置，此时队列长度会发生改变，所以每次遍历需要对「队列长度」重新求值
  for (index = 0; index < queue.length; index++) {
    watcher = queue[index]
    // 执行 watcher 的 before 回调，渲染 watcher 会调用 beforeUpdate 钩子，定义在 src/core/instance/lifecycle.js
    if (watcher.before) {
      watcher.before()
    }
    id = watcher.id
    has[id] = null // 清除 queueWatcher 时防止 watcher 重复入队的标记
    watcher.run() // 真正执行 watcher 的回调，定义在 src/core/observer/watcher.js
    // in dev build, check and stop circular updates.

     // 在开发环境下，如果在执行 watcher 回调的时候又触发了新的 watcher，将新的 watcher 入队，有可能会出现导致无限循环更新的问题
     // 例如
     //   data: () => { msg: '' },
     //   watch: {
     //     msg () {
     //       this.msg = Math.random();
     //     }
     //   }
     // 当 msg 改变时会不断将 watcher 加入队列中，
     // 当同一个 watcher 在队列中个数大于 MAX_UPDATE_COUNT（100）时，会报错提示存在循环更新
    if (process.env.NODE_ENV !== 'production' && has[id] != null) {
      circular[id] = (circular[id] || 0) + 1
      if (circular[id] > MAX_UPDATE_COUNT) {
        warn(
          'You may have an infinite update loop ' + (
            watcher.user
              ? `in watcher with expression "${watcher.expression}"`
              : `in a component render function.`
          ),
          watcher.vm
        )
        break
      }
    }
  }

  // keep copies of post queues before resetting state
  const activatedQueue = activatedChildren.slice()
  const updatedQueue = queue.slice()

  // 状态恢复：将控制流程的值，如 waiting，flushing 恢复为初始值，清空 watcher 队列
  resetSchedulerState()

  // call component updated and activated hooks
  callActivatedHooks(activatedQueue)
  callUpdatedHooks(updatedQueue)

  // devtool hook
  /* istanbul ignore if */
  if (devtools && config.devtools) {
    devtools.emit('flush')
  }
}

function callUpdatedHooks (queue) {
  let i = queue.length
  while (i--) {
    const watcher = queue[i]
    const vm = watcher.vm
    // 只有 watcher 为渲染 watcher 且该实例已经挂载了才会调用 updated 钩子
    if (vm._watcher /* 渲染 watcher */ === watcher && vm._isMounted && !vm._isDestroyed) {
      callHook(vm, 'updated')
    }
  }
}

/**
 * Queue a kept-alive component that was activated during patch.
 * The queue will be processed after the entire tree has been patched.
 */
export function queueActivatedComponent (vm: Component) {
  // setting _inactive to false here so that a render function can
  // rely on checking whether it's in an inactive tree (e.g. router-view)
  vm._inactive = false
  activatedChildren.push(vm)
}

function callActivatedHooks (queue) {
  for (let i = 0; i < queue.length; i++) {
    queue[i]._inactive = true
    activateChildComponent(queue[i], true /* true */)
  }
}

/**
 * Push a watcher into the watcher queue.
 * Jobs with duplicate IDs will be skipped unless it's
 * pushed when the queue is being flushed.
 *
 * 将 watcher 添加进队列，在 nextTick 后执行 flushSchedulerQueue 方法统一处理队列中所有 watcher 的回调
 * 也就是异步执行 flushSchedulerQueue
 */
export function queueWatcher (watcher: Watcher) {
  const id = watcher.id
  if (has[id] == null) { // 保证同一个 watcher 只会被入队一次
    has[id] = true
    if (!flushing) {
      queue.push(watcher)
    } else {
      // if already flushing, splice the watcher based on its id
      // if already past its id, it will be run next immediately.

      // 细节：
      //   如果在统一执行队列中 watcher 回调时，又有新的 watcher 入队
      //   此时会将新的 watcher 插入到队列合适的位置（从后往前，找到第一个待插入的 watcher id 比当前队列中 watcher id 大的位置）
      let i = queue.length - 1
      while (i > index && queue[i].id > watcher.id) {
        i--
      }
      queue.splice(i + 1, 0, watcher)
    }
    // queue the flush
    if (!waiting) { // 保证对 nextTick(flushSchedulerQueue) 的调用只有一次
      waiting = true

      if (process.env.NODE_ENV !== 'production' && !config.async) {
        flushSchedulerQueue()
        return
      }
      nextTick(flushSchedulerQueue)
    }
  }
}
